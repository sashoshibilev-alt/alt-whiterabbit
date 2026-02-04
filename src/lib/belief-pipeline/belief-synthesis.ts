/**
 * Stage 4: Belief Synthesis
 * 
 * Synthesizes beliefs from candidates, generating before/after states,
 * summaries, and initial confidence scores
 */

import {
  Stage3Output,
  Stage4Output,
  BeliefCandidate,
  Belief,
  BeliefSourceType,
  Utterance,
  BeliefEvidenceSpan,
} from './types';
import { generateId, isVagueSubjectHandle } from './utils';

/**
 * Get utterance text by ID
 */
function getUtteranceText(utterances: Utterance[], utteranceId: string): string {
  const utterance = utterances.find(u => u.id === utteranceId);
  return utterance ? utterance.text : '';
}

/**
 * Synthesize before_state from before_spans
 */
function synthesizeBeforeState(
  candidate: BeliefCandidate,
  utterances: Utterance[]
): string {
  if (candidate.before_spans.length === 0) {
    return `Previous plan for ${candidate.subject_handle} (unspecified in this meeting)`;
  }
  
  // Concatenate all before span texts
  const texts = candidate.before_spans.map(span => 
    getUtteranceText(utterances, span.utterance_id)
  );
  
  return texts.join(' ');
}

/**
 * Synthesize after_state from after_spans
 */
function synthesizeAfterState(
  candidate: BeliefCandidate,
  utterances: Utterance[]
): string {
  if (candidate.after_spans.length === 0) {
    // If no explicit after state, try to infer from supporting spans
    if (candidate.supporting_spans.length > 0) {
      const texts = candidate.supporting_spans.map(span =>
        getUtteranceText(utterances, span.utterance_id)
      );
      return texts.join(' ');
    }
    return `Updated plan for ${candidate.subject_handle} (details unclear)`;
  }
  
  // Concatenate all after span texts
  const texts = candidate.after_spans.map(span =>
    getUtteranceText(utterances, span.utterance_id)
  );
  
  return texts.join(' ');
}

/**
 * Determine source type based on before/after presence
 */
function determineSourceType(candidate: BeliefCandidate): BeliefSourceType {
  const hasBefore = candidate.before_spans.length > 0;
  const hasAfter = candidate.after_spans.length > 0;
  
  if (hasBefore && hasAfter) {
    return 'explicit';
  }
  
  if (!hasBefore && hasAfter) {
    return 'external'; // Before state depends on prior context
  }
  
  if (hasBefore && !hasAfter) {
    return 'implicit'; // After state is implied
  }
  
  return 'implicit'; // Neither clearly stated
}

/**
 * Generate a summary of the belief delta
 */
function generateSummary(
  candidate: BeliefCandidate,
  beforeState: string,
  afterState: string
): string {
  const dimension = candidate.dimension;
  const subject = candidate.subject_handle;
  
  // Generate a simple template-based summary
  return `${dimension} change for ${subject}: from "${beforeState.substring(0, 50)}..." to "${afterState.substring(0, 50)}..."`;
}

/**
 * Synthesize a single belief from a candidate
 */
function synthesizeBelief(
  candidate: BeliefCandidate,
  utterances: Utterance[],
  modelVersion: string
): Belief {
  const beforeState = synthesizeBeforeState(candidate, utterances);
  const afterState = synthesizeAfterState(candidate, utterances);
  const sourceType = determineSourceType(candidate);
  const summary = generateSummary(candidate, beforeState, afterState);
  
  // Combine all evidence spans
  const evidenceSpans: BeliefEvidenceSpan[] = [
    ...candidate.before_spans,
    ...candidate.after_spans,
    ...candidate.supporting_spans,
  ];
  
  // Collect supporting and contradicting utterance IDs
  const supportingUtteranceIds = [
    ...candidate.before_spans.map(s => s.utterance_id),
    ...candidate.after_spans.map(s => s.utterance_id),
    ...candidate.supporting_spans.map(s => s.utterance_id),
  ];
  
  return {
    id: generateId(),
    meeting_id: candidate.meeting_id,
    created_at: new Date().toISOString(),
    dimension: candidate.dimension,
    subject_handle: candidate.subject_handle,
    summary,
    before_state: beforeState,
    after_state: afterState,
    source_type: sourceType,
    evidence_spans: evidenceSpans,
    confidence_score: candidate.candidate_score, // Will be updated in Stage 5
    confidence_band: 'uncertain', // Will be updated in Stage 5
    needs_clarification: false, // Will be updated in Stage 5
    clarification_reasons: [], // Will be updated in Stage 5
    supporting_utterance_ids: supportingUtteranceIds,
    contradicting_utterance_ids: [],
    model_version: modelVersion,
    upstream_candidate_ids: [candidate.id],
  };
}

/**
 * Synthesize beliefs from all candidates
 */
export function synthesizeBeliefs(
  stage3Output: Stage3Output,
  modelVersion: string = 'belief-pipeline-v0.1'
): Stage4Output {
  const { meeting, sections, utterances, candidates } = stage3Output;
  
  const beliefs = candidates.map(candidate =>
    synthesizeBelief(candidate, utterances, modelVersion)
  );
  
  return {
    meeting,
    sections,
    utterances,
    candidates,
    beliefs,
  };
}
