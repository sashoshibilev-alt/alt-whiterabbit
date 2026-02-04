import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

// Query to get all initiatives
export const list = query({
  handler: async (ctx) => {
    return await ctx.db.query("initiatives").collect();
  },
});

// Query to get a single initiative by ID
export const get = query({
  args: { id: v.id("initiatives") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

// Mutation to create a new initiative
export const create = mutation({
  args: {
    name: v.string(),
    owner: v.string(),
    status: v.union(v.literal("planned"), v.literal("in_progress"), v.literal("done")),
    releaseDate: v.union(v.string(), v.null()),
    description: v.string(),
  },
  handler: async (ctx, args) => {
    const initiativeId = await ctx.db.insert("initiatives", {
      name: args.name,
      owner: args.owner,
      status: args.status,
      releaseDate: args.releaseDate ? new Date(args.releaseDate) : null,
      lastUpdated: Date.now(),
      description: args.description,
      activityLog: [],
    });
    return initiativeId;
  },
});

// Mutation to update an initiative
export const update = mutation({
  args: {
    id: v.id("initiatives"),
    name: v.optional(v.string()),
    owner: v.optional(v.string()),
    status: v.optional(v.union(v.literal("planned"), v.literal("in_progress"), v.literal("done"))),
    releaseDate: v.optional(v.union(v.string(), v.null())),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { id, ...updates } = args;
    const existing = await ctx.db.get(id);
    if (!existing) {
      throw new Error("Initiative not found");
    }

    const updateData: any = {
      lastUpdated: Date.now(),
    };

    if (updates.name !== undefined) updateData.name = updates.name;
    if (updates.owner !== undefined) updateData.owner = updates.owner;
    if (updates.status !== undefined) updateData.status = updates.status;
    if (updates.releaseDate !== undefined) {
      updateData.releaseDate = updates.releaseDate ? new Date(updates.releaseDate) : null;
    }
    if (updates.description !== undefined) updateData.description = updates.description;

    await ctx.db.patch(id, updateData);
    return id;
  },
});

// Mutation to delete an initiative
export const remove = mutation({
  args: { id: v.id("initiatives") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);
  },
});
