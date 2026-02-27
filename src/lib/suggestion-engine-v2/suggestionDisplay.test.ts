/**
 * Tests for suggestion display helpers: type prefixes and title cleanup.
 *
 * Covers:
 *  1. getTypePrefix returns correct prefix for each SuggestionType
 *  2. stripLegacyPrefix removes "Add Update:", "Add idea:", etc.
 *  3. Combined: no duplicated prefix like "Update: Add Update: …"
 *  4. Integration: given a Suggestion with type, display title is correctly formatted
 */

import { describe, it, expect } from 'vitest';
import { getTypePrefix, stripLegacyPrefix } from './suggestionDisplay';
import type { SuggestionType } from './types';

// ============================================
// 1. getTypePrefix
// ============================================

describe('getTypePrefix', () => {
  it('returns "Idea" for type "idea"', () => {
    expect(getTypePrefix('idea')).toBe('Idea');
  });

  it('returns "Update" for type "project_update"', () => {
    expect(getTypePrefix('project_update')).toBe('Update');
  });

  it('returns "Risk" for type "risk"', () => {
    expect(getTypePrefix('risk')).toBe('Risk');
  });

  it('returns "Bug" for type "bug"', () => {
    expect(getTypePrefix('bug')).toBe('Bug');
  });

  it('returns undefined for undefined type', () => {
    expect(getTypePrefix(undefined)).toBeUndefined();
  });
});

// ============================================
// 2. stripLegacyPrefix
// ============================================

describe('stripLegacyPrefix', () => {
  it('strips "Add Update: " from title', () => {
    expect(stripLegacyPrefix('Add Update: Defer mobile redesign')).toBe(
      'Defer mobile redesign',
    );
  });

  it('strips "Add idea: " (lowercase) from title', () => {
    expect(stripLegacyPrefix('Add idea: Customer portal')).toBe(
      'Customer portal',
    );
  });

  it('strips "Add Idea: " (capitalized) from title', () => {
    expect(stripLegacyPrefix('Add Idea: Customer portal')).toBe(
      'Customer portal',
    );
  });

  it('strips "Add Risk: " from title', () => {
    expect(stripLegacyPrefix('Add Risk: Data pipeline delays')).toBe(
      'Data pipeline delays',
    );
  });

  it('strips "Add Bug: " from title', () => {
    expect(stripLegacyPrefix('Add Bug: Login crash')).toBe('Login crash');
  });

  it('leaves titles without legacy prefix unchanged', () => {
    expect(stripLegacyPrefix('Defer mobile redesign')).toBe(
      'Defer mobile redesign',
    );
  });

  it('does not strip "Add" in the middle of a title', () => {
    expect(stripLegacyPrefix('We should Add Update to the plan')).toBe(
      'We should Add Update to the plan',
    );
  });

  // Bare engine-generated type prefix stripping
  it('strips bare "Idea: " prefix from engine title', () => {
    expect(stripLegacyPrefix('Idea: Gamify data collection (next-field rewards)')).toBe(
      'Gamify data collection (next-field rewards)',
    );
  });

  it('strips bare "Update: " prefix from engine title', () => {
    expect(stripLegacyPrefix('Update: Defer mobile redesign')).toBe(
      'Defer mobile redesign',
    );
  });

  it('strips bare "Risk: " prefix from engine title', () => {
    expect(stripLegacyPrefix('Risk: Data pipeline risk')).toBe(
      'Data pipeline risk',
    );
  });

  it('strips bare "Bug: " prefix from engine title', () => {
    expect(stripLegacyPrefix('Bug: Login crash')).toBe('Login crash');
  });

  it('strips both "Add Idea: " and bare "Idea: " in chained case', () => {
    // Edge case: "Add Idea: Idea: X" should become "X"
    expect(stripLegacyPrefix('Add Idea: Idea: Double prefix')).toBe(
      'Double prefix',
    );
  });
});

// ============================================
// 3. No duplicated prefix
// ============================================

describe('No duplicated prefix when type + legacy title', () => {
  it('type=project_update with legacy "Add Update:" title produces "Update: Defer mobile redesign"', () => {
    const type: SuggestionType = 'project_update';
    const rawTitle = 'Add Update: Defer mobile redesign';

    const prefix = getTypePrefix(type);
    const cleanTitle = stripLegacyPrefix(rawTitle);
    const displayed = `${prefix}: ${cleanTitle}`;

    expect(displayed).toBe('Update: Defer mobile redesign');
    // Must NOT contain "Update: Add Update:"
    expect(displayed).not.toContain('Add Update:');
  });

  it('type=idea with legacy "Add idea:" title produces "Idea: Customer portal"', () => {
    const type: SuggestionType = 'idea';
    const rawTitle = 'Add idea: Customer portal';

    const prefix = getTypePrefix(type);
    const cleanTitle = stripLegacyPrefix(rawTitle);
    const displayed = `${prefix}: ${cleanTitle}`;

    expect(displayed).toBe('Idea: Customer portal');
    expect(displayed).not.toContain('Add idea:');
  });

  it('type=idea with clean title produces "Idea: Customer portal" (no double prefix)', () => {
    const type: SuggestionType = 'idea';
    const rawTitle = 'Customer portal';

    const prefix = getTypePrefix(type);
    const cleanTitle = stripLegacyPrefix(rawTitle);
    const displayed = `${prefix}: ${cleanTitle}`;

    expect(displayed).toBe('Idea: Customer portal');
  });
});

// ============================================
// 4. Integration: simulating NoteDetail rendering
// ============================================

describe('Integration: NoteDetail rendering simulation', () => {
  /**
   * Simulates the NoteDetail card rendering logic:
   *   const rawTitle = suggestion.suggestion?.title || suggestion.title;
   *   const displayTitle = stripLegacyPrefix(rawTitle);
   *   const typePrefix = getTypePrefix(suggestion.type);
   *   rendered = typePrefix ? `${typePrefix}: ${displayTitle}` : displayTitle;
   */
  function renderCardTitle(suggestion: {
    type?: SuggestionType;
    title: string;
    suggestion?: { title: string };
  }): string {
    const rawTitle = suggestion.suggestion?.title || suggestion.title;
    const displayTitle = stripLegacyPrefix(rawTitle);
    const typePrefix = getTypePrefix(suggestion.type);
    return typePrefix ? `${typePrefix}: ${displayTitle}` : displayTitle;
  }

  it('suggestion with type=idea renders "Idea: …" prefix', () => {
    const result = renderCardTitle({
      type: 'idea',
      title: 'Launch customer portal',
    });
    expect(result).toBe('Idea: Launch customer portal');
  });

  it('suggestion with type=project_update renders "Update: …" prefix', () => {
    const result = renderCardTitle({
      type: 'project_update',
      title: 'Defer mobile redesign to Q3',
    });
    expect(result).toBe('Update: Defer mobile redesign to Q3');
  });

  it('suggestion with type=risk renders "Risk: …" prefix', () => {
    const result = renderCardTitle({
      type: 'risk',
      title: 'Data pipeline delays',
    });
    expect(result).toBe('Risk: Data pipeline delays');
  });

  it('suggestion without type renders title without prefix', () => {
    const result = renderCardTitle({
      type: undefined,
      title: 'Some suggestion',
    });
    expect(result).toBe('Some suggestion');
  });

  it('suggestion with type and legacy prefix does not duplicate', () => {
    const result = renderCardTitle({
      type: 'project_update',
      title: 'Add Update: Defer mobile redesign',
    });
    expect(result).toBe('Update: Defer mobile redesign');
  });

  it('prefers suggestion.suggestion.title over suggestion.title', () => {
    const result = renderCardTitle({
      type: 'idea',
      title: 'Fallback title',
      suggestion: { title: 'Preferred title' },
    });
    expect(result).toBe('Idea: Preferred title');
  });
});
