# {{title}} — Plan

Plan ID: {{stable-id}} · Revision: {{revision}} · State: {{draft | ready}}
Spec: {{path to spec.md}} · built from spec revision {{n}}
Created: {{actual ISO 8601 timestamp with timezone offset; preserve on revision}}
{{Changed in this revision: at most three lines, replaced each time; omit on the first revision.}}

## Approach

{{Only technical choices that affect task boundaries, shared interfaces, risk, or
validation; three lines at most each. Link design.md in one line if it exists.
Omit this section if none.}}

## Tasks

| ID | Result | Depends on | Role · route / model / effort | Done when |
| --- | --- | --- | --- | --- |
| T01 | {{one line}} | {{none or IDs}} | {{supported selection, or unassigned + capability needed}} | {{observable result + its check; acceptance IDs covered}} |
| T0n | Closing: integrate, shared validation once, review if warranted, shared records | {{all}} | {{…}} | {{…}} |

Order: {{e.g. T01 → (T02 ∥ T03) → T04; add "sequential" + reason only where dependencies do not explain it}}

{{Later phases, one line each: result and what must be true to start. Omit for single-phase work.}}

## Shared validation

{{A few lines: what is checked once for the whole plan, where, and at which stage.}}

## Handoff

- Execution prerequisites: {{existing authorization, unresolved dependencies, if any}}
- Progress entry: {{existing state link or intended status.md; mark not created yet}}

{{Owned paths, inputs, and validation detail go on task cards at dispatch, not in
the table. Planning creates only spec.md, plan.md, and design.md when needed.
Remove template guidance and unused sections in the actual output.}}
