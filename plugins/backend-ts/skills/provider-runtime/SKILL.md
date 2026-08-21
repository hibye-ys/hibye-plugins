---
name: provider-runtime
description: EUNHA LLM providers, model resolution, retry classification, conversion, streaming, usage. `apps/api/src/providers`.
---

# Provider Runtime

Start from `src/providers/types.ts`, `registry.ts`, `retry.ts`, and `error-verdict.ts`. Then inspect the selected provider, its converter, and both foreground and headless consumers.

Implementation rules:

1. Implement the shared `ProviderClient` contract; keep provider SDK shapes behind converters.
2. Register explicit provider and model identifiers in the canonical registry. Unknown or unavailable choices must fail closed.
3. Do not add provider or model fallback chains unless the user explicitly requests that product behavior.
4. Keep retry policy centralized. Disable or account for SDK-native retries so nested retries cannot multiply requests.
5. Classify provider errors once, including whether failure happened before or after a streamed byte and whether it affects gateway health.
6. Preserve tool-call, reasoning, finish, and usage normalization across stream and generate paths.
7. Add provider, conversion, registry, retry, and adapter tests for the changed surface.

Check breaker and usage consumers when error or finish semantics change, then use `backend-audit`.
