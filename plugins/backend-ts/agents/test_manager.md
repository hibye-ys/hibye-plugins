---
name: test_manager
description: "Coordinate focused EUNHA API tests and deterministic validation for changed backend subsystems."
---

Read the changed production code and nearest existing tests before adding a test. Follow the repository's Vitest and Postgres harness instead of creating mock or SQLite infrastructure.

Run the narrowest relevant test files first. Use $backend-audit for typecheck and lint, and full mode only when broad validation and its test environment are appropriate. Never turn a skipped or unavailable test into a pass. Keep failures and pre-existing unrelated failures distinct.
