# Belief-First Reasoning Pipeline

A comprehensive pipeline for extracting structured beliefs from meeting notes. This pipeline converts raw markdown meeting notes into structured belief objects that represent meaningful plan deltas (before/after states) without any execution or suggestion concerns.

## Overview

The belief-first reasoning pipeline implements a multi-stage approach to extract and structure beliefs from meeting notes:

1. **Stage 0: Input Normalization** - Normalize line endings and strip boilerplate
2. **Stage 1: Section Segmentation** - Parse markdown into sections with stable offsets
3. **Stage 2: Utterance Extraction** - Extract fine-grained utterances (sentences/bullets)
4. **Stage 3: Belief Candidate Detection** - Classify utterances and group into candidates
5. **Stage 4: Belief Synthesis** - Synthesize beliefs with before/after states
6. **Stage 5: Scoring & Confidence** - Compute confidence scores and clarification needs
7. **Stage 6: Output Assembly** - Package results with optional introspection data

## Key Features

- **Stable Character Offsets**: All extracted elements maintain precise character offsets into the original markdown
- **Belief Dimensions**: Classifies beliefs across multiple dimensions (timeline, scope, ownership, priority, dependency, risk, status, decision)
- **Confidence Scoring**: Multi-factor confidence scoring with explicit uncertainty handling
- **Clarification Detection**: Identifies beliefs that need clarification with specific reasons
- **No External Dependencies**: Self-contained pipeline with no external API integrations
- **Zero Beliefs Valid**: Returns empty belief array when no plan changes detected

## Installation

```bash
npm install
```

## Usage

### Basic Usage

```typescript
import { executeBeliefPipeline } from './lib/belief-pipeline';

const note = {
  id: 'meeting-123',
  occurred_at: '2026-02-03T10:00:00Z',
  raw_markdown: `
# Product Planning Meeting

## Timeline Discussion
The billing revamp was scheduled for Q1. We decided to move it to Q2.
  `,
};

const result = await executeBeliefPipeline(note);

console.log(`Found ${result.beliefs.length} beliefs`);
for (const belief of result.beliefs) {
  console.log(`- ${belief.dimension}: ${belief.summary}`);
  console.log(`  Confidence: ${belief.confidence_band} (${belief.confidence_score.toFixed(2)})`);
}
```

### With Configuration

```typescript
import { executeBeliefPipeline, DEFAULT_PIPELINE_CONFIG } from './lib/belief-pipeline';

const config = {
  ...DEFAULT_PIPELINE_CONFIG,
  include_introspection: true, // Include sections and utterances in result
  confidence_threshold_high: 0.8, // Raise high confidence threshold
};

const result = await executeBeliefPipeline(note, config);

// Access introspection data
console.log(`Extracted ${result.sections?.length} sections`);
console.log(`Extracted ${result.utterances?.length} utterances`);
```

### Using Individual Stages

```typescript
import { stages } from './lib/belief-pipeline';

// Run stages individually for debugging
const normalized = stages.normalizeMeetingNote(note);
const stage1 = stages.segmentMeetingNote(normalized);
const stage2 = stages.extractUtterances(stage1);
const stage3 = stages.detectBeliefCandidates(stage2);
const stage4 = stages.synthesizeBeliefs(stage3);
const stage5 = stages.scoreBeliefs(stage4);

// Inspect intermediate results
console.log('Candidates:', stage3.candidates);
console.log('Beliefs:', stage4.beliefs);
console.log('Scoring features:', stage5.scoring_features);
```

## API Reference

### Types

#### `MeetingNote`

Input to the pipeline.

```typescript
interface MeetingNote {
  id: string;
  occurred_at: string; // ISO DateTime
  raw_markdown: string;
}
```

#### `Belief`

Core output of the pipeline.

```typescript
interface Belief {
  id: string;
  meeting_id: string;
  created_at: string; // ISO DateTime
  dimension: BeliefDimension;
  subject_handle: string;
  summary: string;
  before_state: string;
  after_state: string;
  source_type: BeliefSourceType;
  evidence_spans: BeliefEvidenceSpan[];
  confidence_score: number; // 0.0-1.0
  confidence_band: BeliefConfidenceBand;
  needs_clarification: boolean;
  clarification_reasons: ClarificationReason[];
  // Optional fields...
}
```

#### `BeliefDimension`

Categories of plan changes.

```typescript
type BeliefDimension = 
  | "timeline"    // Schedule, deadline, release date changes
  | "scope"       // Feature additions, removals, requirement changes
  | "ownership"   // Assignment, team, responsibility changes
  | "priority"    // Priority level changes
  | "dependency"  // Dependency relationships
  | "risk"        // Risk identification and mitigation
  | "status"      // Progress and status updates
  | "decision"    // Decisions made
  | "other";      // Other types of changes
```

#### `BeliefSourceType`

How the belief is grounded in the note.

```typescript
type BeliefSourceType = 
  | "explicit"  // Both before and after clearly stated
  | "implicit"  // One side inferred from phrasing
  | "external"; // Depends on prior context not in note
```

#### `BeliefConfidenceBand`

Confidence level categories.

```typescript
type BeliefConfidenceBand = 
  | "none"       // No belief; status/context only
  | "high"       // High confidence belief
  | "uncertain"; // Belief requires clarification
```

#### `ClarificationReason`

Reasons why a belief needs clarification.

```typescript
type ClarificationReason = 
  | "ambiguous_timeline"
  | "ambiguous_scope"
  | "conflicting_statements"
  | "depends_on_external_context"
  | "low_model_confidence";
```

#### `BeliefExtractionResult`

Final output of the pipeline.

```typescript
interface BeliefExtractionResult {
  meeting_id: string;
  beliefs: Belief[];
  sections?: Section[];     // Optional introspection data
  utterances?: Utterance[]; // Optional introspection data
}
```

### Configuration

#### `BeliefPipelineConfig`

```typescript
interface BeliefPipelineConfig {
  model_version: string;
  include_introspection: boolean;
  confidence_threshold_high: number;
  confidence_threshold_uncertain: number;
  evidence_boost_weight: number;
  structure_bonus_weight: number;
  contradiction_penalty: number;
}
```

Default configuration:

```typescript
{
  model_version: "belief-pipeline-v0.1",
  include_introspection: false,
  confidence_threshold_high: 0.75,
  confidence_threshold_uncertain: 0.6,
  evidence_boost_weight: 0.1,
  structure_bonus_weight: 0.1,
  contradiction_penalty: 0.2,
}
```

## Convex API

The pipeline is exposed via Convex functions for easy integration.

### `extractBeliefs`

Extract beliefs from a meeting note.

```typescript
import { api } from './convex/_generated/api';

const result = await convex.mutation(api.beliefPipeline.extractBeliefs, {
  note: {
    id: 'meeting-123',
    occurred_at: '2026-02-03T10:00:00Z',
    raw_markdown: '# Meeting notes...',
  },
  config: {
    include_introspection: true,
  },
});
```

### `extractBeliefsFromNote`

Extract beliefs from an existing note in the database.

```typescript
const result = await convex.mutation(api.beliefPipeline.extractBeliefsFromNote, {
  noteId: noteId, // Convex ID
  config: {
    confidence_threshold_high: 0.8,
  },
});
```

### `getPipelineConfig`

Get the default pipeline configuration.

```typescript
const config = await convex.query(api.beliefPipeline.getPipelineConfig, {});
```

## Scoring Algorithm

The pipeline uses a multi-factor scoring algorithm to determine confidence:

### Features

- `f_evidence_count`: log(1 + |evidence_spans|)
- `f_explicit_before`: 1 if has "before" span, else 0
- `f_explicit_after`: 1 if has "after" span, else 0
- `f_contradictions`: 1 if has contradicting spans, else 0
- `f_source_type_weight`: 1.0 (explicit), 0.7 (implicit), 0.4 (external)

### Score Calculation

```
confidence_score = clamp01(
  (base * f_source_type_weight) + 
  (0.1 * min(f_evidence_count, 3)) +
  (0.1 * (f_explicit_before + f_explicit_after)) -
  (0.2 * f_contradictions)
)
```

### Confidence Bands

- **High**: score >= 0.75 AND no contradictions
- **Uncertain**: score < 0.75 OR has contradictions

### Clarification Rules

A belief needs clarification if ANY of:
- Confidence is uncertain AND score <= 0.6
- Source type is external
- Has contradicting evidence
- Contains vague language (maybe, roughly, etc.)
- Timeline dimension with ambiguous terms (soon, later, etc.)
- Scope dimension with ambiguous terms (might include, unclear scope, etc.)

## Testing

Run the test suite:

```bash
npm test
```

Run tests in watch mode:

```bash
npm run test:watch
```

Run specific test file:

```bash
npm test belief-pipeline.test.ts
```

## Architecture Decisions

### Pattern-Based Classification (Stage 3)

The current implementation uses pattern-based utterance classification with keyword matching and heuristics. This is a starting point that can be replaced with:

- **LLM-based classifier**: Use GPT-4, Claude, or similar for more accurate classification
- **Fine-tuned model**: Train a specialized model on meeting note data
- **Hybrid approach**: Combine patterns with LLM for confidence validation

### Character Offsets

All stages maintain stable character offsets into the original markdown. This enables:

- Precise evidence span extraction
- UI highlighting of relevant text
- Traceability from beliefs back to source text
- Round-trip validation and debugging

### No Belief Dropping

The pipeline never drops beliefs after they're constructed. Instead:

- Low-quality beliefs get low confidence scores
- Uncertain beliefs are flagged with `needs_clarification`
- Clarification reasons explain specific issues
- Downstream consumers can filter based on confidence

### Zero External Dependencies

The pipeline is self-contained and doesn't require:

- External API calls (e.g., OpenAI, Anthropic)
- Initiative matching or lookup
- Historical belief context
- User preferences or settings

This makes the pipeline deterministic, testable, and easy to reason about.

## Future Enhancements

### Short Term

- [ ] LLM-based utterance classification
- [ ] Improved subject handle extraction
- [ ] Section proximity weighting in candidate grouping
- [ ] Multi-language support

### Medium Term

- [ ] Temporal reasoning (understanding relative time expressions)
- [ ] Entity resolution (mapping mentions to canonical entities)
- [ ] Cross-meeting belief tracking
- [ ] Belief confidence learning from user feedback

### Long Term

- [ ] Automatic initiative matching
- [ ] Suggestion generation from beliefs
- [ ] Conflict detection across beliefs
- [ ] Belief graph construction

## Contributing

When adding new features or fixing bugs:

1. Add/update tests in `belief-pipeline.test.ts`
2. Update type definitions in `types.ts`
3. Document changes in this README
4. Ensure all tests pass before committing

## License

Part of the Shipit project.
