/**
 * Regression test A: golden_dense_paragraph_cloudscale
 *
 * INVARIANT: Once dense-paragraph candidate extraction is implemented, the
 * engine must emit at minimum:
 *   1. A RISK suggestion grounded in the GDPR / "dead in the water" sentence.
 *   2. A PROJECT_UPDATE suggestion grounded in the "4-week delay" sentence.
 *
 * CURRENT STATE: This test is skipped (it.skip) because the dense-paragraph
 * extraction logic has not yet been added to the engine.  When the feature is
 * implemented, remove the `.skip` suffixes to flip the tests to active.
 *
 * Do NOT change engine thresholds, classifiers, or validators to make these
 * pass prematurely.  The skip is intentional: it documents the *expected
 * future behaviour* so the contract is visible in code review.
 *
 * See cloudscale-regression-helpers.ts for the shared input fixture and the
 * full explanation of why these three tests exist.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { generateSuggestions, DEFAULT_CONFIG } from './index';
import { resetSectionCounter } from './preprocessing';
import { resetSuggestionCounter } from './synthesis';
import { CLOUDSCALE_NOTE } from './cloudscale-regression-helpers';

describe('Golden dense-paragraph: CloudScale note', () => {
  beforeEach(() => {
    resetSectionCounter();
    resetSuggestionCounter();
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
  // A3 – Smoke test (active now): engine does not crash on a dense paragraph
  //
  // This non-skipped assertion runs today and ensures the engine handles the
  // CloudScale note without throwing.  It also verifies that any suggestions
  // that ARE emitted right now satisfy the grounding invariant, so we don't
  // silently introduce hallucinations before the feature lands.
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
});
