import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const KINDS = [
  ['node 초기화', /node가 PATH에 없어/u],
  ['python3 초기화', /python3가 PATH에 없어/u],
  ['설정 초기화', /STATE 설정 거부/u],
  ['검사 범위 초기화', /알 수 없는 STATE_CHECK_AREA/u],
  ['검사 초기화', /(?:Error:|실행 실패)/u],
  ['브랜치 소멸', /브랜치 소멸/u],
  ['머지된 브랜치', /이미 .+ 에 머지됨/u],
  ['유령 브랜치', /유령 브랜치/u],
  ['라우팅', /라우팅 끊김|인덱스에 없음|필수 STATE 인덱스 소실/u],
  ['hash', /hash 불일치/u],
  ['만료', /expires=.+ 경과/u],
  ['크기', /(?:파일|detail|줄) cap|## 현재 \d+B \(cap/u],
  ['frontmatter', /frontmatter/u],
  ['WIP', /§[1-4] .+cap .+초과/u],
  ['인덱스·섹션', /heading 없음|id .+위반|id 토큰|id 없는 항목|'## 현재' 섹션 없음/u],
  ['기타', /[\s\S]/u],
]

function sample(text) {
  const characters = [...text]
  return characters.length > 160 ? `${characters.slice(0, 159).join('')}…` : text
}

function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`
}

export function summarizeStateWarnings(text, { projectRoot, pluginRoot }) {
  // checker 끝의 집계문은 개별 경고가 아니다. 두 checker의 동일 경고도 한 번만 센다.
  const lines = text.split(/\r?\n/u)
    .map((line) => line.trim().replace(/^WARN:\s*/u, ''))
    .filter((line) => line && !/^STATE 정합 \d+ 건 \(구조 \d+ · 크기 \d+\)\./u.test(line))
  const unique = [...new Set(lines)].sort()
  if (unique.length === 0) return { initialization: '', summary: '' }

  const groups = new Map(KINDS.map(([kind]) => [kind, []]))
  for (const line of unique) {
    const [kind] = KINDS.find(([, pattern]) => pattern.test(line))
    groups.get(kind).push(line)
  }
  const initialization = [...groups].filter(([kind, items]) => kind.endsWith('초기화') && items.length)
  const root = shellQuote(projectRoot)
  const commands = ['check-state-branch-sync.sh', 'check-state-wip-cap.sh']
    .map((filename) => `HOOK_PROJECT_DIR=${root} bash ${shellQuote(resolve(pluginRoot, 'scripts', filename))}`)
  return {
    initialization: initialization.length
      ? ['=== STATE 검사 초기화 경고 ===', ...initialization
        .map(([kind, items]) => `- ${kind}: ${items.length}건 — 대표: ${sample(items[0])}`)].join('\n')
      : '',
    summary: [
      '=== STATE 정합·예산 (warn-only) ===',
      `고유 경고 ${unique.length}건 · 동일 경고 중복 ${lines.length - unique.length}건 제거`,
      ...[...groups].filter(([kind, items]) => !kind.endsWith('초기화') && items.length)
        .map(([kind, items]) => `- ${kind}: ${items.length}건 — 대표: ${sample(items[0])}`),
      '전체 경고 다시 조회 (현재 checkout):',
      ...commands,
    ].join('\n'),
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.stdout.write(JSON.stringify(summarizeStateWarnings(readFileSync(0, 'utf8'), {
    projectRoot: process.argv[2],
    pluginRoot: process.argv[3],
  })))
}
