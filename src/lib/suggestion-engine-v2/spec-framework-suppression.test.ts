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
// Fix (2): Black Box deduplication — single Idea with multi-bullet body
// ============================================

describe('Black Box: single Idea, multi-bullet body, no baked prefix (Agatha full note)', () => {
  const NOTE: NoteInput = {
    note_id: 'test-bbox-agatha-full',
    raw_markdown: [
      '# Agatha Carbon Credit Platform',
      '',
      '### Black Box Prioritization System',
      '',
      '- Three-factor scoring: evaluate each claim using data quality, source reliability, and verification status',
      '- Additionality extension: apply additionality scoring to distinguish new mitigation from business-as-usual',
      '- Eligibility weighting: weight eligibility criteria based on regional factors and historical accuracy',
      '- Carbon accuracy layer: layer in third-party audits to improve measurement accuracy and reduce fraud',
    ].join('\n'),
  };

  it('emits exactly ONE suggestion with sourceHeading including "Black Box Prioritization System"', () => {
    const result = generateRunResult(NOTE, undefined, { enable_debug: true }, { applyAnyway: true });
    const bbox = result.finalSuggestions.filter(s =>
      (s.suggestion?.sourceHeading ?? '').includes('Black Box Prioritization System')
    );
    expect(bbox.length, `Expected 1, got ${bbox.length}: ${bbox.map(s => `${s.type}:${s.title}`).join(', ')}`).toBe(1);
  });

  it('type is "idea"', () => {
    const result = generateRunResult(NOTE, undefined, { enable_debug: true }, { applyAnyway: true });
    const bbox = result.finalSuggestions.find(s =>
      (s.suggestion?.sourceHeading ?? '').includes('Black Box Prioritization System')
    );
    expect(bbox).toBeDefined();
    expect(bbox!.type).toBe('idea');
  });

  it('title has no baked prefix ("Idea:"/"Update:")', () => {
    const result = generateRunResult(NOTE, undefined, { enable_debug: true }, { applyAnyway: true });
    const bbox = result.finalSuggestions.find(s =>
      (s.suggestion?.sourceHeading ?? '').includes('Black Box Prioritization System')
    );
    expect(bbox).toBeDefined();
    // The raw engine title uses normalizeTitlePrefix which adds "Idea: ", but
    // the suggestion.title (card payload) should strip legacy prefixes for display
    const displayTitle = stripLegacyPrefix(bbox!.suggestion?.title ?? bbox!.title);
    expect(displayTitle).not.toMatch(/^(Idea|Update|Risk|Bug)\s*:/i);
  });

  it('body contains multiple "- " bullets and includes at least 3 expected Black Box bullets', () => {
    const result = generateRunResult(NOTE, undefined, { enable_debug: true }, { applyAnyway: true });
    const bbox = result.finalSuggestions.find(s =>
      (s.suggestion?.sourceHeading ?? '').includes('Black Box Prioritization System')
    );
    expect(bbox).toBeDefined();
    const body = bbox!.suggestion?.body ?? '';
    const bullets = body.split('\n').filter(l => l.startsWith('- '));
    expect(bullets.length, `Expected >= 3 bullets, got ${bullets.length}: ${body.slice(0, 200)}`).toBeGreaterThanOrEqual(3);
    const lower = body.toLowerCase();
    expect(lower).toContain('three-factor scoring');
    expect(lower).toContain('additionality');
    expect(lower).toContain('eligibility weighting');
  });
});

// ============================================
// Fix (2b): Black Box with concrete deltas still suppresses project_update
// ============================================

describe('Black Box with concrete deltas: still single Idea (no project_update)', () => {
  const NOTE: NoteInput = {
    note_id: 'test-bbox-delta',
    raw_markdown: [
      '# Meeting Notes',
      '',
      'Thu, 18 Dec 25',
      '',
      '### Black Box Prioritization System',
      '',
      '- Three-factor scoring for field prioritization:',
      '1. Field size (20% of farm coverage priority)',
      '2. Eligibility (crop API validation against eligible list)',
      '3. Additionality (cover crop score 0-1, extending to 5-year analysis)',
      '- Remote sensing integration',
      '- Existing API determines regenerative practice scores',
      '- Extend from current 1-year to 5-year assessment',
      '',
      '### Agatha Gamification Strategy',
      '',
      '- Netflix-style "next episode" approach for data collection',
      '- Present earning potential per field (e.g., "Next field worth €300, takes 2 minutes 45 seconds")',
      '- Create "just do one more" mentality similar to gambling psychology',
      '- Always show next highest-value field after completion',
    ].join('\n'),
  };

  it('emits at most ONE suggestion for Black Box (no project_update)', () => {
    const result = generateRunResult(NOTE, undefined, { enable_debug: true }, { applyAnyway: true });
    const bbox = result.finalSuggestions.filter(s =>
      (s.suggestion?.sourceHeading ?? '').includes('Black Box')
    );
    const updates = bbox.filter(s => s.type === 'project_update');
    expect(updates.length, `Unexpected project_updates: ${updates.map(s => s.title).join(', ')}`).toBe(0);
    const ideas = bbox.filter(s => s.type === 'idea');
    expect(ideas.length).toBeLessThanOrEqual(1);
  });

  it('if Black Box idea exists, body has multi-bullet content', () => {
    const result = generateRunResult(NOTE, undefined, { enable_debug: true }, { applyAnyway: true });
    const bbox = result.finalSuggestions.find(s =>
      (s.suggestion?.sourceHeading ?? '').includes('Black Box') && s.type === 'idea'
    );
    if (bbox) {
      const body = bbox.suggestion?.body ?? '';
      const bullets = body.split('\n').filter(l => l.startsWith('- '));
      expect(bullets.length, `Expected >= 3 bullets, got ${bullets.length}`).toBeGreaterThanOrEqual(3);
    }
  });
});

// ============================================
// Fix (4): Implementation Timeline — single Update with multi-bullet body
// ============================================

describe('Implementation Timeline: single project_update, multi-bullet body (Agatha note)', () => {
  const NOTE: NoteInput = {
    note_id: 'test-impl-timeline-agatha',
    raw_markdown: [
      '# Project Status',
      '',
      '## Implementation Timeline',
      '',
      '- Immediate focus: Ham Light deployment (3-month window, target January)',
      '- Backend services ready; frontend integration in progress',
      '- Security considerations: Database logging includes user IDs which raises privacy and PII risk',
      '- Need to mask user IDs before logging goes live',
    ].join('\n'),
  };

  it('emits exactly ONE suggestion for Implementation Timeline section', () => {
    const result = generateRunResult(NOTE, undefined, { enable_debug: true }, { applyAnyway: true });
    const timeline = result.finalSuggestions.filter(s =>
      (s.suggestion?.sourceHeading ?? '').toLowerCase().includes('implementation timeline')
    );
    expect(
      timeline.length,
      `Expected 1, got ${timeline.length}: ${timeline.map(s => `${s.type}:${s.title}`).join(', ')}`
    ).toBe(1);
  });

  it('type is project_update', () => {
    const result = generateRunResult(NOTE, undefined, { enable_debug: true }, { applyAnyway: true });
    const timeline = result.finalSuggestions.find(s =>
      (s.suggestion?.sourceHeading ?? '').toLowerCase().includes('implementation timeline')
    );
    expect(timeline).toBeDefined();
    expect(timeline!.type).toBe('project_update');
  });

  it('body includes "3-month" and "January"', () => {
    const result = generateRunResult(NOTE, undefined, { enable_debug: true }, { applyAnyway: true });
    const timeline = result.finalSuggestions.find(s =>
      (s.suggestion?.sourceHeading ?? '').toLowerCase().includes('implementation timeline')
    );
    expect(timeline).toBeDefined();
    const body = (timeline!.suggestion?.body ?? '').toLowerCase();
    expect(body).toContain('3-month');
    expect(body.includes('january') || body.includes('jan')).toBe(true);
  });

  it('suggestion is emitted (not dropped)', () => {
    const result = generateRunResult(NOTE, undefined, { enable_debug: true }, { applyAnyway: true, includeDebugFields: true });
    const timeline = result.finalSuggestions.find(s =>
      (s.suggestion?.sourceHeading ?? '').toLowerCase().includes('implementation timeline')
    );
    expect(timeline).toBeDefined();
  });
});

// ============================================
// Fix (4b): Implementation Timeline synthetic creation when pipeline drops all candidates
// ============================================

describe('Implementation Timeline: synthetic project_update when pipeline drops all candidates', () => {
  // This fixture uses the real-world note structure where the Implementation Timeline
  // section has no strong actionability signals and gets dropped by V4_HEADING_ONLY.
  // The final-emission enforcement should still create a synthetic project_update.
  const NOTE: NoteInput = {
    note_id: 'test-impl-timeline-synthetic',
    raw_markdown: [
      '# Meeting Notes',
      '',
      'Thu, 18 Dec 25',
      '',
      '### Agatha Gamification Strategy',
      '',
      '- Netflix-style "next episode" approach for data collection',
      '- Present earning potential per field (e.g., "Next field worth €300, takes 2 minutes")',
      '- Create "just do one more" mentality similar to gambling psychology',
      '- Always show next highest-value field after completion',
      '',
      '### Implementation Timeline',
      '',
      '- Immediate focus: Ham Light deployment',
      '- 3-month target window starting early January',
      '- Prioritize quick wins: photo upload, eligibility API',
      '- Backend services deployment strategy',
      '- Security considerations',
      '- User testing phase after initial deployment',
      '- Full rollout by end of Q1',
    ].join('\n'),
  };

  it('emits exactly ONE suggestion for Implementation Timeline', () => {
    const result = generateRunResult(NOTE, undefined, { enable_debug: true }, { applyAnyway: true });
    const timeline = result.finalSuggestions.filter(s =>
      (s.suggestion?.sourceHeading ?? '').toLowerCase().includes('implementation timeline')
    );
    expect(timeline.length, `Expected 1, got ${timeline.length}: ${timeline.map(s => `${s.type}:${s.title}`).join(', ')}`).toBe(1);
  });

  it('type is project_update', () => {
    const result = generateRunResult(NOTE, undefined, { enable_debug: true }, { applyAnyway: true });
    const timeline = result.finalSuggestions.find(s =>
      (s.suggestion?.sourceHeading ?? '').toLowerCase().includes('implementation timeline')
    );
    expect(timeline).toBeDefined();
    expect(timeline!.type).toBe('project_update');
  });

  it('body includes "3-month" and "January"', () => {
    const result = generateRunResult(NOTE, undefined, { enable_debug: true }, { applyAnyway: true });
    const timeline = result.finalSuggestions.find(s =>
      (s.suggestion?.sourceHeading ?? '').toLowerCase().includes('implementation timeline')
    );
    expect(timeline).toBeDefined();
    const body = (timeline!.suggestion?.body ?? '').toLowerCase();
    expect(body).toContain('3-month');
    expect(body.includes('january') || body.includes('jan')).toBe(true);
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
