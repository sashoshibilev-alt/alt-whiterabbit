/**
 * Topic Isolation Invariants Test
 *
 * Tests the hard invariants for topic isolation:
 * 1. When split happens, parent.metadata.topicSplit must be attached
 * 2. Subsections must be added to ledger and appear in debugRun.sections[]
 * 3. If parent dropReason=SPLIT_INTO_SUBSECTIONS and no subsections exist,
 *    emit explicit dropReason (INTERNAL_ERROR), not silent success
 */

import { describe, it, expect } from 'vitest';
import { generateSuggestionsWithDebug } from './debugGenerator';
import type { NoteInput } from './types';
import { DropReason, DropStage } from './debugTypes';

describe('Topic Isolation Invariants', () => {
  it('INVARIANT 1: Parent with SPLIT_INTO_SUBSECTIONS must have topicSplit metadata', () => {
    const note: NoteInput = {
      note_id: 'test_topic_split_metadata',
      raw_markdown: `# Meeting Notes

## 🔍 Discussion details

New feature requests:
- Add dark mode
- Improve search

Project timelines:
- Q2 launch delayed by 2 sprints
- Q3 beta on track

Internal operations:
- Update server naming convention
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
    const parentSections = debugRun.sections.filter(
      s => s.dropReason === DropReason.SPLIT_INTO_SUBSECTIONS
    );

    // Assert: All parent sections marked as SPLIT_INTO_SUBSECTIONS must have topicSplit metadata
    for (const parent of parentSections) {
      expect(parent.metadata?.topicSplit).toBeDefined();
      expect(parent.metadata?.topicSplit).toHaveProperty('subSectionIds');
      expect(parent.metadata?.topicSplit).toHaveProperty('subsectionCount');
      expect(parent.metadata?.topicSplit).toHaveProperty('reason');

      // Validate subSectionIds is non-empty array
      const topicSplit = parent.metadata!.topicSplit as any;
      expect(Array.isArray(topicSplit.subSectionIds)).toBe(true);
      expect(topicSplit.subSectionIds.length).toBeGreaterThan(0);
      expect(topicSplit.subsectionCount).toBe(topicSplit.subSectionIds.length);
    }
  });

  it('INVARIANT 2: Subsections must appear in debugRun.sections[]', () => {
    const note: NoteInput = {
      note_id: 'test_subsections_in_ledger',
      raw_markdown: `# Meeting Notes

## 🔍 Discussion details

New feature requests:
- Add dark mode to the app
- Improve search performance

Project timelines:
- Q2 launch will slip by 2 sprints due to scope increase
- Q3 beta remains on track

Internal operations:
- Update server naming convention to avoid confusion
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
    const parentSections = debugRun.sections.filter(
      s => s.dropReason === DropReason.SPLIT_INTO_SUBSECTIONS
    );

    // Assert: For each parent, all subSectionIds must exist in debugRun.sections[]
    const allSectionIds = new Set(debugRun.sections.map(s => s.sectionId));

    for (const parent of parentSections) {
      const topicSplit = parent.metadata!.topicSplit as any;
      const subSectionIds: string[] = topicSplit.subSectionIds;

      for (const subsectionId of subSectionIds) {
        expect(allSectionIds.has(subsectionId)).toBe(true);
      }

      // Additional check: At least one __topic_* subsection must exist
      const hasTopicSubsections = subSectionIds.some(id => id.includes('__topic_'));
      expect(hasTopicSubsections).toBe(true);
    }
  });

  it('INVARIANT 3: If parent marked SPLIT but no subsections, emit INTERNAL_ERROR', () => {
    // This test simulates a scenario where topic splitting fails internally
    // In practice, this should never happen due to the invariant checks we added,
    // but if it does, we want to ensure it's marked as INTERNAL_ERROR not silent success

    const note: NoteInput = {
      note_id: 'test_split_failure_detection',
      raw_markdown: `# Meeting Notes

## 🔍 Discussion details

New feature requests:
- Add dark mode
- Improve search

Project timelines:
- Q2 launch delayed
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
    const allSectionIds = new Set(debugRun.sections.map(s => s.sectionId));

    // Check each section marked as SPLIT_INTO_SUBSECTIONS
    for (const section of debugRun.sections) {
      if (section.dropReason === DropReason.SPLIT_INTO_SUBSECTIONS) {
        const topicSplit = section.metadata?.topicSplit as any;

        // If topicSplit metadata exists but no subsections in ledger, it should be marked as error
        if (topicSplit && topicSplit.subSectionIds) {
          const subSectionIds: string[] = topicSplit.subSectionIds;
          const existingSubsections = subSectionIds.filter(id => allSectionIds.has(id));

          if (existingSubsections.length === 0) {
            // INVARIANT: Should be marked as INTERNAL_ERROR, not SPLIT_INTO_SUBSECTIONS
            expect(section.dropReason).toBe(DropReason.INTERNAL_ERROR);
            expect(section.metadata?.topicIsolationFailure).toBeDefined();
          }
        }
      }
    }
  });

  it('DEBUG TRACE: Run with DEBUG_TOPIC_ISOLATION_TRACE on specific noteId j977ea6y', () => {
    // This test reproduces the exact wild run scenario
    // Note: The actual note content would need to be provided
    const note: NoteInput = {
      note_id: 'j977ea6y',
      raw_markdown: `# Team Meeting Notes

## 🔍 Discussion details

New feature requests:
- Customer requested self-service portal enhancements
- Need better reporting dashboard

Project timelines:
- Self-service deliverables will slip by 2 sprints
- Reporting dashboard launch moved to Q3

Internal operations:
- Standardize meeting-free Wednesdays
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

      // Validate no invariant violations
      const splitParents = debugRun.sections.filter(
        s => s.dropReason === DropReason.SPLIT_INTO_SUBSECTIONS
      );

      for (const parent of splitParents) {
        // Check topicSplit metadata exists
        expect(parent.metadata?.topicSplit).toBeDefined();

        // Check subsections exist
        const topicSplit = parent.metadata!.topicSplit as any;
        const subSectionIds: string[] = topicSplit.subSectionIds;
        const allSectionIds = new Set(debugRun.sections.map(s => s.sectionId));

        const existingSubsections = subSectionIds.filter(id => allSectionIds.has(id));
        expect(existingSubsections.length).toBeGreaterThan(0);
      }

      // Log summary for manual inspection
      console.log('[TOPIC_ISOLATION_TRACE] Test summary:', {
        totalSections: debugRun.sections.length,
        splitParents: splitParents.length,
        subsections: debugRun.sections.filter(s => s.sectionId.includes('__topic_')).length,
        suggestions: result.suggestions.length,
      });
    } finally {
      // Restore original env
      if (originalEnv !== undefined) {
        process.env.DEBUG_TOPIC_ISOLATION_TRACE = originalEnv;
      } else {
        delete process.env.DEBUG_TOPIC_ISOLATION_TRACE;
      }
    }
  });

  it('REGRESSION: Ensure split sections do not bypass maxSuggestionsPerNote', () => {
    // Split sections should be subject to the same maxSuggestionsPerNote limit
    const note: NoteInput = {
      note_id: 'test_max_suggestions_with_split',
      raw_markdown: `# Meeting Notes

## 🔍 Discussion details

New feature requests:
- Feature A
- Feature B
- Feature C

Project timelines:
- Project X delayed by 2 sprints
- Project Y on track
- Project Z ahead of schedule

Internal operations:
- Operation 1
- Operation 2
- Operation 3
`,
    };

    const result = generateSuggestionsWithDebug(
      note,
      undefined,
      {
        enable_debug: true,
        max_suggestions: 3,
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

    // Assert: Total suggestions should respect max_suggestions limit
    expect(result.suggestions.length).toBeLessThanOrEqual(3);

    // Assert: All subsections should appear in debugRun.sections[]
    const debugRun = result.debugRun!;
    const parentSections = debugRun.sections.filter(
      s => s.dropReason === DropReason.SPLIT_INTO_SUBSECTIONS
    );

    for (const parent of parentSections) {
      const topicSplit = parent.metadata?.topicSplit as any;
      if (topicSplit && topicSplit.subSectionIds) {
        const allSectionIds = new Set(debugRun.sections.map(s => s.sectionId));
        for (const subsectionId of topicSplit.subSectionIds) {
          expect(allSectionIds.has(subsectionId)).toBe(true);
        }
      }
    }
  });

  it('STRESS TEST: Multiple sections eligible for splitting', () => {
    const note: NoteInput = {
      note_id: 'test_multiple_splits',
      raw_markdown: `# Meeting Notes

## 🔍 First Discussion

New feature requests:
- Feature set 1A
- Feature set 1B

Project timelines:
- Timeline 1 delayed

## 🔍 Second Discussion

New feature requests:
- Feature set 2A
- Feature set 2B

Project timelines:
- Timeline 2 on track

## 🔍 Third Discussion

New feature requests:
- Feature set 3A

Internal operations:
- Operation 3A
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
    const parentSections = debugRun.sections.filter(
      s => s.dropReason === DropReason.SPLIT_INTO_SUBSECTIONS
    );

    // Validate all parents
    for (const parent of parentSections) {
      // Check topicSplit metadata
      expect(parent.metadata?.topicSplit).toBeDefined();

      // Check subsections exist
      const topicSplit = parent.metadata!.topicSplit as any;
      const subSectionIds: string[] = topicSplit.subSectionIds;
      const allSectionIds = new Set(debugRun.sections.map(s => s.sectionId));

      for (const subsectionId of subSectionIds) {
        expect(allSectionIds.has(subsectionId)).toBe(true);
      }
    }

    // Log for debugging
    console.log('[STRESS_TEST] Multiple splits:', {
      totalSections: debugRun.sections.length,
      parentSectionsWithSplit: parentSections.length,
      totalSubsections: debugRun.sections.filter(s => s.sectionId.includes('__topic_')).length,
    });
  });
});
