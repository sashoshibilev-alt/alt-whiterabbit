/**
 * Initiative Suggestions (Deterministic Patch-Based)
 * 
 * This module implements:
 * - Creating suggestions as JSON Patch operations
 * - Validating suggestions against current state
 * - Applying suggestions deterministically with conflict detection
 * - Dismissing suggestions
 * - Suggestion lifecycle management
 */

import { v } from "convex/values";
import { mutation, query, action, internalMutation } from "./_generated/server";
import { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import {
  InitiativeEvent,
  InitiativeFieldUpdatedPayload,
  toCanonicalJSON,
  getAtPath,
  isValidTransition,
} from "./initiativeEventStore";
import { loadInitiativeState, appendEvents, materializeState } from "./newInitiatives";

// ============================================
// Types
// ============================================

export type PatchOperation = {
  op: "replace" | "add" | "remove";
  path: string; // JSON Pointer
  from?: any; // Expected current value (for conflict detection)
  value?: any; // New value (for replace/add)
};

export type SuggestionPayload = {
  operations: PatchOperation[];
};

export type SuggestionStatus = "pending" | "applied" | "dismissed" | "superseded" | "failed";
export type SuggestionSourceKind = "user" | "system" | "import" | "integration";

// ============================================
// Helper: Generate UUIDs
// ============================================

function generateUUID(): string {
  return crypto.randomUUID();
}

// ============================================
// Command: Create Suggestion
// ============================================

export const create = mutation({
  args: {
    initiativeId: v.id("newInitiatives"),
    createdByUserId: v.string(),
    kind: v.string(), // e.g., "update_fields", "change_status"
    operations: v.any(), // Array of PatchOperation
    sourceKind: v.optional(v.string()), // "user", "system", etc.
    sourceReference: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Verify initiative exists
    const initiative = await ctx.db.get(args.initiativeId);
    if (!initiative) {
      throw new Error("Initiative not found");
    }
    
    // Get current version
    const { state } = await loadInitiativeState(ctx, args.initiativeId);
    
    // Validate operations format
    const operations = args.operations as PatchOperation[];
    for (const op of operations) {
      if (!op.path || !op.path.startsWith("/")) {
        throw new Error("Invalid JSON Pointer path");
      }
      if (op.op === "replace" && op.from === undefined) {
        throw new Error("Replace operation must include 'from' value");
      }
    }
    
    const now = Date.now();
    
    // Create suggestion
    const suggestionId = await ctx.db.insert("initiativeSuggestions", {
      initiativeId: args.initiativeId,
      createdByUserId: args.createdByUserId,
      status: "pending" as SuggestionStatus,
      createdAt: now,
      kind: args.kind,
      targetInitiativeVersion: state.currentVersion,
      inputSchemaVersion: 1,
      payload: {
        operations,
      },
      sourceKind: (args.sourceKind as SuggestionSourceKind) || "user",
      sourceReference: args.sourceReference,
    });
    
    return suggestionId;
  },
});

// ============================================
// Command: Apply Suggestion
// ============================================

export const apply = mutation({
  args: {
    id: v.id("initiativeSuggestions"),
    appliedByUserId: v.string(),
  },
  handler: async (ctx, args) => {
    const commandId = generateUUID();
    const correlationId = generateUUID();
    const now = Date.now();
    
    // Load suggestion
    const suggestion = await ctx.db.get(args.id);
    if (!suggestion) {
      throw new Error("Suggestion not found");
    }
    
    if (suggestion.status !== "pending") {
      throw new Error(`Suggestion status is ${suggestion.status}, expected pending`);
    }
    
    // Load current initiative state
    const { state } = await loadInitiativeState(ctx, suggestion.initiativeId);
    
    // Validate and apply operations
    const payload = suggestion.payload as SuggestionPayload;
    const operations = payload.operations;
    
    // Get canonical state for patching
    const canonical = toCanonicalJSON(state);
    
    // Validate all operations first (fail fast)
    const validationErrors: string[] = [];
    
    for (const op of operations) {
      const currentValue = getAtPath(canonical, op.path);
      
      if (op.op === "replace") {
        // Check if 'from' matches current value
        if (JSON.stringify(currentValue) !== JSON.stringify(op.from)) {
          validationErrors.push(
            `Conflict at ${op.path}: expected ${JSON.stringify(op.from)}, found ${JSON.stringify(currentValue)}`
          );
        }
      }
      
      // Validate status transitions if changing status
      if (op.path === "/status" && op.op === "replace") {
        if (!isValidTransition(state.status, op.value)) {
          validationErrors.push(
            `Invalid status transition: ${state.status} -> ${op.value}`
          );
        }
      }
    }
    
    if (validationErrors.length > 0) {
      // Validation failed - mark suggestion as failed
      await ctx.db.patch(args.id, {
        status: "failed" as SuggestionStatus,
      });
      
      // Create SuggestionFailed event
      const failedEvents: Omit<InitiativeEvent, "id" | "globalSequence" | "sequence">[] = [
        {
          initiativeId: suggestion.initiativeId,
          type: "SuggestionFailed",
          payload: {
            suggestionId: args.id,
            reason: "Conflict detected",
            conflictingFields: operations.map(op => op.path),
          },
          schemaVersion: 1,
          occurredAt: now,
        },
      ];
      
      await appendEvents(ctx, suggestion.initiativeId, failedEvents, {
        commandId,
        correlationId,
        actorUserId: args.appliedByUserId,
        origin: "ui",
        suggestionId: args.id,
      });
      
      throw new Error(`Suggestion validation failed: ${validationErrors.join(", ")}`);
    }
    
    // All validations passed - apply operations
    const events: Omit<InitiativeEvent, "id" | "globalSequence" | "sequence">[] = [];
    const changedFields: string[] = [];
    
    // First, create SuggestionApplied metadata event
    events.push({
      initiativeId: suggestion.initiativeId,
      type: "SuggestionApplied",
      payload: {
        suggestionId: args.id,
        changedFields: operations.map(op => op.path),
      },
      schemaVersion: 1,
      occurredAt: now,
    });
    
    // Then create field update events
    for (const op of operations) {
      const field = op.path.slice(1); // Remove leading '/'
      changedFields.push(field);
      
      if (op.op === "replace") {
        // Handle status change separately
        if (op.path === "/status") {
          events.push({
            initiativeId: suggestion.initiativeId,
            type: "InitiativeStatusChanged",
            payload: {
              oldStatus: state.status,
              newStatus: op.value,
            },
            schemaVersion: 1,
            occurredAt: now,
          });
        } else {
          events.push({
            initiativeId: suggestion.initiativeId,
            type: "InitiativeFieldUpdated",
            payload: {
              field,
              oldValue: op.from,
              newValue: op.value,
            } as InitiativeFieldUpdatedPayload,
            schemaVersion: 1,
            occurredAt: now,
          });
        }
      } else if (op.op === "add") {
        events.push({
          initiativeId: suggestion.initiativeId,
          type: "InitiativeFieldUpdated",
          payload: {
            field,
            oldValue: null,
            newValue: op.value,
          } as InitiativeFieldUpdatedPayload,
          schemaVersion: 1,
          occurredAt: now,
        });
      } else if (op.op === "remove") {
        events.push({
          initiativeId: suggestion.initiativeId,
          type: "InitiativeFieldUpdated",
          payload: {
            field,
            oldValue: getAtPath(canonical, op.path),
            newValue: null,
          } as InitiativeFieldUpdatedPayload,
          schemaVersion: 1,
          occurredAt: now,
        });
      }
    }
    
    // Append events
    await appendEvents(ctx, suggestion.initiativeId, events, {
      commandId,
      correlationId,
      actorUserId: args.appliedByUserId,
      origin: "ui",
      suggestionId: args.id,
    });
    
    // Reload and materialize
    const { state: newState } = await loadInitiativeState(ctx, suggestion.initiativeId);
    await materializeState(ctx, suggestion.initiativeId, newState);
    
    // Update suggestion status
    await ctx.db.patch(args.id, {
      status: "applied" as SuggestionStatus,
      appliedAt: now,
      appliedByUserId: args.appliedByUserId,
      resultingInitiativeVersion: newState.currentVersion,
    });
    
    // Optionally create a system comment
    await ctx.db.insert("initiativeComments", {
      initiativeId: suggestion.initiativeId,
      authorUserId: "system",
      body: `Applied suggestion: ${suggestion.kind}. Changed fields: ${changedFields.join(", ")}`,
      createdAt: now,
      isSystem: true,
    });
    
    return {
      success: true,
      version: newState.currentVersion,
      changedFields,
    };
  },
});

// ============================================
// Command: Dismiss Suggestion
// ============================================

export const dismiss = mutation({
  args: {
    id: v.id("initiativeSuggestions"),
    reason: v.string(),
    dismissedByUserId: v.string(),
  },
  handler: async (ctx, args) => {
    const commandId = generateUUID();
    const correlationId = generateUUID();
    const now = Date.now();
    
    const suggestion = await ctx.db.get(args.id);
    if (!suggestion) {
      throw new Error("Suggestion not found");
    }
    
    if (suggestion.status !== "pending") {
      throw new Error(`Suggestion status is ${suggestion.status}, expected pending`);
    }
    
    // Update suggestion status
    await ctx.db.patch(args.id, {
      status: "dismissed" as SuggestionStatus,
      dismissedAt: now,
      dismissedReason: args.reason,
    });
    
    // Create dismissed event
    const events: Omit<InitiativeEvent, "id" | "globalSequence" | "sequence">[] = [
      {
        initiativeId: suggestion.initiativeId,
        type: "SuggestionDismissed",
        payload: {
          suggestionId: args.id,
          reason: args.reason,
        },
        schemaVersion: 1,
        occurredAt: now,
      },
    ];
    
    await appendEvents(ctx, suggestion.initiativeId, events, {
      commandId,
      correlationId,
      actorUserId: args.dismissedByUserId,
      origin: "ui",
      suggestionId: args.id,
    });
    
    return { success: true };
  },
});

// ============================================
// Query: Get Suggestion
// ============================================

export const get = query({
  args: {
    id: v.id("initiativeSuggestions"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

// ============================================
// Query: List Suggestions for Initiative
// ============================================

export const listByInitiative = query({
  args: {
    initiativeId: v.id("newInitiatives"),
    status: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    let query = ctx.db
      .query("initiativeSuggestions")
      .withIndex("by_initiativeId_status", (q: any) =>
        q.eq("initiativeId", args.initiativeId)
      );
    
    if (args.status) {
      query = query.filter((q: any) => q.eq(q.field("status"), args.status));
    }
    
    return await query.collect();
  },
});

// ============================================
// Query: List All Suggestions
// ============================================

export const list = query({
  args: {
    status: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    let query = ctx.db.query("initiativeSuggestions");
    
    if (args.status) {
      query = query.withIndex("by_status", (q: any) => q.eq("status", args.status));
    }
    
    query = query.order("desc");
    
    if (args.limit) {
      return await query.take(args.limit);
    }
    
    return await query.collect();
  },
});

// ============================================
// Helper: Build Suggestion from Field Changes
// ============================================

/**
 * Helper to create a suggestion payload from simple field changes
 * This is a convenience wrapper for the most common case
 */
export function buildFieldUpdateSuggestion(
  currentState: any,
  fieldChanges: Record<string, any>
): SuggestionPayload {
  const operations: PatchOperation[] = [];
  
  for (const [field, newValue] of Object.entries(fieldChanges)) {
    const path = `/${field}`;
    const currentValue = currentState[field];
    
    operations.push({
      op: "replace",
      path,
      from: currentValue === undefined ? null : currentValue,
      value: newValue === undefined ? null : newValue,
    });
  }
  
  return { operations };
}

// Export for external use
export { buildFieldUpdateSuggestion as buildSuggestionPayload };
