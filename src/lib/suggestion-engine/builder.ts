/**
 * Suggestion Engine Builder
 * 
 * Builds validated suggestion objects from candidates.
 * Handles schema validation, deduplication, and filtering.
 */

import type {
  MutationCandidate,
  ExecutionArtifactCandidate,
  Suggestion,
  PlanMutationSuggestion,
  ExecutionArtifactSuggestion,
  Initiative,
  GeneratorConfig,
  MutationDetails,
  Artifact,
  NewInitiativeArtifact,
  BacklogDraftArtifact,
  ChecklistArtifact,
  DecisionRecordArtifact,
  OriginContext,
} from './types';
import {
  validateSuggestion,
  ValidationResult,
} from './validators';

// ============================================
// ID Generation
// ============================================

/**
 * Generate a deterministic ID from suggestion content
 */
function generateSuggestionId(
  noteId: string,
  type: string,
  payload: string
): string {
  // Simple hash-like ID based on content
  const combined = `${noteId}:${type}:${payload}`;
  let hash = 0;
  for (let i = 0; i < combined.length; i++) {
    const char = combined.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return `sug_${Math.abs(hash).toString(36)}_${Date.now().toString(36)}`;
}

// ============================================
// Mutation Suggestion Builder
// ============================================

/**
 * Build a plan mutation suggestion from a candidate
 */
export function buildMutationSuggestion(
  candidate: MutationCandidate,
  sourceNoteId: string,
  initiatives: Initiative[]
): PlanMutationSuggestion | null {
  const targetInitiative = initiatives.find(i => i.id === candidate.target_initiative_id);
  if (!targetInitiative) {
    return null;
  }

  const mutation: MutationDetails = {
    target_initiative_id: candidate.target_initiative_id,
    change_type: candidate.change_type,
    before: candidate.proposed_before as Record<string, unknown>,
    after: candidate.proposed_after as Record<string, unknown>,
  };

  const suggestion: PlanMutationSuggestion = {
    id: generateSuggestionId(sourceNoteId, 'PLAN_MUTATION', JSON.stringify(mutation)),
    type: 'PLAN_MUTATION',
    source_note_id: sourceNoteId,
    confidence: candidate.confidence,
    evidence_segment_ids: candidate.evidence_segment_ids,
    mutation,
    rationale: candidate.rationale,
  };

  return suggestion;
}

// ============================================
// Execution Artifact Suggestion Builder
// ============================================

/**
 * Build an execution artifact suggestion from a candidate
 */
export function buildExecutionArtifactSuggestion(
  candidate: ExecutionArtifactCandidate,
  sourceNoteId: string,
  initiatives: Initiative[]
): ExecutionArtifactSuggestion | null {
  const originContext: OriginContext = {
    linked_initiative_ids: candidate.linked_initiative_ids,
    note_anchor: candidate.evidence_segment_ids[0] || sourceNoteId,
  };

  let artifact: Artifact;

  switch (candidate.artifact_kind) {
    case 'NEW_INITIATIVE': {
      const newInitiative: NewInitiativeArtifact = {
        artifact_kind: 'NEW_INITIATIVE',
        title: candidate.title,
        description: candidate.description,
        proposed_owner_id: candidate.proposed_owner_id,
        proposed_owner_name: candidate.proposed_owner_name,
        origin_context: originContext,
        success_criteria: candidate.success_criteria || `Complete: ${candidate.title}`,
        rough_timeline: candidate.rough_timeline || 'TBD',
      };
      artifact = newInitiative;
      break;
    }

    case 'BACKLOG_DRAFT': {
      if (!candidate.parent_initiative_id) {
        return null;
      }
      const backlog: BacklogDraftArtifact = {
        artifact_kind: 'BACKLOG_DRAFT',
        title: candidate.title,
        description: candidate.description,
        proposed_owner_id: candidate.proposed_owner_id,
        proposed_owner_name: candidate.proposed_owner_name,
        origin_context: originContext,
        parent_initiative_id: candidate.parent_initiative_id,
      };
      artifact = backlog;
      break;
    }

    case 'CHECKLIST': {
      if (!candidate.items || candidate.items.length === 0) {
        return null;
      }
      const checklist: ChecklistArtifact = {
        artifact_kind: 'CHECKLIST',
        title: candidate.title,
        description: candidate.description,
        proposed_owner_id: candidate.proposed_owner_id,
        proposed_owner_name: candidate.proposed_owner_name,
        origin_context: originContext,
        items: candidate.items,
      };
      artifact = checklist;
      break;
    }

    case 'DECISION_RECORD': {
      const decision: DecisionRecordArtifact = {
        artifact_kind: 'DECISION_RECORD',
        title: candidate.title,
        description: candidate.description,
        proposed_owner_id: candidate.proposed_owner_id,
        proposed_owner_name: candidate.proposed_owner_name,
        origin_context: originContext,
        decision_summary: candidate.decision_summary || candidate.description,
        impacted_initiative_ids: candidate.impacted_initiative_ids || [],
      };
      artifact = decision;
      break;
    }

    default:
      return null;
  }

  const suggestion: ExecutionArtifactSuggestion = {
    id: generateSuggestionId(sourceNoteId, 'EXECUTION_ARTIFACT', JSON.stringify(artifact)),
    type: 'EXECUTION_ARTIFACT',
    source_note_id: sourceNoteId,
    confidence: candidate.confidence,
    evidence_segment_ids: candidate.evidence_segment_ids,
    artifact,
  };

  return suggestion;
}

// ============================================
// Validation & Filtering
// ============================================

export interface BuildResult {
  suggestion: Suggestion;
  validationResult: ValidationResult;
}

/**
 * Build and validate all suggestions from candidates
 */
export function buildAndValidateSuggestions(
  mutations: MutationCandidate[],
  artifacts: ExecutionArtifactCandidate[],
  sourceNoteId: string,
  initiatives: Initiative[],
  config: GeneratorConfig
): { valid: Suggestion[]; invalid: BuildResult[]; errors: string[] } {
  const valid: Suggestion[] = [];
  const invalid: BuildResult[] = [];
  const errors: string[] = [];

  // Build mutation suggestions
  if (config.enable_timeline_mutations || config.enable_priority_mutations || 
      config.enable_scope_mutations || config.enable_ownership_mutations) {
    for (const candidate of mutations) {
      // Check if this change type is enabled
      const changeTypeEnabled = (
        (candidate.change_type === 'TIMELINE' && config.enable_timeline_mutations) ||
        (candidate.change_type === 'PRIORITY' && config.enable_priority_mutations) ||
        (candidate.change_type === 'SCOPE' && config.enable_scope_mutations) ||
        (candidate.change_type === 'OWNERSHIP' && config.enable_ownership_mutations) ||
        candidate.change_type === 'STATUS' // Always enable status changes
      );

      if (!changeTypeEnabled) continue;

      const suggestion = buildMutationSuggestion(candidate, sourceNoteId, initiatives);
      if (!suggestion) {
        errors.push(`Failed to build mutation suggestion for ${candidate.target_initiative_id}`);
        continue;
      }

      const validationResult = validateSuggestion(suggestion, initiatives);
      
      if (validationResult.valid) {
        valid.push(suggestion);
      } else {
        invalid.push({ suggestion, validationResult });
        errors.push(...validationResult.errors);
      }
    }
  }

  // Build artifact suggestions
  for (const candidate of artifacts) {
    // Check if this artifact kind is enabled
    const kindEnabled = (
      (candidate.artifact_kind === 'NEW_INITIATIVE' && config.enable_new_initiatives) ||
      (candidate.artifact_kind === 'BACKLOG_DRAFT' && config.enable_backlog_drafts) ||
      (candidate.artifact_kind === 'CHECKLIST' && config.enable_checklists) ||
      (candidate.artifact_kind === 'DECISION_RECORD' && config.enable_decision_records)
    );

    if (!kindEnabled) continue;

    const suggestion = buildExecutionArtifactSuggestion(candidate, sourceNoteId, initiatives);
    if (!suggestion) {
      errors.push(`Failed to build artifact suggestion: ${candidate.title}`);
      continue;
    }

    const validationResult = validateSuggestion(suggestion, initiatives);
    
    if (validationResult.valid) {
      valid.push(suggestion);
    } else {
      invalid.push({ suggestion, validationResult });
      errors.push(...validationResult.errors);
    }
  }

  return { valid, invalid, errors };
}

// ============================================
// Deduplication
// ============================================

/**
 * Create a deduplication key for a suggestion
 */
function getSuggestionDedupeKey(suggestion: Suggestion): string {
  if (suggestion.type === 'PLAN_MUTATION') {
    const m = suggestion.mutation;
    return `mutation:${m.target_initiative_id}:${m.change_type}:${JSON.stringify(m.after)}`;
  } else {
    const a = suggestion.artifact;
    const normalizedTitle = a.title.toLowerCase().trim();
    const ownerKey = a.proposed_owner_id || a.proposed_owner_name || 'unknown';
    return `artifact:${normalizedTitle}:${ownerKey}:${a.artifact_kind}`;
  }
}

/**
 * Deduplicate suggestions
 */
export function deduplicateSuggestions(suggestions: Suggestion[]): Suggestion[] {
  const seen = new Map<string, Suggestion>();
  
  for (const suggestion of suggestions) {
    const key = getSuggestionDedupeKey(suggestion);
    
    if (!seen.has(key)) {
      seen.set(key, suggestion);
    } else {
      // Keep the one with higher confidence
      const existing = seen.get(key)!;
      if (suggestion.confidence > existing.confidence) {
        seen.set(key, suggestion);
      }
    }
  }

  return Array.from(seen.values());
}

// ============================================
// Confidence Filtering & Capping
// ============================================

/**
 * Filter by confidence threshold and cap to max suggestions
 */
export function filterAndCapSuggestions(
  suggestions: Suggestion[],
  config: GeneratorConfig
): Suggestion[] {
  // Filter by confidence threshold
  const aboveThreshold = suggestions.filter(
    s => s.confidence >= config.confidence_threshold
  );

  // Sort by confidence (descending)
  aboveThreshold.sort((a, b) => b.confidence - a.confidence);

  // Cap to max suggestions
  return aboveThreshold.slice(0, config.max_suggestions);
}

// ============================================
// Full Build Pipeline
// ============================================

export interface BuildPipelineResult {
  suggestions: Suggestion[];
  debug: {
    candidates_count: number;
    valid_before_dedupe: number;
    valid_after_dedupe: number;
    filtered_count: number;
    validation_errors: string[];
  };
}

/**
 * Full build pipeline: validate, dedupe, filter, cap
 */
export function runBuildPipeline(
  mutations: MutationCandidate[],
  artifacts: ExecutionArtifactCandidate[],
  sourceNoteId: string,
  initiatives: Initiative[],
  config: GeneratorConfig
): BuildPipelineResult {
  // Build and validate
  const { valid, invalid, errors } = buildAndValidateSuggestions(
    mutations,
    artifacts,
    sourceNoteId,
    initiatives,
    config
  );

  const validBeforeDedupe = valid.length;

  // Deduplicate
  const deduplicated = deduplicateSuggestions(valid);
  const validAfterDedupe = deduplicated.length;

  // Filter and cap
  const final = filterAndCapSuggestions(deduplicated, config);

  return {
    suggestions: final,
    debug: {
      candidates_count: mutations.length + artifacts.length,
      valid_before_dedupe: validBeforeDedupe,
      valid_after_dedupe: validAfterDedupe,
      filtered_count: validAfterDedupe - final.length,
      validation_errors: errors,
    },
  };
}
