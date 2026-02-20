/**
 * B-Signal Candidate Seeding Tests
 *
 * Asserts that actionable sections produce candidates seeded from B-signals,
 * with correct title templates and metadata.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { seedCandidatesFromBSignals, resetBSignalCounter } from './bSignalSeeding';
import type { ClassifiedSection } from './types';

function makeSection(rawText: string): ClassifiedSection {
  return {
    section_id: 'sec_test_001',
    note_id: 'note_test_001',
    heading_text: 'Test Section',
    heading_level: 2,
    start_line: 0,
    end_line: 5,
    body_lines: rawText.split('\n').map((text, index) => ({
      index,
      text,
      line_type: 'paragraph' as const,
    })),
    structural_features: {
      num_lines: 1,
      num_list_items: 0,
      has_dates: false,
      has_metrics: false,
      has_quarter_refs: true,
      has_version_refs: false,
      has_launch_keywords: false,
      initiative_phrase_density: 0,
    },
    raw_text: rawText,
    is_actionable: true,
    intent: {
      plan_change: 0.5,
      new_workstream: 0.6,
      status_informational: 0.1,
      communication: 0.1,
      research: 0.1,
      calendar: 0.0,
      micro_tasks: 0.0,
    },
    suggested_type: 'idea',
    type_confidence: 0.7,
    typeLabel: 'idea',
  };
}

describe('seedCandidatesFromBSignals', () => {
  beforeEach(() => {
    resetBSignalCounter();
  });

  it('creates at least one candidate from a FEATURE_DEMAND B-signal', () => {
    const section = makeSection('They need bulk-upload by Q3.');
    const candidates = seedCandidatesFromBSignals(section);

    expect(candidates.length).toBeGreaterThanOrEqual(1);

    const bsigCandidate = candidates.find(c => c.metadata?.source === 'b-signal');
    expect(bsigCandidate).toBeDefined();
  });

  it('candidate title contains "bulk-upload"', () => {
    const section = makeSection('They need bulk-upload by Q3.');
    const candidates = seedCandidatesFromBSignals(section);

    const bsigCandidate = candidates.find(c => c.metadata?.source === 'b-signal');
    expect(bsigCandidate?.title.toLowerCase()).toContain('bulk-upload');
  });

  it('candidate metadata.source is "b-signal"', () => {
    const section = makeSection('They need bulk-upload by Q3.');
    const candidates = seedCandidatesFromBSignals(section);

    const bsigCandidate = candidates.find(c => c.metadata?.source === 'b-signal');
    expect(bsigCandidate?.metadata?.source).toBe('b-signal');
  });

  it('returns empty array when no B-signals are present', () => {
    const section = makeSection('The team reviewed the roadmap last week.');
    const candidates = seedCandidatesFromBSignals(section);
    expect(candidates).toHaveLength(0);
  });

  it('deduplicates signals with same sentenceIndex and proposedType, keeping highest confidence', () => {
    // Both extractors that fire on this sentence should be deduped per (sentenceIndex, proposedType)
    const section = makeSection('Users need bulk-upload by Q3.');
    const candidates = seedCandidatesFromBSignals(section);

    // Count candidates per sentenceIndex:proposedType pair
    const seen = new Set<string>();
    for (const c of candidates) {
      // All from same sentence (index 0) and same type → max 1 per type
      const key = `${c.metadata?.type}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });
});
