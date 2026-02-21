/**
 * B-Signal Candidate Seeding
 *
 * For each actionable section, extract B-signals using extractSignalsFromSentences
 * and create Suggestion candidates directly from them. Appended to existing candidate
 * list after normal synthesis. Simple deduplicated by (sentenceIndex, proposedType).
 */

import type { ClassifiedSection, Suggestion, SuggestionPayload, SuggestionScores, SuggestionRouting, SuggestionContext } from './types';
import type { Signal } from './signals/types';
import { extractSignalsFromSentences } from './signals';
import { computeSuggestionKey } from '../suggestion-keys';
import { shouldSuppressProcessSentence } from './processNoiseSuppression';

// ============================================
// ID generation (mirrors synthesis.ts counter)
// ============================================

let bSignalCounter = 0;

function generateBSignalId(noteId: string): string {
  return `sug_bsig_${noteId.slice(0, 8)}_${++bSignalCounter}_${Date.now().toString(36)}`;
}

/**
 * Reset counter for deterministic test IDs.
 */
export function resetBSignalCounter(): void {
  bSignalCounter = 0;
}

// ============================================
// Title generation
// ============================================

/**
 * Extract the object from a sentence after a trigger verb using simple regex.
 * Returns null if extraction fails.
 *
 * Strategy: match common trigger verbs followed by the remainder of the clause,
 * then trim to the first clause boundary or 50 chars.
 */
function extractObjectFromSentence(sentence: string): string | null {
  // Match: <trigger verb> <object phrase>
  const match = sentence.match(
    /\b(?:need|needs|require|requires|want|wants|requesting|asking\s+for|screaming\s+for|implement|build|add|fix|push(?:ing)?|pull(?:ing)?|slip(?:ping)?|fail(?:ing)?|block(?:ing)?)\s+([^.,;!?\n]{3,120})/i
  );
  if (!match) return null;

  let obj = match[1].trim();
  // Stop at common clause boundaries so titles stay clean
  obj = obj.split(/\bbut\b|\buntil\b|\bbecause\b|\bso\b|\bwhen\b|\bunless\b/i)[0].trim();
  // Remove leading articles
  obj = obj.replace(/^(a|an|the)\s+/i, '');
  // Trim to word boundary at 50 chars
  if (obj.length > 50) {
    const truncated = obj.slice(0, 50);
    const lastSpace = truncated.lastIndexOf(' ');
    obj = lastSpace > 10 ? truncated.slice(0, lastSpace) : truncated;
  }
  return obj.length >= 3 ? obj : null;
}

/**
 * Generate a deterministic title from a B-signal using simple regex extraction.
 * Falls back to type-specific defaults when object extraction fails.
 */
export function titleFromSignal(signal: Signal): string {
  const obj = extractObjectFromSentence(signal.sentence);

  switch (signal.signalType) {
    case 'FEATURE_DEMAND':
      return obj ? `Implement ${obj}` : 'Implement requested feature';
    case 'PLAN_CHANGE':
      return obj ? `Update: ${obj}` : 'Update: project plan';
    case 'SCOPE_RISK':
      return obj ? `Risk: ${obj}` : 'Mitigate release risk';
    case 'BUG':
      return obj ? `Fix ${obj} issue` : 'Fix reported issue';
  }
}

// ============================================
// Candidate creation
// ============================================

/**
 * Create a Suggestion candidate from a B-signal and its parent section.
 */
function candidateFromSignal(signal: Signal, section: ClassifiedSection): Suggestion {
  const title = titleFromSignal(signal);
  const type = signal.proposedType;

  const payload: SuggestionPayload =
    type === 'project_update'
      ? { after_description: signal.sentence }
      : {
          draft_initiative: {
            title,
            description: signal.sentence,
          },
        };

  const scores: SuggestionScores = {
    section_actionability: signal.confidence,
    type_choice_confidence: signal.confidence,
    synthesis_confidence: signal.confidence,
    overall: signal.confidence,
  };

  const routing: SuggestionRouting = {
    create_new: true,
  };

  const evidenceSpan = {
    start_line: section.start_line,
    end_line: section.end_line,
    text: signal.sentence,
  };

  const suggestionContext: SuggestionContext = {
    title,
    body: signal.sentence,
    evidencePreview: [signal.sentence],
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
    suggestion_id: generateBSignalId(section.note_id),
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
      source: 'b-signal',
      type: signal.proposedType,
      label: signal.label,
      confidence: signal.confidence,
      explicitType: true,
    },
    suggestion: suggestionContext,
  };
}

// ============================================
// Deduplication
// ============================================

type SignalKey = `${number}:${string}`;

function signalKey(sentenceIndex: number, proposedType: string): SignalKey {
  return `${sentenceIndex}:${proposedType}`;
}

/**
 * Deduplicate B-signal candidates within a batch:
 * same sentenceIndex + same proposedType → keep highest confidence.
 * Does not remove candidates from the existing list.
 */
function deduplicateSignalCandidates(
  signals: Signal[]
): Signal[] {
  const best = new Map<SignalKey, Signal>();

  for (const signal of signals) {
    const key = signalKey(signal.sentenceIndex, signal.proposedType);
    const existing = best.get(key);
    if (!existing || signal.confidence > existing.confidence) {
      best.set(key, signal);
    }
  }

  return Array.from(best.values());
}

// ============================================
// Public API
// ============================================

/**
 * Extract B-signals from an actionable section's body text and return
 * deduplicated Suggestion candidates. Candidates are meant to be appended
 * to the existing candidate list after normal synthesis.
 */
export function seedCandidatesFromBSignals(section: ClassifiedSection): Suggestion[] {
  // Split raw_text into sentences for the extractors
  const sentences = section.raw_text
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 0);

  if (sentences.length === 0) return [];

  const signals = extractSignalsFromSentences(sentences);

  if (signals.length === 0) return [];

  // Suppress B-signals whose sentence is process/ownership ambiguity noise.
  const filteredSignals = signals.filter(signal => {
    if (!shouldSuppressProcessSentence(signal.sentence)) return true;
    if (typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production') {
      console.log('[B_SIGNAL_SKIP_PROCESS_NOISE]', {
        sentencePreview: signal.sentence.slice(0, 80),
        matchedMarker: 'process_noise',
      });
    }
    return false;
  });

  if (filteredSignals.length === 0) return [];

  const dedupedSignals = deduplicateSignalCandidates(filteredSignals);

  return dedupedSignals.map(signal => candidateFromSignal(signal, section));
}
