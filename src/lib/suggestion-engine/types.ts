/**
 * Suggestion Engine Domain Types
 * 
 * Strict type definitions for the deterministic suggestion pipeline.
 * All types follow the specification from the refactor plan.
 */

// ============================================
// Core Input Types
// ============================================

/**
 * Structured sections that may be present in a note
 */
export interface StructuredSections {
  decisions?: string[];
  actions?: string[];
  risks?: string[];
  agenda?: string[];
  attendees?: string[];
}

/**
 * Note input to the suggestion generator
 */
export interface Note {
  id: string;
  raw_text: string;
  created_at: number;
  author?: string;
  structured_sections?: StructuredSections;
  linked_initiative_ids?: string[];
}

/**
 * Timeline representation for initiatives
 */
export interface Timeline {
  start?: number; // timestamp
  end?: number;   // timestamp
  description?: string;
}

/**
 * Initiative priority levels
 */
export type Priority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

/**
 * Initiative status values
 */
export type InitiativeStatus = 'draft' | 'active' | 'paused' | 'done' | 'cancelled';

/**
 * Initiative entity - the target of mutations
 */
export interface Initiative {
  id: string;
  title: string;
  status: InitiativeStatus;
  owner_id?: string;
  owner_name?: string;
  priority?: Priority;
  timeline?: Timeline;
  scope?: string;
  tags?: string[];
  description?: string;
}

/**
 * Optional context for the generator
 */
export interface GeneratorContext {
  now?: number; // timestamp for timeline diffs
  user_role?: string;
  feature_flags?: Record<string, boolean>;
  workspace_id?: string;
  participants?: string[];
  meeting_type?: string;
}

// ============================================
// Signal Types (Internal Pipeline)
// ============================================

/**
 * Types of cues detected in text
 */
export type CueType = 
  | 'mutation_timeline'
  | 'mutation_scope'
  | 'mutation_priority'
  | 'mutation_ownership'
  | 'mutation_status'
  | 'mutation_tags'
  | 'new_initiative'
  | 'backlog_item'
  | 'decision'
  | 'checklist';

/**
 * A segment from the note (sentence or bullet)
 */
export interface Segment {
  id: string;
  text: string;
  normalized_text: string; // lowercase for matching
  index: number; // position in note
  section?: string; // which structured section it came from
}

/**
 * A detected signal from a segment
 */
export interface Signal {
  segment_id: string;
  text: string;
  cue_type: CueType;
  referenced_initiative_ids: string[];
  confidence_boost: number; // 0-1, based on cue strength
}

// ============================================
// Candidate Types (Pre-Validation)
// ============================================

/**
 * Change types for mutations
 */
export type MutationChangeType = 
  | 'TIMELINE'
  | 'SCOPE'
  | 'PRIORITY'
  | 'OWNERSHIP'
  | 'STATUS'
  | 'TAGS';

/**
 * Mutation candidate before validation
 */
export interface MutationCandidate {
  target_initiative_id: string;
  change_type: MutationChangeType;
  evidence_segment_ids: string[];
  proposed_before: Partial<Initiative>;
  proposed_after: Partial<Initiative>;
  rationale: string;
  confidence: number;
}

/**
 * Artifact kinds for execution artifacts
 */
export type ArtifactKind = 
  | 'NEW_INITIATIVE'
  | 'BACKLOG_DRAFT'
  | 'CHECKLIST'
  | 'DECISION_RECORD';

/**
 * Execution artifact candidate before validation
 */
export interface ExecutionArtifactCandidate {
  artifact_kind: ArtifactKind;
  evidence_segment_ids: string[];
  title: string;
  description: string;
  proposed_owner_id?: string;
  proposed_owner_name?: string;
  success_criteria?: string;
  rough_timeline?: string;
  parent_initiative_id?: string;
  items?: string[]; // for checklists
  decision_summary?: string;
  impacted_initiative_ids?: string[];
  linked_initiative_ids: string[];
  confidence: number;
}

// ============================================
// Output Types (Validated Suggestions)
// ============================================

/**
 * Suggestion types enum
 */
export type SuggestionType = 'PLAN_MUTATION' | 'EXECUTION_ARTIFACT';

/**
 * Base fields required on all suggestions
 */
export interface SuggestionBase {
  id: string;
  type: SuggestionType;
  source_note_id: string;
  confidence: number;
  evidence_segment_ids: string[];
}

/**
 * Mutation details for plan mutation suggestions
 */
export interface MutationDetails {
  target_initiative_id: string;
  change_type: MutationChangeType;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}

/**
 * Plan mutation suggestion
 */
export interface PlanMutationSuggestion extends SuggestionBase {
  type: 'PLAN_MUTATION';
  mutation: MutationDetails;
  rationale: string;
}

/**
 * Origin context for execution artifacts
 */
export interface OriginContext {
  linked_initiative_ids: string[];
  note_anchor: string; // segment ID or range
}

/**
 * Base artifact details
 */
export interface ArtifactBase {
  artifact_kind: ArtifactKind;
  title: string;
  description: string;
  proposed_owner_id?: string;
  proposed_owner_name?: string;
  origin_context: OriginContext;
}

/**
 * New initiative artifact
 */
export interface NewInitiativeArtifact extends ArtifactBase {
  artifact_kind: 'NEW_INITIATIVE';
  success_criteria: string;
  rough_timeline: string;
}

/**
 * Backlog draft artifact
 */
export interface BacklogDraftArtifact extends ArtifactBase {
  artifact_kind: 'BACKLOG_DRAFT';
  parent_initiative_id: string;
}

/**
 * Checklist artifact
 */
export interface ChecklistArtifact extends ArtifactBase {
  artifact_kind: 'CHECKLIST';
  items: string[];
}

/**
 * Decision record artifact
 */
export interface DecisionRecordArtifact extends ArtifactBase {
  artifact_kind: 'DECISION_RECORD';
  decision_summary: string;
  impacted_initiative_ids: string[];
}

/**
 * Union of all artifact types
 */
export type Artifact = 
  | NewInitiativeArtifact 
  | BacklogDraftArtifact 
  | ChecklistArtifact 
  | DecisionRecordArtifact;

/**
 * Execution artifact suggestion
 */
export interface ExecutionArtifactSuggestion extends SuggestionBase {
  type: 'EXECUTION_ARTIFACT';
  artifact: Artifact;
}

/**
 * Union of all suggestion types - the final output
 */
export type Suggestion = PlanMutationSuggestion | ExecutionArtifactSuggestion;

// ============================================
// Generator Result
// ============================================

/**
 * Result of the suggestion generator
 */
export interface GeneratorResult {
  suggestions: Suggestion[];
  // Debug info (only in development)
  debug?: {
    segments_count: number;
    signals_count: number;
    candidates_count: number;
    filtered_count: number;
    validation_errors: string[];
  };
}

// ============================================
// Configuration
// ============================================

/**
 * Generator configuration
 */
export interface GeneratorConfig {
  max_suggestions: number;
  confidence_threshold: number;
  enable_debug: boolean;
  // Feature flags for progressive rollout
  enable_timeline_mutations: boolean;
  enable_priority_mutations: boolean;
  enable_scope_mutations: boolean;
  enable_ownership_mutations: boolean;
  enable_new_initiatives: boolean;
  enable_backlog_drafts: boolean;
  enable_checklists: boolean;
  enable_decision_records: boolean;
}

/**
 * Default configuration
 */
export const DEFAULT_CONFIG: GeneratorConfig = {
  max_suggestions: 3,
  confidence_threshold: 0.7,
  enable_debug: false,
  // Start with core features enabled
  enable_timeline_mutations: true,
  enable_priority_mutations: true,
  enable_scope_mutations: false, // defer
  enable_ownership_mutations: false, // defer
  enable_new_initiatives: true,
  enable_backlog_drafts: false, // defer
  enable_checklists: false, // defer
  enable_decision_records: false, // defer
};
