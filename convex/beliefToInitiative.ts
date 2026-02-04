/**
 * Belief-to-Initiative Suggestion Conversion API
 * 
 * Convex functions for converting beliefs into initiative-level suggestions
 */

import { v } from 'convex/values';
import { query, mutation, action, internalMutation } from './_generated/server';
import { internal } from './_generated/api';

// ============================================
// Validators
// ============================================

const evidenceSpanValidator = v.object({
  belief_id: v.string(),
  meeting_id: v.string(),
  note_id: v.string(),
  start_char: v.number(),
  end_char: v.number(),
  snippet: v.string(),
  speaker: v.optional(v.string()),
  timestamp_ms: v.optional(v.number()),
});

const commentPayloadValidator = v.object({
  body: v.string(),
  tone: v.optional(v.union(
    v.literal('neutral'),
    v.literal('caution'),
    v.literal('opportunity')
  )),
});

const mutateReleaseDatePayloadValidator = v.object({
  current_release_date: v.string(),
  proposed_release_date: v.union(v.string(), v.null()),
  direction: v.union(v.literal('push_back'), v.literal('pull_in')),
  rationale: v.string(),
  confidence: v.number(),
});

const initiativeSuggestionValidator = v.object({
  id: v.string(),
  target_initiative_id: v.optional(v.string()),
  action: v.union(v.literal('comment'), v.literal('mutate_release_date')),
  status: v.union(v.literal('suggested'), v.literal('needs_clarification')),
  payload: v.any(), // Union of comment/release date payloads
  belief_ids: v.array(v.string()),
  evidence_spans: v.array(evidenceSpanValidator),
  created_from_meeting_id: v.optional(v.string()),
  created_at: v.string(),
  spam_score: v.number(),
  priority_score: v.number(),
});

// ============================================
// Storage
// ============================================

/**
 * Store initiative suggestions generated from beliefs
 */
export const storeInitiativeSuggestions = internalMutation({
  args: {
    noteId: v.id('notes'),
    suggestions: v.array(initiativeSuggestionValidator),
  },
  handler: async (ctx, args) => {
    const ids = [];
    
    for (const suggestion of args.suggestions) {
      // Convert to storage format (reuse existing suggestions table)
      const content = formatSuggestionContent(suggestion);
      
      const id = await ctx.db.insert('suggestions', {
        noteId: args.noteId,
        content,
        status: 'new',
        createdAt: Date.now(),
        modelVersion: 'belief-to-initiative-v1.0',
        // Store metadata as JSON in a custom field (would need schema update)
        // For now, embed in content
      });
      
      ids.push(id);
    }
    
    return ids;
  },
});

/**
 * Format suggestion for storage
 */
function formatSuggestionContent(suggestion: any): string {
  if (suggestion.action === 'comment') {
    const payload = suggestion.payload;
    const prefix = suggestion.status === 'needs_clarification' ? '[Needs Clarification] ' : '';
    return `${prefix}${payload.body}`;
  } else if (suggestion.action === 'mutate_release_date') {
    const payload = suggestion.payload;
    const prefix = suggestion.status === 'needs_clarification' ? '[Needs Clarification] ' : '';
    const direction = payload.direction === 'push_back' ? 'Push back' : 'Pull in';
    
    if (payload.proposed_release_date) {
      return `${prefix}[Timeline Change] ${direction} release date to ${payload.proposed_release_date}\n\n${payload.rationale}`;
    } else {
      return `${prefix}[Timeline Risk] ${payload.rationale}`;
    }
  }
  
  return suggestion.payload.body || suggestion.payload.rationale || 'Suggestion';
}

// ============================================
// Feedback Collection
// ============================================

const feedbackActionValidator = v.union(
  v.literal('accepted'),
  v.literal('dismissed'),
  v.literal('edited')
);

const dismissReasonValidator = v.union(
  v.literal('wrong_initiative'),
  v.literal('not_real_decision'),
  v.literal('too_ambiguous'),
  v.literal('wrong_value'),
  v.literal('spam'),
  v.literal('duplicate'),
  v.literal('other')
);

/**
 * Record feedback on a suggestion
 */
export const recordSuggestionFeedback = mutation({
  args: {
    suggestionId: v.id('suggestions'),
    action: feedbackActionValidator,
    dismissReason: v.optional(dismissReasonValidator),
    timeToActionSeconds: v.optional(v.number()),
    userId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // For now, we can store this as a suggestion event
    // In a full implementation, we'd have a dedicated feedbackEvents table
    
    const suggestion = await ctx.db.get(args.suggestionId);
    if (!suggestion) {
      throw new Error('Suggestion not found');
    }
    
    // Create event based on action
    let eventType: 'applied' | 'dismissed' = 'applied';
    if (args.action === 'dismissed') {
      eventType = 'dismissed';
    }
    
    await ctx.db.insert('suggestionEvents', {
      noteId: suggestion.noteId,
      suggestionId: args.suggestionId,
      eventType,
      createdAt: Date.now(),
      timeToEventSeconds: args.timeToActionSeconds,
      dismissReason: args.dismissReason as any,
    });
    
    return { success: true };
  },
});

/**
 * Query feedback stats for threshold adjustment
 */
export const getFeedbackStats = query({
  args: {
    startDate: v.optional(v.number()),
    endDate: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Get all suggestion events in date range
    let eventsQuery = ctx.db.query('suggestionEvents');
    
    if (args.startDate) {
      eventsQuery = eventsQuery.filter(q => q.gte(q.field('createdAt'), args.startDate!));
    }
    
    if (args.endDate) {
      eventsQuery = eventsQuery.filter(q => q.lte(q.field('createdAt'), args.endDate!));
    }
    
    const events = await eventsQuery.collect();
    
    // Compute basic stats
    const totalApplied = events.filter(e => e.eventType === 'applied').length;
    const totalDismissed = events.filter(e => e.eventType === 'dismissed').length;
    const totalShown = events.filter(e => e.eventType === 'shown').length;
    
    const acceptanceRate = totalShown > 0 ? totalApplied / totalShown : 0;
    const dismissalRate = totalShown > 0 ? totalDismissed / totalShown : 0;
    
    // Dismiss reasons breakdown
    const dismissReasons: Record<string, number> = {};
    for (const event of events) {
      if (event.eventType === 'dismissed' && event.dismissReason) {
        dismissReasons[event.dismissReason] = (dismissReasons[event.dismissReason] || 0) + 1;
      }
    }
    
    return {
      totalApplied,
      totalDismissed,
      totalShown,
      acceptanceRate,
      dismissalRate,
      dismissReasons,
    };
  },
});

// ============================================
// Action: Generate Initiative Suggestions from Beliefs
// ============================================

/**
 * Generate initiative suggestions from beliefs for a note
 */
export const generateFromBeliefs = action({
  args: {
    noteId: v.id('notes'),
  },
  handler: async (ctx, args) => {
    // 1. Extract beliefs from note
    const beliefResult = await ctx.runMutation(internal.beliefPipeline.extractBeliefsFromNote, {
      noteId: args.noteId,
    });
    
    // 2. Convert beliefs to suggestions (this would call the TS library)
    // For now, return a placeholder response
    // In a real implementation, we'd:
    // - Load the belief-to-initiative library
    // - Execute the pipeline
    // - Store the resulting suggestions
    
    // const { executeBeliefToSuggestionPipeline } = await import('../src/lib/belief-to-initiative');
    // const result = executeBeliefToSuggestionPipeline(beliefs, existingSuggestions);
    
    // 3. Store suggestions
    // await ctx.runMutation(internal.beliefToInitiative.storeInitiativeSuggestions, {
    //   noteId: args.noteId,
    //   suggestions: result.suggestions,
    // });
    
    return {
      success: true,
      beliefs_extracted: beliefResult.beliefs?.length || 0,
      suggestions_generated: 0, // placeholder
    };
  },
});
