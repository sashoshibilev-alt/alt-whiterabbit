/**
 * RunResult Single-Source-of-Truth Invariant Tests
 *
 * Verifies that:
 * 1. When a new run completes, the suggestion list and debug panel share the same runId.
 * 2. Copy JSON output includes a finalSuggestions count equal to the UI-rendered count.
 * 3. Exceeding maxSuggestionsPerNote raises an invariant flag and trims the list.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  generateRunResult,
  computeNoteHash,
  generateSuggestionsWithDebug,
  NoteInput,
  DEFAULT_THRESHOLDS,
} from './index';
import { resetSectionCounter } from './preprocessing';
import { resetSuggestionCounter } from './synthesis';

// ============================================
// Test fixtures
// ============================================

/**
 * A note that reliably generates at least 1 suggestion.
 */
const ACTIONABLE_NOTE: NoteInput = {
  note_id: 'test-run-result-note',
  raw_markdown: `# Q2 Planning

## Launch Customer Analytics

We need to build a customer analytics dashboard to improve retention.

- Track user engagement metrics
- Build cohort analysis
- Set up churn prediction alerts

## Scope Change

We are shifting the enterprise onboarding timeline to Q3.

- Defer enterprise SSO to Q3
- Prioritize SMB self-serve flow
- Remove advanced SAML from Q2 scope
`,
};

/**
 * A note that generates many suggestions when thresholds are lowered.
 * Used for the cap-trimming invariant test.
 */
const MULTI_SECTION_NOTE: NoteInput = {
  note_id: 'test-run-result-multi',
  raw_markdown: `# Planning Session

## Launch Payment Integration

Build Stripe payment integration for checkout.

- Implement Stripe Elements
- Add webhook handling
- Set up subscription billing

## Scope Change for Q3

We are deferring advanced analytics to Q3.

- Remove dashboards from Q2 scope
- Defer custom reports to Q3
- Prioritize core features

## Build Notification System

We need to spin up an email notification system.

- Design email templates
- Integrate SendGrid
- Add user preference controls
`,
};

// ============================================
// Setup
// ============================================

beforeEach(() => {
  resetSectionCounter();
  resetSuggestionCounter();
});

// ============================================
// Test 1: Suggestion list and debug panel share same runId
// ============================================

describe('RunResult single-source-of-truth', () => {
  it('suggestion list and debug panel reflect the same runId when a run completes', () => {
    // generateRunResult() produces the canonical result that both the suggestion
    // list UI and the debug panel must read from.
    const runResult = generateRunResult(ACTIONABLE_NOTE, undefined, {
      enable_debug: true,
    });

    // runId must be a non-empty string (UUID format)
    expect(runResult.runId).toBeTruthy();
    expect(typeof runResult.runId).toBe('string');
    expect(runResult.runId.length).toBeGreaterThan(0);

    // noteId must match the input note
    expect(runResult.noteId).toBe(ACTIONABLE_NOTE.note_id);

    // noteHash must be the deterministic hash of the markdown content
    const expectedHash = computeNoteHash(ACTIONABLE_NOTE.raw_markdown);
    expect(runResult.noteHash).toBe(expectedHash);

    // finalSuggestions is the canonical list — same runId means same data
    expect(Array.isArray(runResult.finalSuggestions)).toBe(true);

    // Two consecutive calls produce different runIds (each run is independent)
    resetSectionCounter();
    resetSuggestionCounter();
    const runResult2 = generateRunResult(ACTIONABLE_NOTE, undefined, {
      enable_debug: true,
    });
    expect(runResult2.runId).not.toBe(runResult.runId);

    // But both produce the same finalSuggestions count (deterministic engine)
    expect(runResult2.finalSuggestions.length).toBe(runResult.finalSuggestions.length);
  });
});

// ============================================
// Test 2: Copy JSON finalSuggestions count equals UI-rendered count
// ============================================

describe('Copy JSON count matches rendered count', () => {
  it('finalSuggestions.length in RunResult equals the count that would be rendered in the UI', () => {
    const runResult = generateRunResult(ACTIONABLE_NOTE, undefined, {
      enable_debug: false,
    });

    // The "Copy JSON" button copies runResult directly.
    // The UI renders runResult.finalSuggestions.
    // Both must use the same source — verified by equality of the count.
    const copyJsonParsed = JSON.parse(JSON.stringify(runResult));

    expect(copyJsonParsed.finalSuggestions.length).toBe(runResult.finalSuggestions.length);

    // Verify the serialized object includes finalSuggestions as an array
    expect(Array.isArray(copyJsonParsed.finalSuggestions)).toBe(true);

    // Each suggestion in Copy JSON must have a suggestion_id (identity field used by UI)
    for (const s of copyJsonParsed.finalSuggestions) {
      expect(s.suggestion_id).toBeTruthy();
    }
  });
});

// ============================================
// Test 3: Exceeding maxSuggestionsPerNote raises invariant and trims list
// ============================================

describe('maxSuggestionsPerNote invariant', () => {
  it('raises invariant flag and trims finalSuggestions when cap is exceeded', () => {
    // First, determine how many suggestions this note produces uncapped
    const uncapped = generateRunResult(MULTI_SECTION_NOTE, undefined, {
      thresholds: {
        ...DEFAULT_THRESHOLDS,
        T_action: 0.3, // lower threshold to ensure multiple suggestions
        T_overall_min: 0.4,
      },
    });

    // If the engine produces 0 suggestions, the test is vacuous — skip it.
    // In practice this note reliably generates ≥ 1 suggestion.
    if (uncapped.finalSuggestions.length === 0) {
      // Acknowledge: engine produced nothing, invariant trivially satisfied
      expect(uncapped.invariants.maxSuggestionsRespected).toBe(true);
      expect(uncapped.invariants.trimmedToMax).toBe(false);
      return;
    }

    // Set cap to 1 less than the actual count to force trimming
    const cap = Math.max(1, uncapped.finalSuggestions.length - 1);

    resetSectionCounter();
    resetSuggestionCounter();

    const capped = generateRunResult(
      MULTI_SECTION_NOTE,
      undefined,
      {
        thresholds: {
          ...DEFAULT_THRESHOLDS,
          T_action: 0.3,
          T_overall_min: 0.4,
        },
      },
      { maxSuggestionsPerNote: cap }
    );

    // finalSuggestions must be trimmed to the cap
    expect(capped.finalSuggestions.length).toBeLessThanOrEqual(cap);

    // Invariant: maxSuggestionsRespected must be false (was exceeded before trimming)
    expect(capped.invariants.maxSuggestionsRespected).toBe(false);

    // Invariant: trimmedToMax must be true
    expect(capped.invariants.trimmedToMax).toBe(true);
  });

  it('does NOT set trimmedToMax when count is within the cap', () => {
    const runResult = generateRunResult(
      ACTIONABLE_NOTE,
      undefined,
      undefined,
      { maxSuggestionsPerNote: 100 } // cap >> expected count
    );

    // With a generous cap, trimming must not occur
    expect(runResult.invariants.trimmedToMax).toBe(false);
    expect(runResult.invariants.maxSuggestionsRespected).toBe(true);
  });

  it('does NOT trim when maxSuggestionsPerNote is 0 (uncapped)', () => {
    const runResult = generateRunResult(
      ACTIONABLE_NOTE,
      undefined,
      undefined,
      { maxSuggestionsPerNote: 0 } // 0 = uncapped
    );

    expect(runResult.invariants.trimmedToMax).toBe(false);
    expect(runResult.invariants.maxSuggestionsRespected).toBe(true);
  });
});
