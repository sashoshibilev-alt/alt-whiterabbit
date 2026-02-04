/**
 * Suggestion Engine Validators
 * 
 * Runtime validators for strict schema enforcement.
 * These ensure suggestions meet all required criteria before emission.
 */

import type {
  Suggestion,
  PlanMutationSuggestion,
  ExecutionArtifactSuggestion,
  MutationDetails,
  Artifact,
  NewInitiativeArtifact,
  BacklogDraftArtifact,
  ChecklistArtifact,
  DecisionRecordArtifact,
  Initiative,
  MutationChangeType,
  ArtifactKind,
  Priority,
  Timeline,
} from './types';

// ============================================
// Validation Result Type
// ============================================

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

function ok(): ValidationResult {
  return { valid: true, errors: [] };
}

function fail(error: string): ValidationResult {
  return { valid: false, errors: [error] };
}

function merge(...results: ValidationResult[]): ValidationResult {
  const errors = results.flatMap(r => r.errors);
  return { valid: errors.length === 0, errors };
}

// ============================================
// Primitive Validators
// ============================================

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function isNonEmptyArray<T>(value: unknown): value is T[] {
  return Array.isArray(value) && value.length > 0;
}

export function isNumberInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && value >= min && value <= max;
}

export function isValidUUID(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  // Accept various ID formats (UUIDs, short IDs, etc.)
  return value.length > 0 && value.length <= 100;
}

// ============================================
// Enum Validators
// ============================================

const VALID_CHANGE_TYPES: MutationChangeType[] = [
  'TIMELINE', 'SCOPE', 'PRIORITY', 'OWNERSHIP', 'STATUS', 'TAGS'
];

const VALID_ARTIFACT_KINDS: ArtifactKind[] = [
  'NEW_INITIATIVE', 'BACKLOG_DRAFT', 'CHECKLIST', 'DECISION_RECORD'
];

const VALID_PRIORITIES: Priority[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

export function isValidChangeType(value: unknown): value is MutationChangeType {
  return typeof value === 'string' && VALID_CHANGE_TYPES.includes(value as MutationChangeType);
}

export function isValidArtifactKind(value: unknown): value is ArtifactKind {
  return typeof value === 'string' && VALID_ARTIFACT_KINDS.includes(value as ArtifactKind);
}

export function isValidPriority(value: unknown): value is Priority {
  return typeof value === 'string' && VALID_PRIORITIES.includes(value as Priority);
}

// ============================================
// Timeline Validators
// ============================================

export function validateTimeline(timeline: unknown): ValidationResult {
  if (timeline === null || timeline === undefined) {
    return ok();
  }
  
  if (typeof timeline !== 'object') {
    return fail('Timeline must be an object');
  }

  const t = timeline as Timeline;
  
  if (t.start !== undefined && typeof t.start !== 'number') {
    return fail('Timeline start must be a number');
  }
  
  if (t.end !== undefined && typeof t.end !== 'number') {
    return fail('Timeline end must be a number');
  }
  
  if (t.start !== undefined && t.end !== undefined && t.start > t.end) {
    return fail('Timeline start must be before or equal to end');
  }

  return ok();
}

// ============================================
// Base Suggestion Validators
// ============================================

export function validateBaseSuggestion(suggestion: unknown): ValidationResult {
  if (!suggestion || typeof suggestion !== 'object') {
    return fail('Suggestion must be an object');
  }

  const s = suggestion as Record<string, unknown>;

  const results: ValidationResult[] = [];

  if (!isValidUUID(s.id)) {
    results.push(fail('Suggestion id must be a valid identifier'));
  }

  if (s.type !== 'PLAN_MUTATION' && s.type !== 'EXECUTION_ARTIFACT') {
    results.push(fail('Suggestion type must be PLAN_MUTATION or EXECUTION_ARTIFACT'));
  }

  if (!isValidUUID(s.source_note_id)) {
    results.push(fail('Suggestion source_note_id must be a valid identifier'));
  }

  if (!isNumberInRange(s.confidence, 0, 1)) {
    results.push(fail('Suggestion confidence must be a number between 0 and 1'));
  }

  if (!isNonEmptyArray(s.evidence_segment_ids)) {
    results.push(fail('Suggestion must have at least one evidence_segment_id'));
  } else if (!s.evidence_segment_ids.every(isValidUUID)) {
    results.push(fail('All evidence_segment_ids must be valid identifiers'));
  }

  return merge(...results);
}

// ============================================
// Mutation Validators
// ============================================

export function validateMutationDetails(
  mutation: unknown,
  initiatives: Initiative[]
): ValidationResult {
  if (!mutation || typeof mutation !== 'object') {
    return fail('Mutation details must be an object');
  }

  const m = mutation as MutationDetails;
  const results: ValidationResult[] = [];

  // Validate target_initiative_id exists
  if (!isValidUUID(m.target_initiative_id)) {
    results.push(fail('Mutation target_initiative_id must be a valid identifier'));
  } else {
    const targetExists = initiatives.some(i => i.id === m.target_initiative_id);
    if (!targetExists) {
      results.push(fail(`Mutation target initiative ${m.target_initiative_id} does not exist in input`));
    }
  }

  // Validate change_type
  if (!isValidChangeType(m.change_type)) {
    results.push(fail(`Mutation change_type must be one of: ${VALID_CHANGE_TYPES.join(', ')}`));
  }

  // Validate before/after objects exist
  if (!m.before || typeof m.before !== 'object') {
    results.push(fail('Mutation before snapshot must be an object'));
  }

  if (!m.after || typeof m.after !== 'object') {
    results.push(fail('Mutation after snapshot must be an object'));
  }

  // Validate before and after are different
  if (m.before && m.after) {
    const beforeJson = JSON.stringify(m.before);
    const afterJson = JSON.stringify(m.after);
    if (beforeJson === afterJson) {
      results.push(fail('Mutation before and after must be different'));
    }
  }

  // Type-specific validation
  if (m.change_type === 'TIMELINE' && m.before && m.after) {
    const beforeTimeline = validateTimeline((m.before as Record<string, unknown>).timeline);
    const afterTimeline = validateTimeline((m.after as Record<string, unknown>).timeline);
    results.push(beforeTimeline, afterTimeline);
  }

  if (m.change_type === 'PRIORITY' && m.before && m.after) {
    const beforePriority = (m.before as Record<string, unknown>).priority;
    const afterPriority = (m.after as Record<string, unknown>).priority;
    if (beforePriority !== undefined && !isValidPriority(beforePriority)) {
      results.push(fail('Mutation before.priority must be a valid priority'));
    }
    if (afterPriority !== undefined && !isValidPriority(afterPriority)) {
      results.push(fail('Mutation after.priority must be a valid priority'));
    }
  }

  return merge(...results);
}

export function validatePlanMutationSuggestion(
  suggestion: unknown,
  initiatives: Initiative[]
): ValidationResult {
  const baseResult = validateBaseSuggestion(suggestion);
  if (!baseResult.valid) return baseResult;

  const s = suggestion as PlanMutationSuggestion;
  const results: ValidationResult[] = [baseResult];

  if (s.type !== 'PLAN_MUTATION') {
    results.push(fail('Expected type PLAN_MUTATION'));
  }

  results.push(validateMutationDetails(s.mutation, initiatives));

  if (!isNonEmptyString(s.rationale)) {
    results.push(fail('Plan mutation must have a non-empty rationale'));
  }

  return merge(...results);
}

// ============================================
// Artifact Validators
// ============================================

// Forbidden substrings that indicate generic boilerplate
const FORBIDDEN_TITLE_SUBSTRINGS = [
  'next steps',
  'follow up',
  'follow-up',
  'to do',
  'todo',
  'action item',
  'tbd',
  'untitled',
];

function isForbiddenTitle(title: string): boolean {
  const lower = title.toLowerCase();
  return FORBIDDEN_TITLE_SUBSTRINGS.some(substr => lower === substr || lower.startsWith(substr + ':'));
}

export function validateArtifactBase(artifact: unknown): ValidationResult {
  if (!artifact || typeof artifact !== 'object') {
    return fail('Artifact must be an object');
  }

  const a = artifact as Artifact;
  const results: ValidationResult[] = [];

  if (!isValidArtifactKind(a.artifact_kind)) {
    results.push(fail(`Artifact kind must be one of: ${VALID_ARTIFACT_KINDS.join(', ')}`));
  }

  if (!isNonEmptyString(a.title)) {
    results.push(fail('Artifact must have a non-empty title'));
  } else if (a.title.length > 140) {
    results.push(fail('Artifact title must be 140 characters or less'));
  } else if (isForbiddenTitle(a.title)) {
    results.push(fail('Artifact title must not be generic boilerplate'));
  }

  if (!isNonEmptyString(a.description)) {
    results.push(fail('Artifact must have a non-empty description'));
  }

  // At least one owner field must be present
  if (!isNonEmptyString(a.proposed_owner_id) && !isNonEmptyString(a.proposed_owner_name)) {
    results.push(fail('Artifact must have either proposed_owner_id or proposed_owner_name'));
  }

  // Validate origin_context
  if (!a.origin_context || typeof a.origin_context !== 'object') {
    results.push(fail('Artifact must have origin_context'));
  } else {
    if (!Array.isArray(a.origin_context.linked_initiative_ids)) {
      results.push(fail('Artifact origin_context.linked_initiative_ids must be an array'));
    }
    if (!isNonEmptyString(a.origin_context.note_anchor)) {
      results.push(fail('Artifact origin_context.note_anchor must be non-empty'));
    }
  }

  return merge(...results);
}

export function validateNewInitiativeArtifact(
  artifact: unknown,
  initiatives: Initiative[]
): ValidationResult {
  const baseResult = validateArtifactBase(artifact);
  const results: ValidationResult[] = [baseResult];

  const a = artifact as NewInitiativeArtifact;

  if (a.artifact_kind !== 'NEW_INITIATIVE') {
    results.push(fail('Expected artifact_kind NEW_INITIATIVE'));
  }

  if (!isNonEmptyString(a.success_criteria)) {
    results.push(fail('New initiative must have non-empty success_criteria'));
  }

  if (!isNonEmptyString(a.rough_timeline)) {
    results.push(fail('New initiative must have non-empty rough_timeline'));
  }

  return merge(...results);
}

export function validateBacklogDraftArtifact(
  artifact: unknown,
  initiatives: Initiative[]
): ValidationResult {
  const baseResult = validateArtifactBase(artifact);
  const results: ValidationResult[] = [baseResult];

  const a = artifact as BacklogDraftArtifact;

  if (a.artifact_kind !== 'BACKLOG_DRAFT') {
    results.push(fail('Expected artifact_kind BACKLOG_DRAFT'));
  }

  if (!isValidUUID(a.parent_initiative_id)) {
    results.push(fail('Backlog draft must have a valid parent_initiative_id'));
  } else {
    const parentExists = initiatives.some(i => i.id === a.parent_initiative_id);
    if (!parentExists) {
      results.push(fail(`Backlog draft parent initiative ${a.parent_initiative_id} does not exist`));
    }
  }

  return merge(...results);
}

export function validateChecklistArtifact(artifact: unknown): ValidationResult {
  const baseResult = validateArtifactBase(artifact);
  const results: ValidationResult[] = [baseResult];

  const a = artifact as ChecklistArtifact;

  if (a.artifact_kind !== 'CHECKLIST') {
    results.push(fail('Expected artifact_kind CHECKLIST'));
  }

  if (!isNonEmptyArray(a.items)) {
    results.push(fail('Checklist must have at least one item'));
  } else if (!a.items.every(isNonEmptyString)) {
    results.push(fail('All checklist items must be non-empty strings'));
  }

  return merge(...results);
}

export function validateDecisionRecordArtifact(artifact: unknown): ValidationResult {
  const baseResult = validateArtifactBase(artifact);
  const results: ValidationResult[] = [baseResult];

  const a = artifact as DecisionRecordArtifact;

  if (a.artifact_kind !== 'DECISION_RECORD') {
    results.push(fail('Expected artifact_kind DECISION_RECORD'));
  }

  if (!isNonEmptyString(a.decision_summary)) {
    results.push(fail('Decision record must have non-empty decision_summary'));
  }

  if (!Array.isArray(a.impacted_initiative_ids)) {
    results.push(fail('Decision record must have impacted_initiative_ids array'));
  }

  return merge(...results);
}

export function validateExecutionArtifactSuggestion(
  suggestion: unknown,
  initiatives: Initiative[]
): ValidationResult {
  const baseResult = validateBaseSuggestion(suggestion);
  if (!baseResult.valid) return baseResult;

  const s = suggestion as ExecutionArtifactSuggestion;
  const results: ValidationResult[] = [baseResult];

  if (s.type !== 'EXECUTION_ARTIFACT') {
    results.push(fail('Expected type EXECUTION_ARTIFACT'));
  }

  if (!s.artifact || typeof s.artifact !== 'object') {
    results.push(fail('Execution artifact suggestion must have artifact object'));
    return merge(...results);
  }

  // Validate based on artifact kind
  switch (s.artifact.artifact_kind) {
    case 'NEW_INITIATIVE':
      results.push(validateNewInitiativeArtifact(s.artifact, initiatives));
      break;
    case 'BACKLOG_DRAFT':
      results.push(validateBacklogDraftArtifact(s.artifact, initiatives));
      break;
    case 'CHECKLIST':
      results.push(validateChecklistArtifact(s.artifact));
      break;
    case 'DECISION_RECORD':
      results.push(validateDecisionRecordArtifact(s.artifact));
      break;
    default:
      results.push(fail(`Unknown artifact kind: ${s.artifact.artifact_kind}`));
  }

  return merge(...results);
}

// ============================================
// Top-Level Validator
// ============================================

export function validateSuggestion(
  suggestion: unknown,
  initiatives: Initiative[]
): ValidationResult {
  if (!suggestion || typeof suggestion !== 'object') {
    return fail('Suggestion must be an object');
  }

  const s = suggestion as Suggestion;

  if (s.type === 'PLAN_MUTATION') {
    return validatePlanMutationSuggestion(suggestion, initiatives);
  } else if (s.type === 'EXECUTION_ARTIFACT') {
    return validateExecutionArtifactSuggestion(suggestion, initiatives);
  } else {
    return fail('Suggestion type must be PLAN_MUTATION or EXECUTION_ARTIFACT');
  }
}

/**
 * Type guard to check if a suggestion is valid
 */
export function isValidSuggestion(
  suggestion: unknown,
  initiatives: Initiative[]
): suggestion is Suggestion {
  return validateSuggestion(suggestion, initiatives).valid;
}
