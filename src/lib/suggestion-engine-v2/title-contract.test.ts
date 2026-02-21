/**
 * Unit tests for enforceTitleContract
 *
 * Verifies that:
 * - Pronoun-only / generic-only titles are replaced with deterministic fallbacks.
 * - The canonical gold title "Update: V1 launch 12th → 19th" passes unchanged.
 * - No emitted title equals or matches the "Update: Discussion They" pattern.
 * - Fallback content is derived from evidence span tokens (never invented).
 */

import { describe, it, expect } from 'vitest';
import { enforceTitleContract, normalizeTitlePrefix } from './title-normalization';
import type { EvidenceSpan } from './types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function span(text: string): EvidenceSpan {
  return { start_line: 0, end_line: 0, text };
}

// ---------------------------------------------------------------------------
// Contract: Pronoun-only / generic-only titles must be replaced
// ---------------------------------------------------------------------------

describe('enforceTitleContract — pronoun-only content', () => {
  it('replaces "Update: Discussion They" with a fallback (the canonical regression case)', () => {
    const result = enforceTitleContract(
      'project_update',
      'Update: Discussion They',
      [span('We are looking at a 4-week delay due to infrastructure work.')]
    );
    expect(result).not.toBe('Update: Discussion They');
    expect(result).not.toMatch(/Discussion\s+They/i);
    // The fallback must be non-empty and derived
    expect(result.length).toBeGreaterThan(0);
  });

  it('replaces a title whose content is only pronouns', () => {
    const result = enforceTitleContract(
      'project_update',
      'Update: They We',
      [span('The CloudScale API integration is delayed by 2 weeks.')]
    );
    expect(result).not.toMatch(/^Update:\s*They\s+We\s*$/i);
  });

  it('replaces a title whose content is a single generic word "Discussion"', () => {
    const result = enforceTitleContract(
      'project_update',
      'Update: Discussion',
      [span('Partnership with CloudScale is at risk due to GDPR compliance requirements.')]
    );
    expect(result).not.toMatch(/^Update:\s*Discussion\s*$/i);
    expect(result.length).toBeGreaterThan('Update: '.length);
  });

  it('replaces a title whose content is "General update"', () => {
    const result = enforceTitleContract(
      'project_update',
      'Update: General',
      [span('Launch delayed to Q3 due to infra delays.')]
    );
    expect(result).not.toMatch(/^Update:\s*General\s*$/i);
  });
});

// ---------------------------------------------------------------------------
// Contract: Canonical gold title must pass unchanged
// ---------------------------------------------------------------------------

describe('enforceTitleContract — canonical gold title must pass', () => {
  it('passes "Update: V1 launch 12th → 19th" unchanged', () => {
    const result = enforceTitleContract(
      'project_update',
      'Update: V1 launch 12th → 19th',
      [span("We're pushing the V1 launch from the 12th to the 19th due to infra delays.")]
    );
    expect(result).toBe('Update: V1 launch 12th → 19th');
  });

  it('passes a risk title with concrete entity unchanged', () => {
    const result = enforceTitleContract(
      'risk',
      'GDPR compliance risk for German nodes',
      [span("If we can't prove GDPR compliance for their German nodes, the partnership is dead in the water.")]
    );
    expect(result).toBe('GDPR compliance risk for German nodes');
  });

  it('passes a rich idea title unchanged', () => {
    const result = enforceTitleContract(
      'idea',
      'Add CSV export feature for enterprise trials',
      [span('Sales is screaming for the CSV export feature — every enterprise trial asks for it.')]
    );
    expect(result).toBe('Add CSV export feature for enterprise trials');
  });

  it('passes a bug title unchanged', () => {
    const result = enforceTitleContract(
      'bug',
      'Fix latency issue in global view for APAC users',
      [span('The trial is failing because of latency in the global view.')]
    );
    expect(result).toBe('Fix latency issue in global view for APAC users');
  });
});

// ---------------------------------------------------------------------------
// Contract: Fallback is grounded in evidence tokens (not invented)
// ---------------------------------------------------------------------------

describe('enforceTitleContract — fallback grounded in evidence', () => {
  it('project_update fallback uses entity from evidence when delta is present', () => {
    const result = enforceTitleContract(
      'project_update',
      'Update: They',
      [span("CloudScale API integration delayed by 4-week handshake protocol review.")]
    );
    // Must mention the entity or delta from the evidence
    expect(result).not.toBe('Update: They');
    // Either "CloudScale" or "4-week" or similar must appear
    const hasGroundedContent =
      /cloudscale|4-week|delayed|timeline/i.test(result);
    expect(hasGroundedContent).toBe(true);
  });

  it('risk fallback uses entity from evidence', () => {
    const result = enforceTitleContract(
      'risk',
      'Risk: They',
      [span("GDPR compliance requirement for German nodes may block the partnership.")]
    );
    expect(result).not.toMatch(/^Risk:\s*They\s*$/i);
    expect(/gdpr|compliance|german|partnership/i.test(result)).toBe(true);
  });

  it('idea fallback uses entity from evidence', () => {
    const result = enforceTitleContract(
      'idea',
      'This',
      [span('CSV export feature requested by enterprise customers.')]
    );
    expect(/csv|export|enterprise|feature/i.test(result)).toBe(true);
  });

  it('bug fallback uses entity from evidence', () => {
    const result = enforceTitleContract(
      'bug',
      'We this',
      [span('Latency regression in the APAC global view endpoint.')]
    );
    expect(/latency|apac|global|regression|endpoint/i.test(result)).toBe(true);
  });

  it('falls back gracefully to type-generic message when evidence has no entities', () => {
    const result = enforceTitleContract(
      'project_update',
      'Update: They We',
      [] // no evidence spans
    );
    expect(result).toBe('Update: Timeline adjustment identified');
  });

  it('risk: falls back to "Risk identified" when no entity in empty evidence', () => {
    const result = enforceTitleContract('risk', 'They', []);
    expect(result).toBe('Risk identified');
  });

  it('idea: falls back to "Idea identified" when no entity in empty evidence', () => {
    const result = enforceTitleContract('idea', 'This', []);
    expect(result).toBe('Idea identified');
  });

  it('bug: falls back to "Bug identified" when no entity in empty evidence', () => {
    const result = enforceTitleContract('bug', 'We', []);
    expect(result).toBe('Bug identified');
  });
});

// ---------------------------------------------------------------------------
// Contract: Regression guard — no emitted title matches the bad pattern
// ---------------------------------------------------------------------------

describe('enforceTitleContract — regression: "Update: Discussion They" pattern', () => {
  it('does not emit a title matching "Update: <generic> <pronoun>"', () => {
    const candidates = [
      'Update: Discussion They',
      'Update: General We',
      'Update: Discussion',
      'Update: They We',
      'Update: This that',
      'Risk: They',
      'Idea: This',
    ];

    for (const raw of candidates) {
      const type =
        raw.startsWith('Risk') ? 'risk' :
        raw.startsWith('Idea') ? 'idea' : 'project_update';

      const result = enforceTitleContract(
        type as 'project_update' | 'risk' | 'idea' | 'bug',
        raw,
        [span('The auth-token bloat is causing a 4-week delay before the annual conference.')]
      );

      // The output must not be one of the known-bad patterns
      expect(result).not.toMatch(/^(?:Update|Risk|Idea):\s*(?:Discussion|General)\s+(?:They|We|This|That)\s*$/i);
      expect(result).not.toMatch(/^(?:Update|Risk|Idea):\s*(?:They|We|This|That)\s*$/i);
      expect(result.length).toBeGreaterThan(5);
    }
  });
});

// ---------------------------------------------------------------------------
// normalizeTitlePrefix — per-type prefix assignment
// ---------------------------------------------------------------------------

describe('normalizeTitlePrefix — title without prefix gets prefixed correctly', () => {
  it('project_update: bare title gets "Update:" prefix', () => {
    expect(normalizeTitlePrefix('project_update', 'V1 launch delayed to Q3'))
      .toBe('Update: V1 launch delayed to Q3');
  });

  it('plan_change: bare title gets "Update:" prefix', () => {
    expect(normalizeTitlePrefix('plan_change', 'Sprint scope reduced'))
      .toBe('Update: Sprint scope reduced');
  });

  it('risk: bare title gets "Risk:" prefix', () => {
    expect(normalizeTitlePrefix('risk', 'GDPR compliance gap for German nodes'))
      .toBe('Risk: GDPR compliance gap for German nodes');
  });

  it('idea: bare title gets "Idea:" prefix', () => {
    expect(normalizeTitlePrefix('idea', 'Add CSV export for enterprise trials'))
      .toBe('Idea: Add CSV export for enterprise trials');
  });

  it('bug: bare title gets "Bug:" prefix', () => {
    expect(normalizeTitlePrefix('bug', 'Latency regression in APAC global view'))
      .toBe('Bug: Latency regression in APAC global view');
  });
});

describe('normalizeTitlePrefix — mismatched prefix is replaced', () => {
  it('risk title with "Update:" prefix → replaced with "Risk:"', () => {
    expect(normalizeTitlePrefix('risk', 'Update: GDPR compliance gap'))
      .toBe('Risk: GDPR compliance gap');
  });

  it('idea title with "Risk:" prefix → replaced with "Idea:"', () => {
    expect(normalizeTitlePrefix('idea', 'Risk: CSV export feature'))
      .toBe('Idea: CSV export feature');
  });

  it('bug title with "Update:" prefix → replaced with "Bug:"', () => {
    expect(normalizeTitlePrefix('bug', 'Update: latency in APAC'))
      .toBe('Bug: latency in APAC');
  });

  it('project_update title with "Risk:" prefix → replaced with "Update:"', () => {
    expect(normalizeTitlePrefix('project_update', 'Risk: launch slipped to Q3'))
      .toBe('Update: launch slipped to Q3');
  });
});

describe('normalizeTitlePrefix — no double prefixes (idempotent)', () => {
  it('applying twice to project_update does not double "Update:"', () => {
    const once = normalizeTitlePrefix('project_update', 'V1 launch 12th → 19th');
    const twice = normalizeTitlePrefix('project_update', once);
    expect(twice).toBe('Update: V1 launch 12th → 19th');
    expect(twice).not.toMatch(/^Update:\s*Update:/i);
  });

  it('applying twice to risk does not double "Risk:"', () => {
    const once = normalizeTitlePrefix('risk', 'GDPR compliance gap');
    const twice = normalizeTitlePrefix('risk', once);
    expect(twice).toBe('Risk: GDPR compliance gap');
    expect(twice).not.toMatch(/^Risk:\s*Risk:/i);
  });
});

describe('normalizeTitlePrefix — canonical gold title unchanged', () => {
  it('"Update: V1 launch 12th → 19th" passes through project_update unchanged', () => {
    expect(normalizeTitlePrefix('project_update', 'Update: V1 launch 12th → 19th'))
      .toBe('Update: V1 launch 12th → 19th');
  });
});
