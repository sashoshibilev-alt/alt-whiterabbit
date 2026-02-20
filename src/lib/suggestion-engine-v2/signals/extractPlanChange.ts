import type { Signal } from "./types";

// Time or milestone references
const TIME_MILESTONE = /\b(date|q[1-4]|launch|release|v1)\b/i;

// Shift verbs indicating a plan change (base forms and gerunds)
const SHIFT_VERBS = /\b(push(?:ing|ed)?|delay(?:ing|ed)?|mov(?:e|ing|ed)|slip(?:ping|ped)?|pull(?:ing|ed)?)\b/i;

/**
 * Extracts PLAN_CHANGE signals from a list of sentences.
 *
 * Triggers when:
 * - Sentence references a time or milestone (date, Q1–Q4, launch, release, v1)
 * - AND contains a shift verb (push, delay, move, slip, pull)
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

    signals.push({
      signalType: "PLAN_CHANGE",
      label: "update",
      proposedType: "project_update",
      confidence: 0.75,
      sentence,
      sentenceIndex: i,
    });
  }

  return signals;
}
