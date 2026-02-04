import { query, mutation, action, internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { generateSuggestionsFromNote, adaptV0Initiative } from "./suggestionEngine";
import { generateSuggestions, adaptConvexNote, adaptConvexInitiative } from "../src/lib/suggestion-engine-v2";

// ============================================
// Suggestion Fingerprinting (v0-correct)
// ============================================

/**
 * Compute a fingerprint for a suggestion to detect duplicates
 * Based on the first 100 chars of normalized content
 */
function computeSuggestionFingerprint(content: string): string {
  const normalized = content
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s]/g, '')
    .trim()
    .substring(0, 100);
  
  // Simple hash (for deduplication, not cryptographic security)
  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return hash.toString(36);
}

const dismissReasonValidator = v.union(
  v.literal("not_relevant"),
  v.literal("incorrect_or_low_quality"),
  v.literal("too_risky_or_disruptive"),
  v.literal("already_done_or_in_progress"),
  v.literal("needs_more_clarification"),
  v.literal("wrong_scope_or_target"),
  v.literal("other")
);

const clarificationStateValidator = v.union(
  v.literal("none"),
  v.literal("suggested"),
  v.literal("requested"),
  v.literal("answered")
);

// Query to get all suggestions for a note
// v0-correct: Excludes invalidated suggestions by default
export const listByNote = query({
  args: { 
    noteId: v.id("notes"),
    includeInvalidated: v.optional(v.boolean()), // Optional: include invalidated suggestions
  },
  handler: async (ctx, args) => {
    let query = ctx.db
      .query("suggestions")
      .withIndex("by_noteId", (q) => q.eq("noteId", args.noteId));
    
    // v0-correct: Exclude invalidated suggestions unless explicitly requested
    if (!args.includeInvalidated) {
      query = query.filter((q) => q.neq(q.field("invalidatedByNoteDeletion"), true));
    }
    
    return await query.collect();
  },
});

// Query to get a single suggestion
export const get = query({
  args: { id: v.id("suggestions") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

// Internal mutation to store suggestions (called from action)
// v0-correct: Now includes fingerprint and note version tracking
export const storeSuggestions = internalMutation({
  args: {
    noteId: v.id("notes"),
    suggestions: v.array(v.string()),
    modelVersion: v.string(),
    regenerated: v.optional(v.boolean()),
    noteVersion: v.optional(v.number()),
    clarificationState: v.optional(clarificationStateValidator),
    clarificationPrompt: v.optional(v.string()),
    modelConfidenceScore: v.optional(v.number()),
    ruleOrPromptId: v.optional(v.string()),
    suggestionFamily: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const ids = [];
    
    for (const content of args.suggestions) {
      const fingerprint = computeSuggestionFingerprint(content);
      
      const id = await ctx.db.insert("suggestions", {
        noteId: args.noteId,
        content,
        status: "new",
        createdAt: now,
        modelVersion: args.modelVersion,
        regenerated: args.regenerated || false,
        noteVersionAtCreation: args.noteVersion,
        fingerprint,
        clarificationState: args.clarificationState || "none",
        clarificationPrompt: args.clarificationPrompt,
        modelConfidenceScore: args.modelConfidenceScore,
        ruleOrPromptId: args.ruleOrPromptId || args.modelVersion,
        suggestionFamily: args.suggestionFamily || "general",
        estimatedDiffSize: "medium", // Default, can be computed based on content
      });
      ids.push(id);
      
      // Log suggestion_generated event
      await ctx.db.insert("suggestionEvents", {
        noteId: args.noteId,
        suggestionId: id,
        eventType: "generated",
        createdAt: now,
        uiSurface: "backend_generation",
        suggestionFamily: args.suggestionFamily || "general",
        ruleOrPromptId: args.ruleOrPromptId || args.modelVersion,
        clarificationState: args.clarificationState || "none",
      });
    }
    
    return ids;
  },
});

// Mutation to apply a suggestion (simple apply without initiative)
export const apply = mutation({
  args: { 
    id: v.id("suggestions"),
  },
  handler: async (ctx, args) => {
    const suggestion = await ctx.db.get(args.id);
    if (!suggestion) {
      throw new Error("Suggestion not found");
    }
    if (suggestion.status !== "new") {
      throw new Error("Suggestion has already been processed");
    }

    const now = Date.now();
    
    // Update suggestion status
    await ctx.db.patch(args.id, {
      status: "applied",
      appliedAt: now,
    });

    // Get the first shown event to calculate time to event
    const shownEvent = await ctx.db
      .query("suggestionEvents")
      .withIndex("by_suggestionId", (q) => q.eq("suggestionId", args.id))
      .filter((q) => q.eq(q.field("eventType"), "shown"))
      .first();

    const timeToEventSeconds = shownEvent 
      ? Math.floor((now - shownEvent.createdAt) / 1000)
      : undefined;

    // Create applied event
    const eventId = await ctx.db.insert("suggestionEvents", {
      noteId: suggestion.noteId,
      suggestionId: args.id,
      eventType: "applied",
      createdAt: now,
      timeToEventSeconds,
      uiSurface: "note_detail_main",
    });

    return eventId;
  },
});

// Mutation to apply a suggestion to an initiative (new or existing)
export const applyToInitiative = mutation({
  args: {
    id: v.id("suggestions"),
    // Either provide an existing initiative ID or create a new one
    initiativeId: v.optional(v.id("v0Initiatives")),
    // Fields for creating a new initiative (only used if initiativeId is not provided)
    newInitiative: v.optional(
      v.object({
        title: v.string(),
        description: v.string(),
      })
    ),
  },
  handler: async (ctx, args) => {
    const suggestion = await ctx.db.get(args.id);
    if (!suggestion) {
      throw new Error("Suggestion not found");
    }
    if (suggestion.status !== "new") {
      throw new Error("Suggestion has already been processed");
    }

    const now = Date.now();
    let finalInitiativeId = args.initiativeId;

    // Create new initiative if needed
    if (!finalInitiativeId && args.newInitiative) {
      // Get the note for reference in the description
      const note = await ctx.db.get(suggestion.noteId);
      
      finalInitiativeId = await ctx.db.insert("v0Initiatives", {
        title: args.newInitiative.title,
        description: args.newInitiative.description,
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
    }

    if (!finalInitiativeId) {
      throw new Error("Must provide either initiativeId or newInitiative");
    }

    // Verify the initiative exists
    const initiative = await ctx.db.get(finalInitiativeId);
    if (!initiative) {
      throw new Error("Initiative not found");
    }

    // Update suggestion status and link to initiative
    await ctx.db.patch(args.id, {
      status: "applied",
      appliedAt: now,
      initiativeId: finalInitiativeId,
    });

    // Get the first shown event to calculate time to event
    const shownEvent = await ctx.db
      .query("suggestionEvents")
      .withIndex("by_suggestionId", (q) => q.eq("suggestionId", args.id))
      .filter((q) => q.eq(q.field("eventType"), "shown"))
      .first();

    const timeToEventSeconds = shownEvent
      ? Math.floor((now - shownEvent.createdAt) / 1000)
      : undefined;

    // Create applied event
    const eventId = await ctx.db.insert("suggestionEvents", {
      noteId: suggestion.noteId,
      suggestionId: args.id,
      eventType: "applied",
      createdAt: now,
      timeToEventSeconds,
      uiSurface: "note_detail_main",
    });

    // Get updated suggestion
    const updatedSuggestion = await ctx.db.get(args.id);

    return {
      eventId,
      suggestion: updatedSuggestion,
      initiative,
    };
  },
});

// Mutation to update time saved for an applied suggestion
export const updateTimeSaved = mutation({
  args: {
    eventId: v.id("suggestionEvents"),
    timeSavedMinutes: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.eventId, {
      selfReportedTimeSavedMinutes: args.timeSavedMinutes,
    });
  },
});

// Mutation to dismiss a suggestion
export const dismiss = mutation({
  args: {
    id: v.id("suggestions"),
    dismissReason: dismissReasonValidator,
    dismissReasonOther: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const suggestion = await ctx.db.get(args.id);
    if (!suggestion) {
      throw new Error("Suggestion not found");
    }
    if (suggestion.status !== "new") {
      throw new Error("Suggestion has already been processed");
    }

    const now = Date.now();
    
    // Update suggestion status
    await ctx.db.patch(args.id, {
      status: "dismissed",
      dismissedAt: now,
      dismissReason: args.dismissReason,
      dismissReasonOther: args.dismissReasonOther,
    });

    // Get the first shown event to calculate time to event
    const shownEvent = await ctx.db
      .query("suggestionEvents")
      .withIndex("by_suggestionId", (q) => q.eq("suggestionId", args.id))
      .filter((q) => q.eq(q.field("eventType"), "shown"))
      .first();

    const timeToEventSeconds = shownEvent 
      ? Math.floor((now - shownEvent.createdAt) / 1000)
      : undefined;

    // Create dismissed event
    await ctx.db.insert("suggestionEvents", {
      noteId: suggestion.noteId,
      suggestionId: args.id,
      eventType: "dismissed",
      createdAt: now,
      timeToEventSeconds,
      dismissReason: args.dismissReason,
      dismissReasonOther: args.dismissReasonOther,
      uiSurface: "note_detail_main",
    });
  },
});

// Mutation to record shown event for a suggestion
export const recordShown = mutation({
  args: {
    suggestionId: v.id("suggestions"),
  },
  handler: async (ctx, args) => {
    const suggestion = await ctx.db.get(args.suggestionId);
    if (!suggestion) {
      throw new Error("Suggestion not found");
    }

    // Check if already shown
    const existingShown = await ctx.db
      .query("suggestionEvents")
      .withIndex("by_suggestionId", (q) => q.eq("suggestionId", args.suggestionId))
      .filter((q) => q.eq(q.field("eventType"), "shown"))
      .first();

    if (existingShown) {
      // Already recorded
      return existingShown._id;
    }

    // Create shown event
    const eventId = await ctx.db.insert("suggestionEvents", {
      noteId: suggestion.noteId,
      suggestionId: args.suggestionId,
      eventType: "shown",
      createdAt: Date.now(),
      uiSurface: "note_detail_main",
      suggestionFamily: suggestion.suggestionFamily,
      ruleOrPromptId: suggestion.ruleOrPromptId,
      clarificationState: suggestion.clarificationState || "none",
    });

    return eventId;
  },
});

// Mutation to request clarification for a suggestion
export const requestClarification = mutation({
  args: {
    suggestionId: v.id("suggestions"),
  },
  handler: async (ctx, args) => {
    const suggestion = await ctx.db.get(args.suggestionId);
    if (!suggestion) {
      throw new Error("Suggestion not found");
    }

    if (suggestion.clarificationState !== "suggested" && suggestion.clarificationState !== "none") {
      throw new Error("Can only request clarification for suggestions in 'suggested' or 'none' state");
    }

    const now = Date.now();

    // Update suggestion state
    await ctx.db.patch(args.suggestionId, {
      clarificationState: "requested",
    });

    // Get first viewed/shown event for time calculation
    const firstViewEvent = await ctx.db
      .query("suggestionEvents")
      .withIndex("by_suggestionId", (q) => q.eq("suggestionId", args.suggestionId))
      .filter((q) => 
        q.or(
          q.eq(q.field("eventType"), "shown"),
          q.eq(q.field("eventType"), "viewed")
        )
      )
      .first();

    const timeToClarificationMs = firstViewEvent
      ? now - firstViewEvent.createdAt
      : undefined;

    // Log clarification_requested event
    const eventId = await ctx.db.insert("suggestionEvents", {
      noteId: suggestion.noteId,
      suggestionId: args.suggestionId,
      eventType: "clarification_requested",
      createdAt: now,
      uiSurface: "note_detail_main",
      suggestionFamily: suggestion.suggestionFamily,
      ruleOrPromptId: suggestion.ruleOrPromptId,
      clarificationState: "requested",
      timeToClarificationMs,
    });

    return eventId;
  },
});

// Mutation to record clarification answer
export const answerClarification = mutation({
  args: {
    suggestionId: v.id("suggestions"),
    clarificationText: v.string(),
  },
  handler: async (ctx, args) => {
    const suggestion = await ctx.db.get(args.suggestionId);
    if (!suggestion) {
      throw new Error("Suggestion not found");
    }

    if (suggestion.clarificationState !== "requested") {
      throw new Error("Can only answer clarification for suggestions in 'requested' state");
    }

    const now = Date.now();

    // Find the clarification_requested event
    const requestEvent = await ctx.db
      .query("suggestionEvents")
      .withIndex("by_suggestionId", (q) => q.eq("suggestionId", args.suggestionId))
      .filter((q) => q.eq(q.field("eventType"), "clarification_requested"))
      .order("desc")
      .first();

    const timeToAnswerMs = requestEvent
      ? now - requestEvent.createdAt
      : undefined;

    // Log clarification_answered event
    const answerEventId = await ctx.db.insert("suggestionEvents", {
      noteId: suggestion.noteId,
      suggestionId: args.suggestionId,
      eventType: "clarification_answered",
      createdAt: now,
      uiSurface: "note_detail_main",
      suggestionFamily: suggestion.suggestionFamily,
      ruleOrPromptId: suggestion.ruleOrPromptId,
      clarificationState: "answered",
      timeToAnswerMs,
    });

    // Update suggestion state
    await ctx.db.patch(args.suggestionId, {
      clarificationState: "answered",
      clarificationAnswerId: answerEventId,
    });

    return answerEventId;
  },
});

// Internal query to get all v0 initiatives for suggestion generation
export const listV0InitiativesInternal = internalQuery({
  handler: async (ctx) => {
    return await ctx.db.query("v0Initiatives").collect();
  },
});

// Action to generate suggestions for a note using the deterministic suggestion engine
// This replaces the previous mock implementation with a rule-based pipeline
export const generate = action({
  args: { noteId: v.id("notes") },
  handler: async (ctx, args) => {
    // Get the note
    const note = await ctx.runQuery(internal.notes.getInternal, { id: args.noteId });
    if (!note) {
      throw new Error("Note not found");
    }

    // Get existing initiatives for context
    const v0Initiatives = await ctx.runQuery(internal.suggestions.listV0InitiativesInternal, {});
    const initiatives = v0Initiatives.map(adaptConvexInitiative);

    // Generate suggestions using the v2 deterministic engine
    // The engine:
    // 1. Segments the note into processable units
    // 2. Detects plan-relevant signals (timeline/priority/ownership changes, new initiatives)
    // 3. Filters out-of-scope content (communication, scheduling, generic hygiene)
    // 4. Classifies signals into mutations or artifacts
    // 5. Validates and deduplicates suggestions
    const noteInput = adaptConvexNote({
      _id: note._id,
      body: note.body,
      createdAt: note.createdAt,
      title: note.title,
    });

    const result = generateSuggestions(
      noteInput,
      { initiatives },
      {
        max_suggestions: 3,
        thresholds: {
          T_overall_min: 0.65,
          T_section_min: 0.6,
        },
      }
    );

    const suggestionContents = result.suggestions.map(s => s.title);

    // If the engine produces no suggestions, return early (this is expected behavior)
    if (suggestionContents.length === 0) {
      return 0;
    }
    
    // Store the suggestions
    await ctx.runMutation(internal.suggestions.storeSuggestions, {
      noteId: args.noteId,
      suggestions: suggestionContents,
      modelVersion: "suggestion-engine-v2.0",
      regenerated: false,
      noteVersion: note.updatedAt,
    });

    return suggestionContents.length;
  },
});

// ============================================
// Regenerate Suggestions (v0-correct)
// ============================================

/**
 * Action to regenerate suggestions for a note
 * This reruns the full suggestion pipeline with current note content and initiatives
 * 
 * Behavioral rules:
 * - Do not resurrect previously dismissed suggestions if note content is unchanged
 * - Mark all new suggestions with regenerated=true
 * - Log a regeneration event for analytics
 */
export const regenerate = action({
  args: { noteId: v.id("notes") },
  handler: async (ctx, args) => {
    // Get the note
    const note = await ctx.runQuery(internal.notes.getInternal, { id: args.noteId });
    if (!note) {
      throw new Error("Note not found");
    }

    // Get existing suggestions for this note (all statuses)
    const existingSuggestions = await ctx.runQuery(internal.suggestions.listAllByNoteInternal, {
      noteId: args.noteId,
    });

    // Get existing initiatives for context
    const v0Initiatives = await ctx.runQuery(internal.suggestions.listV0InitiativesInternal, {});
    const initiatives = v0Initiatives.map(adaptConvexInitiative);

    // Generate fresh suggestions using the v2 deterministic engine
    const noteInput = adaptConvexNote({
      _id: note._id,
      body: note.body,
      createdAt: note.createdAt,
      title: note.title,
    });

    const result = generateSuggestions(
      noteInput,
      { initiatives },
      {
        max_suggestions: 3,
        thresholds: {
          T_overall_min: 0.65,
          T_section_min: 0.6,
        },
      }
    );

    const freshSuggestionContents = result.suggestions.map(s => s.title);

    // Compute fingerprints for fresh suggestions
    const freshFingerprints = freshSuggestionContents.map(computeSuggestionFingerprint);

    // Filter out suggestions that were previously dismissed (if note hasn't changed)
    const previousDismissedFingerprints = new Set<string>();
    const noteVersionChanged = existingSuggestions.some(
      (s) => s.noteVersionAtCreation && s.noteVersionAtCreation !== note.updatedAt
    );

    if (!noteVersionChanged) {
      // Note content hasn't changed since last generation
      // Collect fingerprints of dismissed suggestions to avoid resurrecting them
      for (const existing of existingSuggestions) {
        if (existing.status === "dismissed" && existing.fingerprint) {
          previousDismissedFingerprints.add(existing.fingerprint);
        }
      }
    }

    // Filter fresh suggestions to exclude previously dismissed ones (if note unchanged)
    const suggestionsToStore: string[] = [];
    for (let i = 0; i < freshSuggestionContents.length; i++) {
      const content = freshSuggestionContents[i];
      const fingerprint = freshFingerprints[i];
      
      if (previousDismissedFingerprints.has(fingerprint)) {
        // Skip this suggestion - it was dismissed and note hasn't changed
        continue;
      }
      
      suggestionsToStore.push(content);
    }

    // Count previous new suggestions for comparison
    const previousNewCount = existingSuggestions.filter(s => s.status === "new").length;
    const newCount = suggestionsToStore.length;

    // Store the regenerated suggestions
    if (suggestionsToStore.length > 0) {
      await ctx.runMutation(internal.suggestions.storeSuggestions, {
        noteId: args.noteId,
        suggestions: suggestionsToStore,
        modelVersion: "suggestion-engine-v1.0-regenerate",
        regenerated: true,
        noteVersion: note.updatedAt,
      });
    }

    // Log regeneration event
    await ctx.runMutation(internal.suggestions.logRegenerationEvent, {
      noteId: args.noteId,
      previousSuggestionCount: previousNewCount,
      newSuggestionCount: newCount,
      noteVersionChanged,
    });

    return {
      previousCount: previousNewCount,
      newCount,
      added: newCount - previousNewCount,
      noteChanged: noteVersionChanged,
    };
  },
});

// Internal query to get all suggestions for a note (any status)
export const listAllByNoteInternal = internalQuery({
  args: { noteId: v.id("notes") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("suggestions")
      .withIndex("by_noteId", (q) => q.eq("noteId", args.noteId))
      .collect();
  },
});

// Internal mutation to log regeneration events
export const logRegenerationEvent = internalMutation({
  args: {
    noteId: v.id("notes"),
    previousSuggestionCount: v.number(),
    newSuggestionCount: v.number(),
    noteVersionChanged: v.boolean(),
  },
  handler: async (ctx, args) => {
    // For now, we'll log to suggestionEvents with a special structure
    // In a full implementation, you might want a separate regenerationEvents table
    const now = Date.now();
    
    // Create a synthetic suggestion ID (we don't have a specific suggestion for this event)
    // We'll use the note as reference
    // Actually, for regeneration events, we should store it differently
    // For now, let's just skip creating a suggestionEvents entry and rely on the regenerated flag
    
    // Future: Could add a separate regenerationEvents table with:
    // - noteId, timestamp, previousCount, newCount, noteChanged
  },
});

// ============================================
// Analytics Queries (v0-correct)
// ============================================

/**
 * Query to get suggestion metrics excluding deleted notes
 * v0-correct: Demonstrates proper filtering for epistemic hygiene
 * 
 * This query shows how to compute metrics while respecting deletion semantics.
 * Deleted notes and their suggestions are excluded from default metrics.
 */
export const getMetrics = query({
  args: {
    includeDeleted: v.optional(v.boolean()), // Optional: include deleted notes in metrics
  },
  handler: async (ctx, args) => {
    // Get all suggestions, optionally excluding invalidated ones
    const allSuggestions = await ctx.db.query("suggestions").collect();
    
    // Filter suggestions based on deletion status
    const validSuggestions = args.includeDeleted
      ? allSuggestions
      : allSuggestions.filter(s => !s.invalidatedByNoteDeletion);

    // Get all events, optionally excluding excluded ones
    const allEvents = await ctx.db.query("suggestionEvents").collect();
    
    const validEvents = args.includeDeleted
      ? allEvents
      : allEvents.filter(e => !e.excludeFromMetrics);

    // Compute metrics
    const totalSuggestions = validSuggestions.length;
    const appliedSuggestions = validSuggestions.filter(s => s.status === "applied").length;
    const dismissedSuggestions = validSuggestions.filter(s => s.status === "dismissed").length;
    const newSuggestions = validSuggestions.filter(s => s.status === "new").length;
    const regeneratedSuggestions = validSuggestions.filter(s => s.regenerated).length;

    const shownEvents = validEvents.filter(e => e.eventType === "shown").length;
    const appliedEvents = validEvents.filter(e => e.eventType === "applied").length;
    const dismissedEvents = validEvents.filter(e => e.eventType === "dismissed").length;

    // Calculate rates
    const acceptanceRate = totalSuggestions > 0 
      ? (appliedSuggestions / totalSuggestions) * 100 
      : 0;
    const dismissalRate = totalSuggestions > 0 
      ? (dismissedSuggestions / totalSuggestions) * 100 
      : 0;

    return {
      totalSuggestions,
      appliedSuggestions,
      dismissedSuggestions,
      newSuggestions,
      regeneratedSuggestions,
      acceptanceRate: Math.round(acceptanceRate * 100) / 100,
      dismissalRate: Math.round(dismissalRate * 100) / 100,
      events: {
        shown: shownEvents,
        applied: appliedEvents,
        dismissed: dismissedEvents,
      },
      note: args.includeDeleted 
        ? "Metrics include deleted notes and invalidated suggestions"
        : "Metrics exclude deleted notes and invalidated suggestions (epistemic hygiene)",
    };
  },
});
