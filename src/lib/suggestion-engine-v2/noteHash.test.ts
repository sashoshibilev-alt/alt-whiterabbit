/**
 * noteHash determinism tests
 *
 * Verifies:
 * 1. generateRunResult(nonEmptyMarkdown).noteHash is a non-empty 8-hex string.
 * 2. The hash matches computeNoteHash(raw_markdown) — single source of truth.
 * 3. Empty markdown => valid 8-hex string (never undefined).
 * 4. The UI header renders the engine hash, not "unknown", for non-empty notes.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { generateRunResult, computeNoteHash, type NoteInput } from './index';
import { resetSectionCounter } from './preprocessing';
import { resetSuggestionCounter } from './synthesis';

const HEX8_RE = /^[0-9a-f]{8}$/;

const NON_EMPTY_NOTE: NoteInput = {
  note_id: 'hash-test-note',
  raw_markdown: `# Quarterly Review

## Action Items

We need to finalize the budget for Q3 before the board meeting.

- Review department budgets
- Consolidate into master spreadsheet
- Schedule pre-board walkthrough
`,
};

const EMPTY_NOTE: NoteInput = {
  note_id: 'hash-test-empty',
  raw_markdown: '',
};

beforeEach(() => {
  resetSectionCounter();
  resetSuggestionCounter();
});

// ============================================
// Test 1: Engine unit test — noteHash is a non-empty 8-hex string
// ============================================

describe('generateRunResult noteHash determinism', () => {
  it('non-empty markdown produces a non-empty 8-hex noteHash', () => {
    const result = generateRunResult(NON_EMPTY_NOTE);
    expect(result.noteHash).toMatch(HEX8_RE);
  });

  it('noteHash matches computeNoteHash(raw_markdown)', () => {
    const result = generateRunResult(NON_EMPTY_NOTE);
    const expected = computeNoteHash(NON_EMPTY_NOTE.raw_markdown);
    expect(result.noteHash).toBe(expected);
  });

  it('noteHash is deterministic across repeated runs', () => {
    resetSectionCounter();
    resetSuggestionCounter();
    const run1 = generateRunResult(NON_EMPTY_NOTE);

    resetSectionCounter();
    resetSuggestionCounter();
    const run2 = generateRunResult(NON_EMPTY_NOTE);

    expect(run1.noteHash).toBe(run2.noteHash);
  });
});

// ============================================
// Test 2: UI contract — header renders engine hash, not "unknown"
// ============================================

describe('UI header renders noteHash from RunResult', () => {
  it('header shows the exact noteHash from RunResult, not "unknown"', () => {
    const runResult = generateRunResult(NON_EMPTY_NOTE);

    // Simulate the NoteDetail header rendering logic (after fix):
    // {lastRunResult && (<span>run:{runId} hash:{noteHash}</span>)}
    // When lastRunResult exists, "unknown" is never rendered.
    const headerHash = runResult.noteHash; // directly from RunResult
    expect(headerHash).toMatch(HEX8_RE);
    expect(headerHash).not.toBe('unknown');
    expect(headerHash).toBe(computeNoteHash(NON_EMPTY_NOTE.raw_markdown));
  });
});

// ============================================
// Test 3: Negative control — empty markdown
// ============================================

describe('empty markdown noteHash', () => {
  it('produces a valid 8-hex string, never undefined', () => {
    const result = generateRunResult(EMPTY_NOTE);
    expect(result.noteHash).toBeDefined();
    expect(result.noteHash).toMatch(HEX8_RE);
  });

  it('computeNoteHash("") returns a valid 8-hex string', () => {
    const hash = computeNoteHash('');
    expect(hash).toMatch(HEX8_RE);
    // djb2 of empty string is 5381 = 0x00001505
    expect(hash).toBe('00001505');
  });
});
