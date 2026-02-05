# Current State

## Actionability Gate v3

**Location**: `src/lib/suggestion-engine-v2/classifiers.ts:classifyIntent()`

**Purpose**: Determines which note sections are actionable (worth downstream processing) using rule-based, explainable scoring.

### How It Works

For each line in a section, v3 computes:

**Positive Signals** (contribute to actionableSignal):
- Strong request pattern (stem + verb): +1.0
- Imperative verb at line start: +0.9
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

**Critical feature**: If actionableSignal ≥ 0.8, outOfScopeSignal is clamped ≤ 0.3.

This ensures timeline changes like "Move launch to next week" are not filtered as calendar noise despite containing date references.

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
