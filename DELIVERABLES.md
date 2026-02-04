# Suggestion List Fix - Deliverables

## 1. Exact Files Changed and Diffs

### Backend Changes

#### `convex/suggestionDebug.ts`
**Changes:** Added optional `persistSuggestions` parameter and logic to persist suggestions

```diff
  export const createDebugRun = action({
    args: {
      noteId: v.id("notes"),
      verbosity: v.optional(v.string()),
+     persistSuggestions: v.optional(v.boolean()),
    },
    handler: async (ctx, args): Promise<{
      debugRun: DebugRun | null;
      stored: boolean;
      storageSkippedReason?: string;
      error?: string;
+     suggestionsCreated?: number;
    }> => {
      // ... (generation logic)
      
+     // Optionally persist suggestions to the suggestions table
+     let suggestionsCreated = 0;
+     if (args.persistSuggestions && result.suggestions.length > 0) {
+       // Extract suggestion content (title) from the generated suggestions
+       const suggestionContents = result.suggestions.map(s => s.title);
+       
+       // Store suggestions using the same mutation as Regenerate
+       const suggestionIds = await ctx.runMutation(internal.suggestions.storeSuggestions, {
+         noteId: args.noteId,
+         suggestions: suggestionContents,
+         modelVersion: "suggestion-engine-v2-debug",
+         regenerated: false,
+         noteVersion: note.updatedAt,
+         suggestionFamily: "debug-run",
+       });
+       
+       suggestionsCreated = suggestionIds.length;
+     }
      
      // ... (storage logic)
      
      return {
        debugRun,
        stored: true,
+       suggestionsCreated,
      };
    },
  });
```

#### `convex/suggestions.ts`
**Changes:** Updated to use suggestion-engine-v2 for consistency

```diff
  import { query, mutation, action, internalMutation, internalQuery } from "./_generated/server";
  import { v } from "convex/values";
  import { internal } from "./_generated/api";
  import { generateSuggestionsFromNote, adaptV0Initiative } from "./suggestionEngine";
+ import { generateSuggestions, adaptConvexNote, adaptConvexInitiative } from "../src/lib/suggestion-engine-v2";

  // In generate action:
-   const v0Initiatives = await ctx.runQuery(internal.suggestions.listV0InitiativesInternal, {});
-   const initiatives = v0Initiatives.map(adaptV0Initiative);
-   const suggestions = generateSuggestionsFromNote(
-     note.body,
-     note._id,
-     initiatives,
-     { maxSuggestions: 3, confidenceThreshold: 0.7 }
-   );

+   const v0Initiatives = await ctx.runQuery(internal.suggestions.listV0InitiativesInternal, {});
+   const initiatives = v0Initiatives.map(adaptConvexInitiative);
+   const noteInput = adaptConvexNote({
+     _id: note._id,
+     body: note.body,
+     createdAt: note.createdAt,
+     title: note.title,
+   });
+   const result = generateSuggestions(
+     noteInput,
+     { initiatives },
+     { max_suggestions: 3, thresholds: { T_overall_min: 0.65, T_section_min: 0.6 } }
+   );
+   const suggestionContents = result.suggestions.map(s => s.title);

  // Similar changes in regenerate action
```

### Frontend Changes

#### `src/components/debug/SuggestionDebugPanel.tsx`
**Changes:** Added checkbox UI and persist logic

```diff
+ import { Checkbox } from "@/components/ui/checkbox";

  export function SuggestionDebugPanel({ noteId, visible = true }: SuggestionDebugPanelProps) {
    const { toast } = useToast();
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [localDebugRun, setLocalDebugRun] = useState<DebugRun | null>(null);
+   const [persistSuggestions, setPersistSuggestions] = useState(true);

    const handleRunDebug = async () => {
      setLoading(true);
      try {
        const result = await createDebugRun({
          noteId,
          verbosity: "REDACTED",
+         persistSuggestions,
        });
        
        // ... (error handling)
        
+       let description = result.stored
+         ? "Report saved and available for review."
+         : `Report generated (not stored: ${result.storageSkippedReason})`;
+       
+       if (persistSuggestions && result.suggestionsCreated) {
+         description += ` ${result.suggestionsCreated} suggestion${result.suggestionsCreated > 1 ? 's' : ''} added to list.`;
+       } else if (persistSuggestions && result.suggestionsCreated === 0) {
+         description += " No suggestions to persist.";
+       }
        
        toast({
          title: "Debug run completed",
-         description: result.stored ? "Report saved and available for review." : "...",
+         description,
        });
      }
      // ... (error handling)
    };

    // In render:
+   {open && (
+     <div className="flex items-center gap-2 px-2">
+       <Checkbox
+         id="persist-suggestions"
+         checked={persistSuggestions}
+         onCheckedChange={(checked) => setPersistSuggestions(checked === true)}
+       />
+       <label htmlFor="persist-suggestions" className="text-xs text-muted-foreground cursor-pointer">
+         Add suggestions to list
+       </label>
+     </div>
+   )}
  }
```

## 2. Convex Function Names

### Used by Regenerate
**Mutation:** `api.suggestions.regenerate`
- **File:** `convex/suggestions.ts` (lines 552-643)
- **Behavior:** Generates suggestions using suggestion-engine-v2, deduplicates by fingerprint, stores to `suggestions` table
- **Returns:** `{ previousCount, newCount, added, noteChanged }`

### Used by Run Debug
**Action:** `api.suggestionDebug.createDebugRun`
- **File:** `convex/suggestionDebug.ts` (lines 258-368)
- **Behavior:** Generates suggestions with debug instrumentation, optionally persists to `suggestions` table
- **Parameters:**
  - `noteId: Id<"notes">`
  - `verbosity?: "OFF" | "REDACTED" | "FULL_TEXT"` (default: "REDACTED")
  - `persistSuggestions?: boolean` (default: false)
- **Returns:** `{ debugRun, stored, storageSkippedReason?, error?, suggestionsCreated? }`

### Data Source for Suggestions List
**Query:** `api.notes.getWithSuggestions`
- **File:** `convex/notes.ts` (lines 57-73)
- **Behavior:** Returns note + all suggestions from `suggestions` table (no filtering by action/clarification)
- **Returns:** `{ note, suggestions }` where suggestions includes all records with matching `noteId`

## 3. Verification Checklist

### ✅ Click Regenerate => Suggestions count > 0
**Steps:**
1. Open a note with plan_change content (e.g., "Move Q1 launch to Q2")
2. Click the "Regenerate" button in the Suggestions panel header
3. Wait for toast notification

**Expected:**
- Toast shows "Suggestions regenerated: N new suggestions generated"
- Suggestions count updates from 0 to N (or shows added/removed delta)
- Suggestion cards appear in the "New" section
- Each card shows the suggestion content with Apply/Dismiss buttons

**Verification:**
- [x] Suggestions count > 0
- [x] Cards render with content
- [x] Status is "new"
- [x] All buttons (Apply, Dismiss) are clickable

---

### ✅ Click Run debug (with persistSuggestions=true) => Suggestions count > 0
**Steps:**
1. Open a note with plan_change content
2. Scroll down to the Debug panel (collapsible with Bug icon)
3. Click to expand the Debug panel
4. Ensure the "Add suggestions to list" checkbox is checked (default)
5. Click "Run debug" button

**Expected:**
- Toast shows "Debug run completed. Report saved. N suggestions added to list."
- Suggestions count updates from 0 to N
- Suggestion cards appear in the "New" section
- Debug panel shows summary metrics (Candidates: N final, Sections: M emitted)

**Verification:**
- [x] Suggestions count > 0
- [x] Cards render with content
- [x] Toast mentions "suggestions added to list"
- [x] Debug JSON can be copied (Copy JSON button works)

---

### ✅ Suggestions list renders plan_mutation suggestions even if action="comment" or needs_clarification=true
**Steps:**
1. Run debug with persist enabled on a note that generates low-confidence suggestions
2. Check the Suggestions list

**Expected:**
- All emitted suggestions appear in the list, regardless of:
  - `type` (plan_mutation or execution_artifact)
  - `needs_clarification` flag (true or false)
  - `clarificationState` (none, suggested, requested, answered)
- Suggestions with `clarificationState="suggested"` show an orange "Needs clarification" badge
- User can click "Ask Shipit to clarify" on these suggestions
- User can also click "Apply anyway" to apply without clarification

**Verification:**
- [x] All suggestions with status="new" appear in the list
- [x] No suggestions are hidden due to clarification state
- [x] Orange badge appears for suggestions needing clarification
- [x] Both "Ask Shipit to clarify" and "Apply anyway" buttons work

**Note:** The `suggestions` table does NOT have an "action" field. The v2 engine uses "type" (plan_mutation or execution_artifact) instead. The UI does NOT filter by type - all suggestions with status="new" are visible.

---

## 4. Additional Verification

### Edge Cases

#### Empty Note
```
1. Create a blank note
2. Run debug with persist enabled
3. Expected: "No suggestions to persist" in toast, count remains 0
```

#### Out-of-Scope Content
```
1. Create a note with only calendar/communication content:
   "Team meeting on Monday. Sent email to stakeholders."
2. Run debug with persist enabled
3. Expected: 0 suggestions generated (out-of-scope filter works)
```

#### Deduplication
```
1. Run debug twice on the same note (without editing)
2. Expected: Second run creates 0 new suggestions (fingerprint dedup works)
```

#### Clarification Flow
```
1. Generate a low-confidence suggestion (needs_clarification=true)
2. Verify "Needs clarification" badge appears
3. Click "Ask Shipit to clarify"
4. Expected: clarificationState changes to "requested", badge updates
5. Verify suggestion is still visible in the list
```

---

## 5. Key Invariants

### ✅ DebugLedger JSON Unchanged
The debug JSON format remains the same - useful for diagnosis, can be copied and analyzed.

### ✅ No Manual UI Refresh Required
Convex reactivity automatically updates the UI when suggestions are inserted. No page reload needed.

### ✅ Suggestions are Server-Backed
All suggestions persist to the `suggestions` table in Convex. List is consistent across refreshes and devices.

### ✅ Regenerate and Run Debug Use Same Engine
Both now use suggestion-engine-v2, ensuring consistent results. No more v1 vs v2 discrepancies.

### ✅ All Status="new" Suggestions Visible
The UI filters only by status (new, applied, dismissed). No hidden filters for action, clarification state, or type.

---

## 6. Summary of Data Flow

```
┌─────────────────────────────────────────────────────────────┐
│  User clicks "Run debug" (persist = true)                   │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  Frontend: SuggestionDebugPanel.tsx                          │
│  - Calls createDebugRun(noteId, verbosity, persistSuggestions) │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  Backend: convex/suggestionDebug.ts                          │
│  - Fetches note from DB                                      │
│  - Calls generateSuggestionsWithDebug (v2 engine)           │
│  - Extracts result.suggestions[] (array of Suggestion objects) │
│  - Maps to suggestion.title (content strings)               │
│  - Calls internal.suggestions.storeSuggestions()            │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  Backend: convex/suggestions.ts (storeSuggestions)          │
│  - Computes fingerprint for each suggestion                 │
│  - Inserts rows into "suggestions" table:                   │
│    { noteId, content, status: "new", fingerprint, ... }    │
│  - Logs "generated" event to "suggestionEvents"            │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  Convex Reactivity                                          │
│  - Detects new rows in "suggestions" table                  │
│  - Pushes update to frontend via WebSocket                  │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  Frontend: NoteDetail.tsx                                    │
│  - useQuery(api.notes.getWithSuggestions) receives update   │
│  - Re-renders with new suggestions array                    │
│  - Suggestions count updates: "Suggestions (4)"             │
│  - Cards render in "New" section                            │
└─────────────────────────────────────────────────────────────┘
```

---

## Files Summary

### Modified Files
1. `convex/suggestionDebug.ts` - Added persist logic
2. `convex/suggestions.ts` - Updated to use v2 engine
3. `src/components/debug/SuggestionDebugPanel.tsx` - Added checkbox UI

### New Files
4. `SUGGESTION_FIX_SUMMARY.md` - Comprehensive documentation
5. `DELIVERABLES.md` - This file (concise deliverables)
6. `scripts/test-suggestion-persistence.ts` - Smoke test script

### No Changes Required
- `convex/notes.ts` - Already has correct query
- `src/pages/NoteDetail.tsx` - Already has correct UI (no hidden filters)
- `convex/schema.ts` - Schema is correct (no action field needed)
