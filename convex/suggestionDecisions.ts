import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

/**
 * Suggestion Decisions Module
 *
 * Manages persistent user decisions (dismiss/apply) for suggestions.
 * Keyed by (noteId, suggestionKey) to remain stable across regenerations.
 */

// Query to get all decisions for a note
export const getByNote = query({
  args: { noteId: v.id("notes") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("suggestionDecisions")
      .withIndex("by_noteId", (q) => q.eq("noteId", args.noteId))
      .collect();
  },
});

// Mutation to dismiss a suggestion
export const dismissSuggestion = mutation({
  args: {
    noteId: v.id("notes"),
    suggestionKey: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // Check if decision already exists
    const existing = await ctx.db
      .query("suggestionDecisions")
      .withIndex("by_noteId_suggestionKey", (q) =>
        q.eq("noteId", args.noteId).eq("suggestionKey", args.suggestionKey)
      )
      .first();

    if (existing) {
      // Update existing decision
      await ctx.db.patch(existing._id, {
        status: "dismissed",
        dismissedAt: now,
        appliedAt: undefined,
        initiativeId: undefined,
        appliedMode: undefined,
        updatedAt: now,
      });
      return existing._id;
    } else {
      // Create new decision
      return await ctx.db.insert("suggestionDecisions", {
        noteId: args.noteId,
        suggestionKey: args.suggestionKey,
        status: "dismissed",
        dismissedAt: now,
        updatedAt: now,
      });
    }
  },
});

// Mutation to apply a suggestion to an existing initiative
export const applySuggestionToExisting = mutation({
  args: {
    noteId: v.id("notes"),
    suggestionKey: v.string(),
    initiativeId: v.id("v0Initiatives"),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // Verify initiative exists
    const initiative = await ctx.db.get(args.initiativeId);
    if (!initiative) {
      throw new Error("Initiative not found");
    }

    // Check if decision already exists
    const existing = await ctx.db
      .query("suggestionDecisions")
      .withIndex("by_noteId_suggestionKey", (q) =>
        q.eq("noteId", args.noteId).eq("suggestionKey", args.suggestionKey)
      )
      .first();

    if (existing) {
      // Update existing decision
      await ctx.db.patch(existing._id, {
        status: "applied",
        appliedAt: now,
        dismissedAt: undefined,
        initiativeId: args.initiativeId,
        appliedMode: "existing",
        appliedToInitiativeId: args.initiativeId,
        appliedToType: "existing",
        updatedAt: now,
      });
      return { decisionId: existing._id, initiative };
    } else {
      // Create new decision
      const decisionId = await ctx.db.insert("suggestionDecisions", {
        noteId: args.noteId,
        suggestionKey: args.suggestionKey,
        status: "applied",
        appliedAt: now,
        initiativeId: args.initiativeId,
        appliedMode: "existing",
        appliedToInitiativeId: args.initiativeId,
        appliedToType: "existing",
        updatedAt: now,
      });
      return { decisionId, initiative };
    }
  },
});

// Mutation to apply a suggestion by creating a new initiative
export const applySuggestionCreateNew = mutation({
  args: {
    noteId: v.id("notes"),
    suggestionKey: v.string(),
    title: v.string(),
    description: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    // Create the new initiative
    const initiativeId = await ctx.db.insert("v0Initiatives", {
      title: args.title,
      description: args.description,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });

    const initiative = await ctx.db.get(initiativeId);
    if (!initiative) {
      throw new Error("Failed to create initiative");
    }

    // Check if decision already exists
    const existing = await ctx.db
      .query("suggestionDecisions")
      .withIndex("by_noteId_suggestionKey", (q) =>
        q.eq("noteId", args.noteId).eq("suggestionKey", args.suggestionKey)
      )
      .first();

    if (existing) {
      // Update existing decision
      await ctx.db.patch(existing._id, {
        status: "applied",
        appliedAt: now,
        dismissedAt: undefined,
        initiativeId,
        appliedMode: "created",
        appliedToInitiativeId: initiativeId,
        appliedToType: "new",
        updatedAt: now,
      });
      return { decisionId: existing._id, initiative };
    } else {
      // Create new decision
      const decisionId = await ctx.db.insert("suggestionDecisions", {
        noteId: args.noteId,
        suggestionKey: args.suggestionKey,
        status: "applied",
        appliedAt: now,
        initiativeId,
        appliedMode: "created",
        appliedToInitiativeId: initiativeId,
        appliedToType: "new",
        updatedAt: now,
      });
      return { decisionId, initiative };
    }
  },
});
