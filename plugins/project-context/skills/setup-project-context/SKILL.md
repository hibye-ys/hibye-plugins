---
name: setup-project-context
description: Set up or inspect project-context opt-in shared memory and lazy intent across Codex or Claude sessions, including linked Git worktrees.
---

Use the plugin repository's `scripts/setup-project.sh <project> --plugin project-context --tools codex,claude --preview` to preview the requested hosts, then apply the same command without `--preview` only within the user's setup request. `--check` reports pending configuration changes without writing. The installer owns host configuration merging and the byte-identical runner. See the plugin [README](../../README.md) for schema, CLI and support boundaries.

The project must choose its memory directory/index and/or existing intent directory in `.project-context.json`. Do not create or overwrite project memory or intent content as a setup side effect. No opt-in means no session injection. Memory resolves from Git's primary checkout; intent resolves from the current checkout. Independent clones have independent memory.

Verify `doctor`, the host's enabled user snapshot and all four SessionStart events. Codex emits a lazy index pointer; Claude's native `autoMemoryDirectory` owns the index load, so the hook emits no index text. Preserve unrelated hooks and settings. Source links are development artifacts and cannot satisfy the installed snapshot contract. A failure marker is not a successful initialization; fix its cause before claiming acceptance. Muse/Antigravity adapters are source-only until product acceptance is independently demonstrated.
