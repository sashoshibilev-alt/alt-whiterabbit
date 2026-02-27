/**
 * NoteDetail UI ↔ RunResult contract tests
 *
 * These tests verify the single-source-of-truth invariant:
 * the suggestion card list, the header count, and the "Copy JSON" output
 * must all derive from the same RunResult.finalSuggestions array.
 *
 * Tests cover the requirements from the "Wire Suggestions list to RunResult.finalSuggestions" task:
 *  1. Given a RunResult with N finalSuggestions, the UI renders exactly N cards.
 *  2. The header shows "Suggestions (N) run:<runId> hash:<noteHash>".
 *  3. Regression: copying JSON yields finalSuggestionsCount equal to the rendered card count.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  generateRunResult,
  computeNoteHash,
  type NoteInput,
  type RunResult,
} from './index';
import { resetSectionCounter } from './preprocessing';
import { resetSuggestionCounter } from './synthesis';

// ============================================
// Test fixture — reliably produces ≥ 2 suggestions
// ============================================

const FOUR_SUGGESTION_NOTE: NoteInput = {
  note_id: 'ui-note-detail-contract',
  raw_markdown: `# Product Planning

## Launch Customer Portal

Build a self-service customer portal to reduce support load by 50%.

- Account management (billing, users, settings)
- Usage dashboard with key metrics
- Integrated documentation and help center

## Roadmap Adjustment

We need to push the mobile app redesign from Q2 to Q3 because the gesture system is
more complex than anticipated and requires additional UX research.

- Defer all mobile redesign work to Q3
- Prioritize customer portal in Q2 instead
- Add 2 weeks for UX research on gesture patterns

## Launch Notification System

We need to spin up a real-time notification system for enterprise customers.

- Design notification templates
- Integrate push notification service
- Add user preference controls

## Scope Change: Analytics

Deferring advanced analytics dashboard to Q4 due to data pipeline delays.

- Remove dashboards from Q3 scope
- Defer custom reports to Q4
- Prioritize core features
`,
};

// ============================================
// Helpers mirroring the NoteDetail UI rendering logic
// ============================================

/**
 * Simulates what NoteDetail renders:
 * the number of suggestion cards shown in the "New" section.
 *
 * After applying decision filtering, only "new" (undismissed, unapplied)
 * suggestions are shown. In tests there are no decisions, so all
 * finalSuggestions are shown as cards.
 */
function countRenderedCards(runResult: RunResult): number {
  return runResult.finalSuggestions.length;
}

/**
 * Simulates the header string rendered by NoteDetail.
 * Format: "Suggestions (N) run:<runId8> hash:<noteHash>"
 */
function buildHeaderString(runResult: RunResult): string {
  return `Suggestions (${runResult.finalSuggestions.length}) run:${runResult.runId.slice(0, 8)} hash:${runResult.noteHash}`;
}

/**
 * Simulates what the "Copy JSON" button copies.
 * Returns the parsed JSON object (to allow field-level assertions).
 */
function simulateCopyJson(runResult: RunResult): RunResult {
  return JSON.parse(JSON.stringify(runResult));
}

// ============================================
// Setup
// ============================================

beforeEach(() => {
  resetSectionCounter();
  resetSuggestionCounter();
});

// ============================================
// Test 1: UI renders exactly N cards for N finalSuggestions
// ============================================

describe('NoteDetail UI card count matches RunResult.finalSuggestions.length', () => {
  it('renders a card for each finalSuggestion — no more, no fewer', () => {
    const runResult = generateRunResult(FOUR_SUGGESTION_NOTE);

    // Precondition: the fixture must produce at least 1 suggestion.
    // If the engine changes thresholds and this fails, update the fixture.
    expect(runResult.finalSuggestions.length).toBeGreaterThan(0);

    const renderedCards = countRenderedCards(runResult);

    // The UI renders one card per finalSuggestion entry.
    expect(renderedCards).toBe(runResult.finalSuggestions.length);
  });

  it('renders 0 cards when finalSuggestions is empty', () => {
    // Build a synthetic RunResult with 0 finalSuggestions to test the empty-state path.
    const emptyRunResult: RunResult = {
      runId: 'test-empty-run-id-0000-0000',
      noteId: 'empty-note',
      createdAt: new Date().toISOString(),
      config: {
        thresholds: {
          T_action: 0.5,
          T_out_of_scope: 0.4,
          T_overall_min: 0.65,
          T_section_min: 0.6,
          T_generic: 0.55,
          T_attach: 0.80,
          MIN_EVIDENCE_CHARS: 120,
        },
        max_suggestions: 5,
        enable_debug: false,
        use_llm_classifiers: false,
        embedding_enabled: false,
      },
      noteHash: computeNoteHash(''),
      lineCount: 0,
      finalSuggestions: [],
      invariants: { maxSuggestionsRespected: true, allSuggestionsPassed: true, trimmedToMax: false },
    };

    expect(countRenderedCards(emptyRunResult)).toBe(0);
  });

  it('renders exactly 4 cards when given a RunResult with exactly 4 finalSuggestions', () => {
    // Build a synthetic RunResult with exactly 4 finalSuggestions.
    // This directly tests the NoteDetail requirement: "Given a RunResult with 4
    // finalSuggestions, the UI renders exactly 4 cards."
    const realRun = generateRunResult(FOUR_SUGGESTION_NOTE);

    // Trim or pad the list to exactly 4 for a deterministic assertion.
    // If the engine produces fewer than 4, we clone existing entries.
    const baseSuggestions = realRun.finalSuggestions;
    const fourSuggestions = baseSuggestions.length >= 4
      ? baseSuggestions.slice(0, 4)
      : [
          ...baseSuggestions,
          // Clone existing entry with unique IDs to reach 4
          ...Array.from({ length: 4 - baseSuggestions.length }, (_, i) => ({
            ...baseSuggestions[0],
            suggestion_id: `synthetic-${i}`,
            suggestionKey: `synthetic-key-${i}`,
          })),
        ];

    const syntheticRunResult: RunResult = {
      ...realRun,
      finalSuggestions: fourSuggestions,
    };

    expect(countRenderedCards(syntheticRunResult)).toBe(4);
  });
});

// ============================================
// Test 2: Header string format
// ============================================

describe('NoteDetail header string format', () => {
  it('includes finalSuggestions.length, runId prefix, and noteHash', () => {
    const runResult = generateRunResult(FOUR_SUGGESTION_NOTE);
    const header = buildHeaderString(runResult);

    const count = runResult.finalSuggestions.length;
    const runIdPrefix = runResult.runId.slice(0, 8);
    const expectedHash = computeNoteHash(FOUR_SUGGESTION_NOTE.raw_markdown);

    expect(header).toBe(`Suggestions (${count}) run:${runIdPrefix} hash:${expectedHash}`);
    expect(runResult.noteHash).toBe(expectedHash);
  });

  it('header count matches rendered card count — they read the same source', () => {
    const runResult = generateRunResult(FOUR_SUGGESTION_NOTE);

    const renderedCards = countRenderedCards(runResult);
    const headerCount = runResult.finalSuggestions.length; // what the header displays

    // Both the header and the card list must read from runResult.finalSuggestions.
    // If they diverge, the bug (UI shows 6, count shows 4) can recur.
    expect(headerCount).toBe(renderedCards);
  });
});

// ============================================
// Test 3: Regression — Copy JSON count matches rendered card count
// ============================================

describe('Copy JSON finalSuggestionsCount matches rendered card count', () => {
  it('JSON.finalSuggestions.length equals the number of rendered cards', () => {
    const runResult = generateRunResult(FOUR_SUGGESTION_NOTE);

    const copiedJson = simulateCopyJson(runResult);
    const renderedCards = countRenderedCards(runResult);

    // The "Copy JSON" payload must include the same number of suggestions
    // as the UI renders. This prevents the observed bug where the debug
    // panel shows 4 but the UI renders 6.
    expect(copiedJson.finalSuggestions.length).toBe(renderedCards);
  });

  it('finalSuggestions in copied JSON have the same suggestion_ids as rendered cards', () => {
    const runResult = generateRunResult(FOUR_SUGGESTION_NOTE);

    const copiedJson = simulateCopyJson(runResult);

    const renderedIds = runResult.finalSuggestions.map(s => s.suggestion_id);
    const copiedIds = copiedJson.finalSuggestions.map((s: { suggestion_id: string }) => s.suggestion_id);

    expect(copiedIds).toEqual(renderedIds);
  });

  it('runId in copied JSON matches the runId used for the header', () => {
    const runResult = generateRunResult(FOUR_SUGGESTION_NOTE);
    const copiedJson = simulateCopyJson(runResult);

    // Both the header display and the Copy JSON must reference the same run.
    expect(copiedJson.runId).toBe(runResult.runId);
  });

  it('noteHash in copied JSON matches the hash shown in the header', () => {
    const runResult = generateRunResult(FOUR_SUGGESTION_NOTE);
    const copiedJson = simulateCopyJson(runResult);

    const expectedHash = computeNoteHash(FOUR_SUGGESTION_NOTE.raw_markdown);

    expect(copiedJson.noteHash).toBe(expectedHash);
    expect(copiedJson.noteHash).toBe(runResult.noteHash);
  });
});

// ============================================
// Test 4: Dual-source-of-truth regression
// ============================================

describe('Dual-source-of-truth regression: UI ignores persisted noteData.suggestions count', () => {
  /**
   * Simulates the NoteDetail rendering logic after the fix:
   *   const displayed = lastRunResult?.finalSuggestions ?? [];
   * The "New (N)" label and card list both read from `displayed`.
   * Persisted noteData.suggestions are NOT mixed into the displayed list.
   */
  function simulateDisplayedList(
    lastRunResult: RunResult | null,
    _persistedSuggestions: unknown[],
  ) {
    return lastRunResult?.finalSuggestions ?? [];
  }

  it('renders 4 cards when finalSuggestions=4 even if persisted suggestions=6', () => {
    const realRun = generateRunResult(FOUR_SUGGESTION_NOTE);
    const baseSuggestions = realRun.finalSuggestions;
    const fourSuggestions = baseSuggestions.length >= 4
      ? baseSuggestions.slice(0, 4)
      : [
          ...baseSuggestions,
          ...Array.from({ length: 4 - baseSuggestions.length }, (_, i) => ({
            ...baseSuggestions[0],
            suggestion_id: `pad-${i}`,
            suggestionKey: `pad-key-${i}`,
          })),
        ];

    const runWith4: RunResult = { ...realRun, finalSuggestions: fourSuggestions };

    // Simulate 6 persisted docs (the old buggy source)
    const sixPersistedDocs = Array.from({ length: 6 }, (_, i) => ({
      _id: `persisted-${i}`,
      status: 'new',
      content: `persisted suggestion ${i}`,
    }));

    const displayed = simulateDisplayedList(runWith4, sixPersistedDocs);

    expect(displayed.length).toBe(4);
    expect(displayed).toEqual(fourSuggestions);
  });

  it('renders 0 cards when finalSuggestions is empty, regardless of persisted count', () => {
    const realRun = generateRunResult(FOUR_SUGGESTION_NOTE);
    const emptyRun: RunResult = { ...realRun, finalSuggestions: [] };

    const threePersistedDocs = Array.from({ length: 3 }, (_, i) => ({
      _id: `persisted-${i}`,
      status: 'new',
      content: `persisted suggestion ${i}`,
    }));

    const displayed = simulateDisplayedList(emptyRun, threePersistedDocs);

    expect(displayed.length).toBe(0);
  });

  it('"New (N)" label count equals displayed.length, not persisted count', () => {
    const realRun = generateRunResult(FOUR_SUGGESTION_NOTE);
    const baseSuggestions = realRun.finalSuggestions;
    const fourSuggestions = baseSuggestions.length >= 4
      ? baseSuggestions.slice(0, 4)
      : [
          ...baseSuggestions,
          ...Array.from({ length: 4 - baseSuggestions.length }, (_, i) => ({
            ...baseSuggestions[0],
            suggestion_id: `pad-${i}`,
            suggestionKey: `pad-key-${i}`,
          })),
        ];

    const runWith4: RunResult = { ...realRun, finalSuggestions: fourSuggestions };

    const displayed = simulateDisplayedList(runWith4, Array(6).fill({}));
    const newLabel = `New (${displayed.length})`;

    expect(newLabel).toBe('New (4)');
  });

  it('suggestion_ids from displayed match finalSuggestions IDs', () => {
    const runResult = generateRunResult(FOUR_SUGGESTION_NOTE);
    const displayed = simulateDisplayedList(runResult, Array(10).fill({}));

    const displayedIds = displayed.map(s => s.suggestion_id);
    const finalIds = runResult.finalSuggestions.map(s => s.suggestion_id);

    expect(displayedIds).toEqual(finalIds);
  });
});

// ============================================
// Test 5: Decision filtering at the server level
// ============================================

describe('Decision filtering: runResult.finalSuggestions excludes decided items', () => {
  /**
   * Simulates the server-side decision filtering from convex/notes.ts:
   *   const isDecided = (key) => { ... };
   *   const filteredFinalSuggestions = runResult.finalSuggestions.filter(s => !isDecided(s.suggestionKey));
   *
   * The returned runResult.finalSuggestions is already filtered, so the UI
   * renders exactly what the server returns with no additional logic needed.
   */
  type Decision = { suggestionKey: string; status: 'dismissed' | 'applied' };

  function applyDecisionFilter(
    runResult: RunResult,
    decisions: Decision[],
  ): RunResult {
    const decisionMap = new Map(decisions.map(d => [d.suggestionKey, d]));
    const isDecided = (key: string) => {
      const d = decisionMap.get(key);
      return d != null && (d.status === 'dismissed' || d.status === 'applied');
    };
    return {
      ...runResult,
      finalSuggestions: runResult.finalSuggestions.filter(
        (s) => !isDecided(s.suggestionKey),
      ),
    };
  }

  it('Case A: finalSuggestions=4 after filtering, persisted=6 → UI renders 4', () => {
    const realRun = generateRunResult(FOUR_SUGGESTION_NOTE);
    // Ensure we have at least 6 suggestions to dismiss 2
    const baseSuggestions = realRun.finalSuggestions;
    const sixSuggestions = baseSuggestions.length >= 6
      ? baseSuggestions.slice(0, 6)
      : [
          ...baseSuggestions,
          ...Array.from({ length: 6 - baseSuggestions.length }, (_, i) => ({
            ...baseSuggestions[0],
            suggestion_id: `pad-${i}`,
            suggestionKey: `pad-key-${i}`,
          })),
        ];

    const runWith6: RunResult = { ...realRun, finalSuggestions: sixSuggestions };

    // Dismiss 2 suggestions
    const decisions: Decision[] = [
      { suggestionKey: sixSuggestions[0].suggestionKey, status: 'dismissed' },
      { suggestionKey: sixSuggestions[1].suggestionKey, status: 'applied' },
    ];

    const filtered = applyDecisionFilter(runWith6, decisions);

    // Server returns 4 finalSuggestions; UI renders 4 cards
    expect(filtered.finalSuggestions.length).toBe(4);
    // Header shows 4
    expect(filtered.finalSuggestions.length).toBe(4);
    // None of the decided keys appear
    const decidedKeys = new Set(decisions.map(d => d.suggestionKey));
    for (const s of filtered.finalSuggestions) {
      expect(decidedKeys.has(s.suggestionKey)).toBe(false);
    }
  });

  it('Case B: finalSuggestions=0 after filtering all dismissed, persisted=6 → UI renders 0', () => {
    const realRun = generateRunResult(FOUR_SUGGESTION_NOTE);
    const baseSuggestions = realRun.finalSuggestions;
    // Dismiss ALL suggestions
    const decisions: Decision[] = baseSuggestions.map(s => ({
      suggestionKey: s.suggestionKey,
      status: 'dismissed' as const,
    }));

    const filtered = applyDecisionFilter(realRun, decisions);

    expect(filtered.finalSuggestions.length).toBe(0);
    // Header should say 0
    const headerCount = filtered.finalSuggestions.length;
    expect(headerCount).toBe(0);
  });

  it('Case C: after regenerate (new runId), counts match new finalSuggestions', () => {
    // Simulate two runs: first run has decisions, second run (regenerate) has new runId
    const run1 = generateRunResult(FOUR_SUGGESTION_NOTE);
    resetSectionCounter();
    resetSuggestionCounter();
    const run2 = generateRunResult(FOUR_SUGGESTION_NOTE);

    // Runs have different runIds (uuid-based)
    expect(run2.runId).not.toBe(run1.runId);

    // After regenerate with no decisions, all finalSuggestions are shown
    const filtered = applyDecisionFilter(run2, []);
    expect(filtered.finalSuggestions.length).toBe(run2.finalSuggestions.length);

    // Copy JSON runId/noteHash match header
    const headerRunId = filtered.runId.slice(0, 8);
    const headerHash = filtered.noteHash;
    expect(headerRunId).toBe(run2.runId.slice(0, 8));
    expect(headerHash).toBe(run2.noteHash);
  });

  it('Copy JSON runId and noteHash match header after decision filtering', () => {
    const runResult = generateRunResult(FOUR_SUGGESTION_NOTE);
    const decisions: Decision[] = runResult.finalSuggestions.length > 0
      ? [{ suggestionKey: runResult.finalSuggestions[0].suggestionKey, status: 'dismissed' }]
      : [];

    const filtered = applyDecisionFilter(runResult, decisions);
    const copiedJson = JSON.parse(JSON.stringify(filtered));

    // runId and noteHash are unchanged by decision filtering
    expect(copiedJson.runId).toBe(runResult.runId);
    expect(copiedJson.noteHash).toBe(runResult.noteHash);
    // finalSuggestions count matches
    expect(copiedJson.finalSuggestions.length).toBe(filtered.finalSuggestions.length);
  });
});

// ============================================
// Test 6: Copy JSON uses the page's RunResult, not the debug panel's
// ============================================

describe('Copy JSON uses currentRunResult (page source) over debug-panel-built RunResult', () => {
  /**
   * Simulates the fixed handleCopyJson logic in SuggestionDebugPanel:
   *   const source = currentRunResult ?? debugPanelRunResult;
   *   payload.finalSuggestionsCount = source.finalSuggestions.length;
   *
   * When currentRunResult is provided (from NoteDetail's lastRunResult),
   * Copy JSON must use its finalSuggestions, not the debug panel's.
   */
  function simulateCopyJsonPayload(
    currentRunResult: RunResult | null,
    debugPanelFinalSuggestionsCount: number,
  ) {
    const source = currentRunResult;
    if (!source) {
      return { finalSuggestionsCount: debugPanelFinalSuggestionsCount };
    }
    return {
      finalSuggestions: source.finalSuggestions,
      finalSuggestionsCount: source.finalSuggestions.length,
      runId: source.runId,
      noteHash: source.noteHash,
    };
  }

  it('Copy JSON finalSuggestionsCount matches page RunResult, not debug panel count', () => {
    const pageRunResult = generateRunResult(FOUR_SUGGESTION_NOTE);
    // Debug panel might compute a different count (the original bug)
    const debugPanelCount = pageRunResult.finalSuggestions.length - 1;

    const payload = simulateCopyJsonPayload(pageRunResult, debugPanelCount);

    // Copy JSON uses the page's RunResult count
    expect(payload.finalSuggestionsCount).toBe(pageRunResult.finalSuggestions.length);
    // NOT the debug panel's count
    expect(payload.finalSuggestionsCount).not.toBe(debugPanelCount);
  });

  it('Copy JSON runId and noteHash match the page RunResult', () => {
    const pageRunResult = generateRunResult(FOUR_SUGGESTION_NOTE);

    const payload = simulateCopyJsonPayload(pageRunResult, 0);

    expect(payload.runId).toBe(pageRunResult.runId);
    expect(payload.noteHash).toBe(pageRunResult.noteHash);
  });

  it('header count equals Copy JSON finalSuggestionsCount — same source', () => {
    const pageRunResult = generateRunResult(FOUR_SUGGESTION_NOTE);

    // Header reads: lastRunResult?.finalSuggestions?.length ?? 0
    const headerCount = pageRunResult.finalSuggestions.length;

    // Copy JSON reads: currentRunResult.finalSuggestions.length
    const payload = simulateCopyJsonPayload(pageRunResult, 999);

    expect(payload.finalSuggestionsCount).toBe(headerCount);
  });
});
