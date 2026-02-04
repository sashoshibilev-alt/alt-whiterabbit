# V2 Belief-Driven Visibility Rollout Plan

## Overview

This document outlines the safe, gradual rollout strategy for the V2 belief-to-suggestion pipeline that fixes the visibility bug where low-confidence beliefs were being dropped instead of downgraded.

## Rollout Phases

### Phase 0: Pre-Rollout Validation

**Status**: ✅ Complete

- [x] V2 implementation complete
- [x] Rule groups A-D implemented in `decisionModel.ts`
- [x] Threshold reinterpretation in `configMapping.ts`
- [x] Comprehensive test suite (12 tests, all passing)
- [x] Invariants I1-I6 enforced and validated
- [x] Feature flag infrastructure in `convex/beliefToInitiativeV2.ts`

### Phase 1: Shadow Mode (Dual-Run)

**Duration**: 1-2 weeks

**Goal**: Validate V2 behavior against V1 without affecting users

**Steps**:

1. **Enable dual-run mode**:
   ```typescript
   await ctx.runAction(internal.beliefToInitiativeV2.generateFromBeliefsV2, {
     noteId: note._id,
     featureFlag: 'dual_run'
   });
   ```

2. **Monitor metrics**:
   - Suggestion count differences (V1 vs V2)
   - Action distribution (comment vs mutate_release_date)
   - Clarification rate changes
   - Invariant violations (should be zero)

3. **Key metrics to track**:
   ```
   - v1_suggestion_count vs v2_suggestion_count
   - v1_action_distribution vs v2_action_distribution
   - v1_clarification_count vs v2_clarification_count
   - invariant_I1_holds: should always be true
   - invariant_I2_holds: should always be true
   - invariant_I5_holds: should always be true
   ```

4. **Expected differences**:
   - V2 suggestion count should be ≥ V1 (fewer drops)
   - V2 should have more `comment` actions (downgrades instead of drops)
   - V2 should have more `needs_clarification` suggestions
   - V2 should have fewer hard drops

5. **Success criteria**:
   - Zero invariant violations
   - V2 produces ≥ V1 suggestions in 95%+ of cases
   - No production errors from V2 pipeline

### Phase 2: Gradual Traffic Rollout

**Duration**: 2-4 weeks

**Goal**: Serve V2 suggestions to increasing % of production traffic

**Rollout schedule**:

| Week | Traffic % | Feature Flag | Monitoring Level |
|------|-----------|--------------|------------------|
| 1    | 5%        | v2           | High (hourly)    |
| 2    | 25%       | v2           | High (daily)     |
| 3    | 50%       | v2           | Medium (daily)   |
| 4    | 100%      | v2           | Normal (weekly)  |

**Implementation**:

```typescript
// Example: Route based on note ID hash for consistent per-note behavior
function shouldUseV2(noteId: string): boolean {
  const hash = simpleHash(noteId);
  const rolloutPercent = 25; // Adjust per week
  return (hash % 100) < rolloutPercent;
}

// In suggestion generation:
const featureFlag = shouldUseV2(noteId) ? 'v2' : 'v1';
```

**Monitoring**:

Track these metrics by pipeline version:

```sql
-- Suggestion generation rate
SELECT 
  pipeline_version,
  COUNT(*) as notes_processed,
  SUM(suggestions_generated) as total_suggestions,
  AVG(suggestions_generated) as avg_suggestions_per_note
FROM suggestion_pipeline_runs
GROUP BY pipeline_version;

-- Action distribution
SELECT
  pipeline_version,
  action_type,
  COUNT(*) as count
FROM suggestions
GROUP BY pipeline_version, action_type;

-- User acceptance rate
SELECT
  pipeline_version,
  COUNT(*) as shown,
  SUM(CASE WHEN status = 'applied' THEN 1 ELSE 0 END) as applied,
  AVG(CASE WHEN status = 'applied' THEN 1 ELSE 0 END) as acceptance_rate
FROM suggestions
GROUP BY pipeline_version;
```

**Rollback criteria**:

Rollback to V1 if:
- Acceptance rate drops >10%
- Error rate increases >5%
- Invariant violations detected
- User complaints increase significantly

### Phase 3: Default to V2

**Duration**: 1 week

**Goal**: Make V2 the default, V1 opt-in only

**Steps**:

1. Update default feature flag to `v2`
2. Deprecate V1 code paths
3. Keep V1 available for emergency rollback

**Code changes**:

```typescript
// Before (Phase 2):
const DEFAULT_PIPELINE = 'v1';

// After (Phase 3):
const DEFAULT_PIPELINE = 'v2';
```

### Phase 4: Cleanup and V1 Deprecation

**Duration**: 2-4 weeks

**Goal**: Remove V1 code, finalize V2 as sole implementation

**Steps**:

1. **Freeze V1 code** (no changes, monitoring only)
2. **Monitor for 2 weeks** with V2 at 100%
3. **Remove V1 implementation**:
   - Archive `src/lib/belief-to-initiative/` (move to `_archived/`)
   - Remove V1 integration from Convex
   - Update all documentation to V2
4. **Rename V2 → core**:
   - `belief-to-initiative-v2/` → `belief-to-initiative/`
   - Update imports across codebase

**Success criteria**:
- 4 weeks at 100% V2 with no major issues
- Acceptance rate stable or improved vs pre-rollout baseline
- No V1 rollback requests
- Invariants hold 100% of the time

## Feature Flag Configuration

### Storage

Store feature flags in a `pipelineConfig` table:

```typescript
defineTable({
  key: v.string(), // e.g., "belief_to_suggestion_pipeline_version"
  value: v.any(), // "v1" | "v2" | "dual_run"
  updatedAt: v.number(),
  updatedBy: v.optional(v.string()),
});
```

### API

```typescript
// Get current pipeline version
export const getPipelineVersion = query({
  handler: async (ctx) => {
    const config = await ctx.db
      .query('pipelineConfig')
      .filter(q => q.eq(q.field('key'), 'pipeline_version'))
      .first();
    
    return config?.value || 'v1'; // Default to v1 for safety
  },
});

// Update pipeline version (admin only)
export const setPipelineVersion = mutation({
  args: { version: v.union(v.literal('v1'), v.literal('v2'), v.literal('dual_run')) },
  handler: async (ctx, args) => {
    // Check admin permissions here
    
    await ctx.db.insert('pipelineConfig', {
      key: 'pipeline_version',
      value: args.version,
      updatedAt: Date.now(),
    });
  },
});
```

## Monitoring Dashboard

Create a monitoring dashboard to track:

### Real-time Metrics
- Suggestions generated (V1 vs V2)
- Action distribution
- Clarification rate
- Invariant violations
- Error rate

### Daily Metrics
- Acceptance rate trend
- Dismissal reasons distribution
- Time to apply/dismiss
- User satisfaction (if available)

### Alerts

Set up alerts for:
- Invariant violations (immediate)
- Acceptance rate drop >10% (warning)
- Error rate increase >5% (warning)
- Zero suggestions for notes with beliefs (immediate)

## Testing Plan

### Pre-Rollout Testing

- [x] Unit tests (12 tests, all passing)
- [ ] Integration tests with real note data
- [ ] Performance testing (V1 vs V2 latency)
- [ ] Load testing (can V2 handle production volume?)

### During Rollout

- Shadow mode comparison testing
- A/B testing framework
- User acceptance testing
- Canary deployments

### Post-Rollout

- Regression testing
- Performance monitoring
- User satisfaction surveys

## Rollback Plan

### Immediate Rollback (< 1 hour)

If critical issue detected:

```typescript
// Emergency rollback to V1
await ctx.runMutation(internal.beliefToInitiativeV2.setFeatureFlag, {
  flag: 'v1'
});
```

### Partial Rollback

If issue affects specific notes/users:

```typescript
// Rollback for specific cohort
const affectedNoteIds = ['note_1', 'note_2'];
for (const noteId of affectedNoteIds) {
  await regenerateWithV1(noteId);
}
```

## Success Metrics

### Primary Metrics

1. **Suggestion emission rate**: V2 should emit suggestions for >95% of notes with beliefs
2. **Invariant compliance**: 100% (zero violations)
3. **Acceptance rate**: Stable or improved vs V1 baseline

### Secondary Metrics

1. **Clarification request rate**: May increase (expected due to downgrade behavior)
2. **Time to apply**: Should remain stable
3. **User complaints**: Should not increase

## Communication Plan

### Internal Team

- Pre-rollout: Engineering review of implementation and tests
- During rollout: Daily standups with metrics review
- Post-rollout: Retrospective and lessons learned

### Users

- No user-facing communication needed (transparent change)
- If acceptance rate affected, gather feedback via in-app survey

## Risk Mitigation

### Identified Risks

1. **Risk**: V2 generates too many low-quality suggestions
   - **Mitigation**: Monitor spam score distribution, adjust thresholds if needed
   - **Fallback**: Rollback to V1

2. **Risk**: Clarification suggestions overwhelm users
   - **Mitigation**: Batch clarifications, UI improvements
   - **Fallback**: Increase `T_MAX_CONF_FOR_NEEDS_CLARIFICATION_FALSE`

3. **Risk**: Performance degradation
   - **Mitigation**: Profile V2, optimize hot paths
   - **Fallback**: Rollback to V1

## Timeline

| Phase | Start | End | Duration |
|-------|-------|-----|----------|
| Phase 0: Pre-Rollout | Completed | Completed | - |
| Phase 1: Shadow Mode | Week 1 | Week 2 | 2 weeks |
| Phase 2: Gradual Rollout | Week 3 | Week 6 | 4 weeks |
| Phase 3: Default V2 | Week 7 | Week 7 | 1 week |
| Phase 4: Cleanup | Week 8 | Week 11 | 4 weeks |

**Total duration**: ~11 weeks from start to V1 deprecation

## Approval

This rollout plan requires approval from:
- [ ] Engineering lead
- [ ] Product owner
- [ ] QA/Testing lead

## Status

**Current Phase**: Phase 0 (Pre-Rollout) ✅ Complete

**Next Steps**:
1. Create monitoring dashboard
2. Set up feature flag configuration table
3. Begin Phase 1 (Shadow Mode)
