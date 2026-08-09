#!/bin/bash
# STATE 인덱스·detail 의 구조·예산·라우팅 정합 검사 → warn (block 안 함).
# - 카테고리 항목 수 WIP cap + 4개 섹션 heading 존재
# - 인덱스 줄 자수·파일 바이트 (STATE 는 매 세션 전문 주입되므로 소비 단위로 잰다)
# - 인덱스 [id] ↔ docs/state/<area>/<id>.md 존재 (양방향 — lazy loading 라우팅 무결성) + id 자수·문자집합
# - §1·§2·§4 id 필수 (id 없는 줄은 §3 placeholder 만 허용)
# - detail frontmatter: 존재·id/area 경로 일치·필수 필드(owner·branch·touched)·hash(훅 우회 편집 감지)
#   ·expires 경과·§1 owner·'## 현재' 필수·파일 크기
#
# 프로젝트 설정: 루트 `.staterc` (선택) — STATE_INDEXES="STATE.md apps/api/STATE.md" 식.
# area 규칙: 루트 STATE.md → root, 그 외 → 부모 디렉토리 이름 (apps/api/STATE.md → api).

set -u

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
root="${HOOK_PROJECT_DIR:-${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}}"
cd "$root" 2>/dev/null || exit 0

if ! command -v node >/dev/null 2>&1; then
  echo "WARN: node가 PATH에 없어 STATE_INDEXES를 안전하게 검증하지 못함" >&2
  [ "${STATE_CHECK_STRICT:-0}" = "1" ] && exit 1
  exit 0
fi
if ! state_indexes=$(HOOK_PROJECT_DIR="$root" node "$script_dir/hooks/state-config.mjs" indexes 2>&1); then
  echo "WARN: STATE 설정 거부: ${state_indexes:0:400}" >&2
  [ "${STATE_CHECK_STRICT:-0}" = "1" ] && exit 1
  exit 0
fi
TARGET_AREA="${STATE_CHECK_AREA:-}"

if [ -n "$TARGET_AREA" ]; then
  known=0
  while IFS= read -r configured_index; do
    [ -n "$configured_index" ] || continue
    case "$configured_index" in
      STATE.md) configured_area=root ;;
      *) configured_area=$(basename "$(dirname "$configured_index")") ;;
    esac
    [ "$configured_area" = "$TARGET_AREA" ] && known=1
  done <<EOF
$state_indexes
EOF
  if [ "$known" -ne 1 ]; then
    echo "WARN: 알 수 없는 STATE_CHECK_AREA=$TARGET_AREA" >&2
    exit 2
  fi
fi

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

while IFS= read -r f; do
  [ -n "$f" ] || continue
  case "$f" in
    STATE.md) area=root ;;
    *) area=$(basename "$(dirname "$f")") ;;
  esac
  [ -z "$TARGET_AREA" ] || [ "$TARGET_AREA" = "$area" ] || continue
  if [ ! -f "$f" ]; then
    warn "$f 없음 — 필수 STATE 인덱스 소실"
    continue
  fi

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
    owner=$(awk '/^---$/{n++; next} n==1' "$df" | sed -nE 's/^owner: (.+)$/\1/p' | head -1)
    case "$owner" in
      ""|-|—) warn "$df — §1 활성인데 유효한 frontmatter owner 없음" ;;
    esac
  done

  # §1·§2·§4 는 id 필수 (id 없는 줄은 §3 placeholder 만 허용), 토큰 문자집합은 [a-z0-9-]
  while IFS= read -r line; do
    case "$line" in
      "- ["*)
        tok=${line#- [}; tok=${tok%%]*}
        printf '%s' "$tok" | grep -qE '^[a-z0-9-]+$' || warn "$f \"${line:0:36}…\" id 토큰 '[$tok]' 문자집합 위반 ([a-z0-9-]만)"
        ;;
      "- "*)
        warn "$f \"${line:0:36}…\" id 없는 항목 (§3 placeholder 만 허용)"
        ;;
    esac
  done < <(awk '/^## /{ in_sec = ($0 ~ /^## [124]\./); next } in_sec' "$f" | grep '^- ' || true)

  if [ -d "docs/state/$area" ]; then
    for df in docs/state/$area/*.md; do
      [ -e "$df" ] || continue
      id=$(basename "$df" .md)
      grep -q "^- \[$id\]" "$f" || warn "docs/state/$area/$id.md — $f 인덱스에 없음 (고아 — 인덱스 등재 또는 archive)"
    done
  fi
done <<EOF
$state_indexes
EOF

# detail frontmatter·hash·expires·크기 — stamp 훅과 동일한 파싱(python)으로 검사
if ! command -v python3 >/dev/null 2>&1; then
  warn "python3가 PATH에 없어 detail 구조·hash 검사를 실행하지 못함"
elif [ -d docs/state ]; then
  while IFS= read -r w; do
    [ -n "$w" ] && warn "$w"
  done < <(TODAY=$(date +%Y-%m-%d) DETAIL_BYTE_CAP=$DETAIL_BYTE_CAP TARGET_AREA=$TARGET_AREA python3 - <<'PYEOF'
import glob, hashlib, os, re

today = os.environ["TODAY"]
cap = int(os.environ["DETAIL_BYTE_CAP"])
target_area = os.environ.get("TARGET_AREA", "")
for p in sorted(glob.glob("docs/state/*/*.md")):
    if target_area and p.split("/")[-2] != target_area:
        continue
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
    for k in ("owner", "branch", "touched"):
        if not re.search(rf"^{k}: .+$", fm, re.M):
            print(f"{p} frontmatter {k} 없음 (필수)")
    if not re.search(r"^## 현재$", body, re.M):
        print(f"{p} '## 현재' 섹션 없음 (필수)")
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
  if [ "${STATE_CHECK_STRICT:-0}" = "1" ]; then
    echo "WARN: STATE 정합 $violations 건. strict 검사 실패." >&2
    exit 1
  fi
  echo "WARN: STATE 정합 $violations 건. commit 은 진행 (exit 0)." >&2
fi

exit 0
