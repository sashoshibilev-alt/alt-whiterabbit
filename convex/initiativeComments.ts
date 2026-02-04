/**
 * Initiative Comments
 * 
 * This module implements commenting functionality for initiatives:
 * - Adding comments (user and system)
 * - Editing comments (creates edit events)
 * - Soft deletion
 * - Threading support
 * - Resolving comments
 */

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { Id } from "./_generated/dataModel";

// ============================================
// Command: Add Comment
// ============================================

export const addComment = mutation({
  args: {
    initiativeId: v.id("newInitiatives"),
    authorUserId: v.string(),
    body: v.string(),
    parentCommentId: v.optional(v.id("initiativeComments")),
    isSystem: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    
    // Verify initiative exists
    const initiative = await ctx.db.get(args.initiativeId);
    if (!initiative) {
      throw new Error("Initiative not found");
    }
    
    // If replying, verify parent exists
    if (args.parentCommentId) {
      const parent = await ctx.db.get(args.parentCommentId);
      if (!parent) {
        throw new Error("Parent comment not found");
      }
      if (parent.initiativeId !== args.initiativeId) {
        throw new Error("Parent comment belongs to different initiative");
      }
    }
    
    // Create comment
    const commentId = await ctx.db.insert("initiativeComments", {
      initiativeId: args.initiativeId,
      authorUserId: args.authorUserId,
      body: args.body,
      createdAt: now,
      parentCommentId: args.parentCommentId,
      isSystem: args.isSystem || false,
    });
    
    return commentId;
  },
});

// ============================================
// Command: Edit Comment
// ============================================

export const editComment = mutation({
  args: {
    id: v.id("initiativeComments"),
    body: v.string(),
    editorUserId: v.string(),
  },
  handler: async (ctx, args) => {
    const comment = await ctx.db.get(args.id);
    if (!comment) {
      throw new Error("Comment not found");
    }
    
    if (comment.deletedAt) {
      throw new Error("Cannot edit deleted comment");
    }
    
    if (comment.isSystem) {
      throw new Error("Cannot edit system comment");
    }
    
    // Verify editor is author (in production, you'd check permissions)
    if (comment.authorUserId !== args.editorUserId) {
      throw new Error("Only comment author can edit");
    }
    
    const now = Date.now();
    
    await ctx.db.patch(args.id, {
      body: args.body,
      updatedAt: now,
    });
    
    return { id: args.id, updatedAt: now };
  },
});

// ============================================
// Command: Delete Comment (Soft)
// ============================================

export const deleteComment = mutation({
  args: {
    id: v.id("initiativeComments"),
    deleterUserId: v.string(),
  },
  handler: async (ctx, args) => {
    const comment = await ctx.db.get(args.id);
    if (!comment) {
      throw new Error("Comment not found");
    }
    
    if (comment.deletedAt) {
      throw new Error("Comment already deleted");
    }
    
    // Verify deleter is author (in production, check permissions)
    if (comment.authorUserId !== args.deleterUserId) {
      throw new Error("Only comment author can delete");
    }
    
    const now = Date.now();
    
    await ctx.db.patch(args.id, {
      deletedAt: now,
    });
    
    return { id: args.id, deletedAt: now };
  },
});

// ============================================
// Command: Resolve Comment
// ============================================

export const resolveComment = mutation({
  args: {
    id: v.id("initiativeComments"),
    resolverUserId: v.string(),
  },
  handler: async (ctx, args) => {
    const comment = await ctx.db.get(args.id);
    if (!comment) {
      throw new Error("Comment not found");
    }
    
    if (comment.deletedAt) {
      throw new Error("Cannot resolve deleted comment");
    }
    
    if (comment.resolvedAt) {
      throw new Error("Comment already resolved");
    }
    
    const now = Date.now();
    
    await ctx.db.patch(args.id, {
      resolvedAt: now,
      resolvedByUserId: args.resolverUserId,
    });
    
    return { id: args.id, resolvedAt: now };
  },
});

// ============================================
// Command: Unresolve Comment
// ============================================

export const unresolveComment = mutation({
  args: {
    id: v.id("initiativeComments"),
  },
  handler: async (ctx, args) => {
    const comment = await ctx.db.get(args.id);
    if (!comment) {
      throw new Error("Comment not found");
    }
    
    await ctx.db.patch(args.id, {
      resolvedAt: undefined,
      resolvedByUserId: undefined,
    });
    
    return { id: args.id };
  },
});

// ============================================
// Query: List Comments for Initiative
// ============================================

export const listByInitiative = query({
  args: {
    initiativeId: v.id("newInitiatives"),
    includeDeleted: v.optional(v.boolean()),
    includeResolved: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    let comments = await ctx.db
      .query("initiativeComments")
      .withIndex("by_initiativeId_createdAt", (q) =>
        q.eq("initiativeId", args.initiativeId)
      )
      .collect();
    
    // Filter deleted
    if (!args.includeDeleted) {
      comments = comments.filter((c) => !c.deletedAt);
    }
    
    // Filter resolved
    if (!args.includeResolved) {
      comments = comments.filter((c) => !c.resolvedAt);
    }
    
    return comments;
  },
});

// ============================================
// Query: Get Comment
// ============================================

export const get = query({
  args: {
    id: v.id("initiativeComments"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

// ============================================
// Query: Get Thread (comment and replies)
// ============================================

export const getThread = query({
  args: {
    rootCommentId: v.id("initiativeComments"),
  },
  handler: async (ctx, args) => {
    const root = await ctx.db.get(args.rootCommentId);
    if (!root) {
      throw new Error("Root comment not found");
    }
    
    const replies = await ctx.db
      .query("initiativeComments")
      .withIndex("by_parentCommentId", (q) =>
        q.eq("parentCommentId", args.rootCommentId)
      )
      .collect();
    
    return {
      root,
      replies,
    };
  },
});
