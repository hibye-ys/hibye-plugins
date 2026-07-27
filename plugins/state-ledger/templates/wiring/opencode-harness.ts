// opencode plugin — state-ledger 훅 어댑터. 대상 프로젝트의 .opencode/plugins/ 에 복사.
//   - state-stamp: 파일 직접 수정 (완전 동작)
//   - stop-reminder: session.idle 에서 실행, 결과는 로그로 전달 (block 불가)
//   - SessionStart STATE 주입: opencode.json instructions 로 STATE.md 를 직접 지정 (스크립트 미호출)
import path from "node:path"
import type { Plugin } from "@opencode-ai/plugin"

const runHook = async (
  $: any,
  worktree: string,
  script: string,
  stdinPayload: unknown,
): Promise<string> => {
  const scriptPath = path.join(worktree, "scripts", "hooks", script)
  // Bun Shell 은 <<< herestring 미지원 — Response 객체 redirect 로 stdin 전달.
  const stdin = new Response(JSON.stringify(stdinPayload))
  const r = await $`HOOK_PROJECT_DIR=${worktree} bash ${scriptPath} < ${stdin}`
    .nothrow()
    .quiet()
  return r.exitCode === 0 ? r.text() : ""
}

export const StateLedgerPlugin: Plugin = async ({ client, $, worktree }) => {
  return {
    "tool.execute.after": async (input: any) => {
      if (input.tool !== "write" && input.tool !== "edit") return
      const filePath: unknown = input.args?.filePath
      if (typeof filePath !== "string" || !filePath) return

      // 트리거 매칭(docs/state/**)은 스크립트 내부 case 게이트가 담당 — 비매치는 즉시 exit 0.
      const payload = { tool_input: { file_path: filePath } }
      // state-stamp: 파일 직접 수정 — 후속 도구 호출과의 race 방지 위해 await.
      await runHook($, worktree, "post-edit-state-stamp.sh", payload)
    },

    event: async ({ event }: any) => {
      // session.idle = Stop 과 유사. stop-reminder 실행.
      if (event.type !== "session.idle") return
      const out = await runHook($, worktree, "stop-state-reminder.sh", {})
      if (!out) return
      try {
        const parsed = JSON.parse(out)
        const msg = parsed?.hookSpecificOutput?.additionalContext ?? parsed?.reason ?? ""
        if (msg) {
          await client.app.log({
            body: {
              service: "state-ledger",
              level: "warn",
              message: "STATE reminder",
              extra: { message: msg },
            },
          })
        }
      } catch {
        // 비JSON 출력은 무시
      }
    },
  }
}
