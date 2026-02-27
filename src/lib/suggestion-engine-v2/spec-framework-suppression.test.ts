/**
 * Spec / Framework Suppression, Automation Multi-Bullet, Gamification Cluster Tests
 *
 * Fix 1: isSpecOrFrameworkSection suppresses project_update for spec/framework sections.
 * Fix 2: Automation heading with >=2 bullets emits one multi-bullet Idea.
 * Fix 3: Gamification section with >=4 bullets uses cluster-level title+body.
 */

import { describe, it, expect } from 'vitest';
import { generateSuggestions, generateRunResult } from './index';
import { isSpecOrFrameworkSection } from './classifiers';
import { getTypePrefix, stripLegacyPrefix } from './suggestionDisplay';
import type { NoteInput } from './types';

// ============================================
// Unit tests: isSpecOrFrameworkSection
// ============================================

describe('isSpecOrFrameworkSection', () => {
  it('returns true for section containing "scoring" and "framework" with no timeline', () => {
    expect(
      isSpecOrFrameworkSection(
        'Three-factor scoring: evaluate each claim using data quality',
        4,
        'Black Box Prioritization System'
      )
    ).toBe(true);
  });

  it('returns true for section with "eligibility" and "weighting"', () => {
    expect(
      isSpecOrFrameworkSection(
        'Eligibility criteria with weighting factors for each dimension',
        3,
        'Claim Assessment Framework'
      )
    ).toBe(true);
  });

  it('returns true for section with "additionality" in body', () => {
    expect(
      isSpecOrFrameworkSection(
        'Apply additionality scoring to distinguish new mitigation',
        3,
        'Black Box Prioritization System'
      )
    ).toBe(true);
  });

  it('returns false when section contains "deploy" (timeline token)', () => {
    expect(
      isSpecOrFrameworkSection(
        'Deploy the scoring framework by end of quarter',
        4,
        'Scoring Framework'
      )
    ).toBe(false);
  });

  it('returns false when section contains "launched" (timeline token)', () => {
    expect(
      isSpecOrFrameworkSection(
        'The scoring system was launched last week',
        3,
        'Scoring System'
      )
    ).toBe(false);
  });

  it('returns false when section contains "in progress" (status token)', () => {
    expect(
      isSpecOrFrameworkSection(
        'Framework design is in progress',
        3,
        'Framework Design'
      )
    ).toBe(false);
  });

  it('returns false when no spec/framework tokens present', () => {
    expect(
      isSpecOrFrameworkSection(
        'We need to hire two more engineers for the team',
        2,
        'Team Growth'
      )
    ).toBe(false);
  });
});

// ============================================
// Fix 1 Integration: Black Box produces Idea only (no Update)
// ============================================

describe('Black Box Prioritization System produces Idea only (no Update)', () => {
  const NOTE: NoteInput = {
    note_id: 'test-bbox-spec-suppress',
    raw_markdown: `
### Black Box Prioritization System

- Three-factor scoring: evaluate each claim using data quality, source reliability, and verification status
- Additionality extension: apply additionality scoring to distinguish new mitigation from business-as-usual
- Eligibility weighting: weight eligibility criteria based on regional factors and historical accuracy
- Carbon accuracy layer: layer in third-party audits to improve measurement accuracy and reduce fraud
`.trim(),
  };

  it('emits at least one idea suggestion', () => {
    const result = generateSuggestions(NOTE);
    const ideas = result.suggestions.filter(s => s.type === 'idea');
    expect(
      ideas.length,
      `Expected >=1 idea, got: ${result.suggestions.map(s => `${s.type}: ${s.title}`).join(', ')}`
    ).toBeGreaterThanOrEqual(1);
  });

  it('does NOT emit any project_update suggestion', () => {
    const result = generateSuggestions(NOTE);
    const updates = result.suggestions.filter(s => s.type === 'project_update');
    expect(
      updates.length,
      `Unexpected project_updates: ${updates.map(s => s.title).join(', ')}`
    ).toBe(0);
  });
});

// ============================================
// Fix 2 Integration: Data Collection Automation produces one multi-bullet Idea
// ============================================

describe('Data Collection Automation produces one Idea with multi-bullet body', () => {
  const NOTE: NoteInput = {
    note_id: 'test-dca-multibullet',
    raw_markdown: `
### Data Collection Automation

- AI label parsing: use computer vision to extract NPK values from fertilizer bag photos
- Photo upload pipeline: let farmers photograph receipts and field labels for automatic data entry
- Webhook integration: receive real-time transactions from partner platforms and normalize them
- Reconciliation engine: automatically match incoming records against existing ledger entries
`.trim(),
  };

  it('emits at least one idea suggestion', () => {
    const result = generateSuggestions(NOTE);
    const ideas = result.suggestions.filter(s => s.type === 'idea');
    expect(
      ideas.length,
      `Expected >=1 idea, got: ${result.suggestions.map(s => `${s.type}: ${s.title}`).join(', ')}`
    ).toBeGreaterThanOrEqual(1);
  });

  it('idea body contains BOTH "label parsing" and "photo upload"', () => {
    const result = generateSuggestions(NOTE);
    const ideas = result.suggestions.filter(s => s.type === 'idea');
    expect(ideas.length).toBeGreaterThanOrEqual(1);

    // Check the body of the first idea or any idea for both terms
    const anyBodyContainsBoth = ideas.some(idea => {
      const body = (idea.suggestion?.body ?? '').toLowerCase();
      const desc = (idea.payload.draft_initiative?.description ?? '').toLowerCase();
      const combined = body + ' ' + desc;
      return combined.includes('label parsing') && combined.includes('photo upload');
    });
    expect(
      anyBodyContainsBoth,
      `Expected body to contain both "label parsing" and "photo upload". Bodies: ${ideas.map(i => i.suggestion?.body?.slice(0, 100)).join(' | ')}`
    ).toBe(true);
  });
});

// ============================================
// Fix 3 Integration: Agatha Gamification cluster-based synthesis
// ============================================

describe('Agatha Gamification cluster-based synthesis', () => {
  const NOTE: NoteInput = {
    note_id: 'test-agatha-gamification-cluster',
    raw_markdown: `
### Agatha Gamification Strategy

- Netflix-style "next episode" hook: after completing one field, immediately show the next highest-value field
- Show earning potential: display "this field is worth €300 in carbon credits, takes 2 minutes"
- "One more" nudge: after completing a batch, prompt with "just one more — the next field is 3 minutes away"
- Progress streaks: reward consecutive-day data entry with streak badges and bonus credit multipliers
- Social proof: show how many nearby farmers completed their fields this week
`.trim(),
  };

  it('emits at least one idea suggestion', () => {
    const result = generateSuggestions(NOTE);
    const ideas = result.suggestions.filter(s => s.type === 'idea');
    expect(
      ideas.length,
      `Expected >=1 idea, got: ${result.suggestions.map(s => `${s.type}: ${s.title}`).join(', ')}`
    ).toBeGreaterThanOrEqual(1);
  });

  it('title contains "Gamify" or cluster-level synthesis (not just "Streamline")', () => {
    const result = generateSuggestions(NOTE);
    const ideas = result.suggestions.filter(s => s.type === 'idea');
    expect(ideas.length).toBeGreaterThanOrEqual(1);

    const hasClusterTitle = ideas.some(idea => {
      const lower = idea.title.toLowerCase();
      return lower.includes('gamif') || lower.includes('next-field') || lower.includes('reward');
    });
    expect(
      hasClusterTitle,
      `Expected cluster-level title with "gamif" or "next-field" or "reward". Titles: ${ideas.map(i => i.title).join(', ')}`
    ).toBe(true);
  });

  it('body references multiple bullets (contains both "€" and at least one of "next highest-value field" or "one more")', () => {
    const result = generateSuggestions(NOTE);
    const ideas = result.suggestions.filter(s => s.type === 'idea');
    expect(ideas.length).toBeGreaterThanOrEqual(1);

    const anyBodyRefsMultiple = ideas.some(idea => {
      const body = (idea.suggestion?.body ?? '').toLowerCase();
      const desc = (idea.payload.draft_initiative?.description ?? '').toLowerCase();
      const combined = body + ' ' + desc;
      const hasEuro = combined.includes('€');
      const hasNextField = combined.includes('next highest-value field') || combined.includes('one more');
      return hasEuro && hasNextField;
    });
    expect(
      anyBodyRefsMultiple,
      `Expected body to reference multiple bullets. Bodies: ${ideas.map(i => (i.suggestion?.body ?? '').slice(0, 120)).join(' | ')}`
    ).toBe(true);
  });
});

// ============================================
// Final-emission enforcement integration test (generateRunResult)
// ============================================

describe('Final-emission enforcement via generateRunResult', () => {
  const NOTE: NoteInput = {
    note_id: 'test-final-emission',
    raw_markdown: [
      '### Black Box Prioritization System',
      '',
      '- Three-factor scoring: evaluate each claim using data quality, source reliability, and verification status',
      '- Additionality extension: apply additionality scoring to distinguish new mitigation from business-as-usual',
      '- Eligibility weighting: weight eligibility criteria based on regional factors and historical accuracy',
      '- Carbon accuracy layer: layer in third-party audits to improve measurement accuracy and reduce fraud',
      '',
      '### Agatha Gamification Strategy',
      '',
      '- Netflix-style "next episode" hook: after completing one field, immediately show the next highest-value field',
      '- Show earning potential: display "this field is worth €300 in carbon credits, takes 2 minutes"',
      '- "One more" nudge: after completing a batch, prompt with "just one more — the next field is 3 minutes away"',
      '- Progress streaks: reward consecutive-day data entry with streak badges and bonus credit multipliers',
      '- Social proof: show how many nearby farmers completed their fields this week',
      '',
      '### Data Collection Automation',
      '',
      '- AI label parsing: use computer vision to extract NPK values from fertilizer bag photos',
      '- Photo upload pipeline: let farmers photograph receipts and field labels for automatic data entry',
      '- Webhook integration: receive real-time transactions from partner platforms and normalize them',
      '- Reconciliation engine: automatically match incoming records against existing ledger entries',
    ].join('\n'),
  };

  it('Black Box produces only idea suggestions (no project_update)', () => {
    const result = generateRunResult(NOTE, undefined, { enable_debug: true }, { applyAnyway: true });
    const blackBoxSuggestions = result.finalSuggestions.filter(s =>
      s.suggestion?.sourceHeading?.includes('Black Box')
    );
    expect(blackBoxSuggestions.length).toBeGreaterThanOrEqual(1);
    const updates = blackBoxSuggestions.filter(s => s.type === 'project_update');
    expect(
      updates.length,
      `Black Box should have 0 project_updates, got: ${updates.map(s => s.title).join(', ')}`
    ).toBe(0);
    const ideas = blackBoxSuggestions.filter(s => s.type === 'idea');
    expect(ideas.length).toBeGreaterThanOrEqual(1);
  });

  it('Agatha title contains "Gamify"', () => {
    const result = generateRunResult(NOTE, undefined, { enable_debug: true }, { applyAnyway: true });
    const agathaSuggestions = result.finalSuggestions.filter(s =>
      s.suggestion?.sourceHeading?.includes('Agatha') ||
      s.suggestion?.sourceHeading?.includes('Gamification')
    );
    expect(agathaSuggestions.length).toBeGreaterThanOrEqual(1);
    const hasGamify = agathaSuggestions.some(s => s.title.toLowerCase().includes('gamif'));
    expect(
      hasGamify,
      `Agatha title should contain "Gamify". Titles: ${agathaSuggestions.map(s => s.title).join(', ')}`
    ).toBe(true);
  });

  it('Data Collection body contains BOTH "label parsing" and "photo upload"', () => {
    const result = generateRunResult(NOTE, undefined, { enable_debug: true }, { applyAnyway: true });
    const dcSuggestions = result.finalSuggestions.filter(s =>
      s.suggestion?.sourceHeading?.includes('Data Collection')
    );
    expect(dcSuggestions.length).toBeGreaterThanOrEqual(1);
    const hasMultiBullet = dcSuggestions.some(s => {
      const body = ((s.suggestion?.body ?? '') + ' ' + (s.payload.draft_initiative?.description ?? '')).toLowerCase();
      return body.includes('label parsing') && body.includes('photo upload');
    });
    expect(
      hasMultiBullet,
      `Data Collection body should contain both "label parsing" and "photo upload". Bodies: ${dcSuggestions.map(s => (s.suggestion?.body ?? '').slice(0, 120)).join(' | ')}`
    ).toBe(true);
  });

  it('all finalSuggestions have a valid sourceSectionId mapping', () => {
    const result = generateRunResult(NOTE, undefined, { enable_debug: true }, { applyAnyway: true });
    for (const s of result.finalSuggestions) {
      expect(
        s.suggestion?.sourceSectionId,
        `Suggestion "${s.title}" is missing sourceSectionId`
      ).toBeTruthy();
      expect(
        s.suggestion?.sourceHeading,
        `Suggestion "${s.title}" is missing sourceHeading`
      ).toBeTruthy();
    }
  });
});

// ============================================
// UI prefix rendering: no embedded prefixes in engine titles
// ============================================

describe('UI prefix rendering uses suggestionType, engine titles have no embedded prefixes', () => {
  const NOTE: NoteInput = {
    note_id: 'test-prefix-rendering',
    raw_markdown: [
      '### Black Box Prioritization System',
      '',
      '- Three-factor scoring: evaluate each claim using data quality, source reliability, and verification status',
      '- Additionality extension: apply additionality scoring to distinguish new mitigation from business-as-usual',
      '- Eligibility weighting: weight eligibility criteria based on regional factors and historical accuracy',
      '- Carbon accuracy layer: layer in third-party audits to improve measurement accuracy and reduce fraud',
      '',
      '### Agatha Gamification Strategy',
      '',
      '- Netflix-style "next episode" hook: after completing one field, immediately show the next highest-value field',
      '- Show earning potential: display "this field is worth €300 in carbon credits, takes 2 minutes"',
      '- "One more" nudge: after completing a batch, prompt with "just one more — the next field is 3 minutes away"',
      '- Progress streaks: reward consecutive-day data entry with streak badges and bonus credit multipliers',
      '- Social proof: show how many nearby farmers completed their fields this week',
    ].join('\n'),
  };

  it('rendered card titles never contain double prefixes', () => {
    const result = generateRunResult(NOTE, undefined, { enable_debug: true }, { applyAnyway: true });
    for (const s of result.finalSuggestions) {
      const rawTitle = s.suggestion?.title || s.title;
      const displayTitle = stripLegacyPrefix(rawTitle);
      const typePrefix = getTypePrefix(s.type);
      const rendered = typePrefix ? `${typePrefix}: ${displayTitle}` : displayTitle;

      // Must not contain double prefix like "Idea: Idea:" or "Update: Update:"
      expect(rendered).not.toMatch(/^(Idea|Update|Risk|Bug):\s+(Idea|Update|Risk|Bug):/i);

      // The display title itself must not start with a type prefix
      expect(displayTitle).not.toMatch(/^(Idea|Update|Risk|Bug)\s*:/i);
    }
  });

  it('type prefix comes from suggestion.type, not from title parsing', () => {
    const result = generateRunResult(NOTE, undefined, { enable_debug: true }, { applyAnyway: true });
    for (const s of result.finalSuggestions) {
      const prefix = getTypePrefix(s.type);
      expect(prefix).toBeDefined();
      // Ensure prefix matches the type
      if (s.type === 'idea') expect(prefix).toBe('Idea');
      if (s.type === 'project_update') expect(prefix).toBe('Update');
      if (s.type === 'risk') expect(prefix).toBe('Risk');
      if (s.type === 'bug') expect(prefix).toBe('Bug');
    }
  });
});
