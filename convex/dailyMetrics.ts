/**
 * Daily Metrics Aggregation
 * 
 * This module implements the daily batch job that aggregates suggestion events
 * into compact daily metrics for reporting and analysis.
 */

import { v } from "convex/values";
import { action, mutation, query, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";

// ============================================
// Daily Aggregation Job
// ============================================

/**
 * Action to compute daily metrics for a specific date
 * Run this daily via cron for the previous day
 */
export const computeDailyMetrics = action({
  args: {
    dateUtc: v.string(), // YYYY-MM-DD format
  },
  handler: async (ctx, args) => {
    const startOfDay = new Date(args.dateUtc + "T00:00:00Z").getTime();
    const endOfDay = new Date(args.dateUtc + "T23:59:59.999Z").getTime();

    // Get all events for the day
    const events = await ctx.runQuery(internal.dailyMetrics.getEventsForDateRange, {
      startTime: startOfDay,
      endTime: endOfDay,
    });

    // Group by dimensions and compute metrics
    const metricsMap = new Map<string, DailyMetricsFact>();

    for (const event of events) {
      // Skip events marked for exclusion
      if (event.excludeFromMetrics) {
        continue;
      }

      // Compute dimension keys
      const dimensions = [
        // Global
        { teamId: "global", surface: undefined, suggestionFamily: undefined },
        // By team
        { teamId: event.teamId || "global", surface: undefined, suggestionFamily: undefined },
        // By surface
        { teamId: "global", surface: event.uiSurface, suggestionFamily: undefined },
        // By family
        { teamId: "global", surface: undefined, suggestionFamily: event.suggestionFamily },
        // By team + surface
        { teamId: event.teamId || "global", surface: event.uiSurface, suggestionFamily: undefined },
        // By team + family
        { teamId: event.teamId || "global", surface: undefined, suggestionFamily: event.suggestionFamily },
        // By surface + family
        { teamId: "global", surface: event.uiSurface, suggestionFamily: event.suggestionFamily },
        // By all dimensions
        { teamId: event.teamId || "global", surface: event.uiSurface, suggestionFamily: event.suggestionFamily },
      ];

      for (const dim of dimensions) {
        const key = `${dim.teamId}|${dim.surface || ""}|${dim.suggestionFamily || ""}`;
        
        if (!metricsMap.has(key)) {
          metricsMap.set(key, {
            dateUtc: args.dateUtc,
            teamId: dim.teamId === "global" ? undefined : dim.teamId,
            surface: dim.surface,
            suggestionFamily: dim.suggestionFamily,
            suggestionsGenerated: 0,
            suggestionsApplied: 0,
            suggestionsDismissed: 0,
            clarificationRequests: 0,
          });
        }

        const metrics = metricsMap.get(key)!;

        // Increment counters based on event type
        switch (event.eventType) {
          case "generated":
            metrics.suggestionsGenerated++;
            break;
          case "applied":
            metrics.suggestionsApplied++;
            break;
          case "dismissed":
            metrics.suggestionsDismissed++;
            break;
          case "clarification_requested":
            metrics.clarificationRequests++;
            break;
        }
      }
    }

    // Compute rates and store metrics
    const now = Date.now();
    const metricsToStore: DailyMetricsFact[] = [];

    for (const [_, metrics] of metricsMap) {
      // Compute rates
      const applyRate = metrics.suggestionsGenerated > 0
        ? metrics.suggestionsApplied / metrics.suggestionsGenerated
        : 0;
      const dismissRate = metrics.suggestionsGenerated > 0
        ? metrics.suggestionsDismissed / metrics.suggestionsGenerated
        : 0;
      const clarificationRate = metrics.suggestionsGenerated > 0
        ? metrics.clarificationRequests / metrics.suggestionsGenerated
        : 0;
      const nhi = applyRate - dismissRate;

      metricsToStore.push({
        ...metrics,
        applyRate,
        dismissRate,
        clarificationRate,
        nhi,
      });
    }

    // Store metrics (idempotent - will overwrite if exists)
    await ctx.runMutation(internal.dailyMetrics.storeDailyMetrics, {
      dateUtc: args.dateUtc,
      metrics: metricsToStore,
      timestamp: now,
    });

    return {
      date: args.dateUtc,
      metricsComputed: metricsToStore.length,
      totalEvents: events.length,
    };
  },
});

// ============================================
// Internal Queries
// ============================================

export const getEventsForDateRange = internalQuery({
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

export const storeDailyMetrics = internalMutation({
  args: {
    dateUtc: v.string(),
    metrics: v.any(), // Array of DailyMetricsFact
    timestamp: v.number(),
  },
  handler: async (ctx, args) => {
    const metrics = args.metrics as DailyMetricsFact[];

    for (const metric of metrics) {
      // Check if metric already exists (for idempotency)
      const existing = await ctx.db
        .query("dailySuggestionMetrics")
        .withIndex("by_dateUtc_teamId", (q) => 
          q.eq("dateUtc", args.dateUtc).eq("teamId", metric.teamId)
        )
        .filter((q) => 
          q.and(
            q.eq(q.field("surface"), metric.surface),
            q.eq(q.field("suggestionFamily"), metric.suggestionFamily)
          )
        )
        .first();

      if (existing) {
        // Update existing record
        await ctx.db.patch(existing._id, {
          suggestionsGenerated: metric.suggestionsGenerated,
          suggestionsApplied: metric.suggestionsApplied,
          suggestionsDismissed: metric.suggestionsDismissed,
          clarificationRequests: metric.clarificationRequests,
          applyRate: metric.applyRate,
          dismissRate: metric.dismissRate,
          clarificationRate: metric.clarificationRate,
          nhi: metric.nhi,
          updatedAt: args.timestamp,
        });
      } else {
        // Insert new record
        await ctx.db.insert("dailySuggestionMetrics", {
          dateUtc: args.dateUtc,
          teamId: metric.teamId,
          surface: metric.surface,
          suggestionFamily: metric.suggestionFamily,
          suggestionsGenerated: metric.suggestionsGenerated,
          suggestionsApplied: metric.suggestionsApplied,
          suggestionsDismissed: metric.suggestionsDismissed,
          clarificationRequests: metric.clarificationRequests,
          applyRate: metric.applyRate,
          dismissRate: metric.dismissRate,
          clarificationRate: metric.clarificationRate,
          nhi: metric.nhi,
          createdAt: args.timestamp,
          updatedAt: args.timestamp,
        });
      }
    }
  },
});

// ============================================
// Public Queries
// ============================================

/**
 * Query to get daily metrics for a date range
 */
export const getDailyMetrics = query({
  args: {
    startDate: v.string(), // YYYY-MM-DD
    endDate: v.string(), // YYYY-MM-DD
    teamId: v.optional(v.string()),
    surface: v.optional(v.string()),
    suggestionFamily: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    let queryBuilder = ctx.db.query("dailySuggestionMetrics");

    // Apply filters
    const results = await queryBuilder
      .filter((q) => {
        const filters = [
          q.gte(q.field("dateUtc"), args.startDate),
          q.lte(q.field("dateUtc"), args.endDate),
        ];

        if (args.teamId !== undefined) {
          filters.push(q.eq(q.field("teamId"), args.teamId));
        }
        if (args.surface !== undefined) {
          filters.push(q.eq(q.field("surface"), args.surface));
        }
        if (args.suggestionFamily !== undefined) {
          filters.push(q.eq(q.field("suggestionFamily"), args.suggestionFamily));
        }

        return q.and(...filters);
      })
      .order("desc")
      .collect();

    return results;
  },
});

/**
 * Query to get daily report (summary for stakeholders)
 */
export const getDailyReport = query({
  args: {
    dateUtc: v.string(), // YYYY-MM-DD
  },
  handler: async (ctx, args) => {
    // Get global metrics for the day
    const globalMetrics = await ctx.db
      .query("dailySuggestionMetrics")
      .withIndex("by_dateUtc", (q) => q.eq("dateUtc", args.dateUtc))
      .filter((q) => 
        q.and(
          q.eq(q.field("teamId"), undefined),
          q.eq(q.field("surface"), undefined),
          q.eq(q.field("suggestionFamily"), undefined)
        )
      )
      .first();

    // Get metrics by family
    const byFamily = await ctx.db
      .query("dailySuggestionMetrics")
      .withIndex("by_dateUtc_family", (q) => q.eq("dateUtc", args.dateUtc))
      .filter((q) => 
        q.and(
          q.eq(q.field("teamId"), undefined),
          q.eq(q.field("surface"), undefined),
          q.neq(q.field("suggestionFamily"), undefined)
        )
      )
      .collect();

    // Get metrics by surface
    const bySurface = await ctx.db
      .query("dailySuggestionMetrics")
      .withIndex("by_dateUtc_surface", (q) => q.eq("dateUtc", args.dateUtc))
      .filter((q) => 
        q.and(
          q.eq(q.field("teamId"), undefined),
          q.neq(q.field("surface"), undefined),
          q.eq(q.field("suggestionFamily"), undefined)
        )
      )
      .collect();

    return {
      date: args.dateUtc,
      global: globalMetrics,
      byFamily,
      bySurface,
    };
  },
});

// ============================================
// Types
// ============================================

type DailyMetricsFact = {
  dateUtc: string;
  teamId?: string;
  surface?: string;
  suggestionFamily?: string;
  suggestionsGenerated: number;
  suggestionsApplied: number;
  suggestionsDismissed: number;
  clarificationRequests: number;
  applyRate?: number;
  dismissRate?: number;
  clarificationRate?: number;
  nhi?: number;
};
