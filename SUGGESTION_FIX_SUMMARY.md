# Suggestion List Fix - Summary

## Problem
The UI showed "Suggestions (0)" even though the Debug panel showed "Candidates: 4 final (4 emitted - 0 dropped)" and the debug JSON contained emitted candidates. The mismatch occurred because:

1. **Run debug** generated suggestions but only stored debug data, NOT the suggestions themselves
2. **Regenerate** used suggestion-engine-v1, while Run debug used suggestion-engine-v2, causing inconsistent results

## Solution

### 1. Modified `convex/suggestionDebug.ts`
**Changes:**
- Added optional `persistSuggestions: boolean` parameter to `createDebugRun` action
- Extract suggestion titles from the generated `result.suggestions` array
- Call `internal.suggestions.storeSuggestions` to persist suggestions to the database
- Return `suggestionsCreated` count in the response

**Result:** When `persistSuggestions=true`, Run debug now persists suggestions to the same table that the UI reads from.

### 2. Modified `src/components/debug/SuggestionDebugPanel.tsx`
**Changes:**
- Added `persistSuggestions` state (default: `true`)
- Added checkbox UI to toggle "Add suggestions to list"
- Pass `persistSuggestions` parameter to `createDebugRun` call
- Updated toast notification to show how many suggestions were created

**Result:** Users can now control whether Run debug should persist suggestions, with clear feedback.

### 3. Updated `convex/suggestions.ts` (Consistency Fix)
**Changes:**
- Updated `generate` action to use suggestion-engine-v2 instead of v1
- Updated `regenerate` action to use suggestion-engine-v2 instead of v1
- Changed imports to use `generateSuggestions`, `adaptConvexNote`, `adaptConvexInitiative` from v2
- Updated `modelVersion` to `"suggestion-engine-v2.0"` for consistency

**Result:** All three paths (initial generation, regenerate, debug) now use the same suggestion engine (v2), ensuring consistent results.

## Files Changed

### Backend (Convex)
1. **convex/suggestionDebug.ts** (~50 lines changed)
   - Added `persistSuggestions` parameter
   - Added suggestion persistence logic
   - Added `suggestionsCreated` to return type

2. **convex/suggestions.ts** (~40 lines changed)
   - Updated imports to use v2 engine
   - Updated `generate` action to use v2
   - Updated `regenerate` action to use v2

### Frontend
3. **src/components/debug/SuggestionDebugPanel.tsx** (~30 lines changed)
   - Added Checkbox import
   - Added `persistSuggestions` state
   - Added checkbox UI
   - Updated toast message logic

## Data Flow

### Before Fix
```
User clicks "Run debug" 
  → createDebugRun generates suggestions
  → Stores ONLY debug JSON in suggestionDebugRuns table
  → UI reads from suggestions table (empty!)
  → Shows "Suggestions (0)"
```

### After Fix
```
User clicks "Run debug" (with persist checkbox checked)
  → createDebugRun generates suggestions
  → Stores debug JSON in suggestionDebugRuns table
  → ALSO stores suggestions in suggestions table
  → UI reads from suggestions table (has data!)
  → Shows "Suggestions (4)" and renders cards
  → Convex reactivity triggers automatic UI update
```

## Verification Checklist

### ✅ Run Debug with Persist
- [ ] Open a note with plan_change content
- [ ] Expand the Debug panel
- [ ] Ensure "Add suggestions to list" checkbox is checked
- [ ] Click "Run debug"
- [ ] Verify toast shows "N suggestions added to list"
- [ ] Verify Suggestions count updates from 0 to N
- [ ] Verify suggestion cards render in the list

### ✅ Run Debug without Persist
- [ ] Open a note
- [ ] Expand the Debug panel
- [ ] Uncheck "Add suggestions to list" checkbox
- [ ] Click "Run debug"
- [ ] Verify debug JSON is still generated (Copy JSON works)
- [ ] Verify NO suggestions are added to the list
- [ ] Verify Suggestions count remains 0

### ✅ Regenerate Consistency
- [ ] Open a note
- [ ] Click "Regenerate" button
- [ ] Verify suggestions are generated
- [ ] Verify Suggestions count > 0
- [ ] Verify suggestions match the quality/type from Debug panel
  (both now use v2 engine)

### ✅ Clarification State Visibility
- [ ] Suggestions with `clarificationState="suggested"` should show "Needs clarification" badge
- [ ] These suggestions should still be visible in the list (not filtered out)
- [ ] User can click "Ask Shipit to clarify" button
- [ ] User can also click "Apply anyway" to apply without clarification

### ✅ Edge Cases
- [ ] Empty note → Run debug → No suggestions created
- [ ] Note with only communication/scheduling content → Run debug → No suggestions created
- [ ] Note with mixed content → Run debug → Only plan_change suggestions created
- [ ] Run debug twice → Suggestions are deduplicated by fingerprint
- [ ] Delete note → Suggestions are invalidated (soft delete)

## Technical Details

### Suggestion Extraction
The debug run contains `result.suggestions: Suggestion[]` where each `Suggestion` has:
```typescript
interface Suggestion {
  suggestion_id: string;
  title: string;  // ← This is the content we persist
  type: 'plan_mutation' | 'execution_artifact';
  needs_clarification?: boolean;
  // ... other fields
}
```

We extract `suggestion.title` from each suggestion and persist it to the `suggestions` table as `content`.

### Database Schema
```typescript
// suggestions table
{
  noteId: Id<"notes">,
  content: string,  // ← The suggestion.title from v2 engine
  status: "new" | "applied" | "dismissed",
  clarificationState: "none" | "suggested" | "requested" | "answered",
  suggestionFamily: string,  // "debug-run" for debug, "general" for others
  modelVersion: string,  // "suggestion-engine-v2.0" or "suggestion-engine-v2-debug"
  // ... other metadata
}
```

### No Action Field
Note: The `suggestions` table does NOT have an "action" field. The UI filters only by `status`:
- "new" suggestions appear in the "New" section
- "applied" suggestions appear in the "Applied" section
- "dismissed" suggestions appear in the "Dismissed" section

All suggestions with `status="new"` are visible, regardless of:
- `type` (plan_mutation vs execution_artifact)
- `clarificationState` (none vs suggested vs requested vs answered)
- `needs_clarification` flag (not in schema, only in v2 Suggestion type)

## Convex Reactivity
The fix leverages Convex's built-in reactivity:
1. `createDebugRun` inserts rows into `suggestions` table
2. The UI uses `useQuery(api.notes.getWithSuggestions, { id })` to watch the table
3. Convex automatically pushes updates to the UI when new rows are inserted
4. The Suggestions count and list update without manual refresh

## Testing Notes

### Manual Testing
To test the fix manually:
1. Start the Convex dev server: `npx convex dev`
2. Start the Vite dev server: `npm run dev`
3. Create or open a note with plan_change content (e.g., mentions of changing timeline, priority, or creating new initiatives)
4. Follow the verification checklist above

### Sample Test Note Content
```markdown
# Project Update

## Timeline Changes
- Move Q1 launch to Q2 due to dependencies
- Accelerate API migration to unblock mobile team

## New Initiatives
- Create user onboarding flow for new signups
- Build admin dashboard for support team

## Status (informational - should NOT generate suggestions)
- Team meeting scheduled for Monday
- Sent update email to stakeholders
```

Expected result: 2-4 suggestions generated for the timeline changes and new initiatives.

## Invariants Maintained

✅ DebugLedger JSON format unchanged (still useful for diagnosis)
✅ No manual UI refresh required (Convex reactivity handles updates)
✅ Suggestions are server-backed and persistent
✅ Both Regenerate and Run Debug use the same engine (v2)
✅ Suggestions with clarificationState="suggested" are still visible in the UI
✅ All suggestions with status="new" appear in the list (no hidden action filters)

## Future Improvements

1. **Deduplication**: The v2 engine already computes fingerprints. We could enhance `storeSuggestions` to skip duplicates based on fingerprint.

2. **Metrics**: Add a metric to track how often users run debug with persist enabled.

3. **Engine v1 Deprecation**: Now that all paths use v2, we can deprecate v1 (`convex/suggestionEngine.ts`) in a future PR.

4. **Clarification Flow**: The clarification UI is currently a placeholder. In a full implementation, it would call an LLM to provide context.

5. **Action Field**: If needed, we could add an "action" field to the suggestions table to distinguish between "mutate" and "comment" actions, but this isn't currently used by the UI.

## Rollback Plan

If issues arise, revert these commits:
1. Revert `convex/suggestionDebug.ts` changes (remove persistSuggestions logic)
2. Revert `src/components/debug/SuggestionDebugPanel.tsx` changes (remove checkbox)
3. Optionally keep or revert `convex/suggestions.ts` v2 upgrade depending on impact

The changes are backward compatible:
- Old debug runs (stored before this change) will still work
- The `persistSuggestions` parameter is optional (defaults to undefined/false)
- The checkbox defaults to checked but can be unchecked for old behavior
