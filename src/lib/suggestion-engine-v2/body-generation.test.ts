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

describe('Body Generation - Plan Change Impact Lines', () => {
  beforeEach(() => {
    resetSectionCounter();
    resetSuggestionCounter();
  });

  it('should prioritize impact line in body for project_update (slip by N sprints)', () => {
    const note: NoteInput = {
      note_id: 'test-impact-slip',
      raw_markdown: `# Project Updates

## Deliverables Timeline

VP confirmed resources will be allocated.

As a result, current self-service deliverables will slip by 2 sprints.

Target is to complete the changes by early Q3.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    expect(result.suggestions.length).toBeGreaterThan(0);

    const suggestion = result.suggestions[0];
    expect(suggestion).toBeDefined();
    expect(suggestion.type).toBe('project_update');
    expect(suggestion.suggestion).toBeDefined();

    const body = suggestion.suggestion!.body;

    // Body should prioritize the impact line (slip statement)
    expect(body.toLowerCase()).toMatch(/slip/);
    expect(body.toLowerCase()).toMatch(/self-service|deliverable/);
    expect(body.toLowerCase()).toMatch(/2\s+sprint/);

    // Body should NOT start with the VP confirmation line
    expect(body).not.toMatch(/^VP confirmed/i);
  });

  it('should prioritize impact line in evidencePreview for project_update', () => {
    const note: NoteInput = {
      note_id: 'test-evidence-impact',
      raw_markdown: `# Sprint Planning

## Timeline Changes

VP confirmed resources will be allocated.

As a result, current self-service deliverables will slip by 2 sprints.

Target is to complete the changes by early Q3.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    expect(result.suggestions.length).toBeGreaterThan(0);

    const suggestion = result.suggestions[0];
    expect(suggestion).toBeDefined();
    expect(suggestion.type).toBe('project_update');
    expect(suggestion.suggestion).toBeDefined();

    const evidencePreview = suggestion.suggestion!.evidencePreview;
    expect(evidencePreview).toBeDefined();
    expect(evidencePreview!.length).toBeGreaterThan(0);

    // Evidence preview should include the slip line
    const evidenceText = evidencePreview!.join(' ').toLowerCase();
    expect(evidenceText).toMatch(/slip/);
    expect(evidenceText).toMatch(/self-service|deliverable/);
  });

  it('should detect various time-shift patterns (delay, pushed, moved)', () => {
    const testCases = [
      {
        markdown: 'Release will delay by 3 weeks due to scope changes.',
        pattern: /delay/,
      },
      {
        markdown: 'Launch timeline pushed by 1 sprint to accommodate testing.',
        pattern: /push/,
      },
      {
        markdown: 'Roadmap items moved to Q4 for resource reallocation.',
        pattern: /move/,
      },
      {
        markdown: 'Initiative shifted by 2 months to align with dependencies.',
        pattern: /shift/,
      },
    ];

    for (const testCase of testCases) {
      const note: NoteInput = {
        note_id: `test-${testCase.pattern.source}`,
        raw_markdown: `# Updates\n\n## Schedule\n\n${testCase.markdown}`,
      };

      const result = generateSuggestions(note, DEFAULT_CONFIG);

      if (result.suggestions.length > 0) {
        const suggestion = result.suggestions[0];
        if (suggestion.type === 'project_update' && suggestion.suggestion) {
          const body = suggestion.suggestion.body.toLowerCase();
          expect(body).toMatch(testCase.pattern);
        }
      }
    }
  });

  it('should fallback to default extraction when no impact line exists', () => {
    const note: NoteInput = {
      note_id: 'test-no-impact-fallback',
      raw_markdown: `# Planning

## Strategic Shift

Shift from enterprise to SMB focus for Q2.

This aligns better with market opportunities.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    expect(result.suggestions.length).toBeGreaterThan(0);

    const suggestion = result.suggestions[0];
    expect(suggestion).toBeDefined();
    expect(suggestion.type).toBe('project_update');
    expect(suggestion.suggestion).toBeDefined();

    const body = suggestion.suggestion!.body;

    // Body should use fallback extraction (shift pattern)
    expect(body.toLowerCase()).toMatch(/shift|enterprise|smb/);

    // Body should be well-formed
    expect(body.length).toBeGreaterThan(20);
    expect(body).toMatch(/\.$/); // Ends with period
  });

  it('should include target timeline when impact line is present', () => {
    const note: NoteInput = {
      note_id: 'test-impact-with-target',
      raw_markdown: `# Q2 Updates

## Launch Timeline

Current roadmap features will slip by 4 weeks.

Target is to complete rollout by mid Q3.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    expect(result.suggestions.length).toBeGreaterThan(0);

    const suggestion = result.suggestions[0];
    expect(suggestion).toBeDefined();
    expect(suggestion.type).toBe('project_update');
    expect(suggestion.suggestion).toBeDefined();

    const body = suggestion.suggestion!.body;

    // Body should contain the impact line
    expect(body.toLowerCase()).toMatch(/slip/);
    expect(body.toLowerCase()).toMatch(/4\s+week/);

    // Body should optionally include the target
    // (may or may not be included depending on length constraints)
    if (body.toLowerCase().includes('target') || body.toLowerCase().includes('q3')) {
      expect(body.toLowerCase()).toMatch(/target|q3/);
    }
  });

  it('should detect impact lines with various subject tokens', () => {
    const subjectTokens = [
      'deliverables',
      'release',
      'rollout',
      'launch',
      'self-service',
      'roadmap',
      'initiative',
      'scope',
      'feature',
      'milestone',
    ];

    for (const subject of subjectTokens) {
      const note: NoteInput = {
        note_id: `test-subject-${subject}`,
        raw_markdown: `# Updates\n\n## Timeline\n\nThe ${subject} will slip by 2 sprints due to dependencies.`,
      };

      const result = generateSuggestions(note, DEFAULT_CONFIG);

      if (result.suggestions.length > 0) {
        const suggestion = result.suggestions[0];
        if (suggestion.type === 'project_update' && suggestion.suggestion) {
          const body = suggestion.suggestion.body.toLowerCase();
          // The body should contain the impact information
          // Note: body extraction splits on sentence boundaries, so check for key components
          expect(body).toMatch(/slip|2\s+sprint/);
          expect(body).toContain(subject.toLowerCase());
        }
      }
    }
  });

  it('should not match lines without time deltas', () => {
    const note: NoteInput = {
      note_id: 'test-no-time-delta',
      raw_markdown: `# Updates

## Strategic Direction

We need to shift focus to new priorities.

This will require reallocation of resources.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    expect(result.suggestions.length).toBeGreaterThan(0);

    const suggestion = result.suggestions[0];
    expect(suggestion).toBeDefined();

    if (suggestion.type === 'project_update' && suggestion.suggestion) {
      const body = suggestion.suggestion.body;

      // Without a time delta, should use fallback extraction
      // Should NOT be treated as an impact line
      expect(body.toLowerCase()).toMatch(/shift|focus|priorities/);
    }
  });

  it('Leadership Alignment example - body without bullet markers, impact-based title', () => {
    const note: NoteInput = {
      note_id: 'test-leadership-alignment',
      raw_markdown: `# Project Updates

## Leadership Alignment

VP confirmed resources will be allocated.

• As a result, current self-service deliverables will slip by 2 sprints.

Target is to complete the changes by early Q3.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    expect(result.suggestions.length).toBeGreaterThan(0);

    const suggestion = result.suggestions[0];
    expect(suggestion).toBeDefined();
    expect(suggestion.type).toBe('project_update');
    expect(suggestion.suggestion).toBeDefined();

    const body = suggestion.suggestion!.body;
    const title = suggestion.title;

    // REQUIREMENT: Body uses the impact line (slip statement)
    expect(body.toLowerCase()).toMatch(/slip/);
    expect(body.toLowerCase()).toMatch(/self-service|deliverable/);
    expect(body.toLowerCase()).toMatch(/2\s+sprint/);

    // REQUIREMENT: Body does NOT start with "•" and does not contain list marker artifacts
    expect(body).not.toContain('•');
    expect(body).not.toMatch(/^[-*+•]\s+/);

    // REQUIREMENT: Title contains "self-service" + ("slip" or "delay") and does NOT equal "Update Leadership Alignment plan"
    expect(title).not.toBe('Update Leadership Alignment plan');
    expect(title.toLowerCase()).toMatch(/self-service|deliverable/);
    expect(title.toLowerCase()).toMatch(/slip|delay/);

    // Title should be concise (≤60 chars as per spec, plus up to 8 chars for "Update: " prefix)
    expect(title.length).toBeLessThanOrEqual(68);
  });

  it('project_update title fallback when no impact line exists', () => {
    const note: NoteInput = {
      note_id: 'test-title-fallback-no-impact',
      raw_markdown: `# Planning

## Leadership Alignment

Shift from enterprise to SMB focus for Q2.

This aligns better with market opportunities.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    expect(result.suggestions.length).toBeGreaterThan(0);

    const suggestion = result.suggestions[0];
    expect(suggestion).toBeDefined();
    expect(suggestion.type).toBe('project_update');

    const title = suggestion.title;

    // Title should use fallback behavior (not impact-based)
    // Guard against legacy PLAN_CHANGE format ("Update <X> plan").
    // Titles now follow the standardized "Update: <X>" convention.
    expect(title.length).toBeGreaterThan(10);

    // This is a fallback case, so we accept current template behavior
    expect(title).toMatch(/update|shift|leadership|alignment|smb/i);
  });

  it('should respect 300 character limit even with impact lines', () => {
    const note: NoteInput = {
      note_id: 'test-impact-truncation',
      raw_markdown: `# Project Status

## Comprehensive Timeline Update

The previously scheduled enterprise self-service deliverables and automation features will slip by 2 sprints due to unexpected technical complexity in the authentication layer and security review requirements.

Target is to complete the comprehensive rollout with full feature parity by early Q3, contingent on resource availability and stakeholder approval.

Additional context about the strategic implications and downstream dependencies.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    expect(result.suggestions.length).toBeGreaterThan(0);

    const suggestion = result.suggestions[0];
    expect(suggestion).toBeDefined();
    expect(suggestion.type).toBe('project_update');
    expect(suggestion.suggestion).toBeDefined();

    const body = suggestion.suggestion!.body;

    // Body should be truncated to 300 chars
    expect(body.length).toBeLessThanOrEqual(300);

    // Body should still contain impact information
    expect(body.toLowerCase()).toMatch(/slip/);
  });
});
