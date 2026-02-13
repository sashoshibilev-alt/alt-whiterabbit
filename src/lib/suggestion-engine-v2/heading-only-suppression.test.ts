/**
 * Heading-Only Suggestion Suppression Tests
 *
 * Tests that suggestions with heading-derived titles like "New idea: <Heading>"
 * are suppressed when there is no explicit ask anchor evidence.
 *
 * REGRESSION: Previously, sections with only heading text and no explicit asks
 * were emitting garbage suggestions with titles like "New idea: <Heading>".
 *
 * Key requirements:
 * 1. Drop suggestions where title is derived from heading AND there's no explicit ask
 * 2. Preserve suggestions with explicit asks even if title uses heading as fallback
 * 3. Preserve suggestions with proposal/friction-based titles
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  generateSuggestions,
  NoteInput,
  DEFAULT_CONFIG,
} from './index';
import { resetSectionCounter } from './preprocessing';
import { resetSuggestionCounter } from './synthesis';

describe('Heading-Only Suppression', () => {
  beforeEach(() => {
    resetSectionCounter();
    resetSuggestionCounter();
  });

  it('should drop heading-only section with no explicit ask', () => {
    const note: NoteInput = {
      note_id: 'test-heading-only',
      raw_markdown: `# Meeting Notes

## Product Roadmap

This section only contains generic discussion about the roadmap without any explicit requests.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    // Should produce no suggestions from this heading-only section
    const roadmapSuggestions = result.suggestions.filter(s =>
      s.suggestion?.sourceHeading.toLowerCase().includes('roadmap')
    );
    expect(roadmapSuggestions.length).toBe(0);

    // Check debug info for drop reason
    if (result.debug?.dropped_suggestions) {
      const droppedRoadmap = result.debug.dropped_suggestions.find(d =>
        d.reason?.toLowerCase().includes('heading-only')
      );
      expect(droppedRoadmap).toBeDefined();
    }
  });

  it('should allow suggestion with explicit ask even if title is weak', () => {
    const note: NoteInput = {
      note_id: 'test-explicit-ask-with-heading',
      raw_markdown: `# Feature Requests

## Analytics Dashboard

We should add better visibility into user engagement metrics and retention cohorts.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    // Should produce suggestion because of explicit ask "We should add"
    const dashboardSuggestions = result.suggestions.filter(s =>
      s.suggestion?.sourceHeading.toLowerCase().includes('analytics')
    );
    expect(dashboardSuggestions.length).toBeGreaterThan(0);

    // Title should NOT be "New idea: Analytics Dashboard"
    const suggestion = dashboardSuggestions[0];
    expect(suggestion.title).not.toMatch(/^New idea: Analytics/);
    expect(suggestion.titleSource).toBe('explicit-ask');
  });

  it('should drop "New idea: X" pattern without explicit ask', () => {
    const note: NoteInput = {
      note_id: 'test-new-idea-pattern',
      raw_markdown: `# Brainstorming Session

## Mobile App Redesign

Some thoughts on refreshing the mobile experience.
No clear action items yet.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    // Should not emit "New idea: Mobile App Redesign"
    const mobileSuggestions = result.suggestions.filter(s =>
      s.title.includes('Mobile App Redesign')
    );
    expect(mobileSuggestions.length).toBe(0);
  });

  it('should allow proposal-based suggestions', () => {
    const note: NoteInput = {
      note_id: 'test-proposal-allowed',
      raw_markdown: `# Product Ideas

## Search Improvements

We should implement fuzzy matching for search queries to improve result quality.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    // Should produce suggestion because of explicit ask
    const searchSuggestions = result.suggestions.filter(s =>
      s.suggestion?.sourceHeading.toLowerCase().includes('search')
    );
    expect(searchSuggestions.length).toBeGreaterThan(0);

    const suggestion = searchSuggestions[0];
    expect(suggestion.titleSource).toBe('explicit-ask');
    expect(suggestion.title.toLowerCase()).toMatch(/fuzzy|matching|search/);
  });

  it('should allow friction-based suggestions', () => {
    const note: NoteInput = {
      note_id: 'test-friction-allowed',
      raw_markdown: `# User Feedback

## Onboarding Flow

There are too many clicks to complete account setup - users need a streamlined flow.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    // Should produce suggestion (friction detection OR explicit ask)
    const onboardingSuggestions = result.suggestions.filter(s =>
      s.suggestion?.sourceHeading.toLowerCase().includes('onboarding')
    );
    expect(onboardingSuggestions.length).toBeGreaterThan(0);

    const suggestion = onboardingSuggestions[0];
    // Could be friction or explicit-ask depending on which pattern matches first
    expect(['friction', 'explicit-ask']).toContain(suggestion.titleSource);
    expect(suggestion.title.toLowerCase()).toMatch(/reduce clicks|streamline|need/);
  });

  it('regression: minimal heading-only fixture', () => {
    const note: NoteInput = {
      note_id: 'test-regression',
      raw_markdown: `# Notes

## New Feature X

Some context about the feature.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    // Should NOT emit "New idea: New Feature X"
    const newFeatureSuggestions = result.suggestions.filter(s =>
      s.title.includes('New Feature X')
    );
    expect(newFeatureSuggestions.length).toBe(0);
  });

  it('should suppress multiple heading-only sections', () => {
    const note: NoteInput = {
      note_id: 'test-multiple-heading-only',
      raw_markdown: `# Strategy Discussion

## Q1 Priorities

General discussion about priorities.

## Q2 Roadmap

High-level roadmap thoughts.

## Team Capacity

Capacity planning notes.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    // None of these heading-only sections should produce suggestions
    expect(result.suggestions.length).toBe(0);
  });

  it('should track titleSource correctly for mixed sections', () => {
    const note: NoteInput = {
      note_id: 'test-title-source-tracking',
      raw_markdown: `# Feature Ideas

## Mobile Push Notifications

We should implement push notifications for the mobile app.

## Settings Panel

There is a request to add dark mode toggle to settings.

## Help System

Users need better access to help articles.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    // Filter only idea-type suggestions (project_update won't have titleSource)
    const ideaSuggestions = result.suggestions.filter(s => s.type === 'idea');
    expect(ideaSuggestions.length).toBeGreaterThanOrEqual(2);

    // Check each titleSource - all idea suggestions should be explicit-ask with these patterns
    const darkModeSuggestion = ideaSuggestions.find(s =>
      s.title.toLowerCase().includes('dark mode') || s.title.toLowerCase().includes('toggle')
    );
    expect(darkModeSuggestion?.titleSource).toBe('explicit-ask');

    const helpSuggestion = ideaSuggestions.find(s =>
      s.title.toLowerCase().includes('help') || s.title.toLowerCase().includes('access')
    );
    expect(helpSuggestion?.titleSource).toBe('explicit-ask');
  });
});
