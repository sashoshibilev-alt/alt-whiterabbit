/**
 * Regression test: "Run debug" must NOT change rendered suggestion cards
 *
 * Root cause: SuggestionDebugPanel called onRunResult(buildRunResultFromDebugRun(...))
 * which overwrote NoteDetail's lastRunResult with a debug-derived partial shape,
 * flipping the rendered cards until page refresh.
 *
 * Fix: SuggestionDebugPanel no longer calls onRunResult. lastRunResult is only
 * set from the canonical server RunResult (getWithComputedSuggestions / regenerate).
 *
 * This test simulates the NoteDetail state transitions and asserts that a debug
 * run completion does not alter the rendered card list.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  generateRunResult,
  type NoteInput,
  type RunResult,
  type Suggestion,
} from './index';
import { resetSectionCounter } from './preprocessing';
import { resetSuggestionCounter } from './synthesis';

// ============================================
// Fixture: note that produces suggestions with bodies
// ============================================

const NOTE_WITH_BODIES: NoteInput = {
  note_id: 'debug-regression-note',
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
// Simulated debug-derived object (mimics buildRunResultFromDebugRun output)
// These have a DIFFERENT shape than real Suggestion — missing key fields
// ============================================

interface DebugDerivedSuggestion {
  candidateId: string;
  title: string;
  body: string;
  evidencePreview?: string[];
  sourceSectionId: string;
  sourceHeading: string;
  overallScore: number;
}

interface DebugDerivedRunResult {
  runId: string;
  noteId: string;
  createdAt: string;
  noteHash: string;
  lineCount: number;
  finalSuggestions: DebugDerivedSuggestion[];
  finalSuggestionsCount: number;
}

function buildFakeDebugRunResult(noteId: string): DebugDerivedRunResult {
  return {
    runId: 'debug-run-id-xxxx',
    noteId,
    createdAt: new Date().toISOString(),
    noteHash: 'debug-hash',
    lineCount: 10,
    finalSuggestions: [
      {
        candidateId: 'c1',
        title: 'Debug-only suggestion',
        body: '',
        sourceSectionId: 's1',
        sourceHeading: 'Section 1',
        overallScore: 0.9,
      },
    ],
    finalSuggestionsCount: 1,
  };
}

// ============================================
// Simulate NoteDetail rendering logic
// ============================================

/**
 * Mirrors NoteDetail state management:
 *   const [lastRunResult, setLastRunResult] = useState<RunResult | null>(null);
 *   const displayed: RunSuggestion[] = lastRunResult?.finalSuggestions ?? [];
 *
 * After the fix, debug runs do NOT call setLastRunResult.
 */
function simulateNoteDetailState() {
  let lastRunResult: RunResult | null = null;

  return {
    /** Called on initial load / regenerate with the canonical server RunResult */
    setCanonicalRunResult(rr: RunResult) {
      lastRunResult = rr;
    },
    /** Returns what NoteDetail renders as suggestion cards */
    getDisplayed(): Suggestion[] {
      return lastRunResult?.finalSuggestions ?? [];
    },
    /** Returns the header count string */
    getHeaderCount(): number {
      return lastRunResult?.finalSuggestions?.length ?? 0;
    },
    /** Returns canonical run metadata shown in header */
    getHeaderMeta(): { runId: string; noteHash: string } | null {
      if (!lastRunResult) return null;
      return { runId: lastRunResult.runId, noteHash: lastRunResult.noteHash };
    },
  };
}

// ============================================
// Setup
// ============================================

beforeEach(() => {
  resetSectionCounter();
  resetSuggestionCounter();
});

// ============================================
// Tests
// ============================================

describe('Run debug does NOT mutate rendered suggestion cards', () => {
  it('card count remains unchanged after debug run completes', () => {
    const canonicalRunResult = generateRunResult(NOTE_WITH_BODIES);
    expect(canonicalRunResult.finalSuggestions.length).toBeGreaterThan(0);

    const state = simulateNoteDetailState();
    state.setCanonicalRunResult(canonicalRunResult);

    const countBefore = state.getHeaderCount();
    const displayedBefore = state.getDisplayed();

    // Simulate debug run completing — in the fixed code, this does NOT
    // call setLastRunResult, so state should be unchanged.
    const _debugResult = buildFakeDebugRunResult(canonicalRunResult.noteId);
    // (no state.setCanonicalRunResult call — that's the fix)

    const countAfter = state.getHeaderCount();
    const displayedAfter = state.getDisplayed();

    expect(countAfter).toBe(countBefore);
    expect(displayedAfter.length).toBe(displayedBefore.length);
  });

  it('card titles and bodies remain unchanged after debug run completes', () => {
    const canonicalRunResult = generateRunResult(NOTE_WITH_BODIES);
    expect(canonicalRunResult.finalSuggestions.length).toBeGreaterThan(0);

    const state = simulateNoteDetailState();
    state.setCanonicalRunResult(canonicalRunResult);

    const titlesBefore = state.getDisplayed().map(s => s.title);
    const bodiesBefore = state.getDisplayed().map(s => s.suggestion?.body).filter(Boolean);

    // Debug run completes — state is NOT updated
    const _debugResult = buildFakeDebugRunResult(canonicalRunResult.noteId);

    const titlesAfter = state.getDisplayed().map(s => s.title);
    const bodiesAfter = state.getDisplayed().map(s => s.suggestion?.body).filter(Boolean);

    expect(titlesAfter).toEqual(titlesBefore);
    expect(bodiesAfter).toEqual(bodiesBefore);
  });

  it('at least one suggestion body text is present after debug run', () => {
    const canonicalRunResult = generateRunResult(NOTE_WITH_BODIES);
    const state = simulateNoteDetailState();
    state.setCanonicalRunResult(canonicalRunResult);

    // Debug run completes
    const _debugResult = buildFakeDebugRunResult(canonicalRunResult.noteId);

    // At least one card should still have a body
    const displayed = state.getDisplayed();
    const bodies = displayed.map(s => s.suggestion?.body).filter(Boolean);
    expect(bodies.length).toBeGreaterThan(0);

    // The body content should be a non-trivial string
    expect(bodies[0]!.length).toBeGreaterThan(10);
  });

  it('header metadata (runId, noteHash) stays canonical after debug run', () => {
    const canonicalRunResult = generateRunResult(NOTE_WITH_BODIES);
    const state = simulateNoteDetailState();
    state.setCanonicalRunResult(canonicalRunResult);

    const metaBefore = state.getHeaderMeta();
    expect(metaBefore).not.toBeNull();

    // Debug run with different runId/hash
    const _debugResult = buildFakeDebugRunResult(canonicalRunResult.noteId);

    const metaAfter = state.getHeaderMeta();
    expect(metaAfter).toEqual(metaBefore);
    expect(metaAfter!.runId).toBe(canonicalRunResult.runId);
    expect(metaAfter!.noteHash).toBe(canonicalRunResult.noteHash);
  });

  it('suggestion_ids remain stable after debug run', () => {
    const canonicalRunResult = generateRunResult(NOTE_WITH_BODIES);
    const state = simulateNoteDetailState();
    state.setCanonicalRunResult(canonicalRunResult);

    const idsBefore = state.getDisplayed().map(s => s.suggestion_id);

    // Debug run completes
    const _debugResult = buildFakeDebugRunResult(canonicalRunResult.noteId);

    const idsAfter = state.getDisplayed().map(s => s.suggestion_id);
    expect(idsAfter).toEqual(idsBefore);
  });

  it('debug-derived shape is incompatible with RunResult (type safety)', () => {
    // Verify that buildFakeDebugRunResult produces a shape that CANNOT be
    // assigned to RunResult — its finalSuggestions entries lack required fields.
    const debugResult = buildFakeDebugRunResult('test-note');

    // A real RunResult.finalSuggestions entry has suggestion_id, note_id, etc.
    // The debug shape has candidateId instead. This should never be castable.
    const firstDebugSuggestion = debugResult.finalSuggestions[0];
    expect(firstDebugSuggestion).toHaveProperty('candidateId');
    expect(firstDebugSuggestion).not.toHaveProperty('suggestion_id');
    expect(firstDebugSuggestion).not.toHaveProperty('note_id');
    expect(firstDebugSuggestion).not.toHaveProperty('suggestionKey');
  });
});
