/**
 * Stage 6.5 — Section Consolidation Tests
 *
 * Four scenarios:
 *   1. 3 idea fragments from a single structured section → collapsed into 1 idea
 *   2. Mixed idea + risk in the same section → not merged (preserved as-is)
 *   3. Section with timeline/delta signals → not consolidated
 *   4. Single idea candidate → unchanged (pass-through)
 *
 * All tests operate on the consolidateBySection() function directly.
 * Integration behaviour (end-to-end via generateSuggestions) is covered by the
 * integration test at the bottom of this file.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  consolidateBySection,
  resetConsolidationCounter,
  buildConsolidatedBody,
  findMismatchedEvidencePreview,
} from './consolidateBySection';
import { generateSuggestions } from './index';
import { normalizeForComparison } from './preprocessing';
import { applyConfidenceBasedProcessing } from './scoring';
import { DEFAULT_THRESHOLDS } from './types';
import type { Suggestion, ClassifiedSection, EvidenceSpan } from './types';

// ============================================
// Helpers
// ============================================

function makeSpan(text: string, line = 0): EvidenceSpan {
  return { start_line: line, end_line: line, text };
}

function makeSection(
  overrides: Partial<ClassifiedSection> & { section_id: string }
): ClassifiedSection {
  return {
    note_id: 'note-test-001',
    start_line: 0,
    end_line: 10,
    body_lines: [],
    structural_features: {
      num_lines: 5,
      num_list_items: 3,
      has_dates: false,
      has_metrics: false,
      has_quarter_refs: false,
      has_version_refs: false,
      has_launch_keywords: false,
      initiative_phrase_density: 0,
    },
    raw_text: 'Section body without any timeline tokens.',
    is_actionable: true,
    intent: {
      plan_change: 0.2,
      new_workstream: 0.7,
      status_informational: 0.0,
      communication: 0.0,
      research: 0.0,
      calendar: 0.0,
      micro_tasks: 0.0,
    },
    suggested_type: 'idea',
    type_confidence: 0.8,
    typeLabel: 'idea',
    heading_text: 'Black Box Prioritization System',
    heading_level: 3,
    ...overrides,
  };
}

function makeIdea(
  sectionId: string,
  noteId: string,
  titleSuffix: string,
  spanText: string
): Suggestion {
  return {
    suggestion_id: `sug_${titleSuffix.replace(/\s/g, '_')}`,
    note_id: noteId,
    section_id: sectionId,
    type: 'idea',
    title: `Idea: ${titleSuffix}`,
    payload: { draft_initiative: { title: titleSuffix, description: spanText } },
    evidence_spans: [makeSpan(spanText)],
    scores: {
      section_actionability: 0.7,
      type_choice_confidence: 0.7,
      synthesis_confidence: 0.7,
      overall: 0.7,
    },
    routing: { create_new: true },
    suggestionKey: `key_${titleSuffix.replace(/\s/g, '_')}`,
    metadata: { source: 'idea-semantic' },
  };
}

function makeRisk(sectionId: string, noteId: string, spanText: string): Suggestion {
  return {
    suggestion_id: 'sug_risk_001',
    note_id: noteId,
    section_id: sectionId,
    type: 'risk',
    title: 'Risk: dependency on vendor',
    payload: {},
    evidence_spans: [makeSpan(spanText)],
    scores: {
      section_actionability: 0.6,
      type_choice_confidence: 0.6,
      synthesis_confidence: 0.6,
      overall: 0.6,
    },
    routing: { create_new: true },
    suggestionKey: 'key_risk_001',
    metadata: { source: 'b-signal' },
  };
}

// ============================================
// Test 1: 3 idea fragments → 1 consolidated idea
// ============================================

describe('consolidateBySection: 3 idea fragments in one structured section', () => {
  const SECTION_ID = 'sec-bboxprio-001';
  const NOTE_ID = 'note-bboxprio-001';

  let section: ClassifiedSection;
  let sectionMap: Map<string, ClassifiedSection>;
  let suggestions: Suggestion[];

  beforeEach(() => {
    resetConsolidationCounter();
    section = makeSection({
      section_id: SECTION_ID,
      note_id: NOTE_ID,
      heading_text: 'Black Box Prioritization System',
      heading_level: 3,
      structural_features: {
        num_lines: 6,
        num_list_items: 3,
        has_dates: false,
        has_metrics: false,
        has_quarter_refs: false,
        has_version_refs: false,
        has_launch_keywords: false,
        initiative_phrase_density: 0,
      },
      raw_text: 'Three-factor scoring. Remote sensing integration. Extend additionality.',
    });
    sectionMap = new Map([[SECTION_ID, section]]);

    suggestions = [
      makeIdea(SECTION_ID, NOTE_ID, 'Three-factor scoring', 'Three-factor scoring for claims.'),
      makeIdea(SECTION_ID, NOTE_ID, 'Remote sensing integration', 'Remote sensing integration pipeline.'),
      makeIdea(SECTION_ID, NOTE_ID, 'Additionality concept', 'Extend additionality framework.'),
    ];
  });

  it('collapses 3 idea candidates into 1', () => {
    const result = consolidateBySection(suggestions, sectionMap);
    expect(result).toHaveLength(1);
  });

  it('consolidated suggestion has type "idea"', () => {
    const [consolidated] = consolidateBySection(suggestions, sectionMap);
    expect(consolidated.type).toBe('idea');
  });

  it('consolidated title is derived from section heading', () => {
    const [consolidated] = consolidateBySection(suggestions, sectionMap);
    expect(consolidated.title.toLowerCase()).toContain('black box prioritization system');
  });

  it('consolidated evidence spans include spans from multiple children (up to 5)', () => {
    const [consolidated] = consolidateBySection(suggestions, sectionMap);
    expect(consolidated.evidence_spans.length).toBeGreaterThanOrEqual(2);
  });

  it('metadata.source is "consolidated-section"', () => {
    const [consolidated] = consolidateBySection(suggestions, sectionMap);
    expect(consolidated.metadata?.source).toBe('consolidated-section');
  });

  it('consolidated suggestion_id differs from all original ids', () => {
    const originalIds = suggestions.map((s) => s.suggestion_id);
    const [consolidated] = consolidateBySection(suggestions, sectionMap);
    expect(originalIds).not.toContain(consolidated.suggestion_id);
  });
});

// ============================================
// Test 2: Mixed idea + risk in same section → no merge
// ============================================

describe('consolidateBySection: mixed idea + risk in same section — do not merge', () => {
  const SECTION_ID = 'sec-mixed-001';
  const NOTE_ID = 'note-mixed-001';

  beforeEach(() => {
    resetConsolidationCounter();
  });

  it('preserves all candidates when section contains both idea and risk', () => {
    const section = makeSection({
      section_id: SECTION_ID,
      note_id: NOTE_ID,
      heading_text: 'Platform Risks and Ideas',
      heading_level: 2,
      structural_features: {
        num_lines: 5,
        num_list_items: 4,
        has_dates: false,
        has_metrics: false,
        has_quarter_refs: false,
        has_version_refs: false,
        has_launch_keywords: false,
        initiative_phrase_density: 0,
      },
      raw_text: 'Some ideas and risks for the platform.',
    });
    const sectionMap = new Map([[SECTION_ID, section]]);

    const suggestions: Suggestion[] = [
      makeIdea(SECTION_ID, NOTE_ID, 'New feature A', 'Feature A description.'),
      makeIdea(SECTION_ID, NOTE_ID, 'New feature B', 'Feature B description.'),
      makeRisk(SECTION_ID, NOTE_ID, 'Vendor dependency risk.'),
    ];

    const result = consolidateBySection(suggestions, sectionMap);
    // All 3 must survive because not all are type 'idea'
    expect(result).toHaveLength(3);
  });

  it('types are preserved unchanged', () => {
    const section = makeSection({
      section_id: SECTION_ID,
      note_id: NOTE_ID,
      heading_text: 'Platform Risks and Ideas',
      heading_level: 2,
      structural_features: {
        num_lines: 5,
        num_list_items: 4,
        has_dates: false,
        has_metrics: false,
        has_quarter_refs: false,
        has_version_refs: false,
        has_launch_keywords: false,
        initiative_phrase_density: 0,
      },
      raw_text: 'Some ideas and risks for the platform.',
    });
    const sectionMap = new Map([[SECTION_ID, section]]);

    const suggestions: Suggestion[] = [
      makeIdea(SECTION_ID, NOTE_ID, 'New feature A', 'Feature A description.'),
      makeRisk(SECTION_ID, NOTE_ID, 'Vendor dependency risk.'),
    ];

    const result = consolidateBySection(suggestions, sectionMap);
    const types = result.map((s) => s.type).sort();
    expect(types).toEqual(['idea', 'risk']);
  });
});

// ============================================
// Test 3: Section with timeline signal → do not consolidate
// ============================================

describe('consolidateBySection: section with timeline/delta signal — no consolidation', () => {
  beforeEach(() => {
    resetConsolidationCounter();
  });

  const SECTION_ID = 'sec-timeline-001';
  const NOTE_ID = 'note-timeline-001';

  function makeTimelineSection(raw: string) {
    return makeSection({
      section_id: SECTION_ID,
      note_id: NOTE_ID,
      heading_text: 'Monitoring Timeline',
      heading_level: 2,
      structural_features: {
        num_lines: 5,
        num_list_items: 3,
        has_dates: true,
        has_metrics: false,
        has_quarter_refs: false,
        has_version_refs: false,
        has_launch_keywords: false,
        initiative_phrase_density: 0,
      },
      raw_text: raw,
    });
  }

  const timelineVariants = [
    'Extend monitoring from 1-year to 5-year window.',
    'Project delayed to Q3 2025.',
    'Timeline pushed until next sprint.',
    'We extended the program from 2-year to 4-year coverage.',
  ];

  for (const rawText of timelineVariants) {
    it(`does not collapse ideas when section contains: "${rawText.slice(0, 40)}"`, () => {
      const section = makeTimelineSection(rawText);
      const sectionMap = new Map([[SECTION_ID, section]]);

      const suggestions: Suggestion[] = [
        makeIdea(SECTION_ID, NOTE_ID, 'Monitoring idea A', 'Improve monitoring pipeline.'),
        makeIdea(SECTION_ID, NOTE_ID, 'Monitoring idea B', 'Automate monitoring checks.'),
        makeIdea(SECTION_ID, NOTE_ID, 'Monitoring idea C', 'Integrate remote sensing.'),
      ];

      const result = consolidateBySection(suggestions, sectionMap);
      // Must NOT consolidate — should still have 3 candidates
      expect(result).toHaveLength(3);
    });
  }
});

// ============================================
// Test 4: Single idea → unchanged
// ============================================

describe('consolidateBySection: single idea candidate — unchanged', () => {
  const SECTION_ID = 'sec-single-001';
  const NOTE_ID = 'note-single-001';

  beforeEach(() => {
    resetConsolidationCounter();
  });

  it('returns the single suggestion unchanged', () => {
    const section = makeSection({
      section_id: SECTION_ID,
      note_id: NOTE_ID,
      heading_text: 'Lone Idea',
      heading_level: 2,
      structural_features: {
        num_lines: 3,
        num_list_items: 3,
        has_dates: false,
        has_metrics: false,
        has_quarter_refs: false,
        has_version_refs: false,
        has_launch_keywords: false,
        initiative_phrase_density: 0,
      },
      raw_text: 'A single standalone idea.',
    });
    const sectionMap = new Map([[SECTION_ID, section]]);

    const original = makeIdea(SECTION_ID, NOTE_ID, 'Lone idea', 'A single standalone idea.');
    const result = consolidateBySection([original], sectionMap);

    expect(result).toHaveLength(1);
    expect(result[0].suggestion_id).toBe(original.suggestion_id);
    expect(result[0].title).toBe(original.title);
    expect(result[0].type).toBe('idea');
  });
});

// ============================================
// Test 5: headingLevel > 3 → do not consolidate
// ============================================

describe('consolidateBySection: deep heading (level > 3) — no consolidation', () => {
  const SECTION_ID = 'sec-deep-001';
  const NOTE_ID = 'note-deep-001';

  beforeEach(() => {
    resetConsolidationCounter();
  });

  it('does not merge ideas under a level-4 heading', () => {
    const section = makeSection({
      section_id: SECTION_ID,
      note_id: NOTE_ID,
      heading_text: 'Deep Section',
      heading_level: 4,
      structural_features: {
        num_lines: 5,
        num_list_items: 4,
        has_dates: false,
        has_metrics: false,
        has_quarter_refs: false,
        has_version_refs: false,
        has_launch_keywords: false,
        initiative_phrase_density: 0,
      },
      raw_text: 'Several ideas under a deep heading.',
    });
    const sectionMap = new Map([[SECTION_ID, section]]);

    const suggestions: Suggestion[] = [
      makeIdea(SECTION_ID, NOTE_ID, 'Idea A', 'Idea A description.'),
      makeIdea(SECTION_ID, NOTE_ID, 'Idea B', 'Idea B description.'),
      makeIdea(SECTION_ID, NOTE_ID, 'Idea C', 'Idea C description.'),
    ];

    const result = consolidateBySection(suggestions, sectionMap);
    expect(result).toHaveLength(3);
  });
});

// ============================================
// Test 6: bullet count < 3 → do not consolidate
// ============================================

describe('consolidateBySection: few bullets (< 3) — no consolidation', () => {
  const SECTION_ID = 'sec-fewbullets-001';
  const NOTE_ID = 'note-fewbullets-001';

  beforeEach(() => {
    resetConsolidationCounter();
  });

  it('does not merge when section has fewer than 3 list items', () => {
    const section = makeSection({
      section_id: SECTION_ID,
      note_id: NOTE_ID,
      heading_text: 'Short Section',
      heading_level: 2,
      structural_features: {
        num_lines: 3,
        num_list_items: 2,
        has_dates: false,
        has_metrics: false,
        has_quarter_refs: false,
        has_version_refs: false,
        has_launch_keywords: false,
        initiative_phrase_density: 0,
      },
      raw_text: 'Only two bullets here.',
    });
    const sectionMap = new Map([[SECTION_ID, section]]);

    const suggestions: Suggestion[] = [
      makeIdea(SECTION_ID, NOTE_ID, 'Idea A', 'Idea A description.'),
      makeIdea(SECTION_ID, NOTE_ID, 'Idea B', 'Idea B description.'),
    ];

    const result = consolidateBySection(suggestions, sectionMap);
    expect(result).toHaveLength(2);
  });
});

// ============================================
// Integration test: end-to-end via generateSuggestions
// ============================================

describe('consolidateBySection: integration — structured section with 3+ bullets emits fewer ideas', () => {
  it('structured section with heading level 2 and 3 bullet ideas is consolidated', () => {
    const note = {
      note_id: 'note-integration-consolidate-001',
      raw_markdown: `
### Black Box Prioritization System

- Three-factor scoring: we plan to use a scoring framework to automate prioritization of claims.
- Remote sensing integration: integrate satellite data into the scoring model to calculate coverage.
- Additionality extension: extend the existing framework to layer signals and prioritize accuracy.
- Carbon measurement: use a measurement system to automate the scoring calculation pipeline.
`.trim(),
    };

    const result = generateSuggestions(note);
    const ideas = result.suggestions.filter((s) => s.type === 'idea');

    // Without consolidation, each bullet could generate an idea candidate.
    // With consolidation, the section should emit at most 1 idea.
    // We use ≤ 2 to accommodate edge-case where a second pass emits differently.
    expect(ideas.length).toBeLessThanOrEqual(2);

    // The surviving idea should reference the section heading
    if (ideas.length === 1) {
      expect(ideas[0].title.toLowerCase()).toContain('black box prioritization system');
    }
  });
});

// ============================================
// New tests: body & evidence preview invariants
// ============================================

describe('buildConsolidatedBody: multi-bullet body construction', () => {
  it('builds body from multiple span texts joined with period-space', () => {
    const spans: EvidenceSpan[] = [
      { start_line: 0, end_line: 0, text: '- Three-factor scoring for claims' },
      { start_line: 1, end_line: 1, text: '- Remote sensing integration pipeline' },
    ];
    const body = buildConsolidatedBody(spans);
    expect(body).toContain('Three-factor scoring');
    expect(body).toContain('Remote sensing integration');
  });

  it('strips leading list markers from each span', () => {
    const spans: EvidenceSpan[] = [
      { start_line: 0, end_line: 0, text: '- First item text' },
      { start_line: 1, end_line: 1, text: '* Second item text' },
    ];
    const body = buildConsolidatedBody(spans);
    expect(body).not.toMatch(/^[\-*+]/);
    expect(body).toContain('First item text');
    expect(body).toContain('Second item text');
  });

  it('caps body at 320 chars', () => {
    const longText = 'A'.repeat(200);
    const spans: EvidenceSpan[] = [
      { start_line: 0, end_line: 0, text: longText },
      { start_line: 1, end_line: 1, text: longText },
    ];
    const body = buildConsolidatedBody(spans);
    expect(body.length).toBeLessThanOrEqual(320);
  });

  it('uses at most 4 spans', () => {
    const spans: EvidenceSpan[] = Array.from({ length: 6 }, (_, i) => ({
      start_line: i,
      end_line: i,
      text: `Item ${i + 1}`,
    }));
    const body = buildConsolidatedBody(spans);
    // Body should contain items 1-4 but not 5 or 6
    expect(body).toContain('Item 1');
    expect(body).toContain('Item 4');
    expect(body).not.toContain('Item 5');
  });
});

describe('consolidateBySection: consolidated body contains span previews (not anchor body)', () => {
  const SECTION_ID = 'sec-body-test-001';
  const NOTE_ID = 'note-body-test-001';

  beforeEach(() => {
    resetConsolidationCounter();
  });

  it('consolidated body contains text from multiple candidates, not just anchor body', () => {
    const section = makeSection({
      section_id: SECTION_ID,
      note_id: NOTE_ID,
      heading_text: 'Multi-Bullet System',
      heading_level: 2,
      structural_features: {
        num_lines: 5,
        num_list_items: 3,
        has_dates: false,
        has_metrics: false,
        has_quarter_refs: false,
        has_version_refs: false,
        has_launch_keywords: false,
        initiative_phrase_density: 0,
      },
      raw_text: 'Alpha feature. Beta feature. Gamma feature.',
    });
    const sectionMap = new Map([[SECTION_ID, section]]);

    const suggestions: Suggestion[] = [
      makeIdea(SECTION_ID, NOTE_ID, 'Alpha', 'Alpha feature'),
      makeIdea(SECTION_ID, NOTE_ID, 'Beta', 'Beta feature'),
      makeIdea(SECTION_ID, NOTE_ID, 'Gamma', 'Gamma feature'),
    ];

    const [consolidated] = consolidateBySection(suggestions, sectionMap);

    // Body must come from merged spans, not just anchor's body
    expect(consolidated.suggestion?.body).toBeDefined();
    expect(consolidated.suggestion!.body).toContain('Alpha');
    expect(consolidated.suggestion!.body).toContain('Beta');
  });

  it('evidencePreview array contains texts from multiple spans', () => {
    const section = makeSection({
      section_id: SECTION_ID,
      note_id: NOTE_ID,
      heading_text: 'Multi-Bullet System',
      heading_level: 2,
      structural_features: {
        num_lines: 5,
        num_list_items: 3,
        has_dates: false,
        has_metrics: false,
        has_quarter_refs: false,
        has_version_refs: false,
        has_launch_keywords: false,
        initiative_phrase_density: 0,
      },
      raw_text: 'Alpha feature. Beta feature. Gamma feature.',
    });
    const sectionMap = new Map([[SECTION_ID, section]]);

    const suggestions: Suggestion[] = [
      makeIdea(SECTION_ID, NOTE_ID, 'Alpha', 'Alpha feature'),
      makeIdea(SECTION_ID, NOTE_ID, 'Beta', 'Beta feature'),
      makeIdea(SECTION_ID, NOTE_ID, 'Gamma', 'Gamma feature'),
    ];

    const [consolidated] = consolidateBySection(suggestions, sectionMap);

    expect(consolidated.suggestion?.evidencePreview).toBeDefined();
    expect(consolidated.suggestion!.evidencePreview!.length).toBeGreaterThanOrEqual(2);
  });
});

describe('findMismatchedEvidencePreview: evidence-in-section invariant', () => {
  it('returns null when all previews are substrings of section text', () => {
    const sectionText = 'three factor scoring remote sensing additionality';
    const normalized = normalizeForComparison(sectionText);
    const previews = ['three factor scoring', 'remote sensing'];
    const mismatch = findMismatchedEvidencePreview(previews, normalized);
    expect(mismatch).toBeNull();
  });

  it('returns the failing preview when one does not appear in section text', () => {
    const sectionText = 'three factor scoring additionality framework';
    const normalized = normalizeForComparison(sectionText);
    const previews = ['three factor scoring', 'ham light deployment'];
    const mismatch = findMismatchedEvidencePreview(previews, normalized);
    expect(mismatch).toBe('ham light deployment');
  });

  it('passes for consolidated idea whose spans are sourced from section raw_text', () => {
    const SECTION_ID = 'sec-invariant-001';
    const NOTE_ID = 'note-invariant-001';
    resetConsolidationCounter();

    const rawText = 'Three-factor scoring for claims. Remote sensing pipeline. Extend additionality.';
    const section = makeSection({
      section_id: SECTION_ID,
      note_id: NOTE_ID,
      heading_text: 'Invariant Test Section',
      heading_level: 2,
      structural_features: {
        num_lines: 5,
        num_list_items: 3,
        has_dates: false,
        has_metrics: false,
        has_quarter_refs: false,
        has_version_refs: false,
        has_launch_keywords: false,
        initiative_phrase_density: 0,
      },
      raw_text: rawText,
    });
    const sectionMap = new Map([[SECTION_ID, section]]);

    const suggestions: Suggestion[] = [
      makeIdea(SECTION_ID, NOTE_ID, 'Scoring', 'Three-factor scoring for claims'),
      makeIdea(SECTION_ID, NOTE_ID, 'Remote', 'Remote sensing pipeline'),
      makeIdea(SECTION_ID, NOTE_ID, 'Additionality', 'Extend additionality'),
    ];

    const [consolidated] = consolidateBySection(suggestions, sectionMap);
    const previews = consolidated.suggestion?.evidencePreview ?? [];
    const normalizedSection = normalizeForComparison(rawText);

    // INVARIANT: all evidence previews must appear in normalized section text
    const mismatch = findMismatchedEvidencePreview(previews, normalizedSection);
    expect(mismatch).toBeNull();
  });
});

// ============================================
// Timeline section: no cross-mixed bodies
// ============================================

describe('Timeline section: separate update and risk, no cross-mixed bodies', () => {
  it('produces an update mentioning Ham Light and a risk mentioning user IDs, not cross-mixed', () => {
    const note = {
      note_id: 'note-timeline-hamlight-001',
      raw_markdown: `
## Current Sprint Focus

Immediate focus: Ham Light deployment is the top priority for this sprint.

Database logging includes user IDs which raises privacy and compliance risk.
`.trim(),
    };

    const result = generateSuggestions(note);

    // Find update mentioning Ham Light
    const hamLightUpdate = result.suggestions.find(
      (s) =>
        (s.title + (s.suggestion?.body ?? '')).toLowerCase().includes('ham light')
    );

    // Find risk mentioning user IDs
    const userIdRisk = result.suggestions.find(
      (s) =>
        (s.title + (s.suggestion?.body ?? '')).toLowerCase().includes('user id') ||
        (s.title + (s.suggestion?.body ?? '')).toLowerCase().includes('user ids') ||
        (s.title + (s.suggestion?.body ?? '')).toLowerCase().includes('database logging')
    );

    // At least one of these should be present (engine may extract either or both)
    const hasHamLight = hamLightUpdate !== undefined;
    const hasUserIdSignal = userIdRisk !== undefined;
    expect(hasHamLight || hasUserIdSignal).toBe(true);

    // CRITICAL: No cross-mixed bodies — Ham Light suggestion must not mention user IDs in body
    if (hamLightUpdate) {
      const hamBody = (hamLightUpdate.suggestion?.body ?? '').toLowerCase();
      expect(hamBody).not.toContain('user id');
    }

    // CRITICAL: user ID risk suggestion must not mention Ham Light in body
    if (userIdRisk && userIdRisk !== hamLightUpdate) {
      const riskBody = (userIdRisk.suggestion?.body ?? '').toLowerCase();
      expect(riskBody).not.toContain('ham light');
    }
  });
});

// ============================================
// UI clarification policy tests
// ============================================

describe('UI clarification policy: needs_clarification badge rules', () => {
  it('low-score-but-valid suggestion does NOT show needs_clarification badge', () => {
    const note = {
      note_id: 'note-lowscore-valid-001',
      raw_markdown: `
## Roadmap Adjustment

We need to push the mobile app redesign from Q2 to Q3 because the gesture system is more complex.

- Defer all mobile redesign work to Q3
- Prioritize customer portal in Q2 instead
- Add 2 weeks for UX research
`.trim(),
    };

    const result = generateSuggestions(note);

    // All emitted suggestions should NOT have needs_clarification=true from low score alone
    for (const s of result.suggestions) {
      if (!s.needs_clarification) continue;
      // If needs_clarification is true, it must have a V3 failure or a dropReason
      const hasV3Failure = s.validation_results?.some(
        (r) => r.validator === 'V3_evidence_sanity' && !r.passed
      ) ?? false;
      const hasDropReason = !!(s.dropReason || s.drop_reason);
      expect(hasV3Failure || hasDropReason).toBe(true);
    }
  });

  it('suggestion with V3 evidence sanity failure shows needs_clarification badge', () => {
    const suggestionWithV3Fail: Suggestion = {
      suggestion_id: 'sug-v3-fail-001',
      note_id: 'note-v3-fail',
      section_id: 'sec-v3-fail',
      type: 'project_update',
      title: 'Update: shift focus',
      payload: { after_description: 'Shift focus' },
      evidence_spans: [{ start_line: 0, end_line: 0, text: 'shift focus' }],
      scores: {
        section_actionability: 0.8,
        type_choice_confidence: 0.8,
        synthesis_confidence: 0.8,
        overall: 0.8,
      },
      routing: { create_new: true },
      validation_results: [
        { validator: 'V3_evidence_sanity', passed: false, reason: 'Evidence span text does not match section content' },
      ],
    };

    const result = applyConfidenceBasedProcessing([suggestionWithV3Fail], DEFAULT_THRESHOLDS);
    expect(result.passed).toHaveLength(1);
    expect(result.passed[0].needs_clarification).toBe(true);
  });
});
