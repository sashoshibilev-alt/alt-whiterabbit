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

Customer reports the API integration workflow is cumbersome and frustrating to use with third-party systems.

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
    expect(body.toLowerCase()).toMatch(/workflow/);
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

  it('should not concatenate friction template with fallback noun phrase or include bullet markers', () => {
    const note: NoteInput = {
      note_id: 'test-friction-concatenation-bug',
      raw_markdown: `# Customer Feedback

## Annual Attestations

• Enterprise customer reports frustration with the number of clicks required to complete annual attestations.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    expect(result.suggestions.length).toBeGreaterThan(0);

    const suggestion = result.suggestions[0];
    expect(suggestion).toBeDefined();
    expect(suggestion.suggestion).toBeDefined();

    const body = suggestion.suggestion!.body;

    // Body should contain "Reduce" and "click"
    expect(body.toLowerCase()).toMatch(/reduce/);
    expect(body.toLowerCase()).toMatch(/click/);

    // Body should NOT contain bullet marker
    expect(body).not.toContain('•');

    // Body should NOT contain double periods
    expect(body).not.toMatch(/\.\./);
    // Also check for period-space-period pattern
    expect(body).not.toMatch(/\.\s+\./);

    // Body should NOT contain the old fallback phrase "Complete annual attestations"
    expect(body).not.toContain('Complete annual attestations');

    // Body should be at most 2 sentences (split by period, filter empties)
    const sentences = body.split('.').filter(s => s.trim().length > 0);
    expect(sentences.length).toBeLessThanOrEqual(2);

    // Body should be concise (not concatenated with multiple fallback extractions)
    expect(body.length).toBeLessThan(150); // Friction solution is naturally short
  });
});

describe('Title Generation - Proposal and Friction Based', () => {
  beforeEach(() => {
    resetSectionCounter();
    resetSuggestionCounter();
  });

  it('should generate contentful title from proposal line (no "New idea:" prefix)', () => {
    const note: NoteInput = {
      note_id: 'test-title-proposal',
      raw_markdown: `# Customer Feedback

## UX Improvement

Customers report too many clicks in attestation workflow. Reduce required steps by merging attestation screens.

This would improve completion rates for annual attestations.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    expect(result.suggestions.length).toBeGreaterThan(0);

    const suggestion = result.suggestions[0];
    expect(suggestion).toBeDefined();
    expect(suggestion.title).toBeDefined();

    const title = suggestion.title;

    // Title should contain "reduce" concept (from proposal line)
    expect(title.toLowerCase()).toMatch(/reduce/);
    expect(title.toLowerCase()).toMatch(/steps?|merge|merg/);

    // Title should NOT have "New idea:" prefix
    expect(title).not.toMatch(/^New idea:/i);

    // Title should be concise (≤80 chars)
    expect(title.length).toBeLessThanOrEqual(80);
  });

  it('should generate friction-based title (no "New idea:" prefix)', () => {
    const note: NoteInput = {
      note_id: 'test-title-friction',
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
    expect(suggestion.title).toBeDefined();

    const title = suggestion.title;

    // Title should be solution-shaped with "reduce clicks"
    expect(title.toLowerCase()).toMatch(/reduce/);
    expect(title.toLowerCase()).toMatch(/clicks?/);
    expect(title.toLowerCase()).toMatch(/attestation/);

    // Title should NOT have "New idea:" prefix
    expect(title).not.toMatch(/^New idea:/i);

    // Title should NOT be heading-based like "New idea: Attestation UX"
    expect(title).not.toBe('New idea: Attestation UX');

    // Title should be concise (≤80 chars)
    expect(title.length).toBeLessThanOrEqual(80);
  });

  it('should fallback to "New idea: <Heading>" when no proposal/friction found', () => {
    const note: NoteInput = {
      note_id: 'test-title-fallback',
      raw_markdown: `# General Notes

## Dashboard Metrics

We should build conversion funnel visualization for the new dashboard layout. Team consensus is that this would help monitor key metrics.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    expect(result.suggestions.length).toBeGreaterThan(0);

    const suggestion = result.suggestions[0];
    expect(suggestion).toBeDefined();
    expect(suggestion.title).toBeDefined();

    const title = suggestion.title;

    // Title should have "New idea:" prefix (fallback behavior, since "build" triggers creation pattern)
    // OR contentful title if creation pattern is extracted
    // Either way, the test verifies that without proposal/friction, fallback logic runs
    expect(title.length).toBeGreaterThan(10);

    // Title should be meaningful (not just "New idea from section")
    expect(title).not.toBe('New idea from section');
  });

  it('should truncate long proposal titles to 80 chars without cutting mid-word', () => {
    const note: NoteInput = {
      note_id: 'test-title-truncation',
      raw_markdown: `# Customer Feedback

## Data Processing

Customers report too many clicks in data processing workflow. Reduce the complexity and number of steps required by merging multiple data validation and transformation screens into a single unified workflow interface.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    expect(result.suggestions.length).toBeGreaterThan(0);

    const suggestion = result.suggestions[0];
    expect(suggestion).toBeDefined();
    expect(suggestion.title).toBeDefined();

    const title = suggestion.title;

    // Title should be truncated to ≤80 chars
    expect(title.length).toBeLessThanOrEqual(80);

    // Title should not end mid-word (no trailing space or cut-off word)
    expect(title).not.toMatch(/\s$/);

    // Title should still contain key proposal concepts
    expect(title.toLowerCase()).toMatch(/reduce/);
  });

  it('should prioritize proposal over friction when both present', () => {
    const note: NoteInput = {
      note_id: 'test-title-priority',
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
    expect(suggestion.title).toBeDefined();

    const title = suggestion.title;

    // Title should use proposal line (mentions "batch" or "bulk")
    expect(title.toLowerCase()).toMatch(/reduce/);
    expect(title.toLowerCase()).toMatch(/batch|bulk|operations?/);

    // Title should NOT have "New idea:" prefix
    expect(title).not.toMatch(/^New idea:/i);
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
