---
name: dependency-scanning
description: 의존성 lockfile 변경 후 또는 배포 전 invoke. npm/pnpm audit 으로 high/critical CVE 를 검출.
metadata:
  role: audit
  scope: project
  source: stack-backend-python/skills/dependency-scanning
---

# dependency-scanning — 의존성 안전성 audit (CVE)

## 검증 대상 invariant

`<api-app>` 의 의존성 CVE 위험:

- **CVE** — `pnpm audit --audit-level=high` 가 high/critical 취약점 0개

## 실행

```bash
# npm/pnpm audit
cd <api-app> && pnpm audit --audit-level=high 2>&1 | tail -20
```

## 통과 기준

- `pnpm audit` exit code = 0 (high/critical 0)

## 위반 시 조치

### CVE 위반

```bash
# 해결책 우선순위
pnpm update <package>           # patch 가능하면 minor/patch bump
pnpm audit --fix                # 자동 해결 시도
# 또는 package.json 의 overrides 로 transitive 강제
```

수동 검토:
- vulnerable 패키지가 runtime 인지 devDependency 인지 (devDeps 면 위험도 낮음)
- 다음 release ETA — 정해진 일정 안에 무력화 못 하면 mitigation (입력 제한 / 우회) 도 검토

---

## audit 이 커버하지 않는 것

- 패키지 license 검증 → 별도 license audit
- bundle size 폭증 → deploy 전 체크의 runtime dry-run 단계 (instance 측 project-local skill 참조)
- runtime 동작 (의존성이 실제 동작하는가) → runtime 검증 (instance 측 project-local skill 참조)

## Package manager matrix

본 skill 은 pnpm / npm / yarn / bun 모두 지원. 다음 detection 으로 활성 manager 결정:

| Lockfile | Manager | Install (CI) | Audit |
|----------|---------|--------------|-------|
| `pnpm-lock.yaml` | pnpm | `pnpm install --frozen-lockfile` | `pnpm audit --prod` |
| `package-lock.json` | npm | `npm ci` | `npm audit --omit=dev` |
| `yarn.lock` | yarn | `yarn install --frozen-lockfile` | `yarn npm audit --recursive` |
| `bun.lockb` | bun | `bun install --frozen-lockfile` | `bun audit` |

## Lockfile 정책

- [ ] **Lockfile 단일 SoT**: 위 lockfile 중 정확히 1개만 존재. 둘 이상 발견 시 fail
- [ ] **Lockfile 커밋 강제**: `.gitignore` 에 lockfile 패턴 없음 검증
- [ ] **Frozen install (CI)**: 모든 CI install 명령이 frozen / `--frozen-lockfile` flag

## Supply-chain hardening

- [ ] **`overrides` / `resolutions` 사용**: transitive 의존성 강제 버전 가능
- [ ] **CVE 차단 임계**: critical / high CVE 발견 시 CI fail. medium 이하는 warning
- [ ] **License 화이트리스트**: GPL-3.0 / AGPL-3.0 등 incompatible license 차단 (선택)
- [ ] **Postinstall script 차단**: `pnpm install --ignore-scripts` 권장. exception 은 명시적 allowlist

## Runtime smoke

설치 후 boot smoke test:

```bash
# import all entry points
node -e 'require("./<api-app>/dist/index.js")'
```

설치만 성공해도 런타임에서 module not found / native binding 실패 가능 → import 검증 필수

## 차단해야 할 failure mode

| 패턴 | 위험 | 차단 방법 |
|------|------|-----------|
| Lockfile 미커밋 | reproducible build 불가, 의존성 drift | .gitignore 검증 |
| `npm install` (non-ci) | lockfile 갱신 → 의도치 않은 버전 변경 | `npm ci` 강제 |
| postinstall script 무검증 | malicious package 코드 실행 | `--ignore-scripts` + allowlist |
| Lockfile 둘 이상 | 두 manager 동시 사용 → 상태 분리 | acceptance-check 에서 검증 |
