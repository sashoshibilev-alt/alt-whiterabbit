# Shipit Behavioral Learning & Reporting Implementation

This document describes the complete implementation of behavioral learning for Shipit without retraining models.

## Overview

Shipit now learns from user behavior through lightweight logging, structured dismissal reasons, clarification workflows, and daily metrics aggregation. The system uses rule-based adaptation to improve suggestion quality over time without any model retraining or embeddings.

## 1. Clarification State & Lifecycle

### Schema Changes (`convex/schema.ts`)

- Added `ClarificationState` enum: `none`, `suggested`, `requested`, `answered`
- Extended `suggestions` table with:
  - `clarificationState`: Current clarification state
  - `clarificationPrompt`: Question shown to user
  - `clarificationAnswerId`: Link to clarification response event
  - `clarifiedFromSuggestionId`: Link to original if regenerated after clarification
  - `modelConfidenceScore`: Model confidence in [0,1]
  - `ruleOrPromptId`: Identifier for rule/prompt used
  - `suggestionFamily`: Category for analytics
  - `estimatedDiffSize`: small, medium, large

### Backend Mutations (`convex/suggestions.ts`)

- **`requestClarification`**: Transitions suggestion to "requested" state, logs event
- **`answerClarification`**: Provides clarification response, transitions to "answered"
- Enhanced `storeSuggestions` to accept clarification state and analytics fields
- All suggestion mutations now log events with full analytics envelope

### UI Implementation (`src/pages/NoteDetail.tsx`)

- Suggestions with `clarificationState: "suggested"` display:
  - Orange border and badge "Needs clarification"
  - Clarification prompt if available
  - Primary action: **"Ask Shipit to clarify"** button
  - Secondary actions: **"Apply anyway"**, **"Dismiss"**
- After requesting clarification:
  - Modal shows clarification context
  - User can add notes or proceed to apply
  - Suggestion state updates to "requested" then "answered"
- Clarified suggestions show green "Clarified" badge and promote "Apply" as primary action

### Execution Behavior

- Auto-execution pipelines **skip** suggestions with `clarificationState: "suggested"` or `"requested"`
- Ranking logic applies soft penalty (30%) to suggestions needing clarification
- They appear lower in lists but remain visible

## 2. Dismissal Reasons Taxonomy

### Updated Schema (`convex/schema.ts`)

Replaced old dismissal reasons with structured taxonomy:

```typescript
- not_relevant
- incorrect_or_low_quality
- too_risky_or_disruptive
- already_done_or_in_progress
- needs_more_clarification
- wrong_scope_or_target
- other
```

### Frontend Updates

Updated all dismissal UIs in:
- `src/pages/NoteDetail.tsx` - Radio button modal with reason selection
- `src/components/inbox/SuggestionDetail.tsx` - Select dropdown
- `src/pages/Inbox.tsx` - Select dropdown
- `src/types/index.ts` - Type definitions and display labels

### Capture Flow

1. User clicks **"Dismiss"**
2. Modal shows radio buttons / select dropdown with taxonomy
3. If "other" selected, shows freeform text input (256 char limit, optional)
4. On submit, dismissal event logged with structured reason
5. Reason stored on both suggestion record and event for analytics

## 3. Daily Metrics & Reporting

### New Tables (`convex/schema.ts`)

#### `dailySuggestionMetrics`
Stores aggregated daily facts with dimensions:
- `dateUtc`: Date in YYYY-MM-DD format
- `teamId`, `surface`, `suggestionFamily`: Dimension keys
- Core metrics: `suggestionsGenerated`, `suggestionsApplied`, `suggestionsDismissed`, `clarificationRequests`
- Computed rates: `applyRate`, `dismissRate`, `clarificationRate`, `nhi` (Net Helpfulness Index)

#### `ruleQualityScores`
Stores quality scores for rules/prompts:
- `ruleOrPromptId`: Rule identifier
- `suggestionFamily`: Category
- Aggregate metrics from rolling 30-day window
- `qualityScore`: Derived score for ranking (NHI * confidence factor)
- Counts for confidence estimation

### Aggregation Logic (`convex/dailyMetrics.ts`)

- **`computeDailyMetrics`**: Action that runs daily to aggregate events
  - Groups events by date and multiple dimensions (team, surface, family)
  - Computes apply rate, dismiss rate, clarification rate, NHI
  - Stores results in `dailySuggestionMetrics` table
  - **Idempotent**: Can re-run for same day, overwrites existing records

- **`getDailyMetrics`**: Query to retrieve metrics for date range
- **`getDailyReport`**: Query to get formatted report with global, by-family, and by-surface breakdowns

### Cron Jobs (`convex/cron.ts`)

Two scheduled jobs:
1. **Daily Metrics**: Runs at 1:00 AM UTC, computes metrics for previous day
2. **Rule Quality Scores**: Runs at 2:00 AM UTC, computes 30-day rolling quality scores

### Retention Policy

- Raw events: 30-90 days (configurable via manual cleanup)
- Daily aggregates: 1 year
- No raw code, PII, or full suggestion text in analytics stores

## 4. Analytics Events & Logging

### Event Types (`convex/schema.ts`)

Extended `suggestionEventTypeValidator`:
- `generated` - When suggestion is created
- `viewed` - When suggestion is surfaced in UI (with rank/position)
- `shown` - Legacy compatibility, similar to viewed
- `applied` - When user applies suggestion
- `dismissed` - When user dismisses suggestion
- `clarification_requested` - When user requests clarification
- `clarification_answered` - When clarification is provided
- `regenerated` - When suggestions are regenerated

### Common Event Envelope

All events include:
- `eventType`, `eventTime`, `suggestionId`, `noteId`
- `userIdHash`: Salted hash (no raw emails)
- `teamId`, `surface`
- `suggestionFamily`, `ruleOrPromptId`
- `clarificationState` at event time

### Event-Specific Fields

- **generated**: `modelName`, `modelConfidenceScore`, `estimatedDiffSize`, `contextType`, `language`
- **viewed**: `rank` (position in list)
- **applied**: `timeToApplyMs`, `partialApply` flag
- **dismissed**: `dismissReason`, `timeToDismissMs`
- **clarification_requested**: `timeToClarificationMs`
- **clarification_answered**: `timeToAnswerMs`

### Post-Apply Quality Signals (Future)

Fields reserved for future implementation:
- `followup_edit_within_10min`: User edited same region shortly after
- `reverted_within_24h`: Suggestion was reverted
- `tests_run_after_apply`, `tests_failed`: Test integration
- `review_feedback_negative`: Explicit negative feedback from review tools

## 5. Rules-Based Learning (No Retraining)

### Quality Score Computation (`convex/ruleQuality.ts`)

- **`computeRuleQualityScores`**: Action that computes scores from events
  - Groups events by `ruleOrPromptId` and `suggestionFamily`
  - Computes apply rate, dismiss rate, clarification rate, NHI
  - Derives quality score: `NHI * confidence_factor`
    - `confidence_factor = min(1, totalGenerated / 50)` for gradual confidence growth
  - Filters rules with < 5 samples (insufficient data)
  - Updates `ruleQualityScores` table

### Ranking & Filtering (`convex/suggestionRanking.ts`)

- **`rankSuggestions`**: Ranks suggestions for a note
  - Retrieves quality scores for each suggestion's rule
  - Computes ranking score: `qualityScore * confidenceFactor * clarificationPenalty`
  - Filters out very low quality (score < -0.3 with sufficient data)
  - Returns sorted list with enriched metadata

- **Utility Functions**:
  - `shouldAutoApply`: Determines if suggestion qualifies for auto-apply (high quality, no clarification, high confidence)
  - `shouldShowSuggestion`: Filters very low quality suggestions
  - `suggestClarification`: Determines if clarification should be suggested (low confidence or high clarification rate)

### Integration Points

Suggestion generation can now:
1. Query quality scores for rules before generating
2. Adjust confidence thresholds based on quality scores
3. Set `clarificationState: "suggested"` for low-confidence or high-clarification-rate rules
4. Filter out suggestions from very low-quality rules

## 6. Analytics Dashboard (`src/pages/Analytics.tsx`)

New admin page showing:

### Daily Report Tab
- Date selector to view any previous day's metrics
- Global metrics: generated, applied, dismissed, NHI, clarification rate
- Breakdown by suggestion family
- Breakdown by UI surface

### Rule Quality Tab
- Top 10 performing rules with highest quality scores
- Rules needing attention (quality score < -0.2)
- For each rule: apply rate, dismiss rate, NHI, total samples

## Implementation Checklist

✅ **Task 1: Add ClarificationState**
- Schema updated with enum and fields
- Mutations for request/answer lifecycle
- Event logging for clarification

✅ **Task 2: Dismissal Reasons**
- Schema updated with new taxonomy
- Frontend UIs updated (NoteDetail, SuggestionDetail, Inbox)
- Type definitions and display labels

✅ **Task 3: Clarification UI**
- Badges and visual treatments for clarification states
- "Ask Shipit to clarify" button and modal
- State transitions and event logging
- "Apply anyway" option for suggested/requested states

✅ **Task 4: Event Logging**
- Extended event types (generated, viewed, clarification_*)
- Common envelope with analytics fields
- Event-specific fields (timing, rank, etc.)
- Integrated into all suggestion mutations

✅ **Task 5: Daily Aggregation**
- New tables: dailySuggestionMetrics, ruleQualityScores
- Batch jobs: computeDailyMetrics, computeRuleQualityScores
- Cron configuration for nightly runs
- Query APIs for retrieving metrics

✅ **Task 6: Rules-Based Learning**
- Quality score computation from aggregates
- Ranking logic with confidence and clarification penalties
- Filtering utilities for auto-apply and show/hide decisions
- Integration hooks for suggestion generation

## Key Design Principles

1. **No Model Retraining**: All learning happens via config-level weights updated from aggregated data
2. **No Embeddings**: Pure rules-based approach using discrete signals
3. **No Analytics Bloat**: 
   - Only 6 core event types
   - Fields limited to enums, IDs, coarse-grained numerics
   - Retention policies in place
   - No raw code or PII
4. **Idempotent Jobs**: Daily aggregation can be re-run safely
5. **Minimal Friction**: Clarification is optional, not blocking
6. **Config-Driven**: Quality scores adjust thresholds and ranking, not model parameters

## Usage

### For Product Managers
1. Visit `/analytics` to view daily reports
2. Monitor NHI (Net Helpfulness Index) as primary metric
3. Review top/low quality rules weekly
4. Iterate on rule configurations based on quality scores

### For Engineers
1. When adding new suggestion rules, assign a unique `ruleOrPromptId`
2. Set `suggestionFamily` for analytics grouping
3. Use `modelConfidenceScore` for model-provided confidence
4. Query `suggestionRanking.rankSuggestions` for ranked lists
5. Use utility functions to determine auto-apply, filtering, clarification

### For Data Scientists (Future)
1. Export daily metrics for deeper analysis
2. Use quality scores to identify rules for refinement
3. Analyze dismissal reasons to improve rule logic
4. Monitor clarification rates to tune confidence thresholds

## Future Enhancements

1. **Post-Apply Quality Signals**: 
   - Track followup edits, reverts, test failures
   - Integrate with code review feedback

2. **Advanced Ranking**:
   - Personalization based on user history
   - Context-aware ranking (time of day, project phase)

3. **Clarification LLM Integration**:
   - Call LLM to generate actual clarification responses
   - Use conversation history for context

4. **Dashboard Enhancements**:
   - Time series charts for trends
   - Cohort analysis by team/project
   - Alerting for quality degradation

5. **A/B Testing**:
   - Test rule changes with control groups
   - Measure impact of threshold adjustments

## Files Changed

### Backend (Convex)
- `convex/schema.ts` - Schema updates
- `convex/suggestions.ts` - Clarification mutations, updated dismiss validators
- `convex/dailyMetrics.ts` - New: Daily aggregation logic
- `convex/ruleQuality.ts` - New: Rule quality score computation
- `convex/suggestionRanking.ts` - New: Ranking and filtering logic
- `convex/cron.ts` - New: Scheduled jobs configuration

### Frontend (React)
- `src/types/index.ts` - Type definitions for clarification and dismissal
- `src/pages/NoteDetail.tsx` - Clarification UI and handlers
- `src/components/inbox/SuggestionDetail.tsx` - Updated dismissal reasons
- `src/pages/Inbox.tsx` - Updated dismissal reasons
- `src/pages/Analytics.tsx` - New: Analytics dashboard

## Testing Recommendations

1. **Clarification Flow**:
   - Create suggestion with `clarificationState: "suggested"`
   - Verify "Ask Shipit to clarify" button appears
   - Request clarification, verify state transitions
   - Apply after clarification

2. **Dismissal Reasons**:
   - Dismiss suggestions with each reason
   - Verify "other" freeform text works
   - Check events table has correct dismissReason

3. **Daily Metrics**:
   - Manually trigger `computeDailyMetrics` for a date
   - Verify dailySuggestionMetrics table populated
   - Check getDailyReport returns correct data

4. **Rule Quality**:
   - Create suggestions from multiple rules
   - Apply/dismiss to create varied outcomes
   - Run `computeRuleQualityScores`
   - Verify scores reflect behavior

5. **Analytics Dashboard**:
   - Open `/analytics`
   - Switch between Daily Report and Rule Quality tabs
   - Verify metrics display correctly

## Deployment Notes

1. Run `npx convex dev` to apply schema changes
2. Cron jobs will start automatically on next deployment
3. First metrics will be available day after deployment
4. Quality scores require 5+ samples per rule to appear

## Support

For questions or issues with this implementation, refer to:
- Plan document: `.cursor/plans/shipit-behavior-learning_*.plan.md`
- This implementation doc
- Individual file comments and type definitions
