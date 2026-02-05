# Current State

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
