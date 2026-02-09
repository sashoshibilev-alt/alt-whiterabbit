/**
 * Topic Isolation Eligibility-Execution Mismatch Test
 *
 * Regression test for the bug where shouldSplitByTopic() returns true
 * but splitSectionByTopic() finds no anchors and returns [section] unchanged,
 * causing parent to be marked SPLIT_INTO_SUBSECTIONS with no actual subsections.
 *
 * Root cause: Disagreement between eligibility check (substring match) and
 * execution (line-start match) for topic anchors.
 */

import { describe, it, expect } from 'vitest';
import { generateSuggestionsWithDebug } from './debugGenerator';
import type { NoteInput } from './types';
import { DropReason } from './debugTypes';

describe('Topic Isolation Eligibility-Execution Mismatch', () => {
  it('REGRESSION: Should NOT mark SPLIT_INTO_SUBSECTIONS when anchors are substrings, not line-starts', () => {
    // This reproduces the exact issue from run 729d2547…
    // Body contains "new feature requests" as substring but NOT at line start
    const note: NoteInput = {
      note_id: 'test_substring_anchors',
      raw_markdown: `# Meeting Notes

## 🔍 Discussion details

We discussed several new feature requests from customers, including improved search.
The project timelines were also reviewed.
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

    // Assert: Parent should NOT be marked as SPLIT_INTO_SUBSECTIONS
    // because no actual subsections were created
    const parentSection = debugRun.sections.find(s => s.headingTextPreview.includes('Discussion details'));
    expect(parentSection).toBeDefined();

    if (parentSection?.dropReason === DropReason.SPLIT_INTO_SUBSECTIONS) {
      // If marked as split, must have subsections
      const topicSplit = parentSection.metadata?.topicSplit as any;
      expect(topicSplit).toBeDefined();
      expect(topicSplit.subSectionIds).toBeDefined();
      expect(topicSplit.subSectionIds.length).toBeGreaterThan(0);

      // Verify subsections exist
      const allSectionIds = new Set(debugRun.sections.map(s => s.sectionId));
      for (const subsectionId of topicSplit.subSectionIds) {
        expect(allSectionIds.has(subsectionId)).toBe(true);
      }
    } else {
      // Parent was not split - this is correct behavior
      // Should have metadata explaining why (topicIsolationNoOp)
      const metadata = parentSection?.metadata as any;
      if (metadata?.topicIsolation?.eligible) {
        // Was eligible but didn't split - should have noOp metadata
        expect(metadata.topicIsolationNoOp).toBeDefined();
        expect(metadata.topicIsolationNoOp.reason).toBe('no_subsections_created');
      }
    }
  });

  it('REGRESSION: Anchors at line start SHOULD split correctly', () => {
    const note: NoteInput = {
      note_id: 'test_linestart_anchors',
      raw_markdown: `# Meeting Notes

## 🔍 Discussion details

New feature requests:
- Dark mode
- Better search

Project timelines:
- Q2 delayed by 2 sprints
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

    // Assert: Parent SHOULD be marked as SPLIT_INTO_SUBSECTIONS with subsections
    const parentSection = debugRun.sections.find(s => s.headingTextPreview.includes('Discussion details'));
    expect(parentSection).toBeDefined();
    expect(parentSection?.dropReason).toBe(DropReason.SPLIT_INTO_SUBSECTIONS);

    // Verify subsections exist
    const topicSplit = parentSection?.metadata?.topicSplit as any;
    expect(topicSplit).toBeDefined();
    expect(topicSplit.topicsFound.length).toBeGreaterThan(0);
    expect(topicSplit.subSectionIds.length).toBeGreaterThan(0);

    const allSectionIds = new Set(debugRun.sections.map(s => s.sectionId));
    for (const subsectionId of topicSplit.subSectionIds) {
      expect(allSectionIds.has(subsectionId)).toBe(true);
    }
  });

  it('CRITICAL: hasTopicAnchors must match actual extractable anchors', () => {
    // Test case where body contains anchor substring but not at line start
    const noteWithSubstring: NoteInput = {
      note_id: 'test_has_anchors_substring',
      raw_markdown: `# Meeting

## 🔍 Discussion details

We reviewed new feature requests and project timelines in the meeting.
`,
    };

    const resultSubstring = generateSuggestionsWithDebug(
      noteWithSubstring,
      undefined,
      { enable_debug: true },
      { verbosity: 'REDACTED' }
    );

    const debugRunSubstring = resultSubstring.debugRun!;
    const parentSubstring = debugRunSubstring.sections.find(s => s.headingTextPreview.includes('Discussion details'));

    // If eligible, check hasTopicAnchors consistency
    const metadataSubstring = parentSubstring?.metadata as any;
    if (metadataSubstring?.topicIsolation?.eligible) {
      const hasTopicAnchors = metadataSubstring.topicIsolation.hasTopicAnchors;
      const topicsFound = metadataSubstring.topicSplit?.topicsFound || [];

      // INVARIANT: hasTopicAnchors=true should mean topicsFound.length > 0
      if (hasTopicAnchors) {
        expect(topicsFound.length).toBeGreaterThan(0);
      }

      // If no topics found, should NOT be marked as split
      if (topicsFound.length === 0) {
        expect(parentSubstring?.dropReason).not.toBe(DropReason.SPLIT_INTO_SUBSECTIONS);
      }
    }

    // Test case where anchors ARE at line start
    const noteWithLineStart: NoteInput = {
      note_id: 'test_has_anchors_linestart',
      raw_markdown: `# Meeting

## 🔍 Discussion details

New feature requests:
- Feature A

Project timelines:
- Timeline B
`,
    };

    const resultLineStart = generateSuggestionsWithDebug(
      noteWithLineStart,
      undefined,
      { enable_debug: true },
      { verbosity: 'REDACTED' }
    );

    const debugRunLineStart = resultLineStart.debugRun!;
    const parentLineStart = debugRunLineStart.sections.find(s => s.headingTextPreview.includes('Discussion details'));

    const metadataLineStart = parentLineStart?.metadata as any;
    if (metadataLineStart?.topicIsolation?.eligible) {
      const hasTopicAnchors = metadataLineStart.topicIsolation.hasTopicAnchors;
      const topicsFound = metadataLineStart.topicSplit?.topicsFound || [];

      // INVARIANT: hasTopicAnchors=true AND topicsFound.length > 0
      expect(hasTopicAnchors).toBe(true);
      expect(topicsFound.length).toBeGreaterThan(0);

      // Should be marked as split
      expect(parentLineStart?.dropReason).toBe(DropReason.SPLIT_INTO_SUBSECTIONS);
    }
  });

  it('DEBUG TRACE: Run 729d2547 reproduction', () => {
    // Reproduce the exact scenario from run 729d2547
    const note: NoteInput = {
      note_id: '729d2547',
      raw_markdown: `# Team Sync

## 🔍 Discussion details

Team discussed new feature requests including self-service portal. Also covered project timelines and some internal operations updates.
`,
    };

    // Enable trace logging
    const originalEnv = process.env.DEBUG_TOPIC_ISOLATION_TRACE;
    process.env.DEBUG_TOPIC_ISOLATION_TRACE = 'true';

    try {
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
      const parentSection = debugRun.sections.find(s => s.headingTextPreview.includes('Discussion details'));

      // Log trace for inspection
      console.log('[RUN_729d2547_TRACE]:', {
        noteId: note.note_id,
        parentSectionId: parentSection?.sectionId,
        dropReason: parentSection?.dropReason,
        topicIsolation: parentSection?.metadata?.topicIsolation,
        topicSplit: parentSection?.metadata?.topicSplit,
        topicIsolationNoOp: (parentSection?.metadata as any)?.topicIsolationNoOp,
        totalSections: debugRun.sections.length,
        subsections: debugRun.sections.filter(s => s.sectionId.includes('__topic_')).length,
      });

      // Validate invariants
      if (parentSection?.dropReason === DropReason.SPLIT_INTO_SUBSECTIONS) {
        const topicSplit = parentSection.metadata?.topicSplit as any;
        expect(topicSplit).toBeDefined();
        expect(topicSplit.topicsFound.length).toBeGreaterThan(0);
        expect(topicSplit.subSectionIds.length).toBeGreaterThan(0);

        // Verify subsections exist
        const allSectionIds = new Set(debugRun.sections.map(s => s.sectionId));
        for (const subsectionId of topicSplit.subSectionIds) {
          expect(allSectionIds.has(subsectionId)).toBe(true);
        }
      } else {
        // Not split - verify it's either not eligible or eligibility/execution aligned
        const metadata = parentSection?.metadata as any;
        if (metadata?.topicIsolation?.eligible) {
          // Was eligible but didn't split
          expect(metadata.topicIsolationNoOp).toBeDefined();
        }
      }
    } finally {
      // Restore original env
      if (originalEnv !== undefined) {
        process.env.DEBUG_TOPIC_ISOLATION_TRACE = originalEnv;
      } else {
        delete process.env.DEBUG_TOPIC_ISOLATION_TRACE;
      }
    }
  });
});
