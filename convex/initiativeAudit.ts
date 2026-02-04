/**
 * Initiative Audit & Undo
 * 
 * This module implements:
 * - Undo operations via compensating events
 * - Audit trail queries
 * - History and diff APIs
 * - Time-travel queries
 */

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { Id } from "./_generated/dataModel";
import {
  InitiativeEvent,
  InitiativeFieldUpdatedPayload,
  foldEvents,
} from "./initiativeEventStore";
import { loadInitiativeState, appendEvents, materializeState } from "./newInitiatives";

// ============================================
// Helper: Generate UUIDs
// ============================================

function generateUUID(): string {
  return crypto.randomUUID();
}

// ============================================
// Command: Undo Event
// ============================================

export const undoEvent = mutation({
  args: {
    eventId: v.id("initiativeEvents"),
    actorUserId: v.string(),
  },
  handler: async (ctx, args) => {
    const commandId = generateUUID();
    const correlationId = generateUUID();
    const now = Date.now();
    
    // Load the event to undo
    const eventToUndo = await ctx.db.get(args.eventId);
    if (!eventToUndo) {
      throw new Error("Event not found");
    }
    
    if (!eventToUndo.initiativeId) {
      throw new Error("Cannot undo system-wide event");
    }
    
    // Check if already undone
    const existingUndo = await ctx.db
      .query("initiativeEvents")
      .withIndex("by_initiativeId_sequence", (q) =>
        q.eq("initiativeId", eventToUndo.initiativeId!)
      )
      .filter((q) => {
        const payload = q.field("payload") as any;
        return q.eq(payload.undoOfEventId, args.eventId);
      })
      .first();
    
    if (existingUndo) {
      throw new Error("Event has already been undone");
    }
    
    // Create compensating events based on event type
    const compensatingEvents: Omit<InitiativeEvent, "id" | "globalSequence" | "sequence">[] = [];
    
    if (eventToUndo.type === "InitiativeFieldUpdated") {
      const payload = eventToUndo.payload as InitiativeFieldUpdatedPayload;
      
      // Reverse the field update
      compensatingEvents.push({
        initiativeId: eventToUndo.initiativeId,
        type: "InitiativeFieldUpdated",
        payload: {
          field: payload.field,
          oldValue: payload.newValue, // Swap old and new
          newValue: payload.oldValue,
          undoOfEventId: args.eventId,
        } as InitiativeFieldUpdatedPayload,
        schemaVersion: 1,
        occurredAt: now,
      });
    } else if (eventToUndo.type === "InitiativeStatusChanged") {
      const payload = eventToUndo.payload as any;
      
      compensatingEvents.push({
        initiativeId: eventToUndo.initiativeId,
        type: "InitiativeStatusChanged",
        payload: {
          oldStatus: payload.newStatus, // Swap
          newStatus: payload.oldStatus,
          reason: `Undo of status change`,
        },
        schemaVersion: 1,
        occurredAt: now,
      });
    } else if (eventToUndo.type === "ReleaseDateChanged") {
      const payload = eventToUndo.payload as any;
      
      compensatingEvents.push({
        initiativeId: eventToUndo.initiativeId,
        type: "ReleaseDateChanged",
        payload: {
          oldDate: payload.newDate, // Swap
          newDate: payload.oldDate,
          dateType: payload.dateType,
        },
        schemaVersion: 1,
        occurredAt: now,
      });
    } else {
      throw new Error(`Cannot undo event type: ${eventToUndo.type}`);
    }
    
    // Append compensating events
    await appendEvents(ctx, eventToUndo.initiativeId, compensatingEvents, {
      commandId,
      correlationId,
      actorUserId: args.actorUserId,
      origin: "ui",
    });
    
    // Reload and materialize
    const { state } = await loadInitiativeState(ctx, eventToUndo.initiativeId);
    await materializeState(ctx, eventToUndo.initiativeId, state);
    
    return {
      success: true,
      version: state.currentVersion,
    };
  },
});

// ============================================
// Command: Undo Suggestion
// ============================================

export const undoSuggestion = mutation({
  args: {
    suggestionId: v.id("initiativeSuggestions"),
    actorUserId: v.string(),
  },
  handler: async (ctx, args) => {
    const commandId = generateUUID();
    const correlationId = generateUUID();
    const now = Date.now();
    
    // Load suggestion
    const suggestion = await ctx.db.get(args.suggestionId);
    if (!suggestion) {
      throw new Error("Suggestion not found");
    }
    
    if (suggestion.status !== "applied") {
      throw new Error("Can only undo applied suggestions");
    }
    
    // Find all events created by this suggestion
    const suggestionEvents = await ctx.db
      .query("initiativeEvents")
      .withIndex("by_suggestionId", (q) => q.eq("suggestionId", args.suggestionId))
      .collect();
    
    if (suggestionEvents.length === 0) {
      throw new Error("No events found for this suggestion");
    }
    
    // Create compensating events in reverse order
    const compensatingEvents: Omit<InitiativeEvent, "id" | "globalSequence" | "sequence">[] = [];
    
    // Skip metadata events (SuggestionApplied), only undo field changes
    const fieldEvents = suggestionEvents.filter(
      e => e.type === "InitiativeFieldUpdated" || 
           e.type === "InitiativeStatusChanged" ||
           e.type === "ReleaseDateChanged"
    );
    
    // Process in reverse order
    for (let i = fieldEvents.length - 1; i >= 0; i--) {
      const event = fieldEvents[i];
      
      if (event.type === "InitiativeFieldUpdated") {
        const payload = event.payload as InitiativeFieldUpdatedPayload;
        compensatingEvents.push({
          initiativeId: event.initiativeId!,
          type: "InitiativeFieldUpdated",
          payload: {
            field: payload.field,
            oldValue: payload.newValue,
            newValue: payload.oldValue,
            undoOfEventId: event._id,
          } as InitiativeFieldUpdatedPayload,
          schemaVersion: 1,
          occurredAt: now,
        });
      } else if (event.type === "InitiativeStatusChanged") {
        const payload = event.payload as any;
        compensatingEvents.push({
          initiativeId: event.initiativeId!,
          type: "InitiativeStatusChanged",
          payload: {
            oldStatus: payload.newStatus,
            newStatus: payload.oldStatus,
            reason: "Undo of suggestion",
          },
          schemaVersion: 1,
          occurredAt: now,
        });
      } else if (event.type === "ReleaseDateChanged") {
        const payload = event.payload as any;
        compensatingEvents.push({
          initiativeId: event.initiativeId!,
          type: "ReleaseDateChanged",
          payload: {
            oldDate: payload.newDate,
            newDate: payload.oldDate,
            dateType: payload.dateType,
          },
          schemaVersion: 1,
          occurredAt: now,
        });
      }
    }
    
    // Add undo applied event
    compensatingEvents.unshift({
      initiativeId: suggestion.initiativeId,
      type: "SuggestionUndoApplied",
      payload: {
        suggestionId: args.suggestionId,
      },
      schemaVersion: 1,
      occurredAt: now,
    });
    
    // Append compensating events
    await appendEvents(ctx, suggestion.initiativeId, compensatingEvents, {
      commandId,
      correlationId,
      actorUserId: args.actorUserId,
      origin: "ui",
      suggestionId: args.suggestionId,
    });
    
    // Reload and materialize
    const { state } = await loadInitiativeState(ctx, suggestion.initiativeId);
    await materializeState(ctx, suggestion.initiativeId, state);
    
    // Update suggestion status (could add "undone" status, but keeping "applied" for now)
    // In a full implementation, you might track undo separately
    
    // Add system comment
    await ctx.db.insert("initiativeComments", {
      initiativeId: suggestion.initiativeId,
      authorUserId: "system",
      body: `Undid suggestion: ${suggestion.kind}`,
      createdAt: now,
      isSystem: true,
    });
    
    return {
      success: true,
      version: state.currentVersion,
    };
  },
});

// ============================================
// Query: Get Audit Trail
// ============================================

export const getAuditTrail = query({
  args: {
    initiativeId: v.id("newInitiatives"),
    fromTimestamp: v.optional(v.number()),
    toTimestamp: v.optional(v.number()),
    eventTypes: v.optional(v.array(v.string())),
    actorUserId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    let events = await ctx.db
      .query("initiativeEvents")
      .withIndex("by_initiativeId_sequence", (q) =>
        q.eq("initiativeId", args.initiativeId)
      )
      .collect();
    
    // Filter by timestamp
    if (args.fromTimestamp) {
      events = events.filter(e => e.occurredAt >= args.fromTimestamp!);
    }
    if (args.toTimestamp) {
      events = events.filter(e => e.occurredAt <= args.toTimestamp!);
    }
    
    // Filter by event type
    if (args.eventTypes && args.eventTypes.length > 0) {
      events = events.filter(e => args.eventTypes!.includes(e.type));
    }
    
    // Filter by actor
    if (args.actorUserId) {
      events = events.filter(e => e.actorUserId === args.actorUserId);
    }
    
    return events;
  },
});

// ============================================
// Query: Get Field History
// ============================================

export const getFieldHistory = query({
  args: {
    initiativeId: v.id("newInitiatives"),
    field: v.string(),
  },
  handler: async (ctx, args) => {
    const events = await ctx.db
      .query("initiativeEvents")
      .withIndex("by_initiativeId_sequence", (q) =>
        q.eq("initiativeId", args.initiativeId)
      )
      .filter((q) => q.eq(q.field("type"), "InitiativeFieldUpdated"))
      .collect();
    
    // Filter to just this field
    const fieldEvents = events.filter(e => {
      const payload = e.payload as InitiativeFieldUpdatedPayload;
      return payload.field === args.field;
    });
    
    // Build history
    const history = fieldEvents.map(e => {
      const payload = e.payload as InitiativeFieldUpdatedPayload;
      return {
        eventId: e._id,
        sequence: e.sequence,
        timestamp: e.occurredAt,
        actorUserId: e.actorUserId,
        oldValue: payload.oldValue,
        newValue: payload.newValue,
        undoOfEventId: payload.undoOfEventId,
      };
    });
    
    return history;
  },
});

// ============================================
// Query: Get Version Diff
// ============================================

export const getVersionDiff = query({
  args: {
    initiativeId: v.id("newInitiatives"),
    fromVersion: v.number(),
    toVersion: v.number(),
  },
  handler: async (ctx, args) => {
    // Load events for both versions
    const allEvents = await ctx.db
      .query("initiativeEvents")
      .withIndex("by_initiativeId_sequence", (q) =>
        q.eq("initiativeId", args.initiativeId)
      )
      .collect();
    
    const fromEvents = allEvents.filter(e => e.sequence <= args.fromVersion);
    const toEvents = allEvents.filter(e => e.sequence <= args.toVersion);
    
    const fromState = foldEvents(fromEvents);
    const toState = foldEvents(toEvents);
    
    if (!fromState || !toState) {
      throw new Error("Could not reconstruct state for requested versions");
    }
    
    // Compute diff
    const diff: Record<string, { from: any; to: any }> = {};
    
    const allKeys = new Set([
      ...Object.keys(fromState),
      ...Object.keys(toState),
    ]);
    
    for (const key of allKeys) {
      const fromValue = (fromState as any)[key];
      const toValue = (toState as any)[key];
      
      if (JSON.stringify(fromValue) !== JSON.stringify(toValue)) {
        diff[key] = { from: fromValue, to: toValue };
      }
    }
    
    return {
      fromVersion: args.fromVersion,
      toVersion: args.toVersion,
      diff,
      eventsBetween: allEvents.filter(
        e => e.sequence > args.fromVersion && e.sequence <= args.toVersion
      ),
    };
  },
});

// ============================================
// Query: Get State at Time
// ============================================

export const getStateAtTime = query({
  args: {
    initiativeId: v.id("newInitiatives"),
    timestamp: v.number(),
  },
  handler: async (ctx, args) => {
    // Load all events up to timestamp
    const events = await ctx.db
      .query("initiativeEvents")
      .withIndex("by_initiativeId_sequence", (q) =>
        q.eq("initiativeId", args.initiativeId)
      )
      .filter((q) => q.lte(q.field("occurredAt"), args.timestamp))
      .collect();
    
    const state = foldEvents(events);
    
    return state ? { ...state, id: args.initiativeId } : null;
  },
});

// ============================================
// Query: Get Who Changed What
// ============================================

export const getWhoChangedWhat = query({
  args: {
    initiativeId: v.id("newInitiatives"),
  },
  handler: async (ctx, args) => {
    const events = await ctx.db
      .query("initiativeEvents")
      .withIndex("by_initiativeId_sequence", (q) =>
        q.eq("initiativeId", args.initiativeId)
      )
      .collect();
    
    // Aggregate changes by actor and field
    const changesByActor: Record<string, {
      totalChanges: number;
      fieldChanges: Record<string, number>;
      lastChangeAt: number;
    }> = {};
    
    for (const event of events) {
      const actor = event.actorUserId || "system";
      
      if (!changesByActor[actor]) {
        changesByActor[actor] = {
          totalChanges: 0,
          fieldChanges: {},
          lastChangeAt: 0,
        };
      }
      
      changesByActor[actor].totalChanges++;
      changesByActor[actor].lastChangeAt = Math.max(
        changesByActor[actor].lastChangeAt,
        event.occurredAt
      );
      
      if (event.type === "InitiativeFieldUpdated") {
        const payload = event.payload as InitiativeFieldUpdatedPayload;
        const field = payload.field;
        changesByActor[actor].fieldChanges[field] = 
          (changesByActor[actor].fieldChanges[field] || 0) + 1;
      }
    }
    
    return changesByActor;
  },
});

// ============================================
// Query: Get Suggestion Impact
// ============================================

export const getSuggestionImpact = query({
  args: {
    suggestionId: v.id("initiativeSuggestions"),
  },
  handler: async (ctx, args) => {
    const suggestion = await ctx.db.get(args.suggestionId);
    if (!suggestion) {
      throw new Error("Suggestion not found");
    }
    
    // Get events from this suggestion
    const events = await ctx.db
      .query("initiativeEvents")
      .withIndex("by_suggestionId", (q) => q.eq("suggestionId", args.suggestionId))
      .collect();
    
    // Extract changed fields and values
    const changes: Array<{
      field: string;
      oldValue: any;
      newValue: any;
      eventType: string;
    }> = [];
    
    for (const event of events) {
      if (event.type === "InitiativeFieldUpdated") {
        const payload = event.payload as InitiativeFieldUpdatedPayload;
        changes.push({
          field: payload.field,
          oldValue: payload.oldValue,
          newValue: payload.newValue,
          eventType: event.type,
        });
      } else if (event.type === "InitiativeStatusChanged") {
        const payload = event.payload as any;
        changes.push({
          field: "status",
          oldValue: payload.oldStatus,
          newValue: payload.newStatus,
          eventType: event.type,
        });
      }
    }
    
    return {
      suggestionId: args.suggestionId,
      status: suggestion.status,
      appliedAt: suggestion.appliedAt,
      changes,
      eventCount: events.length,
    };
  },
});
