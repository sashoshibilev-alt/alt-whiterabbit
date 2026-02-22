import type { Signal } from "./types";

// Strong actionable conditional phrases that indicate a risk requiring action
// (e.g., "if we don't fix X" → implies action is needed)
// Extended to cover "if we can't / cannot" — common in compliance-risk sentences
// like "if we can't prove GDPR compliance, the partnership is dead in the water".
const ACTIONABLE_CONDITIONAL_PHRASES = /\b(if we don't|if we do not|if we can't|if we cannot|might need to be|could require|may force|might be pulled|could block)\b/i;

// Conditional tokens that introduce a risk clause (classic "if/unless" form)
const CONDITIONAL_TOKENS = /\b(if|unless)\b/i;

// Consequence references that indicate scope/release/compliance impact.
// Extended to include compliance and partnership stakes — these are common
// in vendor/integration risk sentences ("dead in the water", "partnership").
const CONSEQUENCE_REFS = /\b(release|launch|rollout|scope|mobile app|pulled|app store|compliance|gdpr|partnership|dead\s+in\s+the\s+water|data\s+residency)\b/i;

// Subjective concern prefixes — indicate observation/worry, NOT actionable risk
// e.g., "Some concern that...", "Risk that...", "Worried that...",
//       "Some internal concern that..." (optional adjective between "some" and the word).
// The broad form (some ... <word> that) allows intervening words up to 20 chars.
const SUBJECTIVE_CONCERN_PREFIX = /^(some\s+(\w+\s+)?)?(concern|risk|worry|worried|fear)\s+that\b/i;

// Lexical risk tokens — explicit domain vocabulary that signals a risk topic.
// At least one must appear in the sentence for Path C to fire.
// These are: risk, concern, PII, GDPR, compliance, security, vulnerability,
// exposure, blocker (exact word-boundary match, case-insensitive).
const LEXICAL_RISK_TOKENS = /\b(risk|concern|pii|gdpr|compliance|security|vulnerability|exposure|blocker)\b/i;

// High-confidence PII+logging pair: PII in combination with "logging" or "user IDs"
// triggers an elevated-confidence (0.85) risk signal.
const PII_TOKEN = /\bpii\b/i;
const PII_PAIRING_TOKENS = /\b(logging|user\s+ids?)\b/i;

// Path C suppression: if the sentence is clearly describing a schedule slip/delay
// (shift verb + time unit — even bare "N sprints/weeks/days"), treat it as a
// plan change, not a risk, to avoid tagging "security review requirements" in a
// slip sentence as a risk candidate.
const PLAN_CHANGE_SHIFT_VERBS = /\b(push(?:ing|ed)?|delay(?:ing|ed)?|mov(?:e|ing|ed)|slip(?:ping|ped)?|pull(?:ing|ed)?)\b/i;
const PLAN_CHANGE_TIME_UNITS = /\b\d+[\s-]?(sprint|week|day|month)s?\b/i;

// Path C suppression: explicit feature-request language.
// Sentences that are primarily feature asks ("request to add", "users need better",
// "we need to implement") are idea candidates, not risks — even if they mention
// a lexical risk token like "compliance" for context (e.g., "for compliance tracking").
// Pattern: request/need/want/ask + verb/noun phrase.
const EXPLICIT_FEATURE_ASK = /\b(request(?:s|ed|ing)?\s+to|need\s+to\s+\w|needs?\s+to\s+(add|build|create|implement|improve|update)|users?\s+need\s+(better|to)|asks?\s+for|would\s+like\s+to)\b/i;

/**
 * Extracts SCOPE_RISK signals from a list of sentences.
 *
 * Three trigger paths:
 * - Path A: strong actionable conditional phrase ("if we don't", "might need to be", etc.)
 * - Path B: conditional token (if/unless) + concrete consequence reference (release/launch/etc.)
 * - Path C: lexical risk token present (risk, concern, PII, GDPR, compliance, security,
 *   vulnerability, exposure, blocker). High-confidence (0.85) when PII + logging/user IDs.
 *
 * Sentences starting with subjective concern prefixes ("concern that...", "risk that...")
 * are suppressed — they describe observations, not actionable risks.
 *
 * This rule must fire BEFORE bug classification: conditional sentences are risks, not bugs.
 *
 * Confidence: base 0.7; PII+logging pair: 0.85.
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
      continue;
    }

    // Path C: lexical risk token present — semantic first, structure-assist.
    // Evidence must contain at least one of the domain risk tokens.
    // High-confidence (0.85) when PII + logging/user IDs co-occur.
    //
    // Guards (skip Path C when):
    // 1. Sentence is clearly a plan-change (shift verb + time unit) — the risk token
    //    appears in a delay-cause role (e.g., "slip due to security review requirements").
    // 2. Sentence is a feature request ("request to add X for compliance") — the risk
    //    token is contextual, not the primary topic.
    if (LEXICAL_RISK_TOKENS.test(sentence) &&
        !(PLAN_CHANGE_SHIFT_VERBS.test(sentence) && PLAN_CHANGE_TIME_UNITS.test(sentence)) &&
        !EXPLICIT_FEATURE_ASK.test(sentence)) {
      const confidence =
        PII_TOKEN.test(sentence) && PII_PAIRING_TOKENS.test(sentence) ? 0.85 : 0.7;
      signals.push({
        signalType: "SCOPE_RISK",
        label: "risk",
        proposedType: "risk",
        confidence,
        sentence,
        sentenceIndex: i,
      });
    }
  }

  return signals;
}
