/**
 * Regression test C: grounding_spans_exist
 *
 * INVARIANT: For every suggestion emitted by the engine, every non-empty
 * evidence span must reference text that actually appears verbatim (modulo
 * whitespace normalization) in the source note.  Hallucinated evidence—text
 * that was invented by the engine rather than extracted from the note—breaks
 * user trust and causes downstream LLM prompts to fabricate further content.
 *
 * HOW IT WORKS
 * ============
 * We test this against three distinct note shapes:
 *
 *  1. CloudScale dense paragraph (shared fixture) – the primary regression
 *     target once dense-paragraph extraction lands.
 *  2. A multi-section structured note – ensures the invariant holds for the
 *     common case where sections have headings and bullet lists.
 *  3. A note with heading-only sections and mixed content – tests edge cases
 *     in section splitting and evidence assembly.
 *
 * CHECKING STRATEGY
 * =================
 * For each EvidenceSpan { start_line, end_line, text }:
 *   a) text must be non-empty after trimming.
 *   b) After collapsing internal whitespace (newlines → spaces), the span text
 *      must appear as a substring of the note's raw_markdown with the same
 *      whitespace normalization applied.
 *
 * We do NOT check start_line / end_line exact values here because their
 * semantics are relative to the section body (not the full note) and that
 * mapping is an internal concern of the preprocessor.  The text content is the
 * authoritative grounding signal.
 *
 * See cloudscale-regression-helpers.ts for the shared input fixture and the
 * full explanation of why these three tests exist.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { generateSuggestions, DEFAULT_CONFIG } from './index';
import type { Suggestion, NoteInput } from './types';
import { resetSectionCounter } from './preprocessing';
import { resetSuggestionCounter } from './synthesis';
import { CLOUDSCALE_NOTE } from './cloudscale-regression-helpers';

// ---------------------------------------------------------------------------
// Helper: assert every evidence span in a suggestion list is grounded
// ---------------------------------------------------------------------------

/**
 * Returns the first grounding violation found, or null if all spans are
 * grounded.  A violation is a { suggestion, span } pair where span.text is not
 * a substring of noteText (after whitespace normalization).
 */
function findGroundingViolation(
  suggestions: Suggestion[],
  noteText: string
): { suggestion: Suggestion; spanText: string } | null {
  const normNote = noteText.replace(/\s+/g, ' ');

  for (const suggestion of suggestions) {
    for (const span of suggestion.evidence_spans) {
      const trimmed = span.text.trim();
      if (trimmed.length === 0) continue; // empty spans are ignored

      const normSpan = trimmed.replace(/\s+/g, ' ');
      if (!normNote.includes(normSpan)) {
        return { suggestion, spanText: trimmed };
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Additional note fixtures
// ---------------------------------------------------------------------------

const STRUCTURED_NOTE: NoteInput = {
  note_id: 'grounding-structured-fixture',
  raw_markdown: `# Q3 Planning Session

## API Integration Milestone

We need to finalize the REST API contract with the partner team before the end of July.
The current draft has three unresolved endpoints that block mobile development.

- Authentication handshake is missing refresh-token support
- Pagination contract is undefined for large result sets
- Rate-limiting headers are not documented

Engineering proposes freezing the spec by July 15 to unblock the mobile sprint.

## Budget Overrun

The infrastructure costs for staging are 40% over the budget.
Finance requires a revised estimate before the next board meeting.
We should request a line-item breakdown from DevOps by end of week.
`,
};

const MIXED_CONTENT_NOTE: NoteInput = {
  note_id: 'grounding-mixed-fixture',
  raw_markdown: `# Weekly Sync

Some teams are blocked waiting for the design review to complete.
The design team is three sprints behind schedule due to staffing gaps.
We may need to bring in a contractor to close the gap before the release.

## Action Items

Reach out to recruiting to open a contractor requisition by Friday.
Confirm with Legal that contractor NDA templates are up to date.
`,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Grounding: evidence spans exist in source note', () => {
  beforeEach(() => {
    resetSectionCounter();
    resetSuggestionCounter();
  });

  it('should emit only grounded evidence spans for the CloudScale dense paragraph', () => {
    const result = generateSuggestions(CLOUDSCALE_NOTE, undefined, DEFAULT_CONFIG);
    const violation = findGroundingViolation(
      result.suggestions,
      CLOUDSCALE_NOTE.raw_markdown
    );

    expect(violation).toBeNull();
  });

  it('should emit only grounded evidence spans for a structured multi-section note', () => {
    const result = generateSuggestions(STRUCTURED_NOTE, undefined, DEFAULT_CONFIG);
    const violation = findGroundingViolation(
      result.suggestions,
      STRUCTURED_NOTE.raw_markdown
    );

    expect(violation).toBeNull();
  });

  it('should emit only grounded evidence spans for a mixed-content note', () => {
    const result = generateSuggestions(MIXED_CONTENT_NOTE, undefined, DEFAULT_CONFIG);
    const violation = findGroundingViolation(
      result.suggestions,
      MIXED_CONTENT_NOTE.raw_markdown
    );

    expect(violation).toBeNull();
  });

  it('should have at least one non-empty evidence span per emitted suggestion', () => {
    // This guards against the degenerate case where the engine passes the
    // grounding check trivially by emitting only empty spans.
    const notes = [CLOUDSCALE_NOTE, STRUCTURED_NOTE, MIXED_CONTENT_NOTE];

    for (const note of notes) {
      resetSectionCounter();
      resetSuggestionCounter();

      const result = generateSuggestions(note, undefined, DEFAULT_CONFIG);

      for (const suggestion of result.suggestions) {
        const nonEmptySpans = suggestion.evidence_spans.filter(
          (s) => s.text.trim().length > 0
        );
        expect(nonEmptySpans.length).toBeGreaterThanOrEqual(1);
      }
    }
  });
});
