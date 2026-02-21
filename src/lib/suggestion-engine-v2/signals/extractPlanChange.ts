import type { Signal } from "./types";

// Time or milestone references.
// Extended to cover hyphenated numeric duration patterns like "4-week", "2-month", "30-day"
// which are common in schedule-impact sentences ("We're looking at a 4-week delay").
// Intentionally NOT matching bare "N weeks / N days" (space-separated) to avoid
// false positives in summary/recap sections like "slip by 2 weeks".
const TIME_MILESTONE = /\b(date|q[1-4]|launch|release|v1|\d+-week|\d+-day|\d+-month)\b/i;

// Shift verbs indicating a plan change (base forms and gerunds)
const SHIFT_VERBS = /\b(push(?:ing|ed)?|delay(?:ing|ed)?|mov(?:e|ing|ed)|slip(?:ping|ped)?|pull(?:ing|ed)?)\b/i;

// Conditional markers: if present, sentence describes a risk, not a plan change
const CONDITIONAL_TOKENS = /\b(if|unless|might|could|may)\b/i;

/**
 * Extracts PLAN_CHANGE signals from a list of sentences.
 *
 * Triggers when:
 * - Sentence references a time or milestone (date, Q1–Q4, launch, release, v1)
 * - AND contains a shift verb (push, delay, move, slip, pull)
 * - AND is NOT conditional (if/unless/might/could/may)
 *
 * Conditional sentences ("might be pulled from the release") are SCOPE_RISK, not PLAN_CHANGE.
 *
 * Confidence: base 0.75.
 */
export function extractPlanChange(sentences: string[]): Signal[] {
  const signals: Signal[] = [];

  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i];

    if (!TIME_MILESTONE.test(sentence) || !SHIFT_VERBS.test(sentence)) {
      continue;
    }

    // Conditional sentences are risks, not plan changes
    if (CONDITIONAL_TOKENS.test(sentence)) {
      continue;
    }

    signals.push({
      signalType: "PLAN_CHANGE",
      label: "project_update",
      proposedType: "project_update",
      confidence: 0.75,
      sentence,
      sentenceIndex: i,
    });
  }

  return signals;
}
