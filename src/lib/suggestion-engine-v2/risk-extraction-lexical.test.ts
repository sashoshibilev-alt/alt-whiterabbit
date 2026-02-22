/**
 * Risk Extraction: Lexical Tokens + Structure Assist
 *
 * Tests for Path C (lexical risk triggers) in extractScopeRisk and the
 * heading-based title derivation in bSignalSeeding.
 *
 * Requirements:
 * - Lexical risk tokens: risk, concern, PII, GDPR, compliance, security,
 *   vulnerability, exposure, blocker
 * - PII + logging/user IDs → high-confidence (0.85) risk signal
 * - Heading containing Security/Compliance/Risk/Considerations → title uses heading
 * - Do not emit duplicate risk if same span already used for project_update
 * - V2 (structured, with heading) and V3 (flattened, no heading) both emit risk
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { extractScopeRisk } from './signals/extractScopeRisk';
import { generateSuggestions, DEFAULT_CONFIG } from './index';
import { resetSectionCounter } from './preprocessing';
import { resetSuggestionCounter } from './synthesis';
import { resetBSignalCounter } from './bSignalSeeding';

// ============================================================
// Unit tests: extractScopeRisk Path C (lexical tokens)
// ============================================================

describe('extractScopeRisk — Path C: lexical risk tokens', () => {
  it('fires on "PII concern" in a database logging sentence', () => {
    const sentences = ['Database logging includes user IDs (PII concern)'];
    const signals = extractScopeRisk(sentences);

    expect(signals).toHaveLength(1);
    expect(signals[0].label).toBe('risk');
    expect(signals[0].proposedType).toBe('risk');
  });

  it('assigns high confidence (0.85) when PII + logging co-occur', () => {
    const sentences = ['Database logging includes user IDs (PII concern)'];
    const signals = extractScopeRisk(sentences);

    expect(signals[0].confidence).toBe(0.85);
  });

  it('assigns high confidence (0.85) when PII + user IDs co-occur', () => {
    const sentences = ['The pipeline captures PII including user IDs without masking'];
    const signals = extractScopeRisk(sentences);

    expect(signals).toHaveLength(1);
    expect(signals[0].confidence).toBe(0.85);
  });

  it('fires on the "compliance" token', () => {
    const sentences = ['We need to address compliance requirements before launch'];
    const signals = extractScopeRisk(sentences);

    expect(signals).toHaveLength(1);
    expect(signals[0].label).toBe('risk');
  });

  it('fires on the "vulnerability" token', () => {
    const sentences = ['A vulnerability in the auth layer needs immediate attention'];
    const signals = extractScopeRisk(sentences);

    expect(signals).toHaveLength(1);
    expect(signals[0].label).toBe('risk');
  });

  it('fires on the "exposure" token', () => {
    const sentences = ['Data exposure in the API responses must be mitigated'];
    const signals = extractScopeRisk(sentences);

    expect(signals).toHaveLength(1);
    expect(signals[0].label).toBe('risk');
  });

  it('fires on the "blocker" token', () => {
    const sentences = ['This is a blocker for the Q2 rollout'];
    const signals = extractScopeRisk(sentences);

    expect(signals).toHaveLength(1);
    expect(signals[0].label).toBe('risk');
  });

  it('fires on the "gdpr" token', () => {
    const sentences = ['GDPR requirements have not been mapped out yet'];
    const signals = extractScopeRisk(sentences);

    expect(signals).toHaveLength(1);
    expect(signals[0].label).toBe('risk');
  });

  it('fires on the "security" token', () => {
    const sentences = ['Security review identified gaps in access control'];
    const signals = extractScopeRisk(sentences);

    expect(signals).toHaveLength(1);
    expect(signals[0].label).toBe('risk');
  });

  it('does NOT fire on plain subjective concern prefixes', () => {
    const sentences = ['Some concern that latency might increase'];
    const signals = extractScopeRisk(sentences);

    expect(signals).toHaveLength(0);
  });

  it('does NOT fire on "risk that X" (subjective concern prefix)', () => {
    const sentences = ['Risk that the deployment could cause downtime'];
    const signals = extractScopeRisk(sentences);

    expect(signals).toHaveLength(0);
  });

  it('does NOT fire on "some internal concern that X"', () => {
    // Regression: "some [adjective] concern that" is still a subjective observation
    const sentences = ['Some internal concern that aggressive gating might churn users'];
    const signals = extractScopeRisk(sentences);

    expect(signals).toHaveLength(0);
  });

  it('does NOT fire when sentence is clearly a plan-change (shift verb + time unit)', () => {
    // "security review requirements" as the reason for a slip — not a risk topic
    const sentences = [
      'The deliverables will slip by 2 sprints due to security review requirements',
    ];
    const signals = extractScopeRisk(sentences);

    expect(signals).toHaveLength(0);
  });

  it('assigns base confidence (0.7) for non-PII lexical tokens', () => {
    const sentences = ['Compliance audit found gaps in access logging'];
    const signals = extractScopeRisk(sentences);

    expect(signals).toHaveLength(1);
    expect(signals[0].confidence).toBe(0.7);
  });
});

// ============================================================
// Integration tests: V2 (structured note with heading)
// ============================================================

describe('Risk extraction — V2: structured note with risk-domain heading', () => {
  beforeEach(() => {
    resetSectionCounter();
    resetSuggestionCounter();
    resetBSignalCounter();
  });

  it('emits a risk from PII logging sentence under a "Security considerations" heading', () => {
    const note = {
      note_id: 'test-risk-v2-pii',
      raw_markdown: `# Engineering Review

## Security considerations

Database logging includes user IDs (PII concern).
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);
    const riskSuggestions = result.suggestions.filter((s) => s.type === 'risk');

    expect(riskSuggestions.length).toBeGreaterThanOrEqual(1);

    // The title must use the heading as base (structure assist)
    const piiRisk = riskSuggestions.find((s) =>
      s.title.toLowerCase().includes('security')
    );
    expect(piiRisk).toBeDefined();
    expect(piiRisk!.title).toMatch(/^Risk:/i);
    expect(piiRisk!.title.toLowerCase()).toContain('security');
  });

  it('emits a risk under a "Compliance" heading', () => {
    const note = {
      note_id: 'test-risk-v2-compliance',
      raw_markdown: `# Project Review

## Compliance

GDPR requirements for German nodes have not been mapped out yet.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);
    const riskSuggestions = result.suggestions.filter((s) => s.type === 'risk');

    expect(riskSuggestions.length).toBeGreaterThanOrEqual(1);

    const complianceRisk = riskSuggestions.find((s) =>
      s.title.toLowerCase().includes('compliance')
    );
    expect(complianceRisk).toBeDefined();
    expect(complianceRisk!.title).toMatch(/^Risk:/i);
  });

  it('emits a risk under a "Risk" heading', () => {
    const note = {
      note_id: 'test-risk-v2-risk-heading',
      raw_markdown: `# Weekly Sync

## Risk

Vulnerability in authentication module exposure could block release.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);
    const riskSuggestions = result.suggestions.filter((s) => s.type === 'risk');

    expect(riskSuggestions.length).toBeGreaterThanOrEqual(1);

    const headingRisk = riskSuggestions.find((s) =>
      s.title.toLowerCase().includes('risk')
    );
    expect(headingRisk).toBeDefined();
    expect(headingRisk!.title).toMatch(/^Risk:/i);
  });

  it('emits a risk under a "Considerations" heading', () => {
    const note = {
      note_id: 'test-risk-v2-considerations',
      raw_markdown: `# Sprint Planning

## Considerations

PII exposure in audit logs must be addressed before the next release.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);
    const riskSuggestions = result.suggestions.filter((s) => s.type === 'risk');

    expect(riskSuggestions.length).toBeGreaterThanOrEqual(1);
    expect(riskSuggestions[0].title).toMatch(/^Risk:/i);
  });
});

// ============================================================
// Integration tests: V3 (flattened — no structured heading)
// ============================================================

describe('Risk extraction — V3: flattened (no risk-domain heading)', () => {
  beforeEach(() => {
    resetSectionCounter();
    resetSuggestionCounter();
    resetBSignalCounter();
  });

  it('emits a risk from PII logging sentence even without a risk-domain heading', () => {
    const note = {
      note_id: 'test-risk-v3-pii',
      raw_markdown: `# Engineering Review

## General Notes

Database logging includes user IDs (PII concern).
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);
    const riskSuggestions = result.suggestions.filter((s) => s.type === 'risk');

    expect(riskSuggestions.length).toBeGreaterThanOrEqual(1);
    // Title derived from content (not heading), still has Risk: prefix
    expect(riskSuggestions[0].title).toMatch(/^Risk:/i);
  });

  it('emits a risk for a compliance/GDPR sentence in a plain section', () => {
    const note = {
      note_id: 'test-risk-v3-gdpr',
      raw_markdown: `# Status Update

## Product Notes

GDPR compliance gaps remain unresolved for the EU deployment.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);
    const riskSuggestions = result.suggestions.filter((s) => s.type === 'risk');

    expect(riskSuggestions.length).toBeGreaterThanOrEqual(1);
    expect(riskSuggestions[0].title).toMatch(/^Risk:/i);
  });

  it('emits a risk for a security vulnerability sentence in a plain section', () => {
    const note = {
      note_id: 'test-risk-v3-vulnerability',
      raw_markdown: `# Retrospective

## Engineering Notes

A security vulnerability in the API must be patched before the next release.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);
    const riskSuggestions = result.suggestions.filter((s) => s.type === 'risk');

    expect(riskSuggestions.length).toBeGreaterThanOrEqual(1);
    expect(riskSuggestions[0].title).toMatch(/^Risk:/i);
  });
});

// ============================================================
// Deduplication: no duplicate risk if same span used for project_update
// ============================================================

describe('Risk deduplication — no risk emitted when same span used for project_update', () => {
  beforeEach(() => {
    resetSectionCounter();
    resetSuggestionCounter();
    resetBSignalCounter();
  });

  it('does not emit a risk candidate if the same evidence span is already a project_update', () => {
    // The GDPR sentence fires both as conditional risk (Path A/B) and the CloudScale
    // scenario has the GDPR sentence alongside a plan-change sentence.
    // This test builds a minimal case where a synthesized project_update already uses
    // the exact evidence span that a risk extractor would also claim.
    const note = {
      note_id: 'test-risk-dedup',
      raw_markdown: `# Status

## Update

If we can't prove GDPR compliance, the partnership is dead in the water.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    // Count distinct types for this evidence span
    const riskSuggestions = result.suggestions.filter((s) => s.type === 'risk');
    const projectUpdateSuggestions = result.suggestions.filter(
      (s) => s.type === 'project_update'
    );

    // There must be at most one suggestion per span — either risk or project_update, not both
    // with the same evidence sentence.
    const gdprEvidence =
      "If we can't prove GDPR compliance, the partnership is dead in the water.";
    const riskWithGdpr = riskSuggestions.filter((s) =>
      s.evidence_spans.some((e) => e.text.trim() === gdprEvidence)
    );
    const updateWithGdpr = projectUpdateSuggestions.filter((s) =>
      s.evidence_spans.some((e) => e.text.trim() === gdprEvidence)
    );

    // The same span must not produce BOTH a risk and a project_update candidate
    expect(riskWithGdpr.length + updateWithGdpr.length).toBeLessThanOrEqual(1);
  });
});
