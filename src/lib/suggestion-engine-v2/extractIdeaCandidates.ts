/**
 * Semantic Idea Candidate Extraction
 *
 * Generates idea candidates from sections that contain strategy/mechanism/feature-style
 * language, WITHOUT requiring headings.  Headings, when present and non-generic, improve
 * the title of the emitted candidate but are never required to trigger extraction.
 *
 * Trigger conditions (section must match ≥ 2 distinct signal tokens):
 *   Strategy language:   strategy, approach, system, framework, prioritization,
 *                        scoring, automation
 *   Mechanism verbs:     introduce, use, extend, calculate, integrate, automate,
 *                        parse, upload, layer
 *   Feature constructs:  "photo upload", "AI parsing", "scoring model",
 *                        "prioritization system"
 *
 * A single weak token match is NOT sufficient to trigger extraction.
 *
 * Title selection:
 *   1. If section has a heading ≤ level 3 that is not generic → use heading text.
 *   2. Otherwise → derive a concise title from the best matching sentence.
 *
 * Validation:
 *   Candidates are returned WITHOUT bypassing validation or actionability thresholds.
 *   They participate in the normal grounding invariant check (Stage 4.6) and scoring.
 *   Type is always "idea"; metadata.source is "idea-semantic" for traceability.
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
import { computeSuggestionKey } from '../suggestion-keys';

// ============================================
// ID generation
// ============================================

let ideaSemanticCounter = 0;

function generateIdeaSemanticId(noteId: string): string {
  return `sug_idea_${noteId.slice(0, 8)}_${++ideaSemanticCounter}`;
}

export function resetIdeaSemanticCounter(): void {
  ideaSemanticCounter = 0;
}

// ============================================
// Signal token lists
// ============================================

/**
 * Strategy language tokens.  Each token is a whole-word match.
 */
const STRATEGY_TOKENS = [
  'strategy',
  'approach',
  'system',
  'framework',
  'prioritization',
  'scoring',
  'automation',
];

/**
 * Mechanism verbs.  Each token is a whole-word match.
 */
const MECHANISM_VERBS = [
  'introduce',
  'use',
  'extend',
  'calculate',
  'integrate',
  'automate',
  'parse',
  'upload',
  'layer',
];

/**
 * Feature-style multi-word constructs matched as substrings.
 */
const FEATURE_CONSTRUCTS = [
  'photo upload',
  'ai parsing',
  'scoring model',
  'prioritization system',
];

// ============================================
// Generic heading detection
// ============================================

/** Headings considered too generic to carry meaningful title information. */
const GENERIC_HEADING_WORDS = new Set([
  'general',
  'overview',
  'summary',
  'notes',
  'misc',
  'other',
  'details',
  'background',
  'context',
  'introduction',
  'appendix',
  'todo',
  'update',
  'updates',
  'status',
  'info',
]);

/**
 * Returns true when the heading text is so generic it adds no title value.
 */
function isGenericHeading(headingText: string): boolean {
  const lower = headingText.toLowerCase().trim();
  // Exact match against known generic words / short phrases
  if (GENERIC_HEADING_WORDS.has(lower)) return true;
  // Single very short headings (<= 6 chars) that aren't feature-specific
  if (lower.length <= 6 && !lower.includes(' ')) return true;
  return false;
}

// ============================================
// Signal scoring
// ============================================

interface SignalMatchResult {
  totalCount: number;
  strategyCount: number;
  mechanismCount: number;
  constructCount: number;
}

/**
 * Count how many distinct signal tokens match the text, broken down by category.
 * Multi-word feature constructs count as 2 in totalCount to reflect their specificity,
 * and increment constructCount by 1.
 */
function matchSignalTokens(text: string): SignalMatchResult {
  const lower = text.toLowerCase();
  let strategyCount = 0;
  let mechanismCount = 0;
  let constructCount = 0;

  for (const token of STRATEGY_TOKENS) {
    const re = new RegExp(`\\b${token}\\b`);
    if (re.test(lower)) strategyCount++;
  }

  for (const verb of MECHANISM_VERBS) {
    const re = new RegExp(`\\b${verb}\\b`);
    if (re.test(lower)) mechanismCount++;
  }

  for (const construct of FEATURE_CONSTRUCTS) {
    if (lower.includes(construct)) constructCount++;
  }

  const totalCount = strategyCount + mechanismCount + constructCount * 2;
  return { totalCount, strategyCount, mechanismCount, constructCount };
}

/**
 * Composite gate: requires both a strategy-level signal AND a mechanism-level signal.
 * Pure mechanism-only matches (e.g. "use" + "layer") do NOT pass.
 * Feature constructs satisfy both sides because they encode both strategy and mechanism.
 */
function passesCompositeGate(result: SignalMatchResult): boolean {
  if (result.totalCount < 2) return false;
  const hasStrategySignal = result.strategyCount >= 1 || result.constructCount >= 1;
  const hasMechanismSignal = result.mechanismCount >= 1 || result.constructCount >= 1;
  return hasStrategySignal && hasMechanismSignal;
}

/** Convenience wrapper used by bestEvidenceSentenceInText ranking. */
function countSignalTokens(text: string): number {
  return matchSignalTokens(text).totalCount;
}

// ============================================
// Paragraph splitting
// ============================================

/**
 * Split section raw_text into paragraph blocks (separated by blank lines).
 * Filters out blocks that are too short to be meaningful.
 */
function splitIntoParagraphs(rawText: string): string[] {
  return rawText
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length >= 20);
}

// ============================================
// Best evidence sentence selection
// ============================================

/**
 * Split a text block into sentences and return the one with the most signal tokens.
 * Falls back to the first non-empty sentence if no sentence scores above zero.
 */
function bestEvidenceSentenceInText(text: string): string {
  const sentences = text
    .split(/(?<=[.!?])\s+|\n/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 10);

  if (sentences.length === 0) return text.trim();

  let best = sentences[0];
  let bestCount = 0;

  for (const s of sentences) {
    const c = countSignalTokens(s);
    if (c > bestCount) {
      bestCount = c;
      best = s;
    }
  }

  return best;
}

/**
 * Return the best evidence sentence from the full section raw_text.
 */
function bestEvidenceSentence(section: ClassifiedSection): string {
  return bestEvidenceSentenceInText(section.raw_text);
}

// ============================================
// Title derivation
// ============================================

/**
 * Strip common noise prefixes from a content-derived title phrase.
 */
function stripTitleNoise(text: string): string {
  return text
    .replace(/^(we|i|they|it)\s+(should|will|need\s+to|plan\s+to|want\s+to|can)\s+/i, '')
    .replace(/^(use|using|introduce|introducing)\s+/i, '')
    .trim();
}

/**
 * Derive a concise semantic title from the best signal-bearing sentence.
 * Caps output at 60 characters.
 */
function deriveSemanticTitle(sentence: string): string {
  // Prefer a noun phrase after a mechanism verb
  const verbMatch = sentence.match(
    /\b(?:introduce|use|extend|calculate|integrate|automate|parse|upload|layer)\s+([^,.;!?\n]{5,60})/i
  );
  if (verbMatch) {
    const noun = stripTitleNoise(verbMatch[1].trim());
    if (noun.length >= 5) {
      const capped = noun.length > 60 ? noun.slice(0, noun.lastIndexOf(' ', 60)) || noun.slice(0, 60) : noun;
      return capitalizeFirst(capped);
    }
  }

  // Prefer a noun phrase after a strategy token
  const stratMatch = sentence.match(
    /\b(?:strategy|system|framework|approach|automation)\s+(?:for\s+|to\s+)?([^,.;!?\n]{5,60})/i
  );
  if (stratMatch) {
    const noun = stripTitleNoise(stratMatch[1].trim());
    if (noun.length >= 5) {
      const capped = noun.length > 60 ? noun.slice(0, noun.lastIndexOf(' ', 60)) || noun.slice(0, 60) : noun;
      return capitalizeFirst(capped);
    }
  }

  // Fallback: first clause of the sentence, capped at 60 chars
  const clause = sentence.split(/[,;]/)[0].trim();
  const stripped = stripTitleNoise(clause);
  const final = stripped.length > 60
    ? stripped.slice(0, stripped.lastIndexOf(' ', 60)) || stripped.slice(0, 60)
    : stripped;
  return capitalizeFirst(final);
}

function capitalizeFirst(text: string): string {
  if (!text) return text;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Select the best title for the candidate.
 *
 * Priority:
 *   1. Heading text — if heading exists, level ≤ 3, and not generic.
 *   2. Semantic title derived from best evidence sentence.
 */
function selectTitle(section: ClassifiedSection, evidenceSentence: string): string {
  if (
    section.heading_text &&
    (section.heading_level === undefined || section.heading_level <= 3) &&
    !isGenericHeading(section.heading_text)
  ) {
    return section.heading_text.trim();
  }
  return deriveSemanticTitle(evidenceSentence);
}

// ============================================
// Candidate creation
// ============================================

function candidateFromSection(
  section: ClassifiedSection,
  evidenceSentence: string,
  title: string,
  tokenCount: number
): Suggestion {
  // Confidence scales with token count: 2→0.65, 3→0.70, 4+→0.75
  const confidence = Math.min(0.75, 0.60 + tokenCount * 0.05);

  const type = 'idea' as const;

  const payload: SuggestionPayload = {
    draft_initiative: {
      title,
      description: evidenceSentence,
    },
  };

  const scores: SuggestionScores = {
    section_actionability: confidence,
    type_choice_confidence: confidence,
    synthesis_confidence: confidence,
    overall: confidence,
  };

  const routing: SuggestionRouting = { create_new: true };

  // Find line index for evidence sentence
  let spanStartLine = section.start_line;
  let spanEndLine = section.end_line;
  for (const line of section.body_lines) {
    if (line.text.includes(evidenceSentence) || evidenceSentence.includes(line.text.trim())) {
      spanStartLine = line.index;
      spanEndLine = line.index;
      break;
    }
  }

  const evidenceSpan: EvidenceSpan = {
    start_line: spanStartLine,
    end_line: spanEndLine,
    text: evidenceSentence,
  };

  const suggestionContext: SuggestionContext = {
    title,
    body: evidenceSentence,
    evidencePreview: [evidenceSentence],
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
    suggestion_id: generateIdeaSemanticId(section.note_id),
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
      source: 'idea-semantic',
      type,
      label: 'idea',
      confidence,
      explicitType: true,
    },
    suggestion: suggestionContext,
  };
}

// ============================================
// Public API
// ============================================

/**
 * Extract semantic idea candidates from a section.
 *
 * Strategy:
 *   A) Section has a meaningful non-generic heading → emit at most one candidate
 *      using the heading as the title (single-heading path).
 *   B) Section has no heading or a generic heading → split raw_text into
 *      blank-line-separated paragraphs and emit one candidate per paragraph
 *      that independently passes the ≥ 2 signal token threshold (multi-paragraph path).
 *
 * Returns an empty array when no paragraph has ≥ 2 signal token matches.
 * All returned candidates have:
 *   - type = "idea"
 *   - evidence grounded verbatim in section raw_text
 *   - metadata.source = "idea-semantic"
 */
export function extractIdeaCandidates(
  section: ClassifiedSection,
  coveredTexts?: Set<string>
): Suggestion[] {
  const results: Suggestion[] = [];

  const hasUsableHeading =
    section.heading_text &&
    (section.heading_level === undefined || section.heading_level <= 3) &&
    !isGenericHeading(section.heading_text);

  if (hasUsableHeading) {
    // Path A: section-level token count (heading + body)
    const fullText = ((section.heading_text || '') + ' ' + section.raw_text).trim();
    const matchResult = matchSignalTokens(fullText);
    if (!passesCompositeGate(matchResult)) return [];
    const tokenCount = matchResult.totalCount;

    const evidenceSentence = bestEvidenceSentence(section);
    if (coveredTexts && coveredTexts.has(evidenceSentence.trim())) return [];
    if (!section.raw_text.includes(evidenceSentence.trim())) return [];

    const title = section.heading_text!.trim();
    results.push(candidateFromSection(section, evidenceSentence, title, tokenCount));
  } else {
    // Path B: try to extract one candidate per paragraph
    const paragraphs = splitIntoParagraphs(section.raw_text);

    // Fall back to whole-section if no multi-paragraph structure detected
    const texts = paragraphs.length >= 2 ? paragraphs : [section.raw_text];

    for (const para of texts) {
      const paraMatch = matchSignalTokens(para);
      if (!passesCompositeGate(paraMatch)) continue;
      const tokenCount = paraMatch.totalCount;

      const evidenceSentence = bestEvidenceSentenceInText(para);
      const trimmed = evidenceSentence.trim();
      if (!trimmed) continue;
      if (coveredTexts && coveredTexts.has(trimmed)) continue;

      // Verify grounding: evidence must appear verbatim in raw_text
      if (!section.raw_text.includes(trimmed)) continue;

      const title = deriveSemanticTitle(evidenceSentence);
      results.push(candidateFromSection(section, evidenceSentence, title, tokenCount));

      // Add to covered to prevent duplicate evidence across paragraphs
      coveredTexts = coveredTexts ?? new Set<string>();
      coveredTexts.add(trimmed);
    }
  }

  return results;
}
