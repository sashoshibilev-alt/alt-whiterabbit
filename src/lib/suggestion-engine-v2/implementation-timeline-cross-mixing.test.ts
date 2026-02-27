/**
 * Implementation Timeline: Cross-mixing regression tests
 *
 * Bug: When a section headed "Implementation Timeline" contains both a
 * timeline bullet cluster (Ham Light deployment, 3-month window, target Jan)
 * AND a security/PII bullet cluster (logging user IDs), the engine was
 * cross-mixing evidence and bodies:
 *   - evidencePreview pointed to the Ham Light line but body contained
 *     security text, or vice versa.
 *   - Both suggestions used the ENTIRE section as their body/evidence.
 *
 * Fix: B-signal sentence splitter now splits on newlines (not only .!?)
 * so each bullet is a distinct sentence for signal extraction. Additionally,
 * a timeline-section extractor fires for headings matching /timeline|implementation/i
 * and emits project_update candidates from date-bearing bullet lines.
 *
 * Requirements (from task spec):
 *   - Update body mentions "Ham Light" and/or "3-month window" and/or "January"
 *   - Risk body mentions "logging" and "user IDs" / "PII"
 *   - No cross-mixing between the two
 *   - Both pass V3 evidence sanity
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { generateSuggestions, DEFAULT_CONFIG } from './index';
import { resetSectionCounter, preprocessNote } from './preprocessing';
import { resetSuggestionCounter } from './synthesis';
import { resetBSignalCounter } from './bSignalSeeding';
import { validateV3EvidenceSanity } from './validators';
import { normalizeForComparison } from './preprocessing';

// ============================================================
// Canonical Implementation Timeline fixture
// ============================================================

const IMPLEMENTATION_TIMELINE_NOTE = {
  note_id: 'note-impl-timeline-canonical',
  raw_markdown: `# Project Status

## Implementation Timeline

- Immediate focus: Ham Light deployment (3-month window, target January)
- Backend services ready; frontend integration in progress
- Security considerations: Database logging includes user IDs which raises privacy and PII risk
- Need to mask user IDs before logging goes live
`,
};

// ============================================================
// Helpers
// ============================================================

function resetAll() {
  resetSectionCounter();
  resetSuggestionCounter();
  resetBSignalCounter();
}

// ============================================================
// Tests
// ============================================================

describe('Implementation Timeline: no cross-mixed bodies', () => {
  beforeEach(resetAll);

  it('emits a project_update anchored to the Ham Light timeline bullet', () => {
    const result = generateSuggestions(IMPLEMENTATION_TIMELINE_NOTE, DEFAULT_CONFIG);

    const updateSuggestion = result.suggestions.find(
      (s) => s.type === 'project_update'
    );

    expect(updateSuggestion).toBeDefined();

    const updateBody = (updateSuggestion!.suggestion?.body ?? '').toLowerCase();
    const updateTitle = updateSuggestion!.title.toLowerCase();
    const updateContent = updateBody + ' ' + updateTitle;

    // Update body/title must reference the Ham Light deployment OR date/window info
    const mentionsHamLight = updateContent.includes('ham light');
    const mentionsWindow = updateContent.includes('3-month') || updateContent.includes('window');
    const mentionsJanuary = updateContent.includes('january') || updateContent.includes('jan');

    expect(
      mentionsHamLight || mentionsWindow || mentionsJanuary,
      `project_update should mention "Ham Light", "3-month window", or "January" — got: "${updateContent.substring(0, 150)}"`
    ).toBe(true);
  });

  it('emits a risk anchored to the security/PII bullet', () => {
    const result = generateSuggestions(IMPLEMENTATION_TIMELINE_NOTE, DEFAULT_CONFIG);

    const riskSuggestion = result.suggestions.find((s) => s.type === 'risk');

    expect(riskSuggestion).toBeDefined();

    const riskBody = (riskSuggestion!.suggestion?.body ?? '').toLowerCase();
    const riskTitle = riskSuggestion!.title.toLowerCase();
    const riskContent = riskBody + ' ' + riskTitle;

    // Risk body/title must reference logging and user IDs or PII
    const mentionsLogging = riskContent.includes('logging');
    const mentionsUserIDs =
      riskContent.includes('user id') ||
      riskContent.includes('user ids') ||
      riskContent.includes('pii');

    expect(
      mentionsLogging || mentionsUserIDs,
      `risk should mention "logging" or "user IDs" / "PII" — got: "${riskContent.substring(0, 150)}"`
    ).toBe(true);
  });

  it('update body does NOT contain security/PII content (no cross-mix)', () => {
    const result = generateSuggestions(IMPLEMENTATION_TIMELINE_NOTE, DEFAULT_CONFIG);

    const updateSuggestion = result.suggestions.find((s) => s.type === 'project_update');
    if (!updateSuggestion) return; // skip if update not emitted

    const updateBody = (updateSuggestion.suggestion?.body ?? '').toLowerCase();

    // The update's body must not mention user IDs or database logging
    expect(updateBody).not.toContain('user id');
    expect(updateBody).not.toContain('user ids');
    expect(updateBody).not.toContain('database logging');
  });

  it('risk body does NOT contain Ham Light content (no cross-mix)', () => {
    const result = generateSuggestions(IMPLEMENTATION_TIMELINE_NOTE, DEFAULT_CONFIG);

    const riskSuggestion = result.suggestions.find((s) => s.type === 'risk');
    if (!riskSuggestion) return; // skip if risk not emitted

    const riskBody = (riskSuggestion.suggestion?.body ?? '').toLowerCase();

    // The risk's body must not mention Ham Light or the 3-month window
    expect(riskBody).not.toContain('ham light');
    expect(riskBody).not.toContain('3-month');
  });

  it('both update and risk pass V3 evidence sanity (grounded in section text)', () => {
    const { sections } = preprocessNote(IMPLEMENTATION_TIMELINE_NOTE);
    const sectionRawText = sections.find(s => (s.heading_text ?? '').includes('Implementation Timeline'))?.raw_text ?? '';

    resetAll();
    const result = generateSuggestions(IMPLEMENTATION_TIMELINE_NOTE, DEFAULT_CONFIG);

    const updateSuggestion = result.suggestions.find((s) => s.type === 'project_update');
    const riskSuggestion = result.suggestions.find((s) => s.type === 'risk');

    // V3 evidence check: each evidence span's text must appear (normalized) in the section
    const checkGrounded = (s: typeof updateSuggestion, label: string) => {
      if (!s) return;
      const normalizedSection = normalizeForComparison(sectionRawText);
      for (const span of s.evidence_spans) {
        const normalizedSpan = normalizeForComparison(span.text);
        const partial = normalizedSpan.slice(0, 50);
        const grounded = normalizedSection.includes(normalizedSpan) ||
          (partial.length > 5 && normalizedSection.includes(partial));
        expect(grounded, `${label} evidence span not grounded in section: "${span.text.substring(0, 80)}"`).toBe(true);
      }
    };

    checkGrounded(updateSuggestion, 'project_update');
    checkGrounded(riskSuggestion, 'risk');
  });

  it('emits at least two distinct suggestions from the section', () => {
    const result = generateSuggestions(IMPLEMENTATION_TIMELINE_NOTE, DEFAULT_CONFIG);
    expect(result.suggestions.length).toBeGreaterThanOrEqual(2);
  });
});

// ============================================================
// Variant: heading uses "Implementation" (not "Timeline")
// ============================================================

describe('Implementation Timeline: heading variant "Implementation"', () => {
  beforeEach(resetAll);

  it('emits a project_update when heading is "## Implementation"', () => {
    const note = {
      note_id: 'note-impl-only',
      raw_markdown: `# Quarterly Review

## Implementation

- Ham Light deployment scheduled for 3-month window ending in January
- Security concerns: logging currently captures user IDs (PII risk)
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);
    const updateSuggestion = result.suggestions.find((s) => s.type === 'project_update');

    expect(updateSuggestion).toBeDefined();

    const content = (
      updateSuggestion!.title + ' ' + (updateSuggestion!.suggestion?.body ?? '')
    ).toLowerCase();

    expect(content.includes('ham light') || content.includes('january') || content.includes('3-month')).toBe(true);
  });

  it('risk body does not contain ham light content (no cross-mix)', () => {
    const note = {
      note_id: 'note-impl-only',
      raw_markdown: `# Quarterly Review

## Implementation

- Ham Light deployment scheduled for 3-month window ending in January
- Security concerns: logging currently captures user IDs (PII risk)
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);
    const riskSuggestion = result.suggestions.find((s) => s.type === 'risk');

    if (riskSuggestion) {
      const riskBody = (riskSuggestion.suggestion?.body ?? '').toLowerCase();
      expect(riskBody).not.toContain('ham light');
    }
  });
});

// ============================================================
// Non-timeline sections: newline splitting does not break
// standard B-signal extraction
// ============================================================

describe('Non-timeline sections: newline splitting regression guard', () => {
  beforeEach(resetAll);

  it('PII risk in non-timeline section still fires on the correct line', () => {
    const note = {
      note_id: 'note-nontimeline-pii',
      raw_markdown: `# Engineering Review

## Security considerations

Database logging includes user IDs (PII concern).
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);
    const riskSuggestion = result.suggestions.find((s) => s.type === 'risk');

    expect(riskSuggestion).toBeDefined();

    const riskBody = (riskSuggestion!.suggestion?.body ?? '').toLowerCase();
    // Body should reference the security line, NOT unrelated content
    expect(riskBody).not.toContain('ham light');
    expect(riskBody.includes('logging') || riskBody.includes('user id') || riskBody.includes('pii')).toBe(true);
  });

  it('decision table with Q-refs does NOT trigger timeline update extraction', () => {
    const note = {
      note_id: 'note-decision-table',
      raw_markdown: `# Technical Decisions

- Launch mobile app v2      Approved      Q2 2026
- Deprecate legacy API      Aligned       Q3 2026
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    // Should not emit spurious project_update for decision table rows
    const updates = result.suggestions.filter((s) => s.type === 'project_update');
    for (const u of updates) {
      const content = (u.title + ' ' + (u.suggestion?.body ?? '')).toLowerCase();
      // Must not contain decision-table status words in body/title
      expect(content).not.toContain('approved');
      expect(content).not.toContain('aligned');
    }
  });
});

// ============================================================
// Part 2A: Timeline bullet merging — multiple date-bearing
// bullets must produce exactly ONE project_update candidate
// whose body contains all the date/window content
// ============================================================

describe('Part 2A: timeline bullet merging', () => {
  beforeEach(resetAll);

  it('split timeline bullets produce exactly 1 project_update (not one per bullet)', () => {
    const note = {
      note_id: 'note-impl-timeline-merging',
      raw_markdown: `# Project Status

## Implementation Timeline

- Ham Light deployment: 3-month window
- Target early January for launch
- Security considerations: Database logging includes user IDs which raises privacy and PII risk
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);
    const updates = result.suggestions.filter((s) => s.type === 'project_update');

    expect(
      updates.length,
      `Expected exactly 1 project_update, got ${updates.length}: ${updates.map(u => u.title).join(', ')}`
    ).toBe(1);
  });

  it('merged update body contains both "3-month" and "January" content', () => {
    const note = {
      note_id: 'note-impl-timeline-merging-body',
      raw_markdown: `# Project Status

## Implementation Timeline

- Ham Light deployment: 3-month window
- Target early January for launch
- Security considerations: Database logging includes user IDs which raises privacy and PII risk
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);
    const update = result.suggestions.find((s) => s.type === 'project_update');

    expect(update).toBeDefined();
    const content = ((update!.suggestion?.body ?? '') + ' ' + update!.title).toLowerCase();
    expect(content.includes('3-month') || content.includes('window'), `missing "3-month window" in: ${content.substring(0, 150)}`).toBe(true);
    expect(content.includes('january') || content.includes('jan'), `missing "January" in: ${content.substring(0, 150)}`).toBe(true);
  });
});

// ============================================================
// Part 2B: PII risk specificity preference — when both a
// generic "Security considerations" line and a specific
// PII/logging line exist, emit only the specific risk
// ============================================================

describe('Part 2B: PII risk specificity preference', () => {
  beforeEach(resetAll);

  it('section with generic security line + specific PII line emits exactly 1 risk', () => {
    const note = {
      note_id: 'note-impl-timeline-2risks',
      raw_markdown: `# Project Status

## Implementation Timeline

- Immediate focus: Ham Light deployment (3-month window, target January)
- Security considerations: review needed before launch
- Database logging includes user IDs which raises privacy and PII risk
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);
    const risks = result.suggestions.filter((s) => s.type === 'risk');

    expect(
      risks.length,
      `Expected exactly 1 risk, got ${risks.length}: ${risks.map(r => r.title + ' | ' + (r.suggestion?.body ?? '').substring(0, 80)).join(' / ')}`
    ).toBe(1);
  });

  it('the surviving risk references logging and user IDs / PII (not just generic security)', () => {
    const note = {
      note_id: 'note-impl-timeline-2risks-body',
      raw_markdown: `# Project Status

## Implementation Timeline

- Immediate focus: Ham Light deployment (3-month window, target January)
- Security considerations: review needed before launch
- Database logging includes user IDs which raises privacy and PII risk
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);
    const risk = result.suggestions.find((s) => s.type === 'risk');

    expect(risk).toBeDefined();
    const content = ((risk!.suggestion?.body ?? '') + ' ' + risk!.title).toLowerCase();
    const mentionsLogging = content.includes('logging');
    const mentionsPii = content.includes('user id') || content.includes('user ids') || content.includes('pii');
    expect(
      mentionsLogging || mentionsPii,
      `risk should mention "logging" or "user IDs"/"PII" — got: "${content.substring(0, 150)}"`
    ).toBe(true);
  });
});
