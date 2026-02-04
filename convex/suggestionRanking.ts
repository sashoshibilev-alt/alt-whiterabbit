/**
 * Suggestion Ranking and Filtering
 * 
 * This module applies rule quality scores to rank and filter suggestions
 * without retraining models. Uses config-level weights from aggregated data.
 */

import { v } from "convex/values";
import { query, internalQuery } from "./_generated/server";
import { Id } from "./_generated/dataModel";

// ============================================
// Ranking Logic
// ============================================

/**
 * Get quality score for a rule/prompt
 * Returns default neutral score if no data available
 */
export const getRuleQualityScore = internalQuery({
  args: {
    ruleOrPromptId: v.string(),
    suggestionFamily: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const score = await ctx.db
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

    return score?.qualityScore || 0; // Neutral default
  },
});

/**
 * Rank suggestions based on quality scores and clarification state
 */
export const rankSuggestions = query({
  args: {
    noteId: v.id("notes"),
  },
  handler: async (ctx, args) => {
    // Get all new suggestions for the note
    const suggestions = await ctx.db
      .query("suggestions")
      .withIndex("by_noteId", (q) => q.eq("noteId", args.noteId))
      .filter((q) => q.eq(q.field("status"), "new"))
      .collect();

    // Enrich with quality scores
    const enrichedSuggestions = await Promise.all(
      suggestions.map(async (suggestion) => {
        const ruleId = suggestion.ruleOrPromptId || suggestion.modelVersion || "unknown";
        const family = suggestion.suggestionFamily || "general";
        
        // Get quality score
        const scoreRecord = await ctx.db
          .query("ruleQualityScores")
          .withIndex("by_ruleOrPromptId", (q) => q.eq("ruleOrPromptId", ruleId))
          .filter((q) => q.eq(q.field("suggestionFamily"), family))
          .first();

        const qualityScore = scoreRecord?.qualityScore || 0;
        const confidence = suggestion.modelConfidenceScore || 0.5;
        
        // Compute ranking score
        // Formula: base_score * confidence_factor * clarification_penalty
        let rankingScore = qualityScore;
        
        // Boost by model confidence
        rankingScore *= (0.5 + confidence * 0.5); // Scale confidence to 0.5-1.0 multiplier
        
        // Penalty for needs clarification (soft - still show but lower)
        if (suggestion.clarificationState === "suggested") {
          rankingScore *= 0.7; // 30% penalty
        } else if (suggestion.clarificationState === "requested") {
          rankingScore *= 0.8; // 20% penalty
        } else if (suggestion.clarificationState === "answered") {
          rankingScore *= 1.1; // 10% boost for clarified
        }
        
        return {
          ...suggestion,
          qualityScore,
          rankingScore,
          shouldFilter: qualityScore < -0.3, // Filter very low quality
        };
      })
    );

    // Sort by ranking score (descending)
    const ranked = enrichedSuggestions
      .filter(s => !s.shouldFilter) // Filter out very low quality
      .sort((a, b) => b.rankingScore - a.rankingScore);

    return ranked;
  },
});

/**
 * Get suggestion with ranking metadata
 */
export const getSuggestionWithRanking = query({
  args: {
    id: v.id("suggestions"),
  },
  handler: async (ctx, args) => {
    const suggestion = await ctx.db.get(args.id);
    if (!suggestion) {
      return null;
    }

    const ruleId = suggestion.ruleOrPromptId || suggestion.modelVersion || "unknown";
    const family = suggestion.suggestionFamily || "general";
    
    const scoreRecord = await ctx.db
      .query("ruleQualityScores")
      .withIndex("by_ruleOrPromptId", (q) => q.eq("ruleOrPromptId", ruleId))
      .filter((q) => q.eq(q.field("suggestionFamily"), family))
      .first();

    return {
      ...suggestion,
      ruleQualityScore: scoreRecord?.qualityScore || 0,
      ruleApplyRate: scoreRecord?.applyRate || 0,
      ruleDismissRate: scoreRecord?.dismissRate || 0,
      ruleNHI: scoreRecord?.nhi || 0,
    };
  },
});

// ============================================
// Filtering Utilities
// ============================================

/**
 * Determine if suggestion should be auto-applied
 * Based on high quality score and no clarification needed
 */
export function shouldAutoApply(
  qualityScore: number,
  clarificationState: string | undefined,
  confidence: number
): boolean {
  // Only auto-apply if:
  // 1. Quality score is very high (> 0.5)
  // 2. No clarification needed
  // 3. High model confidence (> 0.8)
  return (
    qualityScore > 0.5 &&
    (!clarificationState || clarificationState === "none" || clarificationState === "answered") &&
    confidence > 0.8
  );
}

/**
 * Determine if suggestion should be shown at all
 * Filter out very low quality suggestions
 */
export function shouldShowSuggestion(
  qualityScore: number,
  totalGenerated: number
): boolean {
  // Filter if:
  // 1. Quality score is very negative (< -0.3) AND
  // 2. We have sufficient data (> 10 samples)
  if (qualityScore < -0.3 && totalGenerated > 10) {
    return false;
  }
  
  return true;
}

/**
 * Determine if suggestion needs clarification
 * Based on confidence and quality scores
 */
export function suggestClarification(
  confidence: number,
  qualityScore: number | undefined,
  clarificationRate: number | undefined
): boolean {
  // Suggest clarification if:
  // 1. Low model confidence (< 0.6) OR
  // 2. Rule has high clarification rate (> 0.3)
  const lowConfidence = confidence < 0.6;
  const highClarificationRate = (clarificationRate || 0) > 0.3;
  
  return lowConfidence || highClarificationRate;
}
