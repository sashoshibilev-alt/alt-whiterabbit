import type { Signal } from "./types";

// Conditional tokens that introduce a risk clause
const CONDITIONAL_TOKENS = /\b(if|unless)\b/i;

// Consequence references that indicate scope/release impact
const CONSEQUENCE_REFS = /\b(release|launch|rollout|scope)\b/i;

/**
 * Extracts SCOPE_RISK signals from a list of sentences.
 *
 * Triggers when:
 * - Sentence contains a conditional token (if, unless)
 * - AND consequence references a release or scope artifact
 *
 * Confidence: base 0.7.
 */
export function extractScopeRisk(sentences: string[]): Signal[] {
  const signals: Signal[] = [];

  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i];

    if (!CONDITIONAL_TOKENS.test(sentence) || !CONSEQUENCE_REFS.test(sentence)) {
      continue;
    }

    signals.push({
      signalType: "SCOPE_RISK",
      label: "risk",
      proposedType: "project_update",
      confidence: 0.7,
      sentence,
      sentenceIndex: i,
    });
  }

  return signals;
}
