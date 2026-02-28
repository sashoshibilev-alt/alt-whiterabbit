/**
 * Verifies that _sectionMap is not exposed on GeneratorResult or any public output,
 * and that sectionMap derivation is purely local (no cross-run leakage).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  generateSuggestions,
  generateRunResult,
  NoteInput,
} from './index';
import { resetSectionCounter } from './preprocessing';
import { resetSuggestionCounter } from './synthesis';

const ACTIONABLE_NOTE: NoteInput = {
  note_id: 'test-no-sectionmap',
  raw_markdown: `# Q2 Planning

## Launch Customer Analytics

We need to build a customer analytics dashboard to improve retention.

- Track user engagement metrics
- Build cohort analysis
- Set up churn prediction alerts
`,
};

beforeEach(() => {
  resetSectionCounter();
  resetSuggestionCounter();
});

describe('_sectionMap must not leak', () => {
  it('GeneratorResult from generateSuggestions has no _sectionMap property', () => {
    const result = generateSuggestions(ACTIONABLE_NOTE);
    expect(result).not.toHaveProperty('_sectionMap');
  });

  it('RunResult from generateRunResult has no _sectionMap anywhere', () => {
    const run = generateRunResult(ACTIONABLE_NOTE);
    expect(run).not.toHaveProperty('_sectionMap');
    // Also ensure the nested generatorResult (if any) does not expose it
    for (const value of Object.values(run)) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        expect(value).not.toHaveProperty('_sectionMap');
      }
    }
  });
});

describe('sectionMap concurrency safety', () => {
  const NOTE_A: NoteInput = {
    note_id: 'concurrency-a',
    raw_markdown: `# Alpha Project

## Build recommendation engine

We need to build a recommendation engine for personalized content.

- Collaborative filtering
- Content-based filtering
- A/B testing framework
`,
  };

  const NOTE_B: NoteInput = {
    note_id: 'concurrency-b',
    raw_markdown: `# Beta Project

## Migrate to microservices

Plan the migration from monolith to microservices architecture.

- Extract auth service
- Extract payment service
- Set up service mesh
`,
  };

  it('consecutive generateRunResult calls with different notes produce independent results', () => {
    const runA = generateRunResult(NOTE_A);
    const runB = generateRunResult(NOTE_B);

    // Each run must reference its own note
    expect(runA.noteId).toBe('concurrency-a');
    expect(runB.noteId).toBe('concurrency-b');

    // Suggestions must reference their own note_id — no cross-contamination
    for (const s of runA.finalSuggestions) {
      expect(s.note_id).toBe('concurrency-a');
    }
    for (const s of runB.finalSuggestions) {
      expect(s.note_id).toBe('concurrency-b');
    }

    // Section IDs must not overlap between runs
    const sectionIdsA = new Set(runA.finalSuggestions.map(s => s.section_id));
    const sectionIdsB = new Set(runB.finalSuggestions.map(s => s.section_id));
    for (const id of sectionIdsA) {
      expect(sectionIdsB.has(id)).toBe(false);
    }
  });

  it('generateSuggestions standalone does not pollute subsequent generateRunResult', () => {
    // Call generateSuggestions standalone first (should not affect next call)
    generateSuggestions(NOTE_A);

    // Now call generateRunResult with a different note
    const run = generateRunResult(NOTE_B);
    expect(run.noteId).toBe('concurrency-b');
    for (const s of run.finalSuggestions) {
      expect(s.note_id).toBe('concurrency-b');
    }
  });
});
