/**
 * Belief-to-Initiative V2 Integration
 * 
 * Convex integration for the V2 belief-driven visibility pipeline.
 * Supports feature flagging between V1 and V2.
 */

import { v } from 'convex/values';
import { query, mutation, action, internalMutation } from './_generated/server';
import { internal } from './_generated/api';

// Feature flag configuration
const FEATURE_FLAG_VALIDATOR = v.union(
  v.literal('v1'),
  v.literal('v2'),
  v.literal('dual_run')  // Run both V1 and V2, log comparison
);

/**
 * Get current feature flag setting
 * 
 * Default: v1 (safe rollout)
 * Can be overridden per-note or globally via config
 */
export const getFeatureFlag = query({
  args: {
    noteId: v.optional(v.id('notes')),
  },
  handler: async (ctx, args) => {
    // For now, return a hardcoded default
    // In production, this would read from a config table
    return 'v1' as const;
  },
});

/**
 * Set feature flag for testing/gradual rollout
 */
export const setFeatureFlag = mutation({
  args: {
    flag: FEATURE_FLAG_VALIDATOR,
    noteId: v.optional(v.id('notes')),
  },
  handler: async (ctx, args) => {
    // Store flag in a config table
    // For now, this is a placeholder
    return {
      success: true,
      message: `Feature flag would be set to ${args.flag}`,
    };
  },
});

/**
 * Generate initiative suggestions from beliefs (V2-aware)
 * 
 * Supports three modes via feature flag:
 * - v1: Use original pipeline
 * - v2: Use new belief-driven visibility pipeline
 * - dual_run: Run both, compare, log differences
 */
export const generateFromBeliefsV2 = action({
  args: {
    noteId: v.id('notes'),
    featureFlag: v.optional(FEATURE_FLAG_VALIDATOR),
  },
  handler: async (ctx, args) => {
    // Determine which pipeline to use
    const flag = args.featureFlag || 'v1';
    
    // 1. Extract beliefs from note
    const beliefResult = await ctx.runMutation(internal.beliefPipeline.extractBeliefsFromNote, {
      noteId: args.noteId,
    });
    
    const beliefs = beliefResult.beliefs || [];
    
    if (flag === 'v1') {
      // Use V1 pipeline (existing)
      return await runV1Pipeline(ctx, args.noteId, beliefs);
    } else if (flag === 'v2') {
      // Use V2 pipeline (new)
      return await runV2Pipeline(ctx, args.noteId, beliefs);
    } else if (flag === 'dual_run') {
      // Run both and compare
      return await runDualPipeline(ctx, args.noteId, beliefs);
    }
    
    throw new Error(`Invalid feature flag: ${flag}`);
  },
});

/**
 * Run V1 pipeline (original)
 */
async function runV1Pipeline(ctx: any, noteId: any, beliefs: any[]): Promise<any> {
  // Import V1 pipeline
  const { executeBeliefToSuggestionPipeline } = await import('../src/lib/belief-to-initiative');
  
  // Execute V1 pipeline
  const result = executeBeliefToSuggestionPipeline(beliefs, []);
  
  // Store suggestions
  if (result.suggestions.length > 0) {
    await ctx.runMutation(internal.beliefToInitiative.storeInitiativeSuggestions, {
      noteId,
      suggestions: result.suggestions,
    });
  }
  
  return {
    pipeline: 'v1',
    beliefs_extracted: beliefs.length,
    suggestions_generated: result.suggestions.length,
    debug: result.debug,
  };
}

/**
 * Run V2 pipeline (new belief-driven visibility)
 */
async function runV2Pipeline(ctx: any, noteId: any, beliefs: any[]): Promise<any> {
  // Import V2 pipeline
  const { executeBeliefToSuggestionPipelineV2 } = await import('../src/lib/belief-to-initiative-v2');
  
  // Execute V2 pipeline
  const result = executeBeliefToSuggestionPipelineV2(beliefs);
  
  // Store suggestions
  if (result.suggestions.length > 0) {
    await ctx.runMutation(internal.beliefToInitiative.storeInitiativeSuggestions, {
      noteId,
      suggestions: result.suggestions,
    });
  }
  
  return {
    pipeline: 'v2',
    beliefs_extracted: beliefs.length,
    suggestions_generated: result.suggestions.length,
    debug: result.debug,
  };
}

/**
 * Run both pipelines and compare (for validation)
 */
async function runDualPipeline(ctx: any, noteId: any, beliefs: any[]): Promise<any> {
  // Import both pipelines
  const { executeBeliefToSuggestionPipeline } = await import('../src/lib/belief-to-initiative');
  const { executeBeliefToSuggestionPipelineV2 } = await import('../src/lib/belief-to-initiative-v2');
  
  // Run both
  const v1Result = executeBeliefToSuggestionPipeline(beliefs, []);
  const v2Result = executeBeliefToSuggestionPipelineV2(beliefs);
  
  // Compare results
  const comparison = {
    v1_suggestion_count: v1Result.suggestions.length,
    v2_suggestion_count: v2Result.suggestions.length,
    difference: v2Result.suggestions.length - v1Result.suggestions.length,
    v1_action_distribution: countActions(v1Result.suggestions),
    v2_action_distribution: countActions(v2Result.suggestions),
    v1_clarification_count: countClarifications(v1Result.suggestions),
    v2_clarification_count: countClarifications(v2Result.suggestions),
    invariants_v2: {
      I1_holds: v2Result.debug?.invariant_I1_holds,
      I2_holds: v2Result.debug?.invariant_I2_holds,
      I5_holds: v2Result.debug?.invariant_I5_holds,
    },
  };
  
  // Store V2 suggestions (prefer V2 in dual-run mode for testing)
  if (v2Result.suggestions.length > 0) {
    await ctx.runMutation(internal.beliefToInitiative.storeInitiativeSuggestions, {
      noteId,
      suggestions: v2Result.suggestions,
    });
  }
  
  // Log comparison for analysis
  console.log('V1 vs V2 Comparison:', JSON.stringify(comparison, null, 2));
  
  return {
    pipeline: 'dual_run',
    beliefs_extracted: beliefs.length,
    v1_suggestions: v1Result.suggestions.length,
    v2_suggestions: v2Result.suggestions.length,
    comparison,
    debug_v1: v1Result.debug,
    debug_v2: v2Result.debug,
  };
}

/**
 * Helper: Count action types
 */
function countActions(suggestions: any[]): Record<string, number> {
  const counts: Record<string, number> = {
    comment: 0,
    mutate_release_date: 0,
  };
  
  for (const sugg of suggestions) {
    const action = sugg.action;
    if (action in counts) {
      counts[action]++;
    }
  }
  
  return counts;
}

/**
 * Helper: Count clarifications
 */
function countClarifications(suggestions: any[]): number {
  return suggestions.filter(s => s.status === 'needs_clarification').length;
}

/**
 * Query to get V2 pipeline stats for a note
 */
export const getV2PipelineStats = query({
  args: {
    noteId: v.id('notes'),
  },
  handler: async (ctx, args) => {
    // Get suggestions for this note
    const suggestions = await ctx.db
      .query('suggestions')
      .withIndex('by_noteId', (q) => q.eq('noteId', args.noteId))
      .collect();
    
    // Compute stats
    const v2Suggestions = suggestions.filter(s => 
      s.modelVersion?.includes('v2') || s.content.includes('[V2]')
    );
    
    return {
      total_suggestions: suggestions.length,
      v2_suggestions: v2Suggestions.length,
      action_distribution: {
        comment: suggestions.filter(s => s.content.includes('[Timeline')).length,
        mutate_release_date: suggestions.filter(s => s.content.includes('mutate_release_date')).length,
      },
      clarifications: suggestions.filter(s => s.clarificationState === 'needs_clarification').length,
    };
  },
});
