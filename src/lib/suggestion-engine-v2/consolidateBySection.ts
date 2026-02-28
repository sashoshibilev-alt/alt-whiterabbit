/**
 * Stage 6.5 — Section Consolidation
 *
 * Runs AFTER candidate generation and scoring (Stage 5),
 * BEFORE routing (Stage 6).
 *
 * Problem it solves:
 *   Structured sections like "### Black Box Prioritization System" with 3+ bullets
 *   can produce multiple fragmented idea candidates.  This stage collapses them
 *   into one consolidated suggestion so the user sees the whole idea, not fragments.
 *
 * Consolidation rule (ALL conditions must hold):
 *   1. section.heading_level <= 3
 *   2. section.structural_features.num_list_items >= 3
 *   3. section raw_text contains NO delta/timeline tokens
 *   4. More than 1 candidate emitted for that sectionId
 *   5. ALL candidates for the section have type === 'idea'
 *
 * Exclusions (never consolidated):
 *   - risk candidates
 *   - project_update candidates
 *   - sections with concrete timeline/delta signals
 */

import type { Suggestion, EvidenceSpan, ClassifiedSection } from './types';
import { normalizeTitlePrefix } from './title-normalization';
import { computeSuggestionKey } from '../suggestion-keys';
import { normalizeForComparison } from './preprocessing';
import {
  countGamificationTokens,
  computeGamificationClusterTitle,
} from './sectionSignals';

// Gamification cluster tokens are imported from ./sectionSignals.

// ============================================
// Delta/timeline signal detection
// ============================================

/**
 * Patterns that indicate a concrete timeline or delta signal in a section.
 * If any match in the section raw_text, we do NOT consolidate.
 */
const TIMELINE_PATTERNS: RegExp[] = [
  /\d+-(?:week|day|month|year|sprint)s?/i,
  /\d+\s+(?:week|day|month|year|sprint)s?/i,
  /from\s+\d[-–]\w+\s+to\s+\d[-–]\w+/i,          // from 1-year to 5-year
  /\d+[-–]\w+\s+to\s+\d+[-–]\w+/i,                // 1-year to 5-year
  /extend(?:ed|ing)?\s+from\s+/i,                  // extending from
  /delayed?\s+(?:to|until|by)\s+/i,
  /pushed?\s+(?:to|until)\s+/i,
  /\d+(?:st|nd|rd|th)\s*[→\-–]\s*\d+(?:st|nd|rd|th)/i,
  /Q[1-4]\s+\d{4}/i,                               // Q1 2025
  /20\d\d[-–]20\d\d/i,                             // 2024-2025
];

export function sectionHasDeltaSignal(rawText: string): boolean {
  return TIMELINE_PATTERNS.some((re) => re.test(rawText));
}

// ============================================
// Span merging
// ============================================

/**
 * Build a consolidated body string from merged evidence spans.
 *
 * Joins the text of up to `maxSpans` spans into a readable multi-bullet body.
 * Strips leading list markers from each span, joins with ". ", and caps at 320 chars.
 * This ensures the consolidated body is derived from the same span previews
 * used to populate evidenceSpans — not inherited from the anchor candidate.
 */
export function buildConsolidatedBody(spans: EvidenceSpan[], maxSpans: number = 4): string {
  const parts = spans
    .slice(0, maxSpans)
    .map((s) =>
      s.text
        .trim()
        .replace(/^[\s\-*+]+/, '')   // strip list markers
        .replace(/^\d+\.\s*/, '')    // strip numbered list markers
        .trim()
    )
    .filter((t) => t.length > 0);

  if (parts.length === 0) return '';

  const joined = parts.join('. ').replace(/\.+/g, '.').replace(/\.\s*$/, '') + '.';
  return joined.length > 320 ? joined.slice(0, 317) + '…' : joined;
}

/**
 * Verify that all evidencePreview strings are substrings of the section's
 * normalized text. Returns the first failing preview, or null if all pass.
 *
 * Used by the invariant test and internally to catch mismatches.
 */
export function findMismatchedEvidencePreview(
  previews: string[],
  sectionNormalizedText: string
): string | null {
  for (const preview of previews) {
    const normalizedPreview = normalizeForComparison(preview);
    if (normalizedPreview.length > 0 && !sectionNormalizedText.includes(normalizedPreview)) {
      return preview;
    }
  }
  return null;
}

/**
 * Collect up to `maxSpans` unique evidence spans from a list of candidates.
 * Deduplicates by trimmed text to avoid repeating the same phrase.
 */
function mergeTopSpansFromCandidates(
  candidates: Suggestion[],
  maxSpans: number = 5
): EvidenceSpan[] {
  const seen = new Set<string>();
  const result: EvidenceSpan[] = [];

  for (const candidate of candidates) {
    for (const span of candidate.evidence_spans) {
      const key = span.text.trim();
      if (key && !seen.has(key)) {
        seen.add(key);
        result.push(span);
        if (result.length >= maxSpans) return result;
      }
    }
  }

  return result;
}

// ============================================
// ID generation for consolidated suggestions
// ============================================

let consolidationCounter = 0;

function generateConsolidatedId(noteId: string): string {
  return `sug_consolidated_${noteId.slice(0, 8)}_${++consolidationCounter}`;
}

export function resetConsolidationCounter(): void {
  consolidationCounter = 0;
}

// ============================================
// Main export
// ============================================

/**
 * Consolidate fragmented idea candidates within the same structured section.
 *
 * @param suggestions - Output from Stage 5 (scored suggestions)
 * @param sectionMap  - Lookup map from section_id to ClassifiedSection
 * @returns Modified suggestion list with qualifying groups collapsed
 */
export function consolidateBySection(
  suggestions: Suggestion[],
  sectionMap: Map<string, ClassifiedSection>
): Suggestion[] {
  // Group suggestions by section_id
  const bySection = new Map<string, Suggestion[]>();
  for (const s of suggestions) {
    const group = bySection.get(s.section_id);
    if (group) {
      group.push(s);
    } else {
      bySection.set(s.section_id, [s]);
    }
  }

  const result: Suggestion[] = [];

  for (const [sectionId, group] of bySection) {
    // Fast-path: single candidate — always pass through
    if (group.length <= 1) {
      result.push(...group);
      continue;
    }

    // Check whether ALL candidates are type 'idea'
    const allIdea = group.every((s) => s.type === 'idea');
    if (!allIdea) {
      // Mixed types — pass through unchanged
      result.push(...group);
      continue;
    }

    // Look up the section to verify structural conditions
    const section = sectionMap.get(sectionId);
    if (!section) {
      result.push(...group);
      continue;
    }

    const headingLevel = section.heading_level ?? 999;
    const bulletCount = section.structural_features.num_list_items;

    if (
      headingLevel <= 3 &&
      bulletCount >= 3 &&
      !sectionHasDeltaSignal(section.raw_text)
    ) {
      // ---- Consolidate ----
      // Use the first candidate as the structural anchor (highest confidence)
      const anchor = group[0];

      const mergedSpans = mergeTopSpansFromCandidates(group, 5);

      // Title from section heading — with cluster-level override for gamification
      const headingText = section.heading_text?.trim() || anchor.title;
      let consolidatedTitle: string;

      // Gamification cluster-level title override
      const bulletTexts = section.body_lines
        .filter((l) => l.line_type === 'list_item')
        .map((l) => l.text)
        .join(' ')
        .toLowerCase();
      const gamCount = countGamificationTokens(bulletTexts);
      if (bulletCount >= 4 && gamCount >= 2) {
        consolidatedTitle = normalizeTitlePrefix(
          'idea',
          computeGamificationClusterTitle(headingText, bulletTexts),
        );
      } else {
        consolidatedTitle = normalizeTitlePrefix('idea', headingText);
      }

      const consolidatedId = generateConsolidatedId(anchor.note_id);
      const suggestionKey = computeSuggestionKey({
        noteId: anchor.note_id,
        sourceSectionId: sectionId,
        type: 'idea',
        title: consolidatedTitle,
      });

      // Build body from merged span previews (NOT from anchor candidate body)
      // This keeps the body consistent with the evidenceSpans array.
      const consolidatedBody = buildConsolidatedBody(mergedSpans, 4);
      const consolidatedEvidencePreview = mergedSpans
        .slice(0, 4)
        .map((s) => s.text.trim())
        .filter((t) => t.length > 0);

      const consolidated: Suggestion = {
        ...anchor,
        suggestion_id: consolidatedId,
        title: consolidatedTitle,
        evidence_spans: mergedSpans,
        suggestionKey,
        metadata: {
          ...anchor.metadata,
          source: 'consolidated-section',
        },
        // Build suggestion context from merged spans (not anchor body)
        suggestion: {
          title: consolidatedTitle,
          body: consolidatedBody || (anchor.suggestion?.body ?? ''),
          evidencePreview: consolidatedEvidencePreview,
          sourceSectionId: sectionId,
          sourceHeading: section.heading_text?.trim() ?? anchor.suggestion?.sourceHeading ?? '',
        },
      };

      result.push(consolidated);
    } else {
      // Conditions not met — pass through unchanged
      result.push(...group);
    }
  }

  return result;
}
