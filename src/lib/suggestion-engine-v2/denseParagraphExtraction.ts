/**
 * Dense Paragraph Candidate Extraction
 *
 * FALLBACK RULE (why this exists):
 * When a note section has no bullets and no topic anchors (e.g. a single long
 * meeting-notes paragraph), the normal synthesis pipeline collapses the entire
 * section into at most one suggestion.  That single suggestion loses sentence-
 * level grounding and misses multiple distinct signals (risk, delay, etc.) that
 * a PM would want to act on separately.
 *
 * This module provides a fallback that:
 *   1. Detects dense-paragraph sections (bulletCount == 0 AND
 *      (lineCount == 1 OR charCount >= 250) AND no topic anchors).
 *   2. Splits the section text into sentence spans deterministically.
 *   3. Runs the existing B-signal extractors on every sentence.
 *   4. Emits one candidate per signal-bearing sentence, with evidence grounded
 *      in that sentence.
 *
 * Determinism guarantee: sentence splitting uses only deterministic regex;
 * no Math.random(), no Date.now() in IDs (counter-based only).
 * Grounding guarantee: every evidence span is a verbatim substring of the
 * source section raw_text.
 */

import type {
  ClassifiedSection,
  Suggestion,
  SuggestionPayload,
  SuggestionScores,
  SuggestionRouting,
  SuggestionContext,
  EvidenceSpan,
} from './types';
import { extractSignalsFromSentences } from './signals';
import type { Signal } from './signals/types';
import { computeSuggestionKey } from '../suggestion-keys';
import { shouldSuppressProcessSentence } from './processNoiseSuppression';
import { titleFromSignal } from './bSignalSeeding';
import { hasPlanChangeEligibility } from './classifiers';

// ============================================
// ID generation (separate counter for traceability)
// ============================================

let denseParagraphCounter = 0;

function generateDenseParagraphId(noteId: string): string {
  return `sug_dp_${noteId.slice(0, 8)}_${++denseParagraphCounter}`;
}

/**
 * Reset counter for deterministic test IDs.
 */
export function resetDenseParagraphCounter(): void {
  denseParagraphCounter = 0;
}

// ============================================
// Sentence splitting
// ============================================

/**
 * Split text into sentence spans deterministically.
 *
 * Strategy:
 * - Split on `. `, `! `, `? ` (sentence-final punctuation followed by space).
 * - Also split on sentence-final punctuation at end-of-string.
 * - Preserve content inside quotes by not splitting mid-quote.
 * - Trim whitespace; drop empty results.
 * - Return sentences in source order (stable).
 *
 * We intentionally do NOT split on `. ` inside quoted strings like `"garbage."`
 * because those are often scare-quoted words, not sentence boundaries.  A simple
 * heuristic: after splitting on `. `, if a fragment starts with a lowercase
 * letter (continuation), re-join with the previous fragment.  This handles the
 * most common case without a full parser.
 */
export function splitIntoSentenceSpans(text: string): string[] {
  // Primary split on sentence-terminating punctuation followed by whitespace,
  // or at the very end of string.
  const raw = text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  // Re-join fragments that start with a lowercase letter (likely continuation
  // after an abbreviation like "e.g. something" or a scare-quoted word ending
  // with a period like `"garbage."  We're looking`).
  const merged: string[] = [];
  for (const fragment of raw) {
    if (
      merged.length > 0 &&
      fragment.length > 0 &&
      /^[a-z]/.test(fragment)
    ) {
      // This fragment starts lowercase → it is a continuation of the previous sentence.
      merged[merged.length - 1] = merged[merged.length - 1] + ' ' + fragment;
    } else {
      merged.push(fragment);
    }
  }

  return merged.filter((s) => s.trim().length > 0);
}

// ============================================
// Dense paragraph detection
// ============================================

/**
 * Returns true when a classified section qualifies for dense-paragraph
 * candidate extraction.
 *
 * Trigger conditions (all must be true):
 *   - bulletCount == 0   (no bullet or numbered list items)
 *   - (lineCount == 1 OR charCount >= 250)   (single line OR long text)
 *   - no extractable topic anchors in body lines
 *
 * This deliberately mirrors the condition described in the engine spec so
 * that future changes to topic-anchor detection automatically propagate here.
 */
export function isDenseParagraphSection(section: ClassifiedSection): boolean {
  const bulletCount = section.structural_features.num_list_items;
  if (bulletCount !== 0) return false;

  const lineCount = section.structural_features.num_lines;
  const charCount = section.raw_text.length;
  if (lineCount > 1 && charCount < 250) return false;

  // Check for topic anchors: if any body line starts with a recognized topic
  // keyword (same definition as hasExtractableTopicAnchors in synthesis.ts)
  // we do NOT use the dense-paragraph path — normal topic isolation handles it.
  const hasTopicAnchors = section.body_lines.some((line) => {
    const lower = line.text.trim().toLowerCase();
    return (
      lower.startsWith('new feature') ||
      lower.startsWith('feature request') ||
      lower.startsWith('project timeline') ||
      lower.startsWith('internal operation') ||
      lower.startsWith('cultural shift') ||
      lower.startsWith('bug:') ||
      lower.startsWith('risk:')
    );
  });
  if (hasTopicAnchors) return false;

  return true;
}

// ============================================
// Candidate creation
// ============================================

/**
 * Build a Suggestion from a sentence-level signal.
 * The evidence span text is the exact sentence string — a verbatim substring
 * of the section's raw_text — satisfying the grounding invariant.
 */
function candidateFromSentenceSignal(
  signal: Signal,
  sentence: string,
  section: ClassifiedSection
): Suggestion {
  const title = titleFromSignal(signal);
  const type = signal.proposedType;

  const payload: SuggestionPayload =
    type === 'project_update'
      ? { after_description: sentence }
      : {
          draft_initiative: {
            title,
            description: sentence,
          },
        };

  const scores: SuggestionScores = {
    section_actionability: signal.confidence,
    type_choice_confidence: signal.confidence,
    synthesis_confidence: signal.confidence,
    overall: signal.confidence,
  };

  const routing: SuggestionRouting = { create_new: true };

  // Find the line index for this sentence within the section body.
  // We search for the sentence text in each line; if not found, fall back
  // to the section start/end lines.
  let spanStartLine = section.start_line;
  let spanEndLine = section.end_line;
  for (const line of section.body_lines) {
    if (line.text.includes(sentence) || sentence.includes(line.text.trim())) {
      spanStartLine = line.index;
      spanEndLine = line.index;
      break;
    }
  }

  const evidenceSpan: EvidenceSpan = {
    start_line: spanStartLine,
    end_line: spanEndLine,
    text: sentence,
  };

  const suggestionContext: SuggestionContext = {
    title,
    body: sentence,
    evidencePreview: [sentence],
    sourceSectionId: section.section_id,
    sourceHeading: section.heading_text || '',
  };

  const suggestionKey = computeSuggestionKey({
    noteId: section.note_id,
    sourceSectionId: section.section_id,
    type,
    title,
  });

  return {
    suggestion_id: generateDenseParagraphId(section.note_id),
    note_id: section.note_id,
    section_id: section.section_id,
    type,
    title,
    payload,
    evidence_spans: [evidenceSpan],
    scores,
    routing,
    suggestionKey,
    metadata: {
      source: 'dense-paragraph',
      type: signal.proposedType,
      label: signal.label,
      confidence: signal.confidence,
      explicitType: true,
      // planChangeEligible: true means this sentence's span satisfies the
      // change-marker + concrete-delta rule, so it qualifies for plan_change
      // override (bypass ACTIONABILITY gate).  Candidates without this flag
      // must not inherit plan_change override from a sibling sentence in the
      // same parent section.
      planChangeEligible: hasPlanChangeEligibility(sentence),
    },
    suggestion: suggestionContext,
  };
}

// ============================================
// Deduplication
// ============================================

/**
 * Within a batch of dense-paragraph candidates, keep at most one candidate
 * per (sentenceIndex, proposedType) pair — take the highest-confidence one.
 *
 * This mirrors bSignalSeeding.ts deduplication to stay consistent.
 */
function deduplicateDenseParagraphCandidates(
  pairs: Array<{ signal: Signal; sentence: string }>
): Array<{ signal: Signal; sentence: string }> {
  const best = new Map<string, { signal: Signal; sentence: string }>();

  for (const pair of pairs) {
    const key = `${pair.signal.sentenceIndex}:${pair.signal.proposedType}`;
    const existing = best.get(key);
    if (!existing || pair.signal.confidence > existing.signal.confidence) {
      best.set(key, pair);
    }
  }

  return Array.from(best.values());
}

// ============================================
// Public API
// ============================================

/**
 * Extract dense-paragraph candidates from a section.
 *
 * Returns an empty array if the section does not qualify (isDenseParagraphSection
 * returns false) or if no signal-bearing sentences are found.
 *
 * The returned candidates have:
 *   - evidence_spans[0].text === the triggering sentence (verbatim substring)
 *   - metadata.source === 'dense-paragraph'
 *   - type determined by the B-signal extractor that fired
 *
 * Process-noise sentences are suppressed using the shared predicate.
 * Duplicate (sentence, type) pairs are collapsed keeping highest confidence.
 */
export function extractDenseParagraphCandidates(
  section: ClassifiedSection,
  coveredTexts?: Set<string>
): Suggestion[] {
  if (!isDenseParagraphSection(section)) return [];

  const sentences = splitIntoSentenceSpans(section.raw_text);
  if (sentences.length === 0) return [];

  // Run signal extraction per sentence (same extractors as B-signal seeding)
  const signals = extractSignalsFromSentences(sentences);
  if (signals.length === 0) return [];

  // Pair each signal with its triggering sentence
  const pairs: Array<{ signal: Signal; sentence: string }> = [];
  for (const signal of signals) {
    const sentence = sentences[signal.sentenceIndex];
    if (!sentence) continue;

    // Suppress process/ownership noise
    if (shouldSuppressProcessSentence(sentence)) continue;

    // Skip if already covered by an existing candidate's evidence
    const trimmed = sentence.trim();
    if (coveredTexts && coveredTexts.has(trimmed)) continue;

    // Verify grounding: sentence must appear verbatim in raw_text
    if (!section.raw_text.includes(trimmed)) continue;

    pairs.push({ signal, sentence: trimmed });
  }

  // Deduplicate within this batch
  const deduped = deduplicateDenseParagraphCandidates(pairs);

  return deduped.map(({ signal, sentence }) =>
    candidateFromSentenceSignal(signal, sentence, section)
  );
}
