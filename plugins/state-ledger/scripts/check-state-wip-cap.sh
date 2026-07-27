#!/bin/bash
# STATE 인덱스·detail 의 구조·예산·라우팅 정합 검사 → warn (block 안 함).
# - 카테고리 항목 수 WIP cap + 4개 섹션 heading 존재
# - 인덱스 줄 자수·파일 바이트 (STATE 는 매 세션 전문 주입되므로 소비 단위로 잰다)
# - 인덱스 [id] ↔ docs/state/<area>/<id>.md 존재 (양방향 — lazy loading 라우팅 무결성) + id 자수
# - detail frontmatter: 존재·id/area 경로 일치·hash(훅 우회 편집 감지)·expires 경과·§1 owner·파일 크기
#
# 프로젝트 설정: 루트 `.staterc` (선택) — STATE_INDEXES="STATE.md apps/api/STATE.md" 식.
# area 규칙: 루트 STATE.md → root, 그 외 → 부모 디렉토리 이름 (apps/api/STATE.md → api).

set -u

root="${HOOK_PROJECT_DIR:-${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}}"
cd "$root" 2>/dev/null || exit 0
[ -f .staterc ] && . ./.staterc
STATE_INDEXES="${STATE_INDEXES:-STATE.md}"

CAPS_ACTIVE=6
CAPS_NEXT=6
CAPS_FUTURE=5
CAPS_UNRESOLVED=8
LINE_CHAR_CAP=200
FILE_BYTE_CAP=4096
DETAIL_BYTE_CAP=16384

violations=0
warn() { echo "WARN: $1" >&2; violations=$((violations+1)); }

count_section() {
  awk -v sec="$2" '
    $0 ~ "^## " sec { in_sec=1; next }
    in_sec && /^## / { in_sec=0 }
    in_sec && /^- / { count++ }
    END { print count+0 }
  ' "$1"
}

for f in $STATE_INDEXES; do
  [ -f "$f" ] || continue
  case "$f" in
    STATE.md) area=root ;;
    *) area=$(basename "$(dirname "$f")") ;;
  esac

  active=$(count_section "$f" "1\\. 활성")
  next=$(count_section "$f" "2\\. 다음")
  future=$(count_section "$f" "3\\. 미래")
  unresolved=$(count_section "$f" "4\\. 미해결")

  [ "$active" -gt "$CAPS_ACTIVE" ] && warn "$f §1 활성 = $active (cap $CAPS_ACTIVE 초과)"
  [ "$next" -gt "$CAPS_NEXT" ] && warn "$f §2 다음 = $next (cap $CAPS_NEXT 초과)"
  [ "$future" -gt "$CAPS_FUTURE" ] && warn "$f §3 미래 = $future (cap $CAPS_FUTURE 초과)"
  [ "$unresolved" -gt "$CAPS_UNRESOLVED" ] && warn "$f §4 미해결 = $unresolved (cap $CAPS_UNRESOLVED 초과)"

  for n in 1 2 3 4; do
    grep -qE "^## $n\\." "$f" || warn "$f §$n heading 없음 (섹션 소실·개명 — cap 검사 무력화)"
  done

  bytes=$(wc -c < "$f")
  [ "$bytes" -gt "$FILE_BYTE_CAP" ] && warn "$f ${bytes}B (파일 cap ${FILE_BYTE_CAP}B 초과) — 서사는 docs/state/$area/<id>.md 로"

  while IFS= read -r line; do
    n=${#line}
    [ "$n" -gt "$LINE_CHAR_CAP" ] && warn "$f \"${line:0:36}…\" ${n}자 (줄 cap ${LINE_CHAR_CAP}자 초과) — 서사는 detail 파일로"
  done < <(grep '^- ' "$f" || true)

  for id in $(sed -nE 's/^- \[([a-z0-9-]+)\].*/\1/p' "$f"); do
    n=${#id}
    if [ "$n" -lt 3 ] || [ "$n" -gt 12 ]; then warn "$f [$id] id ${n}자 (계약 3–12자 위반)"; fi
    [ -f "docs/state/$area/$id.md" ] || warn "$f [$id] — docs/state/$area/$id.md 없음 (라우팅 끊김)"
  done

  for id in $(awk '/^## /{ in_sec = ($0 ~ /^## 1\./); next } in_sec' "$f" | sed -nE 's/^- \[([a-z0-9-]+)\].*/\1/p'); do
    df="docs/state/$area/$id.md"
    [ -f "$df" ] || continue
    awk '/^---$/{n++; next} n==1' "$df" | grep -qE '^owner: .+' || warn "$df — §1 활성인데 frontmatter owner 없음"
  done

  if [ -d "docs/state/$area" ]; then
    for df in docs/state/$area/*.md; do
      [ -e "$df" ] || continue
      id=$(basename "$df" .md)
      grep -q "^- \[$id\]" "$f" || warn "docs/state/$area/$id.md — $f 인덱스에 없음 (고아 — 인덱스 등재 또는 archive)"
    done
  fi
done

# detail frontmatter·hash·expires·크기 — stamp 훅과 동일한 파싱(python)으로 검사
if command -v python3 >/dev/null 2>&1 && [ -d docs/state ]; then
  while IFS= read -r w; do
    [ -n "$w" ] && warn "$w"
  done < <(TODAY=$(date +%Y-%m-%d) DETAIL_BYTE_CAP=$DETAIL_BYTE_CAP python3 - <<'PYEOF'
import glob, hashlib, os, re

today = os.environ["TODAY"]
cap = int(os.environ["DETAIL_BYTE_CAP"])
for p in sorted(glob.glob("docs/state/*/*.md")):
    size = os.path.getsize(p)
    if size > cap:
        print(f"{p} {size}B (detail cap {cap}B 초과) — 완료 서사는 커밋으로, 원장은 WHY·실측만")
    text = open(p, encoding="utf-8").read()
    m = re.match(r"^---\n(.*?)\n---\n(.*)$", text, re.S)
    if not m:
        print(f"{p} frontmatter 없음 — stamp·branch-sync 가 전부 건너뛴다")
        continue
    fm, body = m.group(1), m.group(2)
    area, fname = p.split("/")[-2], p.split("/")[-1][:-3]
    fid = re.search(r"^id: (\S+)$", fm, re.M)
    farea = re.search(r"^area: (\S+)$", fm, re.M)
    if not fid or fid.group(1) != fname:
        print(f"{p} frontmatter id={fid.group(1) if fid else '없음'} — 파일명과 불일치")
    if not farea or farea.group(1) != area:
        print(f"{p} frontmatter area={farea.group(1) if farea else '없음'} — 경로와 불일치")
    h = re.search(r"^hash: (\S+)$", fm, re.M)
    real = hashlib.sha256(body.encode("utf-8")).hexdigest()[:8]
    if not h or h.group(1) != real:
        print(f"{p} hash 불일치 (기록 {h.group(1) if h else '없음'} ≠ 실제 {real}) — 훅 우회 편집, Edit 재저장 또는 재스탬프")
    exp = re.search(r"^expires: (\S+)$", fm, re.M)
    if exp and exp.group(1) <= today:
        print(f"{p} expires={exp.group(1)} 경과 — 갱신 또는 archive")
PYEOF
  )
fi

if [ "$violations" -gt 0 ]; then
  echo "WARN: STATE 정합 $violations 건. commit 은 진행 (exit 0)." >&2
fi

exit 0
