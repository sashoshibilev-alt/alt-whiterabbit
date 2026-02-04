# Agent Rules (MANDATORY)

These rules apply to ALL agent tasks.
Violation of any rule is grounds to STOP and request clarification.

## 1. Scope discipline (highest priority)
- Keep changes narrowly scoped to the stated goal.
- Do NOT refactor, rename, reformat, or reorganize unrelated code.
- Do NOT “clean up” while you are here.
- If you discover adjacent issues, list them under “Risks / Follow-ups” instead of fixing them.

## 2. Discover → Plan → Execute
- If file locations, data flow, or constraints are unclear, you MUST:
  1) Inspect the repo
  2) Write a concrete implementation plan
  3) Only then modify code
- Never jump directly to editing unless the target is obvious and local.

## 3. Minimal diff bias
- Prefer extending existing logic over introducing new abstractions.
- Prefer small, composable helpers over new subsystems.
- If a change would exceed ~400 net lines or touch >12 files:
  STOP and propose a split plan.

## 4. No silent architectural changes
- Do NOT introduce new patterns, layers, or dependencies without explicit approval.
- Do NOT change schemas, contracts, or public interfaces unless required by the task.
- Any irreversible or costly decision MUST be recorded in `docs/decision-log.md`.

## 5. Explicit system memory
You are responsible for keeping planning state accurate.

- Update `docs/current-state.md` if and only if:
  - system behavior changes
  - new constraints are introduced
  - future plans must adapt as a result

- Update `docs/decision-log.md` if and only if:
  - a durable trade-off is made
  - an alternative is intentionally rejected
  - a future option is closed off

Do NOT update these files mechanically. Only update them when reality changes.

## 6. Tests and verification
- Add or update tests when logic changes.
- If automated tests exist, run them.
- If they do not exist, provide manual verification steps.
- Never claim “verified” without evidence.

## 7. Debuggability over cleverness
- Favor explicit, readable logic over compressed or “smart” code.
- Add comments only where behavior is non-obvious.
- Prefer explainable rules over probabilistic heuristics unless instructed otherwise.

## 8. Failure handling
- If requirements are contradictory, ambiguous, or impossible:
  STOP and explain the issue before continuing.
- If you believe the task is mis-scoped:
  STOP and propose a corrected scope.

## 9. Output contract (always required)
Every task MUST end with:
- Summary of changes
- List of files changed (with purpose)
- Verification steps (commands or manual)
- Docs updated (`current-state.md`, `decision-log.md`: yes/no + why)
- Risks / follow-ups (max 3)
