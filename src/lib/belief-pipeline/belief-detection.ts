/**
 * Stage 3: Belief Candidate Detection
 * 
 * Classifies utterances and groups them into belief candidates
 */

import {
  Stage2Output,
  Stage3Output,
  Utterance,
  UtteranceClassification,
  BeliefCandidate,
  BeliefEvidenceSpan,
  BeliefDimension,
  UtteranceLabel,
  ChangeRole,
} from './types';
import { generateId, stringSimilarity, normalizeSubjectHandle, groupBy, mean, max } from './utils';

/**
 * Pattern-based utterance classifier
 * 
 * In production, this would be replaced with an LLM-based classifier
 * For now, uses heuristics and keyword matching
 */
export function classifyUtterance(utterance: Utterance): UtteranceClassification {
  const text = utterance.text.toLowerCase();
  
  // Detect dimension
  let dimension: BeliefDimension | null = null;
  let label: UtteranceLabel = 'noise';
  let change_role: ChangeRole = 'none';
  let subject_handle: string | null = null;
  let local_confidence = 0.5;
  
  // Timeline keywords
  if (
    /\b(deadline|date|schedule|timeline|postpone|delay|move|shift|week|month|quarter|release)\b/.test(text)
  ) {
    dimension = 'timeline';
    label = 'plan_change';
    local_confidence = 0.7;
    
    // Extract subject handle (simple heuristic)
    const subjectMatch = text.match(/\b([\w\s]{2,30}?)\s+(deadline|release|timeline)/);
    if (subjectMatch) {
      subject_handle = subjectMatch[1].trim();
    }
  }
  
  // Scope keywords
  if (
    /\b(scope|feature|add|remove|include|exclude|functionality|capability|requirement)\b/.test(text)
  ) {
    dimension = 'scope';
    label = 'plan_change';
    local_confidence = 0.7;
    
    const subjectMatch = text.match(/\b([\w\s]{2,30}?)\s+(feature|scope|functionality)/);
    if (subjectMatch) {
      subject_handle = subjectMatch[1].trim();
    }
  }
  
  // Ownership keywords
  if (
    /\b(owner|owned|assign|responsible|lead|team|transfer|handoff)\b/.test(text)
  ) {
    dimension = 'ownership';
    label = 'plan_change';
    local_confidence = 0.7;
    
    const subjectMatch = text.match(/\b([\w\s]{2,30}?)\s+(owner|ownership|lead)/);
    if (subjectMatch) {
      subject_handle = subjectMatch[1].trim();
    }
  }
  
  // Priority keywords
  if (
    /\b(priority|prioritize|critical|urgent|important|p0|p1|high priority|low priority)\b/.test(text)
  ) {
    dimension = 'priority';
    label = 'plan_change';
    local_confidence = 0.7;
    
    const subjectMatch = text.match(/\b([\w\s]{2,30}?)\s+(priority|urgent|critical)/);
    if (subjectMatch) {
      subject_handle = subjectMatch[1].trim();
    }
  }
  
  // Dependency keywords
  if (
    /\b(depends on|dependency|blocked by|blocks|requires|prerequisite|waiting for)\b/.test(text)
  ) {
    dimension = 'dependency';
    label = 'plan_change';
    local_confidence = 0.7;
    
    const subjectMatch = text.match(/\b([\w\s]{2,30}?)\s+(depends|blocked|requires)/);
    if (subjectMatch) {
      subject_handle = subjectMatch[1].trim();
    }
  }
  
  // Risk keywords
  if (
    /\b(risk|concern|issue|problem|challenge|blocker|mitigation)\b/.test(text)
  ) {
    dimension = 'risk';
    label = 'plan_change';
    local_confidence = 0.6;
    
    const subjectMatch = text.match(/\b([\w\s]{2,30}?)\s+(risk|concern|issue)/);
    if (subjectMatch) {
      subject_handle = subjectMatch[1].trim();
    }
  }
  
  // Status keywords
  if (
    /\b(status|progress|complete|done|started|in progress|blocked|on track)\b/.test(text)
  ) {
    dimension = 'status';
    label = 'status'; // Status updates are not plan changes
    local_confidence = 0.8;
    
    const subjectMatch = text.match(/\b([\w\s]{2,30}?)\s+(status|progress|complete)/);
    if (subjectMatch) {
      subject_handle = subjectMatch[1].trim();
    }
  }
  
  // Decision keywords
  if (
    /\b(decided|decision|choose|chose|selected|picked|agreed|consensus)\b/.test(text)
  ) {
    dimension = 'decision';
    label = 'plan_change';
    local_confidence = 0.8;
    
    const subjectMatch = text.match(/\b([\w\s]{2,30}?)\s+(decided|decision|choose)/);
    if (subjectMatch) {
      subject_handle = subjectMatch[1].trim();
    }
  }
  
  // Detect before/after roles
  if (label === 'plan_change') {
    if (
      /\b(was|were|previously|before|originally|old|current)\b/.test(text)
    ) {
      change_role = 'before';
      local_confidence = Math.min(local_confidence + 0.1, 1.0);
    } else if (
      /\b(will be|now|new|updated|changed to|moving to|going to)\b/.test(text)
    ) {
      change_role = 'after';
      local_confidence = Math.min(local_confidence + 0.1, 1.0);
    }
  }
  
  // If no dimension detected but we have change keywords, mark as "other"
  if (
    dimension === null &&
    /\b(change|update|modify|adjust|revise)\b/.test(text)
  ) {
    dimension = 'other';
    label = 'plan_change';
    local_confidence = 0.5;
  }
  
  // Fallback: if still no label, it's noise
  if (label === 'noise') {
    dimension = null;
    subject_handle = null;
    local_confidence = 0.3;
  }
  
  // Extract subject handle if not found yet
  if (subject_handle === null && label === 'plan_change') {
    // Try to extract a noun phrase from the beginning of the sentence
    const nounMatch = text.match(/^(the |a |an )?([\w\s]{3,40}?)(\s+is|\s+was|\s+will|\s+should)/);
    if (nounMatch) {
      subject_handle = nounMatch[2].trim();
    }
  }
  
  return {
    utterance_id: utterance.id,
    label,
    dimension,
    change_role,
    subject_handle: subject_handle ? normalizeSubjectHandle(subject_handle) : null,
    local_confidence,
  };
}

/**
 * Group classified utterances into belief candidate threads
 * 
 * Groups utterances by:
 * - Similar subject_handle (string similarity)
 * - Same or adjacent sections
 * - Similar dimension
 */
function groupIntoCandidates(
  classifications: UtteranceClassification[],
  utterances: Utterance[],
  meetingId: string
): BeliefCandidate[] {
  // Filter for plan_change classifications only
  const planChanges = classifications.filter(c => c.label === 'plan_change');
  
  if (planChanges.length === 0) {
    return [];
  }
  
  // Create a map of utterance_id to utterance for quick lookup
  const utteranceMap = new Map(utterances.map(u => [u.id, u]));
  
  // Group by dimension first
  const byDimension = groupBy(planChanges, c => c.dimension || 'other');
  
  const candidates: BeliefCandidate[] = [];
  
  for (const [dimension, dimClassifications] of Object.entries(byDimension)) {
    // Within each dimension, group by subject_handle similarity
    const threads: UtteranceClassification[][] = [];
    
    for (const classification of dimClassifications) {
      if (!classification.subject_handle) continue;
      
      // Find an existing thread with similar subject_handle
      let foundThread = false;
      for (const thread of threads) {
        const threadHandle = thread[0].subject_handle;
        if (
          threadHandle &&
          stringSimilarity(classification.subject_handle, threadHandle) >= 0.5
        ) {
          thread.push(classification);
          foundThread = true;
          break;
        }
      }
      
      // If no similar thread found, create a new one
      if (!foundThread) {
        threads.push([classification]);
      }
    }
    
    // Convert each thread to a BeliefCandidate
    for (const thread of threads) {
      if (thread.length === 0) continue;
      
      // Get the most common subject_handle
      const handleCounts = new Map<string, number>();
      for (const c of thread) {
        if (c.subject_handle) {
          handleCounts.set(
            c.subject_handle,
            (handleCounts.get(c.subject_handle) || 0) + 1
          );
        }
      }
      
      let subjectHandle = thread[0].subject_handle || 'unknown';
      let maxCount = 0;
      const handleCountsArray = Array.from(handleCounts.entries());
      for (const [handle, count] of handleCountsArray) {
        if (count > maxCount) {
          subjectHandle = handle;
          maxCount = count;
        }
      }
      
      // Separate by role
      const beforeSpans: BeliefEvidenceSpan[] = [];
      const afterSpans: BeliefEvidenceSpan[] = [];
      const supportingSpans: BeliefEvidenceSpan[] = [];
      
      for (const c of thread) {
        const utterance = utteranceMap.get(c.utterance_id);
        if (!utterance) continue;
        
        const span: BeliefEvidenceSpan = {
          id: generateId(),
          meeting_id: meetingId,
          section_id: utterance.section_id,
          utterance_id: utterance.id,
          start_char: utterance.start_char,
          end_char: utterance.end_char,
          role: c.change_role === 'before' ? 'before' : c.change_role === 'after' ? 'after' : 'supporting',
        };
        
        if (c.change_role === 'before') {
          beforeSpans.push(span);
        } else if (c.change_role === 'after') {
          afterSpans.push(span);
        } else {
          supportingSpans.push(span);
        }
      }
      
      // Calculate candidate score (mean or max of local confidences)
      const confidences = thread.map(c => c.local_confidence);
      const candidateScore = max(confidences);
      
      candidates.push({
        id: generateId(),
        meeting_id: meetingId,
        dimension: dimension as BeliefDimension,
        subject_handle: subjectHandle,
        before_spans: beforeSpans,
        after_spans: afterSpans,
        supporting_spans: supportingSpans,
        status_utterance_ids: [], // Status utterances not included for now
        candidate_score: candidateScore,
      });
    }
  }
  
  return candidates;
}

/**
 * Detect belief candidates from utterances
 */
export function detectBeliefCandidates(stage2Output: Stage2Output): Stage3Output {
  const { meeting, sections, utterances } = stage2Output;
  
  // Classify each utterance
  const classifications = utterances.map(classifyUtterance);
  
  // Group into candidates
  const candidates = groupIntoCandidates(classifications, utterances, meeting.id);
  
  return {
    meeting,
    sections,
    utterances,
    classifications,
    candidates,
  };
}
