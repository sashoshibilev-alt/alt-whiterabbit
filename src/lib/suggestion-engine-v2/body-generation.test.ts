/**
 * Body Generation Regression Tests
 *
 * Tests for idea body generation quality fixes:
 * 1. Friction complaint detection and solution-shaped bodies
 * 2. Role assignment punctuation joining
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  generateSuggestions,
  NoteInput,
  DEFAULT_CONFIG,
} from './index';
import { resetSectionCounter } from './preprocessing';
import { resetSuggestionCounter } from './synthesis';

describe('Body Generation - Friction Complaints', () => {
  beforeEach(() => {
    resetSectionCounter();
    resetSuggestionCounter();
  });

  it('should generate solution-shaped body for clicks friction complaint', () => {
    const note: NoteInput = {
      note_id: 'test-friction-clicks',
      raw_markdown: `# Customer Feedback

## Attestation UX

Enterprise customer reports frustration with the number of clicks required to complete annual attestations.

This is impacting completion rates and causing support burden.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    expect(result.suggestions.length).toBeGreaterThan(0);

    const suggestion = result.suggestions[0];
    expect(suggestion).toBeDefined();
    expect(suggestion.suggestion).toBeDefined();

    const body = suggestion.suggestion!.body;

    // Body should contain "reduce" and reference clicks
    expect(body.toLowerCase()).toMatch(/reduce/);
    expect(body.toLowerCase()).toMatch(/clicks?/);

    // Body should reference the target object (attestation/attestations)
    expect(body.toLowerCase()).toMatch(/attestation/);

    // Body should NOT be the old noun phrase fallback like "Complete annual attestations."
    expect(body).not.toBe('Complete annual attestations.');
  });

  it('should generate solution-shaped body for steps friction complaint', () => {
    const note: NoteInput = {
      note_id: 'test-friction-steps',
      raw_markdown: `# Customer Feedback

## Onboarding Experience

Customer reports that too many steps in the onboarding workflow are causing friction.

Users are abandoning the process before completion. This is impacting activation rates.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    expect(result.suggestions.length).toBeGreaterThan(0);

    const suggestion = result.suggestions[0];
    expect(suggestion).toBeDefined();
    expect(suggestion.suggestion).toBeDefined();

    const body = suggestion.suggestion!.body;

    // Body should contain "reduce" and reference steps
    expect(body.toLowerCase()).toMatch(/reduce/);
    expect(body.toLowerCase()).toMatch(/steps?/);

    // Body should reference the target object (workflow)
    expect(body.toLowerCase()).toMatch(/workflow/);
  });

  it('should generate streamline body for generic friction complaint', () => {
    const note: NoteInput = {
      note_id: 'test-friction-generic',
      raw_markdown: `# Customer Feedback

## API Integration

Customer reports friction with the API integration process for third-party systems.

This is impacting enterprise customers who need to integrate with legacy systems.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    expect(result.suggestions.length).toBeGreaterThan(0);

    const suggestion = result.suggestions[0];
    expect(suggestion).toBeDefined();
    expect(suggestion.suggestion).toBeDefined();

    const body = suggestion.suggestion!.body;

    // Body should contain "streamline" and reference the target object
    expect(body.toLowerCase()).toMatch(/streamline/);
    expect(body.toLowerCase()).toMatch(/process/);
  });

  it('should still use proposal lines when present (no friction heuristic)', () => {
    const note: NoteInput = {
      note_id: 'test-proposal-priority',
      raw_markdown: `# Customer Feedback

## Data Import Workflow

Enterprise customer reports too many clicks required for data imports. Reduce clicks by adding batch operations for bulk data imports.

This would improve efficiency for large dataset imports.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    expect(result.suggestions.length).toBeGreaterThan(0);

    const suggestion = result.suggestions[0];
    expect(suggestion).toBeDefined();
    expect(suggestion.suggestion).toBeDefined();

    const body = suggestion.suggestion!.body;

    // Body should use the proposal line (starts with "Reduce")
    expect(body).toMatch(/^Reduce/);
    expect(body.toLowerCase()).toMatch(/clicks?/);
    expect(body.toLowerCase()).toMatch(/batch/);
  });
});

describe('Body Generation - Role Assignment Punctuation', () => {
  beforeEach(() => {
    resetSectionCounter();
    resetSuggestionCounter();
  });

  it('should not have double punctuation in role assignment bodies', () => {
    const note: NoteInput = {
      note_id: 'test-role-punctuation',
      raw_markdown: `# Action Items

## Sprint Planning

- PM to document requirements and scope.
- Design to create mockups and prototypes.
- CS to gather customer feedback and pain points.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    expect(result.suggestions.length).toBeGreaterThan(0);

    const suggestion = result.suggestions[0];
    expect(suggestion).toBeDefined();
    expect(suggestion.suggestion).toBeDefined();

    const body = suggestion.suggestion!.body;

    // Body should NOT contain double periods
    expect(body).not.toMatch(/\.\./);

    // Body should still contain at least 2 task lines' content
    expect(body.toLowerCase()).toMatch(/pm to/);
    expect(body.toLowerCase()).toMatch(/design to/);
  });

  it('should handle mixed punctuation in role assignments', () => {
    const note: NoteInput = {
      note_id: 'test-role-mixed-punctuation',
      raw_markdown: `# Next Steps

## Q1 Planning

- PM to finalize roadmap;
- Eng to assess technical feasibility:
- CS to review with enterprise customers.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    expect(result.suggestions.length).toBeGreaterThan(0);

    const suggestion = result.suggestions[0];
    expect(suggestion).toBeDefined();
    expect(suggestion.suggestion).toBeDefined();

    const body = suggestion.suggestion!.body;

    // Body should NOT contain double punctuation
    expect(body).not.toMatch(/\.\./);
    expect(body).not.toMatch(/;./);
    expect(body).not.toMatch(/:./);

    // Body should be properly formatted with single periods
    expect(body).toMatch(/\./);
    expect(body.toLowerCase()).toMatch(/pm to finalize/);
  });

  it('should preserve content when normalizing punctuation', () => {
    const note: NoteInput = {
      note_id: 'test-role-content-preservation',
      raw_markdown: `# Deliverables

## Phase 1

- Product Manager to define success metrics and KPIs.
- Engineering to build MVP and deploy to staging.
- Customer Success to coordinate beta testing with key accounts.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    expect(result.suggestions.length).toBeGreaterThan(0);

    const suggestion = result.suggestions[0];
    expect(suggestion).toBeDefined();
    expect(suggestion.suggestion).toBeDefined();

    const body = suggestion.suggestion!.body;

    // Body should not have double punctuation
    expect(body).not.toMatch(/\.\./);

    // Body should contain meaningful content from multiple lines
    expect(body.toLowerCase()).toMatch(/product manager/);
    expect(body.toLowerCase()).toMatch(/engineering/);

    // Should be within the 300 char limit
    expect(body.length).toBeLessThanOrEqual(300);
  });
});
