/**
 * Belief-First Reasoning Pipeline Types
 * 
 * Complete type definitions for the belief-first reasoning pipeline
 * that converts meeting notes into structured belief objects.
 */

// ============================================
// Input Types
// ============================================

export interface MeetingNote {
  id: string;
  occurred_at: string; // ISO DateTime
  raw_markdown: string;
}

export interface NormalizedMeetingNote extends MeetingNote {
  // Same as MeetingNote but with normalized raw_markdown
}

// ============================================
// Section and Utterance Types
// ============================================

export type SectionType = "heading" | "body" | "list" | "code" | "other";

export interface Section {
  id: string;
  meeting_id: string;
  index: number; // order in note
  title: string | null; // derived from markdown heading or null
  type: SectionType;
  start_char: number; // inclusive offset into raw_markdown
  end_char: number; // exclusive
  content: string; // raw markdown slice
}

export interface Utterance {
  id: string;
  meeting_id: string;
  section_id: string;
  index: number; // order within section
  text: string; // single sentence or bullet item
  start_char: number;
  end_char: number;
}

// ============================================
// Belief Dimension and Classification Types
// ============================================

export type BeliefDimension = 
  | "timeline"
  | "scope"
  | "ownership"
  | "priority"
  | "dependency"
  | "risk"
  | "status"
  | "decision"
  | "other";

export type BeliefSourceType = 
  | "explicit"  // clearly stated in this note
  | "implicit"  // implied but not spelled out
  | "external"; // depends on prior beliefs/context

export type BeliefConfidenceBand = 
  | "none"       // no belief; status/context only
  | "high"       // belief with high confidence
  | "uncertain"; // belief with uncertainty, requires clarification

export type EvidenceSpanRole = 
  | "before" 
  | "after" 
  | "supporting" 
  | "contradicting";

export type UtteranceLabel = 
  | "status" 
  | "plan_change" 
  | "noise";

export type ChangeRole = 
  | "before" 
  | "after" 
  | "none";

// ============================================
// Evidence Types
// ============================================

export interface BeliefEvidenceSpan {
  id: string;
  meeting_id: string;
  section_id: string;
  utterance_id: string;
  start_char: number;
  end_char: number;
  role: EvidenceSpanRole;
}

// ============================================
// Belief Candidate Types (Stage 3 output)
// ============================================

export interface UtteranceClassification {
  utterance_id: string;
  label: UtteranceLabel;
  dimension: BeliefDimension | null;
  change_role: ChangeRole;
  subject_handle: string | null;
  local_confidence: number; // 0.0-1.0
}

export interface BeliefCandidate {
  id: string;
  meeting_id: string;
  dimension: BeliefDimension;
  subject_handle: string;
  before_spans: BeliefEvidenceSpan[];
  after_spans: BeliefEvidenceSpan[];
  supporting_spans: BeliefEvidenceSpan[];
  status_utterance_ids: string[];
  candidate_score: number; // 0.0-1.0
}

// ============================================
// Belief Types (Final Output)
// ============================================

export type ClarificationReason = 
  | "ambiguous_timeline"
  | "ambiguous_scope"
  | "conflicting_statements"
  | "depends_on_external_context"
  | "low_model_confidence";

export interface Belief {
  // Required fields
  id: string;
  meeting_id: string;
  created_at: string; // ISO DateTime
  dimension: BeliefDimension;
  subject_handle: string; // short human-readable handle for "what" changed
  summary: string; // 1-2 sentence description of the delta
  before_state: string; // textual description of prior plan/state
  after_state: string; // textual description of updated plan/state
  source_type: BeliefSourceType;
  evidence_spans: BeliefEvidenceSpan[];
  confidence_score: number; // 0.0-1.0
  confidence_band: BeliefConfidenceBand;
  needs_clarification: boolean;
  clarification_reasons: ClarificationReason[]; // non-empty iff needs_clarification === true

  // Optional fields
  notes?: string; // free-form explanation / model rationale
  supporting_utterance_ids?: string[];
  contradicting_utterance_ids?: string[];
  model_version?: string;
  upstream_candidate_ids?: string[]; // IDs of candidate beliefs merged into this one
}

// ============================================
// Scoring Features (Stage 5)
// ============================================

export interface BeliefScoringFeatures {
  f_evidence_count: number;
  f_explicit_before: 0 | 1;
  f_explicit_after: 0 | 1;
  f_contradictions: 0 | 1;
  f_source_type_weight: number; // 1.0, 0.7, or 0.4
}

// ============================================
// Pipeline Stage Outputs
// ============================================

export interface Stage1Output {
  meeting: NormalizedMeetingNote;
  sections: Section[];
}

export interface Stage2Output {
  meeting: NormalizedMeetingNote;
  sections: Section[];
  utterances: Utterance[];
}

export interface Stage3Output {
  meeting: NormalizedMeetingNote;
  sections: Section[];
  utterances: Utterance[];
  classifications: UtteranceClassification[];
  candidates: BeliefCandidate[];
}

export interface Stage4Output {
  meeting: NormalizedMeetingNote;
  sections: Section[];
  utterances: Utterance[];
  candidates: BeliefCandidate[];
  beliefs: Belief[];
}

export interface Stage5Output {
  meeting: NormalizedMeetingNote;
  sections: Section[];
  utterances: Utterance[];
  candidates: BeliefCandidate[];
  beliefs: Belief[];
  scoring_features: Map<string, BeliefScoringFeatures>; // belief_id -> features
}

// ============================================
// Final Pipeline Output
// ============================================

export interface BeliefExtractionResult {
  meeting_id: string;
  beliefs: Belief[];
  sections?: Section[]; // optional for introspection
  utterances?: Utterance[]; // optional for introspection
}

// ============================================
// Configuration Types
// ============================================

export interface BeliefPipelineConfig {
  model_version: string;
  include_introspection: boolean; // whether to include sections/utterances in result
  confidence_threshold_high: number; // default 0.75
  confidence_threshold_uncertain: number; // default 0.6
  evidence_boost_weight: number; // default 0.1
  structure_bonus_weight: number; // default 0.1
  contradiction_penalty: number; // default 0.2
}

export const DEFAULT_PIPELINE_CONFIG: BeliefPipelineConfig = {
  model_version: "belief-pipeline-v0.1",
  include_introspection: false,
  confidence_threshold_high: 0.75,
  confidence_threshold_uncertain: 0.6,
  evidence_boost_weight: 0.1,
  structure_bonus_weight: 0.1,
  contradiction_penalty: 0.2,
};
