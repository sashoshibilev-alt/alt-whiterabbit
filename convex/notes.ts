import { query, mutation, action, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { api } from "./_generated/api";

// Query to get all notes with suggestion counts
// v0-correct: Excludes soft-deleted notes by default
export const list = query({
  handler: async (ctx) => {
    const notes = await ctx.db
      .query("notes")
      .withIndex("by_isDeleted", (q) => q.eq("isDeleted", undefined))
      .order("desc")
      .collect();
    
    // Get suggestion counts for each note
    const notesWithStats = await Promise.all(
      notes.map(async (note) => {
        // v0-correct: Exclude invalidated suggestions from counts
        const suggestions = await ctx.db
          .query("suggestions")
          .withIndex("by_noteId", (q) => q.eq("noteId", note._id))
          .filter((q) => q.neq(q.field("invalidatedByNoteDeletion"), true))
          .collect();
        
        // v0-correct: Exclude invalidated events from counts
        const events = await ctx.db
          .query("suggestionEvents")
          .withIndex("by_noteId", (q) => q.eq("noteId", note._id))
          .filter((q) => q.neq(q.field("excludeFromMetrics"), true))
          .collect();
        
        const shownEvents = events.filter((e) => e.eventType === "shown");
        
        return {
          ...note,
          totalSuggestions: suggestions.length,
          appliedCount: suggestions.filter((s) => s.status === "applied").length,
          dismissedCount: suggestions.filter((s) => s.status === "dismissed").length,
          shownCount: shownEvents.length,
        };
      })
    );
    
    return notesWithStats;
  },
});

// Query to get a single note by ID
export const get = query({
  args: { id: v.id("notes") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

// Query to get note with all its suggestions
export const getWithSuggestions = query({
  args: { id: v.id("notes") },
  handler: async (ctx, args) => {
    const note = await ctx.db.get(args.id);
    if (!note) return null;

    const suggestions = await ctx.db
      .query("suggestions")
      .withIndex("by_noteId", (q) => q.eq("noteId", args.id))
      .collect();

    return {
      note,
      suggestions,
    };
  },
});

// Action to get note with live computed suggestions from v2 engine
// Returns the note and an array of suggestions computed in real-time from the note body.
// Each suggestion includes a structured `suggestion` context object with:
//   - title: Suggestion title
//   - body: 1-3 line standalone description (max ~300 chars)
//   - evidencePreview?: Array of 1-2 short quotes from the note (max 150 chars each)
//   - sourceSectionId: Section ID for navigation
//   - sourceHeading: Section heading text
// Note: This is an action (not a query) because it needs to import code from src/
export const getWithComputedSuggestions = action({
  args: { id: v.id("notes") },
  handler: async (ctx, args) => {
    // Get note from database
    const note = await ctx.runQuery(api.notes.getInternal, { id: args.id });
    if (!note) return null;

    // Dynamically import suggestion engine (only works in actions)
    const { generateRunResult: generateRunResultImport, adaptConvexNote: adaptConvexNoteImport } = await import("../src/lib/suggestion-engine-v2");

    // Adapt note to engine format
    const engineNote = adaptConvexNoteImport({
      _id: note._id,
      body: note.body,
      createdAt: note.createdAt,
      title: note.title,
    });

    // Run suggestion engine v2 — single source of truth for UI and debug panel
    const runResult = generateRunResultImport(engineNote);

    // Load existing decisions for this note
    const decisions = await ctx.runQuery(api.suggestionDecisions.getByNote, { noteId: args.id });
    const decisionMap = new Map(decisions.map(d => [d.suggestionKey, d]));

    // Transform engine suggestions to UI-ready format.
    // Source: runResult.finalSuggestions (canonical post-threshold, post-dedupe list).
    const uiSuggestions = runResult.finalSuggestions.map((engineSug) => {
      // Map to V0Suggestion-like structure for UI compatibility
      return {
        _id: engineSug.suggestion_id as any, // Use engine ID as UI ID
        noteId: args.id,
        content: engineSug.title,
        status: "new" as const,
        createdAt: Date.now(),
        modelVersion: "v2-engine",
        suggestionFamily: engineSug.type,
        modelConfidenceScore: engineSug.scores.overall,
        // Add the structured suggestion context.
        // Always use engineSug.title (Stage-7 canonical) for the suggestion.title
        // field so the UI renders the final prefixed/contracted title rather than
        // the raw pre-Stage-7 SuggestionContext title.
        suggestion: engineSug.suggestion ? {
          title: engineSug.title,
          body: engineSug.suggestion.body,
          evidencePreview: engineSug.suggestion.evidencePreview,
          sourceSectionId: engineSug.suggestion.sourceSectionId,
          sourceHeading: engineSug.suggestion.sourceHeading,
        } : undefined,
        // Clarification support based on engine flags
        clarificationState: engineSug.needs_clarification ? "suggested" as const : "none" as const,
        clarificationPrompt: engineSug.needs_clarification
          ? `This suggestion has a confidence score of ${engineSug.scores.overall.toFixed(2)}. Consider reviewing the evidence carefully.`
          : undefined,
        // Stable identifier for dedupe and persistence
        suggestionKey: engineSug.suggestionKey,
      };
    });

    // Filter out dismissed and applied suggestions based on decisions
    const filteredSuggestions = uiSuggestions.filter((sug) => {
      const decision = decisionMap.get(sug.suggestionKey);
      // Only show suggestions that haven't been dismissed or applied
      return !decision || (decision.status !== "dismissed" && decision.status !== "applied");
    });

    return {
      note,
      suggestions: filteredSuggestions,
      // The full RunResult — single source of truth for the suggestion list UI.
      // The UI must render cards from runResult.finalSuggestions (after applying decisions),
      // and the "Copy JSON" button must copy this same object.
      runResult: {
        runId: runResult.runId,
        noteId: runResult.noteId,
        createdAt: runResult.createdAt,
        noteHash: runResult.noteHash,
        lineCount: runResult.lineCount,
        finalSuggestions: runResult.finalSuggestions,
        invariants: runResult.invariants,
        config: runResult.config,
      },
    };
  },
});

// Mutation to create a new note
export const create = mutation({
  args: {
    title: v.optional(v.string()),
    body: v.string(),
    meetingAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const noteId = await ctx.db.insert("notes", {
      title: args.title,
      body: args.body,
      source: "manual",
      capturedAt: now,
      meetingAt: args.meetingAt,
      createdAt: now,
      updatedAt: now,
    });
    return noteId;
  },
});

// Mutation to update a note
export const update = mutation({
  args: {
    id: v.id("notes"),
    title: v.optional(v.string()),
    body: v.optional(v.string()),
    meetingAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { id, ...updates } = args;
    const existing = await ctx.db.get(id);
    if (!existing) {
      throw new Error("Note not found");
    }

    await ctx.db.patch(id, {
      ...updates,
      updatedAt: Date.now(),
    });
    return id;
  },
});

// Mutation to soft-delete a note (epistemic hygiene)
// v0-correct: Implements soft deletion with cascading invalidation
// This is about removing bad evidence (tests, irrelevant pastes, pollution)
export const remove = mutation({
  args: { id: v.id("notes") },
  handler: async (ctx, args) => {
    const note = await ctx.db.get(args.id);
    if (!note) {
      throw new Error("Note not found");
    }

    const now = Date.now();

    // Soft-delete the note
    await ctx.db.patch(args.id, {
      isDeleted: true,
      deletedAt: now,
    });

    // Mark all suggestions as invalidated
    const suggestions = await ctx.db
      .query("suggestions")
      .withIndex("by_noteId", (q) => q.eq("noteId", args.id))
      .collect();
    
    for (const suggestion of suggestions) {
      await ctx.db.patch(suggestion._id, {
        invalidatedByNoteDeletion: true,
        invalidatedAt: now,
      });
    }

    // Mark all events as excluded from metrics
    const events = await ctx.db
      .query("suggestionEvents")
      .withIndex("by_noteId", (q) => q.eq("noteId", args.id))
      .collect();
    
    for (const event of events) {
      await ctx.db.patch(event._id, {
        invalidatedByNoteDeletion: true,
        excludeFromMetrics: true,
      });
    }

    return {
      deletedNote: args.id,
      invalidatedSuggestions: suggestions.length,
      invalidatedEvents: events.length,
    };
  },
});

// Mutation to permanently delete a note (use with caution)
// v0-correct: Hard delete for when you really need to purge data
export const permanentlyDelete = mutation({
  args: { id: v.id("notes") },
  handler: async (ctx, args) => {
    // Delete all suggestion events for this note
    const events = await ctx.db
      .query("suggestionEvents")
      .withIndex("by_noteId", (q) => q.eq("noteId", args.id))
      .collect();
    for (const event of events) {
      await ctx.db.delete(event._id);
    }
    
    // Delete all suggestions for this note
    const suggestions = await ctx.db
      .query("suggestions")
      .withIndex("by_noteId", (q) => q.eq("noteId", args.id))
      .collect();
    for (const suggestion of suggestions) {
      await ctx.db.delete(suggestion._id);
    }
    
    // Hard delete the note
    await ctx.db.delete(args.id);
  },
});

// Internal query for actions to use
export const getInternal = internalQuery({
  args: { id: v.id("notes") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});
