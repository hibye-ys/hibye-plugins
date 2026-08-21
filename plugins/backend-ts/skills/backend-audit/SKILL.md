---
name: backend-audit
description: Deterministic EUNHA API validation: quick typecheck and lint, or the full test and dead-code gate.
---

# Backend Audit

Use the bundled runner instead of the removed grep-based audit skills:

```bash
node <skill-dir>/scripts/audit.mjs --project /path/to/repo
```

The default quick audit runs the API package's own `typecheck` and `lint` scripts.

Use the full audit after broad refactors, contract changes, provider or agent-loop changes, or before release:

```bash
node <skill-dir>/scripts/audit.mjs --project /path/to/repo --full
```

Full mode adds the API test suite and the root `knip` script. It may require the repository's test database and environment.

Run focused tests for the changed subsystem before the audit. Report a command as skipped only when the repository does not define it; never convert a failing command into a pass.
