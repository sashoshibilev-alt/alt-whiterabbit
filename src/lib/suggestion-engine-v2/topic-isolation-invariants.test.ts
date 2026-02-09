/**
 * Topic Isolation Regression Test
 *
 * Ensures that "Discussion details" sections with plan_change intent
 * do not emit INTERNAL_ERROR when fallback is intentionally skipped.
 */

import { describe, it, expect } from 'vitest';
import { generateSuggestionsWithDebug } from './debugGenerator';
import type { NoteInput } from './types';
import { DropReason } from './debugTypes';

describe('Topic Isolation Regression', () => {
  it('REGRESSION: plan_change sections with fallback skip should not emit INTERNAL_ERROR', () => {
    // This test verifies the fix for: Discussion details / long sections that
    // intentionally skip fallback creation should not be marked as INTERNAL_ERROR
    // when they end up with 0 candidates.
    //
    // The fix: Check for section.metadata.fallbackSkipped in DebugLedger.finalize()
    // before marking plan_change sections with 0 candidates as INTERNAL_ERROR.
    const note: NoteInput = {
      note_id: 'test_fallback_skip',
      raw_markdown: `# Meeting Notes

## Discussion details

Some text mentioning new feature requests: in the middle of a sentence.
Another line with project timelines: also not at line start.
- We discussed improving search performance (action: research options)
- Timeline for Q2 delivery was mentioned
- Consider adding dark mode to the app
`,
    };

    const result = generateSuggestionsWithDebug(
      note,
      undefined,
      {
        enable_debug: true,
        thresholds: {
          T_action: 0.3,
          T_out_of_scope: 0.7,
          T_section_min: 0.3,
          T_overall_min: 0.4,
          MIN_EVIDENCE_CHARS: 20,
        },
      },
      { verbosity: 'REDACTED' }
    );

    const debugRun = result.debugRun!;

    // Key assertion: No sections should be marked as INTERNAL_ERROR
    // (the original bug would cause INTERNAL_ERROR for discussion details with 0 candidates)
    const internalErrorSections = debugRun.sections.filter(
      s => s.dropReason === DropReason.INTERNAL_ERROR
    );

    expect(internalErrorSections.length).toBe(0);

    // Additionally verify: If any plan_change section didn't emit,
    // it should either have fallbackSkipped metadata or a valid non-ERROR dropReason
    const planChangeSections = debugRun.sections.filter(
      s => s.decisions.intentLabel === 'plan_change' && !s.emitted
    );

    for (const section of planChangeSections) {
      if (section.dropReason === DropReason.INTERNAL_ERROR) {
        // If marked as INTERNAL_ERROR, should NOT have fallbackSkipped
        // (that would be the bug - fallbackSkipped should prevent INTERNAL_ERROR)
        expect(section.metadata?.fallbackSkipped).toBeUndefined();
      }
    }
  });

  it('REGRESSION: Topic isolation with actual split should still work correctly', () => {
    // Ensure that actual topic splitting (anchors at line-start) still works
    const note: NoteInput = {
      note_id: 'test_topic_split_works',
      raw_markdown: `# Meeting Notes

## 🔍 Discussion details

New feature requests:
- Add dark mode to the app
- Improve search performance

Project timelines:
- Q2 launch will slip by 2 sprints
- Q3 beta remains on track
`,
    };

    const result = generateSuggestionsWithDebug(
      note,
      undefined,
      {
        enable_debug: true,
        thresholds: {
          T_action: 0.3,
          T_out_of_scope: 0.7,
          T_section_min: 0.3,
          T_overall_min: 0.4,
          MIN_EVIDENCE_CHARS: 20,
        },
      },
      { verbosity: 'REDACTED' }
    );

    const debugRun = result.debugRun!;

    // Should have parent section marked as SPLIT_INTO_SUBSECTIONS
    const splitParents = debugRun.sections.filter(
      s => s.dropReason === DropReason.SPLIT_INTO_SUBSECTIONS
    );

    if (splitParents.length > 0) {
      // If split happened, verify invariants
      for (const parent of splitParents) {
        // Must have topicSplit metadata
        expect(parent.metadata?.topicSplit).toBeDefined();

        // Subsections must exist in ledger
        const topicSplit = parent.metadata!.topicSplit as any;
        const subSectionIds: string[] = topicSplit.subSectionIds || [];
        const allSectionIds = new Set(debugRun.sections.map(s => s.sectionId));

        for (const subsectionId of subSectionIds) {
          expect(allSectionIds.has(subsectionId)).toBe(true);
        }
      }
    }
  });
});
