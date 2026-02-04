/**
 * Example usage of the Belief-First Reasoning Pipeline
 * 
 * This file demonstrates how to use the pipeline in various scenarios
 */

import { executeBeliefPipeline, DEFAULT_PIPELINE_CONFIG } from './index';
import type { MeetingNote, BeliefExtractionResult } from './types';

/**
 * Example 1: Basic usage
 */
async function basicExample() {
  const note: MeetingNote = {
    id: 'meeting-001',
    occurred_at: '2026-02-03T14:00:00Z',
    raw_markdown: `
# Product Roadmap Review

## Q1 Plans

The payment service was planned for March release. We decided to push it to April to ensure better testing coverage.

## Team Changes

Sarah will take over the analytics dashboard. Mike previously owned it.

## Priority Adjustments

User authentication is now P0 (was P1). This is critical for launch.
    `.trim(),
  };

  const result = await executeBeliefPipeline(note);

  console.log('=== Basic Example ===');
  console.log(`Meeting ID: ${result.meeting_id}`);
  console.log(`Found ${result.beliefs.length} beliefs:\n`);

  for (const belief of result.beliefs) {
    console.log(`Belief: ${belief.summary}`);
    console.log(`  Dimension: ${belief.dimension}`);
    console.log(`  Subject: ${belief.subject_handle}`);
    console.log(`  Confidence: ${belief.confidence_band} (${belief.confidence_score.toFixed(2)})`);
    console.log(`  Before: ${belief.before_state.substring(0, 60)}...`);
    console.log(`  After: ${belief.after_state.substring(0, 60)}...`);
    console.log(`  Needs clarification: ${belief.needs_clarification}`);
    if (belief.needs_clarification) {
      console.log(`  Reasons: ${belief.clarification_reasons.join(', ')}`);
    }
    console.log('');
  }
}

/**
 * Example 2: With introspection
 */
async function introspectionExample() {
  const note: MeetingNote = {
    id: 'meeting-002',
    occurred_at: '2026-02-03T15:00:00Z',
    raw_markdown: `
# Sprint Planning

- Add dark mode feature
- Remove legacy API endpoints
- Update documentation
    `.trim(),
  };

  const config = {
    ...DEFAULT_PIPELINE_CONFIG,
    include_introspection: true,
  };

  const result = await executeBeliefPipeline(note, config);

  console.log('=== Introspection Example ===');
  console.log(`Sections: ${result.sections?.length || 0}`);
  console.log(`Utterances: ${result.utterances?.length || 0}`);
  console.log(`Beliefs: ${result.beliefs.length}\n`);

  // Inspect sections
  if (result.sections) {
    console.log('Sections:');
    for (const section of result.sections) {
      console.log(`  [${section.type}] ${section.title || '(no title)'}`);
    }
    console.log('');
  }

  // Inspect utterances
  if (result.utterances) {
    console.log('Utterances:');
    for (const utterance of result.utterances.slice(0, 5)) {
      console.log(`  "${utterance.text}"`);
    }
    console.log('');
  }
}

/**
 * Example 3: Custom configuration
 */
async function customConfigExample() {
  const note: MeetingNote = {
    id: 'meeting-003',
    occurred_at: '2026-02-03T16:00:00Z',
    raw_markdown: `
# Architecture Decision

We discussed using PostgreSQL vs MongoDB. Team decided on PostgreSQL for better ACID guarantees.
    `.trim(),
  };

  // Higher confidence thresholds
  const strictConfig = {
    ...DEFAULT_PIPELINE_CONFIG,
    confidence_threshold_high: 0.85, // Stricter high confidence
    confidence_threshold_uncertain: 0.70, // Stricter uncertain
    contradiction_penalty: 0.3, // Higher penalty for contradictions
  };

  const result = await executeBeliefPipeline(note, strictConfig);

  console.log('=== Custom Config Example ===');
  console.log('Using stricter confidence thresholds\n');

  for (const belief of result.beliefs) {
    console.log(`${belief.dimension}: ${belief.subject_handle}`);
    console.log(`  Confidence: ${belief.confidence_band} (${belief.confidence_score.toFixed(2)})`);
  }
  console.log('');
}

/**
 * Example 4: Filtering by confidence
 */
async function filteringExample() {
  const note: MeetingNote = {
    id: 'meeting-004',
    occurred_at: '2026-02-03T17:00:00Z',
    raw_markdown: `
# Status Update

The API integration is complete. Frontend work is ongoing. 
Maybe we'll add caching later, but not sure yet.
The mobile app might need some updates too.
    `.trim(),
  };

  const result = await executeBeliefPipeline(note);

  console.log('=== Filtering Example ===');
  console.log(`Total beliefs: ${result.beliefs.length}\n`);

  // Filter high confidence beliefs only
  const highConfidence = result.beliefs.filter(b => b.confidence_band === 'high');
  console.log(`High confidence beliefs: ${highConfidence.length}`);
  for (const belief of highConfidence) {
    console.log(`  - ${belief.summary}`);
  }
  console.log('');

  // Filter beliefs needing clarification
  const needsClarification = result.beliefs.filter(b => b.needs_clarification);
  console.log(`Beliefs needing clarification: ${needsClarification.length}`);
  for (const belief of needsClarification) {
    console.log(`  - ${belief.summary}`);
    console.log(`    Reasons: ${belief.clarification_reasons.join(', ')}`);
  }
  console.log('');
}

/**
 * Example 5: Evidence span usage
 */
async function evidenceSpanExample() {
  const note: MeetingNote = {
    id: 'meeting-005',
    occurred_at: '2026-02-03T18:00:00Z',
    raw_markdown: `
# Release Planning

The v2.0 release was scheduled for June. After discussing with stakeholders, we're moving it to July to include the security audit.
    `.trim(),
  };

  const result = await executeBeliefPipeline(note);

  console.log('=== Evidence Span Example ===');

  for (const belief of result.beliefs) {
    console.log(`\nBelief: ${belief.summary}`);
    console.log(`Evidence spans: ${belief.evidence_spans.length}`);

    // Group spans by role
    const byRole = {
      before: belief.evidence_spans.filter(s => s.role === 'before'),
      after: belief.evidence_spans.filter(s => s.role === 'after'),
      supporting: belief.evidence_spans.filter(s => s.role === 'supporting'),
      contradicting: belief.evidence_spans.filter(s => s.role === 'contradicting'),
    };

    console.log(`  Before spans: ${byRole.before.length}`);
    console.log(`  After spans: ${byRole.after.length}`);
    console.log(`  Supporting spans: ${byRole.supporting.length}`);
    console.log(`  Contradicting spans: ${byRole.contradicting.length}`);

    // Show character offsets for UI highlighting
    for (const span of belief.evidence_spans) {
      const spanText = note.raw_markdown.substring(span.start_char, span.end_char);
      console.log(`  [${span.role}] chars ${span.start_char}-${span.end_char}: "${spanText}"`);
    }
  }
  console.log('');
}

/**
 * Example 6: Empty note handling
 */
async function emptyNoteExample() {
  const emptyNote: MeetingNote = {
    id: 'meeting-006',
    occurred_at: '2026-02-03T19:00:00Z',
    raw_markdown: '',
  };

  const result = await executeBeliefPipeline(emptyNote);

  console.log('=== Empty Note Example ===');
  console.log(`Beliefs from empty note: ${result.beliefs.length}`);
  console.log('(This is valid - zero beliefs is an acceptable output)\n');
}

/**
 * Run all examples
 */
async function runAllExamples() {
  console.log('========================================');
  console.log('Belief-First Pipeline Examples');
  console.log('========================================\n');

  await basicExample();
  await introspectionExample();
  await customConfigExample();
  await filteringExample();
  await evidenceSpanExample();
  await emptyNoteExample();

  console.log('========================================');
  console.log('All examples completed!');
  console.log('========================================');
}

// Export for use in other modules
export {
  basicExample,
  introspectionExample,
  customConfigExample,
  filteringExample,
  evidenceSpanExample,
  emptyNoteExample,
  runAllExamples,
};

// Run examples if executed directly
if (require.main === module) {
  runAllExamples().catch(console.error);
}
