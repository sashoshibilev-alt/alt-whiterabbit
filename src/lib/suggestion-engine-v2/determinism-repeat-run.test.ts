/**
 * Regression test B: determinism_repeat_run
 *
 * INVARIANT: Running the engine N times on the same note + config must produce
 * structurally identical output every time (after normalization).
 *
 * WHY THIS MATTERS
 * ================
 * Non-determinism causes flickering in the UI (suggestions appear/disappear on
 * refresh), makes evals unreliable, and masks regressions in scoring.  Any
 * source of randomness—Math.random(), Date.now(), Map iteration order,
 * async scheduling—must either be absent from the synchronous pipeline or be
 * seeded to a fixed value before each run.
 *
 * NORMALIZATION CONTRACT
 * ======================
 * We compare the *normalized* form (see cloudscale-regression-helpers.ts):
 *   { type, title, evidenceTexts[], overallScore }
 * sorted by (type asc, overallScore desc, title asc).
 * Ignored: suggestion_id, note_id, section_id, routing (initiative IDs may
 * differ across environments), createdAt / timestamps.
 *
 * See cloudscale-regression-helpers.ts for the shared input fixture and the
 * full explanation of why these three tests exist.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { generateSuggestions, DEFAULT_CONFIG } from './index';
import { resetSectionCounter } from './preprocessing';
import { resetSuggestionCounter } from './synthesis';
import {
  CLOUDSCALE_NOTE,
  normalizeSuggestions,
} from './cloudscale-regression-helpers';

/** Number of repeat runs. 30 is high enough to expose most sources of
 *  non-determinism (Map/Set ordering, unstable sorts) without being slow. */
const REPEAT_RUNS = 30;

describe('Determinism: repeat runs on CloudScale note', () => {
  // Reset counters before the whole suite, not before each run, so that
  // section/suggestion IDs increment across runs—this is realistic and ensures
  // the normalization correctly strips those non-stable fields.
  beforeEach(() => {
    resetSectionCounter();
    resetSuggestionCounter();
  });

  it(`should produce identical normalized output across ${REPEAT_RUNS} consecutive runs`, () => {
    // Collect normalized output from every run.
    const runs: ReturnType<typeof normalizeSuggestions>[] = [];

    for (let i = 0; i < REPEAT_RUNS; i++) {
      const result = generateSuggestions(CLOUDSCALE_NOTE, undefined, DEFAULT_CONFIG);
      runs.push(normalizeSuggestions(result.suggestions));
    }

    // Every run must deep-equal the first run.
    const baseline = runs[0];
    for (let i = 1; i < runs.length; i++) {
      expect(runs[i]).toEqual(baseline);
    }
  });

  it('should produce identical suggestion count across all runs', () => {
    const counts: number[] = [];

    for (let i = 0; i < REPEAT_RUNS; i++) {
      const result = generateSuggestions(CLOUDSCALE_NOTE, undefined, DEFAULT_CONFIG);
      counts.push(result.suggestions.length);
    }

    const baseline = counts[0];
    for (let i = 1; i < counts.length; i++) {
      expect(counts[i]).toBe(baseline);
    }
  });

  it('should produce identical suggestion types (sorted) across all runs', () => {
    const typeArrays: string[][] = [];

    for (let i = 0; i < REPEAT_RUNS; i++) {
      const result = generateSuggestions(CLOUDSCALE_NOTE, undefined, DEFAULT_CONFIG);
      typeArrays.push(result.suggestions.map((s) => s.type).sort());
    }

    const baseline = typeArrays[0];
    for (let i = 1; i < typeArrays.length; i++) {
      expect(typeArrays[i]).toEqual(baseline);
    }
  });
});
