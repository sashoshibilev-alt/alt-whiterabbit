/**
 * Initiative Domain Logic (Event-Sourced)
 * 
 * This module implements:
 * - Commands (CreateInitiative, UpdateFields, ChangeStatus, etc.)
 * - Queries (get, list, time-travel reads)
 * - Event appending and idempotency
 * - Materialized view updates
 */

import { v } from "convex/values";
import { mutation, query, internalMutation, internalQuery } from "./_generated/server";
import { Doc, Id } from "./_generated/dataModel";
import {
  InitiativeEvent,
  InitiativeEventType,
  InitiativeState,
  InitiativeStatus,
  EventOrigin,
  Priority,
  RiskLevel,
  foldEvents,
  isValidTransition,
  toCanonicalJSON,
  InitiativeFieldUpdatedPayload,
  InitiativeStatusChangedPayload,
  ReleaseDateChangedPayload,
} from "./initiativeEventStore";

// ============================================
// Helper: Generate UUIDs
// ============================================

function generateUUID(): string {
  return crypto.randomUUID();
}

// ============================================
// Helper: Load Events and Fold to State
// ============================================

async function loadInitiativeState(
  ctx: any,
  initiativeId: Id<"newInitiatives">
): Promise<{ state: InitiativeState; events: any[] }> {
  const events = await ctx.db
    .query("initiativeEvents")
    .withIndex("by_initiativeId_sequence", (q: any) => 
      q.eq("initiativeId", initiativeId)
    )
    .collect();
  
  const state = foldEvents(events);
  if (!state) {
    throw new Error("Initiative has no events");
  }
  
  return { state, events };
}

// ============================================
// Helper: Append Events
// ============================================

async function appendEvents(
  ctx: any,
  initiativeId: Id<"newInitiatives"> | undefined,
  events: Omit<InitiativeEvent, "id" | "globalSequence" | "sequence">[],
  options: {
    commandId: string;
    correlationId: string;
    actorUserId?: string;
    origin: EventOrigin;
    suggestionId?: Id<"initiativeSuggestions">;
  }
): Promise<Id<"initiativeEvents">[]> {
  const eventIds: Id<"initiativeEvents">[] = [];
  
  // Get next global sequence
  const lastGlobalEvent = await ctx.db
    .query("initiativeEvents")
    .withIndex("by_globalSequence")
    .order("desc")
    .first();
  
  let nextGlobalSeq = (lastGlobalEvent?.globalSequence || 0) + 1;
  
  // Get next per-initiative sequence
  let nextSeq = 1;
  if (initiativeId) {
    const lastEvent = await ctx.db
      .query("initiativeEvents")
      .withIndex("by_initiativeId_sequence", (q: any) =>
        q.eq("initiativeId", initiativeId)
      )
      .order("desc")
      .first();
    
    nextSeq = (lastEvent?.sequence || 0) + 1;
  }
  
  // Append events
  for (const event of events) {
    const eventId = await ctx.db.insert("initiativeEvents", {
      initiativeId,
      sequence: nextSeq++,
      globalSequence: nextGlobalSeq++,
      type: event.type,
      payload: event.payload,
      schemaVersion: event.schemaVersion,
      occurredAt: event.occurredAt,
      actorUserId: options.actorUserId,
      origin: options.origin,
      commandId: options.commandId,
      correlationId: options.correlationId,
      suggestionId: options.suggestionId,
    });
    
    eventIds.push(eventId);
  }
  
  return eventIds;
}

// ============================================
// Helper: Update Materialized View
// ============================================

async function materializeState(
  ctx: any,
  initiativeId: Id<"newInitiatives">,
  state: InitiativeState
): Promise<void> {
  await ctx.db.patch(initiativeId, {
    slug: state.slug,
    title: state.title,
    description: state.description,
    status: state.status,
    ownerUserId: state.ownerUserId,
    sponsorUserId: state.sponsorUserId,
    teamId: state.teamId,
    goal: state.goal,
    successMetrics: state.successMetrics,
    scope: state.scope,
    priority: state.priority,
    riskLevel: state.riskLevel,
    tags: state.tags,
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
    proposedAt: state.proposedAt,
    approvedAt: state.approvedAt,
    startedAt: state.startedAt,
    blockedAt: state.blockedAt,
    releasedAt: state.releasedAt,
    completedAt: state.completedAt,
    cancelledAt: state.cancelledAt,
    archivedAt: state.archivedAt,
    releaseTargetDate: state.releaseTargetDate,
    releaseWindowStart: state.releaseWindowStart,
    releaseWindowEnd: state.releaseWindowEnd,
    releaseNotes: state.releaseNotes,
    currentVersion: state.currentVersion,
    eventStreamVersion: state.eventStreamVersion,
    schemaVersion: state.schemaVersion,
    businessUnit: state.businessUnit,
    productArea: state.productArea,
    quarter: state.quarter,
    integrationHints: state.integrationHints,
  });
}

// ============================================
// Command: Create Initiative
// ============================================

export const create = mutation({
  args: {
    slug: v.string(),
    title: v.string(),
    description: v.string(),
    ownerUserId: v.optional(v.string()),
    actorUserId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const commandId = generateUUID();
    const correlationId = generateUUID();
    const now = Date.now();
    
    // Check slug uniqueness
    const existing = await ctx.db
      .query("newInitiatives")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .first();
    
    if (existing) {
      throw new Error(`Initiative with slug "${args.slug}" already exists`);
    }
    
    // Create initiative record (empty shell for ID)
    const initiativeId = await ctx.db.insert("newInitiatives", {
      slug: args.slug,
      title: args.title,
      description: args.description,
      status: "draft" as InitiativeStatus,
      ownerUserId: args.ownerUserId,
      createdAt: now,
      updatedAt: now,
      currentVersion: 0,
      eventStreamVersion: 0,
      schemaVersion: 1,
    });
    
    // Create InitiativeCreated event
    const events: Omit<InitiativeEvent, "id" | "globalSequence" | "sequence">[] = [
      {
        initiativeId,
        type: "InitiativeCreated",
        payload: {
          slug: args.slug,
          title: args.title,
          description: args.description,
          ownerUserId: args.ownerUserId,
          status: "draft",
        },
        schemaVersion: 1,
        occurredAt: now,
      },
    ];
    
    // Append events
    await appendEvents(ctx, initiativeId, events, {
      commandId,
      correlationId,
      actorUserId: args.actorUserId,
      origin: "ui",
    });
    
    // Reload state and materialize
    const { state } = await loadInitiativeState(ctx, initiativeId);
    await materializeState(ctx, initiativeId, state);
    
    return initiativeId;
  },
});

// ============================================
// Command: Update Initiative Fields
// ============================================

export const updateFields = mutation({
  args: {
    id: v.id("newInitiatives"),
    fields: v.any(), // Map of field -> value
    actorUserId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const commandId = generateUUID();
    const correlationId = generateUUID();
    const now = Date.now();
    
    // Load current state
    const { state } = await loadInitiativeState(ctx, args.id);
    
    // Build field update events
    const events: Omit<InitiativeEvent, "id" | "globalSequence" | "sequence">[] = [];
    
    for (const [field, newValue] of Object.entries(args.fields)) {
      const oldValue = (state as any)[field];
      
      // Skip if no change
      if (JSON.stringify(oldValue) === JSON.stringify(newValue)) {
        continue;
      }
      
      events.push({
        initiativeId: args.id,
        type: "InitiativeFieldUpdated",
        payload: {
          field,
          oldValue: oldValue === undefined ? null : oldValue,
          newValue: newValue === undefined ? null : newValue,
        } as InitiativeFieldUpdatedPayload,
        schemaVersion: 1,
        occurredAt: now,
      });
    }
    
    if (events.length === 0) {
      // No actual changes
      return { changed: false, version: state.currentVersion };
    }
    
    // Append events
    await appendEvents(ctx, args.id, events, {
      commandId,
      correlationId,
      actorUserId: args.actorUserId,
      origin: "ui",
    });
    
    // Reload and materialize
    const { state: newState } = await loadInitiativeState(ctx, args.id);
    await materializeState(ctx, args.id, newState);
    
    return { changed: true, version: newState.currentVersion };
  },
});

// ============================================
// Command: Change Initiative Status
// ============================================

export const changeStatus = mutation({
  args: {
    id: v.id("newInitiatives"),
    newStatus: v.string(), // InitiativeStatus
    reason: v.optional(v.string()),
    actorUserId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const commandId = generateUUID();
    const correlationId = generateUUID();
    const now = Date.now();
    
    // Load current state
    const { state } = await loadInitiativeState(ctx, args.id);
    
    // Validate transition
    const newStatus = args.newStatus as InitiativeStatus;
    if (!isValidTransition(state.status, newStatus)) {
      throw new Error(
        `Invalid status transition: ${state.status} -> ${newStatus}`
      );
    }
    
    // Create status change event
    const events: Omit<InitiativeEvent, "id" | "globalSequence" | "sequence">[] = [
      {
        initiativeId: args.id,
        type: "InitiativeStatusChanged",
        payload: {
          oldStatus: state.status,
          newStatus,
          reason: args.reason,
        } as InitiativeStatusChangedPayload,
        schemaVersion: 1,
        occurredAt: now,
      },
    ];
    
    // Append events
    await appendEvents(ctx, args.id, events, {
      commandId,
      correlationId,
      actorUserId: args.actorUserId,
      origin: "ui",
    });
    
    // Reload and materialize
    const { state: newState } = await loadInitiativeState(ctx, args.id);
    await materializeState(ctx, args.id, newState);
    
    return { version: newState.currentVersion, status: newState.status };
  },
});

// ============================================
// Command: Update Release Date
// ============================================

export const updateReleaseDate = mutation({
  args: {
    id: v.id("newInitiatives"),
    dateType: v.union(v.literal("target"), v.literal("windowStart"), v.literal("windowEnd")),
    newDate: v.optional(v.number()),
    actorUserId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const commandId = generateUUID();
    const correlationId = generateUUID();
    const now = Date.now();
    
    // Load current state
    const { state } = await loadInitiativeState(ctx, args.id);
    
    // Get old date
    let oldDate: number | null = null;
    if (args.dateType === "target") {
      oldDate = state.releaseTargetDate || null;
    } else if (args.dateType === "windowStart") {
      oldDate = state.releaseWindowStart || null;
    } else {
      oldDate = state.releaseWindowEnd || null;
    }
    
    const newDate = args.newDate || null;
    
    // Skip if no change
    if (oldDate === newDate) {
      return { changed: false, version: state.currentVersion };
    }
    
    // Create release date change event
    const events: Omit<InitiativeEvent, "id" | "globalSequence" | "sequence">[] = [
      {
        initiativeId: args.id,
        type: "ReleaseDateChanged",
        payload: {
          oldDate,
          newDate,
          dateType: args.dateType,
        } as ReleaseDateChangedPayload,
        schemaVersion: 1,
        occurredAt: now,
      },
    ];
    
    // Append events
    await appendEvents(ctx, args.id, events, {
      commandId,
      correlationId,
      actorUserId: args.actorUserId,
      origin: "ui",
    });
    
    // Reload and materialize
    const { state: newState } = await loadInitiativeState(ctx, args.id);
    await materializeState(ctx, args.id, newState);
    
    return { changed: true, version: newState.currentVersion };
  },
});

// ============================================
// Query: Get Initiative
// ============================================

export const get = query({
  args: {
    id: v.id("newInitiatives"),
    asOfVersion: v.optional(v.number()), // Time-travel read
  },
  handler: async (ctx, args) => {
    if (args.asOfVersion !== undefined) {
      // Time-travel read: fold events up to version
      const events = await ctx.db
        .query("initiativeEvents")
        .withIndex("by_initiativeId_sequence", (q) =>
          q.eq("initiativeId", args.id)
        )
        .filter((q) => q.lte(q.field("sequence"), args.asOfVersion!))
        .collect();
      
      const state = foldEvents(events);
      return state ? { ...state, id: args.id } : null;
    }
    
    // Current state: read from materialized view
    return await ctx.db.get(args.id);
  },
});

// ============================================
// Query: List Initiatives
// ============================================

export const list = query({
  args: {
    status: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    let query = ctx.db.query("newInitiatives");
    
    if (args.status) {
      query = query.withIndex("by_status", (q) =>
        q.eq("status", args.status as any)
      );
    }
    
    query = query.order("desc");
    
    if (args.limit) {
      return await query.take(args.limit);
    }
    
    return await query.collect();
  },
});

// ============================================
// Query: Get Initiative Events
// ============================================

export const getEvents = query({
  args: {
    id: v.id("newInitiatives"),
    fromSequence: v.optional(v.number()),
    toSequence: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    let query = ctx.db
      .query("initiativeEvents")
      .withIndex("by_initiativeId_sequence", (q) =>
        q.eq("initiativeId", args.id)
      );
    
    if (args.fromSequence !== undefined) {
      query = query.filter((q) => q.gte(q.field("sequence"), args.fromSequence!));
    }
    
    if (args.toSequence !== undefined) {
      query = query.filter((q) => q.lte(q.field("sequence"), args.toSequence!));
    }
    
    return await query.collect();
  },
});

// ============================================
// Internal: Check Command Idempotency
// ============================================

export const checkCommandIdempotency = internalQuery({
  args: {
    commandId: v.string(),
  },
  handler: async (ctx, args) => {
    const existingEvent = await ctx.db
      .query("initiativeEvents")
      .withIndex("by_commandId", (q) => q.eq("commandId", args.commandId))
      .first();
    
    return existingEvent ? { exists: true, eventId: existingEvent._id } : { exists: false };
  },
});

// Export helper for use in suggestion engine
export { appendEvents, loadInitiativeState, materializeState };
