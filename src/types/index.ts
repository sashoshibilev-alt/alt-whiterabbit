export type ConfidenceLevel = 'high' | 'medium' | 'low';
export type ChangeType = 'progress_update' | 'timeline_change' | 'new_idea';
export type SuggestionStatus = 'pending' | 'applied' | 'dismissed';
export type InitiativeStatus = 'planned' | 'in_progress' | 'done';
export type MeetingSource = 'granola' | 'gemini_notes';

export type DismissReason = 
  | 'wrong_initiative' 
  | 'not_real_decision' 
  | 'too_ambiguous' 
  | 'wrong_value' 
  | 'other';

// ============================================
// Shipit v0 Types
// ============================================

export type NoteSource = 'manual' | 'granola_manual';

export type V0SuggestionStatus = 'new' | 'applied' | 'dismissed';

export type V0InitiativeStatus = 'draft' | 'active' | 'done';

export type V0DismissReason = 
  | 'not_relevant'
  | 'incorrect_or_low_quality'
  | 'too_risky_or_disruptive'
  | 'already_done_or_in_progress'
  | 'needs_more_clarification'
  | 'wrong_scope_or_target'
  | 'other';

export type ClarificationState = 'none' | 'suggested' | 'requested' | 'answered';

export type SuggestionEventType = 
  | 'generated'
  | 'viewed'
  | 'shown'
  | 'applied'
  | 'dismissed'
  | 'regenerated'
  | 'clarification_requested'
  | 'clarification_answered';

export interface Note {
  _id: string;
  title?: string;
  body: string;
  source: NoteSource;
  capturedAt: number;
  meetingAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface V0Suggestion {
  _id: string;
  noteId: string;
  content: string;
  status: V0SuggestionStatus;
  createdAt: number;
  appliedAt?: number;
  dismissedAt?: number;
  dismissReason?: V0DismissReason;
  dismissReasonOther?: string;
  modelVersion?: string;
  initiativeId?: string;
  // Clarification support
  clarificationState?: ClarificationState;
  clarificationPrompt?: string;
  clarificationAnswerId?: string;
  clarifiedFromSuggestionId?: string;
  // Analytics fields
  modelConfidenceScore?: number;
  ruleOrPromptId?: string;
  suggestionFamily?: string;
  estimatedDiffSize?: string;
}

export interface V0Initiative {
  _id: string;
  title: string;
  description: string;
  status: V0InitiativeStatus;
  createdAt: number;
  updatedAt: number;
}

// V0 Initiative status display labels
export const V0_INITIATIVE_STATUS_LABELS: Record<V0InitiativeStatus, string> = {
  draft: 'Draft',
  active: 'Active',
  done: 'Done',
};

export interface SuggestionEvent {
  _id: string;
  noteId: string;
  suggestionId: string;
  eventType: SuggestionEventType;
  createdAt: number;
  timeToEventSeconds?: number;
  selfReportedTimeSavedMinutes?: number;
  dismissReason?: V0DismissReason;
  dismissReasonOther?: string;
  uiSurface?: string;
}

// Note with computed suggestion stats for list view
export interface NoteWithStats extends Note {
  totalSuggestions: number;
  appliedCount: number;
  dismissedCount: number;
  shownCount: number;
}

// Dismiss reason display labels (updated taxonomy)
export const V0_DISMISS_REASON_LABELS: Record<V0DismissReason, string> = {
  not_relevant: 'Not relevant',
  incorrect_or_low_quality: 'Incorrect or low quality',
  too_risky_or_disruptive: 'Too risky or disruptive',
  already_done_or_in_progress: 'Already done or in progress',
  needs_more_clarification: 'Needs more clarification',
  wrong_scope_or_target: 'Wrong scope or target',
  other: 'Other',
};

// Clarification state display labels
export const CLARIFICATION_STATE_LABELS: Record<ClarificationState, string> = {
  none: 'None',
  suggested: 'Needs clarification',
  requested: 'Clarification requested',
  answered: 'Clarified',
};

// Time saved options for apply modal
export const TIME_SAVED_OPTIONS = [
  { value: 0, label: '0 minutes' },
  { value: 2, label: '2 minutes' },
  { value: 5, label: '5 minutes' },
  { value: 10, label: '10 minutes' },
  { value: 20, label: '20+ minutes' },
] as const;

export interface Speaker {
  name: string;
  role: string;
}

export interface Meeting {
  id: string;
  title: string;
  date: Date;
  duration: number; // minutes
  attendeesCount: number;
  source: MeetingSource;
  transcriptExcerpt: string;
}

export interface Initiative {
  id: string;
  name: string;
  owner: string;
  status: InitiativeStatus;
  releaseDate: Date | null;
  lastUpdated: Date;
  description: string;
  activityLog: ActivityLogEntry[];
}

export interface ActivityLogEntry {
  id: string;
  timestamp: Date;
  type: 'comment' | 'update' | 'creation';
  content: string;
  author: string;
  suggestionId?: string;
}

export interface Suggestion {
  id: string;
  meetingId: string;
  title: string;
  changeType: ChangeType;
  confidence: ConfidenceLevel;
  status: SuggestionStatus;
  targetInitiativeId: string | null;

  // Proposed change details
  proposedChange: {
    field?: string;
    before?: string;
    after?: string;
    commentText?: string;
    backlogTitle?: string;
    backlogDescription?: string;
  };

  // Evidence
  evidenceQuote: string;
  speaker: Speaker;
  speakerAttributionConfidence: ConfidenceLevel;
  matchingHint?: string;

  // Metadata
  createdAt: Date;
  appliedAt?: Date;
  appliedBy?: string;
  dismissedAt?: Date;
  dismissedBy?: string;
  dismissReason?: DismissReason;
  dismissReasonText?: string;

  // Editing
  isEdited?: boolean;
  originalChange?: Suggestion['proposedChange'];
  editedChange?: Suggestion['proposedChange'];

  // Warnings
  isNonOwnerUpdate?: boolean;
  hasConflict?: boolean;

  // Suggestion context (v2 engine)
  suggestion?: {
    title: string;
    body: string;
    evidencePreview?: string[];
    sourceSectionId: string;
    sourceHeading: string;
  };
}

export interface Connection {
  id: string;
  name: string;
  type: 'meeting_source' | 'roadmap_system';
  provider: string;
  isConnected: boolean;
}
