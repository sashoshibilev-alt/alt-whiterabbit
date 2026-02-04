/**
 * Belief-First Reasoning Pipeline API
 * 
 * Convex functions for executing the belief-first pipeline
 */

import { v } from 'convex/values';
import { query, mutation } from './_generated/server';

// Validator for MeetingNote input
const meetingNoteValidator = v.object({
  id: v.string(),
  occurred_at: v.string(), // ISO DateTime
  raw_markdown: v.string(),
});

// Validator for pipeline config
const pipelineConfigValidator = v.optional(
  v.object({
    model_version: v.optional(v.string()),
    include_introspection: v.optional(v.boolean()),
    confidence_threshold_high: v.optional(v.number()),
    confidence_threshold_uncertain: v.optional(v.number()),
    evidence_boost_weight: v.optional(v.number()),
    structure_bonus_weight: v.optional(v.number()),
    contradiction_penalty: v.optional(v.number()),
  })
);

/**
 * Extract beliefs from a meeting note
 * 
 * This is the main API endpoint for the belief-first pipeline.
 * Takes a meeting note and returns structured beliefs.
 */
export const extractBeliefs = mutation({
  args: {
    note: meetingNoteValidator,
    config: pipelineConfigValidator,
  },
  handler: async (ctx, args) => {
    // Dynamic import to avoid issues with server-side execution
    const { executeBeliefPipeline, DEFAULT_PIPELINE_CONFIG } = await import(
      '../src/lib/belief-pipeline/index'
    );
    
    const config = {
      ...DEFAULT_PIPELINE_CONFIG,
      ...args.config,
    };
    
    // Execute the pipeline
    const result = await executeBeliefPipeline(args.note, config);
    
    return result;
  },
});

/**
 * Extract beliefs from an existing note in the database
 * 
 * Convenience function that loads a note from the database and runs the pipeline
 */
export const extractBeliefsFromNote = mutation({
  args: {
    noteId: v.id('notes'),
    config: pipelineConfigValidator,
  },
  handler: async (ctx, args) => {
    // Load the note
    const note = await ctx.db.get(args.noteId);
    
    if (!note) {
      throw new Error(`Note not found: ${args.noteId}`);
    }
    
    // Check if note is deleted
    if (note.isDeleted) {
      throw new Error(`Note is deleted: ${args.noteId}`);
    }
    
    // Convert to MeetingNote format
    const meetingNote = {
      id: note._id,
      occurred_at: note.meetingAt
        ? new Date(note.meetingAt).toISOString()
        : new Date(note.capturedAt).toISOString(),
      raw_markdown: note.body,
    };
    
    // Dynamic import
    const { executeBeliefPipeline, DEFAULT_PIPELINE_CONFIG } = await import(
      '../src/lib/belief-pipeline/index'
    );
    
    const config = {
      ...DEFAULT_PIPELINE_CONFIG,
      ...args.config,
    };
    
    // Execute the pipeline
    const result = await executeBeliefPipeline(meetingNote, config);
    
    return result;
  },
});

/**
 * Query to get pipeline configuration
 * 
 * Returns the default pipeline configuration
 */
export const getPipelineConfig = query({
  args: {},
  handler: async () => {
    const { DEFAULT_PIPELINE_CONFIG } = await import(
      '../src/lib/belief-pipeline/index'
    );
    
    return DEFAULT_PIPELINE_CONFIG;
  },
});
