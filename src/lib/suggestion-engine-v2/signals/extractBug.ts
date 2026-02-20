import type { Signal } from "./types";

// Bug indicators
const BUG_TOKENS = /\b(failing|broken|latency|error|regression|not behaving)\b/i;

/**
 * Extracts BUG signals from a list of sentences.
 *
 * Triggers when sentence contains a bug indicator keyword.
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

    signals.push({
      signalType: "BUG",
      label: "bug",
      proposedType: "idea",
      confidence: 0.7,
      sentence,
      sentenceIndex: i,
    });
  }

  return signals;
}
