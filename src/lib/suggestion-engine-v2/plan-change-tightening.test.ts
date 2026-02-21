/**
 * Plan-change tightening tests (Stage 4.55 / sentence-candidate awareness)
 *
 * CONTEXT:
 *   Dense-paragraph extraction (Stage 4.55) emits one candidate per signal-bearing
 *   sentence.  Previously, plan_change intent could be triggered at the section level
 *   by vague pressure language, causing the plan_change override (bypass ACTIONABILITY
 *   gate) to affect all candidates from the same parent section, including unrelated
 *   sibling sentences.
 *
 * THIS FILE TESTS:
 *   A) Positive: "We're looking at a 4-week delay…" → hasPlanChangeEligibility=true
 *   B) Negative: "Pressure from the Board…" alone → plan_change classification false
 *   C) Integration: CloudScale dense-paragraph note
 *      - "4-week delay" candidate has planChangeEligible: true (project_update)
 *      - "Pressure from the Board" produces NO candidate (no B-signal match)
 *      - GDPR risk sentence still emits a risk candidate
 *   D) Canonical gold note: "V1 launch 12th → 19th" still qualifies as plan_change
 *
 * RULE: hasPlanChangeEligibility(text) requires BOTH:
 *   A) An explicit change marker (word from V3_CHANGE_OPERATORS), e.g. delay, push, slip
 *   B) A concrete delta: numeric time unit (4-week, 2 days) or
 *      explicit date change (12th→19th, from June to August, delayed to Q3)
 *
 * This rule is applied at the candidate/sentence level so plan_change override
 * only attaches to the sentence whose span actually contains the change+delta.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  hasPlanChangeEligibility,
  isPlanChangeIntentLabel,
  classifyIntent,
  generateSuggestions,
  DEFAULT_CONFIG,
} from './index';
import type { NoteInput } from './types';
import { resetSectionCounter } from './preprocessing';
import { resetSuggestionCounter } from './synthesis';
import {
  isDenseParagraphSection,
  extractDenseParagraphCandidates,
  resetDenseParagraphCounter,
} from './denseParagraphExtraction';
import { classifySections } from './classifiers';
import { DEFAULT_THRESHOLDS } from './types';
import { preprocessNote } from './preprocessing';
import { CLOUDSCALE_NOTE } from './cloudscale-regression-helpers';

// ============================================
// A) Positive unit tests for hasPlanChangeEligibility
// ============================================

describe('hasPlanChangeEligibility — positive cases (change marker + concrete delta)', () => {
  it('returns true for "4-week delay" (primary spec example)', () => {
    expect(
      hasPlanChangeEligibility("We're looking at a 4-week delay just to figure out the handshake protocol.")
    ).toBe(true);
  });

  it('returns true for ordinal date change with arrow "from the 12th to the 19th"', () => {
    expect(
      hasPlanChangeEligibility("Pushing the V1 launch from the 12th to the 19th.")
    ).toBe(true);
  });

  it('returns true for the full canonical gold note sentence', () => {
    expect(
      hasPlanChangeEligibility("We're pushing the V1 launch from the 12th to the 19th due to infra delays.")
    ).toBe(true);
  });

  it('returns true for month-name date range "from June to August"', () => {
    expect(
      hasPlanChangeEligibility("We moved the launch date from June to August.")
    ).toBe(true);
  });

  it('returns true for "delayed to Q3"', () => {
    expect(
      hasPlanChangeEligibility("The launch was delayed to Q3.")
    ).toBe(true);
  });

  it('returns true for "pushed until March"', () => {
    expect(
      hasPlanChangeEligibility("The release is pushed until March.")
    ).toBe(true);
  });

  it('returns true for "slipped by 2 weeks"', () => {
    expect(
      hasPlanChangeEligibility("The sprint has slipped by 2 weeks.")
    ).toBe(true);
  });

  it('returns true for "slipped by 14 days"', () => {
    expect(
      hasPlanChangeEligibility("V1 launch slipped by 14 days.")
    ).toBe(true);
  });
});

// ============================================
// B) Negative unit tests for hasPlanChangeEligibility
// ============================================

describe('hasPlanChangeEligibility — negative cases (no concrete delta)', () => {
  it('returns false for "Pressure from the Board…" (primary spec negative example — no change verb)', () => {
    expect(
      hasPlanChangeEligibility("Pressure from the Board to get this live before the annual conference.")
    ).toBe(false);
  });

  it('returns false for vague "move faster" without delta', () => {
    expect(
      hasPlanChangeEligibility("We need to move faster on delivery.")
    ).toBe(false);
  });

  it('returns false for vague "shift priorities" without delta', () => {
    expect(
      hasPlanChangeEligibility("The team should shift their priorities.")
    ).toBe(false);
  });

  it('returns false for vague "accelerate timeline" without delta', () => {
    expect(
      hasPlanChangeEligibility("We should accelerate the timeline.")
    ).toBe(false);
  });

  it('returns false for strategic pivot "shift from enterprise to SMB" (no date delta)', () => {
    // "from enterprise to SMB" is a strategic direction change, NOT a date/time delta.
    // The regex must NOT match generic "from X to Y" patterns without date-like tokens.
    expect(
      hasPlanChangeEligibility("Shift from enterprise to SMB customers.")
    ).toBe(false);
  });

  it('returns false for "defer enterprise features" without time delta', () => {
    expect(
      hasPlanChangeEligibility("Defer enterprise features to focus on SMB.")
    ).toBe(false);
  });
});

// ============================================
// B-ext) Section-level: "Pressure from the Board" alone must NOT qualify
// ============================================

describe('Section-level plan_change — "Pressure from the Board" alone must not qualify', () => {
  it('should NOT classify "Pressure from the Board" as plan_change intent', () => {
    const section = {
      section_id: 'test-pressure',
      note_id: 'test',
      heading_text: '',
      raw_text: 'Pressure from the Board to get this live before the annual conference.',
      body_lines: [
        { text: 'Pressure from the Board to get this live before the annual conference.', index: 0, line_type: 'paragraph' as const },
      ],
      start_line: 0,
      end_line: 0,
      structural_features: { num_lines: 1, num_list_items: 0, num_heading_lines: 0, avg_line_length: 70, has_explicit_ask: false },
    };

    const intent = classifyIntent(section);
    expect(isPlanChangeIntentLabel(intent)).toBe(false);
  });

  it('a note with ONLY pressure language should emit zero plan_change suggestions', () => {
    const note: NoteInput = {
      note_id: 'test-pressure-only',
      raw_markdown: 'Pressure from the Board to get this live before the annual conference.',
    };
    const result = generateSuggestions(note, undefined, DEFAULT_CONFIG);
    const planChangeSuggestions = result.suggestions.filter(
      (s) => s.type === 'project_update'
    );
    expect(planChangeSuggestions.length).toBe(0);
  });
});

// ============================================
// C) Dense-paragraph integration: CloudScale note
// ============================================

describe('Dense-paragraph integration: CloudScale note', () => {
  beforeEach(() => {
    resetSectionCounter();
    resetSuggestionCounter();
    resetDenseParagraphCounter();
  });

  it('dense-paragraph section is detected for CloudScale note', () => {
    const { sections } = preprocessNote(CLOUDSCALE_NOTE);
    const classified = classifySections(sections, DEFAULT_THRESHOLDS);
    const denseSection = classified.find((s) => isDenseParagraphSection(s));
    expect(denseSection).toBeDefined();
  });

  it('the "4-week delay" dense-paragraph candidate has planChangeEligible: true', () => {
    const { sections } = preprocessNote(CLOUDSCALE_NOTE);
    const classified = classifySections(sections, DEFAULT_THRESHOLDS);
    const denseSection = classified.find((s) => isDenseParagraphSection(s));
    expect(denseSection).toBeDefined();

    const candidates = extractDenseParagraphCandidates(denseSection!);
    const delayCandidate = candidates.find((c) => {
      const text = [c.title, ...c.evidence_spans.map((e) => e.text)].join(' ').toLowerCase();
      return text.includes('delay') || text.includes('4-week') || text.includes('handshake');
    });

    expect(delayCandidate).toBeDefined();
    expect(delayCandidate!.type).toBe('project_update');
    expect(delayCandidate!.metadata?.planChangeEligible).toBe(true);
  });

  it('the "Pressure from the Board" sentence does NOT produce a dense-paragraph candidate', () => {
    const { sections } = preprocessNote(CLOUDSCALE_NOTE);
    const classified = classifySections(sections, DEFAULT_THRESHOLDS);
    const denseSection = classified.find((s) => isDenseParagraphSection(s));
    expect(denseSection).toBeDefined();

    const candidates = extractDenseParagraphCandidates(denseSection!);
    const pressureCandidate = candidates.find((c) => {
      const text = [c.title, ...c.evidence_spans.map((e) => e.text)].join(' ').toLowerCase();
      return text.includes('pressure') || text.includes('board') || text.includes('annual conference');
    });

    // "Pressure from the Board" has no B-signal match, so no candidate is emitted.
    expect(pressureCandidate).toBeUndefined();
  });

  it('the GDPR risk sentence still emits a risk candidate (planChangeEligible: false)', () => {
    const { sections } = preprocessNote(CLOUDSCALE_NOTE);
    const classified = classifySections(sections, DEFAULT_THRESHOLDS);
    const denseSection = classified.find((s) => isDenseParagraphSection(s));
    expect(denseSection).toBeDefined();

    const candidates = extractDenseParagraphCandidates(denseSection!);
    const gdprCandidate = candidates.find((c) => {
      const text = [c.title, ...c.evidence_spans.map((e) => e.text)].join(' ').toLowerCase();
      return (
        text.includes('gdpr') ||
        text.includes('dead in the water') ||
        text.includes('german nodes') ||
        text.includes('compliance')
      );
    });

    expect(gdprCandidate).toBeDefined();
    expect(gdprCandidate!.type).toBe('risk');
    // GDPR sentence is a conditional risk, not a schedule change with delta.
    expect(gdprCandidate!.metadata?.planChangeEligible).toBe(false);
  });

  it('full engine run still emits a project_update grounded in the delay sentence', () => {
    const result = generateSuggestions(CLOUDSCALE_NOTE, undefined, DEFAULT_CONFIG);
    const updates = result.suggestions.filter((s) => s.type === 'project_update');
    expect(updates.length).toBeGreaterThanOrEqual(1);

    const delayUpdate = updates.find((s) => {
      const allText = [s.title, ...s.evidence_spans.map((e) => e.text)].join(' ').toLowerCase();
      return allText.includes('4-week') || allText.includes('delay') || allText.includes('handshake');
    });
    expect(delayUpdate).toBeDefined();
  });

  it('full engine run still emits a risk suggestion grounded in the GDPR sentence', () => {
    const result = generateSuggestions(CLOUDSCALE_NOTE, undefined, DEFAULT_CONFIG);
    const risks = result.suggestions.filter((s) => s.type === 'risk');
    expect(risks.length).toBeGreaterThanOrEqual(1);

    const gdprRisk = risks.find((s) => {
      const allText = [s.title, ...s.evidence_spans.map((e) => e.text)].join(' ').toLowerCase();
      return (
        allText.includes('gdpr') ||
        allText.includes('dead in the water') ||
        allText.includes('german nodes') ||
        allText.includes('compliance')
      );
    });
    expect(gdprRisk).toBeDefined();
  });
});

// ============================================
// D) Canonical gold note: "V1 launch 12th → 19th" must still qualify
// ============================================

describe('Canonical gold note: "V1 launch 12th → 19th" must still be plan_change-qualified', () => {
  beforeEach(() => {
    resetSectionCounter();
    resetSuggestionCounter();
  });

  it('hasPlanChangeEligibility returns true for the canonical gold note sentence', () => {
    // The gold note sentence from typed-suggestions-integration.test.ts
    expect(
      hasPlanChangeEligibility("We're pushing the V1 launch from the 12th to the 19th due to infra delays.")
    ).toBe(true);
  });

  it('the Launch Status section in the gold note is classified as plan_change intent', () => {
    const section = {
      section_id: 'gold-test',
      note_id: 'gold-note',
      heading_text: 'Launch Status',
      raw_text: "We're pushing the V1 launch from the 12th to the 19th due to infra delays.",
      body_lines: [
        {
          text: "We're pushing the V1 launch from the 12th to the 19th due to infra delays.",
          index: 1,
          line_type: 'paragraph' as const,
        },
      ],
      start_line: 0,
      end_line: 1,
      structural_features: {
        num_lines: 1,
        num_list_items: 0,
        num_heading_lines: 0,
        avg_line_length: 75,
        has_explicit_ask: false,
      },
    };

    const intent = classifyIntent(section);
    expect(isPlanChangeIntentLabel(intent)).toBe(true);
  });

  it('the full gold note produces a project_update referencing the date change', () => {
    const goldNote: NoteInput = {
      note_id: 'integration-typed-test-gold',
      raw_markdown: `# Weekly Pulse Check — Engineering + CS

## Feature Requests

Sales is screaming for the CSV export feature — every enterprise trial asks for it and it's blocking expansion.

## Launch Status

We're pushing the V1 launch from the 12th to the 19th due to infra delays.

## Bug Report

The trial is failing because of latency in the global view — it's broken for users in APAC.

## Release Risk

If we don't fix the auth-token bloat, the mobile app might need to be pulled from the release.
`,
    };

    const result = generateSuggestions(goldNote, undefined, DEFAULT_CONFIG);
    const updates = result.suggestions.filter((s) => s.type === 'project_update');

    const launchUpdate = updates.find((s) => {
      const allText = [
        s.title,
        s.suggestion?.body ?? '',
        ...s.evidence_spans.map((e) => e.text),
      ]
        .join(' ')
        .toLowerCase();
      return (
        allText.includes('v1') ||
        allText.includes('12th') ||
        allText.includes('19th') ||
        allText.includes('launch')
      );
    });

    expect(launchUpdate).toBeDefined();
  });
});
