# Belief-Driven Visibility Implementation Summary

## Executive Summary

Successfully implemented V2 of the belief-to-suggestion pipeline that fixes a critical behavior bug: the system was suppressing suggestions when confidence/scoring thresholds were low, even when plausible beliefs existed. This caused meeting notes with clear plan implications to produce zero suggestions.

**Status**: ✅ Implementation Complete, Ready for Rollout

## Problem Statement

### Current (Incorrect) Behavior
- Low-confidence beliefs were **dropped** (hard-filtered) at the suggestion layer
- Actionability and overall score thresholds controlled **visibility**
- Meeting notes with valid plan beliefs could produce zero suggestions
- Evidence spans could be missing, causing additional drops

### Required (Correct) Behavior
- Belief existence controls suggestion visibility
- Low confidence **degrades** behavior, not visibility:
  - Low confidence → `comment` suggestion
  - `needs_clarification = true`
- Hard drops allowed **only when no belief exists** or belief is pure status/context
- Evidence spans always present (synthesized fallback if needed)

## Solution Architecture

### 1. Decision Model Rewrite

Implemented deterministic decision table in `src/lib/belief-to-initiative-v2/decisionModel.ts`:

**Rule Group A: Belief Visibility**
- A1: Pure status/context → no suggestion (only allowed drop)
- A2: All other beliefs → exactly one suggestion

**Rule Group B: Action Selection**
- B1: Non-initiative domains → `comment`
- B2: Initiative, non-release-date → `comment`
- B3: Initiative, release date, low conf/act → `comment`
- B4: Initiative, release date, high conf/act → `mutate_release_date`

**Rule Group C: Needs Clarification**
- C1: Low/medium confidence → `needs_clarification = true`
- C2: High confidence → `needs_clarification = false`

**Rule Group D: Execution Eligibility**
- D1: High-quality release-date mutations → `execution_eligible = true`
- D2: All other cases → `execution_eligible = false`

### 2. Threshold Reinterpretation

Created `src/lib/belief-to-initiative-v2/configMapping.ts` documenting threshold semantics:

| Threshold | V1 Behavior | V2 Behavior |
|-----------|-------------|-------------|
| `T_MIN_CONF_FOR_MUTATION` | Drops suggestions | Controls action type only |
| `T_MIN_ACT_FOR_MUTATION` | Drops suggestions | Controls action type only |
| `T_MIN_CONF_FOR_EXECUTION_ELIGIBLE` | N/A | Controls execution flag only |
| `T_MAX_CONF_FOR_NEEDS_CLARIFICATION_FALSE` | N/A | Controls clarification flag only |

**Key principle**: No threshold can suppress visibility.

### 3. Corrected Control Flow

**Before (V1)**:
```pseudo
for belief in beliefs:
  if confidence < threshold:
    continue  // HARD DROP
  if actionability < threshold:
    continue  // HARD DROP
  // Only high-score beliefs reach here
  emit_suggestion(belief)
```

**After (V2)**:
```pseudo
for belief in beliefs:
  if is_pure_status_or_context(belief):
    continue  // Only allowed drop
  
  action = select_action(belief)  // Uses thresholds for downgrade
  needs_clarification = select_clarification(belief)
  execution_eligible = select_eligibility(belief, action)
  evidence_spans = ensure_evidence_spans(belief)  // Never empty
  
  emit_suggestion(belief, action, needs_clarification, evidence_spans)
```

### 4. Invariants and Tests

Implemented in `src/lib/belief-to-initiative-v2/pipelineV2.test.ts`:

**Invariants**:
- **I1**: `beliefCount > 0 && non_status > 0 ⇒ suggestionCount ≥ 1`
- **I2**: Low confidence never results in zero suggestions
- **I3**: High-confidence, actionable release-date beliefs can mutate
- **I4**: Execution eligibility only tightens, never hides
- **I5**: All emitted suggestions have `evidence_spans.length ≥ 1`
- **I6**: Pure status/context beliefs may be dropped

**Test Coverage**: 12 tests, all passing ✅
- T1: No beliefs → no suggestions
- T2: Low-confidence belief → comment + clarification
- T3: Medium-confidence belief → downgraded
- T4: High-confidence belief → mutation + eligible
- T5: Non-initiative belief → comment
- T6: Pure status belief → dropped
- T7: Mixed beliefs → correct filtering
- T8: Evidence span fallback
- T9: Threshold changes don't affect visibility
- 3 invariant enforcement tests

### 5. Minimal Migration Plan

**Scope**: Decision/modeling layer only

**Modules Created**:
- `src/lib/belief-to-initiative-v2/types.ts` - V2 types and config
- `src/lib/belief-to-initiative-v2/beliefClassifier.ts` - Pure status detection
- `src/lib/belief-to-initiative-v2/decisionModel.ts` - Core decision logic
- `src/lib/belief-to-initiative-v2/suggestionBuilderV2.ts` - Suggestion builder
- `src/lib/belief-to-initiative-v2/pipelineV2.ts` - Orchestration
- `src/lib/belief-to-initiative-v2/configMapping.ts` - Threshold mapping
- `src/lib/belief-to-initiative-v2/index.ts` - Public API
- `src/lib/belief-to-initiative-v2/pipelineV2.test.ts` - Test suite
- `src/lib/belief-to-initiative-v2/README.md` - Documentation

**Integration Layer**:
- `convex/beliefToInitiativeV2.ts` - Convex actions with feature flag support

**Unchanged**:
- Belief detection modules (`beliefPipeline.ts`)
- External schemas (no DB changes required)
- UX surfaces
- Execution semantics (still user-driven)

## Rollout Strategy

Documented in `ROLLOUT_PLAN_V2.md`:

**Phase 1: Shadow Mode (Weeks 1-2)**
- Run V1 and V2 in parallel
- Log comparison metrics
- Validate invariants
- Feature flag: `dual_run`

**Phase 2: Gradual Rollout (Weeks 3-6)**
- 5% → 25% → 50% → 100% traffic
- Monitor acceptance rate, error rate
- Feature flag: `v2` with percentage routing
- Rollback plan in place

**Phase 3: Default V2 (Week 7)**
- Make V2 the default
- V1 available for emergency rollback

**Phase 4: Cleanup (Weeks 8-11)**
- Remove V1 code
- Rename v2 → core
- Archive old implementation

## Success Criteria

### Technical Metrics
- ✅ All 12 tests passing
- ✅ Zero invariant violations in test suite
- ✅ Evidence spans always present
- ✅ Belief-driven visibility enforced

### Production Metrics (Post-Rollout)
- Suggestion emission rate >95% for notes with beliefs
- Invariant I1 holds 100% of the time
- Invariant I2 holds 100% of the time
- Invariant I5 holds 100% of the time
- Acceptance rate stable or improved vs V1

## Files Created/Modified

### New Files (V2 Implementation)
```
src/lib/belief-to-initiative-v2/
├── types.ts                    (250 lines)
├── beliefClassifier.ts         (130 lines)
├── decisionModel.ts            (220 lines)
├── suggestionBuilderV2.ts      (360 lines)
├── pipelineV2.ts               (180 lines)
├── configMapping.ts            (180 lines)
├── index.ts                    (15 lines)
├── pipelineV2.test.ts          (420 lines)
└── README.md                   (Documentation)

convex/
└── beliefToInitiativeV2.ts     (290 lines)

Root/
├── ROLLOUT_PLAN_V2.md          (Rollout strategy)
└── BELIEF_DRIVEN_VISIBILITY_IMPLEMENTATION.md (This file)
```

**Total new code**: ~2,045 lines (excluding docs)

### Modified Files
- None (clean V2 implementation, no V1 changes)

## Key Achievements

1. ✅ **Zero Breaking Changes**: V1 remains functional, V2 is opt-in via feature flag
2. ✅ **Comprehensive Testing**: 12 tests enforcing 6 invariants
3. ✅ **Production Ready**: Feature flag, rollout plan, monitoring strategy
4. ✅ **Well Documented**: README, rollout plan, implementation summary
5. ✅ **Conservative Rollout**: 4-phase plan with rollback at each stage
6. ✅ **No Schema Changes**: Works with existing database structure
7. ✅ **Evidence Guarantee**: All suggestions have evidence spans (I5)
8. ✅ **Visibility Guarantee**: Non-status beliefs always produce suggestions (I1, I2)

## Next Steps

1. **Create monitoring dashboard** (see ROLLOUT_PLAN_V2.md)
2. **Set up feature flag config table**
3. **Begin Phase 1: Shadow Mode**
   - Enable `dual_run` feature flag
   - Monitor for 1-2 weeks
   - Validate metrics and invariants
4. **Proceed through rollout phases** per ROLLOUT_PLAN_V2.md

## Risk Assessment

**Low Risk**: 
- No schema changes
- V1 still available
- Comprehensive test coverage
- Gradual rollout with monitoring
- Multiple rollback points

**Medium Risk**:
- Clarification rate may increase (expected, by design)
- User feedback on downgraded suggestions

**Mitigation**:
- Monitor acceptance rate closely
- UI improvements for clarification flow if needed
- Adjust `T_MAX_CONF_FOR_NEEDS_CLARIFICATION_FALSE` if too many clarifications

## Conclusion

The V2 belief-driven visibility implementation is **complete and ready for rollout**. The system now correctly ensures that belief existence controls suggestion visibility, with low-confidence signals degrading suggestion form rather than suppressing it entirely.

All invariants are enforced, tested, and validated. The implementation follows the plan precisely and includes comprehensive documentation and a safe, gradual rollout strategy.

---

**Implemented by**: AI Assistant  
**Date**: February 3, 2026  
**Status**: ✅ Ready for Phase 1 (Shadow Mode)
