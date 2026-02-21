/**
 * Suggestion Debug API
 *
 * Convex functions for creating, retrieving, and managing suggestion debug runs.
 * All endpoints are admin-only and require the suggestionDebugEnabled feature flag.
 */

import { query, mutation, action, internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  generateSuggestionsWithDebug,
  adaptConvexNote,
  adaptConvexInitiative,
  type DebugRun,
  type DebugVerbosity,
  computeDebugRunSummary,
} from "../src/lib/suggestion-engine-v2";

// ============================================
// Configuration
// ============================================

const RETENTION_DAYS = 14;
const MAX_PAYLOAD_BYTES = 512 * 1024; // 512 KB
const RATE_LIMIT_HOURS = 1;

// Simulated feature flags (in a real app, these would come from a config service)
const FEATURE_FLAGS = {
  suggestionDebugEnabled: true, // Enable/disable the feature
  allowFullTextDebug: false, // Only allow in dev environments
};

// Simulated admin check (in a real app, this would check auth)
function isAdmin(_userId?: string): boolean {
  // For now, allow all users (would check user.isAdmin in production)
  return true;
}

// ============================================
// Guards
// ============================================

function guardAdminAndFeature(userId?: string): { allowed: boolean; reason?: string } {
  if (!FEATURE_FLAGS.suggestionDebugEnabled) {
    return { allowed: false, reason: "Debug feature is disabled" };
  }
  if (!isAdmin(userId)) {
    return { allowed: false, reason: "Admin access required" };
  }
  return { allowed: true };
}

// ============================================
// Internal Queries
// ============================================

/**
 * Get the latest debug run for a note (internal)
 */
export const getLatestByNoteInternal = internalQuery({
  args: { noteId: v.id("notes") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("suggestionDebugRuns")
      .withIndex("by_noteId_createdAt", (q) => q.eq("noteId", args.noteId))
      .order("desc")
      .first();
  },
});

/**
 * Check rate limit for a note (internal)
 */
export const checkRateLimitInternal = internalQuery({
  args: { noteId: v.id("notes") },
  handler: async (ctx, args) => {
    const hourAgo = Date.now() - RATE_LIMIT_HOURS * 60 * 60 * 1000;

    const recentRun = await ctx.db
      .query("suggestionDebugRuns")
      .withIndex("by_noteId_createdAt", (q) => q.eq("noteId", args.noteId))
      .filter((q) => q.gt(q.field("createdAt"), hourAgo))
      .first();

    return {
      limited: !!recentRun,
      lastRunAt: recentRun?.createdAt,
    };
  },
});

// ============================================
// Internal Mutations
// ============================================

/**
 * Store a debug run (internal)
 */
export const storeDebugRunInternal = internalMutation({
  args: {
    noteId: v.id("notes"),
    runId: v.string(),
    createdByUserId: v.optional(v.string()),
    generatorVersion: v.string(),
    verbosity: v.string(),
    configSnapshotJson: v.any(),
    payloadJson: v.any(),
    sizeBytes: v.number(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const expiresAt = now + RETENTION_DAYS * 24 * 60 * 60 * 1000;

    const id = await ctx.db.insert("suggestionDebugRuns", {
      noteId: args.noteId,
      runId: args.runId,
      createdAt: now,
      createdByUserId: args.createdByUserId,
      generatorVersion: args.generatorVersion,
      verbosity: args.verbosity,
      configSnapshotJson: args.configSnapshotJson,
      payloadJson: args.payloadJson,
      sizeBytes: args.sizeBytes,
      expiresAt,
    });

    return id;
  },
});

/**
 * Clean up expired debug runs (internal)
 */
export const cleanupExpiredRunsInternal = internalMutation({
  handler: async (ctx) => {
    const now = Date.now();

    // Find expired runs
    const expiredRuns = await ctx.db
      .query("suggestionDebugRuns")
      .withIndex("by_expiresAt")
      .filter((q) => q.lt(q.field("expiresAt"), now))
      .take(100); // Batch delete

    let deletedCount = 0;
    for (const run of expiredRuns) {
      await ctx.db.delete(run._id);
      deletedCount++;
    }

    return { deletedCount };
  },
});

// ============================================
// Public Queries
// ============================================

/**
 * Get the latest debug run for a note
 */
export const getLatestByNote = query({
  args: { noteId: v.id("notes") },
  handler: async (ctx, args) => {
    const guard = guardAdminAndFeature();
    if (!guard.allowed) {
      return { debugRun: null, error: guard.reason };
    }

    const run = await ctx.db
      .query("suggestionDebugRuns")
      .withIndex("by_noteId_createdAt", (q) => q.eq("noteId", args.noteId))
      .order("desc")
      .first();

    if (!run) {
      return { debugRun: null };
    }

    return {
      debugRun: run.payloadJson as DebugRun,
    };
  },
});

/**
 * Get a debug run by ID
 */
export const getByRunId = query({
  args: { runId: v.string() },
  handler: async (ctx, args) => {
    const guard = guardAdminAndFeature();
    if (!guard.allowed) {
      return { debugRun: null, error: guard.reason };
    }

    const run = await ctx.db
      .query("suggestionDebugRuns")
      .withIndex("by_runId", (q) => q.eq("runId", args.runId))
      .first();

    if (!run) {
      return { debugRun: null };
    }

    return {
      debugRun: run.payloadJson as DebugRun,
    };
  },
});

/**
 * List debug runs for a note
 */
export const listByNote = query({
  args: {
    noteId: v.id("notes"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const guard = guardAdminAndFeature();
    if (!guard.allowed) {
      return { runs: [], error: guard.reason };
    }

    const limit = args.limit || 10;

    const runs = await ctx.db
      .query("suggestionDebugRuns")
      .withIndex("by_noteId_createdAt", (q) => q.eq("noteId", args.noteId))
      .order("desc")
      .take(limit);

    // Return metadata only, not full payloads
    return {
      runs: runs.map((run) => ({
        id: run._id,
        runId: run.runId,
        createdAt: run.createdAt,
        generatorVersion: run.generatorVersion,
        verbosity: run.verbosity,
        sizeBytes: run.sizeBytes,
      })),
    };
  },
});

// ============================================
// Actions
// ============================================

/**
 * Create a new debug run for a note
 *
 * This triggers a fresh suggestion generation with debug instrumentation.
 * 
 * @param persistSuggestions - If true, persist the emitted suggestions to the suggestions table
 */
export const createDebugRun = action({
  args: {
    noteId: v.id("notes"),
    verbosity: v.optional(v.string()),
    persistSuggestions: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<{
    debugRun: DebugRun | null;
    stored: boolean;
    storageSkippedReason?: string;
    error?: string;
    suggestionsCreated?: number;
  }> => {
    // Check guards
    const guard = guardAdminAndFeature();
    if (!guard.allowed) {
      return {
        debugRun: null,
        stored: false,
        error: guard.reason,
      };
    }

    // Check rate limit
    const rateLimit = await ctx.runQuery(internal.suggestionDebug.checkRateLimitInternal, {
      noteId: args.noteId,
    });

    if (rateLimit.limited) {
      return {
        debugRun: null,
        stored: false,
        error: `Rate limited. Last run was at ${new Date(rateLimit.lastRunAt!).toISOString()}. Please wait ${RATE_LIMIT_HOURS} hour(s).`,
      };
    }

    // Get the note
    const note = await ctx.runQuery(internal.notes.getInternal, { id: args.noteId });
    if (!note) {
      return {
        debugRun: null,
        stored: false,
        error: "Note not found",
      };
    }

    // Get initiatives for context
    const v0Initiatives = await ctx.runQuery(internal.suggestions.listV0InitiativesInternal, {});
    const initiatives = v0Initiatives.map(adaptConvexInitiative);

    // Resolve verbosity
    let verbosity: DebugVerbosity = "REDACTED";
    if (args.verbosity === "FULL_TEXT" && FEATURE_FLAGS.allowFullTextDebug) {
      verbosity = "FULL_TEXT";
    } else if (args.verbosity === "OFF") {
      verbosity = "OFF";
    }

    // Generate suggestions with debug instrumentation
    const noteInput = adaptConvexNote({
      _id: note._id,
      body: note.body,
      createdAt: note.createdAt,
      title: note.title,
    });

    const result = generateSuggestionsWithDebug(
      noteInput,
      { initiatives },
      { enable_debug: true },
      { verbosity }
    );

    const debugRun = result.debugRun;

    if (!debugRun) {
      return {
        debugRun: null,
        stored: false,
        storageSkippedReason: "VERBOSITY_OFF",
      };
    }

    // Optionally persist suggestions to the suggestions table
    let suggestionsCreated = 0;
    if (args.persistSuggestions && result.suggestions.length > 0) {
      // Build structured suggestion records from v2 engine output
      const suggestionRecords = result.suggestions.map(s => ({
        type: s.type as "idea" | "project_update",
        title: s.title,
        body: s.suggestion?.body ?? s.payload.after_description ?? s.payload.draft_initiative?.description ?? "",
        evidencePreview: s.suggestion?.evidencePreview?.[0] ?? s.evidence_spans?.[0]?.text ?? "",
        sourceSectionId: s.section_id,
        suggestionKey: s.suggestionKey,
      }));

      // Store suggestions using the same mutation as generate/regenerate
      const suggestionIds = await ctx.runMutation(internal.suggestions.storeSuggestions, {
        noteId: args.noteId,
        suggestions: suggestionRecords,
        modelVersion: "suggestion-engine-v2-debug",
        regenerated: false,
        noteVersion: note.updatedAt,
        suggestionFamily: "debug-run",
      });

      suggestionsCreated = suggestionIds.length;
    }

    // Check payload size
    const payloadJson = JSON.stringify(debugRun);
    const sizeBytes = new TextEncoder().encode(payloadJson).length;

    if (sizeBytes > MAX_PAYLOAD_BYTES) {
      // Return the debug run but don't store it
      return {
        debugRun,
        stored: false,
        storageSkippedReason: "TOO_LARGE",
        suggestionsCreated,
      };
    }

    // Store the debug run
    await ctx.runMutation(internal.suggestionDebug.storeDebugRunInternal, {
      noteId: args.noteId,
      runId: debugRun.meta.runId,
      generatorVersion: debugRun.meta.generatorVersion,
      verbosity: debugRun.meta.verbosity,
      configSnapshotJson: debugRun.config,
      payloadJson: debugRun,
      sizeBytes,
    });

    return {
      debugRun,
      stored: true,
      suggestionsCreated,
    };
  },
});

/**
 * Cleanup expired debug runs
 *
 * This should be called periodically (e.g., via cron) to remove old debug runs.
 */
export const cleanupExpiredRuns = action({
  handler: async (ctx) => {
    const result = await ctx.runMutation(internal.suggestionDebug.cleanupExpiredRunsInternal);
    return result;
  },
});

// ============================================
// Debug Run Summary Query
// ============================================

/**
 * Get summary statistics for a debug run
 */
export const getDebugRunSummary = query({
  args: { noteId: v.id("notes") },
  handler: async (ctx, args) => {
    const guard = guardAdminAndFeature();
    if (!guard.allowed) {
      return { summary: null, error: guard.reason };
    }

    const run = await ctx.db
      .query("suggestionDebugRuns")
      .withIndex("by_noteId_createdAt", (q) => q.eq("noteId", args.noteId))
      .order("desc")
      .first();

    if (!run) {
      return { summary: null };
    }

    const debugRun = run.payloadJson as DebugRun;
    const summary = computeDebugRunSummary(debugRun);

    return {
      summary,
      runId: run.runId,
      createdAt: run.createdAt,
    };
  },
});
