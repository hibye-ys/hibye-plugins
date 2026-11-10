#!/usr/bin/env node
// 여러 턴 독립 검증 (opt-in, 0.10.0).
// 작업 에이전트는 매 턴 목표·단계를 다시 받아도(state-focus.mjs) 순서를 벗어나거나, 끝 조건을 채우지 않고 단계를 "끝"으로 적을 수 있다.
// 자기 점검은 같은 착각을 공유하므로, 별도 로컬 headless 에이전트 세션(`claude -p` 또는 `codex exec`)이 목표·계획 순서를 지키는지 주기적으로 검사하고
// 훅이 그 판정에 따라 움직인다 — 단계 끝 미충족·순서 위반은 다음 Stop 을 1회 막고, 나머지는 보고한다. 토큰 비용은 생략 이유가 아니다.
//
//   node state-verify.mjs turn-start    UserPromptSubmit — 턴 카운트·단계 기준점 저장, 미전달 판정이 있으면 additionalContext 텍스트 출력
//   node state-verify.mjs session-start SessionStart     — source=compact 면 compaction 점검을 예약 (출력 없음)
//   node state-verify.mjs stop          Stop             — 완료된 검사 수거, 판정 반영(차단·보고), 계기가 있으면 검사 세션을 백그라운드로 시작 (stdout JSON)
//   node state-verify.mjs run --job <f> 내부용 — 분리된 worker 가 검사 세션을 동기 실행하고 결과 파일을 쓴다
// 입력 = hook payload JSON(stdin). 저장소는 projectRoot() (호출자가 HOOK_PROJECT_DIR 을 넘긴다).
// 상태는 repo 밖 STATE_HOOK_DATA_DIR(없으면 tmpdir/state-ledger-hooks)의 verify-<root>-<session>.json. 의존성 없음.
//
// 설정(.staterc, 모두 선택, STATE_VERIFY="1" 이 아니면 꺼짐): STATE_VERIFY_EVERY(기본 5, 0=주기 점검 끔), STATE_VERIFY_RUNNER(claude|codex),
// STATE_VERIFY_MODEL(기본 sonnet), STATE_VERIFY_STEP_MODEL(기본 opus). 환경변수 STATE_VERIFY_COMMAND 는 runner 를 실행 파일로 대체한다(테스트·고급).

import { execFileSync, spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import {
  accessSync,
  chmodSync,
  closeSync,
  constants,
  existsSync,
  fstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { projectRoot, readStaterc } from './state-config.mjs'
import { currentOwned } from './state-focus.mjs'

export const STATE_VERSION = 1
export const DEFAULT_EVERY = 5
export const DEFAULT_MODEL = 'sonnet'
export const DEFAULT_STEP_MODEL = 'opus'
export const MAX_VERDICTS = 10
export const STALE_RUNNING_MS = 20 * 60 * 1000
export const RUNNER_TIMEOUT_MS = 15 * 60 * 1000
export const TRANSCRIPT_READ_BYTES = 512 * 1024
export const TRANSCRIPT_TAIL_BYTES = 20 * 1024
export const PROMPT_MAX_BYTES = 40 * 1024
export const SUMMARY_MAX = 800
export const ITEM_MAX = 300
export const LIST_MAX = 8
const MAX_LOG_LINES = 50
const MAX_STAT_LINES = 60
const MAX_RUNNER_OUTPUT = 4 * 1024 * 1024
const MAX_SCAN_TEXT = 200 * 1024
const OLD_FILE_MS = 7 * 24 * 60 * 60 * 1000
const MESSAGE_CLIP = 3000
const NONE_VALUES = new Set(['', '-', '—'])
const VERDICTS = new Set(['on_track', 'drift', 'unclear'])
const KINDS = new Set(['step_unmet', 'order', 'scope', 'other', 'none'])
// 다음 Stop 을 막는 판정 종류. 범위 이탈 등은 보고만 한다.
const BLOCKING_KINDS = new Set(['step_unmet', 'order'])
const KIND_LABEL = { step_unmet: '단계 끝 조건 미충족', order: '계획 순서 위반', scope: '범위 이탈', other: '기타', none: '' }
const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:/[\]-]{0,63}$/
// 검사 세션(중첩 claude/codex)이 부모 세션으로 오인되지 않게 지운다. 인증 관련 변수는 지우지 않는다.
const STRIPPED_ENV = ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_SSE_PORT', 'CLAUDE_PROJECT_DIR']
const CLAUDE_TOOLS_ALLOWED = 'Read,Grep,Glob,Bash(git log:*),Bash(git diff:*),Bash(git show:*),Bash(git status:*)'
const CLAUDE_TOOLS_DENIED = 'Edit,Write,NotebookEdit'

// ---------- 공통 ----------

function sha(value) {
  return createHash('sha256').update(value).digest('hex')
}

function clip(text, max) {
  const chars = [...String(text ?? '')]
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : chars.join('')
}

function bytes(text) {
  return Buffer.byteLength(text, 'utf8')
}

function norm(value) {
  const text = typeof value === 'string' ? value.trim() : ''
  return NONE_VALUES.has(text) ? '' : text
}

function dataDirectory() {
  return resolve(process.env.STATE_HOOK_DATA_DIR ?? join(tmpdir(), 'state-ledger-hooks'))
}

function jobsDirectory() {
  return join(dataDirectory(), 'verify-jobs')
}

function ensurePrivateDirectory(directory) {
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  chmodSync(directory, 0o700)
}

export function statePath(root, sessionId) {
  return join(dataDirectory(), `verify-${sha(root).slice(0, 16)}-${sha(sessionId).slice(0, 24)}.json`)
}

function sessionIdOf(payload) {
  const value = payload.session_id ?? payload.sessionID
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function readPayload() {
  if (process.stdin.isTTY) return {}
  try {
    const input = readFileSync(0, 'utf8').trim()
    const value = input ? JSON.parse(input) : {}
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  } catch {
    return {}
  }
}

function writeJsonAtomic(path, value) {
  const temp = join(resolve(path, '..'), `.${basename(path)}-${process.pid}-${randomUUID().slice(0, 8)}.tmp`)
  try {
    writeFileSync(temp, `${JSON.stringify(value)}\n`, { mode: 0o600, flag: 'wx' })
    renameSync(temp, path)
  } finally {
    try { unlinkSync(temp) } catch { /* rename 이 성공하면 이미 없다 */ }
  }
}

function gitEnv() {
  const env = { ...process.env, GIT_OPTIONAL_LOCKS: '0' }
  for (const key of ['GIT_DIR', 'GIT_COMMON_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']) delete env[key]
  return env
}

function git(root, args, timeout = 3000) {
  try {
    return execFileSync('git', ['-c', 'log.showSignature=false', ...args], {
      cwd: root,
      env: gitEnv(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 4 * 1024 * 1024,
      timeout,
    })
  } catch {
    return null
  }
}

function headOf(root) {
  return git(root, ['rev-parse', '--verify', '--quiet', 'HEAD'])?.trim() || null
}

// ---------- 설정 ----------

function validModel(value, fallback, label, warnings) {
  if (value === null || value === '') return fallback
  if (MODEL_RE.test(value)) return value
  warnings.push({ key: `model:${label}`, text: `STATE 독립 검증: ${label}="${clip(value, 40)}" 는 모델 이름으로 쓸 수 없어 기본값을 씁니다.` })
  return fallback
}

// 기능이 꺼져 있으면 null. 호스트는 claude·codex(STATE_LEDGER_HOST 비어 있음 포함)만 지원한다.
export function verifyConfig(root) {
  // 검사 세션 안에서는 어떤 STATE 훅도 돌지 않는다(dispatcher 도 막지만 엔진을 직접 부르는 경로까지 막는다).
  if (process.env.STATE_LEDGER_VERIFY_CHILD) return null
  const host = process.env.STATE_LEDGER_HOST ?? ''
  if (!['', 'claude', 'codex'].includes(host)) return null
  if (readStaterc(root, 'STATE_VERIFY') !== '1') return null
  const warnings = []

  let every = DEFAULT_EVERY
  const rawEvery = readStaterc(root, 'STATE_VERIFY_EVERY')
  if (rawEvery !== null && rawEvery.trim() !== '') {
    if (/^\d{1,6}$/.test(rawEvery.trim())) every = Number(rawEvery.trim())
    else warnings.push({ key: 'every', text: `STATE 독립 검증: STATE_VERIFY_EVERY="${clip(rawEvery, 20)}" 는 0 이상의 정수가 아니어서 기본값 ${DEFAULT_EVERY} 를 씁니다.` })
  }

  let runner = 'claude'
  const rawRunner = readStaterc(root, 'STATE_VERIFY_RUNNER')
  if (rawRunner !== null && rawRunner !== '') {
    if (rawRunner === 'claude' || rawRunner === 'codex') runner = rawRunner
    else warnings.push({ key: 'runner', text: `STATE 독립 검증: STATE_VERIFY_RUNNER="${clip(rawRunner, 20)}" 는 claude 또는 codex 여야 해서 claude 를 씁니다.` })
  }

  const explicitModel = readStaterc(root, 'STATE_VERIFY_MODEL')
  const explicitStepModel = readStaterc(root, 'STATE_VERIFY_STEP_MODEL')
  const model = validModel(explicitModel, null, 'STATE_VERIFY_MODEL', warnings)
  const stepModel = validModel(explicitStepModel, null, 'STATE_VERIFY_STEP_MODEL', warnings)
  return { every, runner, model, stepModel, warnings }
}

// 계기에 맞는 모델. codex 는 변수를 명시했을 때만 모델을 넘긴다(없으면 codex 기본값 → null).
export function selectModel(cfg, hasStep) {
  const picked = hasStep ? cfg.stepModel : cfg.model
  if (cfg.runner === 'codex') return picked
  return picked ?? (hasStep ? DEFAULT_STEP_MODEL : DEFAULT_MODEL)
}

// ---------- 상태 파일 ----------

function emptyState(root, sessionId) {
  return {
    version: STATE_VERSION,
    root,
    sessionIdHash: sha(sessionId).slice(0, 16),
    turnCount: 0,
    turnStartHead: null,
    firstHead: null,
    ownedAtTurnStart: [],
    pendingTriggers: [],
    periodicTurn: 0,
    running: null,
    verdicts: [],
    lastLaunchHead: null,
    warned: {},
  }
}

// 손상된 파일은 새로 시작한다. 필드별로 형을 확인해 한 칸이 깨져도 나머지를 쓴다.
const FIELD_TYPES = {
  turnCount: (v) => Number.isInteger(v) && v >= 0,
  turnStartHead: (v) => v === null || typeof v === 'string',
  firstHead: (v) => v === null || typeof v === 'string',
  ownedAtTurnStart: Array.isArray,
  pendingTriggers: Array.isArray,
  periodicTurn: (v) => Number.isInteger(v) && v >= 0,
  running: (v) => v === null || (v && typeof v === 'object' && !Array.isArray(v)),
  verdicts: Array.isArray,
  lastLaunchHead: (v) => v === null || typeof v === 'string',
  warned: (v) => v && typeof v === 'object' && !Array.isArray(v),
}

export function loadState(path, root, sessionId) {
  const fresh = emptyState(root, sessionId)
  let value
  try {
    value = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return fresh
  }
  if (!value || typeof value !== 'object' || value.version !== STATE_VERSION || value.root !== root) return fresh
  for (const [key, valid] of Object.entries(FIELD_TYPES)) {
    if (key in value && valid(value[key])) fresh[key] = value[key]
  }
  fresh.verdicts = fresh.verdicts.filter((entry) => entry && typeof entry === 'object')
  fresh.pendingTriggers = fresh.pendingTriggers.filter((entry) => entry && typeof entry === 'object')
  return fresh
}

function saveState(path, state) {
  ensurePrivateDirectory(dataDirectory())
  writeJsonAtomic(path, state)
}

// ---------- 소유 항목·계기 ----------

function ownedSnapshot(items) {
  return items.map((item) => ({ area: item.area, id: item.id, step: norm(item.meta?.step), next_step: norm(item.meta?.next_step) }))
}

// 턴 시작(또는 직전 Stop) 이후 step·next_step 이 바뀌었거나 새로 소유한 항목(step 이 있는 것).
export function stepChanges(before, now) {
  const previous = new Map((Array.isArray(before) ? before : []).map((entry) => [`${entry.area}/${entry.id}`, entry]))
  const changes = []
  for (const current of now) {
    const old = previous.get(`${current.area}/${current.id}`)
    const to = { step: current.step, next_step: current.next_step }
    if (!old) {
      if (current.step || current.next_step) changes.push({ area: current.area, id: current.id, from: null, to })
    } else if (old.step !== current.step || old.next_step !== current.next_step) {
      changes.push({ area: current.area, id: current.id, from: { step: old.step ?? '', next_step: old.next_step ?? '' }, to })
    }
  }
  return changes
}

// 같은 종류 계기는 합친다. 단계 변경은 항목별로 가장 오래된 from 과 가장 새 to 를 남긴다.
export function mergeTriggers(...lists) {
  const merged = []
  for (const trigger of lists.flat()) {
    if (!trigger || typeof trigger.type !== 'string') continue
    const existing = merged.find((entry) => entry.type === trigger.type)
    if (!existing) {
      merged.push(structuredClone(trigger))
      continue
    }
    if (trigger.type === 'step') {
      const byKey = new Map((existing.changes ?? []).map((change) => [`${change.area}/${change.id}`, change]))
      for (const change of trigger.changes ?? []) {
        const key = `${change.area}/${change.id}`
        const old = byKey.get(key)
        byKey.set(key, old ? { ...change, from: old.from } : change)
      }
      existing.changes = [...byKey.values()]
    } else if (trigger.type === 'periodic') {
      existing.turn = trigger.turn
      existing.every = trigger.every
    }
  }
  return merged
}

// ---------- 판정 파싱·검증 ----------

function stringList(value) {
  const list = Array.isArray(value) ? value : typeof value === 'string' ? [value] : []
  return list
    .filter((entry) => typeof entry === 'string' || typeof entry === 'number')
    .map((entry) => clip(String(entry).trim(), ITEM_MAX))
    .filter(Boolean)
    .slice(0, LIST_MAX)
}

// 스키마 검증·정규화. 형식이 틀리면 null.
export function normalizeVerdict(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const verdict = typeof raw.verdict === 'string' ? raw.verdict.trim() : ''
  if (!VERDICTS.has(verdict)) return null
  let kind = typeof raw.kind === 'string' ? raw.kind.trim() : 'none'
  if (!KINDS.has(kind)) kind = 'other'
  if (verdict === 'on_track') kind = 'none'
  else if (kind === 'none') kind = 'other'
  const summary = clip(typeof raw.summary === 'string' ? raw.summary.trim() : '', SUMMARY_MAX) || '(요약 없음)'
  return { verdict, kind, summary, evidence: stringList(raw.evidence), missing: stringList(raw.missing) }
}

// 텍스트에서 `"verdict"` 키를 가진 첫 JSON 객체를 찾는다. 문자열·이스케이프를 인식하는 중괄호 매칭.
function scanVerdictObject(text) {
  const source = text.length > MAX_SCAN_TEXT ? text.slice(0, MAX_SCAN_TEXT) : text
  let attempts = 0
  for (let start = source.indexOf('{'); start >= 0 && attempts < 200; start = source.indexOf('{', start + 1)) {
    attempts += 1
    let depth = 0
    let inString = false
    let escaped = false
    for (let i = start; i < source.length; i += 1) {
      const ch = source[i]
      if (inString) {
        if (escaped) escaped = false
        else if (ch === '\\') escaped = true
        else if (ch === '"') inString = false
        continue
      }
      if (ch === '"') inString = true
      else if (ch === '{') depth += 1
      else if (ch === '}') {
        depth -= 1
        if (depth === 0) {
          try {
            const parsed = JSON.parse(source.slice(start, i + 1))
            if (parsed && typeof parsed === 'object' && 'verdict' in parsed) return parsed
          } catch { /* 다음 후보 */ }
          break
        }
      }
    }
  }
  return null
}

// runner 출력에서 판정을 꺼낸다. claude `--output-format json` 은 `.result` 문자열에 모델 답이 들어 있다.
// 반환: { verdict } | { error }
export function extractVerdict(output) {
  const text = String(output ?? '').trim()
  if (!text) return { error: '검사 세션이 아무것도 출력하지 않음' }
  let parsed = null
  try { parsed = JSON.parse(text) } catch { /* 일반 텍스트 */ }
  if (Array.isArray(parsed)) parsed = [...parsed].reverse().find((entry) => entry && typeof entry === 'object' && entry.type === 'result') ?? null
  if (parsed && typeof parsed === 'object') {
    if ('verdict' in parsed) {
      const direct = normalizeVerdict(parsed)
      return direct ? { verdict: direct } : { error: `판정 형식 오류: ${clip(text, 300)}` }
    }
    if (parsed.is_error === true) return { error: clip(typeof parsed.result === 'string' ? parsed.result : text, 400) }
    if (typeof parsed.result === 'string') return extractFromText(parsed.result)
  }
  return extractFromText(text)
}

function extractFromText(text) {
  const found = scanVerdictObject(text)
  if (!found) return { error: `판정 JSON 을 찾지 못함: ${clip(text.replace(/\s+/g, ' '), 300)}` }
  const verdict = normalizeVerdict(found)
  return verdict ? { verdict } : { error: `판정 형식 오류: ${clip(JSON.stringify(found), 300)}` }
}

function unclearVerdict(summary, missing = []) {
  return { verdict: 'unclear', kind: 'other', summary: clip(summary, SUMMARY_MAX), evidence: [], missing }
}

// ---------- 대화 기록 끝부분 ----------

function messageOf(entry) {
  if (!entry || typeof entry !== 'object' || entry.isSidechain === true) return null
  let role
  let content
  if ((entry.type === 'user' || entry.type === 'assistant') && entry.message && typeof entry.message === 'object') {
    role = entry.type
    content = entry.message.content
  } else if (entry.type === 'response_item' && entry.payload?.type === 'message') {
    role = entry.payload.role
    content = entry.payload.content
  } else {
    return null
  }
  if (role !== 'user' && role !== 'assistant') return null
  const parts = typeof content === 'string'
    ? [content]
    : Array.isArray(content)
      ? content.filter((part) => part && ['text', 'input_text', 'output_text'].includes(part.type) && typeof part.text === 'string').map((part) => part.text)
      : []
  const text = parts.join('\n').replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim()
  return text ? { role, text } : null
}

function clipMessage(text) {
  const chars = [...text]
  if (chars.length <= MESSAGE_CLIP) return text
  return `${chars.slice(0, 1000).join('')}\n…(중략)…\n${chars.slice(-2000).join('')}`
}

// transcript JSONL 의 마지막 readBytes 에서 사용자·에이전트 텍스트만 뽑아 최근 tailBytes 까지. 도구 결과·생각·도구 호출은 뺀다.
export function transcriptTail(path, { readBytes = TRANSCRIPT_READ_BYTES, tailBytes = TRANSCRIPT_TAIL_BYTES } = {}) {
  let fd
  try {
    fd = openSync(path, 'r')
    const info = fstatSync(fd)
    if (!info.isFile() || info.size === 0) return ''
    const length = Math.min(info.size, readBytes)
    const buffer = Buffer.alloc(length)
    readSync(fd, buffer, 0, length, info.size - length)
    let lines = buffer.toString('utf8').split('\n')
    if (info.size > length) lines = lines.slice(1) // 잘린 첫 줄은 버린다
    const messages = []
    for (const line of lines) {
      if (!line.trim()) continue
      let entry
      try { entry = JSON.parse(line) } catch { continue }
      const message = messageOf(entry)
      if (message) messages.push(message)
    }
    const picked = []
    let used = 0
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const rendered = `${messages[i].role === 'user' ? '사용자' : '에이전트'}: ${clipMessage(messages[i].text)}`
      const cost = bytes(rendered) + 2
      if (picked.length > 0 && used + cost > tailBytes) break
      picked.unshift(rendered)
      used += cost
    }
    return picked.join('\n\n')
  } catch {
    return ''
  } finally {
    if (fd !== undefined) try { closeSync(fd) } catch { /* ignore */ }
  }
}

function writeTranscriptFile(source, directory, jobId) {
  if (typeof source !== 'string' || !source.startsWith('/') || !existsSync(source)) return null
  const tail = transcriptTail(source)
  if (!tail) return null
  const path = join(directory, `${jobId}.transcript.txt`)
  writeFileSync(path, `# 대화 기록 끝부분 — 사용자·에이전트 텍스트만 (도구 결과 제외, 오래된 것부터)\n\n${tail}\n`, { mode: 0o600, flag: 'wx' })
  return path
}

// ---------- 검사 프롬프트 ----------

const SCHEMA = '{"verdict":"on_track|drift|unclear","kind":"step_unmet|order|scope|other|none","summary":"…","evidence":["file:line 또는 커밋"],"missing":["미충족 끝 조건"]}'

function triggerLine(trigger) {
  if (trigger.type === 'step') {
    return (trigger.changes ?? []).map((change) => {
      const to = `step "${change.to.step || '-'}" / next_step "${change.to.next_step || '-'}"`
      return change.from
        ? `- 단계 변경 [${change.id}]: step "${change.from.step || '-'}" → "${change.to.step || '-'}", next_step "${change.from.next_step || '-'}" → "${change.to.next_step || '-'}"`
        : `- 단계 변경 [${change.id}]: 이 세션에서 새로 소유한 항목 — ${to}`
    }).join('\n')
  }
  if (trigger.type === 'compact') return '- compaction 직후: 맥락이 압축된 직후라 목표·순서를 잃기 쉽다.'
  if (trigger.type === 'periodic') return `- 주기 점검: 사용자 턴 ${trigger.turn}번째 (${trigger.every}턴마다).`
  return ''
}

function itemBlock(item) {
  const meta = item.meta ?? {}
  const lines = [`### [${item.id}] ${clip(norm(meta.title) || item.title || '', 120)} (${item.section === 'active' ? '§1 활성' : '§2 다음'})`, `- detail: ${item.path}`]
  const fields = [['목표·완성 기준', 'goal'], ['지금 단계', 'step'], ['다음 단계', 'next_step'], ['상태', 'status'], ['절차(handoff)', 'handoff']]
  for (const [label, key] of fields) lines.push(`- ${label}: ${norm(meta[key]) || '(없음)'}`)
  return lines.join('\n')
}

function commitRange(root, base, head) {
  if (!head) return { log: '(커밋 없음)', stat: '', label: '' }
  if (base === head) return { log: '(마지막 검사 이후 새 커밋 없음)', stat: '', label: `${head.slice(0, 8)}..HEAD` }
  const logArgs = ['log', '--no-color', '--format=%h %s', `--max-count=${MAX_LOG_LINES}`]
  const ranged = base ? git(root, [...logArgs, `${base}..${head}`]) : null
  if (ranged === null) {
    // 기준 커밋이 없거나 사라졌으면(rebase·gc) 최근 커밋으로 대신한다.
    return { log: (git(root, [...logArgs, head]) ?? '').trim() || '(커밋 목록을 읽지 못함)', stat: '', label: '(기준 커밋 없음 — 최근 커밋)' }
  }
  const statLines = (git(root, ['diff', '--stat', '--no-color', `${base}..${head}`], 5000) ?? '').split('\n').filter(Boolean)
  return {
    log: ranged.trim() || '(마지막 검사 이후 새 커밋 없음)',
    stat: statLines.length > MAX_STAT_LINES ? `${statLines.slice(0, MAX_STAT_LINES - 1).join('\n')}\n… 외 ${statLines.length - MAX_STAT_LINES + 1}줄` : statLines.join('\n'),
    label: `${base.slice(0, 8)}..${head.slice(0, 8)}`,
  }
}

export function buildPrompt({ root, branch, items, triggers, base, head, transcriptFile, previous }) {
  const range = commitRange(root, base, head)
  const parts = [
    '너는 독립 검증자다. 읽기만 한다. 작업 에이전트의 자기 보고를 믿지 말고 파일·커밋으로 확인한다.',
    '저장소를 고치지 않는다(파일 수정·커밋·브랜치 변경 금지). 쓸 수 있는 것은 파일 읽기·검색과 git log/diff/show/status 뿐이다.',
    '',
    `## 이번 검사의 계기 (브랜치 ${branch})`,
    ...triggers.map(triggerLine).filter(Boolean),
    '',
    '## 작업 에이전트가 소유한 STATE 항목',
    ...items.slice(0, 3).map(itemBlock),
    '각 항목의 detail 파일과 handoff 계획 문서(`경로#절` 형식이면 그 절)를 직접 읽어라. 방금 끝났다고 주장된 단계, 지금 단계, 다음 단계의 "끝 조건"을 계획에서 찾아 문장 그대로 확인 기준으로 삼는다.',
    '',
    `## 이번 구간의 커밋 (git log --oneline ${range.label || '…'}, 최대 ${MAX_LOG_LINES}줄)`,
    range.log,
  ]
  if (range.stat) parts.push('', '## 변경 요약 (git diff --stat)', range.stat)
  parts.push('', '## 대화 기록 끝부분')
  parts.push(transcriptFile
    ? `${transcriptFile} 를 읽어라. 사용자:/에이전트: 로 라벨된 텍스트만 있고 도구 결과는 없다. 에이전트가 지금 무엇을 제안·진행 중인지, 사용자가 무엇을 명시 지시했는지 본다.`
    : '(대화 기록 없음 — 파일과 커밋만으로 판단한다)')
  if (previous) {
    parts.push('', '## 직전 판정', `${previous.verdict}/${previous.kind} — ${previous.summary}`, ...(previous.missing?.length ? [`미충족: ${previous.missing.join('; ')}`] : []), '지난번 지적이 고쳐졌는지도 확인하라.')
  }
  parts.push(
    '',
    '## 판단할 것',
    '1. 단계 변경이 있었다면: 주장된 단계의 끝 조건이 충족됐는가? 충족 근거(파일:줄, 커밋)를 대고, 미충족 조건은 missing 에 그대로 적는다.',
    '2. 지금 작업과 제안이 계획의 단계 순서를 따르는가? 단계를 건너뛰거나 계획 밖 작업을 하고 있지 않은가? 사용자가 대화에서 명시적으로 지시한 것은 계획보다 우선한다.',
    '3. 작업 범위가 목표(goal)에서 벗어나고 있지 않은가?',
    '근거를 확인할 수 없으면 추측하지 말고 unclear 로 답한다.',
    '',
    '## 출력',
    `JSON 한 개만 출력한다(코드펜스·설명 없이). 스키마: ${SCHEMA}`,
    '- kind: step_unmet = 단계 끝 조건 미충족, order = 계획 순서 위반, scope = 범위 이탈, other = 그 밖, none = on_track 일 때.',
    '- summary 는 800자 이내, evidence·missing 은 각 8개 이내.',
  )
  let prompt = parts.join('\n')
  if (bytes(prompt) > PROMPT_MAX_BYTES) prompt = `${prompt.slice(0, PROMPT_MAX_BYTES / 2)}\n…(길이 제한으로 잘림)`
  return prompt
}

// ---------- runner ----------

// 데스크톱 앱처럼 PATH 에 claude 가 없는 환경이면 부모 세션이 알려 주는 CLAUDE_CODE_EXECPATH 로 대신한다.
function executableOnPath(name, env) {
  for (const directory of (env.PATH ?? '').split(':')) {
    if (!directory) continue
    try {
      accessSync(join(directory, name), constants.X_OK)
      if (statSync(join(directory, name)).isFile()) return true
    } catch { /* 다음 후보 */ }
  }
  return false
}

export function claudeCommand(env = process.env) {
  if (executableOnPath('claude', env)) return 'claude'
  const exec = env.CLAUDE_CODE_EXECPATH
  return exec && isAbsolute(exec) && existsSync(exec) ? exec : 'claude'
}

// runner 별 명령줄. STATE_VERIFY_COMMAND 가 있으면 그 실행 파일이 prompt(stdin)를 받아 판정 JSON 을 stdout 으로 낸다.
export function buildRunnerCommand(job) {
  const env = { ...process.env, STATE_LEDGER_VERIFY_CHILD: '1' }
  if (job.command) {
    return { command: job.command, args: [], env: { ...env, STATE_VERIFY_MODEL_SELECTED: job.model ?? '' }, outputFile: null }
  }
  if (job.runner === 'codex') {
    const outputFile = join(job.jobsDir, `${job.jobId}.codex-last.txt`)
    const args = ['exec', '--sandbox', 'read-only', '--ephemeral', '-C', job.root]
    if (job.model) args.push('-m', job.model)
    args.push('-o', outputFile, '-')
    return { command: 'codex', args, env, outputFile }
  }
  const args = [
    '-p', '--model', job.model, '--output-format', 'json', '--no-session-persistence',
    '--add-dir', job.jobsDir,
    '--allowedTools', CLAUDE_TOOLS_ALLOWED,
    '--disallowedTools', CLAUDE_TOOLS_DENIED,
  ]
  return { command: claudeCommand(env), args, env, outputFile: null }
}

function runProcess(command, args, { cwd, env, input, timeoutMs }) {
  return new Promise((resolvePromise) => {
    let stdout = ''
    let stderr = ''
    let settled = false
    let timedOut = false
    let timer = null
    let child
    const finish = (extra) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolvePromise({ stdout, stderr, timedOut, ...extra })
    }
    try {
      child = spawn(command, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] })
    } catch (error) {
      finish({ error })
      return
    }
    timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL') }, timeoutMs)
    child.stdout.on('data', (chunk) => { if (stdout.length < MAX_RUNNER_OUTPUT) stdout += chunk })
    child.stderr.on('data', (chunk) => { if (stderr.length < 64 * 1024) stderr += chunk })
    child.on('error', (error) => finish({ error }))
    child.on('close', (code, signal) => finish({ code, signal }))
    child.stdin.on('error', () => { /* runner 가 입력을 다 읽기 전에 끝나도 close 에서 처리한다 */ })
    child.stdin.end(input)
  })
}

function failureText(run) {
  if (run.error) return run.error.message
  if (run.timedOut) return `${Math.round(RUNNER_TIMEOUT_MS / 60000)}분 제한 시간 초과`
  const detail = run.stderr.trim() || run.stdout.trim() || `종료 코드 ${run.code ?? run.signal}`
  return clip(detail.replace(/\s+/g, ' '), 400)
}

// 분리된 worker. 프롬프트(git log·diff·대화 기록)는 여기서 만든다 — Stop 이 느린 git 에 매이지 않게.
async function runWorker(argv) {
  const index = argv.indexOf('--job')
  const jobFile = index >= 0 ? argv[index + 1] : null
  if (!jobFile) throw new Error('usage: state-verify.mjs run --job <jobfile>')
  const job = JSON.parse(readFileSync(jobFile, 'utf8'))
  const startedAt = Date.now()
  let outcome
  let transcriptFile = null
  let outputFile = null
  try {
    transcriptFile = writeTranscriptFile(job.transcriptSource, job.jobsDir, job.jobId)
    const prompt = buildPrompt({ root: job.root, ...job.promptInput, transcriptFile })
    const runner = buildRunnerCommand(job)
    outputFile = runner.outputFile
    const run = await runProcess(runner.command, runner.args, { cwd: job.root, env: runner.env, input: prompt, timeoutMs: job.timeoutMs ?? RUNNER_TIMEOUT_MS })
    if (run.error || run.timedOut || (run.code !== 0 && run.code !== null) || run.signal) {
      outcome = { verdict: unclearVerdict(`검사 세션 실패: ${failureText(run)}`) }
    } else {
      let output = run.stdout
      if (outputFile) {
        try { output = readFileSync(outputFile, 'utf8') } catch { /* stdout 으로 대신한다 */ }
      }
      const extracted = extractVerdict(output)
      outcome = extracted.verdict ? extracted : { verdict: unclearVerdict(`검사 세션 실패: ${extracted.error}`) }
    }
  } catch (error) {
    outcome = { verdict: unclearVerdict(`검사 세션 실패: ${clip(error.message, 400)}`) }
  }
  const result = {
    jobId: job.jobId,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    runner: job.command ? 'command' : job.runner,
    model: job.model ?? null,
    head: job.head ?? null,
    triggers: job.triggerTypes ?? [],
    ...outcome.verdict,
  }
  writeJsonAtomic(job.resultFile, result)
  for (const path of [transcriptFile, outputFile, jobFile]) removeQuietly(path)
}

// ---------- 수거·반영 ----------

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error.code === 'EPERM'
  }
}

function pushVerdict(state, entry) {
  state.verdicts.push({ delivered: false, stopHandled: false, blocked: false, ...entry })
  if (state.verdicts.length > MAX_VERDICTS) state.verdicts.splice(0, state.verdicts.length - MAX_VERDICTS)
}

function removeQuietly(path) {
  if (path) try { unlinkSync(path) } catch { /* 없을 수 있다 */ }
}

// 진행 중인 검사가 끝났으면 판정을 거둔다. 결과 없이 worker 가 죽었거나 20분이 지났으면 unclear.
export function reap(state, now = Date.now()) {
  const running = state.running
  if (!running) return
  const base = { id: running.jobId, triggers: (running.triggers ?? []).map((trigger) => trigger.type), model: running.model ?? null, head: running.head ?? null }
  if (running.resultFile && existsSync(running.resultFile)) {
    let result = null
    try { result = JSON.parse(readFileSync(running.resultFile, 'utf8')) } catch { /* 아래에서 unclear */ }
    const verdict = normalizeVerdict(result) ?? unclearVerdict('검사 세션 결과 파일을 읽지 못함')
    pushVerdict(state, { ...base, finishedAt: result?.finishedAt ?? new Date(now).toISOString(), ...verdict })
    removeQuietly(running.resultFile)
    state.running = null
    return
  }
  const started = Date.parse(running.startedAt)
  const stale = Number.isFinite(started) && now - started > STALE_RUNNING_MS
  if (!pidAlive(running.pid) || stale) {
    pushVerdict(state, { ...base, finishedAt: new Date(now).toISOString(), ...unclearVerdict('검사 세션이 결과 없이 끝남') })
    removeQuietly(running.jobFile)
    state.running = null
  }
}

function triggerNames(verdict) {
  return (verdict.triggers ?? []).join(',') || 'check'
}

// 에이전트에게 주는 판정 블록(다음 UserPromptSubmit additionalContext).
export function deliveryBlock(verdict) {
  const lines = [`=== STATE 독립 검증 결과 (${triggerNames(verdict)}, ${verdict.model ?? '기본 모델'}) ===`, `판정: ${verdict.verdict}/${verdict.kind} — ${verdict.summary}`]
  if (verdict.missing?.length) lines.push(`미충족: ${verdict.missing.map((entry) => clip(entry, 200)).join('; ')}`)
  if (verdict.evidence?.length) lines.push(`근거: ${verdict.evidence.map((entry) => clip(entry, 200)).join('; ')}`)
  lines.push('이 판정은 작업 에이전트가 아닌 별도 검사 세션의 것이다. 맞으면 바로잡고, 틀렸다고 보면 근거를 들어 사용자에게 알린다.')
  return lines.join('\n')
}

function blockReason(verdict) {
  const lines = [
    `STATE 독립 검증 세션(${triggerNames(verdict)}, ${verdict.model ?? '기본 모델'})이 ${KIND_LABEL[verdict.kind]}으로 판정했습니다.`,
    `판정: ${verdict.verdict}/${verdict.kind} — ${verdict.summary}`,
  ]
  if (verdict.missing?.length) lines.push('미충족 끝 조건:', ...verdict.missing.map((entry) => `- ${entry}`))
  if (verdict.evidence?.length) lines.push(`근거: ${verdict.evidence.join('; ')}`)
  lines.push('handoff 의 해당 단계 절과 끝 조건을 다시 읽고 바로잡거나, 계획을 바꿔야 하면 사용자에게 묻고 끝내세요. 검사 세션이 틀렸다고 판단하면 근거를 들어 사용자에게 알리세요.')
  return lines.join('\n')
}

function reportLine(verdict, blocked) {
  const head = `STATE 독립 검증(${triggerNames(verdict)}, ${verdict.model ?? '기본 모델'}): ${verdict.verdict}/${verdict.kind}`
  return `${head}${blocked ? ' — 단계 끝 조건/순서 문제로 이번 Stop 을 한 번 막았습니다' : ''} — ${clip(verdict.summary, 160)}`
}

// 가장 새 판정이 이 Stop 에서 처리할 것인지 결정한다. 최신 판정이 이전 판정을 대체한다.
function actOnLatest(state, payload) {
  const latest = state.verdicts.at(-1)
  if (!latest || latest.stopHandled) return { messages: [], block: null }
  if (latest.verdict === 'on_track') {
    for (const entry of state.verdicts) entry.stopHandled = true
    return { messages: [], block: null }
  }
  const blockable = latest.verdict === 'drift' && BLOCKING_KINDS.has(latest.kind) && !latest.blocked
  if (blockable && payload.stop_hook_active === true) return { messages: [], block: null } // 다음 Stop 에서
  for (const entry of state.verdicts) entry.stopHandled = true
  if (blockable) {
    latest.blocked = true
    return { messages: [reportLine(latest, true)], block: blockReason(latest) }
  }
  return { messages: [reportLine(latest, false)], block: null }
}

// ---------- 시작 ----------

function cleanOldJobFiles(directory) {
  const cutoff = Date.now() - OLD_FILE_MS
  let entries = []
  try { entries = readdirSync(directory, { withFileTypes: true }) } catch { return }
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const path = join(directory, entry.name)
    try { if (statSync(path).mtimeMs < cutoff) unlinkSync(path) } catch { /* 동시 정리 */ }
  }
}

// 소유 항목을 job 파일에 담을 만큼만 줄인다 (worker 가 프롬프트를 만든다).
function slimItem(item) {
  const meta = item.meta ?? {}
  return {
    id: item.id,
    path: item.path,
    section: item.section,
    title: item.title ?? '',
    meta: Object.fromEntries(['title', 'goal', 'step', 'next_step', 'status', 'handoff'].map((key) => [key, norm(meta[key])])),
  }
}

// job 파일을 쓰고 worker 를 분리해 띄운다. 느린 일(프롬프트용 git·대화 기록 읽기·검사 세션)은 모두 worker 몫이다.
function launchCheck({ root, cfg, payload, state, owned, triggers }) {
  const directory = jobsDirectory()
  ensurePrivateDirectory(directory)
  const jobsDir = realpathSync(directory)
  cleanOldJobFiles(jobsDir)
  const jobId = randomUUID()
  const head = headOf(root)
  const previous = state.verdicts.at(-1)
  const job = {
    jobId,
    root,
    runner: cfg.runner,
    model: selectModel(cfg, triggers.some((trigger) => trigger.type === 'step')),
    command: process.env.STATE_VERIFY_COMMAND || null,
    jobsDir,
    resultFile: join(jobsDir, `${jobId}.result.json`),
    transcriptSource: typeof payload.transcript_path === 'string' ? payload.transcript_path : null,
    head,
    triggerTypes: triggers.map((trigger) => trigger.type),
    promptInput: {
      branch: owned.branch,
      items: owned.items.slice(0, 3).map(slimItem),
      triggers,
      base: state.lastLaunchHead ?? state.firstHead ?? state.turnStartHead,
      head,
      previous: previous && previous.verdict !== 'on_track' ? previous : null,
    },
    timeoutMs: RUNNER_TIMEOUT_MS,
    createdAt: new Date().toISOString(),
  }
  const jobFile = join(jobsDir, `${jobId}.job.json`)
  writeFileSync(jobFile, `${JSON.stringify(job)}\n`, { mode: 0o600, flag: 'wx' })

  const env = { ...process.env, STATE_LEDGER_VERIFY_CHILD: '1' }
  for (const key of STRIPPED_ENV) delete env[key]
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'run', '--job', jobFile], { detached: true, stdio: 'ignore', cwd: root, env })
  child.on('error', () => { /* pid 가 없으면 아래에서 실패로 처리한다 */ })
  child.unref()
  if (!child.pid) {
    removeQuietly(jobFile)
    throw new Error('검사 worker 를 시작하지 못함')
  }
  state.running = { jobId, pid: child.pid, startedAt: new Date().toISOString(), triggers, model: job.model, head, jobFile, resultFile: job.resultFile }
  state.lastLaunchHead = head
}

// ---------- 서브커맨드 ----------

function turnStart(root, payload) {
  const cfg = verifyConfig(root)
  const sessionId = sessionIdOf(payload)
  if (!cfg || !sessionId) return ''
  const owned = currentOwned(root)
  if (!owned) return ''
  const path = statePath(root, sessionId)
  if (owned.items.length === 0) {
    // 소유 항목이 없는 턴은 세지 않는다. 이미 상태 파일이 있으면 단계 기준점만 비워 낡은 값과 비교하지 않게 한다.
    if (existsSync(path)) {
      const state = loadState(path, root, sessionId)
      state.ownedAtTurnStart = []
      state.turnStartHead = headOf(root)
      saveState(path, state)
    }
    return ''
  }
  const state = loadState(path, root, sessionId)
  const head = headOf(root)
  state.turnCount += 1
  state.turnStartHead = head
  state.firstHead ??= head
  state.ownedAtTurnStart = ownedSnapshot(owned.items)
  reap(state)
  let output = ''
  const latest = state.verdicts.at(-1)
  if (latest && !latest.delivered && latest.verdict !== 'on_track') output = deliveryBlock(latest)
  for (const entry of state.verdicts) entry.delivered = true
  saveState(path, state)
  return output
}

function sessionStart(root, payload) {
  const cfg = verifyConfig(root)
  const sessionId = sessionIdOf(payload)
  if (!cfg || !sessionId || payload.source !== 'compact') return
  const owned = currentOwned(root)
  if (!owned || owned.items.length === 0) return
  const path = statePath(root, sessionId)
  const state = loadState(path, root, sessionId)
  state.pendingTriggers = mergeTriggers(state.pendingTriggers, [{ type: 'compact', at: new Date().toISOString() }])
  saveState(path, state)
}

function stop(root, payload) {
  const cfg = verifyConfig(root)
  const sessionId = sessionIdOf(payload)
  if (!cfg || !sessionId) return null
  const owned = currentOwned(root)
  if (!owned || owned.items.length === 0) return null
  const path = statePath(root, sessionId)
  const state = loadState(path, root, sessionId)
  const messages = []

  for (const warning of cfg.warnings) {
    if (state.warned[warning.key]) continue
    state.warned[warning.key] = true
    messages.push(warning.text)
  }

  reap(state)
  const acted = actOnLatest(state, payload)
  messages.push(...acted.messages)

  const snapshot = ownedSnapshot(owned.items)
  const fresh = []
  const changes = stepChanges(state.ownedAtTurnStart, snapshot)
  if (changes.length > 0) fresh.push({ type: 'step', changes })
  // 같은 턴의 다음 Stop(차단 뒤 재진입 등)이 같은 변경을 다시 계기로 삼지 않게 기준점을 옮긴다.
  state.ownedAtTurnStart = snapshot
  if (cfg.every > 0 && state.turnCount > 0 && state.turnCount % cfg.every === 0 && state.periodicTurn !== state.turnCount) {
    fresh.push({ type: 'periodic', turn: state.turnCount, every: cfg.every })
    state.periodicTurn = state.turnCount
  }
  const all = mergeTriggers(state.pendingTriggers, fresh)
  if (state.running || all.length === 0) {
    state.pendingTriggers = all
  } else {
    try {
      launchCheck({ root, cfg, payload, state, owned, triggers: all })
      state.pendingTriggers = []
    } catch (error) {
      state.pendingTriggers = []
      messages.push(`STATE 독립 검증 시작 실패: ${clip(error.message, 300)}`)
    }
  }
  saveState(path, state)

  if (acted.block) return { decision: 'block', reason: acted.block, systemMessage: messages.join('\n') }
  return messages.length > 0 ? { systemMessage: messages.join('\n') } : null
}

async function main() {
  const [command, ...rest] = process.argv.slice(2)
  if (command === 'run') {
    await runWorker(rest)
    return
  }
  if (!['turn-start', 'session-start', 'stop'].includes(command)) {
    process.stderr.write('usage: state-verify.mjs turn-start|session-start|stop|run --job <file>\n')
    process.exitCode = 2
    return
  }
  const payload = readPayload()
  try {
    const root = projectRoot()
    if (command === 'turn-start') {
      const text = turnStart(root, payload)
      if (text) process.stdout.write(`${text}\n`)
    } else if (command === 'session-start') {
      sessionStart(root, payload)
    } else {
      const result = stop(root, payload)
      if (result) process.stdout.write(`${JSON.stringify(result)}\n`)
    }
  } catch (error) {
    if (command === 'stop') {
      process.stdout.write(`${JSON.stringify({ systemMessage: `STATE 독립 검증 오류: ${clip(error.message, 380)}` })}\n`)
    } else {
      process.stderr.write(`${error.message}\n`)
      process.exitCode = 1
    }
  }
}

const invoked = process.argv[1] ? realpathSync(process.argv[1]) : null
if (invoked && invoked === realpathSync(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  })
}
