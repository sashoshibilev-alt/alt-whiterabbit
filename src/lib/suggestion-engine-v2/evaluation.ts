/**
 * Suggestion Engine v2 - Evaluation
 *
 * Offline evaluation harness for analyzing validator drops,
 * suggestion counts, routing decisions, and tuning thresholds.
 */

import type {
  NoteInput,
  InitiativeSnapshot,
  GeneratorConfig,
  GeneratorResult,
  GeneratorDebugInfo,
  Suggestion,
  ThresholdConfig,
} from './types';
import { generateSuggestions } from './index';

// ============================================
// Evaluation Types
// ============================================

/**
 * Single note evaluation result
 */
export interface NoteEvaluation {
  note_id: string;
  raw_length: number;
  sections_count: number;
  actionable_sections: number;
  suggestions_generated: number;
  suggestions_after_validation: number;
  suggestions_final: number;
  v2_drops: number;
  v3_drops: number;
  score_drops: number;
  routing_attached: number;
  routing_create_new: number;
  avg_overall_score: number;
  suggestions: Suggestion[];
}

/**
 * Aggregate evaluation metrics
 */
export interface EvaluationMetrics {
  total_notes: number;
  total_sections: number;
  total_actionable_sections: number;
  total_suggestions_before_validation: number;
  total_v2_drops: number;
  total_v3_drops: number;
  total_score_drops: number;
  total_suggestions_final: number;
  avg_suggestions_per_note: number;
  notes_with_zero_suggestions: number;
  notes_with_zero_suggestions_pct: number;
  total_routing_attached: number;
  total_routing_create_new: number;
  attach_ratio: number;
  avg_overall_score: number;
  validator_drop_reasons: Record<string, number>;
}

/**
 * Threshold sensitivity analysis result
 */
export interface ThresholdSensitivity {
  threshold_name: keyof ThresholdConfig;
  values: number[];
  suggestions_counts: number[];
  recommendation?: string;
}

// ============================================
// Single Note Evaluation
// ============================================

/**
 * Evaluate a single note
 */
export function evaluateNote(
  note: NoteInput,
  initiatives: InitiativeSnapshot[],
  config: GeneratorConfig
): NoteEvaluation {
  // Enable debug to get detailed info
  const debugConfig: GeneratorConfig = {
    ...config,
    enable_debug: true,
  };

  const result = generateSuggestions(note, { initiatives }, debugConfig);
  const debug = result.debug!;

  const avgScore =
    result.suggestions.length > 0
      ? result.suggestions.reduce((sum, s) => sum + s.scores.overall, 0) /
        result.suggestions.length
      : 0;

  const attached = result.suggestions.filter(
    (s) => s.routing.attached_initiative_id && !s.routing.create_new
  ).length;
  const createNew = result.suggestions.filter((s) => s.routing.create_new).length;

  return {
    note_id: note.note_id,
    raw_length: note.raw_markdown.length,
    sections_count: debug.sections_count,
    actionable_sections: debug.actionable_sections_count,
    suggestions_generated: debug.suggestions_before_validation,
    suggestions_after_validation: debug.suggestions_after_validation,
    suggestions_final: result.suggestions.length,
    v2_drops: debug.v2_drops,
    v3_drops: debug.v3_drops,
    score_drops: debug.suggestions_after_validation - debug.suggestions_after_scoring,
    routing_attached: attached,
    routing_create_new: createNew,
    avg_overall_score: avgScore,
    suggestions: result.suggestions,
  };
}

// ============================================
// Batch Evaluation
// ============================================

/**
 * Evaluate multiple notes and compute aggregate metrics
 */
export function evaluateBatch(
  notes: NoteInput[],
  initiatives: InitiativeSnapshot[],
  config: GeneratorConfig
): {
  evaluations: NoteEvaluation[];
  metrics: EvaluationMetrics;
} {
  const evaluations: NoteEvaluation[] = [];
  const validatorDropReasons: Record<string, number> = {};

  for (const note of notes) {
    const evaluation = evaluateNote(note, initiatives, config);
    evaluations.push(evaluation);
  }

  // Aggregate metrics
  const totalSuggestionsFinal = evaluations.reduce(
    (sum, e) => sum + e.suggestions_final,
    0
  );
  const totalAttached = evaluations.reduce(
    (sum, e) => sum + e.routing_attached,
    0
  );
  const totalCreateNew = evaluations.reduce(
    (sum, e) => sum + e.routing_create_new,
    0
  );

  const notesWithZero = evaluations.filter(
    (e) => e.suggestions_final === 0
  ).length;

  const allScores = evaluations.flatMap((e) =>
    e.suggestions.map((s) => s.scores.overall)
  );
  const avgScore =
    allScores.length > 0
      ? allScores.reduce((sum, s) => sum + s, 0) / allScores.length
      : 0;

  // Collect drop reasons from debug info
  for (const evaluation of evaluations) {
    // Note: In a full implementation, we'd track specific drop reasons
    // For now, we aggregate by validator type
    if (evaluation.v2_drops > 0) {
      validatorDropReasons['V2_anti_vacuity'] =
        (validatorDropReasons['V2_anti_vacuity'] || 0) + evaluation.v2_drops;
    }
    if (evaluation.v3_drops > 0) {
      validatorDropReasons['V3_evidence_sanity'] =
        (validatorDropReasons['V3_evidence_sanity'] || 0) + evaluation.v3_drops;
    }
  }

  const metrics: EvaluationMetrics = {
    total_notes: notes.length,
    total_sections: evaluations.reduce((sum, e) => sum + e.sections_count, 0),
    total_actionable_sections: evaluations.reduce(
      (sum, e) => sum + e.actionable_sections,
      0
    ),
    total_suggestions_before_validation: evaluations.reduce(
      (sum, e) => sum + e.suggestions_generated,
      0
    ),
    total_v2_drops: evaluations.reduce((sum, e) => sum + e.v2_drops, 0),
    total_v3_drops: evaluations.reduce((sum, e) => sum + e.v3_drops, 0),
    total_score_drops: evaluations.reduce((sum, e) => sum + e.score_drops, 0),
    total_suggestions_final: totalSuggestionsFinal,
    avg_suggestions_per_note: notes.length > 0 ? totalSuggestionsFinal / notes.length : 0,
    notes_with_zero_suggestions: notesWithZero,
    notes_with_zero_suggestions_pct:
      notes.length > 0 ? (notesWithZero / notes.length) * 100 : 0,
    total_routing_attached: totalAttached,
    total_routing_create_new: totalCreateNew,
    attach_ratio:
      totalSuggestionsFinal > 0 ? totalAttached / totalSuggestionsFinal : 0,
    avg_overall_score: avgScore,
    validator_drop_reasons: validatorDropReasons,
  };

  return { evaluations, metrics };
}

// ============================================
// Threshold Sensitivity Analysis
// ============================================

/**
 * Analyze sensitivity to a specific threshold
 */
export function analyzeThresholdSensitivity(
  notes: NoteInput[],
  initiatives: InitiativeSnapshot[],
  baseConfig: GeneratorConfig,
  thresholdName: keyof ThresholdConfig,
  values: number[]
): ThresholdSensitivity {
  const suggestionCounts: number[] = [];

  for (const value of values) {
    const testConfig: GeneratorConfig = {
      ...baseConfig,
      thresholds: {
        ...baseConfig.thresholds,
        [thresholdName]: value,
      },
    };

    const { metrics } = evaluateBatch(notes, initiatives, testConfig);
    suggestionCounts.push(metrics.total_suggestions_final);
  }

  // Generate recommendation
  let recommendation: string | undefined;

  // Find "elbow" point where suggestions drop significantly
  for (let i = 1; i < suggestionCounts.length; i++) {
    const dropRatio =
      suggestionCounts[i - 1] > 0
        ? (suggestionCounts[i - 1] - suggestionCounts[i]) / suggestionCounts[i - 1]
        : 0;

    if (dropRatio > 0.3) {
      recommendation = `Consider setting ${thresholdName} around ${values[i]} (significant drop at this point)`;
      break;
    }
  }

  return {
    threshold_name: thresholdName,
    values,
    suggestions_counts: suggestionCounts,
    recommendation,
  };
}

// ============================================
// Report Generation
// ============================================

/**
 * Generate a human-readable evaluation report
 */
export function generateReport(metrics: EvaluationMetrics): string {
  const lines: string[] = [
    '=== Suggestion Engine v2 Evaluation Report ===',
    '',
    '## Overview',
    `- Total notes evaluated: ${metrics.total_notes}`,
    `- Total sections detected: ${metrics.total_sections}`,
    `- Actionable sections: ${metrics.total_actionable_sections}`,
    '',
    '## Pipeline Metrics',
    `- Suggestions before validation: ${metrics.total_suggestions_before_validation}`,
    `- V2 (anti-vacuity) drops: ${metrics.total_v2_drops}`,
    `- V3 (evidence-sanity) drops: ${metrics.total_v3_drops}`,
    `- Score threshold drops: ${metrics.total_score_drops}`,
    `- Final suggestions: ${metrics.total_suggestions_final}`,
    '',
    '## Output Quality',
    `- Average suggestions per note: ${metrics.avg_suggestions_per_note.toFixed(2)}`,
    `- Notes with zero suggestions: ${metrics.notes_with_zero_suggestions} (${metrics.notes_with_zero_suggestions_pct.toFixed(1)}%)`,
    `- Average overall score: ${metrics.avg_overall_score.toFixed(3)}`,
    '',
    '## Routing',
    `- Suggestions attached to initiatives: ${metrics.total_routing_attached}`,
    `- Suggestions marked create_new: ${metrics.total_routing_create_new}`,
    `- Attach ratio: ${(metrics.attach_ratio * 100).toFixed(1)}%`,
    '',
    '## Validator Drop Breakdown',
  ];

  for (const [validator, count] of Object.entries(metrics.validator_drop_reasons)) {
    lines.push(`- ${validator}: ${count}`);
  }

  lines.push('');
  lines.push('=== End Report ===');

  return lines.join('\n');
}

// ============================================
// Quick Evaluation Utilities
// ============================================

/**
 * Quick evaluation of a single note (for debugging)
 */
export function quickEvaluate(
  rawMarkdown: string,
  config?: Partial<GeneratorConfig>
): {
  suggestions: Suggestion[];
  debug: GeneratorDebugInfo;
  report: string;
} {
  const note: NoteInput = {
    note_id: 'quick_eval_' + Date.now().toString(36),
    raw_markdown: rawMarkdown,
  };

  const defaultConfig: GeneratorConfig = {
    thresholds: {
      T_action: 0.5,
      T_out_of_scope: 0.4,
      T_overall_min: 0.65,
      T_section_min: 0.6,
      T_generic: 0.55,
      T_attach: 0.8,
      MIN_EVIDENCE_CHARS: 120,
    },
    max_suggestions: 5,
    enable_debug: true,
    use_llm_classifiers: false,
    embedding_enabled: false,
    ...config,
  };

  const result = generateSuggestions(note, {}, defaultConfig);

  const report = [
    `Sections: ${result.debug?.sections_count}`,
    `Actionable: ${result.debug?.actionable_sections_count}`,
    `Before validation: ${result.debug?.suggestions_before_validation}`,
    `V2 drops: ${result.debug?.v2_drops}`,
    `V3 drops: ${result.debug?.v3_drops}`,
    `Final: ${result.suggestions.length}`,
    '',
    'Suggestions:',
    ...result.suggestions.map(
      (s, i) =>
        `  ${i + 1}. [${s.type}] ${s.title} (score: ${s.scores.overall.toFixed(2)})`
    ),
  ].join('\n');

  return {
    suggestions: result.suggestions,
    debug: result.debug!,
    report,
  };
}
