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
import { isStrategyHeadingSection, isStrategyOnlySection } from './classifiers';

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

// Headings that suggest a dedicated risk/security/compliance section.
// When present, the heading itself becomes the title base for risk signals.
const RISK_SECTION_HEADING_PATTERN = /\b(security|compliance|risk|considerations)\b/i;

// Headings that indicate an implementation/timeline section.
// When present, date-bearing bullet lines are treated as project_update anchors.
const TIMELINE_SECTION_HEADING_PATTERN = /\b(timeline|implementation|schedule|roadmap|milestones?)\b/i;

// Tokens that mark a bullet line as date/window-bearing (timeline update evidence).
// Matches: "3-month window", "target January", "Q1 2025", "target Jan", numeric months.
const TIMELINE_DATE_TOKENS = /\b(\d+-(?:week|day|month|year|sprint)s?|target\s+\w+|q[1-4]\s*\d{4}|(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?))\b/i;

// Risk/PII lexical tokens — lines with these are security candidates, not timeline anchors.
const SECURITY_LEXICAL_TOKENS = /\b(pii|security|compliance|gdpr|privacy|vulnerability|exposure|logging|blocker)\b/i;

/**
 * Generate a risk signal title using structure-assist when available.
 *
 * If the section heading contains a risk-domain keyword (Security, Compliance,
 * Risk, Considerations), use the heading as the title base:
 *   "Risk: <Heading>"
 * Otherwise derive the title from the sentence content.
 */
function titleForRiskSignal(signal: Signal, headingText: string): string {
  if (headingText && RISK_SECTION_HEADING_PATTERN.test(headingText)) {
    return `Risk: ${headingText}`;
  }
  const obj = extractObjectFromSentence(signal.sentence);
  return obj ? `Risk: ${obj}` : 'Mitigate release risk';
}

/**
 * Generate a project_update title for a timeline-section bullet line (or merged lines).
 *
 * For multi-line merged bodies, uses only the first line for the title.
 * Strips list markers and derives a concise "Update: <content>" title.
 * Truncates to 60 chars so the title stays readable.
 */
function titleForTimelineUpdate(sentence: string): string {
  // For merged multi-line bodies, use only the first line for the title
  const firstLine = sentence.split('\n')[0];
  // Strip leading list markers
  const cleaned = firstLine.replace(/^[-*+\s]+/, '').replace(/^\d+\.\s*/, '').trim();
  // Strip "Immediate focus:" or similar prefixes
  const withoutPrefix = cleaned.replace(/^[\w\s]+:\s*/i, '').trim() || cleaned;
  const truncated = withoutPrefix.length > 60
    ? withoutPrefix.slice(0, 57) + '...'
    : withoutPrefix;
  return `Update: ${truncated}`;
}

/**
 * Extract timeline-update signals from a list of sentences when the section
 * heading matches the TIMELINE_SECTION_HEADING_PATTERN.
 *
 * Fires on lines that contain date/window tokens (e.g., "3-month window",
 * "target January", "Q1 2025") but NOT on lines with security/PII lexical tokens
 * (those are handled as SCOPE_RISK signals by extractScopeRisk).
 *
 * All qualifying lines are MERGED into ONE signal whose body is the
 * concatenation of the matching lines. This prevents multiple project_update
 * candidates from a single timeline section when dates are spread across bullets.
 *
 * Returns at most one PLAN_CHANGE signal, or an empty array.
 */
function extractTimelineUpdateSignals(sentences: string[]): Signal[] {
  const matchingSentences: string[] = [];
  let firstIndex = -1;
  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i];
    if (TIMELINE_DATE_TOKENS.test(sentence) && !SECURITY_LEXICAL_TOKENS.test(sentence)) {
      if (firstIndex === -1) firstIndex = i;
      matchingSentences.push(sentence);
    }
  }
  if (matchingSentences.length === 0) return [];
  // Merge all matching lines into one body so all date/window info is in one candidate
  const mergedBody = matchingSentences.join('\n');
  return [{
    signalType: 'PLAN_CHANGE',
    label: 'project_update',
    proposedType: 'project_update',
    confidence: 0.75,
    sentence: mergedBody,
    sentenceIndex: firstIndex,
  }];
}

/**
 * Generate a deterministic title from a B-signal using simple regex extraction.
 * Falls back to type-specific defaults when object extraction fails.
 * For SCOPE_RISK, heading-based title logic is handled separately via titleForRiskSignal.
 */
export function titleFromSignal(signal: Signal, headingText: string = ''): string {
  switch (signal.signalType) {
    case 'FEATURE_DEMAND': {
      const obj = extractObjectFromSentence(signal.sentence);
      return obj ? `Implement ${obj}` : 'Implement requested feature';
    }
    case 'PLAN_CHANGE': {
      const obj = extractObjectFromSentence(signal.sentence);
      return obj ? `Update: ${obj}` : 'Update: project plan';
    }
    case 'SCOPE_RISK':
      return titleForRiskSignal(signal, headingText);
    case 'BUG': {
      const obj = extractObjectFromSentence(signal.sentence);
      return obj ? `Fix ${obj} issue` : 'Fix reported issue';
    }
  }
}

// ============================================
// Candidate creation
// ============================================

/**
 * Create a Suggestion candidate from a B-signal and its parent section.
 * @param titleOverride - Optional title to use instead of the derived title.
 */
function candidateFromSignal(signal: Signal, section: ClassifiedSection, titleOverride?: string): Suggestion {
  const headingText = section.heading_text?.trim() ?? '';
  const title = titleOverride ?? titleFromSignal(signal, headingText);
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

  // Find the body line that contains this signal sentence so the evidence span
  // points to the correct line — not the entire section range.
  const normalizedSentence = signal.sentence.toLowerCase().trim().replace(/^[-*+\s]+/, '');
  const matchedLine = section.body_lines.find(l => {
    const normalizedLine = l.text.toLowerCase().trim().replace(/^[-*+\s]+/, '');
    return normalizedLine.length > 0 && (
      normalizedLine === normalizedSentence ||
      normalizedLine.includes(normalizedSentence.slice(0, 40)) ||
      normalizedSentence.includes(normalizedLine.slice(0, 40))
    );
  });

  const evidenceSpan = {
    start_line: matchedLine ? matchedLine.index : section.start_line,
    end_line: matchedLine ? matchedLine.index : section.end_line,
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
  // Split raw_text into sentences for the extractors.
  // First split by sentence-ending punctuation, then by newlines (for bullet lists
  // where items don't end with ".!?"). This ensures each bullet line is a distinct
  // candidate sentence so signal extraction anchors to the correct line — preventing
  // cross-mix where a risk signal on line N returns the entire section as its body.
  const rawSentences = section.raw_text
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(s => s.length > 0);

  // If the split produced only one long chunk (typical of bullet lists without
  // trailing punctuation), further split each chunk by newline.
  const sentences: string[] = [];
  for (const chunk of rawSentences) {
    if (chunk.includes('\n')) {
      const lines = chunk.split('\n').map(l => l.trim()).filter(l => l.length > 0);
      sentences.push(...lines);
    } else {
      sentences.push(chunk);
    }
  }

  if (sentences.length === 0) return [];

  const headingText = section.heading_text?.trim() ?? '';
  // Only fire timeline-update extraction when the heading explicitly signals a
  // timeline/schedule section. Do NOT use has_dates as a fallback — that flag is
  // too broad and also fires for decision tables with quarter references.
  const isTimelineSection = TIMELINE_SECTION_HEADING_PATTERN.test(headingText);

  // For timeline sections, also extract timeline-update signals from date-bearing lines.
  // These supplement the standard PLAN_CHANGE detection (which requires shift verbs)
  // so that focus/window/target lines in timeline sections produce project_update candidates.
  const timelineSignals: Signal[] = isTimelineSection
    ? extractTimelineUpdateSignals(sentences)
    : [];

  const signals = [
    ...extractSignalsFromSentences(sentences),
    ...timelineSignals,
  ];

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

  // Part 1 guard: strategy-heading sections with no concrete delta/timeline tokens
  // must not emit project_update candidates from PLAN_CHANGE signals.
  // isStrategyOnlySection returns true when there are no concrete delta or schedule event
  // words — exactly the condition where plan_change override should be suppressed.
  const numListItems = section.structural_features?.num_list_items ?? 0;
  const sectionText = (headingText + ' ' + section.raw_text);
  const isStrategySection =
    isStrategyHeadingSection(headingText, sectionText, numListItems) &&
    isStrategyOnlySection(sectionText);
  const afterStrategyGuard = isStrategySection
    ? filteredSignals.filter(s => s.signalType !== 'PLAN_CHANGE')
    : filteredSignals;

  if (afterStrategyGuard.length === 0) return [];

  // Part 2B: PII specificity preference — if any SCOPE_RISK signal has high confidence
  // (PII+logging pair at 0.85), suppress lower-confidence generic SCOPE_RISK signals.
  // This prevents a "Security considerations" line from generating a duplicate generic
  // risk alongside the specific PII risk.
  const riskSignals = afterStrategyGuard.filter(s => s.signalType === 'SCOPE_RISK');
  const hasPiiSpecificRisk = riskSignals.some(s => s.confidence >= 0.85);
  const afterPiiPreference = hasPiiSpecificRisk
    ? afterStrategyGuard.filter(s => s.signalType !== 'SCOPE_RISK' || s.confidence >= 0.85)
    : afterStrategyGuard;

  if (afterPiiPreference.length === 0) return [];

  const dedupedSignals = deduplicateSignalCandidates(afterPiiPreference);

  return dedupedSignals.map(signal => {
    // For timeline sections with a PLAN_CHANGE signal on a date-bearing line
    // (fired from our timeline extractor, not from extractPlanChange's shift-verb path),
    // use the timeline-specific title format so the update title is anchored to the
    // timeline bullet text rather than the generic "Update: project plan" fallback.
    if (
      isTimelineSection &&
      signal.signalType === 'PLAN_CHANGE' &&
      TIMELINE_DATE_TOKENS.test(signal.sentence) &&
      !SECURITY_LEXICAL_TOKENS.test(signal.sentence)
    ) {
      return candidateFromSignal(signal, section, titleForTimelineUpdate(signal.sentence));
    }
    return candidateFromSignal(signal, section);
  });
}
