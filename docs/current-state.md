# Current State

## Body Generation Quality Fixes (2026-02-08)

**Files**: `synthesis.ts`, `body-generation.test.ts`

Two targeted quality fixes for suggestion body generation:

### Task A: Friction Complaint Detection for Idea Bodies

**Problem**: When Customer Feedback sections contain friction/clicks complaints without explicit proposals (e.g., "Enterprise customer reports frustration with the number of clicks required to complete annual attestations"), the body generation was extracting complaint noun phrases like "Complete annual attestations." instead of generating solution-shaped bodies.

**Solution**: Added friction complaint detection heuristic in `generateIdeaBody()` that runs after proposal-line check but before pattern fallback:

1. **Added friction detection** (`synthesis.ts` lines 418-471):
   - `FRICTION_MARKERS`: patterns for clicks, steps, friction, "takes too long", "difficult to", burden, cumbersome
   - `FRICTION_TARGET_PATTERNS`: attestation, workflow, flow, process, completion
   - `detectFrictionComplaint()`: checks for friction marker + target object, returns friction type
   - `generateFrictionSolution()`: creates solution-shaped body based on friction type:
     - "clicks" → "Reduce clicks required to [target]."
     - "steps" → "Reduce steps required to [target]."
     - generic → "Streamline [target] to improve usability."

2. **Modified `generateIdeaBody()`** (`synthesis.ts` line 422):
   - After proposal-line check, before existing fallback patterns
   - If friction complaint detected: generate solution body + add problem context if available
   - Preserves all existing proposal-first and fallback logic

**Behavior Change**:
- Friction complaints now emit solution-shaped bodies: "Reduce clicks required to attestations. Enterprise customer reports frustration..."
- Instead of noun phrase fallbacks: "Complete annual attestations."
- Only applies when no explicit proposal lines exist in section
- Minimal, rule-based heuristic (no ML/probabilistic)

**Tests**: Added 4 regression tests in `body-generation.test.ts`:
- Clicks friction → body contains "reduce" + "clicks" + target object
- Steps friction → body contains "reduce" + "steps" + target object
- Generic friction → body contains "streamline" + target object
- Proposal lines still take priority (no friction heuristic applied)

### Task B: Role Assignment Punctuation Fix

**Problem**: `generateRoleAssignmentBody()` was joining lines that already ended with punctuation (e.g., "PM to document."), causing double punctuation in bodies: "impact.. Design.. CS.."

**Solution**: Strip trailing punctuation before joining lines.

1. **Modified `generateRoleAssignmentBody()`** (`synthesis.ts` line 703):
   - Before joining lines: strip trailing `.`, `;`, `:` (preserve `?`, `!`)
   - Then join with single `.`
   - Preserves existing 300-char max and all other behavior

**Behavior Change**:
- Role assignment bodies no longer contain `..`, `;.`, or `:.`
- Clean single-period joining: "PM to document requirements. Design to create mockups. CS to gather feedback."

**Tests**: Added 3 regression tests in `body-generation.test.ts`:
- No double periods in role assignment bodies
- Mixed punctuation (`;`, `:`, `.`) normalized correctly
- Content preserved when normalizing punctuation

**Minimal Diff**:
- 72 lines added to `synthesis.ts` (friction detection + punctuation normalization)
- 1 new test file: `body-generation.test.ts` (7 tests, all passing)
- No changes to classifiers, validators, scoring, routing, thresholds, or V3_ACTION_VERBS
- All existing tests pass (259 tests across suggestion-engine-v2)

---

## Action Items Body Generation for Role Assignments (2026-02-08)

**Files**: `synthesis.ts`, `suggestion-engine-v2.test.ts`

Improved body generation for role assignment sections to extract task lines instead of collapsing to timeline tokens.

**Problem**: After the role assignment flag change (Prompt 1), sections with `forceRoleAssignment=true` map to `plan_change` intent and `project_update` type. Title generation was correctly using "Action items: <Heading>", but body generation was routing through `generateProjectUpdateBody()`, which looks for change patterns ("shift to", "from X to Y") and timing. Role assignment lines like "PM to document..." don't match these patterns, causing thin fallback bodies like "Next quarter." when timeline tokens are present.

**Requirements**:
- Preserve robustness: role assignment sections remain `plan_change` (not dropped at ACTIONABILITY)
- Improve categorization/output: use action-items-style body generation
- Title: keep "Action items: <Heading>" (already correct from Prompt 1)
- Body: extract top 2-3 role assignment lines (e.g., "PM to document...", "CS to manage...")
- Respect `maxSuggestionsPerNote` and validators (no changes to gating logic)

**Changes**:

1. **Added `ROLE_ASSIGNMENT_PATTERNS`** (`synthesis.ts` line 633):
   - Array of regex patterns matching role assignment syntax: `/\bpm to\b/i`, `/\bcs to\b/i`, etc.
   - Mirrors the patterns from `classifiers.ts` V3_ROLE_ASSIGNMENT_PATTERNS
   - Used for extracting matching lines from section body

2. **Added `isRoleAssignmentLine()`** (`synthesis.ts` line 647):
   - Helper to check if a line contains a role assignment pattern
   - Uses `normalizeForComparison()` for consistent preprocessing

3. **Added `generateRoleAssignmentBody()`** (`synthesis.ts` line 653):
   - New body generation function for role assignment sections
   - Extracts lines matching role assignment patterns from body text
   - Takes top 2-3 lines (or fewer if less available)
   - Strips bullet markers, capitalizes first letter, formats as flowing text
   - Max 300 chars (consistent with other body generators)
   - Fallback: extracts meaningful sentences if no matches found (defensive)

4. **Modified `synthesizeSuggestion()`** (`synthesis.ts` line 920-928):
   - Added routing check: if `section.intent.flags?.forceRoleAssignment`, use `generateRoleAssignmentBody()`
   - Otherwise: fall through to existing logic (`generateProjectUpdateBody()` or `generateIdeaBody()`)
   - No changes to title generation, payload generation, or evidence extraction

**Behavior Change**:
- Role assignment sections now emit with bodies like: "PM to document feature requirements and acceptance criteria. CS to manage customer communication and set expectations. Design to create wireframes for new user dashboard."
- Instead of collapsing to thin bodies like "Next quarter." when timeline tokens are present
- Title remains "Action items: <Heading>" (unchanged from Prompt 1)
- Type remains `project_update`, intent remains `plan_change` (unchanged)
- Evidence spans unchanged (use existing extraction logic)

**Tests**: Added regression test "role assignment sections generate action-items-style bodies (not timeline tokens)" in `suggestion-engine-v2.test.ts`:
- Section with "Next Steps" heading, 4 role assignment bullets, and "Timeline: Next quarter." line
- Asserts title begins with "Action items:" and includes heading text
- Asserts body length > 20 chars (substantial content, not collapsed to timeline token)
- Asserts body does NOT equal "Next quarter."
- Asserts body includes at least 2 task indicators (verbs/roles/objects from task lines)

**Minimal Diff**:
- 53 lines added to synthesis.ts (patterns, helpers, new body generator, routing check)
- 1 test added to existing test suite
- No changes to classifiers, validators, scoring, routing, or evidence extraction

---

## Proposal-First Heuristic for Idea Synthesis (2026-02-08)

**Files**: `classifiers.ts`, `synthesis.ts`, `list-marker-normalization.test.ts`

Added a proposal-first heuristic for idea-type suggestions to prefer solution/proposal lines over complaint noun phrases when generating suggestion bodies and selecting evidence spans.

**Problem**: When sections contain both complaint/problem statements ("Employees are dissatisfied with too many clicks") and solution/proposal statements ("Reduce required steps by merging attestation screens"), the suggestion synthesis was treating both equally. This resulted in idea suggestions that emphasized the problem rather than the proposed solution.

**Requirements** (minimal diff):
- Define `PROPOSAL_VERBS_IDEA_ONLY` = ["reduce","merge","streamline","simplify","remove","eliminate","consolidate","log","cut"]
- Detect proposal lines by: (a) starts with proposal verb, OR (b) contains "by <verb+ing>" pattern
- For idea-type suggestions: prefer proposal lines for evidence spans and body text
- No changes to actionability thresholds, V3_ACTION_VERBS, validators, or routing
- Only affects idea-type suggestions (project_update unchanged)

**Changes**:

1. **Added PROPOSAL_VERBS_IDEA_ONLY** (`classifiers.ts` line 287):
   - Exported constant for use in synthesis module
   - Separate from V3_ACTION_VERBS (which affects actionability scoring)
   - Used only for idea synthesis, not for actionability detection

2. **Added proposal detection helpers** (`synthesis.ts` line 366):
   - `normalizeForProposal()`: strips list markers, lowercases (same as classifier preprocessing)
   - `isProposalLine()`: detects proposal verbs at line start OR "by <verb+ing>" pattern
   - Handles gerunds ("by merging" matches "merge", "by reducing" matches "reduce")

3. **Modified generateIdeaBody()** (`synthesis.ts` line 420):
   - Added proposal-first check before existing pattern-based extraction
   - If proposal lines found: use first proposal as primary, optionally add context/second proposal
   - If no proposal lines: fall back to existing problem/solution pattern extraction
   - Preserves all existing fallback logic

4. **Modified extractEvidenceSpans()** (`synthesis.ts` line 605):
   - For idea type: filter bodyLines to find proposal lines first
   - If proposal lines exist: use them as primary evidence (up to 2 lines)
   - Add context lines if room allows
   - For non-idea types: unchanged (existing list-item prioritization logic)

**Behavior Change**:
- Idea suggestions from sections with proposal lines now emphasize the solution/action in body and evidence
- Example: "Reduce required steps by merging attestation screens" preferred over "dissatisfied with too many clicks"
- Complaint/problem lines still available as context but not primary evidence
- No impact on actionability scoring, thresholds, or type classification

**Tests**: Added comprehensive test in `list-marker-normalization.test.ts`:
- Proposal line preferred over complaint line in idea body and evidence
- Evidence spans include proposal line (not only complaint line)
- Works with bullet markers (list normalization)
- Falls back to existing logic when no proposal found
- No impact on project_update suggestions

**Minimal Diff**:
- 36 lines added to classifiers.ts (PROPOSAL_VERBS_IDEA_ONLY + export)
- 201 lines added to synthesis.ts (proposal detection + modified body/evidence generation)
- 1 test added to existing list-marker-normalization.test.ts
- No changes to actionability gates, thresholds, validators, or routing logic

---

## Timeline vs Calendar Out-of-Scope Distinction (2026-02-08)

**Files**: `classifiers.ts`, `suggestion-engine-v2.test.ts`

Removed timeline-only tokens from calendar out-of-scope markers to prevent false out-of-scope drops when PM notes reference project timelines rather than scheduling tasks.

**Problem**: Sections mentioning "Q3", "next quarter", "end-of-quarter", "annual" were being dropped due to high calendar out-of-scope signal, even though these are timeline references describing when work should happen, not calendar scheduling tasks like "Schedule meeting next Thursday".

**Root Cause**: V3_CALENDAR_MARKERS (lines 432-460) included timeline-only tokens:
- Quarters: q1, q2, q3, q4, quarter
- Months: january, february, march, april, may, june, july, august, september, october, november, december

These triggered calendar out-of-scope signal at +0.6, causing sections with timeline language to be filtered out even when they contained actionable plan changes.

**Change**: Removed timeline tokens from V3_CALENDAR_MARKERS, keeping only true scheduling markers:
- **Kept**: weekdays (monday-sunday), "next week", "this week", "next month"
- **Removed**: q1, q2, q3, q4, quarter, all month names

**Behavior Change**:
- Timeline references like "Push to Q3", "Reassess next quarter", "Delay by 2 sprints" no longer trigger calendar out-of-scope
- True calendar scheduling like "Schedule meeting next Thursday" still triggers calendar out-of-scope at +0.6
- No threshold changes, no dominance logic changes
- Out-of-scope override (clamp to ≤0.3 when actionable signal ≥0.8) still works as before

**Tests**: Added 2 regression tests in "Timeline vs calendar out-of-scope distinction" describe block:
1. Timeline references (Q3, quarter, sprints) should NOT trip out-of-scope
2. True calendar scheduling (meeting, weekday) should trip out-of-scope

**Minimal Diff**: Modified only V3_CALENDAR_MARKERS array (removed 17 timeline tokens). No new patterns, no threshold changes, no new labels.

---

## Decision Marker and Role Assignment Intent Distribution (2026-02-08)

**Files**: `classifiers.ts`, `suggestion-engine-v2.test.ts`

Extended the intent score distribution logic to classify sections with decision markers or role assignments as plan_change (update/planning family) rather than new_workstream.

**Problem**: Meeting notes with "Decision" sections and "Next Steps" sections were being classified as `new_workstream` (and sometimes `status_informational`) even though they represent actionable updates to existing plans. This caused:
- Incorrect intent labels in debug JSON (new_workstream instead of plan_change)
- Incorrect type labels (idea instead of project_update)
- Potential downstream routing issues

**Root Cause**: The distribution heuristic `isPlanChangeDominant = hasChangeOperators || hasStructuredTasks` didn't account for sections that are actionable due to decision markers (Rule 10) or role assignments (Rule 9), even though these signals indicate planning/update content.

**Change**: Extended line 1099 in `classifiers.ts`:
```typescript
// Before:
const isPlanChangeDominant = hasChangeOperators || hasStructuredTasks;

// After:
const isPlanChangeDominant = hasChangeOperators || hasStructuredTasks || hasDecisionMarker || hasRoleAssignment;
```

**Behavior Change**:
- Decision sections (e.g., "Feature request will be logged in backlog. No near-term resourcing; revisit during next planning cycle.") now receive:
  - `intentLabel = plan_change` (was: new_workstream or status_informational)
  - `typeLabel = project_update` (was: idea or non_actionable)
  - `plan_change` signal gets full `maxActionableScore`
  - `new_workstream` gets partial signal (0.4 × maxActionableScore)

- Next Steps sections with role assignments (e.g., "PM to document... CS to manage...") now receive:
  - `intentLabel = plan_change` (was: new_workstream or status_informational)
  - `typeLabel = project_update` (was: idea)
  - Distribution same as decision markers

**Implementation**: No new keywords added. Reuses existing signals:
- `hasDecisionMarker` flag (set when Rule 10 fires, lines 988-990)
- `hasRoleAssignment` flag (set when Rule 9 fires, lines 983-985)

**Tests**: Added regression test "meeting notes with Decision and Next Steps are classified as plan_change/project_update" covering:
- Decision section: intentLabel=plan_change, typeLabel=project_update, not dropped at ACTIONABILITY
- Next Steps section: intentLabel=plan_change, typeLabel=project_update, not dropped at ACTIONABILITY
- Suggestions emitted with type=project_update

**Minimal Diff**: Change touches only the distribution condition (1 line modified). No new patterns, thresholds, or gates added.

---

## Intent Scoring Contract Restoration (2026-02-07)

**Files**: `types.ts`, `classifiers.ts`, `debugTypes.ts`, `DebugLedger.ts`, `synthesis.ts`, `suggestion-engine-v2.test.ts`

Fixed a bug where force routing flags (`_forceDecisionMarker`, `_forceRoleAssignment`) contaminated `intentClassification.scoresByLabel` in debug JSON, causing `topLabel` to become a flag name (e.g., "_forceDecisionMarker") with `topScore: true` instead of a numeric value, violating the intent scoring contract.

**Changes**:
1. **IntentClassification schema** (`types.ts`): Moved force flags from flat properties to nested `flags?: { forceRoleAssignment?: boolean, forceDecisionMarker?: boolean }` object
2. **ClassifierDistribution schema** (`debugTypes.ts`): Added `flags` field to store routing overrides separately from scores
3. **Debug ledger** (`DebugLedger.ts`): Filter out non-numeric properties when building `scoresByLabel` using `typeof value === 'number'` check; store flags separately at `intentClassification.flags`
4. **Routing logic** (`classifiers.ts`): Updated all flag checks from `intent._forceRoleAssignment` to `intent.flags?.forceRoleAssignment`
5. **Title template** (`synthesis.ts`): Role assignment sections now use "Action items: <Heading>" template instead of "Update <Heading> plan"
6. **Tests**: Added 4 regression tests verifying topScore is numeric, topLabel is valid, flags are stored separately, and role assignments use correct title template

**Contract Guarantees**:
- `intentClassification.topLabel` is always a valid intent label (plan_change, new_workstream, calendar, etc.), never a force flag
- `intentClassification.topScore` is always a number, never a boolean
- `intentClassification.scoresByLabel` only contains numeric values for valid intent labels
- `intentClassification.flags` contains routing overrides when present

**Behavior Change**: Role assignment sections (e.g., "PM to document") now emit with title "Action items: Next Steps" instead of "Update Next Steps plan", making the output clearer for task-like content.

**Regression Test**: "Leadership Alignment" section still correctly shows `plan_change` as `topLabel` (not contaminated by decision marker flag).

---

## Role Assignment and Decision Marker Detection (2026-02-07)

**Files**: `suggestion-engine-v2/classifiers.ts`, `suggestion-engine-v2/suggestion-engine-v2.test.ts`

Added two minimal actionability overrides to detect task assignments and decision statements that were previously scoring 0 actionableSignal:

**Changes**:
1. **Role assignment pattern (Rule 9)**: Detects "ROLE to VERB" micro-tasks (e.g., "PM to document", "CS to manage", "Eng to implement")
   - Score: +0.85 actionable signal
   - Patterns: PM to, CS to, Eng to, Design to, Project Manager to, etc. (9 patterns)

2. **Decision marker pattern (Rule 10)**: Detects decision language (e.g., "will be logged", "no near-term", "revisit", "agreed")
   - Score: +0.70 actionable signal
   - Markers: will be logged, will be, near-term, revisit, decided, agreed, approved (8 markers)

**Behavior Change**: "Next Steps" sections with role assignments and "Decision" sections with decision markers now pass the actionability gate (T_action = 0.5) and emit suggestions. Previously, these sections scored 0 and were dropped at ACTIONABILITY stage, causing synthesisRan=false in debug JSON.

**Implementation**: Both patterns are checked at the sentence level within the existing V3 actionability gate loop in `classifyIntent()`. Scores contribute to max actionableSignal for the section.

**Tests**: Added 4 regression tests covering both classification (actionable signal >= threshold) and synthesis (suggestions emitted with correct evidence spans).

**Note**: Decision sections containing calendar markers (q1-q4, month names) may still be filtered if outOfScopeSignal >= 0.4. The out-of-scope override (clamp to 0.3) only triggers for change operators or multiple action verbs, not decision markers alone.

---

## Numbered Section Heading Support (2026-02-07)

**Files**: `belief-pipeline/segmentation.ts`, `belief-pipeline.test.ts`, `suggestion-engine-v2/preprocessing.ts`, `suggestion-engine-v2.test.ts`

Fixed segmentation bug where numbered section headings (e.g., "1. Customer Feedback", "2. Options Discussed") were incorrectly parsed as list items, causing multiple sections to collapse into a single "General" section. This broke downstream intent classification and actionability gating.

**Changes**:
1. **Heading detection**: Added pattern `^\s{0,2}\d+\.\s+\S` to recognize numbered section headings before list item matching
2. **Indentation heuristic**: Up to 2 spaces indentation allowed to distinguish from nested list items (deeper indentation remains list item)
3. **Case-agnostic**: Supports both uppercase ("1. Customer Feedback") and lowercase ("1. next steps") headings
4. **Heading level**: Numbered headings are treated as level 2 headings (h2 equivalent)
5. **Processing order**: Numbered heading check occurs after markdown headings but before list item detection

**Implementation**:
- **belief-pipeline**: Implemented in `parseMarkdownBlocks()` with `^(\d+)\.\s+(.+)$` pattern at line 54-69
- **suggestion-engine-v2**: Implemented in `getLineType()`, `getHeadingLevel()`, and `getHeadingText()` functions with consistent behavior

**Behavior Change**: Notes using numbered section structure now segment correctly, with each numbered heading creating a distinct section. Downstream classification can now properly analyze each section's intent and actionability independently.

**Pattern Support**: Currently supports `\d+\.` (dot) format only. Parenthesis format `\d+\)` not added because existing list parsing doesn't support it either (maintains consistency).

**Tests**:
- belief-pipeline: 3 regression tests verifying uppercase/lowercase/indentation handling
- suggestion-engine-v2: 1 regression test verifying 5-section note segments correctly and heading text extraction works

---

## Sentence-Level Actionability Scoring (2026-02-07)

**Files**: `classifiers.ts`, `sentence-actionability.test.ts`

Fixed imperative detection to work at sentence level rather than line level. Previously, imperatives mid-line (e.g., "Users don't notice failures. Add inline alert.") were missed because the imperative verb "Add" was not at line start. Now each body line is split into sentence fragments before scoring, ensuring imperatives are detected regardless of position.

**Changes**:
1. **Sentence splitting**: Added `splitIntoSentences()` helper that splits on `.`, `!`, `?`, and `...` boundaries
2. **Smart quote normalization**: Added `normalizeSmartQuotes()` to convert `'` and `"` to ASCII before negation/imperative detection
3. **Scoring loop**: Modified `classifyIntent()` to evaluate each sentence fragment separately and take max score across fragments
4. **Shared logic**: Both `classifyIntent()` and `hasExplicitImperativeAction()` now use the same sentence splitting helper to prevent drift

**Behavior Change**: Sections with imperatives after sentence boundaries are now correctly marked as actionable (actionableSignal >= 0.9). Example: "Users don't see errors. Add inline alert." now triggers imperative floor.

**Tests**: Added 4 regression tests in `sentence-actionability.test.ts` covering mid-line imperatives, smart quotes, multiple sentences, and ellipsis boundaries.

---

## feature_request as First-Class Type (2026-02-05)

**Files**: `types.ts`, `classifiers.ts`, `synthesis.ts`, `scoring.ts`, `validators.ts`, `debugGenerator.ts`

Promoted `feature_request` from a structural hint to a first-class suggestion type alongside `plan_mutation` and `execution_artifact`. Prose-based feature requests now flow through the entire pipeline with their own type label.

**Type Model**:
- **`feature_request`**: Prose sections (no bullets, ≥20 chars, request stem OR action verb) with new_workstream intent
- **`execution_artifact`**: Bullet-based task lists or multi-step initiatives (unchanged)
- **`plan_mutation`**: Plan change sections (unchanged)

**Pipeline Integration**:
1. **Classification** (`classifiers.ts`): For new_workstream sections, if `computeTypeLabel()` returns `'feature_request'`, promote `suggested_type` from `'execution_artifact'` to `'feature_request'`
2. **Synthesis** (`synthesis.ts`): `feature_request` uses same title/payload generation as `execution_artifact` (both create draft_initiative)
3. **Scoring** (`scoring.ts`): `feature_request` treated like `execution_artifact` for threshold/capping (both cappable, not protected like `plan_mutation`)
4. **Validators** (`validators.ts`): V1 validator handles `feature_request` via the execution_artifact path; V3 evidence validator already supports feature_request relaxed validation
5. **Debug** (`debugGenerator.ts`): `afterTypeClassification` now receives `feature_request` type; flows to `typeClassification.scoresByLabel`, `typeClassification.topLabel`, `section.decisions.typeLabel`, and `candidate.metadata.type`

**Output Contract Change**:
- `SuggestionType` expanded: `'plan_mutation' | 'execution_artifact' | 'feature_request'`
- `suggestion.type` can now be `'feature_request'`
- `suggestion.structural_hint` can now be `'feature_request' | 'execution_artifact' | 'plan_mutation'` (set from final type label)
- Debug output: `typeClassification.scoresByLabel` now includes `feature_request` entries for prose feature requests
- Debug output: `candidate.metadata.type` now can be `'feature_request'`

**Backward Compatibility**: Downstream consumers checking `type === 'execution_artifact'` for non-plan types should update to `type !== 'plan_mutation'` to include feature_request.

**Tests**: Added 4 integration tests verifying feature_request flows correctly through typeClassification, scoresByLabel, and metadata.type fields.

---

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
