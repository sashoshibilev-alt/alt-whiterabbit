/**
 * List Marker Normalization Regression Tests
 *
 * Tests that list markers (bullets, numbered) are stripped from lines before
 * actionability scoring, allowing imperative verbs, role assignments, and other
 * patterns to be detected correctly regardless of list formatting.
 *
 * Context: In meeting notes, many actionable lines begin with list markers (•, -, *, 1.).
 * This prevents v3 actionability rules like "imperative verb at line start" and "strong
 * request pattern" from firing, causing sections like "Options Discussed" to be dropped
 * as NOT_ACTIONABLE even when they contain proposals.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  generateSuggestions,
  NoteInput,
  DEFAULT_CONFIG,
  DEFAULT_THRESHOLDS,
} from './index';
import { resetSectionCounter } from './preprocessing';
import { resetSuggestionCounter } from './synthesis';

describe('List Marker Normalization', () => {
  beforeEach(() => {
    resetSectionCounter();
    resetSuggestionCounter();
  });

  it('should detect imperative verb with bullet marker', () => {
    const note: NoteInput = {
      note_id: 'test-bullet-imperative',
      raw_markdown: `# Options Discussed

## Improve User Flow

• Add required steps by merging attestation screens.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    // Should generate a suggestion because "Add" is an imperative verb
    // even though it's preceded by a bullet marker
    expect(result.suggestions.length).toBeGreaterThan(0);

    const suggestion = result.suggestions[0];
    expect(suggestion).toBeDefined();
    // Now that "Add" is in PROPOSAL_VERBS_IDEA_ONLY, it anchors on the proposal line
    expect(suggestion.title.toLowerCase()).toMatch(/^add/);
    expect(suggestion.title.toLowerCase()).toContain('required steps');
  });

  it('should detect imperative verb with numbered list marker in non-suppressed sections', () => {
    const note: NoteInput = {
      note_id: 'test-numbered-imperative',
      raw_markdown: `# Action Items

## Implementation Tasks

We need to improve our error handling:

1. Implement boundary detection for errors.
2. Update the dashboard with new metrics.
3. Add monitoring alerts for critical issues.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    // Should generate suggestions because "Implement", "Update", and "Add" are imperative verbs
    // even though they're preceded by numbered list markers. Changed heading to
    // "Implementation Tasks" instead of "Next Steps" to avoid suppression.
    expect(result.suggestions.length).toBeGreaterThan(0);

    const suggestion = result.suggestions[0];
    expect(suggestion).toBeDefined();
  });

  it('should detect role assignment with bullet marker', () => {
    const note: NoteInput = {
      note_id: 'test-bullet-role-assignment',
      raw_markdown: `# Project Updates

## Task Assignments

• PM to document backlog item for future consideration.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    // Should generate a suggestion because "PM to" is a role assignment pattern
    // even though it's preceded by a bullet marker
    expect(result.suggestions.length).toBeGreaterThan(0);

    const suggestion = result.suggestions[0];
    expect(suggestion).toBeDefined();
    expect(suggestion.title).toContain('Task Assignments');
  });

  it('should detect change operator with bullet marker', () => {
    const note: NoteInput = {
      note_id: 'test-bullet-change-operator',
      raw_markdown: `# Roadmap Changes

## Timeline Adjustments

- Move launch to Q3 instead of Q2.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    // Should generate a suggestion because "Move" is a change operator
    expect(result.suggestions.length).toBeGreaterThan(0);

    const suggestion = result.suggestions[0];
    expect(suggestion).toBeDefined();
    expect(suggestion.title).toContain('Timeline Adjustments');
  });

  it('should detect decision marker with bullet marker', () => {
    const note: NoteInput = {
      note_id: 'test-bullet-decision-marker',
      raw_markdown: `# Decisions

## Feature Request Handling

• Feature request will be logged in backlog for later prioritization.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    // Should generate a suggestion because "will be logged" is a decision marker
    // even though it's preceded by a bullet marker
    expect(result.suggestions.length).toBeGreaterThan(0);

    const suggestion = result.suggestions[0];
    expect(suggestion).toBeDefined();
    expect(suggestion.title).toContain('Feature Request Handling');
  });

  it('should handle mixed bullet styles', () => {
    const note: NoteInput = {
      note_id: 'test-mixed-bullets',
      raw_markdown: `# Product Improvements

## Enhancements

- Add inline alert banners for critical errors.
* Remove deprecated feature flags.
+ Update button styles for accessibility.
• Implement two-factor authentication.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    // Should generate a suggestion because all items are imperative actions
    expect(result.suggestions.length).toBeGreaterThan(0);

    const suggestion = result.suggestions[0];
    expect(suggestion).toBeDefined();
    // After imperative fallback, title should be imperative-anchored
    // Since multiple imperatives, should pick one (likely first)
    expect(suggestion.title.toLowerCase()).toMatch(/^add|^remove|^update|^implement/);
  });

  it('should handle numbered list with different formats', () => {
    const note: NoteInput = {
      note_id: 'test-numbered-formats',
      raw_markdown: `# Implementation Plan

## Steps

Here's our plan for the next release:

1. Build user authentication flow.
2) Create dashboard for monitoring.
3. Deploy to production environment.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    // Should generate suggestions because all items are imperative actions
    // even with different numbered list formats (1. vs 2) vs 3.)
    expect(result.suggestions.length).toBeGreaterThan(0);

    const suggestion = result.suggestions[0];
    expect(suggestion).toBeDefined();
    // The suggestion should be about one of the actionable items
    expect(suggestion.title.toLowerCase()).toMatch(/build|create|deploy|authentication|dashboard|production/);
  });

  it('should preserve non-list-marker patterns', () => {
    const note: NoteInput = {
      note_id: 'test-non-list-preserved',
      raw_markdown: `# Features

## Authentication

Add boundary detection to catch edge cases. This improves reliability for production workloads.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    // Should generate a suggestion because "Add" is an imperative verb
    // at the start of the line (no list marker)
    expect(result.suggestions.length).toBeGreaterThan(0);

    const suggestion = result.suggestions[0];
    expect(suggestion).toBeDefined();
    // Since "Add" is now in PROPOSAL_VERBS_IDEA_ONLY, it should anchor on the proposal line
    expect(suggestion.title.toLowerCase()).toMatch(/^add/);
    expect(suggestion.title.toLowerCase()).toContain('boundary detection');
  });

  it('should handle indented list markers', () => {
    const note: NoteInput = {
      note_id: 'test-indented-list',
      raw_markdown: `# Options

## User Experience

  • Add required steps by merging attestation screens.
    - Update progress indicators to multi-step forms.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    // Should generate suggestions because imperative verbs are detected
    // even with indented list markers
    expect(result.suggestions.length).toBeGreaterThan(0);

    const suggestion = result.suggestions[0];
    expect(suggestion).toBeDefined();
    // Now that "Add" is in PROPOSAL_VERBS_IDEA_ONLY, it anchors on the proposal line
    expect(suggestion.title.toLowerCase()).toMatch(/^add/);
    expect(suggestion.title.toLowerCase()).toContain('required steps');
  });

  it('should respect out-of-scope markers even with list normalization', () => {
    const note: NoteInput = {
      note_id: 'test-list-out-of-scope',
      raw_markdown: `# Weekly Tasks

## Meetings

• Schedule meeting with design team next Monday.
- Send email to stakeholders about rollout.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    // Should NOT generate suggestions because these are out-of-scope
    // (calendar and communication) even though they have imperative verbs
    expect(result.suggestions.length).toBe(0);
  });

  it('should handle bullet in middle of sentence', () => {
    const note: NoteInput = {
      note_id: 'test-bullet-middle',
      raw_markdown: `# Features

## Notifications

Add dashboard for monitoring errors and improve visibility.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    // Should generate a suggestion because "Add" is an imperative verb at line start
    expect(result.suggestions.length).toBeGreaterThan(0);

    const suggestion = result.suggestions[0];
    expect(suggestion).toBeDefined();
    // Now that "Add" is in PROPOSAL_VERBS_IDEA_ONLY, it anchors on the proposal line
    expect(suggestion.title.toLowerCase()).toMatch(/^add/);
    expect(suggestion.title.toLowerCase()).toContain('dashboard');
  });

  it('should prefer proposal line over complaint line in idea body and evidence', () => {
    const note: NoteInput = {
      note_id: 'test-proposal-first',
      raw_markdown: `# Customer Feedback

## Attestation Flow

Employees are dissatisfied with too many clicks.

Reduce required steps by merging attestation screens.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    // Should generate at least one suggestion
    expect(result.suggestions.length).toBeGreaterThan(0);

    // Find the idea suggestion
    const ideaSuggestion = result.suggestions.find((s) => s.type === 'idea');
    expect(ideaSuggestion).toBeDefined();

    if (ideaSuggestion) {
      // Body should mention the proposal, not just the complaint
      const body = ideaSuggestion.suggestion?.body || '';
      expect(body.toLowerCase()).toMatch(/reduce.*steps|merg.*screens/);

      // Evidence spans should include the proposal line
      expect(ideaSuggestion.evidence_spans.length).toBeGreaterThan(0);
      const evidenceText = ideaSuggestion.evidence_spans
        .map((span) => span.text.toLowerCase())
        .join(' ');
      expect(evidenceText).toMatch(/reduce.*steps|merg.*screens/);
    }
  });
});
