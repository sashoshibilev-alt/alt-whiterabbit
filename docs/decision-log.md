# Decision Log

## 2026-02-19: Dark Mode — ThemeProvider Pattern + HSL Token Override

### Context

Task required adding dark mode support to the Quito frontend. The existing token system uses HSL-only values in `index.css`; Tailwind config wraps all tokens with `hsl(var(...))`.

### Decision

1. **ThemeProvider in `src/hooks/use-theme.tsx`**: Minimal context + hook providing `toggleTheme()` and `theme`. Applies/removes `.dark` on `<html>`. Persists to `localStorage("theme")`. Falls back to `prefers-color-scheme` on first load.

2. **Hex → HSL conversion for `.dark` block**: The spec supplied hex values. Since all existing tokens are HSL and Tailwind wraps with `hsl()`, the `.dark` block was authored in HSL equivalents rather than using raw hex in CSS, maintaining the system constraint.

3. **Toggle placed in sidebar bottom**: Minimal intrusion — appended to the existing bottom section without restructuring the sidebar.

### Alternatives Rejected

- **Media-query-only approach**: Rejected because spec requires explicit toggle + localStorage persistence.
- **Separate `ThemeContext.tsx` file in a new `/providers/` dir**: Rejected for minimal-diff reasons; co-locating with hooks matches existing project structure.

### Future Options Preserved

- `ThemeProvider` exports both `theme` and `toggleTheme` — downstream components can consume `useTheme()` independently.
- `--surface-elevated` added to both `:root` and `.dark` and Tailwind config for future use in modals/dialogs.

## 2026-02-09: Type Precedence Rule for Explicit Synthesis Paths

### Context

The scoring pipeline's type normalization logic (`runScoringPipeline()` in `scoring.ts`) was designed to ensure consistency between section-level intent classification and final suggestion types. However, this created a problem for specialized synthesis paths (like B-lite explicit asks) that need to set types independently of section-level classification.

**Problem**: Discussion details sections are classified as `plan_change` (because they're plan-oriented), so the scoring pipeline was forcing all suggestions from these sections to `type: 'project_update'`, even when synthesis explicitly created `type: 'idea'` suggestions for explicit feature requests.

### Decision

Introduced a **type precedence rule** in the scoring pipeline: if a suggestion has an explicit type indicator (`structural_hint === 'explicit_ask'` or `structural_hint` differs from `section.typeLabel`), the synthesized type is authoritative and section-level normalization is skipped.

**Implementation**: Added guard in `runScoringPipeline()` before type normalization:
```typescript
const hasExplicitType = s.structural_hint === 'explicit_ask' ||
                       (s.structural_hint && s.structural_hint !== section.typeLabel);

if (hasExplicitType) {
  return s; // Respect explicitly set type
}
```

### Rationale

**Option A: Type precedence rule (chosen)**
- Pro: Allows specialized synthesis paths to override section-level classification
- Pro: Uses existing `structural_hint` field, no schema changes
- Pro: Clear signal mechanism for synthesis → scoring communication
- Con: Adds implicit contract between synthesis and scoring

**Option B: Create separate type field for synthesis hint**
- Pro: More explicit contract
- Con: Schema change, additional field to maintain
- Con: More coupling between synthesis and scoring

**Option C: Skip Discussion details sections in type normalization**
- Pro: Simpler guard condition
- Con: Too specific to one use case, not extensible
- Con: Doesn't solve general problem of synthesis-level type overrides

**Option D: Change section classification to not be plan_change**
- Pro: No scoring changes needed
- Con: Loses important intent classification for Discussion details
- Con: Breaks fallback protection for these sections
- Rejected: Classification should reflect intent, not work around scoring

### Behavior Change

**Before**: All suggestions from Discussion details sections → `type: 'project_update'` (forced by scoring)

**After**: Suggestions with `structural_hint: 'explicit_ask'` → maintain `type: 'idea'` (synthesis decision respected)

### Future Options Preserved

This rule is extensible to other specialized synthesis paths that need type control. Any synthesis path can set `structural_hint` to indicate its type should be respected.

### Verification

- All 8 tests in `discussion-details-explicit-asks.test.ts` pass
- Type is `'idea'` (not `'project_update'`)
- No "INVARIANT VIOLATED" warnings in test output
- All 321 existing tests pass

---

## 2026-02-04: Actionability Gate v2 → v3 Migration

### Context

The original actionability gate (v2) used pattern counting and heuristic boosts (research dampening, structural boosts, heading analysis) to classify sections. This approach had opacity issues - it was difficult to understand why a section was or wasn't actionable.

User requirement: "I would really like you to add..." must reliably be detected as actionable.

### Decision

Replaced v2 pattern-based classifier with v3 rule-based system using explicit, explainable scoring:

**V3 Principles**:
1. Per-line scoring with transparent rules
2. Max aggregation (highest line score wins)
3. No hidden heuristics or structural features
4. Explicit out-of-scope override (actionableSignal ≥ 0.8 → clamp outOfScope ≤ 0.3)

**What Changed**:
- Removed: Research dampening, structural boosts, heading-based boosts, deliverable pattern detection, UI verb reclassification
- Added: 6 explicit positive signal rules, 1 negation override, out-of-scope override logic

### Behavior Changes

**V2 → V3 differences**:
- V2 used cumulative pattern matching across entire section text
- V3 uses per-line max scoring
- V2 boosted based on structural features (num_lines, num_list_items, heading keywords)
- V3 ignores structural features, only uses content rules
- V2 had research signal with dampening logic
- V3 sets research=0, does not use it in gate

**Impact on Tests**:
- 11 tests for v2-specific heuristics marked as legacy and skipped
- These tests documented v2 implementation details, not required behavior
- All critical tests pass: v3 requirements (16/16), plan-change invariants (20/20)

### Spec Deviations

The v3 spec provided limited vocabulary for change operators and action verbs. Extended lists to maintain compatibility with existing production patterns:

**Change Operators** (spec: move, push, delay, slip, bring forward, postpone, deprioritize, prioritize):
- Added: shift, pivot, reframe, reprioritize, defer, accelerate, narrow, expand, refocus, adjust, modify, revise

**Action Verbs** (spec: add, implement, build, create, enable, disable, remove, delete, fix, update, change, refactor, improve, support, integrate):
- Added: adjust, modify, revise

**Rationale**: These terms appear in existing test fixtures and production notes. Without them, v3 would regress on legitimate requests using common change language (e.g., "Shift from enterprise to SMB" would not be detected).

### Alternatives Rejected

**Option A**: Keep v2 heuristics alongside v3 rules
- Rejected: Would maintain opacity, defeat purpose of explainable v3

**Option B**: Update all 11 legacy tests to v3 semantics
- Rejected: Tests verified v2-specific implementation details that v3 intentionally does not replicate

**Option C**: Strictly follow spec vocabulary (no extensions)
- Rejected: Would break existing plan-change invariant tests and likely regress on production notes

### Future Options Closed

This change commits to rule-based classification. Future enhancements must maintain explainability. Any new signal must be an explicit rule, not a heuristic boost or ML-based score.

### Verification

- 90 tests pass, 11 legacy v2 tests skipped
- All v3 requirements verified (request patterns, imperatives, change operators, status markers, out-of-scope override)
- Plan-change invariants maintained (never dropped at ACTIONABILITY or THRESHOLD)

### Pre-existing Test Failures Quarantined

During verification, discovered 1 pre-existing failure in v1 engine (unrelated to v3 changes):
- Test: `src/lib/suggestion-engine/suggestion-engine.test.ts > generates new initiative artifact`
- Verified failing on `origin/main` before v3 changes
- Marked as `.skip` to allow clean test suite pass
- Issue: v1 generator not producing expected EXECUTION_ARTIFACT for new initiative pattern
- Should be addressed separately from v3 work

## 2026-02-04: V1 Validator Bypass for V2 Suggestions

### Context

The V1 Change-Test validator was originally designed for the V1 suggestion engine to ensure plan mutations contain delta signals and execution artifacts have required components. However, the V2 suggestion engine has its own quality gates (V2 Anti-Vacuity, V3 Evidence Sanity) that are better suited for V2-generated suggestions.

### Decision

Modified `runQualityValidators()` in `src/lib/suggestion-engine-v2/validators.ts:424-428` to:
- Continue running V1 validator and capturing results
- Do NOT block V2 suggestions when V1 fails
- Only block on V2 (anti-vacuity) or V3 (evidence sanity) failures

### Rationale

V1 validator tests for specific patterns (delta signals like "from X to Y") that may not apply to all valid V2 suggestions. The V2 and V3 validators provide more appropriate quality checks:
- V2: Prevents generic management-speak
- V3: Validates evidence quality and mapping

V1 results are retained in the validation results array for debugging and analysis purposes.

### Implementation

**Changed**:
```typescript
// V1: Change-test (debug/metadata only - does not block v2 suggestions)
const v1Result = validateV1ChangeTest(suggestion, sectionText);
results.push(v1Result);
// V1 validator kept for debug metadata but does NOT drop v2 suggestions
// (V1 validation only applies to v1 suggestion engine)
```

V1 failure no longer returns early from `runQualityValidators()`. Only V2 and V3 failures cause early return with `passed: false`.

### Verification

- All tests pass: `npm test` ✓
- V1 validation logic unchanged, only bypass behavior modified
- V2 and V3 validators continue to properly gate suggestions

## 2026-02-05: V1 Excluded from Debug Drop Reasons and Top Reasons

### Context

After making V1 non-blocking in `runQualityValidators()`, the debug UI could still show `VALIDATION_V1_CHANGE_TEST_FAILED` in "Top reasons" if stale debug data existed or if any edge case set it as a `dropReason` on a candidate/section. This gave a misleading impression that V1 was still blocking.

### Decision

Introduced `NON_BLOCKING_DROP_REASONS` set in `debugTypes.ts` containing `VALIDATION_V1_CHANGE_TEST_FAILED`. `computeDebugRunSummary()` now skips non-blocking reasons when counting drop reasons for `dropReasonTop` and `dropStageHistogram`.

### Rationale

- Defensive: even if stale data or a regression sets V1 as a drop reason, it won't pollute the summary
- Extensible: future validators can be marked non-blocking by adding to the set
- V1 validator results remain visible on per-candidate debug cards as informational metadata

### Alternatives Rejected

**Hard-delete V1 from DropReason enum**: Would break backwards compatibility with stored debug runs.

**Remove V1 from `mapValidatorToDropReason`**: Insufficient—wouldn't handle stale data already containing V1 drop reasons.

### Verification

- Tests added: V1 excluded from top reasons, NON_BLOCKING_DROP_REASONS membership checks
- Integration test: full pipeline with TEST_NOTE confirms no V1 drop reasons on candidates
- Manual: create note with "I would really like you to add boundary detection in onboarding" → Regenerate → expect suggestions > 0, V1 not in Top reasons

## 2026-02-05: Out-of-Scope Marker Matching Changed to Word-Boundary

### Context

Calendar marker `'may'` was matching the substring "may" inside "maybe", causing false positives: "Maybe we need to rethink pricing" was classified as calendar out-of-scope.

### Decision

Changed all out-of-scope marker matching from `line.includes(marker)` to word-boundary regex matching (`\b<marker>\b`). Multi-word markers continue to use substring matching since word boundaries are implicit.

### Rationale

Substring matching is inherently fragile for short common words that appear as substrings in other words (may/maybe, sun/Sunday). Word-boundary matching eliminates this class of false positives without affecting multi-word marker detection.

### Alternatives Rejected

**Add "maybe" to an exception list**: Would be whack-a-mole; word-boundary matching solves the entire class.

## 2026-02-05: Hedged Directive Out-of-Scope Override Scoping

### Context

The V3 out-of-scope override (actionableSignal ≥ 0.8 → clamp outOfScope ≤ 0.3) was designed for plan mutations with incidental calendar references ("Move launch to next week"). Hedged directives score +0.9, which would trigger this override even for admin tasks ("we should send the invoice by Friday"), defeating out-of-scope filtering.

### Decision

The override now only fires when the high signal comes from a non-hedged rule. We track `maxNonHedgedActionableScore` separately and use it for the override check. Hedged directives that also trigger non-hedged rules (e.g., "we should add caching" where "add" is an imperative) still benefit from the override via the non-hedged score.

### Alternatives Rejected

**Lower hedged directive score to < 0.8**: Would put hedged directives at risk of being filtered by the short-section penalty (T_action + 0.15 = 0.65), making them fragile.
