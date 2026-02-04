import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

const v0InitiativeStatusValidator = v.union(
  v.literal("draft"),
  v.literal("active"),
  v.literal("done")
);

// Query to get all v0 initiatives
export const list = query({
  handler: async (ctx) => {
    return await ctx.db
      .query("v0Initiatives")
      .order("desc")
      .collect();
  },
});

// Query to get active initiatives (for dropdown selection)
export const listActive = query({
  handler: async (ctx) => {
    const allInitiatives = await ctx.db
      .query("v0Initiatives")
      .collect();
    // Return draft and active initiatives (not done)
    return allInitiatives.filter(
      (i) => i.status === "draft" || i.status === "active"
    );
  },
});

// Query to get a single initiative by ID
export const get = query({
  args: { id: v.id("v0Initiatives") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

// Query to get initiative with linked suggestions
export const getWithSuggestions = query({
  args: { id: v.id("v0Initiatives") },
  handler: async (ctx, args) => {
    const initiative = await ctx.db.get(args.id);
    if (!initiative) {
      return null;
    }

    // Get all suggestions linked to this initiative
    const suggestions = await ctx.db
      .query("suggestions")
      .withIndex("by_initiativeId", (q) => q.eq("initiativeId", args.id))
      .collect();

    // Get notes for each suggestion
    const suggestionsWithNotes = await Promise.all(
      suggestions.map(async (suggestion) => {
        const note = await ctx.db.get(suggestion.noteId);
        return {
          ...suggestion,
          note: note
            ? {
                _id: note._id,
                title: note.title,
                body: note.body.slice(0, 200) + (note.body.length > 200 ? "..." : ""),
              }
            : null,
        };
      })
    );

    return {
      initiative,
      suggestions: suggestionsWithNotes,
    };
  },
});

// Mutation to create a new initiative
export const create = mutation({
  args: {
    title: v.string(),
    description: v.string(),
    status: v.optional(v0InitiativeStatusValidator),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const initiativeId = await ctx.db.insert("v0Initiatives", {
      title: args.title,
      description: args.description,
      status: args.status || "active",
      createdAt: now,
      updatedAt: now,
    });
    return initiativeId;
  },
});

// Mutation to update an initiative
export const update = mutation({
  args: {
    id: v.id("v0Initiatives"),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    status: v.optional(v0InitiativeStatusValidator),
  },
  handler: async (ctx, args) => {
    const { id, ...updates } = args;
    const existing = await ctx.db.get(id);
    if (!existing) {
      throw new Error("Initiative not found");
    }

    const updateData: Record<string, unknown> = {
      updatedAt: Date.now(),
    };

    if (updates.title !== undefined) updateData.title = updates.title;
    if (updates.description !== undefined) updateData.description = updates.description;
    if (updates.status !== undefined) updateData.status = updates.status;

    await ctx.db.patch(id, updateData);
    return id;
  },
});

// Mutation to delete an initiative
export const remove = mutation({
  args: { id: v.id("v0Initiatives") },
  handler: async (ctx, args) => {
    // Unlink any suggestions from this initiative first
    const linkedSuggestions = await ctx.db
      .query("suggestions")
      .withIndex("by_initiativeId", (q) => q.eq("initiativeId", args.id))
      .collect();

    for (const suggestion of linkedSuggestions) {
      await ctx.db.patch(suggestion._id, { initiativeId: undefined });
    }

    await ctx.db.delete(args.id);
  },
});
