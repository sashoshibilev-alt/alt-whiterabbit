/**
 * Cron Jobs for Shipit
 * 
 * This module configures scheduled jobs for metrics aggregation and
 * rule quality score computation.
 */

import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Run daily metrics aggregation at 1:00 AM UTC
// Computes metrics for the previous day
crons.daily(
  "Compute daily suggestion metrics",
  { hourUTC: 1, minuteUTC: 0 },
  internal.dailyMetrics.computeDailyMetrics,
  {
    // Compute metrics for yesterday
    dateUtc: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0],
  }
);

// Run rule quality score computation at 2:00 AM UTC (after daily metrics)
// Uses a 30-day rolling window
crons.daily(
  "Compute rule quality scores",
  { hourUTC: 2, minuteUTC: 0 },
  internal.ruleQuality.computeRuleQualityScores,
  {
    windowDays: 30,
  }
);

export default crons;
