/**
 * Shared fixtures and utilities for the CloudScale regression harness.
 *
 * WHY THESE TESTS EXIST
 * =====================
 * The three regression tests below protect three independent invariants:
 *
 *  A) golden_dense_paragraph_cloudscale
 *     - Protects the *content correctness* invariant: once dense-paragraph
 *       extraction is implemented, the engine must surface the two most
 *       business-critical facts from the CloudScale note—the GDPR/partnership
 *       risk and the 4-week schedule delay—without hallucinating evidence.
 *     - Until the feature is implemented the test is marked `it.skip` so it
 *       lives in source and can be enabled by removing the `.skip`.
 *
 *  B) determinism_repeat_run
 *     - Protects the *stability* invariant: given the same note and config the
 *       engine must produce bit-identical (after normalization) output on every
 *       run.  Non-determinism leads to flickering UI and unreliable evals.
 *
 *  C) grounding_spans_exist
 *     - Protects the *grounding* invariant: every evidence span emitted by the
 *       engine must reference text that actually appears in the source note.
 *       Hallucinated evidence breaks user trust and downstream LLM prompts.
 *
 * NORMALIZATION CONTRACT (used by A and B)
 * ========================================
 * Sort by (type asc, scores.overall desc, suggestion_id asc), then compare
 * type + title + evidence_spans[*].text.  Ignore suggestion_id, note_id,
 * section_id, routing, and timestamp-like fields which are legitimately
 * non-deterministic or session-scoped.
 */

import type { Suggestion, NoteInput } from './types';

// ---------------------------------------------------------------------------
// Shared input fixture
// ---------------------------------------------------------------------------

/**
 * Single-paragraph CloudScale meeting note.
 * This exact string is the canonical input for the regression suite; do NOT
 * modify it without updating all three tests.
 */
export const CLOUDSCALE_NOTE: NoteInput = {
  note_id: 'cloudscale-regression-fixture',
  raw_markdown:
    'Discussion centered on the integration with CloudScale\'s marketplace. They have specific requirements for data residency that we haven\'t mapped out yet. If we can\'t prove GDPR compliance for their German nodes, the partnership is dead in the water. Engineering is frustrated because the API docs CloudScale provided are "garbage." We\'re looking at a 4-week delay just to figure out the handshake protocol. Product wants to know if we can "fudge" the initial sync, but Engineering is digging their heels in on security. Pressure from the Board to get this live before the annual conference.',
};

// ---------------------------------------------------------------------------
// Normalization helpers
// ---------------------------------------------------------------------------

/** Fields that are stable across runs and meaningful for correctness. */
export interface NormalizedSuggestion {
  type: string;
  title: string;
  evidenceTexts: string[];
  overallScore: number;
}

/** Normalize a single suggestion to a stable, comparable shape. */
export function normalizeSuggestion(s: Suggestion): NormalizedSuggestion {
  return {
    type: s.type,
    title: s.title,
    evidenceTexts: s.evidence_spans.map((e) => e.text),
    overallScore: s.scores.overall,
  };
}

/**
 * Normalize and sort a suggestion array for deep-equality comparison.
 * Sort order: type asc → overallScore desc → title asc (tie-break).
 */
export function normalizeSuggestions(suggestions: Suggestion[]): NormalizedSuggestion[] {
  return suggestions
    .map(normalizeSuggestion)
    .sort((a, b) => {
      if (a.type !== b.type) return a.type < b.type ? -1 : 1;
      if (b.overallScore !== a.overallScore) return b.overallScore - a.overallScore;
      return a.title < b.title ? -1 : a.title > b.title ? 1 : 0;
    });
}
