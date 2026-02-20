import type { Signal } from "./types";

// External actors that indicate a feature demand is coming from outside the team.
// Includes "they/them" as a pronoun that typically refers to users/customers in PM notes.
const EXTERNAL_ACTORS = /\b(users?|customers?|cto|cs|sales|trial|prospect|they|them)\b/i;

// Desire verbs that signal a feature request or demand.
// Single-word verbs use word boundaries; multi-word phrases are matched as substrings.
// Excludes "ask"/"asks" (too generic) — only "asking for" and "requesting" qualify.
const DESIRE_VERB_WORDS = /\b(need|needs|require|requires|want|wants|requesting)\b/i;
const DESIRE_VERB_PHRASES = /\b(asking for|screaming for)\b/i;

// Amplifiers that boost confidence when present
const AMPLIFIERS = /\b(blocker|failing|expansion)\b/i;

/**
 * Extracts FEATURE_DEMAND signals from a list of sentences.
 *
 * Triggers when:
 * - Sentence contains an external actor (users, customer, CTO, etc.)
 * - AND contains a desire verb (need, require, want, etc.)
 *
 * Confidence: base 0.65, +0.1 if sentence contains an amplifier.
 */
export function extractFeatureDemand(sentences: string[]): Signal[] {
  const signals: Signal[] = [];

  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i];

    const hasDesireVerb = DESIRE_VERB_WORDS.test(sentence) || DESIRE_VERB_PHRASES.test(sentence);
    if (!EXTERNAL_ACTORS.test(sentence) || !hasDesireVerb) {
      continue;
    }

    const confidence = AMPLIFIERS.test(sentence) ? 0.75 : 0.65;

    signals.push({
      signalType: "FEATURE_DEMAND",
      label: "idea",
      proposedType: "idea",
      confidence,
      sentence,
      sentenceIndex: i,
    });
  }

  return signals;
}
