/**
 * Integration test: deterministic 4-type suggestion output
 *
 * Feeds a single realistic "weekly pulse check" note and asserts that
 * the engine produces exactly these 4 suggestion types:
 *   - idea        (CSV export feature request)
 *   - project_update (V1 launch pushed 12th → 19th)
 *   - bug         (trial failing due to latency in global view)
 *   - risk        (auth-token bloat may force pulling mobile app)
 *
 * Also asserts that no QA-ownership or SOC2-ownership suggestions are emitted.
 */

import { describe, it, expect } from 'vitest';
import { generateSuggestions } from './index';
import type { NoteInput, GeneratorConfig } from './types';
import { extractBug } from './signals/extractBug';
import { extractScopeRisk } from './signals/extractScopeRisk';

// ============================================
// The canonical test note
// ============================================

const WEEKLY_PULSE_NOTE: NoteInput = {
  note_id: 'integration-typed-test-001',
  raw_markdown: `# Weekly Pulse Check — Engineering + CS

## Feature Requests

Sales is screaming for the CSV export feature — every enterprise trial asks for it and it's blocking expansion.

## Launch Status

We're pushing the V1 launch from the 12th to the 19th due to infra delays.

## Bug Report

The trial is failing because of latency in the global view — it's broken for users in APAC.

## Release Risk

If we don't fix the auth-token bloat, the mobile app might need to be pulled from the release.

## Process

There is ambiguity around who owns QA sign-off for the SOC2 audit deliverable.
`,
};

const CONFIG: Partial<GeneratorConfig> = {
  enable_debug: false,
  use_llm_classifiers: false,
  embedding_enabled: false,
};

// ============================================
// extractBug unit tests (conditional guard)
// ============================================

describe('extractBug — conditional guard', () => {
  it('emits bug for observed failure: "trial is failing because of latency"', () => {
    const signals = extractBug(['The trial is failing because of latency.']);
    expect(signals).toHaveLength(1);
    expect(signals[0].label).toBe('bug');
    expect(signals[0].proposedType).toBe('bug');
  });

  it('does NOT emit bug for conditional: "If we don\'t fix X, might cause latency"', () => {
    const signals = extractBug(['If we don\'t fix X, might cause latency issues.']);
    expect(signals).toHaveLength(0);
  });

  it('does NOT emit bug when sentence contains "might"', () => {
    const signals = extractBug(['This might cause a regression in the release.']);
    expect(signals).toHaveLength(0);
  });

  it('does NOT emit bug when sentence contains "could"', () => {
    const signals = extractBug(['This could cause an error if not fixed.']);
    expect(signals).toHaveLength(0);
  });

  it('does NOT emit bug when sentence contains "may"', () => {
    const signals = extractBug(['This may be broken in certain edge cases.']);
    expect(signals).toHaveLength(0);
  });

  it('does NOT emit bug when sentence contains "risk"', () => {
    const signals = extractBug(['The risk of regression is high in this component.']);
    // "regression" would match BUG_TOKENS, but "risk" should prevent it
    expect(signals).toHaveLength(0);
  });
});

// ============================================
// extractScopeRisk unit tests
// ============================================

describe('extractScopeRisk — conditional risk detection', () => {
  it('emits risk for: "If we don\'t fix auth-token bloat, the mobile app might need to be pulled"', () => {
    const signals = extractScopeRisk([
      "If we don't fix the auth-token bloat, the mobile app might need to be pulled from the release.",
    ]);
    expect(signals).toHaveLength(1);
    expect(signals[0].label).toBe('risk');
    expect(signals[0].proposedType).toBe('risk');
  });

  it('does NOT emit risk for an observed failure (no conditional)', () => {
    const signals = extractScopeRisk(['The trial is failing because of latency.']);
    expect(signals).toHaveLength(0);
  });
});

// ============================================
// Full integration test
// ============================================

describe('Integration: typed suggestions from weekly pulse note', () => {
  it('produces exactly one idea suggestion referencing CSV export', () => {
    const result = generateSuggestions(WEEKLY_PULSE_NOTE, undefined, CONFIG);
    const ideaSuggestions = result.suggestions.filter(s => s.type === 'idea');

    const csvIdea = ideaSuggestions.find(
      s =>
        s.title.toLowerCase().includes('csv') ||
        (s.suggestion?.body ?? '').toLowerCase().includes('csv') ||
        (s.evidence_spans[0]?.text ?? '').toLowerCase().includes('csv')
    );

    expect(csvIdea).toBeDefined();
  });

  it('produces exactly one project_update suggestion referencing the date change (12th → 19th)', () => {
    const result = generateSuggestions(WEEKLY_PULSE_NOTE, undefined, CONFIG);
    const updateSuggestions = result.suggestions.filter(s => s.type === 'project_update');

    const launchUpdate = updateSuggestions.find(
      s =>
        (s.suggestion?.body ?? '').toLowerCase().includes('v1') ||
        (s.evidence_spans[0]?.text ?? '').toLowerCase().includes('v1') ||
        (s.suggestion?.body ?? '').toLowerCase().includes('12th') ||
        (s.evidence_spans[0]?.text ?? '').toLowerCase().includes('12th') ||
        (s.suggestion?.body ?? '').toLowerCase().includes('19th') ||
        (s.evidence_spans[0]?.text ?? '').toLowerCase().includes('19th') ||
        s.title.toLowerCase().includes('launch') ||
        s.title.toLowerCase().includes('v1')
    );

    expect(launchUpdate).toBeDefined();
  });

  it('produces exactly one bug suggestion referencing latency / global view', () => {
    const result = generateSuggestions(WEEKLY_PULSE_NOTE, undefined, CONFIG);
    const bugSuggestions = result.suggestions.filter(s => s.type === 'bug');

    expect(bugSuggestions.length).toBeGreaterThanOrEqual(1);

    const latencyBug = bugSuggestions.find(
      s =>
        (s.suggestion?.body ?? '').toLowerCase().includes('latency') ||
        (s.evidence_spans[0]?.text ?? '').toLowerCase().includes('latency') ||
        (s.suggestion?.body ?? '').toLowerCase().includes('failing') ||
        (s.evidence_spans[0]?.text ?? '').toLowerCase().includes('failing')
    );

    expect(latencyBug).toBeDefined();
  });

  it('produces exactly one risk suggestion referencing auth-token bloat', () => {
    const result = generateSuggestions(WEEKLY_PULSE_NOTE, undefined, CONFIG);
    const riskSuggestions = result.suggestions.filter(s => s.type === 'risk');

    expect(riskSuggestions.length).toBeGreaterThanOrEqual(1);

    const authRisk = riskSuggestions.find(
      s =>
        (s.suggestion?.body ?? '').toLowerCase().includes('auth') ||
        (s.evidence_spans[0]?.text ?? '').toLowerCase().includes('auth') ||
        (s.suggestion?.body ?? '').toLowerCase().includes('mobile') ||
        (s.evidence_spans[0]?.text ?? '').toLowerCase().includes('mobile')
    );

    expect(authRisk).toBeDefined();
  });

  it('does not emit any suggestion referencing QA ownership', () => {
    const result = generateSuggestions(WEEKLY_PULSE_NOTE, undefined, CONFIG);

    const qaOwnership = result.suggestions.find(
      s =>
        (s.title + ' ' + (s.suggestion?.body ?? '')).toLowerCase().includes('qa sign-off') ||
        (s.title + ' ' + (s.suggestion?.body ?? '')).toLowerCase().includes('qa ownership') ||
        (s.evidence_spans[0]?.text ?? '').toLowerCase().includes('qa sign-off')
    );

    expect(qaOwnership).toBeUndefined();
  });

  it('does not emit any suggestion referencing SOC2 sign-off ownership', () => {
    const result = generateSuggestions(WEEKLY_PULSE_NOTE, undefined, CONFIG);

    const soc2Ownership = result.suggestions.find(
      s =>
        (s.title + ' ' + (s.suggestion?.body ?? '')).toLowerCase().includes('soc2') ||
        (s.evidence_spans[0]?.text ?? '').toLowerCase().includes('soc2')
    );

    expect(soc2Ownership).toBeUndefined();
  });
});
