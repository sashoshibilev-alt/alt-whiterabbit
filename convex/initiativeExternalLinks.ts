/**
 * Initiative External Links
 * 
 * Generic external integration support without tool-specific concepts.
 * This module implements:
 * - Creating links to external systems (issue trackers, roadmap tools, etc.)
 * - Updating sync state
 * - Querying links
 */

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { Id } from "./_generated/dataModel";

// ============================================
// Command: Create External Link
// ============================================

export const create = mutation({
  args: {
    initiativeId: v.id("newInitiatives"),
    externalSystem: v.string(), // e.g., "issue_tracker", "roadmap_tool"
    externalResourceType: v.string(), // e.g., "project", "epic"
    externalResourceId: v.string(), // Opaque external ID
    externalUrl: v.optional(v.string()),
    lastSyncState: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    
    // Verify initiative exists
    const initiative = await ctx.db.get(args.initiativeId);
    if (!initiative) {
      throw new Error("Initiative not found");
    }
    
    // Check if link already exists
    const existing = await ctx.db
      .query("initiativeExternalLinks")
      .withIndex("by_externalSystem_resourceId", (q) =>
        q.eq("externalSystem", args.externalSystem)
         .eq("externalResourceId", args.externalResourceId)
      )
      .filter((q) => q.eq(q.field("initiativeId"), args.initiativeId))
      .first();
    
    if (existing) {
      throw new Error("External link already exists for this initiative");
    }
    
    // Create link
    const linkId = await ctx.db.insert("initiativeExternalLinks", {
      initiativeId: args.initiativeId,
      externalSystem: args.externalSystem,
      externalResourceType: args.externalResourceType,
      externalResourceId: args.externalResourceId,
      externalUrl: args.externalUrl,
      lastSyncState: args.lastSyncState,
      createdAt: now,
      updatedAt: now,
    });
    
    return linkId;
  },
});

// ============================================
// Command: Update External Link
// ============================================

export const update = mutation({
  args: {
    id: v.id("initiativeExternalLinks"),
    externalUrl: v.optional(v.string()),
    lastSyncState: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const link = await ctx.db.get(args.id);
    if (!link) {
      throw new Error("External link not found");
    }
    
    const now = Date.now();
    
    const updates: any = {
      updatedAt: now,
    };
    
    if (args.externalUrl !== undefined) {
      updates.externalUrl = args.externalUrl;
    }
    
    if (args.lastSyncState !== undefined) {
      updates.lastSyncState = args.lastSyncState;
    }
    
    await ctx.db.patch(args.id, updates);
    
    return { id: args.id, updatedAt: now };
  },
});

// ============================================
// Command: Delete External Link
// ============================================

export const remove = mutation({
  args: {
    id: v.id("initiativeExternalLinks"),
  },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.id);
  },
});

// ============================================
// Query: Get External Links for Initiative
// ============================================

export const listByInitiative = query({
  args: {
    initiativeId: v.id("newInitiatives"),
    externalSystem: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    let links = await ctx.db
      .query("initiativeExternalLinks")
      .withIndex("by_initiativeId", (q) => q.eq("initiativeId", args.initiativeId))
      .collect();
    
    if (args.externalSystem) {
      links = links.filter(l => l.externalSystem === args.externalSystem);
    }
    
    return links;
  },
});

// ============================================
// Query: Find Initiative by External Resource
// ============================================

export const findByExternalResource = query({
  args: {
    externalSystem: v.string(),
    externalResourceId: v.string(),
  },
  handler: async (ctx, args) => {
    const link = await ctx.db
      .query("initiativeExternalLinks")
      .withIndex("by_externalSystem_resourceId", (q) =>
        q.eq("externalSystem", args.externalSystem)
         .eq("externalResourceId", args.externalResourceId)
      )
      .first();
    
    if (!link) {
      return null;
    }
    
    // Load the initiative
    const initiative = await ctx.db.get(link.initiativeId);
    
    return {
      link,
      initiative,
    };
  },
});

// ============================================
// Query: Get External Link
// ============================================

export const get = query({
  args: {
    id: v.id("initiativeExternalLinks"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

// ============================================
// Query: List All External Links
// ============================================

export const list = query({
  args: {
    externalSystem: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    let links = await ctx.db.query("initiativeExternalLinks").collect();
    
    if (args.externalSystem) {
      links = links.filter(l => l.externalSystem === args.externalSystem);
    }
    
    return links;
  },
});
