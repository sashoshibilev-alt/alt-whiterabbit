/**
 * Regression test A: golden_dense_paragraph_cloudscale
 *
 * INVARIANT: The engine must emit at minimum:
 *   1. A RISK suggestion grounded in the GDPR / "dead in the water" sentence.
 *   2. A PROJECT_UPDATE suggestion grounded in the "4-week delay" sentence.
 *   3. It must NOT emit a generic section-root project_update whose evidence
 *      spans the entire section body (e.g. "Update: Discussion They").  When
 *      dense-paragraph fallback emits ≥1 sentence candidate for a section, the
 *      section-root synthesis candidate is suppressed (Stage 4.1).
 *
 * See cloudscale-regression-helpers.ts for the shared input fixture and the
 * full explanation of why these tests exist.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { generateSuggestions, DEFAULT_CONFIG } from './index';
import { resetSectionCounter } from './preprocessing';
import { resetSuggestionCounter } from './synthesis';
import { resetDenseParagraphCounter } from './denseParagraphExtraction';
import { CLOUDSCALE_NOTE } from './cloudscale-regression-helpers';

describe('Golden dense-paragraph: CloudScale note', () => {
  beforeEach(() => {
    resetSectionCounter();
    resetSuggestionCounter();
    resetDenseParagraphCounter();
  });

  // -------------------------------------------------------------------------
  // A1 – RISK grounded in the GDPR / "dead in the water" sentence
  // -------------------------------------------------------------------------
  it(
    'should emit a RISK suggestion grounded in the GDPR partnership-risk sentence',
    () => {
      const result = generateSuggestions(CLOUDSCALE_NOTE, undefined, DEFAULT_CONFIG);

      const riskSuggestions = result.suggestions.filter((s) => s.type === 'risk');
      expect(riskSuggestions.length).toBeGreaterThanOrEqual(1);

      // At least one risk suggestion must reference the GDPR / dead-in-the-water text.
      const gdprRisk = riskSuggestions.find((s) => {
        const allText = [s.title, ...s.evidence_spans.map((e) => e.text)]
          .join(' ')
          .toLowerCase();
        return (
          allText.includes('gdpr') ||
          allText.includes('dead in the water') ||
          allText.includes('german nodes') ||
          allText.includes('compliance')
        );
      });

      expect(gdprRisk).toBeDefined();

      // Grounding check: the evidence must be a real substring of the source note.
      const noteText = CLOUDSCALE_NOTE.raw_markdown;
      for (const span of gdprRisk!.evidence_spans) {
        // Normalise whitespace before substring check (engine may normalise
        // newlines when embedding multi-line evidence into a single string).
        const normNote = noteText.replace(/\s+/g, ' ');
        const normSpan = span.text.replace(/\s+/g, ' ').trim();
        expect(normNote).toContain(normSpan);
      }
    }
  );

  // -------------------------------------------------------------------------
  // A2 – PROJECT_UPDATE grounded in the "4-week delay" sentence
  // -------------------------------------------------------------------------
  it(
    'should emit a PROJECT_UPDATE suggestion grounded in the 4-week delay sentence',
    () => {
      const result = generateSuggestions(CLOUDSCALE_NOTE, undefined, DEFAULT_CONFIG);

      const updateSuggestions = result.suggestions.filter(
        (s) => s.type === 'project_update'
      );
      expect(updateSuggestions.length).toBeGreaterThanOrEqual(1);

      // At least one project_update must reference the schedule delay.
      const delayUpdate = updateSuggestions.find((s) => {
        const allText = [s.title, ...s.evidence_spans.map((e) => e.text)]
          .join(' ')
          .toLowerCase();
        return (
          allText.includes('4-week') ||
          allText.includes('four-week') ||
          allText.includes('delay') ||
          allText.includes('handshake protocol')
        );
      });

      expect(delayUpdate).toBeDefined();

      // Grounding check: evidence must be a real substring of the source note.
      const noteText = CLOUDSCALE_NOTE.raw_markdown;
      for (const span of delayUpdate!.evidence_spans) {
        const normNote = noteText.replace(/\s+/g, ' ');
        const normSpan = span.text.replace(/\s+/g, ' ').trim();
        expect(normNote).toContain(normSpan);
      }
    }
  );

  // -------------------------------------------------------------------------
  // A3 – Smoke test: engine does not crash on a dense paragraph and all
  // emitted suggestions satisfy the grounding invariant.
  // -------------------------------------------------------------------------
  it('should not throw and any emitted suggestions must be grounded', () => {
    let result: ReturnType<typeof generateSuggestions>;
    expect(() => {
      result = generateSuggestions(CLOUDSCALE_NOTE, undefined, DEFAULT_CONFIG);
    }).not.toThrow();

    const noteText = CLOUDSCALE_NOTE.raw_markdown;
    const normNote = noteText.replace(/\s+/g, ' ');

    for (const suggestion of result!.suggestions) {
      for (const span of suggestion.evidence_spans) {
        if (span.text.trim().length === 0) continue; // skip empty spans
        const normSpan = span.text.replace(/\s+/g, ' ').trim();
        expect(normNote).toContain(normSpan);
      }
    }
  });

  // -------------------------------------------------------------------------
  // A4 – Section-root suppression: dense-paragraph sections must NOT emit a
  // generic section-root synthesis candidate alongside sentence candidates.
  //
  // Before Stage 4.1, the engine emitted "Update: Discussion They" — a
  // project_update whose evidence spanned the entire section body and had no
  // metadata.source (i.e. came from Stage 3 synthesis).  That candidate was
  // low-quality: it lost sentence-level grounding and duplicated the precise
  // sentence candidates from B-signal seeding / dense extraction.
  //
  // Stage 4.1 drops section-root synthesis candidates when isDenseParagraphSection
  // is true AND extractDenseParagraphCandidates returns ≥1 sentence candidate.
  // -------------------------------------------------------------------------
  it('must NOT emit a generic section-root project_update for the CloudScale dense paragraph', () => {
    const result = generateSuggestions(CLOUDSCALE_NOTE, undefined, DEFAULT_CONFIG);

    // A section-root synthesis candidate has no metadata.source.
    // The title "Update: Discussion They" was the specific regression; guard
    // more broadly against any section-spanning synthesis candidate here.
    const sectionRootCandidates = result.suggestions.filter((s) => {
      const meta = (s as { metadata?: { source?: string } }).metadata;
      return !meta?.source;
    });

    expect(sectionRootCandidates).toHaveLength(0);
  });
});
