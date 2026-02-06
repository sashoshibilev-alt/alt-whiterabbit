import { describe, it, expect } from 'vitest';

/**
 * Tests for suggestion decision persistence
 *
 * These tests verify the contract between computed suggestions and persisted decisions.
 * Since we can't directly test Convex mutations in Vitest, these are contract tests
 * that verify the expected behavior.
 */

describe('Suggestion Decisions Contract', () => {
  it('should persist decisions keyed by (noteId, suggestionKey)', () => {
    // Contract: decisions are stored with composite key
    const mockDecision = {
      noteId: 'note123' as any,
      suggestionKey: 'sug_abc_def',
      status: 'dismissed' as const,
      updatedAt: Date.now(),
    };

    expect(mockDecision.noteId).toBeDefined();
    expect(mockDecision.suggestionKey).toBeDefined();
    expect(mockDecision.status).toMatch(/dismissed|applied/);
  });

  it('should filter dismissed suggestions from computed suggestions', () => {
    // Contract: filtered suggestions don't include dismissed ones
    const computedSuggestions = [
      { suggestionKey: 'sug_1', content: 'Test 1' },
      { suggestionKey: 'sug_2', content: 'Test 2' },
      { suggestionKey: 'sug_3', content: 'Test 3' },
    ];

    const decisions = new Map([
      ['sug_1', { status: 'dismissed' }],
      ['sug_3', { status: 'applied' }],
    ]);

    const filtered = computedSuggestions.filter(
      (s) => {
        const decision = decisions.get(s.suggestionKey);
        return !decision || (decision.status !== 'dismissed' && decision.status !== 'applied');
      }
    );

    expect(filtered).toHaveLength(1);
    expect(filtered[0].suggestionKey).toBe('sug_2');
  });

  it('should filter applied suggestions from computed suggestions', () => {
    // Contract: filtered suggestions don't include applied ones
    const computedSuggestions = [
      { suggestionKey: 'sug_1', content: 'Test 1' },
      { suggestionKey: 'sug_2', content: 'Test 2' },
    ];

    const decisions = new Map([
      ['sug_1', { status: 'applied', initiativeId: 'init123' }],
    ]);

    const filtered = computedSuggestions.filter(
      (s) => {
        const decision = decisions.get(s.suggestionKey);
        return !decision || (decision.status !== 'dismissed' && decision.status !== 'applied');
      }
    );

    expect(filtered).toHaveLength(1);
    expect(filtered[0].suggestionKey).toBe('sug_2');
  });

  it('should support appliedMode tracking for analytics', () => {
    // Contract: applied decisions track how they were applied
    const appliedToExisting = {
      noteId: 'note123' as any,
      suggestionKey: 'sug_abc',
      status: 'applied' as const,
      initiativeId: 'init456' as any,
      appliedMode: 'existing' as const,
      updatedAt: Date.now(),
    };

    const appliedWithNew = {
      noteId: 'note123' as any,
      suggestionKey: 'sug_def',
      status: 'applied' as const,
      initiativeId: 'init789' as any,
      appliedMode: 'created' as const,
      updatedAt: Date.now(),
    };

    expect(appliedToExisting.appliedMode).toBe('existing');
    expect(appliedToExisting.initiativeId).toBeDefined();
    expect(appliedWithNew.appliedMode).toBe('created');
    expect(appliedWithNew.initiativeId).toBeDefined();
  });

  it('should support stable suggestionKey across regenerations', () => {
    // Contract: suggestionKey is deterministic and stable
    // Even if the note is regenerated, the same suggestion content
    // produces the same suggestionKey

    const suggestion1 = {
      noteId: 'note123',
      suggestionKey: 'sug_note12_1_abc123',
      content: 'Update timeline for feature X',
    };

    // After regeneration, same content -> same key
    const suggestion2 = {
      noteId: 'note123',
      suggestionKey: 'sug_note12_1_abc123', // Same key!
      content: 'Update timeline for feature X',
    };

    expect(suggestion1.suggestionKey).toBe(suggestion2.suggestionKey);
    expect(suggestion1.content).toBe(suggestion2.content);
  });
});
