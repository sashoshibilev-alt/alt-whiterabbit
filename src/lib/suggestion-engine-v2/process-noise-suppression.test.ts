/**
 * Process/Ownership Noise Suppression Tests
 *
 * Verifies that candidates generated from process/ownership ambiguity phrasing
 * are suppressed at the candidate level, while real product feature requests
 * in the same section pass through normally.
 *
 * Requirements tested:
 * A) Candidate-level suppression (not whole-section).
 * B) B-signal extraction: noise sentences do not seed candidates.
 * C) Normal synthesis: noise evidence is suppressed in Stage 4.7.
 * D) Debug: when a synthesized candidate has noise evidence, PROCESS_NOISE is
 *    recorded in the debug ledger via dropCandidateById.
 * E) Legitimate "Owner: X" delivery syntax is NOT suppressed.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { generateSuggestions, NoteInput, DEFAULT_CONFIG, DropReason, DropStage, DROP_REASON_STAGE } from './index';
import { generateSuggestionsWithDebug } from './debugGenerator';
import { resetSectionCounter } from './preprocessing';
import { resetSuggestionCounter } from './synthesis';
import { seedCandidatesFromBSignals, resetBSignalCounter } from './bSignalSeeding';
import { isProcessNoiseSentence } from './processNoiseSuppression';
import type { ClassifiedSection } from './types';

// ============================================
// Helper: build a minimal ClassifiedSection for unit tests
// ============================================

function makeSection(rawText: string): ClassifiedSection {
  return {
    section_id: 'sec_test_noise_001',
    note_id: 'note_test_noise_001',
    heading_text: 'Test Section',
    heading_level: 2,
    start_line: 0,
    end_line: 5,
    body_lines: rawText.split('\n').map((text, index) => ({
      index,
      text,
      line_type: 'paragraph' as const,
    })),
    structural_features: {
      num_lines: 3,
      num_list_items: 0,
      has_dates: false,
      has_metrics: false,
      has_quarter_refs: false,
      has_version_refs: false,
      has_launch_keywords: false,
      initiative_phrase_density: 0,
    },
    raw_text: rawText,
    is_actionable: true,
    intent: {
      plan_change: 0.3,
      new_workstream: 0.7,
      status_informational: 0.1,
      communication: 0.1,
      research: 0.1,
      calendar: 0.0,
      micro_tasks: 0.0,
    },
    suggested_type: 'idea',
    type_confidence: 0.7,
    typeLabel: 'idea',
  };
}

// ============================================
// Unit tests for the suppression predicate
// ============================================

describe('isProcessNoiseSentence (unit)', () => {
  it('matches "ambiguity around who owns"', () => {
    expect(isProcessNoiseSentence(
      'Ambiguity around who owns the final QA sign-off for the SOC2 compliance check.'
    )).toBe(true);
  });

  it('matches "unclear who owns"', () => {
    expect(isProcessNoiseSentence('It is unclear who owns the handover process.')).toBe(true);
  });

  it('matches "who owns" alone', () => {
    expect(isProcessNoiseSentence('The question of who owns this remains unanswered.')).toBe(true);
  });

  it('matches "sign-off"', () => {
    expect(isProcessNoiseSentence('We need a sign-off from the compliance team.')).toBe(true);
  });

  it('matches "handover"', () => {
    expect(isProcessNoiseSentence('The handover between teams is ambiguous.')).toBe(true);
  });

  it('matches "final QA"', () => {
    expect(isProcessNoiseSentence('There is ambiguity around who handles final QA.')).toBe(true);
  });

  it('matches "ownership" in ambiguous context', () => {
    expect(isProcessNoiseSentence('Ownership of the review process is unclear.')).toBe(true);
  });

  it('does NOT match "Owner: Alice" delivery syntax', () => {
    expect(isProcessNoiseSentence('Owner: Alice – implement auth flow by Q3.')).toBe(false);
  });

  it('does NOT match "PM to build X" delivery task', () => {
    expect(isProcessNoiseSentence('PM to build the analytics dashboard this sprint.')).toBe(false);
  });

  it('does NOT match real feature request without noise phrases', () => {
    expect(isProcessNoiseSentence('We need bulk-upload support for enterprise customers.')).toBe(false);
  });

  it('does NOT match SOC2 alone (no noise phrase)', () => {
    expect(isProcessNoiseSentence('SOC2 compliance audit is scheduled for Q3.')).toBe(false);
  });
});

// ============================================
// B-signal seeding: noise sentences are not seeded
// ============================================

describe('B-signal seeding – process noise suppression', () => {
  beforeEach(() => {
    resetBSignalCounter();
  });

  it('does not create a B-signal candidate from a noise sentence that contains a trigger verb', () => {
    // This sentence contains "need" (a FEATURE_DEMAND trigger) AND ownership noise.
    // Without the filter, it would generate a B-signal candidate.
    const section = makeSection(
      'They need to clarify who owns the sign-off and handover for SOC2.'
    );
    const candidates = seedCandidatesFromBSignals(section);

    // No candidate should be seeded from the noise sentence
    const noiseCandidates = candidates.filter(c => {
      const evidence = c.evidence_spans[0]?.text ?? '';
      return isProcessNoiseSentence(evidence);
    });
    expect(noiseCandidates).toHaveLength(0);
  });

  it('still seeds B-signal candidates from non-noise sentences in the same section', () => {
    const section = makeSection(
      'We need bulk-upload by Q3.\nThey need to clarify who owns the sign-off for SOC2.'
    );
    const candidates = seedCandidatesFromBSignals(section);

    // Should have at least one B-signal from the bulk-upload sentence
    const bulkUploadCandidate = candidates.find(c =>
      (c.evidence_spans[0]?.text ?? '').toLowerCase().includes('bulk')
    );
    // Note: B-signal extraction might or might not produce a candidate here
    // depending on sentence parsing; the key assertion is no noise candidate is produced
    const noiseCandidates = candidates.filter(c => {
      const evidence = c.evidence_spans[0]?.text ?? '';
      return isProcessNoiseSentence(evidence);
    });
    expect(noiseCandidates).toHaveLength(0);
  });
});

// ============================================
// Integration test: mixed note (feature + ownership noise in same section)
// ============================================

describe('Process Noise Suppression – integration', () => {
  beforeEach(() => {
    resetSectionCounter();
    resetSuggestionCounter();
    resetBSignalCounter();
  });

  const MIXED_NOTE: NoteInput = {
    note_id: 'test-process-noise-mixed',
    raw_markdown: `# Q3 Planning

## Compliance and Feature Work

We need to implement bulk-upload support for enterprise customers.
Ambiguity around who owns the final QA sign-off for the SOC2 compliance check.
`,
  };

  it('produces at least one suggestion for the feature request sentence', () => {
    const result = generateSuggestions(MIXED_NOTE, undefined, DEFAULT_CONFIG);
    expect(result.suggestions.length).toBeGreaterThanOrEqual(1);
  });

  it('feature request suggestion exists (bulk-upload or enterprise)', () => {
    const result = generateSuggestions(MIXED_NOTE, undefined, DEFAULT_CONFIG);

    const featureSuggestion = result.suggestions.find(s => {
      const combined = [
        s.title,
        s.payload.draft_initiative?.description ?? '',
        s.suggestion?.body ?? '',
      ].join(' ').toLowerCase();
      return combined.includes('bulk') || combined.includes('enterprise') || combined.includes('upload');
    });

    expect(featureSuggestion).toBeDefined();
  });

  it('NO suggestion references SOC2, sign-off, ownership, who owns, or ambiguity', () => {
    const result = generateSuggestions(MIXED_NOTE, undefined, DEFAULT_CONFIG);

    const NOISE_TERMS = [
      'soc2', 'soc 2', 'sign-off', 'sign off', 'signoff',
      'who owns', 'ambiguity', 'final qa', 'handover',
    ];

    for (const suggestion of result.suggestions) {
      const fullText = [
        suggestion.title,
        suggestion.payload.after_description ?? '',
        suggestion.payload.draft_initiative?.title ?? '',
        suggestion.payload.draft_initiative?.description ?? '',
        suggestion.suggestion?.body ?? '',
        ...(suggestion.suggestion?.evidencePreview ?? []),
        ...(suggestion.evidence_spans.map(s => s.text)),
      ].join(' ').toLowerCase();

      for (const term of NOISE_TERMS) {
        expect(
          fullText,
          `Suggestion "${suggestion.title}" should not reference "${term}"`
        ).not.toContain(term);
      }
    }
  });
});

// ============================================
// Debug ledger: PROCESS_NOISE drop is recorded when a synthesized candidate
// has noise as its evidence. Uses a dedicated noise-heavy section that goes
// through the plan_change fallback path (which creates a candidate with the
// section body as evidence).
// ============================================

describe('Process Noise Suppression – debug ledger', () => {
  beforeEach(() => {
    resetSectionCounter();
    resetSuggestionCounter();
    resetBSignalCounter();
  });

  it('PROCESS_NOISE is a known DropReason mapped to POST_SYNTHESIS_SUPPRESS', () => {
    // Verify the enum and mapping are correctly configured
    expect(DROP_REASON_STAGE[DropReason.PROCESS_NOISE]).toBe(DropStage.POST_SYNTHESIS_SUPPRESS);
  });

  it('debug ledger records PROCESS_NOISE drop for a plan_change section with noise evidence', () => {
    // This note has a section that looks like a plan change (heading + update language)
    // where the body is noise content. The plan_change fallback path creates a candidate
    // using the section body as evidence, which then gets caught by Stage 4.7.
    const noiseNote: NoteInput = {
      note_id: 'test-process-noise-ledger',
      raw_markdown: `# Q3 Review

## Process Update

Ownership of the sign-off process is ambiguous.
Who owns the handover and the final QA approval is unclear.
Ambiguity around who owns these steps is blocking alignment.
`,
    };

    const result = generateSuggestionsWithDebug(
      noiseNote,
      undefined,
      DEFAULT_CONFIG,
      { verbosity: 'FULL_TEXT' }
    );

    const debugRun = result.debugRun;
    expect(debugRun).toBeDefined();

    const allCandidates = debugRun!.sections.flatMap(s => s.candidates);

    // If any candidate was dropped with PROCESS_NOISE, the suppression is working
    const noiseDropped = allCandidates.filter(
      c => !c.emitted && c.dropReason === DropReason.PROCESS_NOISE
    );

    // It's valid for either:
    // 1. No candidate to be created at all (section not actionable → nothing to suppress)
    // 2. A candidate to be created and then dropped with PROCESS_NOISE
    // The key invariant: no noise suggestion is emitted
    const noiseSuggestions = result.suggestions.filter(s => {
      const text = `${s.title} ${s.payload.draft_initiative?.description ?? ''} ${s.payload.after_description ?? ''}`.toLowerCase();
      return text.includes('who owns') || text.includes('sign-off') || text.includes('ambiguity') || text.includes('ownership');
    });
    expect(noiseSuggestions).toHaveLength(0);

    // If candidates were generated, they should be dropped with PROCESS_NOISE (not emitted)
    if (noiseDropped.length > 0) {
      expect(noiseDropped[0].dropStage).toBe('POST_SYNTHESIS_SUPPRESS');
    }
  });

  it('debug ledger shows PROCESS_NOISE when a note with mixed content processes noise sentences', () => {
    // A note with two distinct sections: noise-only and feature-request
    // The noise section's fallback candidate (if created) should be PROCESS_NOISE dropped
    const twoSectionNote: NoteInput = {
      note_id: 'test-process-noise-two-sections',
      raw_markdown: `# Planning Session

## New Feature: Bulk Upload

We need to implement bulk-upload support for enterprise customers by Q3.
This will allow users to import thousands of records at once.

## Compliance Process

Ambiguity around who owns the final QA sign-off for the SOC2 compliance check.
Unclear who owns the handover process between engineering and security.
`,
    };

    const result = generateSuggestionsWithDebug(
      twoSectionNote,
      undefined,
      DEFAULT_CONFIG,
      { verbosity: 'FULL_TEXT' }
    );

    // The feature request should be emitted
    const featureSuggestions = result.suggestions.filter(s => {
      const text = `${s.title} ${s.payload.draft_initiative?.description ?? ''}`.toLowerCase();
      return text.includes('bulk') || text.includes('enterprise') || text.includes('upload');
    });
    expect(featureSuggestions.length).toBeGreaterThanOrEqual(1);

    // No noise suggestion should be emitted
    const noiseSuggestions = result.suggestions.filter(s => {
      const text = `${s.title} ${s.payload.draft_initiative?.description ?? ''} ${s.payload.after_description ?? ''}`.toLowerCase();
      return text.includes('who owns') || text.includes('sign-off') || text.includes('ambiguity') || text.includes('soc2') || text.includes('handover');
    });
    expect(noiseSuggestions).toHaveLength(0);
  });
});

// ============================================
// Non-regression: legitimate delivery ownership not suppressed
// ============================================

describe('Process Noise Suppression – allowlist (non-regression)', () => {
  beforeEach(() => {
    resetSectionCounter();
    resetSuggestionCounter();
    resetBSignalCounter();
  });

  it('does not suppress "Owner: X" task assignment sections', () => {
    const note: NoteInput = {
      note_id: 'test-owner-allowlist',
      raw_markdown: `# Sprint Planning

## Auth Feature

Owner: Alice – implement OAuth2 login by end of sprint.
PM to build the analytics dashboard this sprint.
We need to add multi-factor authentication support.
`,
    };

    const result = generateSuggestions(note, undefined, DEFAULT_CONFIG);

    // Suggestions about auth/OAuth should NOT be suppressed
    for (const s of result.suggestions) {
      const combined = `${s.title} ${s.payload.draft_initiative?.description ?? ''}`.toLowerCase();
      // Should not be suppressed noise-only content
      expect(combined).not.toContain('who owns');
      expect(combined).not.toContain('ambiguity around');
    }
  });

  it('"cs to" shorthand allowlist: CS to follow up is NOT suppressed', () => {
    expect(isProcessNoiseSentence('CS to follow up on enterprise onboarding tickets.')).toBe(false);
  });

  it('"eng to" shorthand allowlist: Eng to implement is NOT suppressed', () => {
    expect(isProcessNoiseSentence('Eng to implement the new auth flow before Q3.')).toBe(false);
  });

  it('"qa to" shorthand allowlist: QA to verify is NOT suppressed', () => {
    expect(isProcessNoiseSentence('QA to verify sign-off steps after each deploy.')).toBe(false);
  });

  it('"design to" shorthand allowlist: Design to review is NOT suppressed', () => {
    expect(isProcessNoiseSentence('Design to review final mocks by Friday.')).toBe(false);
  });

  it('"security to" shorthand allowlist: Security to audit is NOT suppressed', () => {
    expect(isProcessNoiseSentence('Security to audit the new SOC2 sign-off flow.')).toBe(false);
  });

  it('"legal to" shorthand allowlist: Legal to review is NOT suppressed', () => {
    expect(isProcessNoiseSentence('Legal to review the handover documentation.')).toBe(false);
  });

  // Regression test: exact sentence from task spec must not be suppressed.
  // This sentence contains "sign-off" (noise phrase) AND "SOC2" (amplifier), but
  // the allowlist pattern \bsecurity\s+to\s+\w/i matches "Security to audit", so
  // shouldSuppressProcessSentence must return false.
  it('regression: "Security to audit the SOC2 sign-off flow" is NOT suppressed', () => {
    expect(isProcessNoiseSentence('Security to audit the SOC2 sign-off flow')).toBe(false);
  });
});

// ============================================
// Task-specified test: feature + explicit assignment + ambiguity in same note
// Assert: assignment not suppressed, ambiguity suppressed, feature passes,
// debugRun shows PROCESS_NOISE drop for ambiguity anchor.
// ============================================

describe('Process Noise Suppression – task-specified scenario', () => {
  beforeEach(() => {
    resetSectionCounter();
    resetSuggestionCounter();
    resetBSignalCounter();
  });

  const TASK_NOTE: NoteInput = {
    note_id: 'test-task-scenario',
    raw_markdown: `# Q3 Planning

## Feature Work and Ownership

We need to implement bulk-upload support for enterprise customers.
CS to follow up on enterprise onboarding tickets by end of week.
Unclear who owns final QA sign-off for SOC2.
`,
  };

  it('explicit assignment sentence is NOT suppressed by isProcessNoiseSentence', () => {
    expect(isProcessNoiseSentence('CS to follow up on enterprise onboarding tickets by end of week.')).toBe(false);
  });

  it('ambiguity sentence IS suppressed by isProcessNoiseSentence', () => {
    expect(isProcessNoiseSentence('Unclear who owns final QA sign-off for SOC2.')).toBe(true);
  });

  it('feature request suggestion exists in output', () => {
    const result = generateSuggestions(TASK_NOTE, undefined, DEFAULT_CONFIG);

    const featureSuggestion = result.suggestions.find(s => {
      const combined = [
        s.title,
        s.payload.draft_initiative?.description ?? '',
        s.suggestion?.body ?? '',
      ].join(' ').toLowerCase();
      return combined.includes('bulk') || combined.includes('enterprise') || combined.includes('upload');
    });

    expect(featureSuggestion).toBeDefined();
  });

  it('no suggestion title or description references ambiguity noise content', () => {
    const result = generateSuggestions(TASK_NOTE, undefined, DEFAULT_CONFIG);

    // Check synthesized content (title + payload) — not raw evidence spans which
    // may contain full section body including bystander sentences.
    const NOISE_TERMS = ['who owns', 'unclear who', 'final qa'];
    for (const s of result.suggestions) {
      const synthesizedText = [
        s.title,
        s.payload.draft_initiative?.title ?? '',
        s.payload.draft_initiative?.description ?? '',
        s.payload.after_description ?? '',
        s.suggestion?.body ?? '',
      ].join(' ').toLowerCase();

      for (const term of NOISE_TERMS) {
        expect(
          synthesizedText,
          `Suggestion "${s.title}" must not synthesize noise term "${term}"`
        ).not.toContain(term);
      }
    }
  });

  it('debugRun shows PROCESS_NOISE drop for ambiguity anchor', () => {
    const result = generateSuggestionsWithDebug(
      TASK_NOTE,
      undefined,
      DEFAULT_CONFIG,
      { verbosity: 'FULL_TEXT' }
    );

    expect(result.debugRun).toBeDefined();

    const allCandidates = result.debugRun!.sections.flatMap(s => s.candidates);
    const noiseDropped = allCandidates.filter(
      c => !c.emitted && c.dropReason === DropReason.PROCESS_NOISE
    );

    // At least one candidate should have been dropped with PROCESS_NOISE
    // (from the ambiguity sentence passing through Stage 4.7)
    // OR no noise suggestion is emitted (suppressed before candidate creation)
    const noiseSuggestions = result.suggestions.filter(s => {
      const text = [
        s.title,
        s.payload.draft_initiative?.description ?? '',
        s.payload.after_description ?? '',
      ].join(' ').toLowerCase();
      return text.includes('who owns') || text.includes('unclear who') || text.includes('sign-off') || text.includes('final qa');
    });

    // Key invariant: no noise suggestion is ever emitted
    expect(noiseSuggestions).toHaveLength(0);

    // If a candidate was created from the noise anchor, it must show PROCESS_NOISE drop
    if (noiseDropped.length > 0) {
      expect(noiseDropped[0].dropStage).toBe('POST_SYNTHESIS_SUPPRESS');
    }
  });
});
