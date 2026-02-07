/**
 * Suggestion Engine v2 - Preprocessing
 *
 * Markdown parsing, line annotation, and section segmentation.
 */

import type {
  NoteInput,
  Line,
  LineType,
  Section,
  StructuralFeatures,
  PreprocessingResult,
} from './types';

// ============================================
// Line Annotation
// ============================================

/**
 * Detect if a line is inside a code fence
 */
let inCodeFence = false;
let codeFenceMarker = '';

function resetCodeFenceState(): void {
  inCodeFence = false;
  codeFenceMarker = '';
}

/**
 * Check if line is a code fence delimiter
 */
function isCodeFenceDelimiter(text: string): { is: boolean; marker: string } {
  const match = text.match(/^(`{3,}|~{3,})/);
  if (match) {
    return { is: true, marker: match[1] };
  }
  return { is: false, marker: '' };
}

/**
 * Determine the type of a line
 */
function getLineType(text: string, trimmed: string): LineType {
  // Check code fence state
  const fenceCheck = isCodeFenceDelimiter(trimmed);
  if (fenceCheck.is) {
    if (!inCodeFence) {
      inCodeFence = true;
      codeFenceMarker = fenceCheck.marker;
      return 'code';
    } else if (trimmed.startsWith(codeFenceMarker.charAt(0))) {
      inCodeFence = false;
      codeFenceMarker = '';
      return 'code';
    }
  }

  if (inCodeFence) {
    return 'code';
  }

  // Blank line
  if (trimmed === '') {
    return 'blank';
  }

  // Heading (markdown # syntax)
  if (/^#{1,6}\s/.test(trimmed)) {
    return 'heading';
  }

  // Numbered heading (e.g., "1. Customer Feedback")
  // Must check BEFORE list item pattern to take precedence
  // Allow minimal indentation (0-2 spaces) to distinguish from nested list items
  if (/^\s{0,2}\d+\.\s+\S/.test(text)) {
    return 'heading';
  }

  // Blockquote
  if (/^>\s/.test(trimmed)) {
    return 'quote';
  }

  // List item (bullet or numbered)
  if (/^[-*+•]\s/.test(trimmed) || /^\d+[.)]\s/.test(trimmed)) {
    return 'list_item';
  }

  // Default to paragraph
  return 'paragraph';
}

/**
 * Get heading level from a heading line
 */
function getHeadingLevel(text: string): number | undefined {
  const trimmed = text.trim();

  // Markdown # syntax
  const hashMatch = trimmed.match(/^(#{1,6})\s/);
  if (hashMatch) {
    return hashMatch[1].length;
  }

  // Numbered heading format (e.g., "1. Title")
  if (/^\s{0,2}\d+\.\s+\S/.test(text)) {
    return 2; // treat as level 2
  }

  return undefined;
}

/**
 * Get indent level for list items
 */
function getIndentLevel(text: string): number | undefined {
  // Count leading spaces/tabs
  const match = text.match(/^(\s*)/);
  if (match) {
    const indent = match[1];
    // Convert tabs to spaces (assume 2 space indent)
    const spaces = indent.replace(/\t/g, '  ').length;
    return Math.floor(spaces / 2);
  }
  return 0;
}

/**
 * Get heading text (without # markers or number prefix)
 */
function getHeadingText(text: string): string {
  const trimmed = text.trim();

  // Strip markdown # syntax
  const withoutHash = trimmed.replace(/^#{1,6}\s+/, '');

  // Strip numbered heading format (e.g., "1. " → "")
  const withoutNumber = withoutHash.replace(/^\d+\.\s+/, '');

  return withoutNumber.trim();
}

/**
 * Annotate all lines in a note
 */
export function annotateLines(rawMarkdown: string): Line[] {
  resetCodeFenceState();

  const rawLines = rawMarkdown.split('\n');
  const lines: Line[] = [];

  for (let i = 0; i < rawLines.length; i++) {
    const text = rawLines[i];
    const trimmed = text.trim();
    const lineType = getLineType(text, trimmed);

    const line: Line = {
      index: i,
      text: text,
      line_type: lineType,
    };

    if (lineType === 'heading') {
      line.heading_level = getHeadingLevel(trimmed);
    }

    if (lineType === 'list_item') {
      line.indent_level = getIndentLevel(text);
    }

    if (lineType === 'code') {
      line.is_code_fence = isCodeFenceDelimiter(trimmed).is;
    }

    lines.push(line);
  }

  return lines;
}

// ============================================
// Section Segmentation
// ============================================

let sectionCounter = 0;

function generateSectionId(noteId: string): string {
  return `sec_${noteId.slice(0, 8)}_${++sectionCounter}`;
}

/**
 * Reset section counter (for testing)
 */
export function resetSectionCounter(): void {
  sectionCounter = 0;
}

/**
 * Check if line is a plain-text heading based on structural rules
 *
 * A line is treated as a heading if ALL are true:
 * - line length ≤ 40 characters
 * - not a bullet or list item
 * - does not end with punctuation (., :, ?, !)
 * - followed by either: a blank line OR a paragraph or bullet list
 */
function isPlainTextHeading(line: Line, nextLine: Line | undefined): boolean {
  // Must be a paragraph type line (not heading, list, etc.)
  if (line.line_type !== 'paragraph') {
    return false;
  }

  const trimmed = line.text.trim();

  // Check length constraint
  if (trimmed.length > 40) {
    return false;
  }

  // Check it's not a bullet point (additional safety)
  if (/^[-*+•]\s/.test(trimmed) || /^\d+[.)]\s/.test(trimmed)) {
    return false;
  }

  // Check it doesn't end with sentence-terminating punctuation.
  // Colon endings are allowed — they are a common heading pattern (e.g. "Quick update on ingestion refactor:")
  if (/[.?!]$/.test(trimmed)) {
    return false;
  }

  // Check what follows
  if (!nextLine) {
    // End of document - accept as heading
    return true;
  }

  // Must be followed by blank line, paragraph, or list
  if (
    nextLine.line_type === 'blank' ||
    nextLine.line_type === 'paragraph' ||
    nextLine.line_type === 'list_item'
  ) {
    return true;
  }

  return false;
}

/**
 * Check if line is a pseudo-heading (strong cue without # markers)
 */
function isPseudoHeading(text: string): boolean {
  const trimmed = text.trim();
  const pseudoPatterns = [
    /^(Plan|Roadmap|Execution|Next Steps|Decisions|Goals|Scope|Timeline|Strategy):/i,
    /^(Q[1-4]\s+\d{4}|H[12]\s+\d{4})/i, // Quarter or half references
    /^(Phase\s+\d+|Sprint\s+\d+)/i,
  ];
  return pseudoPatterns.some((p) => p.test(trimmed));
}

/**
 * Compute structural features for a section
 */
function computeStructuralFeatures(bodyLines: Line[]): StructuralFeatures {
  const numLines = bodyLines.length;
  const numListItems = bodyLines.filter((l) => l.line_type === 'list_item').length;

  const fullText = bodyLines.map((l) => l.text).join(' ').toLowerCase();

  // Date patterns
  const hasDatePattern =
    /\b(january|february|march|april|may|june|july|august|september|october|november|december|\d{1,2}\/\d{1,2}|\d{4})\b/i;
  const hasDates = hasDatePattern.test(fullText);

  // Metric patterns
  const hasMetricPattern = /\b(\d+%|\d+x|\$\d+|ARR|MRR|DAU|MAU|NPS|OKR)\b/i;
  const hasMetrics = hasMetricPattern.test(fullText);

  // Quarter references
  const hasQuarterRefs = /\b(Q[1-4]|H[12])\b/i.test(fullText);

  // Version references
  const hasVersionRefs = /\b(v\d+|MVP|alpha|beta|GA|launch)\b/i.test(fullText);

  // Launch keywords
  const hasLaunchKeywords = /\b(launch|rollout|ship|release|deploy|go-live)\b/i.test(fullText);

  // Initiative phrase density
  const initiativePatterns = [
    /\blaunch\s+\w+/gi,
    /\bbuild\s+\w+/gi,
    /\bcreate\s+\w+/gi,
    /\bspin\s+up\s+\w+/gi,
    /\brollout\s+\w+/gi,
    /\bshipt\s+\w+/gi,
    /\bdeliver\s+\w+/gi,
    /\bimplement\s+\w+/gi,
  ];

  let initiativePhraseCount = 0;
  for (const pattern of initiativePatterns) {
    const matches = fullText.match(pattern);
    if (matches) {
      initiativePhraseCount += matches.length;
    }
  }

  const wordCount = fullText.split(/\s+/).length;
  const initiativePhraseDensity = wordCount > 0 ? Math.min(1, initiativePhraseCount / (wordCount / 10)) : 0;

  return {
    num_lines: numLines,
    num_list_items: numListItems,
    has_dates: hasDates,
    has_metrics: hasMetrics,
    has_quarter_refs: hasQuarterRefs,
    has_version_refs: hasVersionRefs,
    has_launch_keywords: hasLaunchKeywords,
    initiative_phrase_density: initiativePhraseDensity,
  };
}

/**
 * Remove empty sections (heading-only, no body content).
 * When an empty section precedes a non-empty section, its heading is
 * prepended to the next section's heading (e.g. "Parent > Child").
 * Otherwise the empty section is dropped entirely.
 *
 * Structural only — no content-specific logic.
 */
function removeEmptySections(sections: Section[]): Section[] {
  const result: Section[] = [];
  let pendingHeading: string | undefined;

  for (const section of sections) {
    const hasBody = section.raw_text.trim().length > 0;

    if (!hasBody) {
      // Empty section: stash its heading for merging into the next section
      if (section.heading_text && section.heading_text !== 'General') {
        pendingHeading = pendingHeading
          ? `${pendingHeading} > ${section.heading_text}`
          : section.heading_text;
      }
      continue;
    }

    // Non-empty section: merge any pending heading
    if (pendingHeading && section.heading_text) {
      result.push({
        ...section,
        heading_text: `${pendingHeading} > ${section.heading_text}`,
      });
    } else if (pendingHeading) {
      result.push({
        ...section,
        heading_text: pendingHeading,
      });
    } else {
      result.push(section);
    }
    pendingHeading = undefined;
  }

  // Any trailing pending heading with no following section is simply dropped
  return result;
}

/**
 * Segment lines into sections based on headings
 */
export function segmentIntoSections(noteId: string, lines: Line[]): Section[] {
  // Handle empty input
  if (lines.length === 0) {
    return [];
  }

  // Check if all lines are blank
  const nonBlankLines = lines.filter((l) => l.line_type !== 'blank');
  if (nonBlankLines.length === 0) {
    return [];
  }

  const sections: Section[] = [];
  let currentSection: Partial<Section> | null = null;
  let currentBodyLines: Line[] = [];

  function finalizeSection(): void {
    if (currentSection && currentBodyLines.length > 0) {
      currentSection.body_lines = currentBodyLines;
      currentSection.end_line = currentBodyLines[currentBodyLines.length - 1].index;
      currentSection.structural_features = computeStructuralFeatures(currentBodyLines);
      currentSection.raw_text = currentBodyLines.map((l) => l.text).join('\n');
      sections.push(currentSection as Section);
    }
    currentSection = null;
    currentBodyLines = [];
  }

  // Track whether we have seen a markdown heading (# markers)
  // Plain-text headings are only recognized when not under a markdown heading
  let hasMarkdownHeading = false;
  let hasAnyHeading = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const nextLine = i + 1 < lines.length ? lines[i + 1] : undefined;

    // Check for markdown heading (# markers)
    if (line.line_type === 'heading') {
      hasMarkdownHeading = true;
      hasAnyHeading = true;

      // Finalize previous section
      finalizeSection();

      // Detect if this is a numbered heading for debug tracing
      const isNumberedHeading = /^\s{0,2}\d+\.\s+\S/.test(line.text);

      // Start new section
      currentSection = {
        section_id: generateSectionId(noteId),
        note_id: noteId,
        heading_text: getHeadingText(line.text),
        heading_level: line.heading_level,
        start_line: line.index,
        end_line: line.index,
        body_lines: [],
        structural_features: {} as StructuralFeatures,
        raw_text: '',
        // Debug marker to confirm numbered heading detection is running
        _debug_segmentation_version: isNumberedHeading ? 'v2-numbered-headings' : undefined,
      };
      continue;
    }

    // Check for plain-text heading (only when not under a markdown heading section)
    // Plain-text headings are recognized in "General" sections or when no markdown heading exists
    const isInGeneralSection = currentSection && currentSection.heading_text === 'General';
    if ((!hasMarkdownHeading || isInGeneralSection) && isPlainTextHeading(line, nextLine)) {
      hasAnyHeading = true;

      // Finalize previous section
      finalizeSection();

      // Start new section with plain-text heading
      currentSection = {
        section_id: generateSectionId(noteId),
        note_id: noteId,
        heading_text: line.text.trim().replace(/:$/, ''),
        heading_level: 2, // Treat plain-text headings as level 2
        start_line: line.index,
        end_line: line.index,
        body_lines: [],
        structural_features: {} as StructuralFeatures,
        raw_text: '',
      };
      continue;
    }

    // Check for pseudo-heading patterns (legacy support)
    if (isPseudoHeading(line.text) && !hasAnyHeading) {
      hasAnyHeading = true;

      // Finalize previous section
      finalizeSection();

      // Start new section
      currentSection = {
        section_id: generateSectionId(noteId),
        note_id: noteId,
        heading_text: line.text.replace(/:$/, '').trim(),
        heading_level: 2, // Treat as level 2
        start_line: line.index,
        end_line: line.index,
        body_lines: [],
        structural_features: {} as StructuralFeatures,
        raw_text: '',
      };
      continue;
    }

    // Add to current section body
    if (currentSection) {
      currentBodyLines.push(line);
    } else if (!hasAnyHeading) {
      // Content before first heading - create "General" section
      if (!currentSection) {
        currentSection = {
          section_id: generateSectionId(noteId),
          note_id: noteId,
          heading_text: 'General',
          heading_level: 1,
          start_line: line.index,
          end_line: line.index,
          body_lines: [],
          structural_features: {} as StructuralFeatures,
          raw_text: '',
        };
      }
      currentBodyLines.push(line);
    }
  }

  // Finalize last section
  finalizeSection();

  // Post-processing: remove empty sections (heading with no substantive body).
  // A section is empty if its raw_text is all whitespace (charCount == 0 after trim).
  // Merge its heading into the next section when possible, otherwise drop.
  return removeEmptySections(sections);
}

// ============================================
// Full Preprocessing Pipeline
// ============================================

/**
 * Preprocess a note: annotate lines and segment into sections
 */
export function preprocessNote(note: NoteInput): PreprocessingResult {
  // Normalize line endings
  const normalizedMarkdown = note.raw_markdown.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Annotate lines
  const lines = annotateLines(normalizedMarkdown);

  // Segment into sections
  const sections = segmentIntoSections(note.note_id, lines);

  return {
    lines,
    sections,
  };
}

/**
 * Get the raw text of a section (for synthesis)
 */
export function getSectionText(section: Section, includeHeading: boolean = true): string {
  const headingLine = includeHeading && section.heading_text ? `# ${section.heading_text}\n` : '';
  return headingLine + section.raw_text;
}

/**
 * Normalize text for comparison (case-fold, whitespace collapse)
 */
export function normalizeForComparison(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s]/g, '')
    .trim();
}
