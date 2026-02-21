import type { Signal } from "./types";

// Bug indicators — observed failures currently happening
const BUG_TOKENS = /\b(failing|broken|latency|error|regression|crash|not behaving|doesn't work|does not work)\b/i;

// Conditional markers — if present, sentence describes a risk, NOT an observed bug
const CONDITIONAL_TOKENS = /\b(if|might|could|may|risk|concern)\b/i;

/**
 * Extracts BUG signals from a list of sentences.
 *
 * Triggers when sentence contains a bug indicator keyword AND is NOT conditional.
 * Conditional sentences (if/might/could/may/risk/concern) are risks, not bugs.
 *
 * Confidence: base 0.7.
 */
export function extractBug(sentences: string[]): Signal[] {
  const signals: Signal[] = [];

  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i];

    if (!BUG_TOKENS.test(sentence)) {
      continue;
    }

    // If sentence is conditional, it's a risk — skip bug classification
    if (CONDITIONAL_TOKENS.test(sentence)) {
      continue;
    }

    signals.push({
      signalType: "BUG",
      label: "bug",
      proposedType: "bug",
      confidence: 0.7,
      sentence,
      sentenceIndex: i,
    });
  }

  return signals;
}
