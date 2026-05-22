---
name: electron-renderer-isolation
description: Electron 렌더러 보안 invariant 검출 — nodeIntegration / contextIsolation / sandbox / webSecurity / executeJavaScript 5 옵션. contextBridge + IPC allowlist 패턴 권장. electronegativity + @electron/lint-roller 위임.
metadata:
  priority: 5
  docs:
    - "https://www.electronjs.org/docs/latest/tutorial/security"
    - "https://www.electronjs.org/docs/latest/tutorial/context-isolation"
    - "https://www.electronjs.org/docs/latest/tutorial/sandbox"
    - "https://www.electronjs.org/docs/latest/api/context-bridge"
  pathPatterns:
    - 'electron/**/*.{ts,tsx,js,jsx,cjs,mjs}'
    - 'electron-main/**/*.{ts,tsx,js}'
    - 'electron-preload/**/*.{ts,tsx,js}'
    - 'src/main/**/*.{ts,js}'
    - 'src/preload/**/*.{ts,js}'
    - 'src/electron/**/*.{ts,tsx,js}'
    - '**/main.{ts,js}'
    - '**/preload.{ts,js}'
    - '**/electron-builder.{json,yml,yaml,js,ts}'
  bashPatterns: []
  importPatterns:
    - 'electron'
    - '@electron/remote'
    - '@electron-toolkit/preload'
    - '@electron-toolkit/utils'
    - 'electron-builder'
validate:
  - pattern: 'nodeIntegration\s*:\s*true'
    message: 'nodeIntegration: true — 렌더러에 Node.js 권한 전체 노출. 절대 ✕. contextBridge 통해 안전한 API 만 노출.'
    severity: error
  - pattern: 'contextIsolation\s*:\s*false'
    message: 'contextIsolation: false — 프리로드 / 렌더러 컨텍스트 공유, prototype 오염 위험. Electron 12+ 의 기본값 true 유지.'
    severity: error
  - pattern: 'sandbox\s*:\s*false'
    message: 'sandbox: false — Chromium OS-level sandbox 비활성. 가능하면 true (Electron 20+ 기본값). preload 도 sandbox 호환 작성.'
    severity: error
  - pattern: 'webSecurity\s*:\s*false'
    message: 'webSecurity: false — same-origin policy 비활성. mixed content / CORS bypass 위험. 절대 ✕.'
    severity: error
  - pattern: 'webContents\.executeJavaScript\s*\([^)]*\$\{[^}]*\}'
    message: 'webContents.executeJavaScript() with template literal — 사용자 입력 inject 위험. literal string + 인수 전달 또는 IPC 통신 사용.'
    severity: warn
retrieval:
  aliases:
    - electron security
    - contextIsolation
    - nodeIntegration
    - contextBridge
    - IPC
    - preload
  intents:
    - secure electron app
    - configure BrowserWindow
    - expose API via contextBridge
    - validate electron settings
  entities:
    - BrowserWindow
    - webPreferences
    - contextBridge
    - ipcMain
    - ipcRenderer
    - preload
chainTo: []
---

# electron-renderer-isolation

**Electron 렌더러 = Chromium 기반 웹 환경 + Node 권한 가능**. 보안 핵심 = `contextIsolation: true` / `nodeIntegration: false` / `sandbox: true` / `webSecurity: true` + IPC allowlist. 본 skill 은 *5 옵션 검출 + contextBridge 패턴*. 깊은 검증은 `electronegativity` (13+ 옵션 자동 audit) + `@electron/lint-roller` 위임.

## When to apply

- 새 Electron `BrowserWindow` / `WebContentsView` 생성
- 기존 `webPreferences` 옵션 수정
- preload script 작성 / 갱신
- `contextBridge.exposeInMainWorld` 새 API 노출
- IPC handler (`ipcMain.handle` / `ipcMain.on`) 추가
- `webContents.executeJavaScript` 사용

## 핵심 원칙

### 1. contextIsolation: true (절대)

- Electron 12+ 의 default = `true`. 명시적으로 `false` 설정 ✕
- 프리로드와 렌더러 JavaScript context 격리 — prototype 오염 / global var pollute 방지
- contextBridge 가 *유일한* 통로

### 2. nodeIntegration: false (절대)

- 렌더러에 `require` / `process` / `Buffer` / `__dirname` 직접 노출 ✕
- 사용자 표시 콘텐츠가 Node API 호출 가능해짐 — RCE 위험
- Node 가 필요하면 *preload* 에서 contextBridge 로 *명시적 함수* 만

### 3. sandbox: true (권장)

- Chromium OS-level sandbox 활성 — 렌더러가 OS 자원 접근 차단
- Electron 20+ default = `true`. 옛 코드는 `false` 가능 — 명시적 활성화 권장
- preload 도 sandbox 호환 (Node 모듈 require ✕, ESM 사용 ✕ — `require('electron')` 만)

### 4. webSecurity: true (절대)

- same-origin policy 활성. `false` 시 CORS bypass / mixed content 허용 — XSS 확산
- 개발 시 임시 `false` 도 ✕ — 별도 dev server (Vite / Next dev) 사용

### 5. contextBridge 통한 명시적 API 노출

- `contextBridge.exposeInMainWorld('appAPI', { ... })` 안에 *정확한* 함수만
- promise return 의 IPC `ipcRenderer.invoke` 래핑
- 전체 `ipcRenderer` 노출 ✕ — 렌더러가 임의 채널 호출 가능해짐

### 6. IPC channel allowlist

- `ipcMain.handle('app:save-config', ...)` 같이 namespaced channel
- 채널 화이트리스트 (예: `const ALLOWED = new Set(['app:save-config', 'app:read-config'])`)
- payload 검증 (zod / valibot) 의무 — 렌더러 입력 신뢰 ✕

### 7. executeJavaScript 사용 자제

- `webContents.executeJavaScript(code)` 사용 시 코드 = literal string + parameter binding 만
- 절대 `executeJavaScript(\`fetch("\${userInput}")\`)` 같은 template literal injection ✕
- IPC 로 우회 가능하면 IPC 우선

### 8. @electron/remote 사용 ✕

- legacy `remote` 모듈 = 메인 프로세스 객체를 렌더러에 직접 노출 — 사실상 nodeIntegration 우회
- contextBridge + IPC 패턴으로 대체

## 도구 위임 (이 skill 의 진입점 역할)

- **정적 (전체 13+ 옵션)**: `electronegativity` — Electron 보안 audit CLI. CI 단계.
- **정적 (lint)**: `@electron/lint-roller` — Electron 권장 lint rules.
- **수동 audit**: BrowserWindow 옵션 코드 리뷰 — webPreferences 객체 명시 여부.
- **동적**: Electron Forge + `--show` flag 로 devtools 열어 `process` global 확인 (정상이면 `undefined`).

## 안티패턴 표

| 안티 | 교정 | 검출 |
|---|---|---|
| `nodeIntegration: true` | `contextBridge` + IPC | **validate (error)** |
| `contextIsolation: false` | default `true` 유지 | **validate (error)** |
| `sandbox: false` | default `true` 유지 + preload sandbox-compat | **validate (error)** |
| `webSecurity: false` | default `true` 유지 | **validate (error)** |
| `executeJavaScript(\`...\${x}...\`)` | literal + arg / IPC 우회 | **validate (warn)** |
| `contextBridge.exposeInMainWorld('all', ipcRenderer)` | 정확한 함수만 expose | 수동 |
| channel name allowlist 없음 | `ALLOWED` Set / namespace prefix | 수동 |
| payload 검증 없음 | zod / valibot schema | 수동 |
| `@electron/remote` 사용 | contextBridge + IPC | 수동 |
| `<webview>` element 사용 | `<iframe sandbox>` 또는 BrowserView | 수동 |
| `process.env` 렌더러 노출 | preload 에서 필요 값만 contextBridge | 수동 |

## BrowserWindow 안전 옵션 패턴

```ts
// main/index.ts
import { BrowserWindow } from 'electron'
import { join } from 'node:path'

function createMainWindow() {
  return new BrowserWindow({
    width: 1024,
    height: 768,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,   // default but explicit
      nodeIntegration: false,   // default but explicit
      sandbox: true,            // default Electron 20+ but explicit
      webSecurity: true,        // default but explicit
      // disable risky features
      experimentalFeatures: false,
      enableBlinkFeatures: '',
    },
  })
}
```

> 모든 옵션 *명시적으로* 적기 — Electron upgrade 시 default 변경에도 안전.

## contextBridge + IPC 패턴

```ts
// preload/index.ts
import { contextBridge, ipcRenderer } from 'electron'

const appAPI = {
  saveConfig: (config: AppConfig) => ipcRenderer.invoke('app:save-config', config),
  readConfig: (): Promise<AppConfig> => ipcRenderer.invoke('app:read-config'),
  onUpdate: (callback: (status: UpdateStatus) => void) => {
    const wrapped = (_: unknown, status: UpdateStatus) => callback(status)
    ipcRenderer.on('app:update-status', wrapped)
    return () => ipcRenderer.off('app:update-status', wrapped)
  },
}

contextBridge.exposeInMainWorld('appAPI', appAPI)
export type AppAPI = typeof appAPI
```

```ts
// main/ipc.ts
import { ipcMain } from 'electron'
import { z } from 'zod'

const ALLOWED_CHANNELS = new Set(['app:save-config', 'app:read-config'])

const ConfigSchema = z.object({
  theme: z.enum(['light', 'dark']),
  fontSize: z.number().int().min(8).max(72),
})

ipcMain.handle('app:save-config', async (_event, raw) => {
  const config = ConfigSchema.parse(raw)  // 입력 검증 의무
  await saveConfigToDisk(config)
  return { ok: true }
})
```

```tsx
// renderer (React)
declare global {
  interface Window {
    appAPI: import('../preload').AppAPI
  }
}

function Settings() {
  const save = async () => {
    await window.appAPI.saveConfig({ theme: 'dark', fontSize: 14 })
  }
  // ...
}
```

## CSP 헤더 (Electron 렌더러)

```ts
// main/index.ts — main window load 후
session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
  callback({
    responseHeaders: {
      ...details.responseHeaders,
      'Content-Security-Policy': [
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' https://api.example.com",
      ],
    },
  })
})
```

## 참조

- [Electron Security Checklist](https://www.electronjs.org/docs/latest/tutorial/security) — 13 옵션 정본
- [Context Isolation](https://www.electronjs.org/docs/latest/tutorial/context-isolation) · [Sandbox](https://www.electronjs.org/docs/latest/tutorial/sandbox)
- [contextBridge API](https://www.electronjs.org/docs/latest/api/context-bridge)
- [electronegativity](https://github.com/doyensec/electronegativity) — Electron audit CLI
- [@electron/lint-roller](https://github.com/electron/lint-roller) — Electron 권장 lint
- [@electron-toolkit/preload](https://github.com/alex8088/electron-toolkit) — preload 헬퍼
