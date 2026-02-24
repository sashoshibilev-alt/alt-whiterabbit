/**
 * Strategy Heading Type Override Tests
 *
 * Verifies that sections whose heading explicitly names a strategy workstream
 * (e.g. "Agatha Gamification Strategy") are classified as 'idea' even when
 * the body contains imperative-style bullets — as long as there is no concrete
 * delta / timeline change.
 *
 * Bug fixed: computeTypeLabel fell through to 'project_update' for strategy
 * headings with bullets because the earlier guard required bullet_count === 0.
 *
 * Tests:
 *   1. Unit: isStrategyHeadingSection detects strategy-keyword headings
 *   2. Integration: strategy heading + imperative bullets + no delta → idea
 *   3. Control: strategy heading + imperative bullets + explicit delta → project_update
 *   4. Regression: non-strategy heading with bullets still follows existing path
 */

import { describe, it, expect } from 'vitest';
import { generateSuggestions } from './index';
import { isStrategyHeadingSection } from './classifiers';
import type { NoteInput } from './types';

// ============================================
// Unit tests: isStrategyHeadingSection
// ============================================

describe('isStrategyHeadingSection', () => {
  it('returns true for heading containing "Strategy"', () => {
    expect(isStrategyHeadingSection('Agatha Gamification Strategy', '', 3)).toBe(true);
  });

  it('returns true for heading containing "Approach" with 3+ bullets', () => {
    expect(isStrategyHeadingSection('Go-To-Market Approach', 'Focus on SMB segment\nReduce sales cycle\nPartner with resellers', 3)).toBe(true);
  });

  it('returns false for heading containing "Initiative" (not a strategy keyword)', () => {
    expect(isStrategyHeadingSection('Pricing Initiative', '', 2)).toBe(false);
  });

  it('returns false for heading containing "Roadmap" (not a strategy keyword)', () => {
    expect(isStrategyHeadingSection('Product Roadmap v2', '', 5)).toBe(false);
  });

  it('returns true for heading containing "Framework"', () => {
    expect(isStrategyHeadingSection('Engagement Framework', '', 4)).toBe(true);
  });

  it('returns false for heading containing "Plan" (not a strategy keyword)', () => {
    expect(isStrategyHeadingSection('Q3 Execution Plan', '', 0)).toBe(false);
  });

  it('returns false for a generic noun heading without strategy keyword', () => {
    expect(isStrategyHeadingSection('Ham Light Deployment', '', 3)).toBe(false);
  });

  it('returns false for an empty heading', () => {
    expect(isStrategyHeadingSection('', '', 0)).toBe(false);
  });

  it('returns false for undefined heading', () => {
    expect(isStrategyHeadingSection(undefined, '', 0)).toBe(false);
  });

  it('returns false for a heading with only action verbs (no strategy keyword)', () => {
    expect(isStrategyHeadingSection('Create user onboarding flow', '', 3)).toBe(false);
  });
});

// ============================================
// Integration test helpers
// ============================================

function byType(note: NoteInput, type: string) {
  return generateSuggestions(note).suggestions.filter((s) => s.type === type);
}

// ============================================
// Test 1: Strategy heading + imperative bullets + NO delta → must be 'idea'
// ============================================

describe('strategy_heading_imperative_bullets_no_delta', () => {
  const NOTE: NoteInput = {
    note_id: 'test-strategy-heading-imperative-no-delta',
    raw_markdown: `
# Product Planning

## Agatha Gamification Strategy

- Create a points system that rewards key user actions
- Present weekly leaderboards to drive engagement
- Always show earning potential on every screen
`.trim(),
  };

  it('emits at least one idea suggestion', () => {
    const ideas = byType(NOTE, 'idea');
    expect(
      ideas.length,
      `Expected ≥1 idea, got: ${generateSuggestions(NOTE).suggestions.map((s) => `${s.type}: ${s.title}`).join(', ')}`
    ).toBeGreaterThanOrEqual(1);
  });

  it('does NOT emit a project_update for the gamification strategy section', () => {
    const updates = byType(NOTE, 'project_update');
    const falsePositives = updates.filter(
      (s) =>
        s.title.toLowerCase().includes('gamification') ||
        s.title.toLowerCase().includes('strategy') ||
        s.title.toLowerCase().includes('points') ||
        s.title.toLowerCase().includes('leaderboard') ||
        s.evidence_spans.some(
          (e) =>
            e.text.toLowerCase().includes('gamification') ||
            e.text.toLowerCase().includes('points system') ||
            e.text.toLowerCase().includes('leaderboard')
        )
    );
    expect(
      falsePositives.length,
      `Unexpected project_updates from strategy section: ${falsePositives.map((s) => s.title).join(', ')}`
    ).toBe(0);
  });
});

// ============================================
// Test 2 (control): Strategy heading + bullets + explicit delta → project_update
// ============================================

describe('strategy_heading_imperative_bullets_with_delta_is_project_update', () => {
  const NOTE: NoteInput = {
    note_id: 'test-strategy-heading-imperative-with-delta',
    raw_markdown: `
# Product Planning

## Agatha Gamification Strategy

The rollout has been pushed from Jan 12 to Jan 19 due to QA blockers.

- Create a points system that rewards key user actions
- Present weekly leaderboards to drive engagement
- Always show earning potential on every screen
`.trim(),
  };

  it('emits at least one project_update when a concrete delta is present', () => {
    const updates = byType(NOTE, 'project_update');
    expect(
      updates.length,
      `Expected ≥1 project_update, got: ${generateSuggestions(NOTE).suggestions.map((s) => `${s.type}: ${s.title}`).join(', ')}`
    ).toBeGreaterThanOrEqual(1);
  });
});

// ============================================
// Test 3 (regression): Non-strategy heading with bullets + no delta
// Uses existing plan_change path — behavior must not regress
// ============================================

describe('non_strategy_heading_with_bullets_regression', () => {
  // A heading without a strategy keyword — existing path must be unchanged.
  // The Agatha note from type-tiebreaker.test.ts uses prose paragraphs (no bullets)
  // so we craft a new scenario: pure prose under a non-strategy heading, which was
  // already an 'idea' before this fix.
  const NOTE: NoteInput = {
    note_id: 'test-non-strategy-heading-prose',
    raw_markdown: `
# Planning Notes

## Engagement Features

We should shift the focus from passive content to interactive scoring that automates
user engagement tracking. The system would integrate with existing data pipelines.
`.trim(),
  };

  it('still emits a suggestion (non-strategy heading prose path not broken)', () => {
    const suggestions = generateSuggestions(NOTE).suggestions;
    expect(
      suggestions.length,
      `Expected ≥1 suggestion, got 0`
    ).toBeGreaterThanOrEqual(1);
  });
});
