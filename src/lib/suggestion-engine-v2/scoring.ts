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
import { isPlanChangeIntentLabel } from './classifiers';

// ============================================
// Score Computation
// ============================================

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
 */
function computeOverallScore(scores: Omit<SuggestionScores, 'overall'>): number {
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
 * Decision matrix:
 * - Case A: non-plan_change (idea) → may be dropped if below threshold
 * - Case B: plan_change (project_update) + high confidence → emit as-is
 * - Case C: plan_change (project_update) + low confidence → emit with needs_clarification=true and action='comment'
 */
export function applyConfidenceBasedProcessing(
  suggestions: Suggestion[],
  thresholds: ThresholdConfig
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
    
    if (isPlanChange) {
      // Case B & C: plan_change suggestions are NEVER dropped at THRESHOLD
      const processedSuggestion: Suggestion = {
        ...suggestion,
        is_high_confidence: highConf,
      };
      
      if (!highConf) {
        // Case C: Low confidence → downgrade to clarification with action='comment'
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
 * Run full scoring and pruning pipeline
 * 
 * Per suggestion-suppression-fix plan:
 * - project_update suggestions are NEVER dropped due to low scores
 * - Low confidence downgrades to needs_clarification
 * - idea suggestions may be dropped by thresholds
 *
 * NORMALIZATION: Ensures suggestion.type matches section intent label.
 * If a plan_change section was mis-typed as idea, we normalize
 * it to project_update to ensure proper THRESHOLD handling.
 *
 * CAPPING: project_update suggestions are always kept; only idea
 * suggestions can be capped if total exceeds max_suggestions.
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

    const isPlanChangeSection = isPlanChangeIntentLabel(section.intent);

    if (isPlanChangeSection && s.type !== 'project_update') {
      // Force plan_change semantics by type
      return { ...s, type: 'project_update' as const };
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

  // 3) Apply confidence-based processing (respects plan_change invariants)
  const { passed, dropped, downgraded } = applyConfidenceBasedProcessing(scored, config.thresholds);

  // 4) Separate project_update from idea types for plan_change-aware capping
  // idea suggestions are cappable; project_update is not
  const projectUpdates = passed.filter(s => s.type === 'project_update');
  const ideas = passed.filter(s => s.type !== 'project_update');

  // 5) Sort each group by score
  const sortedProjectUpdates = sortByScore(projectUpdates);
  const sortedIdeas = sortByScore(ideas);

  // 6) Cap suggestions: always keep ALL plan_change (project_update) suggestions
  // Only idea suggestions can be capped if total exceeds max_suggestions
  const remainingSlots = Math.max(0, config.max_suggestions - sortedProjectUpdates.length);
  const keptIdeas = sortedIdeas.slice(0, remainingSlots);
  const capped = [...sortedProjectUpdates, ...keptIdeas];

  // Mark dropped idea suggestions beyond cap
  // project_update suggestions are NEVER in cappedDropped
  const cappedDropped = sortedIdeas.slice(remainingSlots).map((s) => ({
    suggestion: s,
    reason: 'Exceeded max_suggestions limit',
  }));

  return {
    suggestions: capped,
    dropped: [...dropped, ...cappedDropped],
    downgraded_to_clarification: downgraded,
  };
}
