---
name: a11y-dialog-pattern
description: Dialog / Modal / Popover / AlertDialog / Sheet 패턴 - focus trap + ESC + return focus + aria-modal + initial focus + scroll lock 6종 모두 자동인 라이브러리 위임 (Radix Dialog / React Aria Components). 자체 구현 검출 + 누락 패턴 검출.
metadata:
  priority: 4
  docs:
    - "https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/"
    - "https://www.radix-ui.com/primitives/docs/components/dialog"
    - "https://react-spectrum.adobe.com/react-aria/Dialog.html"
    - "https://developer.mozilla.org/en-US/docs/Web/HTML/Element/dialog"
  pathPatterns:
    - 'src/components/**/*.tsx'
    - 'src/components/**/*.jsx'
    - 'app/components/**/*.tsx'
    - 'app/components/**/*.jsx'
    - 'components/**/*.tsx'
    - 'components/**/*.jsx'
    - 'src/ui/**/*.tsx'
  bashPatterns: []
  importPatterns:
    - '@radix-ui/react-dialog'
    - '@radix-ui/react-alert-dialog'
    - '@radix-ui/react-popover'
    - 'react-aria-components'
    - 'react-aria'
    - '@headlessui/react'
validate:
  - pattern: 'role=["'']dialog["''][^>]*(?!.*aria-modal)'
    message: 'role="dialog" 사용 시 aria-modal 누락 — screen reader 가 modal 임을 인지 못 함. aria-modal="true" 추가 또는 Radix/React Aria 권장.'
    severity: warn
  - pattern: '<dialog\b(?![^>]*aria-labelledby)(?![^>]*aria-label\s*=)'
    message: 'native <dialog> 에 aria-labelledby / aria-label 누락 — Dialog 제목 미연결. <Dialog.Title> (Radix) 또는 aria-labelledby="..." 추가.'
    severity: warn
  - pattern: 'role=["'']dialog["''][^>]*(?!.*onKeyDown)(?!.*useFocusTrap)(?!.*FocusScope)'
    message: 'role="dialog" 자체 구현 — focus trap 코드 없음 (heuristic). Radix UI Dialog 또는 React Aria Components 의 Dialog 권장 (focus trap / ESC / return focus 자동).'
    severity: warn
retrieval:
  aliases:
    - dialog
    - modal
    - popover
    - alert dialog
    - sheet
  intents:
    - implement dialog
    - modal accessibility
    - focus trap
    - escape close
    - return focus
  entities:
    - Dialog
    - Modal
    - aria-modal
    - focus trap
    - Radix
    - React Aria
chainTo: []
---

# a11y-dialog-pattern

**Dialog / Modal / Popover 의 a11y 6종 요구사항** = focus trap + ESC close + Backdrop click + return focus + aria-modal + initial focus + scroll lock. 자체 구현 ✕ — 검증된 라이브러리 (Radix UI Dialog / React Aria Components) 위임. 본 skill 은 *원칙 + 라이브러리 패턴 + 안티패턴 검출* 만, 깊은 동적 검증은 `@axe-core/playwright` 위임.

## When to apply

- Dialog / Modal / AlertDialog / Sheet / Drawer 컴포넌트 작성
- Popover / Tooltip 작성 (Dialog 와 trap 요구사항 *다름* — Tooltip 은 trap ✕)
- `role="dialog"` / `<dialog>` element 사용처
- modal-like overlay 구현 (시각 모달이지만 a11y 미설정)

## 핵심 원칙

### 1. focus trap = 라이브러리 위임

- 자체 구현 *어려움* — Tab / Shift+Tab 순서 / iframe 안 focus / contenteditable / disabled element 등 edge case 다수
- Radix UI Dialog (`@radix-ui/react-dialog`) 또는 React Aria (`react-aria-components` Dialog) **권장**

### 2. ESC + Backdrop click = 둘 다 close

- ESC keyboard close — 라이브러리 자동 (Radix `onEscapeKeyDown` / Aria `onClose`)
- Backdrop click close — modal 외부 click 시 close (단 destructive action 은 confirm)
- AlertDialog (destructive) 는 *Backdrop click close ✕* — explicit Confirm/Cancel button 만

### 3. return focus to trigger

- close 후 dialog 열기 trigger button 에 focus 복귀 — keyboard 사용자 disorient 방지
- Radix / Aria 자동. 자체 구현 시 `useRef` + `useEffect cleanup` 으로 수동.

### 4. aria-modal + aria-labelledby + aria-describedby

- `aria-modal="true"` — screen reader 가 background 무시
- `aria-labelledby` → dialog 제목 element id
- `aria-describedby` → 본문 설명 element id (optional)

### 5. initial focus

- dialog open 시 첫 focus = 가장 **non-destructive** element (Cancel button > Close button > 첫 input)
- *Confirm* 버튼에 자동 focus ✕ (실수 클릭 위험)
- Radix `initialFocus` prop / Aria `autoFocus` prop

### 6. scroll lock

- modal open 동안 body scroll lock — `overflow: hidden` on `<body>`
- 라이브러리 자동. 자체 구현 시 scroll position 저장 → close 시 복구
- iOS Safari scroll lock = `position: fixed` 트릭

## 도구 위임 (이 skill 의 진입점 역할)

- **정적**: `eslint-plugin-jsx-a11y` `no-noninteractive-element-interactions` — `<div onClick>` modal trigger 같은 케이스
- **동적**: `@axe-core/playwright` Dialog 룰 — focus trap / aria-modal / 등 자동 검증
- **수동 (screen reader)**: VoiceOver `VO+Cmd+→` → modal navigate 확인
- **수동 (keyboard)**: Tab 순서가 dialog 안 갇혀있는지 / Shift+Tab 역방향도

## 안티패턴 표

| 안티 | 교정 | 검출 |
|---|---|---|
| 자체 구현 dialog (focus trap 코드 없음) | Radix Dialog / React Aria Dialog | **validate (warn)** |
| `role="dialog"` 에 `aria-modal` 누락 | `aria-modal="true"` 추가 | **validate (warn)** |
| `<dialog>` 에 label 없음 | `<Dialog.Title>` 또는 `aria-labelledby` | **validate (warn)** |
| close 후 focus 잃음 | Radix / Aria 자동, 자체는 `useRef` 보관 후 복귀 | 수동 / axe |
| Confirm button auto-focus | initial focus = Cancel button | 수동 |
| scroll lock 없음 → body 뒤로 스크롤 | 라이브러리 자동 | 수동 |
| AlertDialog 가 backdrop click close | AlertDialog = explicit button 만 | 수동 |
| Tooltip 에 trap 적용 | Tooltip 은 trap ✕, ESC + outside click 만 | 수동 |
| nested dialog (modal in modal) | 가능하면 회피, 불가피하면 stacking context 분리 | 수동 |

## Radix Dialog 패턴 (권장)

```tsx
import * as Dialog from '@radix-ui/react-dialog'

function SettingsDialog({ open, onOpenChange }: Props) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Trigger asChild>
        <button>Settings</button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-1/2 bg-bg p-6 rounded-md">
          <Dialog.Title>Settings</Dialog.Title>
          <Dialog.Description>Configure your preferences.</Dialog.Description>
          {/* form fields */}
          <Dialog.Close asChild>
            <button>Cancel</button>
          </Dialog.Close>
          <button onClick={save}>Save</button>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
```

자동: focus trap / ESC close / aria-modal / aria-labelledby (Title 자동 연결) / return focus / scroll lock.

## AlertDialog 패턴 (destructive action)

```tsx
import * as AlertDialog from '@radix-ui/react-alert-dialog'

function DeleteConfirm({ onDelete }: Props) {
  return (
    <AlertDialog.Root>
      <AlertDialog.Trigger asChild>
        <button className="bg-error text-error-fg">Delete</button>
      </AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Overlay />
        <AlertDialog.Content>
          <AlertDialog.Title>Delete this item?</AlertDialog.Title>
          <AlertDialog.Description>This cannot be undone.</AlertDialog.Description>
          <AlertDialog.Cancel asChild>
            <button>Cancel</button>
          </AlertDialog.Cancel>
          <AlertDialog.Action asChild>
            <button onClick={onDelete}>Delete</button>
          </AlertDialog.Action>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}
```

차이점: Backdrop click ✕, ESC ✕ (또는 Cancel 만), initial focus = Cancel (destructive 자동 focus 차단).

## React Aria Components 패턴

```tsx
import { DialogTrigger, Modal, Dialog, Heading, Button } from 'react-aria-components'

function SettingsDialog() {
  return (
    <DialogTrigger>
      <Button>Settings</Button>
      <Modal isDismissable>
        <Dialog>
          {({ close }) => (
            <>
              <Heading slot="title">Settings</Heading>
              <p>Configure your preferences.</p>
              <Button onPress={close}>Cancel</Button>
              <Button onPress={() => { save(); close(); }}>Save</Button>
            </>
          )}
        </Dialog>
      </Modal>
    </DialogTrigger>
  )
}
```

자동: 모든 6종. `isDismissable` 로 backdrop close 토글.

## native `<dialog>` 패턴 (Chromium / Electron 한정)

```tsx
function NativeDialog() {
  const ref = useRef<HTMLDialogElement>(null)
  return (
    <>
      <button onClick={() => ref.current?.showModal()}>Open</button>
      <dialog ref={ref} aria-labelledby="dialog-title">
        <h2 id="dialog-title">Title</h2>
        <p>Content</p>
        <button onClick={() => ref.current?.close()}>Close</button>
      </dialog>
    </>
  )
}
```

`showModal()` 자동: focus trap / ESC close / aria-modal / `::backdrop` pseudo-element. 단 — return focus 는 browser 따라 차이, scroll lock 일관성 ✕. *Chromium 기반 (Electron / 현대 브라우저) 한정* 권장.

## 참조

- [WAI-ARIA APG — Dialog (modal)](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/)
- [WAI-ARIA APG — Alertdialog](https://www.w3.org/WAI/ARIA/apg/patterns/alertdialog/)
- [Radix Dialog docs](https://www.radix-ui.com/primitives/docs/components/dialog) · [AlertDialog](https://www.radix-ui.com/primitives/docs/components/alert-dialog)
- [React Aria Dialog](https://react-spectrum.adobe.com/react-aria/Dialog.html)
- [MDN `<dialog>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/dialog) · [`showModal()`](https://developer.mozilla.org/en-US/docs/Web/API/HTMLDialogElement/showModal)
- [@axe-core/playwright](https://github.com/dequelabs/axe-core-npm/tree/develop/packages/playwright)
