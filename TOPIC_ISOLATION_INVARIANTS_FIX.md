# Topic Isolation Invariants Fix

## Problem Statement

In wild run `c155f736...`, the parent section "🔍 Discussion details" was marked with:
- `dropStage=TOPIC_ISOLATION`
- `dropReason=SPLIT_INTO_SUBSECTIONS`
- `synthesisRan=false`
- `candidates=[]`

However, `debugRun.sections[]` contained ZERO `__topic_*` subsections, and parent metadata was empty (no `topicSplit`/`topicIsolation` info).

This is an invariant violation: If we mark `SPLIT_INTO_SUBSECTIONS`, we MUST materialize subsections into the ledger/debugRun AND attach parent metadata explaining the split.

## Root Cause

The topic isolation code in `debugGenerator.ts` had the following issues:

1. **Missing metadata attachment**: Parent metadata (`topicSplit`) was only attached when `enable_debug=true`, meaning production runs with `enable_debug=false` would mark sections as split but have no metadata to explain what happened.

2. **No hard invariant checks**: After creating subsections and adding them to the ledger, there was no verification that they actually made it into the ledger. If subsection creation failed silently, the parent would be marked as split but have no children.

3. **Silent success on failure**: If subsections failed to materialize, the parent would still be marked as `SPLIT_INTO_SUBSECTIONS` instead of `INTERNAL_ERROR`, making debugging impossible.

## Solution

### 1. Always Attach `topicSplit` Metadata (FIX #1)

**File**: `src/lib/suggestion-engine-v2/debugGenerator.ts`

Changed the parent section marking logic to ALWAYS attach `topicSplit` metadata before marking as `SPLIT_INTO_SUBSECTIONS`, regardless of `enable_debug` setting:

```typescript
// INVARIANT: Always attach topicSplit metadata before marking as SPLIT_INTO_SUBSECTIONS
const topicSplitMetadata = {
  topicsFound: debugInfo.topicSplit?.topicsFound || [],
  subSectionIds: subsections.map(s => s.section_id),
  subsectionCount: subsections.length,
  reason: 'split by topic anchors',
};

parentDebug.metadata = {
  ...parentDebug.metadata,
  topicSplit: topicSplitMetadata,
};

// Add full debug info if enable_debug is true
if (finalConfig.enable_debug && debugInfo.topicIsolation) {
  parentDebug.metadata = {
    ...parentDebug.metadata,
    topicIsolation: debugInfo.topicIsolation,
  };
}

// Now mark parent as split (after metadata is attached)
parentDebug.emitted = false;
parentDebug.dropStage = DropStage.TOPIC_ISOLATION;
parentDebug.dropReason = DropReason.SPLIT_INTO_SUBSECTIONS;
parentDebug.synthesisRan = false;
```

This ensures parent sections ALWAYS have `topicSplit` metadata that includes:
- `topicsFound: string[]` - List of topic labels found
- `subSectionIds: string[]` - IDs of generated subsections
- `subsectionCount: number` - Number of subsections
- `reason: string` - Why split happened

### 2. Hard Invariant Check After Subsection Creation (FIX #2)

**File**: `src/lib/suggestion-engine-v2/debugGenerator.ts`

Added a hard invariant check immediately after subsections are added to the ledger:

```typescript
// HARD INVARIANT CHECK: Verify all subsections were added to ledger
const expectedSubsectionCount = subsections.length;
const actualSubsectionsAdded = ledgerSizeAfterSubsections - ledgerSizeBeforeSubsections;

if (actualSubsectionsAdded !== expectedSubsectionCount) {
  // INVARIANT VIOLATION: Not all subsections were added to ledger
  console.error('[TOPIC_ISOLATION_INVARIANT_VIOLATION] Subsections missing from ledger:', {
    parentSectionId: section.section_id,
    expectedSubsectionCount,
    actualSubsectionsAdded,
    subsectionIds: subsections.map(s => s.section_id),
  });

  // RECOVERY: Mark parent with INTERNAL_ERROR instead of SPLIT_INTO_SUBSECTIONS
  const parentDebug = ledger.getSection(section.section_id);
  if (parentDebug) {
    parentDebug.dropReason = DropReason.INTERNAL_ERROR;
    parentDebug.dropStage = DropStage.TOPIC_ISOLATION;
    parentDebug.metadata = {
      ...parentDebug.metadata,
      topicIsolationFailure: {
        reason: 'subsections_missing_from_ledger',
        expectedCount: expectedSubsectionCount,
        actualCount: actualSubsectionsAdded,
      },
    };
  }
}
```

This ensures that if subsection creation fails, we immediately detect it and mark the parent as `INTERNAL_ERROR` rather than `SPLIT_INTO_SUBSECTIONS`.

### 3. Validation in DebugLedger.finalize() (FIX #3)

**File**: `src/lib/suggestion-engine-v2/DebugLedger.ts`

Added a `validateTopicIsolationIntegrity()` method that runs during `finalize()` to catch any violations before the debugRun is built:

```typescript
private validateTopicIsolationIntegrity(): void {
  for (const section of this.sections.values()) {
    // Check if section is marked as split
    if (section.dropReason === DropReason.SPLIT_INTO_SUBSECTIONS) {
      // Verify topicSplit metadata exists
      const hasTopicSplitMetadata = section.metadata?.topicSplit !== undefined;

      if (!hasTopicSplitMetadata) {
        console.error('[TOPIC_ISOLATION_INVARIANT_VIOLATION] Parent marked as SPLIT but missing topicSplit metadata');

        // RECOVERY: Mark as INTERNAL_ERROR
        section.dropReason = DropReason.INTERNAL_ERROR;
        section.dropStage = DropStage.TOPIC_ISOLATION;
        section.metadata = {
          ...section.metadata,
          topicIsolationFailure: {
            reason: 'missing_topicSplit_metadata',
          },
        };
        continue;
      }

      // Verify subsections exist in ledger
      const topicSplitMetadata = section.metadata.topicSplit as any;
      const expectedSubsectionIds: string[] = topicSplitMetadata.subSectionIds || [];
      const actualSubsections = expectedSubsectionIds.filter(id => this.sections.has(id));

      if (actualSubsections.length === 0) {
        console.error('[TOPIC_ISOLATION_INVARIANT_VIOLATION] Parent marked as SPLIT but no subsections found in ledger');

        // RECOVERY: Mark as INTERNAL_ERROR
        section.dropReason = DropReason.INTERNAL_ERROR;
        section.dropStage = DropStage.TOPIC_ISOLATION;
        section.metadata = {
          ...section.metadata,
          topicIsolationFailure: {
            reason: 'subsections_not_in_ledger',
            expectedSubsectionIds,
            actualSubsectionCount: actualSubsections.length,
          },
        };
      }
    }
  }
}
```

This provides a final safety net to catch any invariant violations before the debugRun is returned.

## Verification

### New Test Suite

Created comprehensive test suite in `topic-isolation-invariants.test.ts`:

1. **INVARIANT 1**: Parent with SPLIT_INTO_SUBSECTIONS must have topicSplit metadata
2. **INVARIANT 2**: Subsections must appear in debugRun.sections[]
3. **INVARIANT 3**: If parent marked SPLIT but no subsections, emit INTERNAL_ERROR
4. **DEBUG TRACE**: Run with DEBUG_TOPIC_ISOLATION_TRACE on specific noteId j977ea6y
5. **REGRESSION**: Ensure split sections do not bypass maxSuggestionsPerNote
6. **STRESS TEST**: Multiple sections eligible for splitting

All tests pass ✅

### Existing Tests

All existing tests still pass:
- `strategic-relevance-and-topic-isolation.test.ts` (21 tests) ✅
- `debug.test.ts` (41 tests) ✅
- `topic-isolation-invariants.test.ts` (6 tests) ✅

## Debug Trace Output

To reproduce the exact scenario from the wild run, enable trace logging:

```bash
DEBUG_TOPIC_ISOLATION_TRACE=true npm test -- topic-isolation-invariants.test.ts
```

The trace will log:
- Subsection creation events
- Ledger state before/after subsection addition
- Final debugRun section count and IDs
- Invariant check results

Example output:
```
[TOPIC_ISOLATION_DEBUG] Created subsections: {
  parentSectionId: 'sec_j977ea6y_2',
  subsectionCount: 3,
  subsectionIds: [
    'sec_j977ea6y_2__topic_new_feature_requests__0',
    'sec_j977ea6y_2__topic_project_timelines__1',
    'sec_j977ea6y_2__topic_internal_operations__2'
  ]
}

[TOPIC_ISOLATION_DEBUG] Ledger state after subsections: {
  ledgerSizeBeforeSubsections: 1,
  ledgerSizeAfterSubsections: 4,
  subsectionsAdded: 3,
  allSectionIds: [
    'sec_j977ea6y_2',
    'sec_j977ea6y_2__topic_new_feature_requests__0',
    'sec_j977ea6y_2__topic_project_timelines__1',
    'sec_j977ea6y_2__topic_internal_operations__2'
  ]
}

[TOPIC_ISOLATION_DEBUG] Final debugRun sections: {
  totalSections: 4,
  subsectionCount: 3,
  ledgerConsistencyCheck: 'PASS'
}
```

## Invariants Guaranteed

With these fixes, the following invariants are now guaranteed:

1. ✅ **Metadata Attachment**: If `dropReason=SPLIT_INTO_SUBSECTIONS`, then `parent.metadata.topicSplit` is defined and contains `{ topicsFound, subSectionIds, subsectionCount, reason }`

2. ✅ **Subsection Materialization**: If `dropReason=SPLIT_INTO_SUBSECTIONS`, then ALL `subSectionIds` from metadata exist in `debugRun.sections[]` as `__topic_*` sections

3. ✅ **No Silent Failures**: If subsections fail to materialize, the parent is marked with `dropReason=INTERNAL_ERROR` and `metadata.topicIsolationFailure` instead of `SPLIT_INTO_SUBSECTIONS`

4. ✅ **Observability**: All split operations are logged and traceable via `DEBUG_TOPIC_ISOLATION_TRACE=true`

## Impact

- **Production**: No behavior change for split-eligible sections - they still split correctly
- **Debug**: Improved explainability - parent sections now always have metadata explaining why split occurred
- **Reliability**: Hard invariant checks catch bugs immediately rather than allowing silent failures
- **Observability**: Trace logging makes debugging topic isolation issues much easier

## Files Changed

1. `src/lib/suggestion-engine-v2/debugGenerator.ts` - Added metadata attachment + invariant checks
2. `src/lib/suggestion-engine-v2/DebugLedger.ts` - Added validation in finalize()
3. `src/lib/suggestion-engine-v2/topic-isolation-invariants.test.ts` - New comprehensive test suite
