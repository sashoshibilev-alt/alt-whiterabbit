/**
 * Segmentation: numbered list items must never become section headings
 *
 * Regression guard for the bug where lines like "3. Additionality (…)" were
 * classified as 'heading', causing the "### Black Box Prioritization System"
 * section to be split into tiny subsections.
 *
 * Tests:
 *   1. annotateLines: numbered list items are 'list_item', not 'heading'
 *   2. annotateLines: bullet list items are 'list_item', not 'heading'
 *   3. annotateLines: true markdown headings (# syntax) are still 'heading'
 *   4. segmentIntoSections: heading + numbered list stays one section
 *   5. Agatha excerpt: one section, correct heading, all numbered items in raw_text
 *   6. Negative control: two ### headings produce two sections
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { annotateLines, segmentIntoSections, resetSectionCounter } from './preprocessing';

// ============================================
// Unit: annotateLines
// ============================================

describe('annotateLines: numbered list items', () => {
  it('classifies "1. Field size" as list_item, not heading', () => {
    const lines = annotateLines('1. Field size and opportunity');
    expect(lines[0].line_type).toBe('list_item');
  });

  it('classifies "3. Additionality (carbon credits)" as list_item, not heading', () => {
    const lines = annotateLines('3. Additionality (carbon credits required)');
    expect(lines[0].line_type).toBe('list_item');
  });

  it('classifies indented "  2. Eligibility criteria" as list_item, not heading', () => {
    const lines = annotateLines('  2. Eligibility criteria');
    expect(lines[0].line_type).toBe('list_item');
  });

  it('classifies bullet "- Three-factor scoring:" as list_item, not heading', () => {
    const lines = annotateLines('- Three-factor scoring:');
    expect(lines[0].line_type).toBe('list_item');
  });

  it('classifies "* bulleted item" as list_item, not heading', () => {
    const lines = annotateLines('* bulleted item');
    expect(lines[0].line_type).toBe('list_item');
  });

  it('classifies "### True Heading" as heading', () => {
    const lines = annotateLines('### True Heading');
    expect(lines[0].line_type).toBe('heading');
  });

  it('classifies "## Another Heading" as heading', () => {
    const lines = annotateLines('## Another Heading');
    expect(lines[0].line_type).toBe('heading');
  });
});

// ============================================
// Unit: segmentIntoSections — heading + numbered list = one section
// ============================================

describe('segmentIntoSections: numbered list stays inside heading section', () => {
  beforeEach(() => resetSectionCounter());

  it('one section when ### heading is followed by a numbered list', () => {
    const md = [
      '### Black Box Prioritization System',
      '1. Field size and opportunity',
      '2. Eligibility criteria',
      '3. Additionality (carbon credits required)',
    ].join('\n');

    const lines = annotateLines(md);
    const sections = segmentIntoSections('test-note', lines);

    expect(sections.length).toBe(1);
    expect(sections[0].heading_text).toBe('Black Box Prioritization System');
  });

  it('section heading is never equal to a numbered list item text', () => {
    const md = [
      '### Black Box Prioritization System',
      '1. Field size and opportunity',
      '2. Eligibility criteria',
      '3. Additionality (carbon credits required)',
    ].join('\n');

    const lines = annotateLines(md);
    const sections = segmentIntoSections('test-note', lines);

    for (const section of sections) {
      expect(section.heading_text).not.toMatch(/^\d+\.\s/);
    }
  });
});

// ============================================
// Integration: Agatha excerpt
// ============================================

describe('segmentIntoSections: Agatha Black Box excerpt', () => {
  beforeEach(() => resetSectionCounter());

  const AGATHA_EXCERPT = `### Black Box Prioritization System

The scoring model uses three factors to rank farms:

1. Field size and opportunity
2. Eligibility criteria (crop type, acreage, soil data)
3. Additionality (carbon credits required)`;

  it('produces exactly one section from the Agatha excerpt', () => {
    const lines = annotateLines(AGATHA_EXCERPT);
    const sections = segmentIntoSections('agatha-test', lines);
    expect(sections.length).toBe(1);
  });

  it('section heading is "Black Box Prioritization System"', () => {
    const lines = annotateLines(AGATHA_EXCERPT);
    const sections = segmentIntoSections('agatha-test', lines);
    expect(sections[0].heading_text).toBe('Black Box Prioritization System');
  });

  it('raw_text contains all three numbered items', () => {
    const lines = annotateLines(AGATHA_EXCERPT);
    const sections = segmentIntoSections('agatha-test', lines);
    const text = sections[0].raw_text;
    expect(text).toContain('1. Field size');
    expect(text).toContain('2. Eligibility');
    expect(text).toContain('3. Additionality');
  });
});

// ============================================
// Negative control: two ### headings → two sections
// ============================================

describe('segmentIntoSections: two markdown headings still split sections', () => {
  beforeEach(() => resetSectionCounter());

  it('produces two sections from two ### headings', () => {
    const md = [
      '### Section One',
      'Some content here.',
      '### Section Two',
      'More content here.',
    ].join('\n');

    const lines = annotateLines(md);
    const sections = segmentIntoSections('split-test', lines);

    expect(sections.length).toBe(2);
    expect(sections[0].heading_text).toBe('Section One');
    expect(sections[1].heading_text).toBe('Section Two');
  });
});
