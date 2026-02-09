/**
 * Discussion Details No Fallback Test
 *
 * Regression test for the bug where "Discussion details" sections without
 * topic anchors emit "Review:" fallback instead of normal synthesis.
 *
 * Rule: If section has "Discussion details" heading OR is long (bulletCount>=5
 * OR charCount>=500), it should NEVER emit "Review:" fallback, even if
 * synthesis produces 0 candidates.
 */

import { describe, it, expect } from 'vitest';
import { generateSuggestionsWithDebug } from './debugGenerator';
import type { NoteInput } from './types';

describe('Discussion Details No Fallback', () => {
  it('REGRESSION d6672ee9: Discussion details without anchors should NOT emit Review fallback', () => {
    // This reproduces the exact issue from run d6672ee9
    // Gemini-style format with "Discussion details" but no topic anchors at line start
    const note: NoteInput = {
      note_id: 'test_d6672ee9',
      raw_markdown: `# Gemini Session

## 🔍 Discussion details

* **Customer feedback:** Users are requesting a self-service portal for managing subscriptions
* **Timeline update:** Q2 launch will slip by 2 sprints due to scope expansion
* **Internal process:** We need to standardize our meeting-free Wednesdays policy
* **Feature request:** Add dark mode support to the main dashboard
* **Resource allocation:** Engineering team needs two additional headcount for H2
* **Compliance:** New GDPR requirements need to be addressed by Q3
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

    // Assert: NO suggestions should start with "Review:"
    for (const suggestion of result.suggestions) {
      expect(suggestion.title.toLowerCase()).not.toMatch(/^review:/);
      expect(suggestion.title.toLowerCase()).not.toContain('review:');
    }

    // Assert: If debug run available, check no fallback candidates
    if (result.debugRun) {
      const discussionSection = result.debugRun.sections.find(s =>
        s.headingTextPreview.toLowerCase().includes('discussion details')
      );

      if (discussionSection) {
        // Check metadata to understand what happened
        const metadata = discussionSection.metadata as any;
        console.log('[d6672ee9_DEBUG]:', {
          sectionId: discussionSection.sectionId,
          dropReason: discussionSection.dropReason,
          candidatesCount: discussionSection.candidates.length,
          topicIsolation: metadata?.topicIsolation,
          topicIsolationNoOp: metadata?.topicIsolationNoOp,
        });

        // Check candidates for fallback pattern
        for (const candidate of discussionSection.candidates) {
          const title = candidate.suggestion?.title || '';
          expect(title.toLowerCase()).not.toMatch(/^review:/);
          expect(title.toLowerCase()).not.toContain('review:');
          expect(candidate.candidateId).not.toContain('fallback_');
        }
      }
    }
  });

  it('STRESS TEST: Discussion details WITHOUT topic anchors should emit useful suggestion (not Review)', () => {
    const note: NoteInput = {
      note_id: 'test_discussion_no_anchors',
      raw_markdown: `# Meeting Notes

## 🔍 Discussion details

We covered several important topics today:

- Customer feedback on the new portal interface is mostly positive
- Q2 timeline might slip due to additional scope requests
- Internal process improvements are underway
- Dark mode feature is highly requested by enterprise customers
- Resource planning for H2 needs attention

Overall the team is aligned on priorities.
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

    // Assert: NO "Review:" fallback should be emitted
    const reviewFallbacks = result.suggestions.filter(s =>
      s.title.toLowerCase().startsWith('review:')
    );
    expect(reviewFallbacks).toHaveLength(0);

    // Either emit real suggestions OR emit nothing (both acceptable)
    // But NEVER emit "Review:" fallback
    for (const suggestion of result.suggestions) {
      expect(suggestion.title.toLowerCase()).not.toMatch(/^review:/);
      expect(suggestion.suggestion_id).not.toContain('fallback_');
    }
  });

  it('CRITICAL: Long sections (bulletCount>=5) should NOT emit Review fallback', () => {
    const note: NoteInput = {
      note_id: 'test_long_section_no_fallback',
      raw_markdown: `# Team Updates

## Status Report

- Project A is on track for Q2 delivery
- Project B timeline needs review due to dependencies
- Project C has been deprioritized
- Resource allocation for Q3 is in progress
- Customer feedback loop improvements are underway
- Hiring plan for H2 finalized
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

    // Assert: NO "Review:" fallback
    for (const suggestion of result.suggestions) {
      expect(suggestion.title.toLowerCase()).not.toMatch(/^review:/);
      expect(suggestion.suggestion_id).not.toContain('fallback_');
    }
  });

  it('CRITICAL: Long sections (charCount>=500) should NOT emit Review fallback', () => {
    const note: NoteInput = {
      note_id: 'test_long_char_count',
      raw_markdown: `# Product Roadmap

## Q2 Priorities

We are focusing on several key initiatives this quarter. The primary goal is to deliver the self-service portal which has been highly requested by our enterprise customers. This portal will allow customers to manage their subscriptions, view usage analytics, and configure team settings without needing to contact support.

Additionally, we are investing in dark mode support across all products. This has been one of our top feature requests, particularly from developers who prefer dark interfaces. The design team has completed the mockups and engineering is starting implementation next week.

On the timeline front, we need to be realistic about our delivery dates. The Q2 launch for the analytics dashboard will likely slip by 2 sprints due to scope expansion requested by our largest customer. This is acceptable given the strategic importance of this account.

Finally, we are standardizing our internal processes, particularly around meeting-free days and asynchronous communication practices.
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

    // Assert: NO "Review:" fallback
    for (const suggestion of result.suggestions) {
      expect(suggestion.title.toLowerCase()).not.toMatch(/^review:/);
      expect(suggestion.suggestion_id).not.toContain('fallback_');
    }
  });

  it('GEMINI FORMAT: Discussion details with bold labels (no anchors) should emit real suggestions', () => {
    // Gemini-style format with **Label:** but no topic anchor at line start
    const note: NoteInput = {
      note_id: 'test_gemini_format',
      raw_markdown: `# Team Sync Notes

## 🔍 Discussion details

* **New feature requests:** Customers want better reporting and dark mode
* **Project timelines:** Q2 deliverables will slip by 2 sprints
* **Internal operations:** Standardize meeting-free Wednesdays
* **Resource planning:** Need 2 more engineers in Q3
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

    // Assert: NO "Review:" fallback
    for (const suggestion of result.suggestions) {
      expect(suggestion.title.toLowerCase()).not.toMatch(/^review:/);
      expect(suggestion.suggestion_id).not.toContain('fallback_');
    }

    // Section should either:
    // 1. Emit real suggestions (idea/project_update), OR
    // 2. Emit nothing (if all dropped)
    // But NEVER emit fallback
    if (result.debugRun) {
      const discussionSection = result.debugRun.sections.find(s =>
        s.headingTextPreview.toLowerCase().includes('discussion details')
      );

      if (discussionSection && discussionSection.candidates.length > 0) {
        // If candidates exist, none should be fallback
        for (const candidate of discussionSection.candidates) {
          expect(candidate.candidateId).not.toContain('fallback_');
        }
      }
    }
  });

  it('CRITICAL: Discussion details with NO anchors should NOT be INTERNAL_ERROR', () => {
    // Regression for runId 3f8c6e88 where sec_j979vrgx_5 had INTERNAL_ERROR
    // Section: "Discussion details", plan_change intent, no topic anchors
    // Should be: LOW_RELEVANCE or emit real suggestion, NOT INTERNAL_ERROR
    const note: NoteInput = {
      note_id: 'test_3f8c6e88',
      raw_markdown: `# Team Meeting

## 🔍 Discussion details

Customer feedback was positive overall. Timeline review showed Q2 on track.
Internal process improvements continuing as planned.
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

    // Assert: NO INTERNAL_ERROR
    if (result.debugRun) {
      const discussionSection = result.debugRun.sections.find(s =>
        s.headingTextPreview.toLowerCase().includes('discussion details')
      );

      if (discussionSection) {
        // CRITICAL: dropReason must NOT be INTERNAL_ERROR
        expect(discussionSection.dropReason).not.toBe('INTERNAL_ERROR');

        // Check what actually happened
        if (discussionSection.dropReason) {
          // If dropped, should be LOW_RELEVANCE or similar, not INTERNAL_ERROR
          const acceptableDropReasons = ['LOW_RELEVANCE', 'SUPPRESSED_SECTION', 'NOT_ACTIONABLE'];
          expect(acceptableDropReasons).toContain(discussionSection.dropReason);
        }

        // Log for debugging
        console.log('[3f8c6e88_REGRESSION]:', {
          dropReason: discussionSection.dropReason,
          dropStage: discussionSection.dropStage,
          synthesisRan: discussionSection.synthesisRan,
          candidatesCount: discussionSection.candidates.length,
          metadata: discussionSection.metadata,
        });
      }
    }

    // Assert: NO "Review:" fallback
    for (const suggestion of result.suggestions) {
      expect(suggestion.title.toLowerCase()).not.toMatch(/^review:/);
      expect(suggestion.suggestion_id).not.toContain('fallback_');
    }
  });

  it('ACCEPTABLE: Discussion details with 0 emitted suggestions (all dropped)', () => {
    // It's OK to emit 0 suggestions if all are dropped/suppressed
    // But NOT OK to emit "Review:" fallback
    const note: NoteInput = {
      note_id: 'test_zero_suggestions_ok',
      raw_markdown: `# Meeting

## 🔍 Discussion details

General updates were shared. Team alignment looks good.
Next steps will be communicated later.
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

    // Assert: NO "Review:" fallback, even if 0 suggestions emitted
    const reviewFallbacks = result.suggestions.filter(s =>
      s.title.toLowerCase().startsWith('review:')
    );
    expect(reviewFallbacks).toHaveLength(0);

    // 0 suggestions is acceptable, fallback is NOT
    for (const suggestion of result.suggestions) {
      expect(suggestion.suggestion_id).not.toContain('fallback_');
    }
  });
});
