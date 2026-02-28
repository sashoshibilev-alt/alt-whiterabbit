/**
 * Parity tests for sectionSignals.ts
 *
 * Verifies that the centralized helpers classify sample note sections
 * exactly as the original inline logic did before centralization.
 *
 * Adding cases here serves two purposes:
 *   1. Proves behavior is unchanged after the refactor.
 *   2. Gives a stable regression surface if the helpers change in the future.
 */

import { describe, it, expect } from 'vitest';
import {
  GAMIFICATION_TOKENS,
  AUTOMATION_HEADING_RE,
  SPEC_FRAMEWORK_TOKENS,
  SPEC_FRAMEWORK_TOKEN_LIST,
  SPEC_FRAMEWORK_TIMELINE_EXCLUSIONS,
  countGamificationTokens,
  isGamificationSection,
  computeGamificationClusterTitle,
  isAutomationSection,
  buildAutomationMultiBulletBody,
} from './sectionSignals';

// ============================================
// GAMIFICATION_TOKENS
// ============================================

describe('GAMIFICATION_TOKENS', () => {
  it('contains exactly 10 tokens', () => {
    expect(GAMIFICATION_TOKENS.length).toBe(10);
  });

  it('includes all expected tokens', () => {
    expect(GAMIFICATION_TOKENS).toContain('next episode');
    expect(GAMIFICATION_TOKENS).toContain('earning potential');
    expect(GAMIFICATION_TOKENS).toContain('next highest-value field');
    expect(GAMIFICATION_TOKENS).toContain('next field');
    expect(GAMIFICATION_TOKENS).toContain('streak');
    expect(GAMIFICATION_TOKENS).toContain('badge');
  });
});

// ============================================
// countGamificationTokens
// ============================================

describe('countGamificationTokens', () => {
  it('returns 0 for unrelated text', () => {
    expect(countGamificationTokens('upload form data to the backend')).toBe(0);
  });

  it('counts matching tokens case-insensitively (pre-lowercased input)', () => {
    const text = 'earn a streak badge for next field upload';
    expect(countGamificationTokens(text)).toBe(3); // streak, badge, next field
  });

  it('counts overlapping token substrings only once each', () => {
    // "next highest-value field" contains "next field" as a substring —
    // each is a distinct token so both match
    const text = 'next highest-value field next field reward';
    expect(countGamificationTokens(text)).toBe(3); // next highest-value field, next field, reward
  });

  it('matches the sample note gamification section (parity check)', () => {
    // This mirrors a sample from spec-framework-suppression.test.ts fixture notes
    const bullets = [
      'show next episode button (one more)',
      'earning potential per field (worth € 300, 2 minutes)',
      'next highest-value field highlight',
      'streak indicator',
      'badge for completion',
    ].join(' ').toLowerCase();
    const count = countGamificationTokens(bullets);
    expect(count).toBeGreaterThanOrEqual(2);
  });
});

// ============================================
// isGamificationSection
// ============================================

describe('isGamificationSection', () => {
  it('returns false when fewer than 4 items', () => {
    const items = ['next episode', 'streak reward', 'earn badge'];
    expect(isGamificationSection(items)).toBe(false); // only 3 items
  });

  it('returns false when fewer than 2 tokens match', () => {
    const items = ['upload document', 'review field', 'parse data', 'check results'];
    expect(isGamificationSection(items)).toBe(false);
  });

  it('returns true when ≥4 items with ≥2 gamification tokens', () => {
    const items = [
      'show next episode button',
      'display earning potential',
      'highlight next field',
      'show streak counter',
    ];
    expect(isGamificationSection(items)).toBe(true);
  });

  it('respects custom minBullets and minTokens', () => {
    const items = ['next field highlight', 'streak badge'];
    expect(isGamificationSection(items, 2, 2)).toBe(true);
    expect(isGamificationSection(items, 3, 2)).toBe(false); // only 2 items
  });
});

// ============================================
// computeGamificationClusterTitle
// ============================================

describe('computeGamificationClusterTitle', () => {
  it('returns next-field title when "next highest-value field" is present', () => {
    const lower = 'show next highest-value field highlight';
    expect(computeGamificationClusterTitle('Agatha Gamification', lower))
      .toBe('Gamify data collection (next-field rewards)');
  });

  it('returns next-field title when "next field" is present (without highest-value)', () => {
    const lower = 'highlight next field earning potential badge';
    expect(computeGamificationClusterTitle('Agatha Gamification', lower))
      .toBe('Gamify data collection (next-field rewards)');
  });

  it('prefers next-field over earning-potential when both present', () => {
    const lower = 'next highest-value field earning potential streak';
    expect(computeGamificationClusterTitle('Rewards', lower))
      .toBe('Gamify data collection (next-field rewards)');
  });

  it('returns earning-potential title when only earning potential is present', () => {
    const lower = 'show earning potential per field streak badge';
    expect(computeGamificationClusterTitle('Engagement', lower))
      .toBe('Gamify data collection (earning-potential rewards)');
  });

  it('falls back to heading when no specific token matches', () => {
    const lower = 'gamif streak badge reward';
    expect(computeGamificationClusterTitle('Black Box Scoring', lower))
      .toBe('Black Box Scoring');
  });

  it('falls back to generic title when heading is empty and no specific token', () => {
    const lower = 'gamif streak badge reward';
    expect(computeGamificationClusterTitle('', lower))
      .toBe('Gamify data collection');
  });
});

// ============================================
// AUTOMATION_HEADING_RE / isAutomationSection
// ============================================

describe('isAutomationSection', () => {
  it('returns true for "Data Collection Automation"', () => {
    expect(isAutomationSection('Data Collection Automation')).toBe(true);
  });

  it('returns true for "Parsing Layer"', () => {
    expect(isAutomationSection('Parsing Layer')).toBe(true);
  });

  it('returns true for "OCR Pipeline"', () => {
    expect(isAutomationSection('OCR Pipeline')).toBe(true);
  });

  it('returns true for "Upload Strategy"', () => {
    expect(isAutomationSection('Upload Strategy')).toBe(true);
  });

  it('returns true for heading containing "automation" anywhere', () => {
    expect(isAutomationSection('Field-level automation')).toBe(true);
  });

  it('returns false for unrelated headings', () => {
    expect(isAutomationSection('User Feedback')).toBe(false);
    expect(isAutomationSection('Q2 Priorities')).toBe(false);
    expect(isAutomationSection('')).toBe(false);
  });

  it('matches AUTOMATION_HEADING_RE directly', () => {
    expect(AUTOMATION_HEADING_RE.test('Data Collection Automation')).toBe(true);
    expect(AUTOMATION_HEADING_RE.test('Something else')).toBe(false);
  });
});

// ============================================
// buildAutomationMultiBulletBody
// ============================================

describe('buildAutomationMultiBulletBody', () => {
  it('formats items as "- item" lines joined by newline', () => {
    const items = ['Parse PDF invoices', 'Extract field values', 'Upload to database'];
    expect(buildAutomationMultiBulletBody(items)).toBe(
      '- Parse PDF invoices\n- Extract field values\n- Upload to database'
    );
  });

  it('slices to maxItems (default 4)', () => {
    const items = ['a', 'b', 'c', 'd', 'e'];
    expect(buildAutomationMultiBulletBody(items)).toBe('- a\n- b\n- c\n- d');
  });

  it('respects custom maxItems', () => {
    const items = ['a', 'b', 'c', 'd', 'e'];
    expect(buildAutomationMultiBulletBody(items, 2)).toBe('- a\n- b');
  });

  it('handles empty list', () => {
    expect(buildAutomationMultiBulletBody([])).toBe('');
  });
});

// ============================================
// SPEC_FRAMEWORK_TOKENS / _TOKEN_LIST / _TIMELINE_EXCLUSIONS
// ============================================

describe('SPEC_FRAMEWORK_TOKENS', () => {
  it('matches "scoring"', () => {
    expect(SPEC_FRAMEWORK_TOKENS.test('Three-factor scoring rubric')).toBe(true);
  });

  it('matches "eligibility"', () => {
    expect(SPEC_FRAMEWORK_TOKENS.test('Eligibility criteria definition')).toBe(true);
  });

  it('matches "framework"', () => {
    expect(SPEC_FRAMEWORK_TOKENS.test('Claim Assessment Framework')).toBe(true);
  });

  it('matches "additionality"', () => {
    expect(SPEC_FRAMEWORK_TOKENS.test('Apply additionality scoring')).toBe(true);
  });

  it('does not match unrelated text', () => {
    expect(SPEC_FRAMEWORK_TOKENS.test('Deploy the application')).toBe(false);
    expect(SPEC_FRAMEWORK_TOKENS.test('Launch the feature')).toBe(false);
  });
});

describe('SPEC_FRAMEWORK_TOKEN_LIST', () => {
  it('has 9 individual token regexes', () => {
    expect(SPEC_FRAMEWORK_TOKEN_LIST.length).toBe(9);
  });

  it('each regex matches its target token', () => {
    const samples = [
      ['scoring', /\bscoring\b/i],
      ['prioritization', /\bprioritization\b/i],
      ['weighting', /\bweighting\b/i],
      ['framework', /\bframework\b/i],
    ];
    for (const [word] of samples) {
      const matched = SPEC_FRAMEWORK_TOKEN_LIST.some(re => re.test(word as string));
      expect(matched).toBe(true);
    }
  });

  it('counts ≥2 distinct tokens in a typical spec section body', () => {
    const body = 'Three-factor scoring: evaluate each claim using eligibility criteria';
    const matchCount = SPEC_FRAMEWORK_TOKEN_LIST.filter(re => re.test(body)).length;
    expect(matchCount).toBeGreaterThanOrEqual(2);
  });
});

describe('SPEC_FRAMEWORK_TIMELINE_EXCLUSIONS', () => {
  it('matches "deployed"', () => {
    expect(SPEC_FRAMEWORK_TIMELINE_EXCLUSIONS.test('The system was deployed last week')).toBe(true);
  });

  it('matches "launched"', () => {
    expect(SPEC_FRAMEWORK_TIMELINE_EXCLUSIONS.test('Feature launched in Q3')).toBe(true);
  });

  it('matches "in progress"', () => {
    expect(SPEC_FRAMEWORK_TIMELINE_EXCLUSIONS.test('Work in progress')).toBe(true);
  });

  it('does not match pure spec text', () => {
    expect(SPEC_FRAMEWORK_TIMELINE_EXCLUSIONS.test('Three-factor scoring with weighting')).toBe(false);
  });
});
