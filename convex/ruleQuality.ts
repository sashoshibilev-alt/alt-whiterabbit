/**
 * Rule Quality Scores
 * 
 * This module computes quality scores for rules/prompts based on user behavior
 * without retraining models. Scores are used to adjust ranking and thresholds.
 */

import { v } from "convex/values";
import { action, mutation, query, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";

// ============================================
// Rule Quality Score Computation
// ============================================

/**
 * Action to compute rule quality scores based on recent events
 * Run this daily after metrics aggregation
 */
export const computeRuleQualityScores = action({
  args: {
    windowDays: v.optional(v.number()), // Rolling window in days (default: 30)
  },
  handler: async (ctx, args) => {
    const windowDays = args.windowDays || 30;
    const now = Date.now();
    const windowStart = now - (windowDays * 24 * 60 * 60 * 1000);
    
    // Format dates for queries
    const windowStartDate = new Date(windowStart).toISOString().split('T')[0];
    const windowEndDate = new Date(now).toISOString().split('T')[0];

    // Get all events in the window
    const events = await ctx.runQuery(internal.ruleQuality.getEventsForWindow, {
      startTime: windowStart,
      endTime: now,
    });

    // Group by rule/prompt ID and suggestion family
    const ruleStatsMap = new Map<string, RuleStats>();

    for (const event of events) {
      // Skip events without rule ID or that are excluded
      if (!event.ruleOrPromptId || event.excludeFromMetrics) {
        continue;
      }

      const key = `${event.ruleOrPromptId}|${event.suggestionFamily || "general"}`;
      
      if (!ruleStatsMap.has(key)) {
        ruleStatsMap.set(key, {
          ruleOrPromptId: event.ruleOrPromptId,
          suggestionFamily: event.suggestionFamily || "general",
          totalGenerated: 0,
          totalApplied: 0,
          totalDismissed: 0,
          totalClarificationRequests: 0,
        });
      }

      const stats = ruleStatsMap.get(key)!;

      switch (event.eventType) {
        case "generated":
          stats.totalGenerated++;
          break;
        case "applied":
          stats.totalApplied++;
          break;
        case "dismissed":
          stats.totalDismissed++;
          break;
        case "clarification_requested":
          stats.totalClarificationRequests++;
          break;
      }
    }

    // Compute scores and store
    const scores: RuleQualityScore[] = [];

    for (const [_, stats] of ruleStatsMap) {
      // Only compute scores for rules with sufficient data
      if (stats.totalGenerated < 5) {
        continue; // Need at least 5 suggestions for meaningful stats
      }

      const applyRate = stats.totalApplied / stats.totalGenerated;
      const dismissRate = stats.totalDismissed / stats.totalGenerated;
      const clarificationRate = stats.totalClarificationRequests / stats.totalGenerated;
      const nhi = applyRate - dismissRate;

      // Compute quality score using exponential decay
      // Formula: NHI * confidence_factor
      // confidence_factor = min(1, totalGenerated / 50) for gradual confidence growth
      const confidenceFactor = Math.min(1, stats.totalGenerated / 50);
      const qualityScore = nhi * confidenceFactor;

      scores.push({
        ruleOrPromptId: stats.ruleOrPromptId,
        suggestionFamily: stats.suggestionFamily,
        applyRate,
        dismissRate,
        clarificationRate,
        nhi,
        qualityScore,
        totalGenerated: stats.totalGenerated,
        totalApplied: stats.totalApplied,
        totalDismissed: stats.totalDismissed,
        windowStartDate,
        windowEndDate,
      });
    }

    // Store scores
    await ctx.runMutation(internal.ruleQuality.storeRuleQualityScores, {
      scores,
      timestamp: now,
    });

    return {
      scoresComputed: scores.length,
      windowDays,
      windowStartDate,
      windowEndDate,
    };
  },
});

// ============================================
// Internal Queries
// ============================================

export const getEventsForWindow = internalQuery({
  args: {
    startTime: v.number(),
    endTime: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("suggestionEvents")
      .withIndex("by_createdAt")
      .filter((q) => 
        q.and(
          q.gte(q.field("createdAt"), args.startTime),
          q.lte(q.field("createdAt"), args.endTime)
        )
      )
      .collect();
  },
});

// ============================================
// Internal Mutations
// ============================================

export const storeRuleQualityScores = internalMutation({
  args: {
    scores: v.any(), // Array of RuleQualityScore
    timestamp: v.number(),
  },
  handler: async (ctx, args) => {
    const scores = args.scores as RuleQualityScore[];

    for (const score of scores) {
      // Check if score already exists
      const existing = await ctx.db
        .query("ruleQualityScores")
        .withIndex("by_ruleOrPromptId", (q) => 
          q.eq("ruleOrPromptId", score.ruleOrPromptId)
        )
        .filter((q) => 
          q.eq(q.field("suggestionFamily"), score.suggestionFamily)
        )
        .first();

      if (existing) {
        // Update existing record
        await ctx.db.patch(existing._id, {
          applyRate: score.applyRate,
          dismissRate: score.dismissRate,
          clarificationRate: score.clarificationRate,
          nhi: score.nhi,
          qualityScore: score.qualityScore,
          totalGenerated: score.totalGenerated,
          totalApplied: score.totalApplied,
          totalDismissed: score.totalDismissed,
          lastComputedAt: args.timestamp,
          windowStartDate: score.windowStartDate,
          windowEndDate: score.windowEndDate,
        });
      } else {
        // Insert new record
        await ctx.db.insert("ruleQualityScores", {
          ruleOrPromptId: score.ruleOrPromptId,
          suggestionFamily: score.suggestionFamily,
          applyRate: score.applyRate,
          dismissRate: score.dismissRate,
          clarificationRate: score.clarificationRate,
          nhi: score.nhi,
          qualityScore: score.qualityScore,
          totalGenerated: score.totalGenerated,
          totalApplied: score.totalApplied,
          totalDismissed: score.totalDismissed,
          lastComputedAt: args.timestamp,
          windowStartDate: score.windowStartDate,
          windowEndDate: score.windowEndDate,
        });
      }
    }
  },
});

// ============================================
// Public Queries
// ============================================

/**
 * Query to get rule quality scores
 */
export const getRuleQualityScores = query({
  args: {
    ruleOrPromptId: v.optional(v.string()),
    suggestionFamily: v.optional(v.string()),
    minQualityScore: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    let queryBuilder = ctx.db.query("ruleQualityScores");

    // Apply filters
    const results = await queryBuilder
      .filter((q) => {
        const filters = [];

        if (args.ruleOrPromptId !== undefined) {
          filters.push(q.eq(q.field("ruleOrPromptId"), args.ruleOrPromptId));
        }
        if (args.suggestionFamily !== undefined) {
          filters.push(q.eq(q.field("suggestionFamily"), args.suggestionFamily));
        }
        if (args.minQualityScore !== undefined) {
          filters.push(q.gte(q.field("qualityScore"), args.minQualityScore));
        }

        return filters.length > 0 ? q.and(...filters) : true;
      })
      .order("desc")
      .collect();

    return results;
  },
});

/**
 * Query to get quality score for a specific rule
 */
export const getQualityScoreForRule = query({
  args: {
    ruleOrPromptId: v.string(),
    suggestionFamily: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("ruleQualityScores")
      .withIndex("by_ruleOrPromptId", (q) => 
        q.eq("ruleOrPromptId", args.ruleOrPromptId)
      )
      .filter((q) => 
        args.suggestionFamily 
          ? q.eq(q.field("suggestionFamily"), args.suggestionFamily)
          : true
      )
      .first();
  },
});

/**
 * Query to get top performing rules
 */
export const getTopRules = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = args.limit || 10;

    const scores = await ctx.db
      .query("ruleQualityScores")
      .withIndex("by_qualityScore")
      .order("desc")
      .take(limit);

    return scores;
  },
});

/**
 * Query to get rules needing attention (low quality)
 */
export const getLowQualityRules = query({
  args: {
    threshold: v.optional(v.number()), // Default: -0.2 (20% more dismissals than applies)
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const threshold = args.threshold !== undefined ? args.threshold : -0.2;
    const limit = args.limit || 10;

    const scores = await ctx.db
      .query("ruleQualityScores")
      .filter((q) => q.lte(q.field("qualityScore"), threshold))
      .order("asc")
      .take(limit);

    return scores;
  },
});

// ============================================
// Types
// ============================================

type RuleStats = {
  ruleOrPromptId: string;
  suggestionFamily: string;
  totalGenerated: number;
  totalApplied: number;
  totalDismissed: number;
  totalClarificationRequests: number;
};

type RuleQualityScore = {
  ruleOrPromptId: string;
  suggestionFamily?: string;
  applyRate: number;
  dismissRate: number;
  clarificationRate: number;
  nhi: number;
  qualityScore: number;
  totalGenerated: number;
  totalApplied: number;
  totalDismissed: number;
  windowStartDate: string;
  windowEndDate: string;
};
