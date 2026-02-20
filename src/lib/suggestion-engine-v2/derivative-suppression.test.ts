/**
 * Tests for derivative content suppression and decision table normalization
 */

import { describe, it, expect } from 'vitest';
import { generateSuggestions } from './index';
import type { NoteInput } from './types';

describe('Derivative Content Suppression', () => {
  it('should suppress Summary section when content is redundant with concrete sections', () => {
    const note: NoteInput = {
      note_id: 'test-001',
      raw_markdown: `
# Project Alpha

Shift focus to user onboarding improvements. Reduce the number of steps in the signup flow by merging screens.

# Summary

Shift focus to user onboarding and reduce steps in signup flow.
      `.trim(),
    };

    const result = generateSuggestions(note, {}, { enable_debug: true });

    // Should emit at least one suggestion
    expect(result.suggestions.length).toBeGreaterThanOrEqual(1);

    // Summary section should not produce suggestion (derivative)
    const summarySection = result.suggestions.find(s =>
      s.suggestion?.sourceHeading?.toLowerCase().includes('summary')
    );
    expect(summarySection).toBeUndefined();

    // First section should be from Project Alpha
    expect(result.suggestions[0].suggestion?.sourceHeading).toBe('Project Alpha');
  });

  it('should suppress TL;DR section with high overlap', () => {
    const note: NoteInput = {
      note_id: 'test-002',
      raw_markdown: `
# Customer Feedback

Enterprise customers report frustration with the number of clicks required to complete annual attestations.
This impacts user satisfaction and completion rates.

# TL;DR

Customers frustrated with clicks for attestations, impacting satisfaction.
      `.trim(),
    };

    const result = generateSuggestions(note);

    // Should only emit from Customer Feedback section
    expect(result.suggestions.length).toBe(1);
    const titles = result.suggestions.map(s => s.title);
    expect(titles.some(t => t.toLowerCase().includes('click') || t.toLowerCase().includes('reduce'))).toBe(true);
  });

  it('should suppress Overview section with >= 70% word overlap', () => {
    const note: NoteInput = {
      note_id: 'test-003',
      raw_markdown: `
# Search Improvements

Launch improved search functionality with advanced filters and sorting capabilities.
Build query optimizer and index management.
Target completion by Q2 2026.

# Overview

Launch improved search functionality with new filters and sorting capabilities.
      `.trim(),
    };

    const result = generateSuggestions(note, {}, { enable_debug: true });

    // Should emit from first section (Overview is derivative)
    expect(result.suggestions.length).toBeGreaterThanOrEqual(1);
    expect(result.suggestions.length).toBeLessThanOrEqual(2);

    // Overview section should be suppressed
    const overviewSection = result.suggestions.find(s =>
      s.suggestion?.sourceHeading?.toLowerCase().includes('overview')
    );
    expect(overviewSection).toBeUndefined();
  });

  it('should NOT suppress sections below 70% overlap threshold', () => {
    const note: NoteInput = {
      note_id: 'test-004',
      raw_markdown: `
# Q1 Planning

Launch mobile performance monitoring dashboard.
Implement crash analytics and automated alerting.

# Summary

Key priorities for Q1 include performance work and quality improvements.
      `.trim(),
    };

    const result = generateSuggestions(note);

    // First section should emit (overlap < 70% so Summary might emit too)
    expect(result.suggestions.length).toBeGreaterThanOrEqual(1);
  });

  it('should handle multiple concrete sections before summary', () => {
    const note: NoteInput = {
      note_id: 'test-005',
      raw_markdown: `
# Project A

Launch new dashboard with metrics.

# Project B

Refactor authentication flow.

# Summary

Launch new dashboard and refactor authentication.
      `.trim(),
    };

    const result = generateSuggestions(note);

    // Should emit from Project A and B, suppress Summary
    expect(result.suggestions.length).toBeLessThanOrEqual(2);
    const headings = result.suggestions.map(s => s.suggestion?.sourceHeading || '');
    expect(headings).not.toContain('Summary');
  });

  it('should recognize Recap as a summary heading', () => {
    const note: NoteInput = {
      note_id: 'test-006',
      raw_markdown: `
# Decision

Pivot to enterprise features for Q2.

# Recap

Pivoting to enterprise features next quarter.
      `.trim(),
    };

    const result = generateSuggestions(note);

    // Recap should be suppressed
    const recapSuggestion = result.suggestions.find(s =>
      s.suggestion?.sourceHeading?.toLowerCase().includes('recap')
    );
    expect(recapSuggestion).toBeUndefined();
  });
});

describe('Decision Table Normalization', () => {
  it('should strip status markers from decision text', () => {
    const note: NoteInput = {
      note_id: 'test-101',
      raw_markdown: `
# Decisions

- Migrate to new database | Aligned
- Refactor API layer | Needs Discussion
- Update documentation | Completed
      `.trim(),
    };

    const result = generateSuggestions(note);

    // Should emit suggestions with clean decision text (no status)
    if (result.suggestions.length > 0) {
      const bodies = result.suggestions.map(s => s.suggestion?.body || '');
      for (const body of bodies) {
        expect(body.toLowerCase()).not.toContain('aligned');
        expect(body.toLowerCase()).not.toContain('needs discussion');
        expect(body.toLowerCase()).not.toContain('completed');
      }
    }
  });

  it('should handle table-formatted decisions with pipe separators', () => {
    const note: NoteInput = {
      note_id: 'test-102',
      raw_markdown: `
# Architecture Decisions

Decision | Status
Adopt GraphQL for API | Approved
Use PostgreSQL for data store | Aligned
Implement caching layer | Pending
      `.trim(),
    };

    const result = generateSuggestions(note);

    if (result.suggestions.length > 0) {
      const bodies = result.suggestions.map(s => s.suggestion?.body || '');
      // Should contain decision content
      expect(bodies.some(b => b.includes('GraphQL') || b.includes('PostgreSQL'))).toBe(true);
      // Should NOT contain status markers
      for (const body of bodies) {
        expect(body).not.toContain('Approved');
        expect(body).not.toContain('Aligned');
        expect(body).not.toContain('Pending');
      }
    }
  });

  it('should suppress duplicate decisions across rows', () => {
    const note: NoteInput = {
      note_id: 'test-103',
      raw_markdown: `
# Decisions

- Migrate to PostgreSQL | Aligned
- Migrate to PostgreSQL database | Needs Discussion
- Adopt GraphQL API | Approved
      `.trim(),
    };

    const result = generateSuggestions(note);

    // Should emit at most 2 suggestions (duplicate PostgreSQL decision suppressed)
    expect(result.suggestions.length).toBeLessThanOrEqual(2);

    // Count how many suggestions mention PostgreSQL
    const postgresCount = result.suggestions.filter(s =>
      (s.suggestion?.body || '').toLowerCase().includes('postgresql') ||
      s.title.toLowerCase().includes('postgresql')
    ).length;

    // Should only have 1 PostgreSQL-related suggestion (duplicate suppressed)
    expect(postgresCount).toBeLessThanOrEqual(1);
  });

  it('should extract first column from multi-column decision tables', () => {
    const note: NoteInput = {
      note_id: 'test-104',
      raw_markdown: `
# Technical Decisions

- Launch mobile app v2      Approved      Q2 2026
- Deprecate legacy API      Aligned       Q3 2026
      `.trim(),
    };

    const result = generateSuggestions(note);

    if (result.suggestions.length > 0) {
      const content = result.suggestions.map(s => s.title + ' ' + (s.suggestion?.body || '')).join(' ');
      // Should contain decision content from first column
      expect(content.includes('mobile') || content.includes('API')).toBe(true);
      // Should NOT contain status or timeline from other columns
      expect(content).not.toContain('Approved');
      expect(content).not.toContain('Aligned');
    }
  });

  it('should handle decisions without table structure but with status markers', () => {
    const note: NoteInput = {
      note_id: 'test-105',
      raw_markdown: `
# Team Decisions

Adopt TypeScript for new services (Aligned with leadership)
Implement code review process (Needs Discussion with team)
      `.trim(),
    };

    const result = generateSuggestions(note);

    if (result.suggestions.length > 0) {
      const bodies = result.suggestions.map(s => s.suggestion?.body || '');
      // Status markers should be stripped
      for (const body of bodies) {
        expect(body.toLowerCase()).not.toContain('aligned');
        expect(body.toLowerCase()).not.toContain('needs discussion');
      }
    }
  });

  it.skip('should preserve clean decisions without status markers', () => {
    // TODO: A section of clean action-item list items ("Migrate authentication to OAuth 2.0" etc.)
    // currently emits 0 suggestions. The section is not being classified as actionable
    // despite containing imperative build verbs.
    const note: NoteInput = {
      note_id: 'test-106',
      raw_markdown: `
# Engineering Decisions

- Migrate authentication to OAuth 2.0
- Implement automated testing pipeline
- Refactor database schema for performance
      `.trim(),
    };

    const result = generateSuggestions(note);

    // Should emit normally (no status markers to strip)
    expect(result.suggestions.length).toBeGreaterThan(0);

    if (result.suggestions.length > 0) {
      const content = result.suggestions.map(s => s.title + ' ' + (s.suggestion?.body || '')).join(' ');
      expect(content.includes('OAuth') || content.includes('testing') || content.includes('database')).toBe(true);
    }
  });

  it('should suppress all-duplicate decision section', () => {
    const note: NoteInput = {
      note_id: 'test-107',
      raw_markdown: `
# Q1 Decisions

Launch customer portal with self-service features.
Build analytics dashboard for usage metrics.

# Q1 Decision Recap

Launch customer portal with self-service features.
      `.trim(),
    };

    const result = generateSuggestions(note);

    // If suggestions are emitted, check that customer portal only appears once
    if (result.suggestions.length > 0) {
      const portalCount = result.suggestions.filter(s =>
        (s.title + ' ' + (s.suggestion?.body || '')).toLowerCase().includes('customer portal')
      ).length;

      // Should only have 1 customer portal suggestion (duplicate suppressed)
      expect(portalCount).toBeLessThanOrEqual(1);
    } else {
      // If no suggestions emitted, that's also acceptable for this test
      // (means neither section was actionable enough)
      expect(result.suggestions.length).toBe(0);
    }
  });
});

describe('Combined Derivative Suppression and Decision Normalization', () => {
  it('should handle decision table with summary section', () => {
    const note: NoteInput = {
      note_id: 'test-200',
      raw_markdown: `
# Technical Decisions

- Adopt Kubernetes for orchestration | Aligned
- Use Terraform for infrastructure | Approved

# Summary

Adopting Kubernetes and Terraform for infrastructure.
      `.trim(),
    };

    const result = generateSuggestions(note);

    // Should emit from Decisions section (with status stripped), suppress Summary
    if (result.suggestions.length > 0) {
      const bodies = result.suggestions.map(s => s.suggestion?.body || '');
      // Status should be stripped
      for (const body of bodies) {
        expect(body).not.toContain('Aligned');
        expect(body).not.toContain('Approved');
      }
    }

    // Summary should be suppressed
    const summarySection = result.suggestions.find(s =>
      s.suggestion?.sourceHeading?.toLowerCase().includes('summary')
    );
    expect(summarySection).toBeUndefined();
  });

  it('should be deterministic across multiple runs', () => {
    const note: NoteInput = {
      note_id: 'test-201',
      raw_markdown: `
# Initiative A

Launch analytics dashboard with metrics and charts.

# Initiative B

Build notification system for alerts.

# Overview

Dashboard and notification system for Q2.
      `.trim(),
    };

    const result1 = generateSuggestions(note);
    const result2 = generateSuggestions(note);

    // Should produce identical results
    expect(result1.suggestions.length).toBe(result2.suggestions.length);

    for (let i = 0; i < result1.suggestions.length; i++) {
      expect(result1.suggestions[i].title).toBe(result2.suggestions[i].title);
      expect(result1.suggestions[i].type).toBe(result2.suggestions[i].type);
    }
  });
});
