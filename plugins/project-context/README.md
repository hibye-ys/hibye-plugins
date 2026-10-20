# Project Context

A Node standard-library plugin for opt-in memory pointers and lazy operating-decision discovery. STATE and project content remain project-owned. Claude/Codex share `hooks/hooks.json`; neither manifest registers a second copy. Muse/Antigravity provide source adapters only, without a native-product acceptance claim.

## Project opt-in

```json
{"schema_version":1,"memory":{"directory":"docs/memory","index":"MEMORY.md"},"intent":{"directory":"intent"}}
```

Either feature may be `false` or omitted; at least one must be enabled. Unknown keys, absolute paths, traversal, and paths whose existing ancestors escape the declared repository are rejected. The setup tool never creates or overwrites content. Initial v1 Claude native memory supports only `index: "MEMORY.md"` directly in the memory directory. Setup with Claude selected and `doctor` (default cross-host inspection) explicitly reject custom indexes. Generic `--host codex` inspection and Codex session loading retain custom-index support; no second auto/manual index is created. No config means a no-op, including unrelated non-Git folders. Opted-in non-Git and bare repositories are unsupported.

Memory comes from the primary checkout verified against the Git common directory. Intent comes from the current checkout. Independent clones are independent. The primary checkout also owns the memory configuration; linked configuration drift keeps the same primary source and emits `PROJECT_MEMORY_CONFIG_MISMATCH`. A separate Git-dir layout without a verifiable primary checkout is unsupported. Missing or inaccessible primary memory fails visibly; there is no worktree-local fallback. Paths do not grant sandbox permissions or implement a concurrent-writer lock. Writers re-read before editing and preserve other writers.

The memory index uses relative Markdown links to detail `.md` files. Validation reports dangling/escaping links, duplicate links and unindexed files, including nested details. Intent follows `## C1 · Title`, `- 규칙: Decision`, `- 갱신: YYYY-MM-DD`, and a pre-entry `설명: Area — when to read`. Sessions emit only area descriptions, IDs and paths, never rule bodies or memory detail text. Intent output has a 7 KB budget and the total session context a 12 KB budget; truncation retains the memory pointer, visible diagnostic failures and a doctor/source requery marker. Codex emits memory directory/index/hash; Claude relies on native `autoMemoryDirectory` for the index and emits the same pointer without duplicate text.

## CLI and APIs

```sh
node scripts/project-context.cjs session-start --project /path/to/checkout --host codex --event resume
node scripts/project-context.cjs doctor --project /path/to/checkout
node scripts/project-context.cjs check-memory --project /path/to/checkout
node scripts/project-context.cjs intent-check --project /path/to/checkout
node scripts/project-context.cjs intent-session-start --project /path/to/checkout
node --test tests/project-context.test.cjs tests/runner.test.mjs
```

`session-start` accepts hook JSON from stdin (`cwd`, `workspacePaths`, `source`) and emits a SessionStart envelope. Explicit CLI project/host/event overrides input. Explicit `--host` takes precedence. Native auto-detection requires stdin `hook_event_name: "SessionStart"` plus a nonempty `session_id`. Claude proof is an exact match to the host-refreshed `CLAUDE_CODE_SESSION_ID`; Codex plugin proof is `PLUGIN_ROOT` and compatible `CLAUDE_PLUGIN_ROOT` both resolving to this executing runtime snapshot. Inherited `CODEX_THREAD_ID`, `CLAUDECODE`, or other presence-only flags do not select a host. Simultaneous proofs fail visibly as `PROJECT_CONTEXT_HOST_AMBIGUOUS`; absent proofs fail as `PROJECT_CONTEXT_HOST_UNRESOLVED`. Raw CLI callers without native proof must pass `--host codex` or `--host claude`. Projects without opt-in remain no-op. These auto-detection requirements are the minimum supported native hook environment; older hosts missing the documented fields need an explicit host adapter. All four events startup/resume/clear/compact use the same lazy contract. Visible hook failures exit 0 because hosts may discard nonzero stdout; `doctor`, `check-memory`, and `intent-check` return nonzero on invalid configured input. Optional intent/diagnostic errors do not erase valid memory pointers. Primary-memory selection validates only the memory section, so current/primary intent errors cannot block its pointer. Direct `intent-session-start` applies the same 7 KB intent budget and requery marker. Native hook configuration keeps `additionalContextLimit: 2500`; byte budgets do not establish a token-count PASS. `tests/fixtures/large-korean-{codex,claude}-context.txt` are actual emitted output samples for independent token measurement, not measured token acceptance.

`scripts/project-context.cjs` exports synchronous CJS `resolveProjectMemory`, `inspectMemoryIndex`, `parseIntentFile`, `loadIntentLedger`, `renderIntentContext`, `intentSessionContext`, `runIntentCli`, `buildSessionStartContext`, `runSessionStartContextCli`, `loadProjectContextConfig`, `inspectProjectContext`, `runCli`, constants contract version 1 and the four events. Functions accept `{repoRoot}` and use the caller checkout, never plugin location; Git queries remove location/config override environment. `buildSessionStartContext` returns a hook envelope and accepts `host`, `event`, `resolveMemory`, `intentContext`, `readFile`, and optional diagnostic callback. `inspectProjectContext` returns `{ok,enabled,config,memory,intent,errors}`. `loadProjectContextConfig` returns `{enabled,repoRoot,configPath,memory,intent}`.

Copy `templates/wiring/project-context-runner.mjs` byte-for-byte for thin project entry points. Its lazy `loadProjectContextRuntime` and `resolveProjectContextPluginRoot` accept `{host?,pluginRoot?,home?,env?,spawn?}`. `pluginRoot` is an explicit fixture argument only; no environment source-root override exists. Default discovery requires enabled native user registration (Codex CLI list or Claude settings plus installed registry), exact manifest version, contract version/runtime, and no symlink anywhere in payload. It never selects an unregistered cache merely because it exists. Import is safe without an installed plugin; calling the loader is the validation boundary.

## Project hook ownership

The project installer/verification layer reserves these literal SessionStart entrypoint names for native project-context ownership: `session-start-context.mjs`, `intent-ledger.mjs`, `project-context.cjs`, `project-context.mjs`, and `project-context-runner.mjs`. A project SessionStart command containing any of these names is unsupported, including a name used by `echo`, as an argument, or in a check. This conservative literal rule prevents duplicate injection without interpreting arbitrary shell syntax. Unrelated project hooks remain allowed; the plugin's own native hook binding is outside this project registration rule.

Native host proof references: [Codex plugin hook environment](https://learn.chatgpt.com/docs/hooks#plugin-hooks) and [Claude session identity environment](https://code.claude.com/docs/en/env-vars). The installed Claude 2.1.304 hook launcher also refreshes the session identity after inherited environment values. Native product readback remains a separate acceptance step.
