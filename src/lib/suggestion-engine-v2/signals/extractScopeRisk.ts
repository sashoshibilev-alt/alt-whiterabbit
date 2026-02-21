import type { Signal } from "./types";

// Strong actionable conditional phrases that indicate a risk requiring action
// (e.g., "if we don't fix X" → implies action is needed)
const ACTIONABLE_CONDITIONAL_PHRASES = /\b(if we don't|if we do not|might need to be|could require|may force|might be pulled|could block)\b/i;

// Conditional tokens that introduce a risk clause (classic "if/unless" form)
const CONDITIONAL_TOKENS = /\b(if|unless)\b/i;

// Consequence references that indicate scope/release impact
const CONSEQUENCE_REFS = /\b(release|launch|rollout|scope|mobile app|pulled|app store)\b/i;

// Subjective concern prefixes — indicate observation/worry, NOT actionable risk
// e.g., "Some concern that...", "Risk that...", "Worried that..."
const SUBJECTIVE_CONCERN_PREFIX = /^(some\s+)?(concern|risk|worry|worried|fear)\s+that\b/i;

/**
 * Extracts SCOPE_RISK signals from a list of sentences.
 *
 * Two trigger paths:
 * - Path A: strong actionable conditional phrase ("if we don't", "might need to be", etc.)
 * - Path B: conditional token (if/unless) + concrete consequence reference (release/launch/etc.)
 *
 * Sentences starting with subjective concern prefixes ("concern that...", "risk that...")
 * are suppressed — they describe observations, not actionable risks.
 *
 * This rule must fire BEFORE bug classification: conditional sentences are risks, not bugs.
 *
 * Confidence: base 0.7.
 */
export function extractScopeRisk(sentences: string[]): Signal[] {
  const signals: Signal[] = [];

  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i];

    // Subjective concern/worry observations are NOT actionable risks
    if (SUBJECTIVE_CONCERN_PREFIX.test(sentence.trim())) {
      continue;
    }

    // Path A: strong actionable conditional phrase (sufficient on its own)
    if (ACTIONABLE_CONDITIONAL_PHRASES.test(sentence)) {
      signals.push({
        signalType: "SCOPE_RISK",
        label: "risk",
        proposedType: "risk",
        confidence: 0.7,
        sentence,
        sentenceIndex: i,
      });
      continue;
    }

    // Path B: conditional token + concrete consequence reference
    if (CONDITIONAL_TOKENS.test(sentence) && CONSEQUENCE_REFS.test(sentence)) {
      signals.push({
        signalType: "SCOPE_RISK",
        label: "risk",
        proposedType: "risk",
        confidence: 0.7,
        sentence,
        sentenceIndex: i,
      });
    }
  }

  return signals;
}
