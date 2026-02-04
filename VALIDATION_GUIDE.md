# Suggestion Aggregation & plan_change Fix - Validation Guide

## Summary

This document provides a comprehensive validation guide for the fixes implemented to address:
1. **Aggregation/UI count bug**: Ensuring that when debug shows `emitted: true`, the UI reflects this with a non-zero suggestion count
2. **plan_change semantics**: Guaranteeing that `intentLabel === "plan_change"` always yields at least one emitted suggestion via downgrade semantics

## Changes Implemented

### A) Classifier Changes (`src/lib/suggestion-engine-v2/classifiers.ts`)

#### 1. ACTIONABILITY Stage Protection
- **Lines 391-404**: Added plan_change bypass for low actionability signals
  - If `plan_change` is the top intent, section passes ACTIONABILITY even with low signals
  - Reason message includes "plan_change override" for debug visibility
  
- **Lines 539-557**: Added plan_change protection in type classification
  - If type returns `non_actionable` but intent is `plan_change`, force to `plan_mutation` type
  - Low confidence but keeps section in pipeline for downstream downgrade

**Test Coverage**: 
- `should never drop plan_change at ACTIONABILITY stage`
- `should emit plan_change even with "non-actionable" type classification`

### B) Scoring Changes (`src/lib/suggestion-engine-v2/scoring.ts`)

#### 1. THRESHOLD Stage Downgrade Semantics
- **Lines 342-394**: Updated `applyConfidenceBasedProcessing()`
  - Plan_change suggestions are **NEVER dropped** at THRESHOLD
  - Low confidence → `needs_clarification: true` + `action: 'comment'`
  - High confidence → emitted as-is
  - Execution_artifact suggestions may still be dropped

**Test Coverage**:
- `should downgrade low-confidence plan_change instead of dropping at THRESHOLD`
- `should set action=comment and needs_clarification for low-confidence plan_change`
- `INVARIANT: plan_mutation suggestions are NEVER dropped`

### C) Debug Instrumentation (`src/lib/suggestion-engine-v2/debugGenerator.ts`)

#### 1. Aggregation Logging
- **Lines 251-262**: Post-scoring logging
  - Logs `passedCount`, `droppedCount`, `downgraded`, `passedIds`
  - Activated via `DEBUG_AGGREGATION=true` or `enable_debug` config

- **Lines 296-343**: Final suggestions logging + invariant checks
  - Logs final suggestion IDs before `ledger.finalize()`
  - Checks `AGGREGATION_INVARIANT`: `emittedCount > 0 → finalSuggestions.length > 0`
  - Checks `PLAN_CHANGE_INVARIANT`: `planChangeCandidates > 0 → planChangeSuggestions > 0`
  - Errors logged to console for visibility

#### 2. DebugLedger Helper (`src/lib/suggestion-engine-v2/DebugLedger.ts`)
- **Lines 106-113**: Added `peekEmittedCount()` helper
  - Returns count of candidates marked `emitted: true` before finalize
  - Used for invariant checks during aggregation

**Test Coverage**:
- `should match the reported bug pattern: emitted=true but Suggestions(0)`
- `should emit at least one suggestion when debug shows emitted: true`
- `should preserve plan_change suggestions through scoring pipeline`

### D) Test Suite (`src/lib/suggestion-engine-v2/suggestion-engine-v2.test.ts`)

Added 9 new test cases in 4 categories:
1. **Aggregation Invariants** (2 tests)
2. **plan_change Protection from Drops** (3 tests)
3. **Downgrade Semantics** (1 test)
4. **Debug JSON Pattern Matching** (1 test matching sec_j97at70v_2 case)

All 78 tests passing.

## Validation Steps

### 1. Local Unit Tests

```bash
cd /Users/sasho/Downloads/whiterabbit-main
npm test -- src/lib/suggestion-engine-v2/suggestion-engine-v2.test.ts --run
```

**Expected**: All 78 tests pass (✓)

### 2. Engine Output Validation

Create a test note with plan_change content:

```markdown
# Q2 Roadmap

## Scope Adjustments

We need to shift priorities for Q2 based on customer feedback.

- Defer feature X to Q3
- Accelerate feature Y instead
- Remove Z from scope entirely

This will help us deliver faster value to customers.
```

**Run engine with debug enabled:**

```typescript
import { generateSuggestions } from './src/lib/suggestion-engine-v2';

const result = generateSuggestions(
  {
    note_id: 'test-validation',
    raw_markdown: noteContent,
  },
  undefined,
  { enable_debug: true }
);

console.log('Suggestions count:', result.suggestions.length);
console.log('Debug invariants:', {
  plan_change_count: result.debug?.plan_change_count,
  plan_change_emitted: result.debug?.plan_change_emitted_count,
  invariant_passed: result.debug?.invariant_plan_change_always_emitted,
});
```

**Expected Output:**
- `suggestions.length > 0`
- `plan_change_emitted_count > 0`
- `invariant_plan_change_always_emitted === true`
- No console errors about `AGGREGATION_INVARIANT_VIOLATION` or `PLAN_CHANGE_INVARIANT_VIOLATION`

### 3. Debug JSON Validation

For a note that previously showed the bug (e.g., sec_j97at70v_2 pattern):

**Check debug output:**

```json
{
  "sections": [
    {
      "sectionId": "sec_j97at70v_2",
      "candidates": [
        {
          "candidateId": "sugg_xyz",
          "emitted": true,
          "dropStage": null,
          "dropReason": null,
          "metadata": {
            "type": "plan_mutation"
          }
        }
      ]
    }
  ]
}
```

**And final result:**

```typescript
result.suggestions.length > 0
result.suggestions.find(s => s.section_id === 'sec_j97at70v_2')
```

**Expected**: If `emitted: true` in debug, corresponding suggestion exists in `result.suggestions`

### 4. API Layer Validation

**Convex query**: `notes.getWithSuggestions`

```typescript
const noteData = await ctx.runQuery(api.notes.getWithSuggestions, { 
  id: noteId 
});

console.log('API suggestions count:', noteData.suggestions.length);
```

**Expected**: 
- Count matches `result.suggestions.length` from engine
- No filtering applied at API layer
- All suggestions returned regardless of status

### 5. UI Validation

**Component**: `src/pages/NoteDetail.tsx` (line 434)

```tsx
<h2 className="font-semibold flex items-center gap-2">
  <Sparkles className="h-4 w-4" />
  Suggestions ({suggestions.length})
</h2>
```

**Expected**:
- Label shows total count (not filtered by status)
- If engine emits suggestions, count > 0
- Count matches `noteData.suggestions.length`

### 6. Low Confidence Downgrade Validation

Create a test note with low-confidence plan_change:

```markdown
# Thoughts

## Potential Changes

Might want to adjust our approach for Q2, not entirely decided yet.

- Possibly defer X
- Maybe focus on Y instead
- Still evaluating options
```

**Run with high threshold:**

```typescript
const result = generateSuggestions(note, undefined, {
  enable_debug: true,
  thresholds: {
    T_overall_min: 0.7, // Force downgrade
  },
});

const lowConfSuggestions = result.suggestions.filter(
  s => s.type === 'plan_mutation' && !s.is_high_confidence
);

console.log('Low confidence suggestions:', lowConfSuggestions.map(s => ({
  needs_clarification: s.needs_clarification,
  clarification_reasons: s.clarification_reasons,
  action: (s as any).action,
})));
```

**Expected**:
- Suggestions still emitted (not dropped)
- `needs_clarification: true`
- `clarification_reasons` includes `['low_actionability_score']` or `['low_overall_score']`
- Optional: `action: 'comment'` (v0 compatibility)

### 7. End-to-End Staging Validation

**Deploy to staging** and run these checks:

1. **Note Creation Flow**:
   - Create a new note with plan_change content
   - Trigger suggestion generation
   - Verify UI shows `Suggestions (N)` with N > 0

2. **Debug Endpoint** (if available):
   - Call debug endpoint for the note
   - Verify `emitted: true` candidates match final suggestions
   - Check invariant flags in debug output

3. **Regenerate Flow**:
   - Click "Regenerate" button
   - Verify suggestions refresh correctly
   - Check that count updates properly

4. **Known Bug Pattern**:
   - Find a note that previously showed `Suggestions (0)` with `emitted: true` in debug
   - Regenerate suggestions
   - Verify UI now shows correct count

### 8. Instrumentation Validation

**Enable debug logging:**

```bash
DEBUG_AGGREGATION=true npm run dev
```

**Create/regenerate a note** and check console for:

```
[Aggregation Debug] Post-scoring: {
  noteId: '...',
  stage: 'post_scoring',
  passedCount: 2,
  droppedCount: 0,
  downgraded: 0,
  passedIds: ['sugg_1', 'sugg_2']
}

[Aggregation Debug] Final suggestions: {
  noteId: '...',
  stage: 'final_suggestions',
  count: 2,
  suggestionIds: ['sugg_1', 'sugg_2']
}
```

**Expected**: No error logs for invariant violations

## Invariants Enforced

### Invariant 1: Aggregation Consistency
```
IF (any candidate has emitted === true in debug)
THEN (result.suggestions.length > 0)
```

**Enforcement**: Console error logged if violated (line 325 in debugGenerator.ts)

### Invariant 2: plan_change Emission
```
IF (any candidate has intentLabel === 'plan_change')
THEN (at least one suggestion with type === 'plan_mutation' emitted)
```

**Enforcement**: 
- Protection in classifiers (lines 391-404, 539-557)
- Downgrade in scoring (lines 358-376)
- Debug tracking in index.ts (lines 236-247)
- Console error logged if violated (line 335 in debugGenerator.ts)

## Failure Modes Addressed

### FM1: Debug ledger out-of-sync
- **Root cause**: `emitted: true` set before dedupe/cap, `finalize()` called with wrong IDs
- **Fix**: Explicit logging before/after aggregation, invariant checks
- **Test**: `should match the reported bug pattern`

### FM2: Aggregation bypasses emitted candidates
- **Root cause**: Filtering on wrong predicate (e.g., status instead of emitted)
- **Fix**: Canonical aggregation rule documented in plan, ledger.finalize() reconciles
- **Test**: `should emit at least one suggestion when debug shows emitted: true`

### FM3: Dedupe/cap dropping all suggestions
- **Root cause**: Aggressive deduplication or cap applied to already-emitted candidates
- **Fix**: Logging shows pre/post dedupe counts, finalize() catches discrepancies
- **Test**: Covered by full pipeline integration tests

### FM4: plan_change dropped at ACTIONABILITY
- **Root cause**: Low actionability signal or "non-actionable" type classification
- **Fix**: Bypass thresholds when plan_change is top intent
- **Test**: `should never drop plan_change at ACTIONABILITY stage`

### FM5: plan_change dropped at THRESHOLD
- **Root cause**: Score below threshold
- **Fix**: Apply downgrade semantics (needs_clarification + action: comment)
- **Test**: `should downgrade low-confidence plan_change instead of dropping at THRESHOLD`

## Rollout Plan

### Phase 1: Testing & Validation
- [x] Unit tests pass (78/78)
- [ ] Integration test with debug endpoint
- [ ] Manual staging validation with known bug cases

### Phase 2: Staging Deployment
- [ ] Deploy to staging environment
- [ ] Run validation suite against staging
- [ ] Monitor console logs for invariant violations
- [ ] Test with 5-10 real notes from production (anonymized)

### Phase 3: Production Rollout
- [ ] Deploy to production
- [ ] Monitor error logs for 48 hours
- [ ] Keep invariant checks as logs (not throws) for observability
- [ ] If stable after 48h, consider hard invariants (optional)

## Troubleshooting

### Issue: Tests failing
**Check**:
- Run `npm test -- src/lib/suggestion-engine-v2/suggestion-engine-v2.test.ts --run`
- Look for specific test failures
- Verify imports are correct (especially `computeActionabilitySignals`, `IntentClassification`, `isActionable`)

### Issue: Invariant violation logged
**Check**:
1. Which invariant? (AGGREGATION or PLAN_CHANGE)
2. Emitted count vs final count in logs
3. Debug JSON for affected note
4. Was dedupe/cap the cause? (check drop reasons)

### Issue: UI still shows Suggestions (0)
**Check**:
1. Engine output: `result.suggestions.length`
2. API payload: `noteData.suggestions.length`
3. UI state: React DevTools for `suggestions` prop
4. Network tab: Response from `notes.getWithSuggestions`
5. Console: Any errors during render?

### Issue: plan_change still being dropped
**Check**:
1. Intent classification: Is `plan_change` the top intent?
2. Debug: What's the `actionability_reason`?
3. Debug: What's the `dropStage` and `dropReason`?
4. Was it dropped at VALIDATION (V1/V2/V3)? (This is expected if quality gates fail)

## Contacts & Resources

- **Implementation Plan**: `.cursor/plans/suggestion-aggregation-plan-change-fix_f2dab6c7.plan.md`
- **Test Suite**: `src/lib/suggestion-engine-v2/suggestion-engine-v2.test.ts`
- **Debug Types**: `src/lib/suggestion-engine-v2/debugTypes.ts`
- **Main Engine**: `src/lib/suggestion-engine-v2/index.ts` and `debugGenerator.ts`
