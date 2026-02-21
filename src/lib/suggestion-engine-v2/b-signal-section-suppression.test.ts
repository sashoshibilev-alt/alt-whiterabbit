/**
 * B-Signal Seeding: Section Suppression Regression Tests
 *
 * Verifies that Stage 4.5 (B-signal seeding) respects section-level suppression.
 * Suppressed sections (e.g., "Next Steps", "Summary", "Action Items") must not
 * produce B-signal candidates, even when their body text contains feature-demand
 * or other B-signal-triggering language.
 *
 * Without the Stage 4.5 guard, a suppressed section could reintroduce candidates
 * that the normal synthesis path already refuses to emit — defeating the suppression
 * invariant and potentially producing process-noise suggestions.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { generateSuggestions } from './index';
import type { NoteInput } from './types';
import { DEFAULT_CONFIG } from './types';
import { resetSectionCounter } from './preprocessing';
import { resetSuggestionCounter } from './synthesis';
import { resetBSignalCounter } from './bSignalSeeding';

beforeEach(() => {
  resetSectionCounter();
  resetSuggestionCounter();
  resetBSignalCounter();
});

describe('Stage 4.5 B-signal seeding respects section suppression', () => {
  it('emits no candidates from a "Next Steps" section with feature-demand language', () => {
    const note: NoteInput = {
      note_id: 'test-bsig-suppressed-next-steps',
      raw_markdown: `# Product Planning

## Feature Work

We need to add bulk-upload support for enterprise customers by Q3.

## Next Steps

They need to build the export API and ship the mobile dashboard.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    // No suggestion should have its source section be the "Next Steps" heading
    const fromNextSteps = result.suggestions.filter(s =>
      s.suggestion?.sourceHeading?.toLowerCase().includes('next steps')
    );
    expect(fromNextSteps).toHaveLength(0);
  });

  it('emits no candidates from a "Action Items" section with feature-demand language', () => {
    const note: NoteInput = {
      note_id: 'test-bsig-suppressed-action-items',
      raw_markdown: `# Meeting Notes

## Discussion

We should redesign the onboarding flow to reduce drop-off.

## Action Items

They need to implement SSO and add role-based access control.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    const fromActionItems = result.suggestions.filter(s =>
      s.suggestion?.sourceHeading?.toLowerCase().includes('action items')
    );
    expect(fromActionItems).toHaveLength(0);
  });

  it('emits no candidates from a "Summary" section with feature-demand language', () => {
    const note: NoteInput = {
      note_id: 'test-bsig-suppressed-summary',
      raw_markdown: `# Weekly Sync

## Engineering Work

The team needs to migrate the auth service to the new token format.

## Summary

They need to complete the migration and add monitoring dashboards.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    const fromSummary = result.suggestions.filter(s =>
      s.suggestion?.sourceHeading?.toLowerCase().includes('summary')
    );
    expect(fromSummary).toHaveLength(0);
  });

  it('still emits candidates from non-suppressed sections in the same note', () => {
    const note: NoteInput = {
      note_id: 'test-bsig-suppressed-plus-valid',
      raw_markdown: `# Q3 Planning

## Feature Work

They need bulk-upload support for enterprise customers by end of Q3.

## Next Steps

They need to finalize the API design and ship the first milestone.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    // The "Feature Work" section (non-suppressed) should still produce a suggestion
    const fromFeatureWork = result.suggestions.filter(s =>
      s.suggestion?.sourceHeading?.toLowerCase().includes('feature work')
    );
    expect(fromFeatureWork.length).toBeGreaterThanOrEqual(1);

    // The "Next Steps" section (suppressed) must produce nothing
    const fromNextSteps = result.suggestions.filter(s =>
      s.suggestion?.sourceHeading?.toLowerCase().includes('next steps')
    );
    expect(fromNextSteps).toHaveLength(0);
  });
});
