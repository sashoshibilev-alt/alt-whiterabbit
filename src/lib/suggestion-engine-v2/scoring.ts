/**
 * Suggestion Engine v2 - Scoring
 *
 * Structure-based confidence scoring and threshold-based pruning.
 * Operates only on suggestions that have passed quality validators.
 * 
 * KEY INVARIANT (per suggestion-suppression-fix plan):
 * - project_update suggestions are NEVER dropped due to low scores
 * - Low scores downgrade to needs_clarification, never to silence
 * - Only idea suggestions may be dropped by thresholds
 */

import type {
  Suggestion,
  SuggestionScores,
  Section,
  ClassifiedSection,
  ThresholdConfig,
  GeneratorConfig,
  ClarificationReason,
} from './types';
import { isPlanChangeIntentLabel, isPlanChangeCandidate } from './classifiers';

// ============================================
// Score Computation
// ============================================

// ============================================
// Anchor Ranking Signals
// ============================================

/**
 * Engineering artifact keywords that boost ranking for concrete implementation work.
 * +0.15 boost to section_actionability.
 */
const ENGINEERING_ARTIFACT_PATTERN = /\b(cache|command|conversion|integration|connector|schema|metadata|rollback|precision|migration)\b/i;

/**
 * Direct implementation verbs that boost ranking for concrete build work.
 * +0.10 boost to section_actionability.
 */
const IMPLEMENTATION_VERB_PATTERN = /\b(force|add|build|create|implement|cache|convert)\b/i;

/**
 * Marketing/campaign keywords that apply a ranking penalty.
 * -0.15 penalty to section_actionability.
 * Applied to ranking only, NOT to actionability threshold.
 */
const MARKETING_CONDITIONAL_PATTERN = /\b(marketing blast|announcement|campaign|press)\b/i;

/**
 * Compute anchor ranking adjustment for a section's raw text.
 * Returns a delta (positive or negative) to add to the base actionability score.
 *
 * This does NOT affect the actionability gate — only the ranking score used
 * to select the top-N suggestions.
 */
function computeAnchorRankingDelta(anchorText: string): number {
  let delta = 0;

  if (ENGINEERING_ARTIFACT_PATTERN.test(anchorText)) {
    delta += 0.15;
  }

  if (IMPLEMENTATION_VERB_PATTERN.test(anchorText)) {
    delta += 0.10;
  }

  if (MARKETING_CONDITIONAL_PATTERN.test(anchorText)) {
    delta -= 0.15;
  }

  return delta;
}

/**
 * Compute section actionability score
 */
function computeSectionActionability(section: ClassifiedSection): number {
  const intent = section.intent;

  // Base score from intent classification
  const actionSignal = Math.max(intent.plan_change, intent.new_workstream);
  const outOfScopeSignal = Math.max(
    intent.communication,
    intent.research,
    intent.calendar,
    intent.micro_tasks
  );

  // Start with action signal
  let score = actionSignal;

  // Penalize for out-of-scope signals
  score -= outOfScopeSignal * 0.3;

  // Boost for structural features
  const sf = section.structural_features;

  // Quarter/milestone references indicate planning
  if (sf.has_quarter_refs || sf.has_version_refs) {
    score += 0.1;
  }

  // Launch keywords are strong signals
  if (sf.has_launch_keywords) {
    score += 0.15;
  }

  // Penalize very short sections
  if (sf.num_lines <= 2) {
    score -= 0.15;
  }

  return Math.max(0, Math.min(1, score));
}

/**
 * Compute type choice confidence
 */
function computeTypeChoiceConfidence(section: ClassifiedSection): number {
  const intent = section.intent;

  // Get probabilities for each type
  const pProjectUpdate = intent.plan_change;
  const pIdea = intent.new_workstream;

  // Margin between the two
  const margin = Math.abs(pProjectUpdate - pIdea);

  // Overall probability level
  const maxProb = Math.max(pProjectUpdate, pIdea);

  // Confidence is higher when:
  // 1. There's a clear winner (large margin)
  // 2. The winner has high probability

  // Start with margin-based confidence
  let confidence = 0.5 + margin * 0.5;

  // Penalize if both probabilities are low
  if (maxProb < 0.3) {
    confidence -= 0.2;
  }

  // Penalize near-ties
  if (margin < 0.1) {
    confidence -= 0.15;
  }

  // Boost for very clear signals
  if (maxProb > 0.7 && margin > 0.3) {
    confidence += 0.1;
  }

  return Math.max(0, Math.min(1, confidence));
}

/**
 * Compute synthesis confidence
 */
function computeSynthesisConfidence(
  suggestion: Suggestion,
  section: Section
): number {
  let confidence = 0.7; // Base confidence

  const sectionText = section.raw_text.toLowerCase();
  const suggestionText = (
    suggestion.title +
    ' ' +
    (suggestion.payload.after_description ||
      suggestion.payload.draft_initiative?.description ||
      '')
  ).toLowerCase();

  // Check overlap between section and suggestion
  const sectionWords = new Set(
    sectionText.split(/\s+/).filter((w) => w.length > 3)
  );
  const suggestionWords = suggestionText
    .split(/\s+/)
    .filter((w) => w.length > 3);

  let overlapCount = 0;
  for (const word of suggestionWords) {
    if (sectionWords.has(word)) {
      overlapCount++;
    }
  }

  const overlapRatio =
    suggestionWords.length > 0 ? overlapCount / suggestionWords.length : 0;

  // High overlap is good (grounded in source)
  if (overlapRatio > 0.5) {
    confidence += 0.15;
  } else if (overlapRatio < 0.2) {
    confidence -= 0.2; // Might be hallucinated
  }

  // Check for hallucinated details (owners, dates not in source)
  const hasOwnerInSuggestion = /\b(owner|lead|responsible)\s*:\s*\w+/i.test(
    suggestionText
  );
  const hasOwnerInSection = /\b(owner|lead|responsible)\s*:\s*\w+/i.test(
    sectionText
  );
  if (hasOwnerInSuggestion && !hasOwnerInSection) {
    confidence -= 0.1; // Potentially hallucinated owner
  }

  const hasDateInSuggestion = /\b(by|due|deadline)\s*:\s*\d+/i.test(
    suggestionText
  );
  const hasDateInSection = /\b(by|due|deadline)\s*:\s*\d+/i.test(sectionText);
  if (hasDateInSuggestion && !hasDateInSection) {
    confidence -= 0.1; // Potentially hallucinated date
  }

  // Check evidence coverage
  const evidenceText = suggestion.evidence_spans
    .map((s) => s.text)
    .join(' ')
    .toLowerCase();
  const evidenceWords = new Set(
    evidenceText.split(/\s+/).filter((w) => w.length > 3)
  );

  // Evidence should cover key parts of the suggestion
  let evidenceCoverage = 0;
  for (const word of suggestionWords) {
    if (evidenceWords.has(word)) {
      evidenceCoverage++;
    }
  }
  const evidenceCoverageRatio =
    suggestionWords.length > 0 ? evidenceCoverage / suggestionWords.length : 0;

  if (evidenceCoverageRatio < 0.2) {
    confidence -= 0.15; // Evidence doesn't support suggestion well
  }

  return Math.max(0, Math.min(1, confidence));
}

/**
 * Compute overall score (min of all dimensions)
 *
 * Special case for implicit ideas: when section_actionability is exactly 0.61
 * (the implicit idea signal), use a more lenient aggregation to avoid dropping
 * these valuable suggestions at the THRESHOLD stage.
 */
function computeOverallScore(scores: Omit<SuggestionScores, 'overall'>): number {
  // Detect implicit idea signal (0.61 is the specific boost from matchImplicitIdea)
  const isImplicitIdea = Math.abs(scores.section_actionability - 0.61) < 0.001;

  if (isImplicitIdea) {
    // For implicit ideas, use weighted average instead of min to be more lenient
    // This allows implicit ideas with strong synthesis/type scores to pass threshold
    const weights = {
      actionability: 0.5,  // Primary signal
      type: 0.25,
      synthesis: 0.25,
    };

    return (
      scores.section_actionability * weights.actionability +
      scores.type_choice_confidence * weights.type +
      scores.synthesis_confidence * weights.synthesis
    );
  }

  // Standard path: min of all dimensions (most conservative)
  return Math.min(
    scores.section_actionability,
    scores.type_choice_confidence,
    scores.synthesis_confidence
  );
}

// ============================================
// Score Refinement
// ============================================

/**
 * Refine scores for a suggestion based on section context
 */
export function refineSuggestionScores(
  suggestion: Suggestion,
  section: ClassifiedSection
): Suggestion {
  const sectionActionability = computeSectionActionability(section);
  const typeChoiceConfidence = computeTypeChoiceConfidence(section);
  const synthesisConfidence = computeSynthesisConfidence(suggestion, section);

  const scores: SuggestionScores = {
    section_actionability: sectionActionability,
    type_choice_confidence: typeChoiceConfidence,
    synthesis_confidence: synthesisConfidence,
    overall: 0, // Computed below
  };

  scores.overall = computeOverallScore(scores);

  return {
    ...suggestion,
    scores,
  };
}

// ============================================
// Plan Change Detection (per suggestion-suppression-fix plan)
// ============================================

/**
 * Check if a suggestion represents a plan change
 *
 * Plan change suggestions should NEVER be dropped due to low scores.
 * Per the plan: "any belief with intentLabel === 'plan_change' always produces at least one suggestion"
 */
export function isPlanChangeSuggestion(suggestion: Suggestion): boolean {
  // project_update type is the equivalent of plan_change intentLabel
  return suggestion.type === 'project_update';
}

/**
 * Check if suggestion has high confidence (both actionability and overall scores meet thresholds)
 * 
 * Per the plan: isHighConfidence = (actionabilityScore >= actionabilityThreshold && overallScore >= overallThreshold)
 */
export function isHighConfidence(
  suggestion: Suggestion,
  thresholds: ThresholdConfig
): boolean {
  const actionabilityPasses = suggestion.scores.section_actionability >= thresholds.T_section_min;
  const overallPasses = suggestion.scores.overall >= thresholds.T_overall_min;
  return actionabilityPasses && overallPasses;
}

/**
 * Compute clarification reasons for a low-confidence suggestion
 * 
 * Per the plan: clarification_reason must include deterministic messages for which thresholds failed
 */
export function computeClarificationReasons(
  suggestion: Suggestion,
  thresholds: ThresholdConfig
): ClarificationReason[] {
  const reasons: ClarificationReason[] = [];
  
  if (suggestion.scores.section_actionability < thresholds.T_section_min) {
    reasons.push('low_actionability_score');
  }
  
  if (suggestion.scores.overall < thresholds.T_overall_min) {
    reasons.push('low_overall_score');
  }
  
  return reasons;
}

// ============================================
// Thresholding & Pruning
// ============================================

/**
 * Check if a suggestion passes minimum thresholds
 * 
 * IMPORTANT: Per suggestion-suppression-fix plan, project_update suggestions
 * are NEVER dropped due to low scores. This function is only used for
 * idea suggestions now.
 */
export function passesThresholds(
  suggestion: Suggestion,
  thresholds: ThresholdConfig
): { passes: boolean; reason?: string } {
  // Check overall score
  if (suggestion.scores.overall < thresholds.T_overall_min) {
    return {
      passes: false,
      reason: `Overall score ${suggestion.scores.overall.toFixed(2)} < ${thresholds.T_overall_min}`,
    };
  }

  // Check section actionability
  if (suggestion.scores.section_actionability < thresholds.T_section_min) {
    return {
      passes: false,
      reason: `Section actionability ${suggestion.scores.section_actionability.toFixed(2)} < ${thresholds.T_section_min}`,
    };
  }

  return { passes: true };
}

/**
 * Apply confidence-based processing to suggestions
 *
 * Per the suggestion-suppression-fix plan:
 * - project_update suggestions are NEVER dropped at THRESHOLD stage
 * - Low confidence downgrades to needs_clarification with reasons (and optionally action: 'comment')
 * - idea suggestions may still be dropped by thresholds
 *
 * INVARIANT: If section.is_actionable === true, suggestion MUST NOT be dropped at THRESHOLD.
 * This ensures actionable sections always emit at least one suggestion.
 *
 * Decision matrix:
 * - Case A: non-plan_change (idea) → may be dropped if below threshold
 * - Case B: plan_change (project_update) + high confidence → emit as-is
 * - Case C: plan_change (project_update) + low confidence → emit with needs_clarification=true and action='comment'
 * - Case D: actionable section (is_actionable=true) → bypass THRESHOLD, downgrade if low confidence
 */
export function applyConfidenceBasedProcessing(
  suggestions: Suggestion[],
  thresholds: ThresholdConfig,
  sections?: Map<string, ClassifiedSection>
): {
  passed: Suggestion[];
  dropped: Array<{ suggestion: Suggestion; reason: string }>;
  downgraded: number;
} {
  const passed: Suggestion[] = [];
  const dropped: Array<{ suggestion: Suggestion; reason: string }> = [];
  let downgraded = 0;

  for (const suggestion of suggestions) {
    const isPlanChange = isPlanChangeSuggestion(suggestion);
    const highConf = isHighConfidence(suggestion, thresholds);

    // Check if source section is actionable (INVARIANT enforcement)
    const section = sections?.get(suggestion.section_id);
    const isActionableSection = section?.is_actionable ?? false;

    if (isPlanChange || isActionableSection) {
      // Case B, C & D: plan_change OR actionable sections are NEVER dropped at THRESHOLD
      const processedSuggestion: Suggestion = {
        ...suggestion,
        is_high_confidence: highConf,
      };

      if (!highConf) {
        // Case C & D: Low confidence → downgrade to clarification with action='comment'
        // Per the plan: "downgrade to action: 'comment' + needs_clarification: true"
        processedSuggestion.needs_clarification = true;
        processedSuggestion.clarification_reasons = computeClarificationReasons(suggestion, thresholds);

        // Add legacy v0 action field for compatibility (if needed by downstream consumers)
        // Note: This is a metadata field, not part of the core suggestion type in v2
        if (processedSuggestion.payload) {
          (processedSuggestion as any).action = 'comment';
        }

        downgraded++;
      } else {
        // Case B: High confidence → no clarification needed
        processedSuggestion.needs_clarification = false;
        processedSuggestion.clarification_reasons = [];
      }

      passed.push(processedSuggestion);
    } else {
      // Case A: Non-plan-change (idea) suggestions may be dropped
      const result = passesThresholds(suggestion, thresholds);
      if (result.passes) {
        passed.push({
          ...suggestion,
          is_high_confidence: true,
          needs_clarification: false,
          clarification_reasons: [],
        });
      } else {
        dropped.push({ suggestion, reason: result.reason || 'Below threshold' });
      }
    }
  }

  return { passed, dropped, downgraded };
}

/**
 * Filter suggestions by thresholds
 * 
 * @deprecated Use applyConfidenceBasedProcessing instead for proper plan_change handling
 */
export function filterByThresholds(
  suggestions: Suggestion[],
  thresholds: ThresholdConfig
): { passed: Suggestion[]; dropped: Array<{ suggestion: Suggestion; reason: string }> } {
  // Use the new confidence-based processing which respects plan_change invariants
  const result = applyConfidenceBasedProcessing(suggestions, thresholds);
  return { passed: result.passed, dropped: result.dropped };
}

/**
 * Sort suggestions by overall score (descending)
 */
export function sortByScore(suggestions: Suggestion[]): Suggestion[] {
  return [...suggestions].sort((a, b) => b.scores.overall - a.scores.overall);
}

/**
 * Cap suggestions to maximum allowed
 */
export function capSuggestions(
  suggestions: Suggestion[],
  maxSuggestions: number
): Suggestion[] {
  return suggestions.slice(0, maxSuggestions);
}

// ============================================
// Full Scoring Pipeline
// ============================================

/**
 * Compute ranking score for a suggestion.
 * Applies anchor ranking delta on top of the base overall score.
 * Used for stable output ordering (and by presentation.ts for display bucketing).
 *
 * NOTE: This does NOT affect actionability gating — only candidate ordering.
 */
export function rankingScore(s: Suggestion): number {
  const anchorText = s.evidence_spans[0]?.text ?? s.suggestion?.evidencePreview?.[0] ?? '';
  return s.scores.overall + computeAnchorRankingDelta(anchorText);
}

/**
 * Run full scoring and pruning pipeline
 *
 * Engine is uncapped: returns ALL suggestions that pass validators → scoring → dedupe.
 * UI uses the presentation helper (presentation.ts) to cap display at defaultCapPerType.
 *
 * Per suggestion-suppression-fix plan:
 * - project_update suggestions are NEVER dropped due to low scores
 * - Low confidence downgrades to needs_clarification
 * - idea suggestions may be dropped by thresholds
 *
 * NORMALIZATION: Ensures suggestion.type matches section intent label.
 * If a plan_change section was mis-typed as idea, we normalize
 * it to project_update to ensure proper THRESHOLD handling.
 */
export function runScoringPipeline(
  suggestions: Suggestion[],
  sections: Map<string, ClassifiedSection>,
  config: GeneratorConfig
): {
  suggestions: Suggestion[];
  dropped: Array<{ suggestion: Suggestion; reason: string }>;
  downgraded_to_clarification?: number;
} {
  // 1) Normalize types based on section intent label
  const normalized: Suggestion[] = suggestions.map((s) => {
    const section = sections.get(s.section_id);
    if (!section) return s;

    // IMPORTANT: If suggestion explicitly sets a type (e.g., B-lite explicit ask path),
    // that type MUST be authoritative. Only apply section-level type normalization
    // if the suggestion doesn't have an explicit type indicator.
    const hasExplicitType = s.structural_hint === 'explicit_ask' ||
                           (s.structural_hint && s.structural_hint !== section.typeLabel);

    if (hasExplicitType) {
      // Respect the explicitly set type - do not override
      return s;
    }

    const isPlanChangeSection = isPlanChangeIntentLabel(section.intent);

    if (isPlanChangeSection && s.type !== 'project_update') {
      // Force plan_change semantics by type
      return { ...s, type: 'project_update' as const };
    }

    // Candidate-level plan_change override: if this candidate's own anchor text
    // triggers isPlanChangeCandidate (conditional "if" + removal verb or GTM artifact),
    // force this candidate to project_update regardless of section-level intent.
    // Uses the candidate's evidence_spans[0].text (the anchor line) so that only the
    // candidate whose anchor is the marketing conditional is affected — not every
    // candidate in the same section.
    // This does NOT propagate back to the section typeLabel.
    if (s.type !== 'project_update') {
      const anchorText = s.evidence_spans[0]?.text ?? s.suggestion?.evidencePreview?.[0] ?? '';
      if (anchorText && isPlanChangeCandidate(anchorText)) {
        return { ...s, type: 'project_update' as const };
      }
    }

    return s;
  });

  // 2) Refine scores for each suggestion
  const scored = normalized.map((suggestion) => {
    const section = sections.get(suggestion.section_id);
    if (!section) {
      return suggestion; // Keep original scores if section not found
    }
    return refineSuggestionScores(suggestion, section);
  });

  // 3) Apply confidence-based processing (respects plan_change + actionable invariants)
  const { passed, dropped, downgraded } = applyConfidenceBasedProcessing(scored, config.thresholds, sections);

  // 4) Sort by ranking score: project_update suggestions first, then ideas.
  //    computeAnchorRankingDelta is applied here (not in computeSectionActionability)
  //    so it influences candidate ordering but never affects actionability gating.
  function sortByRankingScore(arr: Suggestion[]): Suggestion[] {
    return [...arr].sort((a, b) => rankingScore(b) - rankingScore(a));
  }

  const projectUpdates = passed.filter(s => s.type === 'project_update');
  const ideas = passed.filter(s => s.type !== 'project_update');

  // 5) Return ALL passing suggestions (engine uncapped; UI uses presentation helper to cap display).
  //    Output ordering: project_update first (sorted by ranking score), then ideas (sorted by ranking score).
  const allPassed = [
    ...sortByRankingScore(projectUpdates),
    ...sortByRankingScore(ideas),
  ];

  return {
    suggestions: allPassed,
    dropped,
    downgraded_to_clarification: downgraded,
  };
}
