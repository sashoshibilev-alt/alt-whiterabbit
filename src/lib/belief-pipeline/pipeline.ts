/**
 * Belief-First Reasoning Pipeline
 * 
 * Main orchestrator that executes all pipeline stages sequentially
 */

import {
  MeetingNote,
  BeliefExtractionResult,
  BeliefPipelineConfig,
  DEFAULT_PIPELINE_CONFIG,
} from './types';
import { normalizeMeetingNote } from './normalization';
import { segmentMeetingNote } from './segmentation';
import { extractUtterances } from './utterance-extraction';
import { detectBeliefCandidates } from './belief-detection';
import { synthesizeBeliefs } from './belief-synthesis';
import { scoreBeliefs } from './scoring';

/**
 * Execute the complete belief-first reasoning pipeline
 * 
 * @param note - Meeting note input
 * @param config - Pipeline configuration (optional)
 * @returns BeliefExtractionResult with beliefs and optional introspection data
 */
export async function executeBeliefPipeline(
  note: MeetingNote,
  config: BeliefPipelineConfig = DEFAULT_PIPELINE_CONFIG
): Promise<BeliefExtractionResult> {
  // Stage 0: Input Normalization
  const normalized = normalizeMeetingNote(note);
  
  // Stage 1: Section Segmentation
  const stage1 = segmentMeetingNote(normalized);
  
  // Stage 2: Utterance Extraction
  const stage2 = extractUtterances(stage1);
  
  // Stage 3: Belief Candidate Detection
  const stage3 = detectBeliefCandidates(stage2);
  
  // Stage 4: Belief Synthesis
  const stage4 = synthesizeBeliefs(stage3, config.model_version);
  
  // Stage 5: Scoring & Confidence
  const stage5 = scoreBeliefs(stage4, config);
  
  // Stage 6: Output Assembly
  const result: BeliefExtractionResult = {
    meeting_id: note.id,
    beliefs: stage5.beliefs,
  };
  
  // Include introspection data if requested
  if (config.include_introspection) {
    result.sections = stage5.sections;
    result.utterances = stage5.utterances;
  }
  
  return result;
}

/**
 * Execute pipeline stages individually for debugging/testing
 */
export const stages = {
  normalizeMeetingNote,
  segmentMeetingNote,
  extractUtterances,
  detectBeliefCandidates,
  synthesizeBeliefs,
  scoreBeliefs,
};
