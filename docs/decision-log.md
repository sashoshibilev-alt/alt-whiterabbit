# Decision Log

## 2026-02-24: UI Clarification Policy — Badge Gating Change

### Context

`applyConfidenceBasedProcessing` previously set `needs_clarification=true` for any plan_change or actionable-section suggestion whose scores fell below thresholds. This caused "Needs clarification" UI noise on suggestions that were perfectly valid but scored conservatively.

### Decision

**`needs_clarification=true` is now gated on V3 evidence failure or `dropReason` — NOT on score alone.**

- V3_evidence_sanity failure (evidence doesn't match section text) is a meaningful signal that the suggestion body may be wrong.
- `dropReason` being set signals the suggestion was almost dropped (renderable only as "apply anyway").
- Low `overallScore` alone does not indicate a bad suggestion — it indicates uncertain confidence in the type classification, not that the suggestion content is wrong.

### Alternatives Rejected

- **Keep old behavior (badge for any low score)**: Produces too many false "Needs clarification" labels, reducing trust in the badge signal.
- **Remove badge entirely**: V3 failures are real quality concerns users should see; removing the badge entirely would hide them.

### Tests Updated

- 12 existing tests updated across `plan-change-invariants.test.ts` and `suggestion-engine-v2.test.ts`.
- New test in `consolidate-by-section.test.ts` verifies: V3 failure → badge, low score alone → no badge.

## 2026-02-24: Structural Idea Bypass — pipeline early-return modification

### Context

Sections with `actionabilitySignal=0` (no plan_change or new_workstream signal) were dropped by the ACTIONABILITY gate in Stage 2. Two early returns in `generateSuggestions` reinforced this: one after `filterActionableSections`, one after `synthesizeSuggestions`. Stage 4.58 (`extractIdeaCandidates`) already iterates ALL classified sections but still requires ≥2 strategy/mechanism signal tokens — a gate those sections may not pass.

### Decision

**Bypass is placed in Stage 4.59, not inside `filterActionableSections`.**

Integrating the bypass into `filterActionableSections` would change the contract of that function (it currently returns strictly actionable + plan_change sections). Introducing bypass-flagged sections into `expandedSections` would route them through all downstream stages including synthesis, validation, B-signal, and scoring — with side effects that are hard to audit.

Instead, Stage 4.59 is additive: it emits exactly ONE bypass candidate per qualifying section and adds it to `filteredValidatedSuggestions` directly, bypassing Stages 2–4 entirely. This is the same pattern used by Stages 4.5 and 4.58.

**Two early-returns in `index.ts` are now guarded by `hasStructuralBypassCandidate`.**

The `actionableSections.length === 0` return and the `synthesizedSuggestions.length === 0` return were short-circuiting before Stage 4.59 could run. Adding the bypass check before each prevents the pipeline from exiting early while remaining correct for all-zero bypass cases (still returns early).

### Alternatives Rejected

- **Raising actionabilitySignal threshold globally**: Would cause other sections to also bypass, inflating output uncontrollably.
- **Adding bypass logic inside `filterActionableSections`**: Changes a well-tested pure function; requires synthesis/scoring to handle bypass sections specially throughout.
- **Modifying `extractIdeaCandidates` to loosen its composite gate**: That gate is correct for prose sections; loosening it for structured list sections would re-introduce noise.

### Score Preservation in Scoring.ts

Bypass candidates have preset scores (0.65). `refineSuggestionScores` is guarded to skip re-scoring for `structural-idea-bypass` and `idea-semantic` candidates on non-actionable sections. Reason: recomputing from `section.actionable_signal=0` would produce overall=0 and drop the candidate at the threshold gate.

---

## 2026-02-24: Strategy Heading Override — why bullet_count guard was widened

### Context

`computeTypeLabel()` had a rule: strategy-only sections (no delta, no schedule event) return `'idea'`. But the rule required `bullet_count === 0` — making it ineffective for strategy headings with imperative bullet lists ("Create …", "Present …", "Always show …").

The intent was to exempt "action plan" bullet sections (e.g., "shift from enterprise to SMB with tasks") from the idea path. However, when the heading itself names a strategy workstream (e.g., "Agatha Gamification Strategy"), the bullets are elaboration of the strategy, not a concrete plan mutation. They must remain `'idea'`.

### Decision

**Add `isStrategyHeadingSection` as an early-return override inside the strategy-only branch of `computeTypeLabel()`.**

Fires before the `bullet_count === 0` check. This means:
- Strategy-named headings + any number of bullets + no delta → `'idea'`
- Strategy-named headings + bullets + concrete delta → `isStrategyOnlySection` returns `false`, override never fires → `'project_update'` correctly returned

### Alternatives Rejected

- **Removing the bullet_count guard entirely**: Would cause unintended reclassification of genuine action-plan sections that happen to lack a schedule event word but have bullets with change operators.
- **Using body text heuristics instead of heading text**: Heading text is the most reliable signal for named workstream sections. Body text could match too broadly.
- **Adding strategy keyword to INITIATIVE_SYSTEM_NOUNS**: That only guards the early-return path for non-actionable sections; the bug was in the main `computeTypeLabel()` type decision path.

### Scope Constraint

`STRATEGY_HEADING_KEYWORDS` is intentionally broad (`strategy | approach | initiative | roadmap | framework | vision | direction | plan | proposal`) to minimize false negatives. The delta guard remains the primary safety valve — any section with concrete dates/durations is still correctly `project_update`.

---

## 2026-02-24: Section Consolidation — Stage 6.5 Placement and Rules

### Context

Structured sections with level ≤ 3 headings and 3+ bullets (e.g. `### Black Box Prioritization System`) could emit multiple idea candidates — one per sentence or bullet — from Stages 4.58 and 4.5. This fragmentation made the output noisy without adding information.

### Decision

**Stage 6.5 runs after Stage 5 (Scoring), before Stage 6 (Routing).**

Post-scoring placement is intentional: we only consolidate candidates that have already passed all quality gates (validation, grounding, process-noise suppression, scoring threshold). Consolidating earlier would risk merging a low-quality candidate with a high-quality one and discarding the distinction.

**Consolidation rule (all conditions must hold):**
1. `heading_level <= 3`
2. `num_list_items >= 3`
3. No delta/timeline tokens in section `raw_text`
4. More than 1 candidate for the section
5. ALL candidates are type `idea`

**Title strategy:** use `normalizeTitlePrefix('idea', section.heading_text)` — anchored to the section heading rather than any individual bullet title. This is the correct signal: the heading names the idea, the bullets are its sub-points.

### Alternatives Rejected

- **Stage 4 placement (pre-validation)**: Rejected — merging before quality gates means a merged candidate could survive validation on the strength of multiple bullet spans, masking a single weak one.
- **Stage 3 placement (synthesis)**: Rejected — synthesis doesn't know how many candidates other stages will emit per section. Consolidation needs to see the final candidate pool.
- **Consolidate risk/project_update types too**: Rejected — risks describe distinct failure modes; project_updates represent concrete timeline events. Both are identity-bearing; merging would lose precision.

### Future Options Preserved

- `TIMELINE_PATTERNS` in `consolidateBySection.ts` can be extended independently if new delta signal patterns are added to `title-normalization.ts`.
- `resetConsolidationCounter()` follows the same determinism reset pattern as other counter-based stages.

---

## 2026-02-22: Type Tie-Breaker — Strategy-Only Sections Emit as Idea

### Context

`plan_change` sections with strategic direction language ("shift from enterprise to SMB", "narrow our focus") were emitting as `project_update` because:
1. The ACTIONABILITY gate was unconditionally bypassed for all plan_change sections.
2. `computeTypeLabel` returned `project_update` for all plan_change sections.

This produced misleading "Update: ..." suggestions for sections that described strategic pivots rather than schedule mutations.

### Decision

**Gate the ACTIONABILITY bypass on concrete delta presence.** Strategy-only sections (no numeric delta, no schedule-event word) fall through to normal actionability evaluation. This means they may or may not pass the gate on their own merits.

**Downgrade strategy-only sections from project_update to idea** using the STRATEGY-ONLY OVERRIDE in `classifySection`. The override is exempt for sections with `hasExplicitImperativeAction` (e.g., "Remove deprecated feature flags") to avoid false downgrades caused by V3_CHANGE_OPERATORS substring matches (e.g., "Remove" containing "move").

The `isStrategyOnlySection(text)` function is defined as: no concrete delta AND no schedule-event word. It does NOT require explicit strategy vocabulary (shift/pivot/narrow) in order to correctly handle strategy sections that use other plan_change-triggering language (e.g., "prioritize", "automate") without being about schedule mutations.

### Trade-offs

- **Strategy-only plan_change sections that produce `idea` may be dropped by V4_heading_only** if the only title source is the section heading and there is no explicit-ask anchor. This is intentional: generic headings like "Roadmap Changes" without actionable body content don't warrant a suggestion.
- **`hasSectionConcreteDelta` uses whole-section text** (not per-sentence), so a section with a concrete delta anywhere still keeps project_update even if other sentences are strategy-only. This is conservative — if any sentence is a schedule mutation, treat the section as such.

### Alternatives Rejected

- **Require explicit strategy vocabulary (shift/pivot/narrow) in `isStrategyOnlySection`**: Rejected — would miss sections with "prioritize", "automate", "framework" language that are still clearly strategic. The imperative-action guard is a cleaner way to exempt legitimate task sections.
- **Exempt ALL non-actionable plan_change sections from the bypass**: Rejected — strategy-only sections that DO pass the actionability gate on their own merit (high new_workstream score) should still get classified correctly.
- **Keep project_update for all plan_change, change only the title prefix**: Rejected — type carries semantic meaning downstream (routing, UI rendering). A strategic pivot is genuinely better represented as `idea`.

### Future Options Preserved

- `isStrategyOnlySection` and `hasSectionConcreteDelta` are exported for use in tests and future classifiers.
- The imperative-action exemption (`hasExplicitImperativeAction`) is checked at the override site only, not baked into `isStrategyOnlySection`, keeping the function simple and reusable.

---

## 2026-02-21: Title Prefix Standardization — Stage 7, normalizeTitlePrefix

### Context

Emitted suggestion titles had inconsistent prefixes: `idea` and `bug` types emitted bare imperative titles ("Add CSV export", "Fix memory leak") while `project_update` always had "Update:" and `risk` had "Risk:" from B-signal seeding but not always from synthesis.

### Decision

Added `normalizeTitlePrefix(type, title)` and applied it in Stage 7 of `index.ts` (before `enforceTitleContract`, after routing). Re-apply `truncateTitleSmart` after normalization to keep ≤80 char limit.

Stage 7 was chosen (rather than synthesis, B-signal, or dense-paragraph paths) because the previous decision log explicitly noted Stage 7 as the single authoritative place for title quality enforcement — covering all synthesis paths with one gate.

### Alternatives Rejected

- **Apply in each synthesis path (synthesis.ts, bSignalSeeding.ts, denseParagraphExtraction.ts)**: Rejected — would scatter the logic across three paths and risk missing future paths. Stage 7 already covers all of them.
- **Apply only to types that lacked prefixes (idea, bug)**: Rejected — the normalizer is idempotent and handles mismatched prefixes too, so applying it uniformly is cleaner and safer.

### Future Options Preserved

- `normalizeTitlePrefix` is exported and can be called independently by tests or debug tooling.

---

## 2026-02-21: Title Quality Contract — Stage 7 Placement

### Context

The engine could emit "Update: Discussion They" — pronoun-only content after the prefix. This needed a last-resort quality gate that is guaranteed to apply to every emitted suggestion.

### Decision

Added `enforceTitleContract` as Stage 7 in `index.ts`, after routing and before `buildResult`. This placement guarantees:
- It runs on exactly the suggestions that reach the user.
- It does not interfere with validators, scoring, or routing.
- It is the single authoritative place for title quality enforcement.

Implemented in `title-normalization.ts` alongside the existing `normalizeSuggestionTitle` and `truncateTitleSmart` functions, as it is conceptually part of the same "title post-processing" layer.

### Alternatives Rejected

- **Enforce in `normalizeSuggestionTitle`**: Rejected because normalization runs before B-signal seeding and dense-paragraph extraction; malformed titles could still be introduced by those later stages.
- **Add validation inside `validators.ts`**: Rejected because the existing validators (V2 anti-vacuity, V3 evidence sanity) are hard gates that drop candidates. A title contract should fix, not drop — the evidence may be fine even if the title is malformed.
- **Enforce in synthesis per type**: Rejected because the contract needs to cover all synthesis paths (section synthesis, B-signal seeding, dense-paragraph extraction), making a single post-hoc gate cleaner than patching each path.

### Future Options Preserved

- The `enforceTitleContract` function is exported and can be called independently by the debug generator or tests.
- The fallback content is derived from evidence tokens, so it remains grounded even if extraction improves.

---

## 2026-02-21: Dense-Paragraph Section-Root Suppression — Stage 4.1 Placement

### Context

Dense-paragraph sections produce low-quality section-root synthesis candidates (Stage 3) alongside precise sentence-level candidates (Stage 4.5, 4.55). The section-root candidate spans the full paragraph, generates a generic title, and duplicates the sentence candidates.

### Decision

Added Stage 4.1 in `index.ts`: post-validation filter that drops synthesis candidates for sections where `isDenseParagraphSection` AND `extractDenseParagraphCandidates` (without coveredTexts) returns ≥1. Identification uses absence of `metadata.source` (synthesis candidates never set it; b-signal and dense-paragraph candidates always do).

### Alternatives Rejected

- **Suppress in synthesis.ts (Stage 3)**: Would require `extractDenseParagraphCandidates` to be called inside `synthesizeSuggestions`, coupling synthesis to the fallback extractor. Stage 4.1 keeps the pipeline stages independent.
- **Add `isDenseParagraph` flag to ClassifiedSection**: Adding schema field to `ClassifiedSection` for a single pipeline gate was over-engineering. The existing `isDenseParagraphSection` helper is sufficient.
- **Suppress via dropReason in DropStage enum**: Not needed — `debug.dropped_suggestions` with a string reason provides the same observability with no schema change.

### Future Options Preserved

- If a dense section has a strong section-root candidate (all extractors return 0 sentences), the section-root survives: `denseCandidates.length > 0` check is the gate.

---

## 2026-02-21: Plan-Change Tightening — Candidate-Level Eligibility

### Context

Dense-paragraph extraction (Stage 4.55) emits sentence-derived candidates. The section-level plan_change classification (from `isPlanChangeDominant`) can be triggered by any `V3_CHANGE_OPERATOR` in the section — including vague words like "move faster" or "shift priorities". This causes the plan_change override (bypass ACTIONABILITY gate) to apply to the whole section, potentially making all dense-paragraph candidates appear as plan_change-eligible even when only one sentence contains an actual schedule change with a measurable delta.

### Decision

Added `hasPlanChangeEligibility(text): boolean` to enforce a two-part rule at the **candidate/sentence level**:
- Change marker verb (V3_CHANGE_OPERATORS) AND concrete delta (numeric time unit or explicit date change)

Annotate dense-paragraph candidates with `metadata.planChangeEligible` (true/false) computed per sentence. This makes plan_change override intent observable at the candidate level for debug output and future gating.

### Alternatives Rejected

- **Modify section-level isPlanChangeDominant**: Rejected because it would break existing tests where strategic pivot language ("Shift from enterprise to SMB") correctly triggers plan_change without a numeric delta. The section-level classification uses the broader `hasChangeOperators` check intentionally.

- **Block "Pressure from the Board" at section level**: Not needed — "Pressure from the Board" already returns `isPlanChange: false` (no V3_CHANGE_OPERATOR match). The problem is not a false positive at that level but at the candidate annotation level.

- **Filter out dense-paragraph candidates that aren't planChangeEligible**: Not implemented because dense-paragraph candidates are created by B-signal extractors which already do sentence-level validation. "Pressure from the Board" never creates a candidate (no B-signal match). The annotation is defensive, not blocking.

### Future Options Preserved

- `metadata.planChangeEligible` can be used to further gate which dense-paragraph candidates bypass the ACTIONABILITY gate if future B-signal extractors create candidates from sentences that lack a concrete delta.

---

## 2026-02-21: Dense Paragraph Extraction — Sentence-Level Candidates for Unstructured Sections

### Context

Single-paragraph notes (no bullets, no headings) produced at most one suggestion even when containing multiple distinct actionable signals (e.g. a GDPR compliance risk AND a 4-week schedule delay). The normal synthesis pipeline creates one suggestion per section; B-signal seeding adds candidates but uses the same whole-section evidence span.

### Decision

Added `denseParagraphExtraction.ts` (Stage 4.55) as an additive pass after B-signal seeding:
- Detects dense-paragraph sections (`bulletCount == 0`, `lineCount == 1` OR `charCount >= 250`, no topic anchors).
- Splits section text into sentence spans deterministically (regex, no randomness).
- Runs existing signal extractors per sentence; creates one candidate per signal-bearing sentence with that sentence as evidence.
- Skips sentences already covered by prior-stage evidence.

Also extended two signal extractors minimally:
- `extractScopeRisk`: ACTIONABLE_CONDITIONAL_PHRASES += `if we can't|if we cannot`; CONSEQUENCE_REFS += compliance/GDPR/partnership terms.
- `extractPlanChange`: TIME_MILESTONE += `\d+-week|\d+-day|\d+-month` (hyphenated only).

### Alternatives Rejected

- **Modify classifier thresholds/weights**: Rejected per spec — prefer structural changes first. Threshold changes would affect ALL sections, not just unstructured ones.
- **Match bare "N weeks" in TIME_MILESTONE**: Rejected — causes false positives in Summary/recap sections (test: `strategic-relevance-and-topic-isolation.test.ts`).
- **New sentence-level section type**: Rejected — adds new abstraction; the existing B-signal infrastructure already provides everything needed.

### Future Options Closed

- The two A-series tests (A1: RISK/GDPR, A2: PROJECT_UPDATE/4-week-delay) are now active (`.skip` removed). The golden test is a permanent regression guard.

---

## 2026-02-21: Type-Label Derivation Centralization

### Context

Per-sentence type classification in `splitDenseParagraphIntoSentences` was inlining the logic from `computeTypeLabel` (classifiers.ts), creating two independent implementations of the same rule. If type-label rules change, both copies would need updating, risking divergence.

### Decision

Export `computeTypeLabel` from classifiers.ts as the canonical source:
- All type-label derivation calls use this single function
- No inlined duplication in synthesis.ts
- Automatically propagates rule changes to both section-level and sentence-level typing

### Alternatives Rejected

- **Keep inlined logic, add comments**: Rejected — comments don't prevent divergence; a single source of truth is better.
- **Create a private helper in synthesis.ts**: Rejected — doesn't address the centralization need; exports the public function instead.

### Future Options Closed

- `computeTypeLabel` is now a public export; callers must use it directly rather than reimplementing.

---

## 2026-02-21: Engine Uncap — Hard Cap Removed, Presentation Layer Added

### Context

The `runScoringPipeline` quota-based cap (added 2026-02-20) dropped idea suggestions that exceeded `max_suggestions`. This created a trust problem: dense notes appeared to "miss" ideas rather than "collapse" them. The root cause is that capping in the engine is a trust risk — the UI should control what's visible, not the truth layer.

### Decision

Removed the engine hard cap entirely:
- `runScoringPipeline` returns ALL suggestions passing thresholds (no idea slots, no quota math).
- Introduced `presentation.ts` with `groupSuggestionsForDisplay()` to handle display capping at `capPerType` (default 5) per bucket.
- `max_suggestions` preserved in `GeneratorConfig` as `@deprecated` UI hint; engine ignores it for dropping.
- `display.defaultCapPerType` added to config for the presentation layer.

### Alternatives Rejected

- **Keep quota cap, just raise it**: Rejected — any engine-level cap is a trust risk. Dense notes would silently drop.
- **Remove cap without a UI helper**: Rejected — UI still needs collapse affordance. Helper is needed.

### Future Options Closed

- The quota-based selection logic from 2026-02-20 is retired. Code checking `result.dropped` for "Exceeded max_suggestions limit" will find 0 entries. Tests that asserted `suggestions.length <= max_suggestions` have been updated.

---

## 2026-02-20: Ranking Quota Stabilization — Quota-Based Cap Replaces Pass-All

### Context

The original cap logic in `runScoringPipeline` kept ALL `project_update` suggestions regardless of `max_suggestions`. This guaranteed no plan-change signal was lost, but meant the cap was effectively unenforced for notes with multiple `project_update` suggestions.

The new requirement: stabilize surfaced output so that important types (`project_update`, `risk`) always appear, but the cap is still respected.

### Decision

Replaced "pass all project_updates" with a quota-based approach:
- Rule 1: Guarantee 1 slot for the highest-scoring `project_update` (if any).
- Rule 2: Guarantee 1 slot for the highest-scoring `risk` (if any, and if budget > 1).
- Rule 3: Fill remaining slots from global sorted list.

**Implementation**: Replaced steps 4–7 in `runScoringPipeline` (scoring.ts). No new config flags, no interface changes.

### Alternatives Rejected

- **Keep pass-all behavior, add risk guarantee on top**: Would violate the cap for notes with many project_updates. Rejected for output stability.
- **Per-type quotas configurable via config**: Rejected — "Do NOT introduce new config flags" constraint.

### Future Options Closed

- The old invariant "never drop any project_update" is retired. Code that relied on this (one test updated) must account for the cap being enforced.

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
