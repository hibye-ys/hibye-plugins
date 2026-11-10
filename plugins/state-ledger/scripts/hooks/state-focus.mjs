#!/usr/bin/env node
// 현재 브랜치가 소유한 STATE 항목(§1 활성·§2 다음)의 목표·지금 단계·다음 단계·절차(handoff)를 매 턴 다시 주입한다.
// 긴 작업이 컨텍스트 압축 뒤 목표와 정해진 단계 순서를 잃고 계획 밖 작업을 제안하는 문제를 막기 위한 것이다.
// 소유 = detail frontmatter `branch:` 가 체크아웃의 현재 브랜치와 같은 항목. 토큰 비용보다 목표 유지를 우선한다.
//   node state-focus.mjs reminder   → 알림 텍스트 stdout (없으면 출력 없음). 실패는 stderr + 종료 코드 1.

import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { projectRoot, readStaterc, stateConfig } from './state-config.mjs'
import { detailEntries, indexSource, parseFrontmatter } from './state-index.mjs'

export const MAX_ITEMS = 3
export const MAX_REMINDER_BYTES = 3000
const SECTION_LABEL = { active: '§1 활성', next: '§2 다음' }
const SECTION_ORDER = { active: 0, next: 1 }
const NONE_VALUES = new Set(['', '-', '—'])
// 크기 예산을 넘으면 필드·발췌 길이를 단계적으로 줄인다.
const TIERS = [
  { field: 200, excerpt: 600 },
  { field: 120, excerpt: 300 },
  { field: 80, excerpt: 150 },
  { field: 50, excerpt: 0 },
]

export const INSTRUCTION = '작업을 제안·시작·전환하기 전에 각 항목의 handoff(없으면 detail ## 현재)에서 지금·다음 단계 절과 끝 조건을 다시 읽고, 제안에 그 절 제목이나 줄을 인용한다. '
  + '계획 순서를 벗어나거나 범위를 바꾸려면 먼저 사용자에게 묻는다 — 단, 이번 턴 사용자의 명시 지시가 우선한다(계획과 어긋나면 그 사실만 한 줄 알리고 따른다). '
  + '단계가 바뀌면 해당 항목 detail 의 step·next_step(과 status)을 바꿔 쓴다.'

function bytes(text) {
  return Buffer.byteLength(text, 'utf8')
}

// 문자(code point) 경계에서 자른다. 바이트가 아니라 글자 수 기준.
function clip(text, max) {
  const chars = [...text]
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : text
}

// 바이트 예산 안에서 문자 경계로 자른다.
function clipBytes(text, max) {
  if (bytes(text) <= max) return text
  const chars = [...text]
  let lo = 0
  let hi = chars.length
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (bytes(`${chars.slice(0, mid).join('')}…`) <= max) lo = mid
    else hi = mid - 1
  }
  return `${chars.slice(0, lo).join('')}…`
}

export function currentBranch(root) {
  const env = { ...process.env }
  for (const key of ['GIT_DIR', 'GIT_COMMON_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']) delete env[key]
  try {
    const out = execFileSync('git', ['symbolic-ref', '--quiet', '--short', 'HEAD'], { cwd: root, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    return out.trim() || null
  } catch (error) {
    if (error.status === 1) return null // detached HEAD
    throw error
  }
}

function readDetailText(root, path) {
  try {
    const absolute = join(root, path)
    const info = lstatSync(absolute)
    if (!info.isFile() || info.isSymbolicLink() || info.size > 1024 * 1024) return null
    return readFileSync(absolute, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

// manual 원천: 설정된 각 인덱스의 `## 1.`/`## 2.` 아래 `- [id]` 줄 (check-state-branch-sync.sh ① 와 같은 규칙).
function manualCandidates(root, config) {
  const found = []
  for (const index of config.indexes) {
    const area = config.areaByIndex.get(index)
    const text = readDetailText(root, index)
    if (text === null) continue
    let section = null
    for (const line of text.split('\n')) {
      const heading = /^## (\d)\./.exec(line)
      if (heading) {
        section = heading[1] === '1' ? 'active' : heading[1] === '2' ? 'next' : null
        continue
      }
      const id = section && /^- \[([a-z0-9-]+)\]/.exec(line)?.[1]
      if (!id) continue
      const path = `docs/state/${area}/${id}.md`
      const detail = readDetailText(root, path)
      if (detail === null) continue
      // manual 원천의 title·status 정본은 인덱스 줄이다 (`- [id] 제목 — 상태`). frontmatter 값이 있으면 그것을 쓴다.
      const [lineTitle, ...lineStatus] = line.replace(/^- \[[^\]]+\]\s*/, '').split(' — ')
      const meta = parseFrontmatter(detail)
      found.push({ area, id, path, meta, section, title: meta?.title ?? lineTitle, status: meta?.status ?? lineStatus.join(' — ') })
    }
  }
  return found
}

function frontmatterCandidates(root, config) {
  return detailEntries(root, null, config)
    .filter((entry) => entry.meta && (entry.section === 'active' || entry.section === 'next'))
    .map(({ area, id, path, meta, section }) => ({ area, id, path, meta, section, title: meta.title ?? '', status: meta.status ?? '' }))
}

// 현재 브랜치가 소유한 §1·§2 항목: 활성 먼저, 같은 섹션 안에서는 touched 최근순.
export function ownedItems(root, branch, config = stateConfig(root)) {
  const candidates = indexSource(root) === 'frontmatter' ? frontmatterCandidates(root, config) : manualCandidates(root, config)
  const seen = new Set()
  return candidates
    .filter((item) => item.meta?.branch === branch)
    .filter((item) => !seen.has(`${item.area}/${item.id}`) && seen.add(`${item.area}/${item.id}`))
    .sort((a, b) => SECTION_ORDER[a.section] - SECTION_ORDER[b.section]
      || (b.meta.touched ?? '').localeCompare(a.meta.touched ?? '')
      || a.id.localeCompare(b.id))
}

function currentSection(text) {
  const lines = text.replace(/^---\n[\s\S]*?\n---\n/, '').split('\n')
  const start = lines.indexOf('## 현재')
  if (start < 0) return []
  const end = lines.findIndex((line, i) => i > start && line.startsWith('## '))
  return lines.slice(start + 1, end < 0 ? lines.length : end)
}

// `## 현재` 앞부분을 줄 경계로 limit 바이트까지.
export function currentExcerpt(text, limit) {
  const lines = currentSection(text)
  while (lines.length && lines[0].trim() === '') lines.shift()
  const picked = []
  let used = 0
  for (const line of lines) {
    const cost = bytes(line) + 1
    if (used + cost > limit) {
      if (picked.length === 0) picked.push(clipBytes(line, limit))
      break
    }
    picked.push(line)
    used += cost
  }
  while (picked.length && picked.at(-1).trim() === '') picked.pop()
  return picked
}

function value(meta, key) {
  const raw = meta?.[key]
  return raw && !NONE_VALUES.has(raw) ? raw : ''
}

function renderItem(root, item, tier) {
  const { meta } = item
  const lines = [`[${item.id}] ${clip(item.title, tier.field)} — ${item.path} (${SECTION_LABEL[item.section]})`]
  const goal = value(meta, 'goal')
  const step = value(meta, 'step')
  const next = value(meta, 'next_step')
  if (goal) lines.push(`- 목표·완성 기준: ${clip(goal, tier.field)}`)
  if (step) lines.push(`- 지금 단계: ${clip(step, tier.field)}`)
  if (next) lines.push(`- 다음 단계: ${clip(next, tier.field)}`)
  if (!goal || !step || !next) lines.push(`- 상태: ${clip(item.status, tier.field)}`)
  const handoff = value(meta, 'handoff')
  if (handoff) {
    const missing = !existsSync(resolve(root, handoff.split('#')[0]))
    lines.push(`- 절차(handoff): ${clip(handoff, tier.field)}${missing ? ' (파일 없음)' : ''}`)
  } else {
    lines.push('- 절차(handoff): 없음 — detail ## 현재 가 절차 정본')
  }
  if (!goal && !step && !next && tier.excerpt > 0) {
    const excerpt = currentExcerpt(readDetailText(root, item.path) ?? '', tier.excerpt)
    if (excerpt.length) {
      lines.push('- detail ## 현재 앞부분 (frontmatter goal·step·next_step 을 적으면 이 발췌 대신 세 줄이 실린다):')
      lines.push(...excerpt.map((line) => `  ${line}`))
    }
  }
  return lines.join('\n')
}

function render(root, branch, items, tier) {
  const shown = items.slice(0, MAX_ITEMS)
  const parts = [`=== STATE 현재 작업 — 브랜치 ${branch} (매 턴 다시 주입) ===`, ...shown.map((item) => renderItem(root, item, tier))]
  if (items.length > shown.length) {
    parts.push(`외 ${items.length - shown.length}개: ${items.slice(MAX_ITEMS).map((item) => `[${item.id}]`).join(' ')}`)
  }
  return parts.join('\n')
}

export function buildReminder(root, branch, items) {
  if (items.length === 0) return ''
  const budget = MAX_REMINDER_BYTES - bytes(INSTRUCTION) - 2
  let body = ''
  for (const tier of TIERS) {
    body = render(root, branch, items, tier)
    if (bytes(body) <= budget) break
  }
  return `${clipBytes(body, budget)}\n\n${INSTRUCTION}`
}

// 기본 브랜치 판정. BASE 가 `origin/main` 같은 원격 ref 로 주어질 수 있다 — refs/remotes/<BASE> 가 실제로 있을 때만
// 첫 `<remote>/` 마디를 떼고 비교한다 (로컬 기본 브랜치 `release/2026` 같은 이름은 자르지 않는다).
export function isBaseBranch(root, branch, base) {
  if (branch === base) return true
  const slash = base.indexOf('/')
  if (slash <= 0 || branch !== base.slice(slash + 1)) return false
  const env = { ...process.env }
  for (const key of ['GIT_DIR', 'GIT_COMMON_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']) delete env[key]
  try {
    execFileSync('git', ['show-ref', '--verify', '--quiet', `refs/remotes/${base}`], { cwd: root, env, stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

// 현재 브랜치의 소유 항목 {branch, items}. 기본 브랜치·detached HEAD 는 소유를 따지지 않으므로 null (items 가 비어 있을 수는 있다).
// 독립 검증(state-verify.mjs)도 같은 소유 판정을 쓴다.
export function currentOwned(root) {
  const branch = currentBranch(root)
  if (!branch) return null
  if (isBaseBranch(root, branch, readStaterc(root, 'STATE_DEFAULT_BRANCH') || 'main')) return null
  return { branch, items: ownedItems(root, branch) }
}

// 알림 텍스트 또는 ''. 기본 브랜치·detached HEAD·소유 항목 없음은 조용히 ''.
export function focusReminder(root) {
  const owned = currentOwned(root)
  return owned ? buildReminder(root, owned.branch, owned.items) : ''
}

function main() {
  if (process.argv[2] !== 'reminder') {
    process.stderr.write('usage: state-focus.mjs reminder\n')
    process.exitCode = 2
    return
  }
  const text = focusReminder(projectRoot())
  if (text) process.stdout.write(`${text}\n`)
}

const invoked = process.argv[1] ? realpathSync(process.argv[1]) : null
if (invoked && invoked === realpathSync(fileURLToPath(import.meta.url))) {
  try { main() } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1 }
}
