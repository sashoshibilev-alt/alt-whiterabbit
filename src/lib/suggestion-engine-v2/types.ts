/**
 * Suggestion Engine v2 - Domain Types
 *
 * Section-based suggestion generation for high-quality plan mutations
 * and execution artifacts with hard quality gates.
 */

// ============================================
// External Input Types
// ============================================

/**
 * Note-level input to the suggestion generator
 */
export interface NoteInput {
  note_id: string;
  raw_markdown: string;
  author_id?: string;
  authored_at?: string; // ISO8601
  source?: 'doc' | 'meeting' | 'ad_hoc';
}

/**
 * Initiative snapshot for routing (optional, not required for generation)
 */
export interface InitiativeSnapshot {
  id: string;
  title: string;
  description: string;
  status?: string;
  tags?: string[];
}

/**
 * Generator context (optional metadata)
 */
export interface GeneratorContext {
  initiatives?: InitiativeSnapshot[];
  embedding_model?: 'openai' | 'local' | 'none';
  now?: number; // timestamp
  feature_flags?: Record<string, boolean>;
}

// ============================================
// Internal Representations
// ============================================

/**
 * Line type annotation for markdown parsing
 */
export type LineType =
  | 'heading'
  | 'list_item'
  | 'paragraph'
  | 'code'
  | 'quote'
  | 'blank';

/**
 * Line representation with annotations
 */
export interface Line {
  index: number;
  text: string;
  line_type: LineType;
  heading_level?: number; // 1-6 for headings
  indent_level?: number; // for list items
  is_code_fence?: boolean;
}

/**
 * Structural features for a section
 */
export interface StructuralFeatures {
  num_lines: number;
  num_list_items: number;
  has_dates: boolean;
  has_metrics: boolean;
  has_quarter_refs: boolean; // Q1, Q2, etc.
  has_version_refs: boolean; // v1, v2, MVP, etc.
  has_launch_keywords: boolean; // launch, rollout, ship
  initiative_phrase_density: number; // 0-1, density of "launch X", "build Y" phrases
}

/**
 * Section representation
 */
export interface Section {
  section_id: string;
  note_id: string;
  heading_text?: string;
  heading_level?: number;
  start_line: number;
  end_line: number;
  body_lines: Line[];
  structural_features: StructuralFeatures;
  raw_text: string; // concatenated body text
}

// ============================================
// Classification Types
// ============================================

/**
 * Intent classification probabilities
 */
export interface IntentClassification {
  plan_change: number;
  new_workstream: number;
  status_informational: number;
  communication: number;
  research: number;
  calendar: number;
  micro_tasks: number;
}

/**
 * Section type classification
 */
export type SectionType = 'idea' | 'project_update' | 'non_actionable';

/**
 * Classified section with actionability determination
 */
export interface ClassifiedSection extends Section {
  intent: IntentClassification;
  is_actionable: boolean;
  actionability_reason?: string;
  /** Max of plan_change and new_workstream signals */
  actionable_signal?: number;
  /** Max of communication, research, calendar, micro_tasks signals */
  out_of_scope_signal?: number;
  suggested_type?: SectionType;
  type_confidence?: number;
  /** Type label for validator behavior: idea | project_update */
  typeLabel?: 'idea' | 'project_update';
}

// ============================================
// Evidence Types
// ============================================

/**
 * Evidence span pointing to note text
 */
export interface EvidenceSpan {
  start_line: number;
  end_line: number;
  text: string;
}

// ============================================
// Suggestion Types
// ============================================

/**
 * Suggestion type enum
 */
export type SuggestionType = 'idea' | 'project_update';

/**
 * Plan mutation payload
 */
export interface PlanMutationPayload {
  after_description: string;
}

/**
 * Draft initiative for execution artifacts
 */
export interface DraftInitiative {
  title: string;
  description: string;
}

/**
 * Execution artifact payload
 */
export interface ExecutionArtifactPayload {
  draft_initiative: DraftInitiative;
}

/**
 * Suggestion payload union
 */
export type SuggestionPayload = {
  after_description?: string;
  draft_initiative?: DraftInitiative;
};

/**
 * Confidence scores for a suggestion
 */
export interface SuggestionScores {
  section_actionability: number;
  type_choice_confidence: number;
  synthesis_confidence: number;
  overall: number;
}

/**
 * Routing information for a suggestion
 */
export interface SuggestionRouting {
  attached_initiative_id?: string;
  similarity?: number;
  create_new: boolean;
}

/**
 * Validation result for quality validators
 */
export interface ValidationResult {
  passed: boolean;
  validator: 'V2_anti_vacuity' | 'V3_evidence_sanity';
  reason?: string;
}

/**
 * Clarification reason types for low-confidence suggestions
 */
export type ClarificationReason = 
  | 'low_actionability_score'
  | 'low_overall_score'
  | 'low_section_actionability'
  | 'ambiguous_initiative'
  | 'fallback_synthesis';

/**
 * Standalone suggestion context (additive)
 */
export interface SuggestionContext {
  title: string;
  body: string;
  evidencePreview?: string[];
  sourceSectionId: string;
  sourceHeading: string;
}

/**
 * Full suggestion representation
 */
export interface Suggestion {
  suggestion_id: string;
  note_id: string;
  section_id: string;
  type: SuggestionType;
  title: string;
  payload: SuggestionPayload;
  evidence_spans: EvidenceSpan[];
  scores: SuggestionScores;
  routing: SuggestionRouting;
  // Stable identifier for dedupe and persistence across regenerates
  suggestionKey: string;
  // Structural hint: idea (new work) or project_update (plan change)
  structural_hint?: 'idea' | 'project_update';
  // Clarification flags (per suggestion-suppression-fix plan)
  needs_clarification?: boolean;
  clarification_reasons?: ClarificationReason[];
  // High confidence flag (true when both actionability and overall scores pass thresholds)
  is_high_confidence?: boolean;
  // Standalone context (additive)
  suggestion?: SuggestionContext;
  // Debug info
  validation_results?: ValidationResult[];
  dropped?: boolean;
  drop_reason?: string;
}

// ============================================
// Generator Configuration
// ============================================

/**
 * Configurable thresholds
 */
export interface ThresholdConfig {
  T_action: number; // min actionability score to consider
  T_out_of_scope: number; // max out-of-scope signal to allow
  T_overall_min: number; // min overall score to emit
  T_section_min: number; // min section actionability
  T_generic: number; // max generic ratio for anti-vacuity
  T_attach: number; // min similarity for initiative attachment
  MIN_EVIDENCE_CHARS: number; // min evidence character count
}

/**
 * Default thresholds
 */
export const DEFAULT_THRESHOLDS: ThresholdConfig = {
  T_action: 0.5,
  T_out_of_scope: 0.4,
  T_overall_min: 0.65,
  T_section_min: 0.6,
  T_generic: 0.55,
  T_attach: 0.80,
  MIN_EVIDENCE_CHARS: 120,
};

/**
 * Generator configuration
 */
export interface GeneratorConfig {
  thresholds: ThresholdConfig;
  max_suggestions: number;
  enable_debug: boolean;
  use_llm_classifiers: boolean; // false = rule-based only
  embedding_enabled: boolean; // for routing
}

/**
 * Default configuration
 */
export const DEFAULT_CONFIG: GeneratorConfig = {
  thresholds: DEFAULT_THRESHOLDS,
  max_suggestions: 5,
  enable_debug: false,
  use_llm_classifiers: false,
  embedding_enabled: false,
};

// ============================================
// Generator Result
// ============================================

/**
 * Debug information for evaluation
 */
export interface GeneratorDebugInfo {
  sections_count: number;
  actionable_sections_count: number;
  suggestions_before_validation: number;
  v2_drops: number;
  v3_drops: number;
  suggestions_after_validation: number;
  suggestions_after_scoring: number;
  routing_attached: number;
  routing_create_new: number;
  dropped_suggestions: Array<{
    section_id: string;
    reason: string;
    validator?: string;
  }>;
  // New fields per suggestion-suppression-fix plan
  plan_change_count?: number;
  plan_change_emitted_count?: number;
  low_confidence_downgraded_count?: number;
  high_confidence_count?: number;
  // Invariant tracking
  invariant_plan_change_always_emitted?: boolean;
}

/**
 * Generator result
 */
export interface GeneratorResult {
  suggestions: Suggestion[];
  debug?: GeneratorDebugInfo;
}

// ============================================
// Preprocessing Result
// ============================================

/**
 * Result of preprocessing a note
 */
export interface PreprocessingResult {
  lines: Line[];
  sections: Section[];
}
