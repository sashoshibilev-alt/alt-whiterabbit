# Belief-to-Initiative V2: Belief-Driven Visibility Model

## Overview

V2 is a corrected implementation of the belief-to-suggestion conversion pipeline that ensures **belief existence controls suggestion visibility**, not confidence or actionability thresholds.

## Key Principles

1. **Any non-pure-status belief MUST produce a suggestion** (Invariant I1)
2. **Low confidence downgrades suggestion form, never hides it** (Invariant I2)
3. **All suggestions MUST have evidence spans** (Invariant I5)

## Architecture

### Decision Flow

```
Belief → Classification → Decision → Suggestion
```

1. **Classification** (`beliefClassifier.ts`): Determines if belief is pure status/context
2. **Decision** (`decisionModel.ts`): Applies rule groups A-D to choose action, clarification, eligibility
3. **Builder** (`suggestionBuilderV2.ts`): Constructs suggestion with guaranteed evidence spans
4. **Pipeline** (`pipelineV2.ts`): Orchestrates and validates invariants

### Rule Groups (from Implementation Plan)

#### Rule Group A: Belief Visibility
- **A1**: Pure status/context beliefs → no suggestion (ONLY allowed drop)
- **A2**: All other beliefs → exactly one suggestion

#### Rule Group B: Action Selection
- **B1**: Non-initiative domains → `comment`
- **B2**: Initiative, non-release-date changes → `comment`
- **B3**: Initiative, release date, low confidence/actionability → `comment`
- **B4**: Initiative, release date, high confidence & actionability → `mutate_release_date`

#### Rule Group C: Needs Clarification
- **C1**: Low/medium confidence → `needs_clarification = true`
- **C2**: High confidence → `needs_clarification = false`

#### Rule Group D: Execution Eligibility
- **D1**: Release-date mutations, high quality → `execution_eligible = true`
- **D2**: All other cases → `execution_eligible = false`

## Thresholds (Reinterpreted for V2)

| Threshold | Controls | Does NOT Control |
|-----------|----------|------------------|
| `T_MIN_CONF_FOR_MUTATION` | Action type (comment vs mutate_release_date) | Suggestion visibility |
| `T_MIN_ACT_FOR_MUTATION` | Action type | Suggestion visibility |
| `T_MIN_CONF_FOR_EXECUTION_ELIGIBLE` | `execution_eligible` flag | Action type, visibility |
| `T_MIN_ACT_FOR_EXECUTION_ELIGIBLE` | `execution_eligible` flag | Action type, visibility |
| `T_MAX_CONF_FOR_NEEDS_CLARIFICATION_FALSE` | `needs_clarification` flag | Visibility, action type |

**CRITICAL**: No threshold can cause a non-pure-status belief to be dropped.

## Invariants

The V2 pipeline enforces six core invariants:

- **I1**: `beliefCount > 0 && non_status > 0 ⇒ suggestionCount ≥ 1`
- **I2**: Low confidence never results in zero suggestions
- **I3**: High-confidence, actionable release-date beliefs can mutate
- **I4**: Execution eligibility only tightens, never hides
- **I5**: All emitted suggestions have `evidence_spans.length ≥ 1`
- **I6**: Pure status/context beliefs may be dropped

## Usage

### Basic Usage

```typescript
import { executeBeliefToSuggestionPipelineV2 } from './belief-to-initiative-v2';

const result = executeBeliefToSuggestionPipelineV2(beliefs);

console.log(`Emitted ${result.suggestions.length} suggestions`);
console.log(`Invariants: I1=${result.debug.invariant_I1_holds}, I2=${result.debug.invariant_I2_holds}`);
```

### Custom Configuration

```typescript
import { executeBeliefToSuggestionPipelineV2, createV2Config } from './belief-to-initiative-v2';

const config = createV2Config({
  T_MIN_CONF_FOR_MUTATION: 0.75, // Raise mutation threshold
  T_MAX_CONF_FOR_NEEDS_CLARIFICATION_FALSE: 0.9, // Higher bar for no clarification
});

const result = executeBeliefToSuggestionPipelineV2(beliefs, config);
```

### Migrating from V1

```typescript
import { mapV1ThresholdsToV2Config } from './belief-to-initiative-v2';

const v2Config = mapV1ThresholdsToV2Config(v1Thresholds);
const result = executeBeliefToSuggestionPipelineV2(beliefs, v2Config);
```

## Testing

Run the test suite:

```bash
npm test -- belief-to-initiative-v2
```

All tests enforce the six invariants. Test coverage includes:

- T1: No beliefs → no suggestions
- T2: Low-confidence beliefs → comment + clarification
- T3: Medium-confidence beliefs → downgraded action
- T4: High-confidence beliefs → mutation + execution eligible
- T5: Non-initiative beliefs → comment
- T6: Pure status beliefs → dropped
- T7: Mixed beliefs → correct filtering
- T8: Evidence span fallback
- T9: Threshold changes don't affect visibility

## Differences from V1

| Aspect | V1 (Old) | V2 (New) |
|--------|----------|----------|
| **Visibility control** | Thresholds drop suggestions | Belief existence controls visibility |
| **Low confidence** | Suggestion dropped | Suggestion downgraded to comment |
| **Thresholds** | Filter visibility | Control action type, clarification, eligibility only |
| **Evidence spans** | May be empty | Always non-empty (fallback synthesis) |
| **Invariants** | Not enforced | Checked and logged |

## Rollout Strategy

V2 can be rolled out via feature flag (see `convex/beliefToInitiativeV2.ts`):

1. **Phase 1**: `featureFlag: 'dual_run'` - Run both V1 and V2, log comparison
2. **Phase 2**: `featureFlag: 'v2'` - Use V2 for small % of traffic
3. **Phase 3**: Default to V2, deprecate V1

## Files

- `types.ts` - Type definitions and config
- `beliefClassifier.ts` - Pure status/context classification
- `decisionModel.ts` - Core decision logic (rule groups A-D)
- `suggestionBuilderV2.ts` - Suggestion construction with evidence fallback
- `pipelineV2.ts` - Orchestration and invariant validation
- `configMapping.ts` - V1→V2 threshold mapping
- `pipelineV2.test.ts` - Comprehensive test suite
- `index.ts` - Public API exports

## Support

For questions or issues with V2, see the implementation plan in `.cursor/plans/` or review the test suite for examples.
