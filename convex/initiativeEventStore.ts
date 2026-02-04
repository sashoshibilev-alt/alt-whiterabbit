/**
 * Initiative Event Store
 * 
 * This module implements event sourcing for initiatives:
 * - Event types and payload schemas
 * - Fold function to rebuild state from events
 * - Event validation and state transitions
 * - Idempotent command handling
 */

import { v } from "convex/values";

// ============================================
// Event Types & Payloads
// ============================================

export type InitiativeEventType =
  | "InitiativeCreated"
  | "InitiativeFieldUpdated"
  | "InitiativeStatusChanged"
  | "InitiativeCommentAdded"
  | "InitiativeCommentEdited"
  | "InitiativeCommentDeleted"
  | "SuggestionCreated"
  | "SuggestionApplied"
  | "SuggestionDismissed"
  | "SuggestionFailed"
  | "SuggestionUndoApplied"
  | "ReleaseDateChanged";

export type InitiativeStatus =
  | "draft"
  | "proposed"
  | "approved"
  | "in_progress"
  | "blocked"
  | "released"
  | "completed"
  | "cancelled"
  | "archived";

export type Priority = "p0" | "p1" | "p2" | "p3";
export type RiskLevel = "low" | "medium" | "high";
export type EventOrigin = "ui" | "api" | "system" | "import";

// Event payload interfaces
export interface InitiativeCreatedPayload {
  slug: string;
  title: string;
  description: string;
  ownerUserId?: string;
  status: InitiativeStatus;
}

export interface InitiativeFieldUpdatedPayload {
  field: string;
  oldValue: any;
  newValue: any;
  undoOfEventId?: string; // For undo operations
}

export interface InitiativeStatusChangedPayload {
  oldStatus: InitiativeStatus;
  newStatus: InitiativeStatus;
  reason?: string;
}

export interface ReleaseDateChangedPayload {
  oldDate: number | null;
  newDate: number | null;
  dateType: "target" | "windowStart" | "windowEnd";
}

export interface SuggestionAppliedPayload {
  suggestionId: string;
  changedFields: string[];
}

export interface SuggestionFailedPayload {
  suggestionId: string;
  reason: string;
  conflictingFields?: string[];
}

// ============================================
// Initiative State (Canonical Representation)
// ============================================

export interface InitiativeState {
  // Identity
  id?: string;
  slug: string;
  title: string;
  description: string;
  status: InitiativeStatus;
  
  // Ownership
  ownerUserId?: string;
  sponsorUserId?: string;
  teamId?: string;
  
  // Planning
  goal?: string;
  successMetrics?: string;
  scope?: string;
  priority?: Priority;
  riskLevel?: RiskLevel;
  tags?: string[];
  
  // Lifecycle timestamps
  createdAt: number;
  updatedAt: number;
  proposedAt?: number;
  approvedAt?: number;
  startedAt?: number;
  blockedAt?: number;
  releasedAt?: number;
  completedAt?: number;
  cancelledAt?: number;
  archivedAt?: number;
  
  // Release dates
  releaseTargetDate?: number;
  releaseWindowStart?: number;
  releaseWindowEnd?: number;
  releaseNotes?: string;
  
  // Versioning
  currentVersion: number;
  eventStreamVersion: number;
  schemaVersion: number;
  
  // Integration metadata
  businessUnit?: string;
  productArea?: string;
  quarter?: string;
  integrationHints?: Record<string, any>;
}

// ============================================
// Event Structure
// ============================================

export interface InitiativeEvent {
  id?: string;
  initiativeId?: string;
  sequence: number;
  globalSequence: number;
  type: InitiativeEventType;
  payload: any;
  schemaVersion: number;
  occurredAt: number;
  
  // Provenance
  actorUserId?: string;
  origin: EventOrigin;
  commandId: string;
  correlationId: string;
  suggestionId?: string;
}

// ============================================
// Fold Function (Event Replay)
// ============================================

/**
 * Fold events into current state
 * This is a pure function that deterministically rebuilds state from events
 */
export function foldEvents(events: InitiativeEvent[]): InitiativeState | null {
  if (events.length === 0) {
    return null;
  }
  
  let state: InitiativeState | null = null;
  
  for (const event of events) {
    state = applyEvent(state, event);
  }
  
  return state;
}

/**
 * Apply a single event to state
 * Pure function - no side effects
 */
function applyEvent(
  state: InitiativeState | null,
  event: InitiativeEvent
): InitiativeState {
  const now = event.occurredAt;
  
  switch (event.type) {
    case "InitiativeCreated": {
      const payload = event.payload as InitiativeCreatedPayload;
      return {
        id: event.initiativeId,
        slug: payload.slug,
        title: payload.title,
        description: payload.description,
        status: payload.status,
        ownerUserId: payload.ownerUserId,
        createdAt: now,
        updatedAt: now,
        currentVersion: event.sequence,
        eventStreamVersion: event.sequence,
        schemaVersion: 1,
      };
    }
    
    case "InitiativeFieldUpdated": {
      if (!state) throw new Error("Cannot update fields on null state");
      const payload = event.payload as InitiativeFieldUpdatedPayload;
      
      return {
        ...state,
        [payload.field]: payload.newValue,
        updatedAt: now,
        currentVersion: event.sequence,
        eventStreamVersion: event.sequence,
      };
    }
    
    case "InitiativeStatusChanged": {
      if (!state) throw new Error("Cannot change status on null state");
      const payload = event.payload as InitiativeStatusChangedPayload;
      
      // Update status and corresponding timestamp
      const updates: Partial<InitiativeState> = {
        status: payload.newStatus,
        updatedAt: now,
        currentVersion: event.sequence,
        eventStreamVersion: event.sequence,
      };
      
      // Set lifecycle timestamps based on status
      switch (payload.newStatus) {
        case "proposed":
          updates.proposedAt = now;
          break;
        case "approved":
          updates.approvedAt = now;
          break;
        case "in_progress":
          updates.startedAt = now;
          break;
        case "blocked":
          updates.blockedAt = now;
          break;
        case "released":
          updates.releasedAt = now;
          break;
        case "completed":
          updates.completedAt = now;
          break;
        case "cancelled":
          updates.cancelledAt = now;
          break;
        case "archived":
          updates.archivedAt = now;
          break;
      }
      
      return { ...state, ...updates };
    }
    
    case "ReleaseDateChanged": {
      if (!state) throw new Error("Cannot change release date on null state");
      const payload = event.payload as ReleaseDateChangedPayload;
      
      const updates: Partial<InitiativeState> = {
        updatedAt: now,
        currentVersion: event.sequence,
        eventStreamVersion: event.sequence,
      };
      
      switch (payload.dateType) {
        case "target":
          updates.releaseTargetDate = payload.newDate || undefined;
          break;
        case "windowStart":
          updates.releaseWindowStart = payload.newDate || undefined;
          break;
        case "windowEnd":
          updates.releaseWindowEnd = payload.newDate || undefined;
          break;
      }
      
      return { ...state, ...updates };
    }
    
    case "SuggestionApplied":
    case "SuggestionFailed":
    case "SuggestionUndoApplied":
      // These are metadata events that don't modify initiative state directly
      // Field updates are handled by InitiativeFieldUpdated events
      if (!state) throw new Error("Cannot apply suggestion event on null state");
      return {
        ...state,
        currentVersion: event.sequence,
        eventStreamVersion: event.sequence,
      };
    
    default:
      // Unknown event type - skip for forward compatibility
      if (!state) throw new Error(`Cannot apply unknown event ${event.type} on null state`);
      return state;
  }
}

// ============================================
// State Machine Validation
// ============================================

/**
 * Valid state transitions for initiative lifecycle
 */
const VALID_TRANSITIONS: Record<InitiativeStatus, InitiativeStatus[]> = {
  draft: ["proposed"],
  proposed: ["approved", "cancelled"],
  approved: ["in_progress", "cancelled"],
  in_progress: ["blocked", "released", "cancelled"],
  blocked: ["in_progress", "cancelled"],
  released: ["completed", "cancelled"],
  completed: ["archived"],
  cancelled: ["archived"],
  archived: [], // Terminal state
};

/**
 * Validate if a status transition is allowed
 */
export function isValidTransition(
  fromStatus: InitiativeStatus,
  toStatus: InitiativeStatus
): boolean {
  return VALID_TRANSITIONS[fromStatus]?.includes(toStatus) || false;
}

/**
 * Get allowed transitions from current status
 */
export function getAllowedTransitions(status: InitiativeStatus): InitiativeStatus[] {
  return VALID_TRANSITIONS[status] || [];
}

// ============================================
// Canonical State Serialization
// ============================================

/**
 * Convert state to canonical JSON for patching
 * - Stable key ordering
 * - No derived fields
 * - Consistent null vs undefined handling
 */
export function toCanonicalJSON(state: InitiativeState): Record<string, any> {
  return {
    // Sort keys alphabetically for stability
    archivedAt: state.archivedAt || null,
    approvedAt: state.approvedAt || null,
    blockedAt: state.blockedAt || null,
    businessUnit: state.businessUnit || null,
    cancelledAt: state.cancelledAt || null,
    completedAt: state.completedAt || null,
    createdAt: state.createdAt,
    description: state.description,
    goal: state.goal || null,
    integrationHints: state.integrationHints || null,
    ownerUserId: state.ownerUserId || null,
    priority: state.priority || null,
    productArea: state.productArea || null,
    proposedAt: state.proposedAt || null,
    quarter: state.quarter || null,
    releaseNotes: state.releaseNotes || null,
    releaseTargetDate: state.releaseTargetDate || null,
    releaseWindowEnd: state.releaseWindowEnd || null,
    releaseWindowStart: state.releaseWindowStart || null,
    releasedAt: state.releasedAt || null,
    riskLevel: state.riskLevel || null,
    scope: state.scope || null,
    slug: state.slug,
    sponsorUserId: state.sponsorUserId || null,
    startedAt: state.startedAt || null,
    status: state.status,
    successMetrics: state.successMetrics || null,
    tags: state.tags || null,
    teamId: state.teamId || null,
    title: state.title,
    updatedAt: state.updatedAt,
  };
}

/**
 * Get value at JSON Pointer path
 */
export function getAtPath(obj: any, path: string): any {
  if (!path.startsWith("/")) {
    throw new Error("JSON Pointer must start with /");
  }
  
  if (path === "/") {
    return obj;
  }
  
  const keys = path.slice(1).split("/").map(k => k.replace(/~1/g, "/").replace(/~0/g, "~"));
  
  let current = obj;
  for (const key of keys) {
    if (current === null || current === undefined) {
      return undefined;
    }
    current = current[key];
  }
  
  return current;
}

/**
 * Set value at JSON Pointer path
 */
export function setAtPath(obj: any, path: string, value: any): any {
  if (!path.startsWith("/")) {
    throw new Error("JSON Pointer must start with /");
  }
  
  if (path === "/") {
    return value;
  }
  
  const keys = path.slice(1).split("/").map(k => k.replace(/~1/g, "/").replace(/~0/g, "~"));
  const result = { ...obj };
  
  let current = result;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (!(key in current)) {
      current[key] = {};
    } else {
      current[key] = { ...current[key] };
    }
    current = current[key];
  }
  
  const lastKey = keys[keys.length - 1];
  current[lastKey] = value;
  
  return result;
}
