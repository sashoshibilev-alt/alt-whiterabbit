# Current State

## Type Tie-Breaker & Plan-Change Tightening — Stage 4.59 (2026-02-22)

**Files**: `classifiers.ts`, `scoring.ts`, `type-tiebreaker.test.ts`

### Problem

Strategy-only plan_change sections (e.g. "Shift from enterprise to SMB", "Narrow our focus to self-serve onboarding") were emitting as `project_update` even though they describe strategic direction, not a schedule mutation. The ACTIONABILITY gate was bypassed unconditionally for all plan_change sections.

### Solution

**Part A — ACTIONABILITY gate tightened:**
`isActionable()` now bypasses the gate only when the section contains a **concrete delta** (numeric duration: "4-week delay", "2 months", "14 days") or a **schedule-event word** (deploy, launch, release, ETA, deadline, milestone). Strategy-only language ("shift from X to Y", "pivot the go-to-market approach") falls through to normal actionability evaluation.

Two new exported functions added to `classifiers.ts`:
- `hasSectionConcreteDelta(text)` — returns true for measurable time-bounded changes
- `isStrategyOnlySection(text)` — returns true when no concrete delta AND no schedule-event word

**Part B — Strategy-only sections prefer idea over project_update:**
- `computeTypeLabel()`: strategy-only + no bullets → returns `'idea'` instead of `'project_update'`
- `classifySection()`: four override points updated with `!_isStrategyOnly` guards
- STRATEGY-ONLY OVERRIDE: downgrades `project_update → idea` for strategy-only sections, **exempt** when `hasExplicitImperativeAction` (e.g. "Remove deprecated feature flags")
- `scoring.ts` normalization: `isStrategyOnlySection` guard prevents forcing strategy-only idea → project_update

### Behavior Change

| Section type | Before | After |
|---|---|---|
| "Shift from enterprise to SMB" | `project_update` | `idea` |
| "Narrow our focus to self-serve onboarding" | `project_update` | `idea` |
| "Ham Light deployment has slipped by 2 weeks" | `project_update` | `project_update` (unchanged) |
| "V1 launch 12th → 19th" | `project_update` | `project_update` (unchanged) |
| "Remove deprecated feature flags" (imperative) | `project_update` | `project_update` (exempt from override) |

### Invariants Preserved

- CloudScale note (4-week delay + GDPR risk): still emits `project_update` + `risk`
- Canonical gold note (12th → 19th): still emits `project_update`
- Imperative action sections: still emit correctly (not reclassified)
- Sections with explicit imperatives are exempt from the STRATEGY-ONLY OVERRIDE

### Tests

**New file**: `type-tiebreaker.test.ts` (26 tests)
- `hasSectionConcreteDelta` unit tests (6)
- `isStrategyOnlySection` unit tests (8)
- Agatha mixed note golden tests (7): strategy sections → idea, Ham Light → project_update, Security → risk
- CloudScale non-regression (2)
- Canonical gold non-regression (2)

**Updated tests** to reflect new behavior:
- `plan-change-invariants.test.ts`: Invariants A1/A2 accept `idea | project_update`
- `suggestion-engine-v2.test.ts`: ACTIONABILITY invariant accepts `idea | project_update`; "always yields" test uses a concrete-delta note
- `body-generation.test.ts`: Two fixtures updated to use concrete-delta notes (not strategy-only)

---

## Title Prefix Standardization — Stage 7 (2026-02-21)

**Files**: `title-normalization.ts`, `index.ts`, `title-contract.test.ts`

### Problem

Emitted suggestion titles had inconsistent prefixes by type:
- `project_update` / `plan_change`: already had "Update:"
- `risk`: had "Risk:" from bSignalSeeding, but bare titles from synthesis
- `idea`: had bare imperative verbs (no prefix)
- `bug`: had bare "Fix …" (no prefix)

### Solution

Added `normalizeTitlePrefix(type, title)` to `title-normalization.ts`, applied in Stage 7 of `index.ts` before `enforceTitleContract`. After prefix normalization, `truncateTitleSmart` is re-applied to keep titles within 80 chars.

**Contract:**
- `project_update` / `plan_change` → "Update: <content>"
- `risk` → "Risk: <content>"
- `idea` → "Idea: <content>"
- `bug` → "Bug: <content>"

**Rules (idempotent):**
1. If title already has correct prefix (case-insensitive match) → normalise casing only.
2. If title has a wrong prefix (e.g. "Update: ..." for a risk) → replace prefix, keep content.
3. If title has no known prefix → prepend expected prefix.
4. No double prefixes — applying twice produces the same result.

### Invariants Preserved

- **Canonical gold title** `"Update: V1 launch 12th → 19th"` passes unchanged.
- **plan_change invariant** "Update: <X>" is preserved.
- No synthesis logic, thresholds, or classifiers changed.

### Tests

**File**: `title-contract.test.ts` (12 new tests added, 29 total)
- Each type: bare title gets correct prefix.
- Mismatched prefix is replaced (e.g., "Update: GDPR..." for risk → "Risk: GDPR...").
- No double prefixes after repeated application (idempotent).
- Canonical gold title passes unchanged.

---

## Title Quality Contract — Stage 7 (2026-02-21)

**Files**: `title-normalization.ts`, `index.ts`, `title-contract.test.ts`

### Problem

The synthesis pipeline could produce titles like "Update: Discussion They" — where the content portion after the prefix consists entirely of pronouns ("They", "We") or generic words ("Discussion", "General") with no concrete entity. These titles are uninformative and confusing.

### Solution

Added `enforceTitleContract(type, title, evidenceSpans)` to `title-normalization.ts`. This is applied as **Stage 7** in `index.ts` — the last step before `buildResult`, after routing — so it only touches suggestions that actually reach the user.

**Contract (applied to content portion, after any prefix like "Update:"):**
1. Strip leading stopwords/pronouns from the content.
2. Require ≥3 meaningful tokens (excluding stopwords/pronouns/generics).
3. Reject content where every token is a pronoun or generic word.
4. On failure: apply a deterministic fallback by type, derived from evidence tokens only.

**Fallback by type:**
- `project_update`: `"<entity> <delta>"` if entity + delta tokens exist; `"<entity> delayed"` if entity only; `"Timeline adjustment identified"` if no evidence tokens.
- `risk`: `"<entity> risk identified"` or `"Risk identified"`
- `idea`: `"<entity> improvement"` or `"Idea identified"`
- `bug`: `"<entity> issue"` or `"Bug identified"`

### Invariants Preserved

- **Canonical gold title** `"Update: V1 launch 12th → 19th"` passes unchanged (has 4 meaningful tokens).
- **No invented content**: fallback entity extraction uses evidence span tokens only.
- **No threshold/classifier changes**: purely post-processing on the title string.
- **Prefix preserved**: "Update:", "Risk:", etc. are kept; only the content portion is validated.

### Tests

**File**: `title-contract.test.ts` (17 tests, all passing)
- Pronoun-only content replaced: "Update: Discussion They", "Update: They We", etc.
- Canonical gold title "Update: V1 launch 12th → 19th" passes unchanged.
- Fallbacks are grounded in evidence tokens (no invented entities).
- Type-generic fallbacks when evidence is empty.
- Regression guard: no emitted title matches the "Update: Discussion They" pattern.

---

## Dense-Paragraph Section-Root Suppression (Stage 4.1) (2026-02-21)

**Files**: `index.ts`, `golden-dense-paragraph-cloudscale.test.ts`

### Problem

When a section qualified as a dense paragraph, the engine emitted both:
1. A section-root synthesis candidate (Stage 3) — e.g. "Update: Discussion They" — spanning the entire section body, with no `metadata.source`.
2. Sentence-level candidates (Stage 4.5 B-signal, Stage 4.55 dense-paragraph) — precise, grounded in individual sentences.

The section-root candidate was low-quality: it lost sentence-level grounding, produced a generic title from the full paragraph, and appeared redundant/contradictory alongside the precise sentence candidates.

### Solution

Added **Stage 4.1** in `index.ts` between Stage 4 (validation) and Stage 4.5 (B-signal seeding).

For each validated synthesis candidate (identified by absence of `metadata.source`):
- If `isDenseParagraphSection(section)` is true AND `extractDenseParagraphCandidates(section)` (called without `coveredTexts`) returns ≥1 candidate → drop with `reason: 'dense_paragraph_sentence_candidates_present'`.

Downstream stages (4.5, 4.55, 4.6+) operate on `filteredValidatedSuggestions` instead of `validatedSuggestions`.

### Behavior change

- CloudScale dense-paragraph note: was 3 suggestions (1 section-root + 2 b-signal), now 2 suggestions (2 b-signal only).
- Structured/bulleted sections: unaffected — `isDenseParagraphSection` returns false for sections with bullets.
- Canonical gold notes: unaffected — those sections are not dense paragraphs.

### Tests

**File**: `golden-dense-paragraph-cloudscale.test.ts` (4 tests, all active)
- A1: RISK grounded in GDPR sentence — passes.
- A2: PROJECT_UPDATE grounded in 4-week delay — passes.
- A3: Smoke test (grounding invariant) — passes.
- A4 (new): Must NOT emit a section-root synthesis candidate (no `metadata.source`) — passes.

---

## Plan-Change Tightening: Candidate-Level Eligibility (2026-02-21)

**Files**: `classifiers.ts`, `denseParagraphExtraction.ts`, `index.ts`, `plan-change-tightening.test.ts`

### Problem

Dense-paragraph extraction (Stage 4.55) emits sentence-level candidates. Previously, vague pressure language ("Pressure from the Board to get this live") could promote a section to plan_change intent at the section level, potentially causing the plan_change override (bypass ACTIONABILITY gate) to bleed into all sibling candidates — not just the sentence containing the actual schedule change.

### Solution

Added `hasPlanChangeEligibility(text): boolean` — a new exported function in `classifiers.ts` that requires **both**:
- A) A change marker verb from `V3_CHANGE_OPERATORS` (delay, push, slip, move, etc.), AND
- B) A concrete delta from `PLAN_CHANGE_CONCRETE_DELTA`:
  - Numeric time unit: "4-week", "2 weeks", "14 days", "1 sprint"
  - Explicit date change: "12th → 19th", "from the 12th to the 19th", "from June to August", "delayed to Q3", "pushed until March"

Dense-paragraph candidates now carry `metadata.planChangeEligible: boolean` so debug output can show which candidates qualify for plan_change override independently of their parent section's intent.

### Section-level intent unchanged

The section-level `isPlanChangeDominant` flag (and `isPlanChangeIntentLabel`) is **not changed** — it continues to use the broad `hasChangeOperators` check (any V3_CHANGE_OPERATOR without requiring a delta). This preserves behaviour for strategic pivot language like "Shift from enterprise to SMB customers." which correctly classifies as plan_change.

### Behavior

- `hasPlanChangeEligibility("We're looking at a 4-week delay…")` → `true`
- `hasPlanChangeEligibility("Pressure from the Board to get this live…")` → `false`
- `hasPlanChangeEligibility("Shift from enterprise to SMB customers.")` → `false` (no date delta)
- Dense paragraph candidates: "4-week delay" sentence → `planChangeEligible: true`; GDPR risk sentence → `planChangeEligible: false`; "Pressure from Board" → no candidate emitted (no B-signal match)

### Tests

**File**: `plan-change-tightening.test.ts` (25 tests, all passing)
- A) 8 positive tests for `hasPlanChangeEligibility` (change marker + concrete delta)
- B) 6 negative tests for `hasPlanChangeEligibility` (vague language, no delta, strategic pivot)
- B-ext) 2 section-level tests: "Pressure" → not plan_change, no project_update emitted
- C) 6 integration tests: CloudScale dense-paragraph candidate metadata + full engine output
- D) 3 canonical gold note tests: V1 launch 12th→19th still qualifies

---

## Dense Paragraph Candidate Extraction (2026-02-21)

**Files**: `denseParagraphExtraction.ts` (new), `index.ts`, `signals/extractScopeRisk.ts`, `signals/extractPlanChange.ts`, `golden-dense-paragraph-cloudscale.test.ts`

When a note section has no bullets and no topic anchors (e.g. a single long meeting-notes paragraph), the engine now runs a fallback pass after B-signal seeding that splits the section text into sentence spans and emits one candidate per signal-bearing sentence.

### Trigger condition

`isDenseParagraphSection(section)` returns `true` when:
- `bulletCount == 0` AND
- (`lineCount == 1` OR `charCount >= 250`) AND
- no topic anchor keywords at body line starts

### Behavior

- `denseParagraphExtraction.ts`: sentence splitting using `split(/(?<=[.!?])\s+/)` + lowercase-start re-joining; per-sentence signal extraction; process-noise suppression; covered-text dedup.
- Stage 4.55 in `index.ts`: runs after B-signal seeding; passes `coveredTexts` so it only fills genuine gaps.
- `metadata.source === 'dense-paragraph'` on emitted candidates; grounding invariant in `isSuggestionGrounded` covers them (same as `b-signal`).
- Counter `denseParagraphCounter` reset at `generateSuggestions()` entry for determinism.

### Signal extractor changes

- `extractScopeRisk`: added `if we can't|if we cannot` to ACTIONABLE_CONDITIONAL_PHRASES; added `compliance|gdpr|partnership|dead in the water|data residency` to CONSEQUENCE_REFS.
- `extractPlanChange`: extended TIME_MILESTONE to include `\d+-week|\d+-day|\d+-month` (hyphenated only; bare "N weeks" excluded to avoid false positives in summary sections).

### Invariants preserved

- Grounding invariant: every evidence span text is a verbatim substring of section `raw_text`.
- Determinism: same input → same counter resets → same candidate order → same output.
- No process-noise suggestions: `shouldSuppressProcessSentence` applied per sentence.
- Existing B-signal/synthesis suppression unaffected.

---

## Type-Label Centralization Fix (2026-02-21)

**Files**: `classifiers.ts`, `synthesis.ts`, `dense-paragraph-extraction.test.ts`

Centralized type-label derivation by exporting `computeTypeLabel` from classifiers.ts. Previously, per-sentence type classification in `splitDenseParagraphIntoSentences` was inlining duplicate logic, risking divergence if type-label rules changed in classifiers but not in synthesis.

### Change

- Export `computeTypeLabel` from classifiers.ts as the canonical source of type-label derivation
- Import and call it in synthesis.ts instead of inlined if/else
- Add centralization invariant test verifying both paths produce identical results

### Invariants Preserved

- No behavior change — refactoring only
- All 820 tests pass (23 tests in dense-paragraph-extraction.test.ts, including 2 new centralization tests)

---

## Engine Uncap + Presentation Helper (2026-02-21)

**Files**: `scoring.ts`, `types.ts`, `presentation.ts` (new), `index.ts`, `plan-change-invariants.test.ts`, `suggestion-engine-v2.test.ts`

The engine hard cap is removed. `runScoringPipeline` now returns ALL suggestions that pass validators → scoring → dedupe. The UI uses `groupSuggestionsForDisplay()` from `presentation.ts` to show top N per bucket.

### Behavior

- **Engine output**: all validated + grounded + deduped suggestions, no "Exceeded max_suggestions limit" drops.
- **Output ordering**: `project_update` first (sorted by `rankingScore`), then `idea` (sorted by `rankingScore`).
- **`max_suggestions`** in `GeneratorConfig`: kept for backward compatibility, marked `@deprecated` as UI hint only. Engine does not use it for dropping.
- **`display.defaultCapPerType`**: new field in `GeneratorConfig` (default: 5). Pass to `groupSuggestionsForDisplay()`.

### Presentation Helper (`presentation.ts`)

`groupSuggestionsForDisplay(suggestions, { capPerType })` returns:
- `buckets`: array of `{ key, title, total, shown, hiddenCount, hidden }` sorted in display order (risk → project_update → idea → bug).
- `flatShown`: all shown suggestions concatenated.
- Bucketing: `metadata.label === 'risk'` → "risk" bucket; `metadata.label === 'bug'` → "bug" bucket; else by `suggestion.type`.

### Invariant Preserved

The `invariant_plan_change_always_emitted` check in `index.ts` is updated from strict equality (`===`) to `>=` since type normalization in scoring can promote ideas to `project_update`, increasing the after-scoring count legitimately.

---

## Ranking Quota Stabilization (2026-02-20)

**Files**: `scoring.ts`, `plan-change-invariants.test.ts`

**SUPERSEDED by Engine Uncap (2026-02-21)**. The quota-based cap is removed. See entry above.

## B-Signal Candidate Seeding (2026-02-20)

**Files**: `index.ts`, `bSignalSeeding.ts`, `types.ts`, `b-signal-seeding.test.ts`, `debugGenerator.ts`, `debug.test.ts`

B-signal seeding is now active in both `generateSuggestions` (Stage 4.5) and `generateSuggestionsWithDebug` (Stage 4.5). The debug pipeline now mirrors production candidate pool.

### What it does

For each actionable section that produced at least one validated candidate, `seedCandidatesFromBSignals` runs all four B-signal extractors on the section's body text and appends novel candidates (those whose signal sentence is not already covered by an existing validated candidate's evidence) to the validated list before scoring.

### Constraints

- Only fires for sections with at least one validated candidate (respects suppression logic from stages 1–4).
- Cross-deduplication: signal sentence already in existing evidence → candidate skipped.
- B-signal candidates carry `metadata.source = "b-signal"` for identification.
- Title templates: FEATURE_DEMAND → "Implement {obj}", PLAN_CHANGE → "Update {obj} plan", SCOPE_RISK → "Mitigate risk to {obj}", BUG → "Fix {obj} issue".
- Object extraction uses simple regex (no NLP library).
- `debugGenerator.ts` IS seeded (Stage 4.5 wired in 2026-02-20) — debug pipeline mirrors production candidate pool.

## Discussion Details B-lite Explicit Ask Path (2026-02-09)

**Files**: `synthesis.ts`, `scoring.ts`, `debugGenerator.ts`, `discussion-details-explicit-asks.test.ts`

Implemented B-lite synthesis path for Discussion details sections with explicit request language, fixing two critical bugs in type handling and title generation.

### Problem 1: Type Override

Suggestions created by the B-lite path with `type: 'idea'` were being overwritten to `type: 'project_update'` by the scoring pipeline's type normalization logic, which unconditionally applied section-level type decisions without respecting explicitly set types.

### Problem 2: Broken Title Generation

Titles extracted from explicit asks had two bugs:
1. Article-stripping regex was malformed (`(?:a|an|the\s+)?` instead of `(?:(?:a|an|the)\s+)?`), causing incorrect substring captures
2. Contextual break patterns checked " noted " before sentence breaks (`.`), causing titles to include trailing commentary like ". Leo"

### Solution: B-lite Explicit Ask Detection

**Implementation** (`synthesis.ts` lines 1407-1575):

1. **Explicit Request Detection**:
   - Patterns: "asks for", "request", "would like", "need", "want"
   - Applied to Discussion details sections without topic anchors
   - Returns first line/sentence containing explicit request language

2. **Title Generation** (`generateTitleFromExplicitAsk()`):
   - Fixed article-stripping regex: `(?:(?:a|an|the)\s+)?` matches article + space as unit
   - Reordered contextual breaks: check sentence break (`.`) FIRST before " noted ", " said ", etc.
   - Extracts clean ask: "Offline mode for mobile and a 1-click AI summary button"
   - Stops at sentence boundaries or contextual clauses (but, however, noted, said, etc.)

3. **B-lite Synthesis Path** (`synthesizeSuggestions()` lines 2108-2205):
   - For Discussion details with explicit requests: create `type: 'idea'` suggestion
   - Set `structural_hint: 'explicit_ask'` to mark as explicitly typed
   - Use title from `generateTitleFromExplicitAsk()`
   - Extract evidence from ask line
   - Skip normal synthesis/fallback path

### Solution: Type Precedence Rule

**Implementation** (`scoring.ts` lines 495-506):

Added precedence check in `runScoringPipeline()` type normalization:
```typescript
const hasExplicitType = s.structural_hint === 'explicit_ask' ||
                       (s.structural_hint && s.structural_hint !== section.typeLabel);

if (hasExplicitType) {
  return s; // Respect explicitly set type - do not override
}
```

**Behavior**:
- Suggestions with `structural_hint: 'explicit_ask'` maintain their `type: 'idea'`
- Section-level type normalization only applies when suggestion doesn't have explicit type
- Prevents scoring pipeline from overwriting synthesized types

### Tests

**File**: `discussion-details-explicit-asks.test.ts` (8 tests, all passing)

- B-lite suggestions emit with `type: 'idea'` (not `project_update`)
- Titles are clean: no "N " prefix, no discussion commentary
- No "Review:" fallback for explicit asks
- No INTERNAL_ERROR for explicit asks
- Evidence spans correct
- Works for all request patterns: "asks for", "request", "would like", "need"

### Minimal Diff

- **synthesis.ts**: 291 lines added (B-lite detection + title generation with fixes)
- **scoring.ts**: 11 lines added (type precedence check)
- **debugGenerator.ts**: 95 lines added (B-lite path in fallback, mirrors synthesis)
- **discussion-details-explicit-asks.test.ts**: 278 lines (new test file)
- **No changes** to: thresholds, validators, routing, classifiers, evidence extraction core logic
- **All existing tests pass**: 321 tests across suggestion-engine-v2 (12 skipped)

### Contract Changes

**Suggestion.structural_hint**:
- Now used as type precedence indicator in scoring pipeline
- Value `'explicit_ask'` signals that suggestion type is authoritative
- Prevents section-level type normalization from overriding synthesis decision

**Title Generation**:
- `generateTitleFromExplicitAsk()` exported for use in debugGenerator
- Deterministic title extraction with contextual break detection
- Handles article stripping correctly
- Stops at sentence breaks and discussion commentary

---

## Strategic Relevance Suppression & Topic Isolation (2026-02-09)

**Files**: `synthesis.ts`, `debugTypes.ts`, `types.ts`, `strategic-relevance-and-topic-isolation.test.ts`

Implemented two tightly-scoped quality improvements to filter low-value suggestions and prevent cross-topic leakage in mixed sections.

### Problem 1: Low-Relevance Suggestions

The engine emitted technically actionable suggestions that are not useful to show right now:
- Generic summary sections (e.g., "💡 Summary", "Overview")
- "Next steps" task lists that are administrative
- Internal culture/naming conventions without delivery impact (e.g., "rename servers to Game of Thrones names")

### Problem 2: Mixed-Topic Sections

Long "Discussion details" sections with multiple topics caused cross-topic leakage during synthesis:
- Example: "New Feature Requests" evidence → "Game of Thrones server names" appearing in output
- Single section containing unrelated topics (features, timelines, culture) synthesized together

### Solution: Post-Synthesis Suppression

**Implementation** (`synthesis.ts` lines 1415-1478):

Added `shouldSuppressCandidate()` function that runs **after synthesis** but **before emitting**:

1. **Next Steps Suppression (Rule A)**:
   - Headings: "Next steps", "Action items", "Follow-ups", "TODO" (case-insensitive, works with emoji)
   - Suppresses ALL candidates from these sections

2. **Summary/Recap Suppression (Rule B)**:
   - Keywords: "summary", "overview", "tl;dr", "recap"
   - Detects emoji headings (e.g., "💡 Summary", "🚀 Next steps")
   - Suppresses ALL candidates from summary-type sections

3. **Low-Impact Culture Suppression (Rule C)**:
   - Culture markers: "naming convention", "server naming", "rename", "meeting-free", "wednesdays", "ritual", "culture shift", "avoid confusion"
   - Hard delivery signals (exemptions): project name, numeric delta (days/weeks/sprints), date references (Q1-Q4, ISO dates), customer impact words
   - Suppresses ONLY if culture marker present AND no hard delivery signals

**Behavior**:
- Candidates marked with `dropStage = POST_SYNTHESIS_SUPPRESS` and `dropReason = LOW_RELEVANCE`
- Debug explainability preserved (candidates dropped but reason recorded)
- Deterministic rules, no ML/embeddings

### Solution: Topic Isolation

**Implementation** (`synthesis.ts` lines 1480-1585):

Added section splitting logic to prevent cross-topic evidence leakage:

1. **Split Trigger** (`shouldSplitByTopic()`):
   - Explicit "Discussion details", "Discussion", or "Details" heading
   - OR bulletCount >= 5 OR charCount >= 500
   - AND body contains at least one topic anchor

2. **Topic Anchors** (deterministic labels):
   - "New Feature Requests:"
   - "Project Timelines:"
   - "Internal Operations:"
   - "Cultural Shift:"

3. **Sub-Section Creation** (`splitSectionByTopic()`):
   - Split section into sub-blocks by topic anchors
   - Each sub-block gets isolated section_id (e.g., `sec_abc_sub0`, `sec_abc_sub1`)
   - Evidence spans constrained to sub-block boundaries
   - Synthesis runs independently per sub-block

**Behavior**:
- "Discussion details" with mixed topics → split into isolated sub-sections
- Project Ares suggestion body DOES NOT contain "offline mode" or "Game of Thrones"
- Suppression rules (Rule C) still apply to sub-blocks (e.g., culture shift sub-block suppressed)
- No splitting if no topic anchors detected (returns original section)

### Tests

**File**: `strategic-relevance-and-topic-isolation.test.ts` (12 tests, all passing)

**Suppression Tests** (7 tests):
- Emoji headings: "💡 Summary", "🚀 Next steps" suppressed
- Explicit headings: "Next Steps", "Action Items" suppressed
- Culture markers: naming/ritual suppressed when no hard delivery signals
- Hard signals: Project Ares delay (14 days, Q2 2025, customer beta) NOT suppressed
- Project name reference: culture shift with "Project Zenith" NOT suppressed

**Topic Isolation Tests** (5 tests):
- "Discussion details" section split by topic anchors, no cross-topic leakage
- Long sections (bulletCount >= 5) split when topic anchors present
- Char count threshold (>= 500) triggers split with topic anchors
- Sections without anchors NOT split
- Combined: split + suppression work together

### Pipeline Integration

**Modified `synthesizeSuggestions()`** (`synthesis.ts` lines 1640-1730):

1. Pre-existing derivative content check (summary heading or 70% overlap)
2. **NEW**: Topic isolation check → split if needed
3. Decision table normalization (status marker stripping, duplicate detection)
4. Synthesis per section/sub-section
5. **NEW**: Post-synthesis suppression → check `shouldSuppressCandidate()`
6. If suppressed: mark dropStage/dropReason, skip emitting
7. Track evidence for derivative detection

### Type System Changes

**`debugTypes.ts`**:
- Added `DropStage.POST_SYNTHESIS_SUPPRESS`
- Added `DropReason.LOW_RELEVANCE`
- Updated `DROP_REASON_STAGE` mapping

**`types.ts`**:
- Added `dropStage?: string` to Suggestion interface
- Added `dropReason?: string` (new field, prefer over legacy `drop_reason`)

### Minimal Diff

- **synthesis.ts**: 370 lines added (suppression + topic isolation functions + pipeline modifications)
- **debugTypes.ts**: 2 enum values added + 1 mapping entry
- **types.ts**: 2 fields added to Suggestion interface
- **strategic-relevance-and-topic-isolation.test.ts**: 380 lines (new test file, 12 tests)
- **No changes** to: thresholds, scoring, validators, routing, classifiers, evidence extraction core logic
- **All existing tests pass**: 302 tests across suggestion-engine-v2 (12 skipped)

### Risks / Follow-ups

1. **Culture marker coverage**: May need to add more patterns if new culture topics appear in production
2. **Topic anchor coverage**: Currently supports 4 anchor labels; may need expansion for other meeting formats
3. **Sub-section actionability**: Split sub-blocks must still pass actionability gates; very short sub-blocks may be dropped
4. **Emoji detection**: Unicode ranges cover common emojis but may miss new emoji standards

---

## Derivative Content Suppression & Decision Table Normalization (2026-02-09)

**Files**: `synthesis.ts`, `derivative-suppression.test.ts`

Implemented two tightly-scoped quality improvements to prevent redundant suggestions and clean decision table outputs.

### Problem 1: Derivative Content (Summary/Overview Sections)

Some sections (e.g., "Summary", "Overview", "TL;DR", "Recap") restate information that already appears in more concrete sections. These derivative sections were emitting redundant suggestions.

### Problem 2: Decision Table Status Noise

Decision tables often include status columns ("Aligned", "Needs Discussion") that polluted suggestion titles and bodies. Duplicate decisions across rows were also being emitted.

### Solution: Derivative Content Suppression

**Implementation** (`synthesis.ts` lines 1260-1316):

1. **Added helper functions**:
   - `normalizeForDerivativeCheck()`: Normalize text for overlap detection (lowercase, strip punctuation, collapse whitespace)
   - `computeOverlapRatio()`: Calculate word-level overlap between section and emitted evidence (0-1 ratio)
   - `isDerivativeSection()`: Return true if overlap >= 70%
   - `isSummaryHeading()`: Detect summary-type headings

2. **Modified `synthesizeSuggestions()`** (lines 1505-1576):
   - Track `emittedEvidenceTexts` array as pipeline progresses
   - For each actionable section:
     - Check if heading is summary-type OR content overlap >= 70%
     - If derivative: skip synthesis entirely (no suggestion emitted)
     - If not derivative: synthesize and append evidence to tracker

**Behavior**:
- Summary/Overview/TL;DR/Recap sections suppressed when redundant
- 70% overlap threshold ensures only truly derivative content is suppressed
- Deterministic: word-based overlap, no ML/embeddings
- Evidence tracking is sequential: earlier sections always emit first

### Solution: Decision Table Normalization

**Implementation** (`synthesis.ts` lines 1318-1401):

1. **Added helper functions**:
   - `STATUS_MARKERS`: Regex patterns for common status markers (Aligned, Needs Discussion, Pending, etc.)
   - `containsStatusMarker()`: Check if text has status markers
   - `stripStatusMarkers()`: Remove status markers from text
   - `extractDecisionStatement()`: Extract first column from table rows (handles `|`, tabs, multi-space separators)
   - `areDecisionsDuplicate()`: Compare normalized decision texts for near-duplicates

2. **Modified `synthesizeSuggestions()`** (lines 1526-1562):
   - Track `emittedDecisions` array
   - For sections with status markers:
     - Extract clean decision from each line (first column, status stripped)
     - Check if decision was already emitted (duplicate detection)
     - Skip duplicate decision lines
     - If all lines are duplicates: skip entire section
   - Create `processedSection` with cleaned lines and raw_text

**Behavior**:
- Status markers ("Aligned", "Needs Discussion") removed from suggestion bodies
- Decision statements extracted from first column of tables
- Duplicate decisions suppressed (e.g., same decision with different status)
- Supports pipe-separated (`|`), tab-separated, and multi-space column formats
- Deterministic text comparison

### Tests

**File**: `derivative-suppression.test.ts` (15 tests, all passing)

**Derivative Content Tests** (6 tests):
- Summary section suppressed when redundant
- TL;DR section suppressed with high overlap
- Overview section suppressed at >= 70% threshold
- Sections below 70% NOT suppressed
- Multiple concrete sections before summary
- Recap heading recognized

**Decision Table Tests** (6 tests):
- Status markers stripped from decision text
- Table-formatted decisions with pipe separators handled
- Duplicate decisions suppressed across rows
- First column extracted from multi-column tables
- Decisions without table structure but with status markers
- Clean decisions preserved (no status markers)

**Combined Tests** (3 tests):
- Decision table with summary section
- Deterministic across multiple runs
- All-duplicate decision section suppressed

### Minimal Diff

- **synthesis.ts**: 169 lines added (helper functions + pipeline modifications)
- **derivative-suppression.test.ts**: 348 lines (new test file)
- **No changes** to: thresholds, scoring, validators, routing, classifiers, evidence extraction
- **All existing tests pass**: 290 tests across suggestion-engine-v2

### Risks / Follow-ups

1. **Overlap threshold tuning**: 70% threshold may need adjustment based on production data
2. **Status marker coverage**: May need to add more status patterns if new ones appear
3. **Column separator detection**: Currently handles `|`, tabs, and multi-space; may need refinement for edge cases

---

## Idea Title Generation: Proposal and Friction Based (2026-02-08)

**Files**: `synthesis.ts`, `body-generation.test.ts`

Fixed IDEA suggestion titles to be contentful (proposal/friction-based) instead of heading-based, making them suitable for pushing into Linear/Jira.

**Problem**: IDEA titles defaulted to "New idea: <Heading>" (e.g., "New idea: Customer Feedback"), which is not appropriate for issue trackers. The proposal-first and friction heuristics already existed for body generation but were not applied to title generation.

**Requirements**:
- Implement idea title generation with priority:
  1. If proposal line(s) detected → generate title from first proposal (no "New idea:" prefix)
  2. Else if friction heuristic fires → generate title from friction template (no "New idea:" prefix)
  3. Else fallback to existing behavior: "New idea: <Heading>"
- Keep title concise: ≤80 chars, truncate safely without cutting mid-word
- Reuse existing normalization helpers (strip list markers, smart quotes, etc.)

**Solution**: Modified `generateIdeaTitle()` in `synthesis.ts`:

1. **Added helper functions** (lines 139-191):
   - `truncateTitle()`: Safely truncate to max length without cutting mid-word
   - `generateTitleFromProposal()`: Strip list markers, capitalize, truncate to 80 chars
   - `generateTitleFromFriction()`: Create solution-shaped title (e.g., "Reduce clicks to complete annual attestations")

2. **Modified `generateIdeaTitle()`** (lines 193-255):
   - Added proposal-first check: if proposal lines found, generate title from first proposal (no prefix)
   - Added friction heuristic check: if friction complaint detected, generate solution-shaped title (no prefix)
   - Preserved existing fallback logic: heading-based "New idea: <Heading>" or generic patterns

**Behavior Change**:
- Proposal-based titles: "Reduce required steps by merging attestation screens" (was: "New idea: UX Improvement")
- Friction-based titles: "Reduce clicks to complete annual attestations" (was: "New idea: Attestation UX")
- Fallback titles still work when no proposal/friction found: "New idea: Dashboard Metrics"
- Titles are truncated to ≤80 chars, cutting at word boundaries

**Tests**: Added 5 regression tests in `body-generation.test.ts`:
- Proposal line generates contentful title without "New idea:" prefix
- Friction complaint generates solution-shaped title without "New idea:" prefix
- Fallback to "New idea: <Heading>" when no proposal/friction found
- Long proposal titles truncated to 80 chars without cutting mid-word
- Proposal prioritized over friction when both present

**Minimal Diff**:
- 53 lines added to `synthesis.ts` (3 new helper functions + modified title generation)
- 5 tests added to existing `body-generation.test.ts`
- No changes to actionability gates, thresholds, validators, scoring, routing, or body generation
- All existing tests pass (265 tests across suggestion-engine-v2)

---

## Body Generation Quality Fixes (2026-02-08)

**Files**: `synthesis.ts`, `body-generation.test.ts`

Two targeted quality fixes for suggestion body generation:

### Task A: Friction Complaint Detection for Idea Bodies

**Problem**: When Customer Feedback sections contain friction/clicks complaints without explicit proposals (e.g., "Enterprise customer reports frustration with the number of clicks required to complete annual attestations"), the body generation was extracting complaint noun phrases like "Complete annual attestations." instead of generating solution-shaped bodies.

**Solution**: Added friction complaint detection heuristic in `generateIdeaBody()` that runs after proposal-line check but before pattern fallback:

1. **Added friction detection** (`synthesis.ts` lines 418-471):
   - `FRICTION_MARKERS`: patterns for clicks, steps, friction, "takes too long", "difficult to", burden, cumbersome
   - `FRICTION_TARGET_PATTERNS`: attestation, workflow, flow, process, completion
   - `detectFrictionComplaint()`: checks for friction marker + target object, returns friction type
   - `generateFrictionSolution()`: creates solution-shaped body based on friction type:
     - "clicks" → "Reduce clicks required to [target]."
     - "steps" → "Reduce steps required to [target]."
     - generic → "Streamline [target] to improve usability."

2. **Modified `generateIdeaBody()`** (`synthesis.ts` line 422):
   - After proposal-line check, before existing fallback patterns
   - If friction complaint detected: generate solution body + add problem context if available
   - Preserves all existing proposal-first and fallback logic

**Behavior Change**:
- Friction complaints now emit solution-shaped bodies: "Reduce clicks required to attestations. Enterprise customer reports frustration..."
- Instead of noun phrase fallbacks: "Complete annual attestations."
- Only applies when no explicit proposal lines exist in section
- Minimal, rule-based heuristic (no ML/probabilistic)

**Tests**: Added 4 regression tests in `body-generation.test.ts`:
- Clicks friction → body contains "reduce" + "clicks" + target object
- Steps friction → body contains "reduce" + "steps" + target object
- Generic friction → body contains "streamline" + target object
- Proposal lines still take priority (no friction heuristic applied)

**Bug Fix (2026-02-08)**: Friction heuristic concatenation + punctuation cleanup

**Problem**: The friction heuristic was falling through to the fallback pattern extraction logic, causing:
1. Concatenation of friction template + raw evidence lines (including bullet markers like "•")
2. Concatenation with old fallback noun phrase extractions (e.g., "Complete annual attestations")
3. Double punctuation issues (.., . .)

**Root Cause**: After generating the friction solution body, the code continued executing the subsequent pattern-based extraction logic (lines 592-636) instead of returning early.

**Fix**:
1. **Early return in friction path** (`synthesis.ts` lines 527-561):
   - After generating friction solution + optional context, build final body and return immediately
   - Prevents fallthrough to purpose/goal patterns and fallback sentence extraction
   - Strip bullet markers from context lines using `normalizeForProposal()`
2. **Punctuation cleanup** added to both paths:
   - Friction path: clean double periods before returning
   - Main path: clean double periods in final body building (line 657)
   - Pattern: `.replace(/\.\s*\./g, '.').replace(/\s+\./g, '.')`

**Tests**: Added regression test `should not concatenate friction template with fallback noun phrase or include bullet markers`:
- Uses exact complaint line: "• Enterprise customer reports frustration with the number of clicks required to complete annual attestations."
- Asserts body contains "Reduce" and "click"
- Asserts body does NOT contain "•", "..", or "Complete annual attestations"
- Asserts body is at most 2 sentences and under 150 chars

### Task B: Role Assignment Punctuation Fix

**Problem**: `generateRoleAssignmentBody()` was joining lines that already ended with punctuation (e.g., "PM to document."), causing double punctuation in bodies: "impact.. Design.. CS.."

**Solution**: Strip trailing punctuation before joining lines.

1. **Modified `generateRoleAssignmentBody()`** (`synthesis.ts` line 703):
   - Before joining lines: strip trailing `.`, `;`, `:` (preserve `?`, `!`)
   - Then join with single `.`
   - Preserves existing 300-char max and all other behavior

**Behavior Change**:
- Role assignment bodies no longer contain `..`, `;.`, or `:.`
- Clean single-period joining: "PM to document requirements. Design to create mockups. CS to gather feedback."

**Tests**: Added 3 regression tests in `body-generation.test.ts`:
- No double periods in role assignment bodies
- Mixed punctuation (`;`, `:`, `.`) normalized correctly
- Content preserved when normalizing punctuation

**Minimal Diff**:
- 72 lines added to `synthesis.ts` (friction detection + punctuation normalization)
- 1 new test file: `body-generation.test.ts` (7 tests, all passing)
- No changes to classifiers, validators, scoring, routing, thresholds, or V3_ACTION_VERBS
- All existing tests pass (259 tests across suggestion-engine-v2)

---

## Action Items Body Generation for Role Assignments (2026-02-08)

**Files**: `synthesis.ts`, `suggestion-engine-v2.test.ts`

Improved body generation for role assignment sections to extract task lines instead of collapsing to timeline tokens.

**Problem**: After the role assignment flag change (Prompt 1), sections with `forceRoleAssignment=true` map to `plan_change` intent and `project_update` type. Title generation was correctly using "Action items: <Heading>", but body generation was routing through `generateProjectUpdateBody()`, which looks for change patterns ("shift to", "from X to Y") and timing. Role assignment lines like "PM to document..." don't match these patterns, causing thin fallback bodies like "Next quarter." when timeline tokens are present.

**Requirements**:
- Preserve robustness: role assignment sections remain `plan_change` (not dropped at ACTIONABILITY)
- Improve categorization/output: use action-items-style body generation
- Title: keep "Action items: <Heading>" (already correct from Prompt 1)
- Body: extract top 2-3 role assignment lines (e.g., "PM to document...", "CS to manage...")
- Respect `maxSuggestionsPerNote` and validators (no changes to gating logic)

**Changes**:

1. **Added `ROLE_ASSIGNMENT_PATTERNS`** (`synthesis.ts` line 633):
   - Array of regex patterns matching role assignment syntax: `/\bpm to\b/i`, `/\bcs to\b/i`, etc.
   - Mirrors the patterns from `classifiers.ts` V3_ROLE_ASSIGNMENT_PATTERNS
   - Used for extracting matching lines from section body

2. **Added `isRoleAssignmentLine()`** (`synthesis.ts` line 647):
   - Helper to check if a line contains a role assignment pattern
   - Uses `normalizeForComparison()` for consistent preprocessing

3. **Added `generateRoleAssignmentBody()`** (`synthesis.ts` line 653):
   - New body generation function for role assignment sections
   - Extracts lines matching role assignment patterns from body text
   - Takes top 2-3 lines (or fewer if less available)
   - Strips bullet markers, capitalizes first letter, formats as flowing text
   - Max 300 chars (consistent with other body generators)
   - Fallback: extracts meaningful sentences if no matches found (defensive)

4. **Modified `synthesizeSuggestion()`** (`synthesis.ts` line 920-928):
   - Added routing check: if `section.intent.flags?.forceRoleAssignment`, use `generateRoleAssignmentBody()`
   - Otherwise: fall through to existing logic (`generateProjectUpdateBody()` or `generateIdeaBody()`)
   - No changes to title generation, payload generation, or evidence extraction

**Behavior Change**:
- Role assignment sections now emit with bodies like: "PM to document feature requirements and acceptance criteria. CS to manage customer communication and set expectations. Design to create wireframes for new user dashboard."
- Instead of collapsing to thin bodies like "Next quarter." when timeline tokens are present
- Title remains "Action items: <Heading>" (unchanged from Prompt 1)
- Type remains `project_update`, intent remains `plan_change` (unchanged)
- Evidence spans unchanged (use existing extraction logic)

**Tests**: Added regression test "role assignment sections generate action-items-style bodies (not timeline tokens)" in `suggestion-engine-v2.test.ts`:
- Section with "Next Steps" heading, 4 role assignment bullets, and "Timeline: Next quarter." line
- Asserts title begins with "Action items:" and includes heading text
- Asserts body length > 20 chars (substantial content, not collapsed to timeline token)
- Asserts body does NOT equal "Next quarter."
- Asserts body includes at least 2 task indicators (verbs/roles/objects from task lines)

**Minimal Diff**:
- 53 lines added to synthesis.ts (patterns, helpers, new body generator, routing check)
- 1 test added to existing test suite
- No changes to classifiers, validators, scoring, routing, or evidence extraction

---

## Proposal-First Heuristic for Idea Synthesis (2026-02-08)

**Files**: `classifiers.ts`, `synthesis.ts`, `list-marker-normalization.test.ts`

Added a proposal-first heuristic for idea-type suggestions to prefer solution/proposal lines over complaint noun phrases when generating suggestion bodies and selecting evidence spans.

**Problem**: When sections contain both complaint/problem statements ("Employees are dissatisfied with too many clicks") and solution/proposal statements ("Reduce required steps by merging attestation screens"), the suggestion synthesis was treating both equally. This resulted in idea suggestions that emphasized the problem rather than the proposed solution.

**Requirements** (minimal diff):
- Define `PROPOSAL_VERBS_IDEA_ONLY` = ["reduce","merge","streamline","simplify","remove","eliminate","consolidate","log","cut"]
- Detect proposal lines by: (a) starts with proposal verb, OR (b) contains "by <verb+ing>" pattern
- For idea-type suggestions: prefer proposal lines for evidence spans and body text
- No changes to actionability thresholds, V3_ACTION_VERBS, validators, or routing
- Only affects idea-type suggestions (project_update unchanged)

**Changes**:

1. **Added PROPOSAL_VERBS_IDEA_ONLY** (`classifiers.ts` line 287):
   - Exported constant for use in synthesis module
   - Separate from V3_ACTION_VERBS (which affects actionability scoring)
   - Used only for idea synthesis, not for actionability detection

2. **Added proposal detection helpers** (`synthesis.ts` line 366):
   - `normalizeForProposal()`: strips list markers, lowercases (same as classifier preprocessing)
   - `isProposalLine()`: detects proposal verbs at line start OR "by <verb+ing>" pattern
   - Handles gerunds ("by merging" matches "merge", "by reducing" matches "reduce")

3. **Modified generateIdeaBody()** (`synthesis.ts` line 420):
   - Added proposal-first check before existing pattern-based extraction
   - If proposal lines found: use first proposal as primary, optionally add context/second proposal
   - If no proposal lines: fall back to existing problem/solution pattern extraction
   - Preserves all existing fallback logic

4. **Modified extractEvidenceSpans()** (`synthesis.ts` line 605):
   - For idea type: filter bodyLines to find proposal lines first
   - If proposal lines exist: use them as primary evidence (up to 2 lines)
   - Add context lines if room allows
   - For non-idea types: unchanged (existing list-item prioritization logic)

**Behavior Change**:
- Idea suggestions from sections with proposal lines now emphasize the solution/action in body and evidence
- Example: "Reduce required steps by merging attestation screens" preferred over "dissatisfied with too many clicks"
- Complaint/problem lines still available as context but not primary evidence
- No impact on actionability scoring, thresholds, or type classification

**Tests**: Added comprehensive test in `list-marker-normalization.test.ts`:
- Proposal line preferred over complaint line in idea body and evidence
- Evidence spans include proposal line (not only complaint line)
- Works with bullet markers (list normalization)
- Falls back to existing logic when no proposal found
- No impact on project_update suggestions

**Minimal Diff**:
- 36 lines added to classifiers.ts (PROPOSAL_VERBS_IDEA_ONLY + export)
- 201 lines added to synthesis.ts (proposal detection + modified body/evidence generation)
- 1 test added to existing list-marker-normalization.test.ts
- No changes to actionability gates, thresholds, validators, or routing logic

---

## Timeline vs Calendar Out-of-Scope Distinction (2026-02-08)

**Files**: `classifiers.ts`, `suggestion-engine-v2.test.ts`

Removed timeline-only tokens from calendar out-of-scope markers to prevent false out-of-scope drops when PM notes reference project timelines rather than scheduling tasks.

**Problem**: Sections mentioning "Q3", "next quarter", "end-of-quarter", "annual" were being dropped due to high calendar out-of-scope signal, even though these are timeline references describing when work should happen, not calendar scheduling tasks like "Schedule meeting next Thursday".

**Root Cause**: V3_CALENDAR_MARKERS (lines 432-460) included timeline-only tokens:
- Quarters: q1, q2, q3, q4, quarter
- Months: january, february, march, april, may, june, july, august, september, october, november, december

These triggered calendar out-of-scope signal at +0.6, causing sections with timeline language to be filtered out even when they contained actionable plan changes.

**Change**: Removed timeline tokens from V3_CALENDAR_MARKERS, keeping only true scheduling markers:
- **Kept**: weekdays (monday-sunday), "next week", "this week", "next month"
- **Removed**: q1, q2, q3, q4, quarter, all month names

**Behavior Change**:
- Timeline references like "Push to Q3", "Reassess next quarter", "Delay by 2 sprints" no longer trigger calendar out-of-scope
- True calendar scheduling like "Schedule meeting next Thursday" still triggers calendar out-of-scope at +0.6
- No threshold changes, no dominance logic changes
- Out-of-scope override (clamp to ≤0.3 when actionable signal ≥0.8) still works as before

**Tests**: Added 2 regression tests in "Timeline vs calendar out-of-scope distinction" describe block:
1. Timeline references (Q3, quarter, sprints) should NOT trip out-of-scope
2. True calendar scheduling (meeting, weekday) should trip out-of-scope

**Minimal Diff**: Modified only V3_CALENDAR_MARKERS array (removed 17 timeline tokens). No new patterns, no threshold changes, no new labels.

---

## Decision Marker and Role Assignment Intent Distribution (2026-02-08)

**Files**: `classifiers.ts`, `suggestion-engine-v2.test.ts`

Extended the intent score distribution logic to classify sections with decision markers or role assignments as plan_change (update/planning family) rather than new_workstream.

**Problem**: Meeting notes with "Decision" sections and "Next Steps" sections were being classified as `new_workstream` (and sometimes `status_informational`) even though they represent actionable updates to existing plans. This caused:
- Incorrect intent labels in debug JSON (new_workstream instead of plan_change)
- Incorrect type labels (idea instead of project_update)
- Potential downstream routing issues

**Root Cause**: The distribution heuristic `isPlanChangeDominant = hasChangeOperators || hasStructuredTasks` didn't account for sections that are actionable due to decision markers (Rule 10) or role assignments (Rule 9), even though these signals indicate planning/update content.

**Change**: Extended line 1099 in `classifiers.ts`:
```typescript
// Before:
const isPlanChangeDominant = hasChangeOperators || hasStructuredTasks;

// After:
const isPlanChangeDominant = hasChangeOperators || hasStructuredTasks || hasDecisionMarker || hasRoleAssignment;
```

**Behavior Change**:
- Decision sections (e.g., "Feature request will be logged in backlog. No near-term resourcing; revisit during next planning cycle.") now receive:
  - `intentLabel = plan_change` (was: new_workstream or status_informational)
  - `typeLabel = project_update` (was: idea or non_actionable)
  - `plan_change` signal gets full `maxActionableScore`
  - `new_workstream` gets partial signal (0.4 × maxActionableScore)

- Next Steps sections with role assignments (e.g., "PM to document... CS to manage...") now receive:
  - `intentLabel = plan_change` (was: new_workstream or status_informational)
  - `typeLabel = project_update` (was: idea)
  - Distribution same as decision markers

**Implementation**: No new keywords added. Reuses existing signals:
- `hasDecisionMarker` flag (set when Rule 10 fires, lines 988-990)
- `hasRoleAssignment` flag (set when Rule 9 fires, lines 983-985)

**Tests**: Added regression test "meeting notes with Decision and Next Steps are classified as plan_change/project_update" covering:
- Decision section: intentLabel=plan_change, typeLabel=project_update, not dropped at ACTIONABILITY
- Next Steps section: intentLabel=plan_change, typeLabel=project_update, not dropped at ACTIONABILITY
- Suggestions emitted with type=project_update

**Minimal Diff**: Change touches only the distribution condition (1 line modified). No new patterns, thresholds, or gates added.

---

## Intent Scoring Contract Restoration (2026-02-07)

**Files**: `types.ts`, `classifiers.ts`, `debugTypes.ts`, `DebugLedger.ts`, `synthesis.ts`, `suggestion-engine-v2.test.ts`

Fixed a bug where force routing flags (`_forceDecisionMarker`, `_forceRoleAssignment`) contaminated `intentClassification.scoresByLabel` in debug JSON, causing `topLabel` to become a flag name (e.g., "_forceDecisionMarker") with `topScore: true` instead of a numeric value, violating the intent scoring contract.

**Changes**:
1. **IntentClassification schema** (`types.ts`): Moved force flags from flat properties to nested `flags?: { forceRoleAssignment?: boolean, forceDecisionMarker?: boolean }` object
2. **ClassifierDistribution schema** (`debugTypes.ts`): Added `flags` field to store routing overrides separately from scores
3. **Debug ledger** (`DebugLedger.ts`): Filter out non-numeric properties when building `scoresByLabel` using `typeof value === 'number'` check; store flags separately at `intentClassification.flags`
4. **Routing logic** (`classifiers.ts`): Updated all flag checks from `intent._forceRoleAssignment` to `intent.flags?.forceRoleAssignment`
5. **Title template** (`synthesis.ts`): Role assignment sections now use "Action items: <Heading>" template instead of "Update <Heading> plan"
6. **Tests**: Added 4 regression tests verifying topScore is numeric, topLabel is valid, flags are stored separately, and role assignments use correct title template

**Contract Guarantees**:
- `intentClassification.topLabel` is always a valid intent label (plan_change, new_workstream, calendar, etc.), never a force flag
- `intentClassification.topScore` is always a number, never a boolean
- `intentClassification.scoresByLabel` only contains numeric values for valid intent labels
- `intentClassification.flags` contains routing overrides when present

**Behavior Change**: Role assignment sections (e.g., "PM to document") now emit with title "Action items: Next Steps" instead of "Update Next Steps plan", making the output clearer for task-like content.

**Regression Test**: "Leadership Alignment" section still correctly shows `plan_change` as `topLabel` (not contaminated by decision marker flag).

---

## Role Assignment and Decision Marker Detection (2026-02-07)

**Files**: `suggestion-engine-v2/classifiers.ts`, `suggestion-engine-v2/suggestion-engine-v2.test.ts`

Added two minimal actionability overrides to detect task assignments and decision statements that were previously scoring 0 actionableSignal:

**Changes**:
1. **Role assignment pattern (Rule 9)**: Detects "ROLE to VERB" micro-tasks (e.g., "PM to document", "CS to manage", "Eng to implement")
   - Score: +0.85 actionable signal
   - Patterns: PM to, CS to, Eng to, Design to, Project Manager to, etc. (9 patterns)

2. **Decision marker pattern (Rule 10)**: Detects decision language (e.g., "will be logged", "no near-term", "revisit", "agreed")
   - Score: +0.70 actionable signal
   - Markers: will be logged, will be, near-term, revisit, decided, agreed, approved (8 markers)

**Behavior Change**: "Next Steps" sections with role assignments and "Decision" sections with decision markers now pass the actionability gate (T_action = 0.5) and emit suggestions. Previously, these sections scored 0 and were dropped at ACTIONABILITY stage, causing synthesisRan=false in debug JSON.

**Implementation**: Both patterns are checked at the sentence level within the existing V3 actionability gate loop in `classifyIntent()`. Scores contribute to max actionableSignal for the section.

**Tests**: Added 4 regression tests covering both classification (actionable signal >= threshold) and synthesis (suggestions emitted with correct evidence spans).

**Note**: Decision sections containing calendar markers (q1-q4, month names) may still be filtered if outOfScopeSignal >= 0.4. The out-of-scope override (clamp to 0.3) only triggers for change operators or multiple action verbs, not decision markers alone.

---

## Numbered Section Heading Support (2026-02-07)

**Files**: `belief-pipeline/segmentation.ts`, `belief-pipeline.test.ts`, `suggestion-engine-v2/preprocessing.ts`, `suggestion-engine-v2.test.ts`

Fixed segmentation bug where numbered section headings (e.g., "1. Customer Feedback", "2. Options Discussed") were incorrectly parsed as list items, causing multiple sections to collapse into a single "General" section. This broke downstream intent classification and actionability gating.

**Changes**:
1. **Heading detection**: Added pattern `^\s{0,2}\d+\.\s+\S` to recognize numbered section headings before list item matching
2. **Indentation heuristic**: Up to 2 spaces indentation allowed to distinguish from nested list items (deeper indentation remains list item)
3. **Case-agnostic**: Supports both uppercase ("1. Customer Feedback") and lowercase ("1. next steps") headings
4. **Heading level**: Numbered headings are treated as level 2 headings (h2 equivalent)
5. **Processing order**: Numbered heading check occurs after markdown headings but before list item detection

**Implementation**:
- **belief-pipeline**: Implemented in `parseMarkdownBlocks()` with `^(\d+)\.\s+(.+)$` pattern at line 54-69
- **suggestion-engine-v2**: Implemented in `getLineType()`, `getHeadingLevel()`, and `getHeadingText()` functions with consistent behavior

**Behavior Change**: Notes using numbered section structure now segment correctly, with each numbered heading creating a distinct section. Downstream classification can now properly analyze each section's intent and actionability independently.

**Pattern Support**: Currently supports `\d+\.` (dot) format only. Parenthesis format `\d+\)` not added because existing list parsing doesn't support it either (maintains consistency).

**Tests**:
- belief-pipeline: 3 regression tests verifying uppercase/lowercase/indentation handling
- suggestion-engine-v2: 1 regression test verifying 5-section note segments correctly and heading text extraction works

---

## Sentence-Level Actionability Scoring (2026-02-07)

**Files**: `classifiers.ts`, `sentence-actionability.test.ts`

Fixed imperative detection to work at sentence level rather than line level. Previously, imperatives mid-line (e.g., "Users don't notice failures. Add inline alert.") were missed because the imperative verb "Add" was not at line start. Now each body line is split into sentence fragments before scoring, ensuring imperatives are detected regardless of position.

**Changes**:
1. **Sentence splitting**: Added `splitIntoSentences()` helper that splits on `.`, `!`, `?`, and `...` boundaries
2. **Smart quote normalization**: Added `normalizeSmartQuotes()` to convert `'` and `"` to ASCII before negation/imperative detection
3. **Scoring loop**: Modified `classifyIntent()` to evaluate each sentence fragment separately and take max score across fragments
4. **Shared logic**: Both `classifyIntent()` and `hasExplicitImperativeAction()` now use the same sentence splitting helper to prevent drift

**Behavior Change**: Sections with imperatives after sentence boundaries are now correctly marked as actionable (actionableSignal >= 0.9). Example: "Users don't see errors. Add inline alert." now triggers imperative floor.

**Tests**: Added 4 regression tests in `sentence-actionability.test.ts` covering mid-line imperatives, smart quotes, multiple sentences, and ellipsis boundaries.

---

## feature_request as First-Class Type (2026-02-05)

**Files**: `types.ts`, `classifiers.ts`, `synthesis.ts`, `scoring.ts`, `validators.ts`, `debugGenerator.ts`

Promoted `feature_request` from a structural hint to a first-class suggestion type alongside `plan_mutation` and `execution_artifact`. Prose-based feature requests now flow through the entire pipeline with their own type label.

**Type Model**:
- **`feature_request`**: Prose sections (no bullets, ≥20 chars, request stem OR action verb) with new_workstream intent
- **`execution_artifact`**: Bullet-based task lists or multi-step initiatives (unchanged)
- **`plan_mutation`**: Plan change sections (unchanged)

**Pipeline Integration**:
1. **Classification** (`classifiers.ts`): For new_workstream sections, if `computeTypeLabel()` returns `'feature_request'`, promote `suggested_type` from `'execution_artifact'` to `'feature_request'`
2. **Synthesis** (`synthesis.ts`): `feature_request` uses same title/payload generation as `execution_artifact` (both create draft_initiative)
3. **Scoring** (`scoring.ts`): `feature_request` treated like `execution_artifact` for threshold/capping (both cappable, not protected like `plan_mutation`)
4. **Validators** (`validators.ts`): V1 validator handles `feature_request` via the execution_artifact path; V3 evidence validator already supports feature_request relaxed validation
5. **Debug** (`debugGenerator.ts`): `afterTypeClassification` now receives `feature_request` type; flows to `typeClassification.scoresByLabel`, `typeClassification.topLabel`, `section.decisions.typeLabel`, and `candidate.metadata.type`

**Output Contract Change**:
- `SuggestionType` expanded: `'plan_mutation' | 'execution_artifact' | 'feature_request'`
- `suggestion.type` can now be `'feature_request'`
- `suggestion.structural_hint` can now be `'feature_request' | 'execution_artifact' | 'plan_mutation'` (set from final type label)
- Debug output: `typeClassification.scoresByLabel` now includes `feature_request` entries for prose feature requests
- Debug output: `candidate.metadata.type` now can be `'feature_request'`

**Backward Compatibility**: Downstream consumers checking `type === 'execution_artifact'` for non-plan types should update to `type !== 'plan_mutation'` to include feature_request.

**Tests**: Added 4 integration tests verifying feature_request flows correctly through typeClassification, scoresByLabel, and metadata.type fields.

---

## Classification Fixes (2026-02-05)

Three fixes to actionability, type classification, and segmentation hygiene:

### 1. Hedged directive recognition (classifiers.ts)
Added Rule 6b: hedged directive phrases ("we should", "we probably should", "maybe we need", "we may need to", "it would be good to", "let's"/"lets") are self-sufficient actionable signals at +0.9, without requiring a paired action verb. These map to new_workstream intent (not plan_change). The out-of-scope override (clamp to ≤0.3) now only fires when the high signal comes from a non-hedged rule, so hedged directives about admin tasks ("we should send an email") are still filtered.

Also fixed: out-of-scope calendar marker matching now uses word-boundary regex instead of substring includes, preventing false positives like "maybe" matching the "may" month marker.

### 2. Relaxed feature_request typing (classifiers.ts)
`computeTypeLabel` no longer requires single-line or ≤200 chars. Feature_request is now assigned when: intentLabel==new_workstream, bulletCount==0, body contains request stem OR action verb, and body has ≥20 non-whitespace chars. Execution_artifact remains the fallback for bullet-based task lists and multi-step drafts.

### 3. Empty section cleanup (preprocessing.ts)
Post-segmentation step (`removeEmptySections`) drops sections whose body is all whitespace. When an empty section precedes a non-empty one, its heading is merged (e.g., "Parent > Child"). Trailing empty sections are dropped entirely.

---

## FP3 Regression Fixes (2025-02-05)

Three changes to segmentation, actionability, and type gating:

### 1. Colon-heading segmentation (preprocessing.ts)
Lines ending with `:` (e.g., "Quick update on ingestion refactor:") are now recognized as section boundaries in `isPlainTextHeading()`. The punctuation check was updated to only reject `.?!`, allowing colons through. Heading text strips the trailing `:` for consistency with pseudo-headings.

### 2. "Should" request stem + action-verb bullet boost (classifiers.ts)
- Added `'should'` to `V3_REQUEST_STEMS` so "should add X" patterns trigger the strong request pattern rule (+1.0 signal).
- Added **Rule 7 (action-verb bullets)**: Sections with ≥2 bullets starting with action verbs (add, verify, update, etc.) are boosted to 0.8 actionableSignal, **guarded** by `maxOutOfScopeScore < 0.4` to avoid promoting generic admin task lists like "Send email" / "Schedule meeting".

### 3. Type gating: plan_mutation only for plan_change (classifiers.ts)
Added guards in both `classifySection()` and `classifySectionWithLLM()` to prevent non-plan_change sections from being assigned `plan_mutation` type. If a non-plan_change section matches mutation patterns, it is forced to `execution_artifact` instead.

**Impact**: "Dashboard improvements" (new_workstream) and "Execution follow-up" (new_workstream with action-verb bullets) now emit as execution_artifacts instead of being dropped as status_informational.

---

## Actionability Gate v3

**Location**: `src/lib/suggestion-engine-v2/classifiers.ts:classifyIntent()`

**Purpose**: Determines which note sections are actionable (worth downstream processing) using rule-based, explainable scoring.

### How It Works

For each line in a section, v3 computes:

**Positive Signals** (contribute to actionableSignal):
- Strong request pattern (stem + verb): +1.0
- Imperative verb at line start: +0.9
- Hedged directive (we should, maybe we need, etc.): +0.9
- Change operator (move, delay, shift, etc.): +0.8
- Status/progress markers (done, blocked, etc.): +0.7
- Structured task syntax (- [ ], TODO:, etc.): +0.8
- Target object bonus (if score ≥ 0.6): +0.2

**Negative Signals**:
- Negation override: if line has "don't" + verb → score = 0.0

**Out-of-Scope Signals**:
- Calendar markers (dates, weekdays, quarters): 0.6
- Communication markers (email, slack): 0.6
- Micro/admin markers (rename file, fix typo): 0.4

Section score = max line score across all lines.

### Thresholds

- `T_action = 0.5`: Minimum actionableSignal to pass gate
- `T_out_of_scope = 0.4`: Maximum outOfScopeSignal to pass gate

**Gate logic**: `isActionable = actionableSignal >= 0.5 AND outOfScopeSignal < 0.4`

### Out-of-Scope Override

**Critical feature**: If non-hedged actionableSignal ≥ 0.8, outOfScopeSignal is clamped ≤ 0.3.

This ensures timeline changes like "Move launch to next week" are not filtered as calendar noise despite containing date references. The override only fires for non-hedged signals (strong request, imperative, change operator, bullet verbs) so that hedged directives about admin tasks are still filtered.

### Signal Mapping to Schema

V3 computes `actionableSignal` and `outOfScopeSignal`, but stores them in `IntentClassification`:

- **actionableSignal** → distributed to `plan_change` and `new_workstream`
  - If section has change operators or structured tasks: plan_change gets full signal
  - Otherwise: new_workstream gets full signal
- **outOfScopeSignal** → distributed to `calendar`, `communication`, `micro_tasks` based on marker types
- **research** → set to 0 (not used in v3)

Downstream consumers extract:
- `actionableSignal = max(plan_change, new_workstream)`
- `outOfScopeSignal = max(calendar, communication, micro_tasks)`

### Plan Change Protection

Sections with `intentLabel = "plan_change"` (where plan_change is highest score) are **never dropped** at ACTIONABILITY stage. The gate forces `actionable=true` regardless of signal thresholds to ensure plan changes always generate suggestions.

## Quality Validators (V1-V3)

**Location**: `src/lib/suggestion-engine-v2/validators.ts:runQualityValidators()`

**Purpose**: Hard quality gates that run after synthesis and before scoring to filter out low-quality suggestions.

### V1: Change-Test Validator (Informational Only)

**Status**: Informational only. Does NOT block V2 suggestions. Excluded from drop reasons and "Top reasons" in debug summary.

The V1 validator checks for:
- Plan mutations: Delta/change patterns (from X to Y, instead of, no longer, etc.)
- Execution artifacts: Required components (title, description with objective/scope/approach)

V1 validation results are captured in the results array for per-candidate debug display, but:
- V1 failures do **not** drop suggestions (non-blocking in `runQualityValidators`)
- V1 is listed in `NON_BLOCKING_DROP_REASONS` (debugTypes.ts), so it is excluded from `computeDebugRunSummary` top reasons and drop stage histograms

### V2: Anti-Vacuity Validator (Active)

**Status**: Active - blocks suggestions on failure.

Prevents generic management-speak by checking:
- Generic ratio (verbs: improve, optimize, align; nouns: process, stakeholders, efficiency)
- Domain noun presence (at least 2 domain-specific nouns required)
- Title generic ratio (must be < 0.7)

Failures block suggestion from reaching scoring stage.

### V3: Evidence Sanity Validator (Active)

**Status**: Active - blocks suggestions on failure.

Validates evidence quality by checking:
- At least one evidence span present
- Evidence spans map to actual section content (substring matching)
- Minimum evidence length (unless bullet points present)
- Presence of action-bearing lines preferred

Failures block suggestion from reaching scoring stage.
