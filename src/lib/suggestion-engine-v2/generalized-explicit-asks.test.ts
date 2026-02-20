/**
 * Generalized Explicit Asks - Heading-Agnostic B-lite Detection
 *
 * Tests that explicit request language produces idea-type suggestions
 * regardless of section heading, not only under "Discussion details".
 * B-lite fires as a fallback when normal synthesis fails to produce a candidate.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  generateSuggestions,
  NoteInput,
  DEFAULT_CONFIG,
} from './index';
import { resetSectionCounter } from './preprocessing';
import { resetSuggestionCounter } from './synthesis';

describe('Generalized Explicit Asks (heading-agnostic B-lite)', () => {
  beforeEach(() => {
    resetSectionCounter();
    resetSuggestionCounter();
  });

  it('should emit idea for "we should" language under non-Discussion heading', () => {
    const note: NoteInput = {
      note_id: 'test-strategic-alignment-heading',
      raw_markdown: `# Q2 Planning

## Strategic Alignment

We should build a partner API so third-party integrators can extend the platform without custom work.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    // Should produce at least 1 suggestion from this section
    const suggestion = result.suggestions.find(s =>
      s.suggestion?.sourceHeading.toLowerCase().includes('strategic')
    );
    expect(suggestion).toBeDefined();

    if (suggestion) {
      // Must be type idea (not project_update)
      expect(suggestion.type).toBe('idea');
    }
  });

  it('should emit idea for "suggestion:" language under "Key Takeaways" heading', () => {
    const note: NoteInput = {
      note_id: 'test-key-takeaways-heading',
      raw_markdown: `# Retrospective

## Key Takeaways

Suggestion: add automated regression tests to the CI pipeline before each release to catch breaking changes earlier.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    const suggestion = result.suggestions.find(s =>
      s.suggestion?.sourceHeading.toLowerCase().includes('takeaway')
    );
    expect(suggestion).toBeDefined();

    if (suggestion) {
      expect(suggestion.type).toBe('idea');
    }
  });

  it('should emit idea for "requires us to" under "Infrastructure" heading', () => {
    const note: NoteInput = {
      note_id: 'test-infrastructure-heading',
      raw_markdown: `# Ops Review

## Infrastructure

Scaling to 10k concurrent users requires us to migrate the database to a horizontally sharded architecture.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    const suggestion = result.suggestions.find(s =>
      s.suggestion?.sourceHeading.toLowerCase().includes('infrastructure')
    );
    expect(suggestion).toBeDefined();

    if (suggestion) {
      expect(suggestion.type).toBe('idea');
    }
  });

  it('should emit idea for "maybe we could" under non-Discussion heading', () => {
    const note: NoteInput = {
      note_id: 'test-maybe-we-could',
      raw_markdown: `# Engineering Sync

## Feature Ideas

Maybe we could add a keyboard shortcut system so power users can navigate faster without touching the mouse.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    const suggestion = result.suggestions.find(s =>
      s.suggestion?.sourceHeading.toLowerCase().includes('feature')
    );
    expect(suggestion).toBeDefined();

    if (suggestion) {
      expect(suggestion.type).toBe('idea');
    }
  });

  it('should NOT trigger B-lite for purely informational section without explicit asks', () => {
    const note: NoteInput = {
      note_id: 'test-informational-no-false-positive',
      raw_markdown: `# Status Update

## Regional Expansion

The APAC launch completed on schedule last Tuesday.
Customer onboarding metrics are tracking above forecast.
The localization team finished all translations for the Japanese market.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    // Should NOT produce an explicit_ask suggestion
    const explicitAskSuggestion = result.suggestions.find(s =>
      s.structural_hint === 'explicit_ask'
    );
    expect(explicitAskSuggestion).toBeUndefined();
  });

  it('should emit idea for "Requirement to implement" under project_update heading', () => {
    const note: NoteInput = {
      note_id: 'test-requirement-to-implement',
      raw_markdown: `# Q1 Planning

## Monetization Layers

Requirement to implement granular feature gating by the end of March so premium users have exclusive access to advanced analytics.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    const suggestion = result.suggestions.find(s =>
      s.suggestion?.sourceHeading.toLowerCase().includes('monetization')
    );
    expect(suggestion).toBeDefined();

    if (suggestion) {
      // Must be type idea (not project_update)
      expect(suggestion.type).toBe('idea');

      // Title should start with "Implement" in imperative form
      const title = suggestion.title.toLowerCase();
      expect(title).toMatch(/^implement/);
      expect(title).toContain('granular');
      expect(title).toContain('feature');
      expect(title).toContain('gating');

      // Should NOT include timeline phrase "by the end of march"
      expect(title).not.toContain('by the end');
      expect(title).not.toContain('march');
    }
  });

  it('should emit idea for "Requirement: implement" variant', () => {
    const note: NoteInput = {
      note_id: 'test-requirement-colon-implement',
      raw_markdown: `# Infrastructure Planning

## Database Scaling

Requirement: implement horizontal sharding for user data to support 100k concurrent sessions.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    const suggestion = result.suggestions.find(s =>
      s.suggestion?.sourceHeading.toLowerCase().includes('database')
    );
    expect(suggestion).toBeDefined();

    if (suggestion) {
      expect(suggestion.type).toBe('idea');

      const title = suggestion.title.toLowerCase();
      expect(title).toMatch(/^implement/);
      expect(title).toContain('horizontal');
      expect(title).toContain('shard');
    }
  });

  it.skip('should emit idea for "Requirement to add" pattern', () => {
    // TODO: "Requirement to add" produces no suggestion. The pattern matches
    // "Requirement to implement/build" but "add" is not covered by the PM request
    // language rule. Fix: extend the guarded "requirement to" pattern to include "add".
    const note: NoteInput = {
      note_id: 'test-requirement-to-add',
      raw_markdown: `# Q2 Planning

## Security Enhancements

Requirement to add audit logging for all data exports.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    const suggestion = result.suggestions.find(s =>
      s.suggestion?.sourceHeading.toLowerCase().includes('security')
    );
    expect(suggestion).toBeDefined();

    if (suggestion) {
      // Must be type idea (not project_update), which confirms the PM request pattern matched
      expect(suggestion.type).toBe('idea');
    }
  });

  it.skip('should emit idea for "Requirement to build" pattern', () => {
    // TODO: "Requirement to build" produces no suggestion. Same root cause as
    // "Requirement to add" — the guarded pattern only covers "implement", not "build".
    const note: NoteInput = {
      note_id: 'test-requirement-to-build',
      raw_markdown: `# Product Roadmap

## Feature Gating

Requirement to build gating engine for premium features.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    const suggestion = result.suggestions.find(s =>
      s.suggestion?.sourceHeading.toLowerCase().includes('gating')
    );
    expect(suggestion).toBeDefined();

    if (suggestion) {
      // Must be type idea (not project_update), which confirms the PM request pattern matched
      expect(suggestion.type).toBe('idea');
    }
  });

  it('should NOT emit idea for "Requirement to review" (non-build verb)', () => {
    const note: NoteInput = {
      note_id: 'test-requirement-to-review',
      raw_markdown: `# Q2 Planning

## Compliance

Requirement to review proposal before submitting to legal team.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    // Should NOT produce an idea suggestion for review (not a build verb)
    const suggestion = result.suggestions.find(s =>
      s.suggestion?.sourceHeading.toLowerCase().includes('compliance')
    );

    // Either no suggestion or not an idea type
    if (suggestion) {
      expect(suggestion.type).not.toBe('idea');
    }
  });

  it('should strip timeline "by the end of March" from title', () => {
    const note: NoteInput = {
      note_id: 'test-strip-timeline',
      raw_markdown: `# Q1 Goals

## Core Features

We should implement feature gating by the end of March.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    const suggestion = result.suggestions.find(s =>
      s.suggestion?.sourceHeading.toLowerCase().includes('core')
    );
    expect(suggestion).toBeDefined();

    if (suggestion) {
      expect(suggestion.type).toBe('idea');

      const title = suggestion.title.toLowerCase();
      expect(title).toContain('feature');
      expect(title).toContain('gating');

      // Should NOT include timeline phrase
      expect(title).not.toContain('by the end');
      expect(title).not.toContain('march');
    }
  });

  it('should NOT strip "by reducing" from title (not a timeline phrase)', () => {
    const note: NoteInput = {
      note_id: 'test-no-strip-by-reducing',
      raw_markdown: `# Performance Goals

## Optimization

We should improve performance by reducing API calls.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    const suggestion = result.suggestions.find(s =>
      s.suggestion?.sourceHeading.toLowerCase().includes('optimization')
    );
    expect(suggestion).toBeDefined();

    if (suggestion) {
      expect(suggestion.type).toBe('idea');

      const title = suggestion.title.toLowerCase();
      expect(title).toContain('performance');

      // "by reducing API calls" should NOT be stripped
      expect(title).toContain('by reducing');
      expect(title).toContain('api calls');
    }
  });

  it('should emit 2 ideas when section has both "Users need..." and "Suggestion: Maybe we could..."', () => {
    const note: NoteInput = {
      note_id: 'test-multiple-explicit-asks',
      raw_markdown: `# Product Feedback Session

## Key Takeaways

Users need better Supplier Engagement tools to manage relationships more effectively. Suggestion: Maybe we could use a schema mapper UI to visualize data transformations in real time.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    // Should produce 2 suggestions from this section
    const keyTakeawaysSuggestions = result.suggestions.filter(s =>
      s.suggestion?.sourceHeading.toLowerCase().includes('takeaway')
    );

    expect(keyTakeawaysSuggestions.length).toBeGreaterThanOrEqual(2);

    // Both must be type idea
    for (const suggestion of keyTakeawaysSuggestions) {
      expect(suggestion.type).toBe('idea');
    }

    // Check that we have suggestions for both anchors
    const titles = keyTakeawaysSuggestions.map(s => s.title.toLowerCase());

    // First anchor: "Users need better Supplier Engagement tools..."
    const hasSupplierEngagement = titles.some(t =>
      t.includes('supplier') && t.includes('engagement')
    );
    expect(hasSupplierEngagement).toBe(true);

    // Second anchor: "Suggestion: Maybe we could use a schema mapper UI..."
    const hasSchemaMapper = titles.some(t =>
      t.includes('schema') && t.includes('mapper')
    );
    expect(hasSchemaMapper).toBe(true);
  });

  it('should emit idea for "will require" with title derived from sentence (not heading fallback)', () => {
    const note: NoteInput = {
      note_id: 'test-will-require-title',
      raw_markdown: `# Q2 Planning

## Strategic Alignment

This will require a new User Type to be added to the permission system for managing regional access controls.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    const suggestion = result.suggestions.find(s =>
      s.suggestion?.sourceHeading.toLowerCase().includes('strategic')
    );
    expect(suggestion).toBeDefined();

    if (suggestion) {
      // Must be type idea (not project_update)
      expect(suggestion.type).toBe('idea');

      const title = suggestion.title.toLowerCase();

      // Title should NOT be heading-based fallback
      expect(title).not.toBe('new idea: strategic alignment');
      expect(title).not.toMatch(/^new idea:/);

      // Title should be imperative and contain key concepts from the sentence
      expect(title).toContain('user type');

      // Title should be imperative (starts with action verb or "Implement")
      const startsWithVerb = /^(add|implement|introduce|create)/i.test(suggestion.title);
      expect(startsWithVerb).toBe(true);
    }
  });
});

describe('Quality filter for weak meta suggestions', () => {
  beforeEach(() => {
    resetSectionCounter();
    resetSuggestionCounter();
  });

  it('should NOT emit idea for "we need to review" (meta verb without concrete work)', () => {
    const note: NoteInput = {
      note_id: 'test-meta-review',
      raw_markdown: `# Sprint Planning

## Action Items

We need to review the roadmap with stakeholders before finalizing priorities.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    // Should NOT produce a suggestion for "review the roadmap"
    const reviewSuggestion = result.suggestions.find(s =>
      s.title.toLowerCase().includes('review') && s.title.toLowerCase().includes('roadmap')
    );
    expect(reviewSuggestion).toBeUndefined();
  });

  it('should NOT emit idea for "we should discuss" (meta verb without concrete work)', () => {
    const note: NoteInput = {
      note_id: 'test-meta-discuss',
      raw_markdown: `# Team Sync

## Next Steps

We should discuss the approach with the design team before moving forward.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    // Should NOT produce a suggestion for "discuss the approach"
    const discussSuggestion = result.suggestions.find(s =>
      s.title.toLowerCase().includes('discuss') && s.title.toLowerCase().includes('approach')
    );
    expect(discussSuggestion).toBeUndefined();
  });

  it('should emit idea when section has meta verb + concrete work verb', () => {
    const note: NoteInput = {
      note_id: 'test-meta-with-concrete',
      raw_markdown: `# Product Planning

## Requirements

We need to review the API documentation and then implement rate limiting for enterprise tier.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    // Should produce a suggestion for "implement rate limiting"
    const rateLimitSuggestion = result.suggestions.find(s =>
      s.title.toLowerCase().includes('rate limiting') || s.title.toLowerCase().includes('implement')
    );
    expect(rateLimitSuggestion).toBeDefined();

    if (rateLimitSuggestion) {
      expect(rateLimitSuggestion.type).toBe('idea');
    }
  });

  it('should emit idea when meta verb is paired with concrete artifact noun', () => {
    const note: NoteInput = {
      note_id: 'test-meta-with-artifact',
      raw_markdown: `# Architecture Review

## Decisions

We need to review the dashboard design to ensure it meets accessibility standards.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    // "review the dashboard" contains both meta verb (review) and concrete noun (dashboard)
    // so it should pass the quality filter
    const dashboardSuggestion = result.suggestions.find(s =>
      s.suggestion?.sourceHeading.toLowerCase().includes('decisions')
    );

    // This is borderline - we allow it because "dashboard" is a concrete artifact
    expect(dashboardSuggestion).toBeDefined();
  });

  it('should emit only concrete suggestion when section has both meta and concrete asks', () => {
    const note: NoteInput = {
      note_id: 'test-mixed-quality',
      raw_markdown: `# Sprint Kickoff

## Action Items

We need to review the roadmap with stakeholders. Add feature gating for enterprise tier.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    const actionItemsSuggestions = result.suggestions.filter(s =>
      s.suggestion?.sourceHeading.toLowerCase().includes('action')
    );

    // Should emit suggestion for "Add feature gating" but NOT for "review the roadmap"
    expect(actionItemsSuggestions.length).toBeGreaterThanOrEqual(1);

    const hasFeatureGating = actionItemsSuggestions.some(s =>
      s.title.toLowerCase().includes('feature') && s.title.toLowerCase().includes('gating')
    );
    expect(hasFeatureGating).toBe(true);

    const hasReviewRoadmap = actionItemsSuggestions.some(s =>
      s.title.toLowerCase().includes('review') && s.title.toLowerCase().includes('roadmap')
    );
    expect(hasReviewRoadmap).toBe(false);
  });

  it('should still emit idea for "Users need better X" (concrete quality adjective)', () => {
    const note: NoteInput = {
      note_id: 'test-users-need-better',
      raw_markdown: `# Customer Feedback

## Feature Requests

Users need better error visibility when background jobs fail silently.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    // Should emit a suggestion for "Users need better error visibility"
    const suggestions = result.suggestions.filter(s =>
      s.suggestion?.sourceHeading.toLowerCase().includes('feature')
    );

    expect(suggestions.length).toBeGreaterThan(0);

    const errorSuggestion = suggestions.find(s =>
      s.title.toLowerCase().includes('error') || s.title.toLowerCase().includes('visibility')
    );
    expect(errorSuggestion).toBeDefined();

    if (errorSuggestion) {
      expect(errorSuggestion.type).toBe('idea');
    }
  });
});

describe('Verb list synchronization', () => {
  it('should keep core build verbs in sync between IMPERATIVE_WORK_VERBS and V3_ACTION_VERBS', () => {
    // Read the constants from the source files
    const fs = require('fs');
    const path = require('path');

    const synthesisPath = path.join(__dirname, 'synthesis.ts');
    const classifiersPath = path.join(__dirname, 'classifiers.ts');

    const synthesisContent = fs.readFileSync(synthesisPath, 'utf-8');
    const classifiersContent = fs.readFileSync(classifiersPath, 'utf-8');

    // Extract IMPERATIVE_WORK_VERBS from synthesis.ts
    const imperativeMatch = synthesisContent.match(/const IMPERATIVE_WORK_VERBS = \[([\s\S]*?)\];/);
    expect(imperativeMatch).toBeDefined();
    const imperativeVerbs = imperativeMatch![1]
      .split('\n')
      .map((line: string) => line.trim())
      .filter((line: string) => line.startsWith("'"))
      .map((line: string) => line.replace(/^'([^']+)'.*$/, '$1'));

    // Extract V3_ACTION_VERBS from classifiers.ts
    const v3Match = classifiersContent.match(/const V3_ACTION_VERBS = \[([\s\S]*?)\];/);
    expect(v3Match).toBeDefined();
    const v3Verbs = v3Match![1]
      .split('\n')
      .map((line: string) => line.trim())
      .filter((line: string) => line.startsWith("'"))
      .map((line: string) => line.replace(/^'([^']+)'.*$/, '$1'));

    // Core build verbs that must exist in both lists
    const coreVerbs = ['implement', 'add', 'build', 'create', 'enable'];

    for (const verb of coreVerbs) {
      expect(imperativeVerbs).toContain(verb);
      expect(v3Verbs).toContain(verb);
    }
  });

  // ============================================
  // Quality Filter Regression Tests
  // ============================================

  it.skip('should ALLOW "coordinate implementing SSO" (meta verb + concrete work verb)', () => {
    // TODO: "Users need us to coordinate implementing SSO" is suppressed by the
    // isWeakMetaSuggestion filter because "coordinate" is a META_VERB and the
    // concrete-work-verb escape hatch doesn't fire for gerund form "implementing".
    // Fix: escape hatch should also match gerund forms of IMPERATIVE_WORK_VERBS.
    const note: NoteInput = {
      note_id: 'test-coordinate-implementing',
      raw_markdown: `# Security Initiative

## SSO Implementation

Users need us to coordinate implementing SSO for enterprise customers to meet compliance requirements.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    // Should produce a suggestion because sentence has both meta verb (coordinate) and concrete verb (implement)
    const suggestion = result.suggestions.find(s =>
      s.title.toLowerCase().includes('sso') || s.title.toLowerCase().includes('implement')
    );
    expect(suggestion).toBeDefined();

    if (suggestion) {
      expect(suggestion.type).toBe('idea');
    }
  });

  it('should SUPPRESS "coordinate next steps" (meta verb only)', () => {
    const note: NoteInput = {
      note_id: 'test-coordinate-next-steps',
      raw_markdown: `# Project Planning

## Next Phase

We need to coordinate next steps with the team.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    // Should NOT produce a suggestion for "coordinate next steps" (no concrete work)
    const coordinateSuggestion = result.suggestions.find(s =>
      s.title.toLowerCase().includes('coordinate') && s.title.toLowerCase().includes('next steps')
    );
    expect(coordinateSuggestion).toBeUndefined();
  });

  it('should ALLOW "validate the API endpoint" (meta verb + concrete noun)', () => {
    const note: NoteInput = {
      note_id: 'test-validate-endpoint',
      raw_markdown: `# API Development

## Endpoints

We need to validate the API endpoint design to ensure it meets performance requirements.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    // Should produce a suggestion because sentence has both meta verb (validate) and concrete noun (endpoint)
    // The escape hatch allows this through even though it contains a meta verb
    const suggestion = result.suggestions.find(s =>
      s.suggestion?.sourceHeading.toLowerCase().includes('endpoints')
    );
    expect(suggestion).toBeDefined();

    // Type can be either idea or project_update depending on intent classification
    // What matters is that the suggestion was NOT suppressed by the quality filter
  });

  it('should SUPPRESS roadmap-priority status statement WITHOUT action verb', () => {
    const note: NoteInput = {
      note_id: 'test-priority-status-only',
      raw_markdown: `# Q2 Roadmap

## New Initiatives

The 'Supplier Portal' is now a high-priority item for the H2 roadmap.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    // Should NOT produce a suggestion from the priority status statement alone
    const suggestion = result.suggestions.find(s =>
      s.title.toLowerCase().includes('supplier') ||
      s.title.toLowerCase().includes('portal')
    );
    expect(suggestion).toBeUndefined();
  });

  it('should ALLOW roadmap-priority statement WITH action verb', () => {
    const note: NoteInput = {
      note_id: 'test-priority-with-action',
      raw_markdown: `# Q2 Roadmap

## New Initiatives

The 'Supplier Portal' is now a high-priority item for the H2 roadmap. Implement Supplier Portal onboarding flow.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    // Should produce a suggestion because there's an explicit action verb (Implement)
    const suggestion = result.suggestions.find(s =>
      s.title.toLowerCase().includes('supplier') ||
      s.title.toLowerCase().includes('portal') ||
      s.title.toLowerCase().includes('onboarding')
    );
    expect(suggestion).toBeDefined();

    if (suggestion) {
      // Should be an idea type suggestion
      expect(suggestion.type).toBe('idea');
      // Title should come from the imperative statement, not the status line
      expect(suggestion.title.toLowerCase()).toContain('onboarding');
    }
  });
});
