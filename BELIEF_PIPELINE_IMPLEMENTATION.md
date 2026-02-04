# Belief-First Reasoning Pipeline - Implementation Summary

## Overview

Successfully implemented a complete belief-first reasoning pipeline that converts meeting notes (markdown) into structured belief objects representing plan deltas. The implementation follows the specification from `/Users/sasho/.cursor/plans/belief-first-pipeline_721d8770.plan.md`.

## Implementation Status

✅ **COMPLETE** - All 5 TODOs completed:

1. ✅ Finalized TypeScript/DTO schemas for all data structures
2. ✅ Implemented markdown parsing, section segmentation, and utterance extraction
3. ✅ Implemented belief candidate detection with classification and grouping
4. ✅ Implemented belief synthesis with before/after generation and confidence scoring
5. ✅ Exposed belief-extraction API endpoints via Convex

## Files Created

### Core Pipeline

1. **`src/lib/belief-pipeline/types.ts`** (282 lines)
   - Complete type definitions for all pipeline stages
   - Input/output types, belief structures, configuration
   - 40+ exported types covering all aspects of the pipeline

2. **`src/lib/belief-pipeline/utils.ts`** (140 lines)
   - Utility functions for ID generation, string manipulation, similarity
   - Helper functions for vagueness and ambiguity detection
   - Math utilities and grouping functions

3. **`src/lib/belief-pipeline/normalization.ts`** (25 lines)
   - Stage 0: Input normalization
   - Line ending normalization and boilerplate stripping

4. **`src/lib/belief-pipeline/segmentation.ts`** (218 lines)
   - Stage 1: Section segmentation
   - Markdown parser with block-level AST
   - Section extraction with stable character offsets

5. **`src/lib/belief-pipeline/utterance-extraction.ts`** (153 lines)
   - Stage 2: Utterance extraction
   - Sentence tokenization with abbreviation handling
   - Bullet point extraction from lists
   - Character offset tracking

6. **`src/lib/belief-pipeline/belief-detection.ts`** (298 lines)
   - Stage 3: Belief candidate detection
   - Pattern-based utterance classification
   - Candidate grouping by subject/dimension
   - Evidence span creation

7. **`src/lib/belief-pipeline/belief-synthesis.ts`** (122 lines)
   - Stage 4: Belief synthesis
   - Before/after state generation
   - Source type determination
   - Summary generation

8. **`src/lib/belief-pipeline/scoring.ts`** (183 lines)
   - Stage 5: Scoring & confidence calculation
   - Multi-factor confidence scoring
   - Confidence band determination
   - Clarification need detection

9. **`src/lib/belief-pipeline/pipeline.ts`** (59 lines)
   - Main pipeline orchestrator
   - Sequential stage execution
   - Output assembly with optional introspection

10. **`src/lib/belief-pipeline/index.ts`** (58 lines)
    - Public API exports
    - Clean interface for consumers

### API Layer

11. **`convex/beliefPipeline.ts`** (107 lines)
    - Convex API endpoints
    - `extractBeliefs`: Extract from arbitrary note
    - `extractBeliefsFromNote`: Extract from database note
    - `getPipelineConfig`: Get default configuration

### Testing

12. **`src/lib/belief-pipeline/belief-pipeline.test.ts`** (321 lines)
    - Comprehensive test suite with 17 tests
    - Tests for all 6 pipeline stages
    - End-to-end pipeline tests
    - Edge case handling tests
    - All tests passing ✅

### Documentation

13. **`src/lib/belief-pipeline/README.md`** (456 lines)
    - Complete usage documentation
    - API reference
    - Type documentation
    - Examples and code samples
    - Architecture decisions
    - Future enhancements roadmap

14. **`BELIEF_PIPELINE_IMPLEMENTATION.md`** (this file)
    - Implementation summary
    - File inventory
    - Architecture overview

## Architecture Overview

### Pipeline Stages

```
MeetingNote (markdown)
  ↓
[Stage 0: Normalization]
  ↓
NormalizedMeetingNote
  ↓
[Stage 1: Segmentation] → Sections
  ↓
[Stage 2: Utterance Extraction] → Utterances
  ↓
[Stage 3: Belief Detection] → Classifications → Candidates
  ↓
[Stage 4: Synthesis] → Beliefs (with before/after)
  ↓
[Stage 5: Scoring] → Beliefs (with confidence)
  ↓
[Stage 6: Assembly]
  ↓
BeliefExtractionResult
```

### Key Design Decisions

1. **Character Offset Stability**
   - All stages maintain precise character offsets
   - Enables traceability and UI highlighting
   - Critical for evidence span extraction

2. **No Belief Dropping**
   - Low-quality beliefs receive low confidence scores
   - Never filtered out by pipeline
   - Consumers decide filtering policy

3. **Pattern-Based Classification**
   - Current: Keyword matching and heuristics
   - Future: Can be replaced with LLM classifier
   - Designed as pluggable component

4. **Multi-Factor Scoring**
   - Evidence count, source type, structure
   - Contradiction detection
   - Configurable weights

5. **Explicit Uncertainty**
   - `needs_clarification` boolean flag
   - Specific `clarification_reasons`
   - Helps downstream systems know what to ask

## Belief Dimensions Supported

The pipeline classifies beliefs across 9 dimensions:

1. **timeline** - Schedule, deadline, release date changes
2. **scope** - Feature additions/removals, requirement changes
3. **ownership** - Assignment, team, responsibility changes
4. **priority** - Priority level changes (P0, P1, etc.)
5. **dependency** - Dependency relationships and blockers
6. **risk** - Risk identification and mitigation
7. **status** - Progress and status updates (not plan changes)
8. **decision** - Decisions made between options
9. **other** - Other types of changes

## Confidence Scoring

### Scoring Formula

```
confidence_score = clamp01(
  (base * source_type_weight) +
  (0.1 * min(log(1 + evidence_count), 3)) +
  (0.1 * (has_before + has_after)) -
  (0.2 * has_contradictions)
)
```

### Source Type Weights

- **explicit** (1.0): Both before/after clearly stated
- **implicit** (0.7): One side inferred
- **external** (0.4): Depends on prior context

### Confidence Bands

- **high**: score ≥ 0.75 AND no contradictions
- **uncertain**: score < 0.75 OR has contradictions
- **none**: Not used for beliefs (status updates only)

### Clarification Triggers

A belief needs clarification if ANY:
- Uncertain AND score ≤ 0.6
- Source type is external
- Has contradicting evidence
- Contains vague language (maybe, roughly, probably)
- Timeline with ambiguous terms (soon, later, TBD)
- Scope with ambiguous terms (might include, unclear scope)

## Test Results

```
✅ 17/17 tests passing

Stage 0: Normalization (2 tests)
Stage 1: Segmentation (2 tests)
Stage 2: Utterance Extraction (2 tests)
Stage 3: Belief Detection (3 tests)
Stage 4: Belief Synthesis (1 test)
Stage 5: Scoring (1 test)
End-to-End Pipeline (3 tests)
Edge Cases (3 tests)
```

## API Usage Examples

### Direct Pipeline Usage

```typescript
import { executeBeliefPipeline } from './lib/belief-pipeline';

const result = await executeBeliefPipeline({
  id: 'meeting-123',
  occurred_at: '2026-02-03T10:00:00Z',
  raw_markdown: '# Meeting notes...',
});

console.log(`Found ${result.beliefs.length} beliefs`);
```

### Convex API Usage

```typescript
import { api } from './convex/_generated/api';

// From arbitrary note
const result = await convex.mutation(api.beliefPipeline.extractBeliefs, {
  note: { id, occurred_at, raw_markdown },
});

// From database note
const result = await convex.mutation(api.beliefPipeline.extractBeliefsFromNote, {
  noteId: noteId,
});
```

## Data Structures

### Core Belief Structure

```typescript
{
  id: "belief-uuid",
  meeting_id: "meeting-123",
  created_at: "2026-02-03T10:15:00Z",
  dimension: "timeline",
  subject_handle: "billing revamp",
  summary: "timeline change for billing revamp: from Q1 to Q2",
  before_state: "The billing revamp was scheduled for Q1",
  after_state: "We decided to move it to Q2",
  source_type: "explicit",
  evidence_spans: [
    {
      id: "span-uuid",
      meeting_id: "meeting-123",
      section_id: "section-uuid",
      utterance_id: "utterance-uuid",
      start_char: 42,
      end_char: 89,
      role: "before"
    }
  ],
  confidence_score: 0.82,
  confidence_band: "high",
  needs_clarification: false,
  clarification_reasons: [],
}
```

## Performance Characteristics

- **Stages**: 6 sequential stages
- **Time Complexity**: O(n) where n = markdown length
- **Memory**: O(n) for storing sections/utterances
- **No External API Calls**: Fully local processing
- **Deterministic**: Same input → same output

## Future Enhancements

### Short Term
- Replace pattern classifier with LLM
- Improve subject handle extraction
- Add section proximity weighting
- Multi-language support

### Medium Term
- Temporal reasoning (relative dates)
- Entity resolution
- Cross-meeting belief tracking
- Learning from user feedback

### Long Term
- Automatic initiative matching
- Suggestion generation
- Conflict detection
- Belief graph construction

## Constraints Satisfied

✅ **No integrations**: Pipeline is self-contained, no external APIs
✅ **No initiative matching**: Beliefs use string handles, not IDs
✅ **No validation drops beliefs**: Low-quality beliefs kept with low confidence
✅ **Zero beliefs allowed**: Empty array is valid output
✅ **Stable offsets**: All character offsets preserved through pipeline
✅ **Clear before/after**: Explicit before_state and after_state fields
✅ **Confidence scoring**: Multi-factor scoring with explicit bands
✅ **Clarification detection**: Explicit needs_clarification with reasons

## Integration Points

The pipeline integrates with existing Shipit systems:

1. **Convex Database**: Reads notes from `notes` table
2. **Convex API**: Exposes pipeline via mutations/queries
3. **Type System**: Compatible with existing Shipit types
4. **Testing Infrastructure**: Uses Vitest like other tests

## Summary

Successfully delivered a complete, tested, and documented belief-first reasoning pipeline that:

- Converts markdown meeting notes into structured beliefs
- Maintains precise character offsets for traceability
- Provides multi-factor confidence scoring
- Detects and flags uncertainty explicitly
- Includes comprehensive test coverage
- Exposes clean API via Convex
- Follows all architectural constraints
- Ready for production use

**Total Lines of Code**: ~2,500 lines across 14 files
**Test Coverage**: 17 comprehensive tests, all passing
**Documentation**: 456-line README + this summary

## Next Steps

To use the belief pipeline in production:

1. **Replace Pattern Classifier**: Integrate LLM-based classification in Stage 3
2. **Connect to UI**: Build interface to display beliefs with evidence highlighting
3. **Add Feedback Loop**: Collect user feedback on belief quality
4. **Monitor Performance**: Track pipeline execution time and belief quality metrics
5. **Tune Scoring**: Adjust confidence weights based on production data

The pipeline is production-ready and can be deployed as-is, with the pattern-based classifier serving as a functional baseline that can be enhanced with ML models over time.
