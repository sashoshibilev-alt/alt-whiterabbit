/**
 * Structural Idea Bypass Tests (Stage 4.59)
 *
 * Verifies that structured conceptual sections with 3+ bullets and a
 * non-operational heading can emit exactly one idea even when their
 * actionabilitySignal is 0 — without causing idea inflation.
 *
 * Tests:
 *   1. "Black Box Prioritization System" (3+ bullets, no delta) → emits Idea
 *   2. "Data Collection Automation" section → emits Idea
 *   3. "Deployment Plan" with bullets → does NOT bypass (operational heading)
 *   4. Single paragraph descriptive section → still dropped (no list items)
 *   5. Tiny 2-bullet section → still dropped (< 3 list items)
 *
 * Unit tests for qualifiesForStructuralIdeaBypass are also included.
 */

import { describe, it, expect } from 'vitest';
import { generateSuggestions } from './index';
import { qualifiesForStructuralIdeaBypass } from './classifiers';
import type { NoteInput } from './types';

// ============================================
// Unit tests for qualifiesForStructuralIdeaBypass
// ============================================

describe('qualifiesForStructuralIdeaBypass: unit gate checks', () => {
  const BASE = {
    heading_level: 3,
    structural_features: { num_list_items: 4 },
    heading_text: 'Black Box Prioritization System',
    raw_text: 'a'.repeat(200),
  };

  it('returns true for a well-formed conceptual section', () => {
    expect(qualifiesForStructuralIdeaBypass(BASE, false)).toBe(true);
  });

  it('returns false when heading_level > 3', () => {
    expect(qualifiesForStructuralIdeaBypass({ ...BASE, heading_level: 4 }, false)).toBe(false);
  });

  it('returns false when num_list_items < 3', () => {
    expect(
      qualifiesForStructuralIdeaBypass(
        { ...BASE, structural_features: { num_list_items: 2 } },
        false
      )
    ).toBe(false);
  });

  it('returns false when hasDeltaSignal is true', () => {
    expect(qualifiesForStructuralIdeaBypass(BASE, true)).toBe(false);
  });

  it('returns false for "deployment" heading (operational keyword)', () => {
    expect(
      qualifiesForStructuralIdeaBypass({ ...BASE, heading_text: 'Deployment Plan' }, false)
    ).toBe(false);
  });

  it('returns false for "release" heading (operational keyword)', () => {
    expect(
      qualifiesForStructuralIdeaBypass({ ...BASE, heading_text: 'Release Strategy' }, false)
    ).toBe(false);
  });

  it('returns false for "rollout" heading (operational keyword)', () => {
    expect(
      qualifiesForStructuralIdeaBypass({ ...BASE, heading_text: 'Rollout Plan' }, false)
    ).toBe(false);
  });

  it('returns false for "notes" heading (generic)', () => {
    expect(
      qualifiesForStructuralIdeaBypass({ ...BASE, heading_text: 'notes' }, false)
    ).toBe(false);
  });

  it('returns false for "discussion" heading (generic)', () => {
    expect(
      qualifiesForStructuralIdeaBypass({ ...BASE, heading_text: 'discussion' }, false)
    ).toBe(false);
  });

  it('returns false when raw_text is shorter than 150 chars', () => {
    expect(
      qualifiesForStructuralIdeaBypass({ ...BASE, raw_text: 'short text' }, false)
    ).toBe(false);
  });
});

// ============================================
// Integration tests via generateSuggestions
// ============================================

/**
 * Helper: run generateSuggestions and return ideas only.
 */
function getIdeas(markdown: string, noteId = 'note-bypass-test-001') {
  const note: NoteInput = { note_id: noteId, raw_markdown: markdown };
  return generateSuggestions(note).suggestions.filter((s) => s.type === 'idea');
}

// ============================================
// Test 1: Black Box style 3+ bullet conceptual section → emits Idea
// ============================================

describe('structural idea bypass: "Black Box Prioritization System" emits idea', () => {
  const MARKDOWN = `
### Black Box Prioritization System

- Three-factor scoring: evaluate each claim using data quality, source reliability, and verification status
- Remote sensing integration: incorporate satellite imagery to validate land-use change claims at scale
- Additionality extension: apply additionality scoring to distinguish new mitigation from business-as-usual
- Carbon accuracy layer: layer in third-party audits to improve measurement accuracy and reduce fraud
`.trim();

  it('emits at least one idea suggestion', () => {
    const ideas = getIdeas(MARKDOWN, 'note-bbox-001');
    expect(
      ideas.length,
      `Expected ≥1 idea, got 0`
    ).toBeGreaterThanOrEqual(1);
  });

  it('emitted idea references the section heading', () => {
    const ideas = getIdeas(MARKDOWN, 'note-bbox-002');
    expect(ideas.length).toBeGreaterThanOrEqual(1);
    const heading = ideas[0].title.toLowerCase();
    expect(heading).toContain('black box prioritization system');
  });

  it('emitted idea has type "idea"', () => {
    const ideas = getIdeas(MARKDOWN, 'note-bbox-003');
    expect(ideas.length).toBeGreaterThanOrEqual(1);
    expect(ideas[0].type).toBe('idea');
  });
});

// ============================================
// Test 2: Data Collection Automation section → emits Idea
// ============================================

describe('structural idea bypass: "Data Collection Automation" emits idea', () => {
  const MARKDOWN = `
### Data Collection Automation

- Automated CSV ingestion: parse uploaded spreadsheets and populate the database without manual entry
- Photo capture integration: use mobile camera APIs to photograph physical receipts and extract line items
- Webhook event pipeline: receive real-time transactions from partner platforms and normalize them for storage
- Reconciliation engine: automatically match incoming records against existing ledger entries to flag discrepancies
`.trim();

  it('emits at least one idea suggestion', () => {
    const ideas = getIdeas(MARKDOWN, 'note-dca-001');
    expect(
      ideas.length,
      `Expected ≥1 idea for Data Collection Automation, got 0`
    ).toBeGreaterThanOrEqual(1);
  });

  it('emitted idea title references the section heading', () => {
    const ideas = getIdeas(MARKDOWN, 'note-dca-002');
    expect(ideas.length).toBeGreaterThanOrEqual(1);
    expect(ideas[0].title.toLowerCase()).toContain('data collection automation');
  });
});

// ============================================
// Test 3: "Deployment Plan" with bullets → does NOT bypass
// ============================================

describe('structural idea bypass: "Deployment Plan" with bullets does not bypass', () => {
  // The section has enough bullets and charCount but the heading contains an
  // operational keyword ("deployment") that disqualifies it from the bypass.
  // Verify the section does NOT emit a structural-idea-bypass candidate.
  const MARKDOWN = `
### Deployment Plan

- Stage 1: deploy the new authentication service to the staging environment for validation
- Stage 2: run smoke tests and performance benchmarks against the production traffic mirror
- Stage 3: roll out the service to 10% of production traffic with automatic rollback on error
- Stage 4: full production promotion after 48-hour observation window with no critical alerts
`.trim();

  it('does not emit a structural-idea-bypass candidate for deployment heading', () => {
    const note: NoteInput = { note_id: 'note-deploy-bypass-001', raw_markdown: MARKDOWN };
    const result = generateSuggestions(note);
    const bypassCandidates = result.suggestions.filter(
      (s) => s.metadata?.source === 'structural-idea-bypass'
    );
    expect(
      bypassCandidates.length,
      `Expected 0 bypass candidates for Deployment Plan, got: ${bypassCandidates.map((s) => s.title).join(', ')}`
    ).toBe(0);
  });
});

// ============================================
// Test 4: Single paragraph descriptive section → still dropped
// ============================================

describe('structural idea bypass: single paragraph section is not bypassed', () => {
  // No list items → num_list_items < 3 → bypass does not fire.
  const MARKDOWN = `
### Background Context

This section provides background on the current state of the system. The existing
infrastructure was designed for single-tenant use and does not support multi-region
replication. Performance benchmarks show latency spikes above 500ms under peak load.
`.trim();

  it('does not emit a structural-idea-bypass candidate for prose-only section', () => {
    const note: NoteInput = { note_id: 'note-prose-bypass-001', raw_markdown: MARKDOWN };
    const result = generateSuggestions(note);
    const bypassCandidates = result.suggestions.filter(
      (s) => s.metadata?.source === 'structural-idea-bypass'
    );
    expect(
      bypassCandidates.length,
      `Expected 0 bypass candidates for prose section, got: ${bypassCandidates.map((s) => s.title).join(', ')}`
    ).toBe(0);
  });
});

// ============================================
// Test 5: Tiny 2-bullet section → still dropped
// ============================================

describe('structural idea bypass: 2-bullet section is not bypassed', () => {
  // num_list_items = 2 → does not meet the >= 3 threshold.
  const MARKDOWN = `
### Scoring System

- Calculate a composite score using weighted signals from data quality and source reliability metrics
- Apply a normalization step to ensure scores are comparable across different claim categories and regions
`.trim();

  it('does not emit a structural-idea-bypass candidate for 2-bullet section', () => {
    const note: NoteInput = { note_id: 'note-2bullet-bypass-001', raw_markdown: MARKDOWN };
    const result = generateSuggestions(note);
    const bypassCandidates = result.suggestions.filter(
      (s) => s.metadata?.source === 'structural-idea-bypass'
    );
    expect(
      bypassCandidates.length,
      `Expected 0 bypass candidates for 2-bullet section, got: ${bypassCandidates.map((s) => s.title).join(', ')}`
    ).toBe(0);
  });
});
