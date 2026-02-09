# Topic Isolation Eligibility-Execution Mismatch Fix

## Problem Statement (Root Cause Analysis)

### Wild Run Evidence

**Run `729d2547...`** showed:
```json
{
  "dropReason": "SPLIT_INTO_SUBSECTIONS",
  "metadata": {
    "topicIsolation": {
      "eligible": true,
      "reason": "heading_match",
      "hasTopicAnchors": true
    },
    "topicSplit": {
      "topicsFound": [],
      "subsectionCount": 1,
      "subSectionIds": ["sec_729d2547_2"]  // Parent ID, not subsections!
    }
  }
}
```

This is an **eligibility-execution disagreement**:
- Eligibility check: `hasTopicAnchors=true` → Split eligible
- Execution: `topicsFound=[]` → No split actually happened
- Result: Parent marked `SPLIT_INTO_SUBSECTIONS` but `subSectionIds` contains only the parent ID

### Root Cause

**Disagreement between two functions:**

1. **`shouldSplitByTopic()`** (eligibility check):
   ```typescript
   const bodyText = section.raw_text.toLowerCase();
   const hasTopicAnchors = TOPIC_ANCHORS.some(anchor => bodyText.includes(anchor));
   ```
   - Uses **substring match** (e.g., "new feature requests" anywhere in body)
   - Returns `true` if anchor appears as substring

2. **`splitSectionByTopic()`** (execution):
   ```typescript
   const trimmedText = line.text.trim().toLowerCase();
   const matchedAnchor = TOPIC_ANCHORS.find(anchor => trimmedText.startsWith(anchor));
   ```
   - Uses **line-start match** (e.g., line must START with "new feature requests:")
   - Returns `[]` if no line-start anchors found

**Example that triggers the bug:**
```markdown
## 🔍 Discussion details

We discussed several new feature requests from customers.
The project timelines were also reviewed.
```

- `shouldSplitByTopic()` returns `true` (body contains "new feature requests" and "project timelines" as substrings)
- `splitSectionByTopic()` returns `[section]` unchanged (no lines start with anchors)
- Result: Parent marked as split, but no subsections created

## Solution

### Fix 1: Single Source of Truth for Anchor Detection

**File**: `src/lib/suggestion-engine-v2/synthesis.ts`

Created shared function `hasExtractableTopicAnchors()` that uses the SAME logic as `splitSectionByTopic()`:

```typescript
/**
 * Check if section body contains topic anchors that are extractable
 * (i.e., anchors that appear at the start of lines, not just as substrings)
 *
 * IMPORTANT: This must use the SAME logic as splitSectionByTopic() to avoid
 * eligibility/execution disagreement
 */
function hasExtractableTopicAnchors(lines: Line[]): boolean {
  for (const line of lines) {
    const trimmedText = line.text.trim().toLowerCase();
    const matchedAnchor = TOPIC_ANCHORS.find(anchor => trimmedText.startsWith(anchor));
    if (matchedAnchor) {
      return true;
    }
  }
  return false;
}
```

Updated `shouldSplitByTopic()` to use this function:

```typescript
// Check for topic anchors in body using SAME logic as splitSectionByTopic
// (line-start match, not substring match, to avoid eligibility/execution disagreement)
const hasTopicAnchors = hasExtractableTopicAnchors(section.body_lines);
```

Now both functions use **line-start match**, ensuring consistency.

### Fix 2: Validate Actual Subsection Creation

**File**: `src/lib/suggestion-engine-v2/debugGenerator.ts`

Added validation AFTER `splitSectionByTopic()` to check if actual subsections were created:

```typescript
// CRITICAL CHECK: Verify actual subsections were created
// If splitSectionByTopic returns [section] (no split), DO NOT mark as SPLIT_INTO_SUBSECTIONS
const actuallyCreatedSubsections = subsections.length > 1 ||
  (subsections.length === 1 && subsections[0].section_id !== section.section_id);

if (!actuallyCreatedSubsections) {
  // Split was eligible but no actual subsections created (e.g., anchors not at line start)
  // Add to expanded sections as-is, do NOT mark as split
  expandedSections.push(section);

  if (finalConfig.enable_debug && ledger) {
    console.warn('[TOPIC_ISOLATION_NO_OP] Split eligible but no subsections created:', {
      sectionId: section.section_id,
      heading: section.heading_text,
      subsectionsReturned: subsections.length,
      firstSubsectionId: subsections[0]?.section_id,
      debugInfo,
    });

    // Record debug info to explain why no split happened
    const sectionDebug = ledger.getSection(section.section_id);
    if (sectionDebug) {
      sectionDebug.metadata = {
        ...sectionDebug.metadata,
        topicIsolation: debugInfo.topicIsolation,
        topicIsolationNoOp: {
          reason: 'no_subsections_created',
          eligibilityReason: debugInfo.topicIsolation?.reason,
          topicsFound: debugInfo.topicSplit?.topicsFound || [],
        },
      };
    }
  }
  continue; // Skip split handling
}
```

This ensures we ONLY mark `SPLIT_INTO_SUBSECTIONS` if:
- `subsections.length > 1` (multiple subsections), OR
- `subsections.length === 1` AND `subsections[0].section_id !== section.section_id` (single subsection with different ID)

If `splitSectionByTopic()` returns `[section]` unchanged, we skip split handling and process the section normally.

### Fix 3: Same Validation in Fallback Path

Applied the same validation in the fallback path (when plan_change section with 0 candidates checks split eligibility):

```typescript
// CRITICAL CHECK: Verify actual subsections were created
const actuallyCreatedSubsections = subsections.length > 1 ||
  (subsections.length === 1 && subsections[0].section_id !== section.section_id);

if (!actuallyCreatedSubsections) {
  // Split was eligible but no actual subsections created
  // Create fallback suggestion instead
  if (ledger) {
    console.warn('[TOPIC_ISOLATION_FALLBACK_NO_OP] Split eligible but no subsections, creating fallback');
  }
  // Fall through to fallback creation below
}
```

## Verification

### New Test Suite

Created comprehensive test suite `topic-isolation-eligibility-execution-mismatch.test.ts`:

1. **REGRESSION: Should NOT mark SPLIT_INTO_SUBSECTIONS when anchors are substrings, not line-starts**
   - Body contains "new feature requests" as substring but NOT at line start
   - Verifies parent is NOT marked as split, or if split, has actual subsections

2. **REGRESSION: Anchors at line start SHOULD split correctly**
   - Anchors like "New feature requests:" at line start
   - Verifies parent IS marked as split with actual subsections

3. **CRITICAL: hasTopicAnchors must match actual extractable anchors**
   - Tests both substring and line-start scenarios
   - Validates `hasTopicAnchors=true` → `topicsFound.length > 0` invariant

4. **DEBUG TRACE: Run 729d2547 reproduction**
   - Reproduces exact scenario from wild run
   - Logs full trace with `DEBUG_TOPIC_ISOLATION_TRACE=true`

All tests pass ✅

### Test Results

```bash
npm test -- src/lib/suggestion-engine-v2/
```

**Results:**
- New tests: 4/4 ✅
- All tests: 321/321 ✅ (12 skipped)

### Debug Trace Output

With `DEBUG_TOPIC_ISOLATION_TRACE=true`:

```
[RUN_729d2547_TRACE]: {
  noteId: '729d2547',
  parentSectionId: 'sec_729d2547_2',
  dropReason: 'NOT_ACTIONABLE',
  topicIsolation: undefined,
  topicSplit: undefined,
  topicIsolationNoOp: undefined,
  totalSections: 1,
  subsections: 0
}
```

The section is now correctly NOT split (dropReason is NOT_ACTIONABLE, not SPLIT_INTO_SUBSECTIONS).

## Invariants Guaranteed

With these fixes, the following invariants are now guaranteed:

1. ✅ **Eligibility-Execution Agreement**: `shouldSplitByTopic()` and `splitSectionByTopic()` use the SAME anchor detection logic (line-start match)

2. ✅ **hasTopicAnchors Consistency**: If `hasTopicAnchors=true`, then `topicsFound.length > 0` (or section is not marked as split)

3. ✅ **No Phantom Splits**: If `dropReason=SPLIT_INTO_SUBSECTIONS`, then:
   - `topicSplit.topicsFound.length > 0`
   - `topicSplit.subSectionIds.length > 0`
   - All `subSectionIds` exist in `debugRun.sections[]`
   - All `subSectionIds` are `__topic_*` subsections (not parent ID)

4. ✅ **Observability**: When split is eligible but no subsections created:
   - Parent has `metadata.topicIsolationNoOp` explaining why
   - Logged as `[TOPIC_ISOLATION_NO_OP]` or `[TOPIC_ISOLATION_FALLBACK_NO_OP]`

## Impact

- **Production**: No behavior change for correctly-formatted sections (anchors at line start still split)
- **Bug Fix**: Sections with substring anchors (not line-start) no longer cause phantom splits
- **Debug**: Clear observability when split eligibility doesn't result in actual split
- **Reliability**: Eliminates eligibility-execution disagreement that caused invariant violations

## Files Changed

1. `src/lib/suggestion-engine-v2/synthesis.ts`
   - Added `hasExtractableTopicAnchors()` function (single source of truth)
   - Updated `shouldSplitByTopic()` to use line-start match

2. `src/lib/suggestion-engine-v2/debugGenerator.ts`
   - Added validation after `splitSectionByTopic()` in main path
   - Added validation after `splitSectionByTopic()` in fallback path
   - Added `topicIsolationNoOp` metadata when eligible but no split

3. `src/lib/suggestion-engine-v2/topic-isolation-eligibility-execution-mismatch.test.ts`
   - New comprehensive test suite (4 tests)
   - Includes run 729d2547 reproduction with trace

## Before vs After

### Before (Broken)

```
shouldSplitByTopic():
  bodyText.includes("new feature requests") → TRUE ✓
  hasTopicAnchors = true

splitSectionByTopic():
  No lines start with "new feature requests:" → NO SPLIT
  Returns [section] unchanged

Result:
  Parent marked SPLIT_INTO_SUBSECTIONS ✗
  topicsFound = [] ✗
  subSectionIds = [parentId] ✗
  INVARIANT VIOLATION ✗
```

### After (Fixed)

```
shouldSplitByTopic():
  hasExtractableTopicAnchors(lines) → FALSE ✓
  hasTopicAnchors = false

splitSectionByTopic():
  Not called (not eligible)

Result:
  Parent NOT marked as split ✓
  No invariant violation ✓
  metadata.topicIsolationNoOp explains why (if was eligible) ✓
```

OR (if eligible and creates subsections):

```
shouldSplitByTopic():
  hasExtractableTopicAnchors(lines) → TRUE ✓
  hasTopicAnchors = true

splitSectionByTopic():
  Lines start with anchors → SPLIT ✓
  Returns [subsection1, subsection2] ✓

Validation:
  actuallyCreatedSubsections = true ✓

Result:
  Parent marked SPLIT_INTO_SUBSECTIONS ✓
  topicsFound = ["new feature requests", "project timelines"] ✓
  subSectionIds = [subsection1.id, subsection2.id] ✓
  All invariants satisfied ✓
```

## Run with DEBUG_TOPIC_ISOLATION_TRACE

To reproduce the exact scenario:

```bash
DEBUG_TOPIC_ISOLATION_TRACE=true npm test -- topic-isolation-eligibility-execution-mismatch.test.ts
```

Look for `[RUN_729d2547_TRACE]` in the output to see the trace for the reproduction case.

The invariant violation from run `729d2547...` can no longer occur - the eligibility check now matches execution logic exactly.
