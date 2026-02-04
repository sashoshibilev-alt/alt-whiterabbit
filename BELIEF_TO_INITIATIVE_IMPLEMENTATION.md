# Belief-to-Initiative Conversion Layer - Implementation Summary

## Overview

This document summarizes the implementation of the belief-to-initiative suggestion conversion system, which transforms execution-agnostic beliefs from meeting notes into actionable initiative-level suggestions within Shipit.

**Status**: ✅ Complete - All planned components implemented and tested.

## What Was Implemented

### Core Pipeline Components

#### 1. Type System (`src/lib/belief-to-initiative/types.ts`)

Comprehensive type definitions for the entire conversion pipeline:

- **Input Types**
  - `BeliefWithRouting` - Beliefs enhanced with initiative routing information
  - `TimelineSignal` - Timeline-specific metadata extracted from beliefs
  
- **Intermediate Types**
  - `ImplicationKind` - Classification of belief implications (pure_commentary, timeline_risk, timeline_pull_in, timeline_uncertain)
  - `BeliefImplication` - Classified implication with concrete date and delta information
  
- **Output Types**
  - `InitiativeSuggestion` - Final suggestion object with action, status, payload, and evidence
  - `CommentPayload` / `MutateReleaseDatePayload` - Action-specific payloads
  - `EvidenceSpanRef` - References to source evidence with deep-link metadata
  
- **Configuration**
  - `SuggestionThresholds` - Configurable thresholds for all pipeline stages
  - `BeliefToSuggestionConfig` - Full pipeline configuration

#### 2. Implication Classifier (`src/lib/belief-to-initiative/implicationClassifier.ts`)

Determines what kind of action a belief implies:

**Features:**
- Pattern-based classification using regex matching
- Timeline signal analysis (likelihood scores, dates, deltas)
- Concrete date extraction from natural language
- Delta estimation from text ("2 weeks", "a month", etc.)
- Support for ISO dates, month names, quarter references

**Classification Logic:**
- Analyzes belief dimension and timeline signals
- Matches against risk/pull-in/uncertain patterns
- Falls back to pure commentary if no timeline signals
- Extracts and validates concrete dates
- Computes estimated deltas from text

#### 3. Suggestion Builder (`src/lib/belief-to-initiative/suggestionBuilder.ts`)

Converts beliefs + implications into concrete suggestions:

**Features:**
- **Comment Suggestions**
  - Created for all non-trivial beliefs
  - Tone classification (neutral, caution, opportunity)
  - Clarification prompts for ambiguous mappings
  
- **Release Date Mutation Suggestions**
  - Derives proposed dates from signals
  - Applies deltas to current dates
  - Validates date reasonableness
  - Computes direction (push_back/pull_in)
  
- **Status Determination**
  - Initiative mapping strength analysis
  - Large delta detection (>90 days)
  - Uncertainty handling
  
- **Scoring**
  - Spam scoring based on confidence, impact, vagueness
  - Priority scoring based on impact, confidence, recency

#### 4. Guardrail Filter (`src/lib/belief-to-initiative/guardrailFilter.ts`)

Anti-spam measures without dropping suggestions:

**Features:**
- **Clustering**
  - Groups similar beliefs by initiative, dimension, topic
  - Uses embeddings (cosine similarity) or text overlap
  - Computes centroids for cluster representation
  
- **Deduplication**
  - Cross-meeting dedup by content similarity
  - Merges evidence into existing suggestions
  - Boosts priority of reinforced suggestions
  
- **Soft Caps**
  - Per-initiative, per-meeting rate limits
  - Configurable caps (default: 3 comments, 1 date change)
  - Overflow aggregation (merge into top suggestions)
  
- **Scoring & Ranking**
  - Priority-based sorting
  - Spam score consideration
  - Never drops - only ranks or downgrades status

#### 5. Feedback Loop (`src/lib/belief-to-initiative/feedbackLoop.ts`)

Learns from user actions to refine the system:

**Features:**
- **Event Tracking**
  - Accepts, dismissals, edits
  - Dismiss reasons (wrong_initiative, too_ambiguous, spam, etc.)
  - Time to action metrics
  
- **Statistical Analysis**
  - Acceptance/dismissal rates overall
  - Breakdown by action type (comment vs release date)
  - Breakdown by status (suggested vs needs_clarification)
  - Dismiss reason frequencies
  
- **Threshold Adjustment**
  - Automated recommendations based on feedback patterns
  - Confidence-scored adjustments
  - Handles high dismissal rates, spam patterns, ambiguity issues
  
- **Pattern Learning**
  - Spam indicator extraction from dismissed suggestions
  - Quality signal extraction from quick acceptances
  - Token-based pattern recognition

#### 6. Main Pipeline (`src/lib/belief-to-initiative/index.ts`)

Orchestrates the full conversion process:

```typescript
executeBeliefToSuggestionPipeline(
  beliefs: BeliefWithRouting[],
  existingSuggestions: InitiativeSuggestion[],
  config?: Partial<BeliefToSuggestionConfig>
): BeliefToSuggestionResult
```

**Pipeline Flow:**
1. Classify implications for all beliefs
2. Build raw suggestions from beliefs + implications
3. Cluster beliefs if enabled (for aggregation)
4. Apply guardrails (dedup, rate limits, ranking)
5. Return filtered suggestions with debug info

### UI Integration

#### Evidence Spans Component (`src/components/inbox/EvidenceSpans.tsx`)

Rich evidence display with deep-linking:

**Features:**
- Collapsible evidence list with badge showing count
- Grouped by meeting/note
- Individual evidence items show:
  - Speaker name and icon
  - Timestamp (relative: "2 days ago")
  - Quoted snippet
  - "View in notes" link with deep-link URL
- Inline evidence badge for compact display
- Evidence preview for tooltips

**Integration:**
- Added to `SuggestionDetail.tsx` after Evidence & Provenance section
- Conditionally rendered when suggestion has evidence spans
- Deep-links use query parameter: `/notes/{noteId}?highlight={start}-{end}`

### Backend Integration

#### Convex API (`convex/beliefToInitiative.ts`)

Backend functions for suggestion storage and feedback:

**Functions:**
- `storeInitiativeSuggestions` - Stores suggestions in database
- `recordSuggestionFeedback` - Captures user actions on suggestions
- `getFeedbackStats` - Queries feedback metrics for analysis
- `generateFromBeliefs` - Action to run full pipeline from beliefs

**Features:**
- Validators for all suggestion types and payloads
- Evidence span storage with full metadata
- Feedback event tracking
- Stats aggregation for threshold tuning

### Testing

#### Comprehensive Test Suite (`src/lib/belief-to-initiative/belief-to-initiative.test.ts`)

**Coverage:**
- Implication classification for all kinds
- Suggestion building with various belief configurations
- Status determination (suggested vs needs_clarification)
- Guardrail filtering and rate limits
- Feedback stats computation
- Threshold adjustment recommendations

**Test Cases:**
- ✅ Pure commentary classification
- ✅ Timeline risk with concrete date
- ✅ Timeline pull-in
- ✅ Timeline uncertain
- ✅ Comment suggestion building
- ✅ Release date mutation building
- ✅ Needs clarification for ambiguous initiatives
- ✅ Rate limiting enforcement
- ✅ Feedback stats accuracy
- ✅ Threshold adjustment recommendations

### Documentation

#### Comprehensive README (`src/lib/belief-to-initiative/README.md`)

**Contents:**
- Architecture overview with diagrams
- Component descriptions
- Design principles (never drop, evidence preservation, etc.)
- Usage examples (basic, custom config, feedback)
- UI integration guide
- Configuration reference
- Real-world examples with expected outputs
- Testing instructions
- Future enhancement roadmap

## Key Design Decisions

### 1. Never Drop Suggestions Due to Insufficient Structure

**Decision**: Always materialize something for each non-trivial belief, even if ambiguous or low-confidence.

**Implementation**:
- Ambiguous → `needs_clarification` status
- Low priority → lower `priority_score` (rank lower, don't drop)
- Missing data → `needs_clarification` with explicit prompt

**Rationale**: Preserves signal, lets humans decide, provides learning data.

### 2. Exactly Two Action Types

**Decision**: Only `comment` and `mutate_release_date` actions, no other types.

**Implementation**:
- Comment suggestions for all non-trivial beliefs
- Release date mutations only for timeline implications with date references
- Both can be created for the same belief (narrative + action)

**Rationale**: Follows spec constraint; keeps system focused; avoids feature creep.

### 3. Evidence Always Preserved

**Decision**: Never strip evidence spans from beliefs; always carry through to suggestions.

**Implementation**:
- Evidence spans stored as `EvidenceSpanRef[]` in suggestions
- Deep-link metadata (meeting, note, char offsets) preserved
- UI component for rich evidence display
- Aggregation merges evidence from multiple beliefs

**Rationale**: Transparency, trust, verification, debugging.

### 4. Downgrade, Don't Drop

**Decision**: Use `needs_clarification` status instead of dropping low-quality suggestions.

**Implementation**:
- Status determination in suggestion builder
- Criteria: ambiguous initiative, missing data, large delta, uncertain signals
- Clarification prompts in payload text
- Still shown in UI (maybe collapsed section)

**Rationale**: Preserves signal; humans may have context AI lacks; provides feedback data.

### 5. Soft Caps with Overflow Aggregation

**Decision**: Rate limit suggestions per initiative per meeting, but aggregate overflow instead of dropping.

**Implementation**:
- Configurable caps (default: 3 comments, 1 release date per initiative)
- Priority-based selection (top N)
- Overflow merged into top suggestions
- Evidence and belief IDs accumulated

**Rationale**: Controls spam without losing information; reinforces high-confidence suggestions.

## Examples from Plan Implemented

All examples from the specification have been implemented and tested:

### Example 1: Clear Schedule Slip → `mutate_release_date` + `comment`

✅ **Implemented**: Suggestion builder creates both suggestions; release date has concrete date; comment has timeline risk tone.

### Example 2: Qualitative Risk, No Concrete Date → `mutate_release_date` `needs_clarification`

✅ **Implemented**: Status set to `needs_clarification`; proposed_release_date is null; rationale asks for confirmation.

### Example 3: Ambiguous Initiative Mapping → `comment` `needs_clarification`

✅ **Implemented**: target_initiative_id is null; body includes clarification prompt; status is `needs_clarification`.

### Example 4: Many Similar Beliefs → Single Aggregated `comment`

✅ **Implemented**: Clustering groups similar beliefs; suggestion has multiple belief_ids; evidence spans merged; body indicates aggregation.

## Configuration & Tuning

### Default Thresholds

```typescript
{
  min_initiative_match_score: 0.7,
  min_match_gap: 0.2,
  ambiguous_match_threshold: 0.4,
  min_belief_confidence: 0.6,
  min_impact_level: 'medium',
  max_delta_days: 90,
  max_comment_suggestions_per_initiative_per_meeting: 3,
  max_release_date_suggestions_per_initiative_per_meeting: 1,
  embedding_similarity_threshold: 0.85,
}
```

### Feedback-Driven Adjustment

The system analyzes feedback and recommends threshold adjustments:

- High `wrong_initiative` dismissals → increase `min_initiative_match_score`
- High `too_ambiguous` dismissals → increase `min_belief_confidence`
- High `spam` dismissals → decrease rate limits
- Very high acceptance rate → decrease confidence thresholds (be less conservative)

## File Structure

```
src/lib/belief-to-initiative/
├── types.ts                          # Type definitions
├── implicationClassifier.ts          # Classify belief implications
├── suggestionBuilder.ts              # Build suggestions from beliefs
├── guardrailFilter.ts                # Clustering, dedup, rate limits
├── feedbackLoop.ts                   # User feedback analysis & learning
├── index.ts                          # Main pipeline orchestration
├── belief-to-initiative.test.ts      # Comprehensive test suite
└── README.md                         # Full documentation

src/components/inbox/
└── EvidenceSpans.tsx                 # UI component for evidence display

convex/
└── beliefToInitiative.ts             # Backend API for storage & feedback
```

## Testing & Validation

### Unit Tests

```bash
npm test src/lib/belief-to-initiative
```

All core functions have unit tests covering:
- Normal cases
- Edge cases (ambiguous, missing data)
- Boundary conditions (thresholds)
- Integration scenarios

### Manual Testing Scenarios

To manually test the system:

1. **Create test beliefs** with various dimensions and timeline signals
2. **Run pipeline** with different configurations
3. **Inspect suggestions** for correct action, status, and payload
4. **Simulate feedback** (accepts, dismisses)
5. **Analyze recommendations** from feedback loop

## Future Enhancements

The implementation is production-ready but could be enhanced with:

1. **ML-based Initiative Matching**
   - Replace text similarity with semantic embeddings
   - Train on historical mappings
   - Improve ambiguous cases

2. **Conflict Detection**
   - Flag when multiple suggestions propose different dates for same initiative
   - Surface conflicts in UI for human resolution

3. **Batch Operations**
   - "Apply all high-confidence suggestions" action
   - Bulk dismiss low-priority items

4. **Natural Language Rationales**
   - LLM-generated explanations for timeline changes
   - More readable than template-based text

5. **Auto-Initiative Creation**
   - When no good match found, suggest creating new initiative
   - Pre-fill fields from belief content

6. **Cross-Initiative Dependencies**
   - Detect when one initiative's slip affects another
   - Suggest cascading date changes

## Deployment Notes

### Database Schema Changes

The implementation reuses the existing `suggestions` table but could benefit from:

```sql
-- Optional: Extend suggestions table
ALTER TABLE suggestions ADD COLUMN action VARCHAR; -- 'comment' or 'mutate_release_date'
ALTER TABLE suggestions ADD COLUMN status VARCHAR; -- 'suggested' or 'needs_clarification'
ALTER TABLE suggestions ADD COLUMN payload JSON; -- Structured payload
ALTER TABLE suggestions ADD COLUMN belief_ids JSON; -- Array of belief IDs
ALTER TABLE suggestions ADD COLUMN evidence_spans JSON; -- Array of evidence spans
ALTER TABLE suggestions ADD COLUMN spam_score FLOAT;
ALTER TABLE suggestions ADD COLUMN priority_score FLOAT;

-- Optional: Feedback events table
CREATE TABLE feedback_events (
  id VARCHAR PRIMARY KEY,
  suggestion_id VARCHAR REFERENCES suggestions(id),
  action VARCHAR, -- 'accepted', 'dismissed', 'edited'
  dismiss_reason VARCHAR,
  time_to_action_seconds INTEGER,
  user_id VARCHAR,
  created_at TIMESTAMP
);
```

For now, the system stores metadata as formatted text in the existing `content` field.

### Environment Configuration

No environment variables required. All configuration via code:

```typescript
import { DEFAULT_BELIEF_TO_SUGGESTION_CONFIG } from '@/lib/belief-to-initiative';

// Override defaults
const config = {
  ...DEFAULT_BELIEF_TO_SUGGESTION_CONFIG,
  thresholds: {
    ...DEFAULT_BELIEF_TO_SUGGESTION_CONFIG.thresholds,
    min_belief_confidence: 0.7, // Stricter
  },
};
```

### Performance Considerations

- **Clustering**: O(n²) for n beliefs; use sampling for large sets
- **Embeddings**: Pre-compute and cache if available
- **Deduplication**: O(n×m) for n new and m existing suggestions; optimize with indexing
- **Feedback analysis**: Batch computation; run periodically (daily/weekly)

### Monitoring

Key metrics to track:

- Suggestion generation rate (suggestions per meeting)
- Action type distribution (comment vs release date)
- Status distribution (suggested vs needs_clarification)
- Acceptance rate by action type
- Dismissal reasons distribution
- Threshold drift over time (from feedback loop)

## Conclusion

The belief-to-initiative conversion layer has been fully implemented according to the specification. All core components, UI integration, backend API, tests, and documentation are complete. The system is ready for integration with the existing belief pipeline and can begin generating initiative-level suggestions from meeting notes.

**Next Steps:**
1. Integrate with belief pipeline (call conversion after belief extraction)
2. Wire UI to display new suggestion types
3. Deploy backend functions to Convex
4. Monitor initial feedback and tune thresholds
5. Iterate based on user behavior

---

**Implementation Date**: February 3, 2026  
**Status**: ✅ Complete  
**Test Coverage**: Comprehensive  
**Documentation**: Complete
