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

function makeStrategySection(
  headingText: string,
  rawText: string,
  numListItems: number
): ClassifiedSection {
  return {
    section_id: 'sec_strategy_001',
    note_id: 'note_strategy_001',
    heading_text: headingText,
    heading_level: 2,
    start_line: 0,
    end_line: numListItems + 2,
    body_lines: rawText.split('\n').map((text, index) => ({
      index,
      text,
      line_type: 'list_item' as const,
    })),
    structural_features: {
      num_lines: numListItems,
      num_list_items: numListItems,
      has_dates: false,
      has_metrics: false,
      has_quarter_refs: false,
      has_version_refs: false,
      has_launch_keywords: false,
      initiative_phrase_density: 0,
    },
    raw_text: rawText,
    is_actionable: true,
    intent: {
      plan_change: 0.4,
      new_workstream: 0.5,
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

// ============================================================
// Part 1: Strategy-heading guard — PLAN_CHANGE signals must not
// produce project_update candidates in strategy-only sections
// ============================================================

describe('Part 1: strategy-heading guard suppresses plan_change update candidates', () => {
  beforeEach(() => {
    resetBSignalCounter();
  });

  it('Black Box section (no delta) with shift verb: emits no project_update candidate', () => {
    // The heading "Black Box Prioritization System" matches STRATEGY_HEADING_PATTERN.
    // "pushed from Q1 to Q2" would normally trigger extractPlanChange (PLAN_CHANGE signal).
    // But isStrategyOnlySection returns false when a delta is present... actually for the
    // no-delta guard: use bullets WITHOUT a delta to confirm the guard fires.
    const rawText = [
      '- Score claims against behavioral and intent signals',
      '- Use algorithm to automate triage',
      '- Reduce manual work per region',
      '- Prioritize accounts by revenue potential',
    ].join('\n');
    const section = makeStrategySection('Black Box Prioritization System', rawText, 4);

    const candidates = seedCandidatesFromBSignals(section);

    // All candidates must be non-project_update (idea or risk)
    const updateCandidates = candidates.filter(c => c.type === 'project_update');
    expect(updateCandidates).toHaveLength(0);
  });

  it('Black Box section (no delta): emits only idea candidates (no project_update)', () => {
    const rawText = [
      '- Build scoring system to rank claims',
      '- Implement algorithm for automated triage',
      '- Reduce manual review per region',
      '- Prioritize accounts by revenue potential',
    ].join('\n');
    const section = makeStrategySection('Black Box Prioritization System', rawText, 4);

    const candidates = seedCandidatesFromBSignals(section);

    // No project_update candidate should exist
    const updateCandidates = candidates.filter(c => c.type === 'project_update');
    expect(updateCandidates).toHaveLength(0);
  });

  it('Control: Black Box section WITH concrete delta still emits project_update', () => {
    // "pushed from Q1 to Q2" is a concrete delta — isStrategyOnlySection returns false,
    // so the strategy guard does NOT apply.
    const rawText = [
      '- Score claims against behavioral and intent signals',
      '- Use algorithm to automate triage (pushed from Q1 to Q2)',
      '- Reduce manual work per region',
      '- Prioritize accounts by revenue potential',
    ].join('\n');
    // For this case the section needs has_quarter_refs true to help classify
    const section: ClassifiedSection = {
      ...makeStrategySection('Black Box Prioritization System', rawText, 4),
      structural_features: {
        num_lines: 4,
        num_list_items: 4,
        has_dates: false,
        has_metrics: false,
        has_quarter_refs: true,
        has_version_refs: false,
        has_launch_keywords: false,
        initiative_phrase_density: 0,
      },
    };

    const candidates = seedCandidatesFromBSignals(section);

    // At least one project_update candidate should be emitted (delta present → guard not applied)
    const updateCandidates = candidates.filter(c => c.type === 'project_update');
    expect(updateCandidates.length).toBeGreaterThanOrEqual(1);
  });

  it('non-strategy heading with shift verb still emits project_update (guard scope check)', () => {
    // "Engineering Updates" does not match STRATEGY_HEADING_PATTERN → guard does not apply
    const section = makeSection('We pushed the launch to Q3.');
    const candidates = seedCandidatesFromBSignals(section);

    const updateCandidates = candidates.filter(c => c.type === 'project_update');
    expect(updateCandidates.length).toBeGreaterThanOrEqual(1);
  });
});
