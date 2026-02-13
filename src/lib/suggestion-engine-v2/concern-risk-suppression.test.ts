/**
 * Concern/Risk Statement Suppression Tests
 *
 * Tests that non-proposal concern/risk statements are filtered out from anchor selection,
 * especially as secondary anchors in multi-anchor sections.
 *
 * REGRESSION: Previously, lines like "Some internal concern that aggressive gating might churn..."
 * were being selected as idea anchors and producing garbage titles.
 *
 * Key requirements:
 * 1. Suppress concern/risk phrasing without explicit ask markers or action verbs
 * 2. Allow through if explicit ask markers are present (e.g., "requirement to", "users need")
 * 3. Allow through if concrete work verbs are present (e.g., "implement", "add", "fix")
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  generateSuggestions,
  NoteInput,
  DEFAULT_CONFIG,
} from './index';
import { resetSectionCounter } from './preprocessing';
import { resetSuggestionCounter } from './synthesis';

describe('Concern/Risk Statement Suppression', () => {
  beforeEach(() => {
    resetSectionCounter();
    resetSuggestionCounter();
  });

  it('should suppress "concern that X might churn" as second anchor', () => {
    const note: NoteInput = {
      note_id: 'test-concern-suppression',
      raw_markdown: `# Feature Gating Discussion

## Rollout Strategy

Requirement to implement granular feature gating before the next release.
Some internal concern that aggressive gating might churn existing power users.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    // Should produce exactly 1 suggestion from the "Requirement to implement" line
    const sectionSuggestions = result.suggestions.filter(s =>
      s.suggestion?.sourceHeading.toLowerCase().includes('rollout')
    );
    expect(sectionSuggestions.length).toBe(1);

    // The suggestion should be about feature gating, NOT about churn
    const suggestion = sectionSuggestions[0];
    expect(suggestion.title.toLowerCase()).toMatch(/feature gating|gating/);
    expect(suggestion.title.toLowerCase()).not.toMatch(/churn|retain|concern/);
  });

  it('should suppress "risk that X could cause" statement', () => {
    const note: NoteInput = {
      note_id: 'test-risk-suppression',
      raw_markdown: `# Performance Planning

## API Optimization

Request to add caching layer for frequently accessed data.
Risk that this could cause stale data issues in multi-region deployments.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    const sectionSuggestions = result.suggestions.filter(s =>
      s.suggestion?.sourceHeading.toLowerCase().includes('optimization')
    );
    expect(sectionSuggestions.length).toBe(1);

    const suggestion = sectionSuggestions[0];
    expect(suggestion.title.toLowerCase()).toMatch(/cach/);
    expect(suggestion.title.toLowerCase()).not.toMatch(/risk|stale|multi-region/);
  });

  it('should suppress "worried that X might impact" statement', () => {
    const note: NoteInput = {
      note_id: 'test-worried-suppression',
      raw_markdown: `# Migration Planning

## Database Upgrade

Users need a seamless migration path to the new database schema.
Worried that rapid schema changes might impact production stability.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    const sectionSuggestions = result.suggestions.filter(s =>
      s.suggestion?.sourceHeading.toLowerCase().includes('upgrade')
    );
    expect(sectionSuggestions.length).toBe(1);

    const suggestion = sectionSuggestions[0];
    expect(suggestion.title.toLowerCase()).toMatch(/migration|migrate/);
    expect(suggestion.title.toLowerCase()).not.toMatch(/worried|rapid|stability/);
  });

  // ============================================
  // Positive tests: allow through with explicit ask markers
  // ============================================

  it('should allow "concern" when paired with explicit ask marker', () => {
    const note: NoteInput = {
      note_id: 'test-concern-with-ask',
      raw_markdown: `# Security Review

## Access Controls

There is a concern that we need to implement role-based permissions.
Current system only has admin/non-admin distinction.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    // Should produce a suggestion because "we need to" is an explicit ask marker
    const sectionSuggestions = result.suggestions.filter(s =>
      s.suggestion?.sourceHeading.toLowerCase().includes('access')
    );
    expect(sectionSuggestions.length).toBeGreaterThanOrEqual(1);

    const suggestion = sectionSuggestions[0];
    expect(suggestion.title.toLowerCase()).toMatch(/role|permission/);
  });

  it('should allow "risk" when paired with action verb', () => {
    const note: NoteInput = {
      note_id: 'test-risk-with-action',
      raw_markdown: `# Technical Debt

## Code Quality

Risk that we should refactor the authentication module before adding new features.
The current implementation is brittle and hard to test.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    // Should produce a suggestion because "refactor" is an action verb
    const sectionSuggestions = result.suggestions.filter(s =>
      s.suggestion?.sourceHeading.toLowerCase().includes('quality')
    );
    expect(sectionSuggestions.length).toBeGreaterThanOrEqual(1);

    const suggestion = sectionSuggestions[0];
    expect(suggestion.title.toLowerCase()).toMatch(/refactor|authentication/);
  });

  // ============================================
  // Edge cases
  // ============================================

  it('should suppress "could churn" variant', () => {
    const note: NoteInput = {
      note_id: 'test-could-churn',
      raw_markdown: `# Pricing Changes

## Tier Restructuring

Requirement to update pricing tiers for enterprise customers.
Analysis shows this could churn mid-tier accounts.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    const sectionSuggestions = result.suggestions.filter(s =>
      s.suggestion?.sourceHeading.toLowerCase().includes('restructuring')
    );
    expect(sectionSuggestions.length).toBe(1);

    const suggestion = sectionSuggestions[0];
    expect(suggestion.title.toLowerCase()).toMatch(/pricing|tier/);
    expect(suggestion.title.toLowerCase()).not.toMatch(/churn|analysis|mid-tier/);
  });

  it('should suppress "might impact" variant', () => {
    const note: NoteInput = {
      note_id: 'test-might-impact',
      raw_markdown: `# UI Redesign

## Layout Changes

Request to redesign the dashboard layout for better mobile support.
Team discussion revealed this might impact existing user workflows.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    const sectionSuggestions = result.suggestions.filter(s =>
      s.suggestion?.sourceHeading.toLowerCase().includes('layout')
    );
    expect(sectionSuggestions.length).toBe(1);

    const suggestion = sectionSuggestions[0];
    expect(suggestion.title.toLowerCase()).toMatch(/dashboard|layout|mobile/);
    expect(suggestion.title.toLowerCase()).not.toMatch(/impact|workflow|discussion/);
  });

  it('should handle section with only concern statements (no valid asks)', () => {
    const note: NoteInput = {
      note_id: 'test-only-concerns',
      raw_markdown: `# Risk Assessment

## Potential Issues

Some concern that the new architecture might cause latency problems.
Risk that data consistency could be impacted during peak hours.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    // Should produce zero suggestions since both lines are suppressed
    const sectionSuggestions = result.suggestions.filter(s =>
      s.suggestion?.sourceHeading.toLowerCase().includes('potential')
    );
    expect(sectionSuggestions.length).toBe(0);
  });

  it('should handle multiple valid asks without concern statements', () => {
    const note: NoteInput = {
      note_id: 'test-multiple-valid-asks',
      raw_markdown: `# Feature Roadmap

## Next Quarter

Requirement to implement SSO for enterprise customers.
Request to add audit logging for compliance tracking.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    // Should produce 2 suggestions (both are valid asks)
    const sectionSuggestions = result.suggestions.filter(s =>
      s.suggestion?.sourceHeading.toLowerCase().includes('quarter')
    );
    expect(sectionSuggestions.length).toBe(2);

    const titles = sectionSuggestions.map(s => s.title.toLowerCase());
    expect(titles.some(t => t.includes('sso'))).toBe(true);
    expect(titles.some(t => t.includes('audit') || t.includes('logging'))).toBe(true);
  });
});
