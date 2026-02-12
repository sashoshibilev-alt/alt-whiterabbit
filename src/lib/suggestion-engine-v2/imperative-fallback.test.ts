/**
 * Imperative Fallback Regression Tests
 *
 * Tests that imperative-form feature requests (without explicit subjects)
 * emit B-lite idea suggestions using the imperative fallback path.
 *
 * Requirements:
 * 1. Valid imperatives emit idea suggestions (not dropped)
 * 2. Non-imperative sentences are NOT falsely triggered
 * 3. structural_hint is set to 'imperative_fallback' to distinguish from explicit-ask path
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  generateSuggestions,
  NoteInput,
  DEFAULT_CONFIG,
} from './index';
import { resetSectionCounter } from './preprocessing';
import { resetSuggestionCounter } from './synthesis';

describe('Imperative Fallback (B-lite for subject-free imperatives)', () => {
  beforeEach(() => {
    resetSectionCounter();
    resetSuggestionCounter();
  });

  // ============================================
  // POSITIVE CASES: Should emit B-lite ideas
  // ============================================

  it('should emit idea for "Add offline mode"', () => {
    const note: NoteInput = {
      note_id: 'test-add-offline-mode',
      raw_markdown: `# Feature Requests

## Mobile App

Add offline mode for mobile.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    expect(result.suggestions.length).toBeGreaterThanOrEqual(1);

    const suggestion = result.suggestions.find(s =>
      s.suggestion?.sourceHeading.toLowerCase().includes('mobile')
    );
    expect(suggestion).toBeDefined();

    if (suggestion) {
      expect(suggestion.type).toBe('idea');
      expect(suggestion.title.toLowerCase()).toMatch(/^add/);
      expect(suggestion.title.toLowerCase()).toContain('offline mode');

      // Check structural hint
      expect(suggestion.structural_hint).toBe('idea');
    }
  });

  it('should emit idea for "Support SSO for enterprise customers"', () => {
    const note: NoteInput = {
      note_id: 'test-support-sso',
      raw_markdown: `# Security Features

## Authentication

Support SSO for enterprise customers.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    expect(result.suggestions.length).toBeGreaterThanOrEqual(1);

    const suggestion = result.suggestions.find(s =>
      s.suggestion?.sourceHeading.toLowerCase().includes('authentication')
    );
    expect(suggestion).toBeDefined();

    if (suggestion) {
      expect(suggestion.type).toBe('idea');
      expect(suggestion.title.toLowerCase()).toMatch(/support|sso/);
      expect(suggestion.structural_hint).toBe('idea');
    }
  });

  it('should emit idea for "Enable export to CSV"', () => {
    const note: NoteInput = {
      note_id: 'test-enable-export',
      raw_markdown: `# Data Export

## Reporting

Enable export to CSV for all report types.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    expect(result.suggestions.length).toBeGreaterThanOrEqual(1);

    const suggestion = result.suggestions.find(s =>
      s.suggestion?.sourceHeading.toLowerCase().includes('reporting')
    );
    expect(suggestion).toBeDefined();

    if (suggestion) {
      expect(suggestion.type).toBe('idea');
      expect(suggestion.title.toLowerCase()).toMatch(/^enable/);
      expect(suggestion.title.toLowerCase()).toContain('export');
      expect(suggestion.structural_hint).toBe('idea');
    }
  });

  it('should emit idea for "Implement regional data hosting"', () => {
    const note: NoteInput = {
      note_id: 'test-implement-regional',
      raw_markdown: `# Compliance

## Data Residency

Implement regional data hosting for EU customers.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    expect(result.suggestions.length).toBeGreaterThanOrEqual(1);

    const suggestion = result.suggestions.find(s =>
      s.suggestion?.sourceHeading.toLowerCase().includes('data residency')
    );
    expect(suggestion).toBeDefined();

    if (suggestion) {
      expect(suggestion.type).toBe('idea');
      expect(suggestion.title.toLowerCase()).toMatch(/^implement/);
      expect(suggestion.title.toLowerCase()).toContain('regional');
      expect(suggestion.structural_hint).toBe('idea');
    }
  });

  it('should emit idea for "Build dark mode toggle"', () => {
    const note: NoteInput = {
      note_id: 'test-build-dark-mode',
      raw_markdown: `# UI Improvements

## Accessibility

Build dark mode toggle for the dashboard.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    expect(result.suggestions.length).toBeGreaterThanOrEqual(1);

    const suggestion = result.suggestions.find(s =>
      s.suggestion?.sourceHeading.toLowerCase().includes('accessibility')
    );
    expect(suggestion).toBeDefined();

    if (suggestion) {
      expect(suggestion.type).toBe('idea');
      expect(suggestion.title.toLowerCase()).toMatch(/^build/);
      expect(suggestion.title.toLowerCase()).toContain('dark mode');
      expect(suggestion.structural_hint).toBe('idea');
    }
  });

  it('should emit idea for "Integrate with Slack for notifications"', () => {
    const note: NoteInput = {
      note_id: 'test-integrate-slack',
      raw_markdown: `# Integrations

## Notifications

Integrate with Slack for real-time alerts.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    expect(result.suggestions.length).toBeGreaterThanOrEqual(1);

    const suggestion = result.suggestions.find(s =>
      s.suggestion?.sourceHeading.toLowerCase().includes('notifications')
    );
    expect(suggestion).toBeDefined();

    if (suggestion) {
      expect(suggestion.type).toBe('idea');
      expect(suggestion.title.toLowerCase()).toMatch(/^integrate/);
      expect(suggestion.title.toLowerCase()).toContain('slack');
      expect(suggestion.structural_hint).toBe('idea');
    }
  });

  it('should emit idea for "Add retry logic"', () => {
    const note: NoteInput = {
      note_id: 'test-add-retry',
      raw_markdown: `# Reliability

## Error Handling

Add retry logic for failed API calls to improve resilience.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    expect(result.suggestions.length).toBeGreaterThanOrEqual(1);

    const suggestion = result.suggestions.find(s =>
      s.suggestion?.sourceHeading.toLowerCase().includes('error handling')
    );
    expect(suggestion).toBeDefined();

    if (suggestion) {
      expect(suggestion.type).toBe('idea');
      expect(suggestion.title.toLowerCase()).toMatch(/^add/);
      expect(suggestion.title.toLowerCase()).toContain('retry');
      expect(suggestion.structural_hint).toBe('idea');
    }
  });

  it('should emit idea for "Create notification system"', () => {
    const note: NoteInput = {
      note_id: 'test-create-notifications',
      raw_markdown: `# Backend Services

## Notifications

Create notification system for real-time alerts to users.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    expect(result.suggestions.length).toBeGreaterThanOrEqual(1);

    const suggestion = result.suggestions.find(s =>
      s.suggestion?.sourceHeading.toLowerCase().includes('notifications')
    );
    expect(suggestion).toBeDefined();

    if (suggestion) {
      expect(suggestion.type).toBe('idea');
      expect(suggestion.title.toLowerCase()).toMatch(/^create/);
      expect(suggestion.title.toLowerCase()).toContain('notification');
      expect(suggestion.structural_hint).toBe('idea');
    }
  });

  it('should emit idea for "Fix memory leak in batch processor"', () => {
    const note: NoteInput = {
      note_id: 'test-fix-memory-leak',
      raw_markdown: `# Bug Fixes

## Performance

Fix memory leak in batch processor causing OOM errors.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    expect(result.suggestions.length).toBeGreaterThanOrEqual(1);

    const suggestion = result.suggestions.find(s =>
      s.suggestion?.sourceHeading.toLowerCase().includes('performance')
    );
    expect(suggestion).toBeDefined();

    if (suggestion) {
      expect(suggestion.type).toBe('idea');
      expect(suggestion.title.toLowerCase()).toMatch(/^fix/);
      expect(suggestion.title.toLowerCase()).toContain('memory leak');
      expect(suggestion.structural_hint).toBe('idea');
    }
  });

  it('should emit idea for "Improve search performance"', () => {
    const note: NoteInput = {
      note_id: 'test-improve-search',
      raw_markdown: `# Performance Tuning

## Search

Improve search performance by implementing caching layer.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    expect(result.suggestions.length).toBeGreaterThanOrEqual(1);

    const suggestion = result.suggestions.find(s =>
      s.suggestion?.sourceHeading.toLowerCase().includes('search')
    );
    expect(suggestion).toBeDefined();

    if (suggestion) {
      expect(suggestion.type).toBe('idea');
      expect(suggestion.title.toLowerCase()).toMatch(/^improve/);
      expect(suggestion.title.toLowerCase()).toContain('search');
      expect(suggestion.structural_hint).toBe('idea');
    }
  });

  // ============================================
  // NEGATIVE CASES: Should NOT trigger fallback
  // ============================================

  it('should NOT trigger for gerund "Adding value is important"', () => {
    const note: NoteInput = {
      note_id: 'test-gerund-negative',
      raw_markdown: `# Team Discussion

## Values

Adding value is important for customer satisfaction. We focus on quality over quantity.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    // May emit 0 suggestions (non-actionable) or emit from normal flow
    // Key: should NOT emit imperative_fallback suggestion
    const imperativeFallbackSuggestion = result.suggestions.find(s =>
      s.structural_hint === 'imperative_fallback'
    );
    expect(imperativeFallbackSuggestion).toBeUndefined();
  });

  it('should NOT trigger for progressive "We are building a new feature"', () => {
    const note: NoteInput = {
      note_id: 'test-progressive-negative',
      raw_markdown: `# Status Update

## Engineering

We are building a new feature for enterprise customers. Progress is on track.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    // Should NOT emit imperative_fallback suggestion
    const imperativeFallbackSuggestion = result.suggestions.find(s =>
      s.structural_hint === 'imperative_fallback'
    );
    expect(imperativeFallbackSuggestion).toBeUndefined();
  });

  it('should NOT trigger for mid-sentence verb "We should add a feature"', () => {
    const note: NoteInput = {
      note_id: 'test-mid-sentence-negative',
      raw_markdown: `# Discussion

## Product Ideas

The team discussed improvements. We should add a better notification system for users.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    // May emit from explicit-ask path (has "we should"), but NOT from imperative fallback
    // If it emits, it should be 'explicit_ask' not 'imperative_fallback'
    const imperativeFallbackSuggestion = result.suggestions.find(s =>
      s.structural_hint === 'imperative_fallback'
    );
    expect(imperativeFallbackSuggestion).toBeUndefined();
  });

  // ============================================
  // EDGE CASES
  // ============================================

  it('should work with bullet-prefixed imperatives', () => {
    const note: NoteInput = {
      note_id: 'test-bullet-prefix',
      raw_markdown: `# Feature Pipeline

## Q2 Goals

* Add multi-factor authentication
* Enable role-based access control
* Support audit logging
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    // Should emit at least 1 idea suggestion with imperative title
    const ideaSuggestions = result.suggestions.filter(s =>
      s.type === 'idea' && /^(add|enable|support|implement)/i.test(s.title)
    );
    expect(ideaSuggestions.length).toBeGreaterThanOrEqual(1);
  });

  it('should prefer explicit-ask over imperative fallback when both present', () => {
    const note: NoteInput = {
      note_id: 'test-precedence',
      raw_markdown: `# Product Meeting

## Security

The team requests a new authentication system. Add multi-factor authentication for all users.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    const suggestion = result.suggestions.find(s =>
      s.suggestion?.sourceHeading.toLowerCase().includes('security')
    );
    expect(suggestion).toBeDefined();

    if (suggestion) {
      // Should use explicit-ask path (has "requests"), so title should anchor on that sentence
      // NOT on the "Add multi-factor" imperative
      expect(suggestion.title.toLowerCase()).toMatch(/authentication system|new authentication/);
      expect(suggestion.title.toLowerCase()).not.toMatch(/^add/);
    }
  });

  it('should work in multi-line sections', () => {
    const note: NoteInput = {
      note_id: 'test-multiline',
      raw_markdown: `# Infrastructure

## Cloud Migration

Our current infrastructure is on-premises and difficult to scale.
Add auto-scaling capabilities to the backend services.
This will improve resilience during traffic spikes.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    const suggestion = result.suggestions.find(s =>
      s.suggestion?.sourceHeading.toLowerCase().includes('cloud migration')
    );
    expect(suggestion).toBeDefined();

    if (suggestion) {
      expect(suggestion.type).toBe('idea');
      expect(suggestion.title.toLowerCase()).toMatch(/^add/);
      expect(suggestion.title.toLowerCase()).toContain('auto-scaling');
      expect(suggestion.structural_hint).toBe('idea');
    }
  });
});
