/**
 * Guardrail Filter
 * 
 * Implements clustering, deduplication, soft caps, and priority scoring
 * to reduce spam while preserving signal. Never drops suggestions due
 * to insufficient structure; uses needs_clarification and aggregation instead.
 */

import type {
  BeliefWithRouting,
  BeliefCluster,
  InitiativeSuggestion,
  SuggestionThresholds,
} from './types';

/**
 * Cluster beliefs by initiative, implication kind, and topic similarity
 */
export function clusterBeliefs(
  beliefs: BeliefWithRouting[],
  thresholds: SuggestionThresholds
): BeliefCluster[] {
  const clusters: BeliefCluster[] = [];
  const processed = new Set<string>();
  
  for (const belief of beliefs) {
    if (processed.has(belief.id)) {
      continue;
    }
    
    // Find similar beliefs
    const similar = beliefs.filter(b => {
      if (processed.has(b.id)) return false;
      if (b.id === belief.id) return true;
      
      // Must target same initiative (or both ambiguous)
      if (belief.subject_initiative_id !== b.subject_initiative_id) {
        return false;
      }
      
      // Must have same dimension
      if (belief.dimension !== b.dimension) {
        return false;
      }
      
      // Check topic similarity if embeddings available
      if (belief.topic_embedding && b.topic_embedding) {
        const similarity = cosineSimilarity(belief.topic_embedding, b.topic_embedding);
        return similarity >= thresholds.embedding_similarity_threshold;
      }
      
      // Fallback: text similarity
      return textSimilarity(belief.summary, b.summary) >= 0.7;
    });
    
    if (similar.length > 0) {
      // Mark as processed
      similar.forEach(b => processed.add(b.id));
      
      // Create cluster
      const cluster: BeliefCluster = {
        cluster_id: `cluster_${clusters.length + 1}`,
        beliefs: similar,
        target_initiative_id: belief.subject_initiative_id,
        implication_kind: 'pure_commentary', // will be refined
        aggregate_confidence: similar.reduce((sum, b) => sum + b.confidence_score, 0) / similar.length,
      };
      
      // Compute centroid if embeddings available
      if (belief.topic_embedding) {
        cluster.topic_centroid = computeCentroid(similar.map(b => b.topic_embedding).filter(e => e !== undefined) as number[][]);
      }
      
      clusters.push(cluster);
    }
  }
  
  return clusters;
}

/**
 * Deduplicate suggestions across meetings
 */
export function deduplicateSuggestions(
  newSuggestions: InitiativeSuggestion[],
  existingSuggestions: InitiativeSuggestion[],
  thresholds: SuggestionThresholds
): InitiativeSuggestion[] {
  const deduplicated: InitiativeSuggestion[] = [];
  
  for (const suggestion of newSuggestions) {
    // Check if similar suggestion already exists
    const duplicate = existingSuggestions.find(existing => {
      // Must be same action type
      if (existing.action !== suggestion.action) return false;
      
      // Must target same initiative
      if (existing.target_initiative_id !== suggestion.target_initiative_id) return false;
      
      // Must be open (not applied/dismissed)
      // For now, we assume existingSuggestions are open
      
      // Check content similarity
      const existingContent = getPayloadContent(existing);
      const newContent = getPayloadContent(suggestion);
      
      return textSimilarity(existingContent, newContent) >= 0.8;
    });
    
    if (duplicate) {
      // Merge evidence into existing
      mergeEvidence(duplicate, suggestion);
    } else {
      deduplicated.push(suggestion);
    }
  }
  
  return deduplicated;
}

/**
 * Apply rate limits (soft caps) to suggestions
 */
export function applyRateLimits(
  suggestions: InitiativeSuggestion[],
  thresholds: SuggestionThresholds,
  meetingId: string
): InitiativeSuggestion[] {
  // Group by initiative and action
  const byInitiativeAndAction = new Map<string, InitiativeSuggestion[]>();
  
  for (const suggestion of suggestions) {
    const key = `${suggestion.target_initiative_id || 'unscoped'}::${suggestion.action}`;
    if (!byInitiativeAndAction.has(key)) {
      byInitiativeAndAction.set(key, []);
    }
    byInitiativeAndAction.get(key)!.push(suggestion);
  }
  
  const result: InitiativeSuggestion[] = [];
  
  // Apply caps per initiative per action
  for (const [key, groupSuggestions] of byInitiativeAndAction.entries()) {
    const parts = key.split('::');
    const action = parts[1];
    
    // Determine cap
    let cap = 5; // default
    if (action === 'comment') {
      cap = thresholds.max_comment_suggestions_per_initiative_per_meeting;
    } else if (action === 'mutate_release_date') {
      cap = thresholds.max_release_date_suggestions_per_initiative_per_meeting;
    }
    
    // Sort by priority
    groupSuggestions.sort((a, b) => b.priority_score - a.priority_score);
    
    // Take top N
    const topN = groupSuggestions.slice(0, cap);
    result.push(...topN);
    
    // For overflow, aggregate into existing or downgrade
    const overflow = groupSuggestions.slice(cap);
    for (const overflowSugg of overflow) {
      // Try to merge into top suggestion
      if (topN.length > 0) {
        const target = topN[0];
        mergeEvidence(target, overflowSugg);
        
        // Update payload to mention aggregation
        if (target.action === 'comment' && 'body' in target.payload) {
          const payload = target.payload as any;
          if (!payload.body.includes('Multiple meetings')) {
            payload.body = `Ongoing: ${payload.body}`;
          }
        }
      }
    }
  }
  
  return result;
}

/**
 * Score and rank suggestions
 */
export function scoreAndRankSuggestions(
  suggestions: InitiativeSuggestion[]
): InitiativeSuggestion[] {
  // Priority score is already computed in builder
  // Just sort by priority
  const sorted = [...suggestions];
  sorted.sort((a, b) => {
    // Higher priority first
    if (b.priority_score !== a.priority_score) {
      return b.priority_score - a.priority_score;
    }
    
    // Then by lower spam score
    return a.spam_score - b.spam_score;
  });
  
  return sorted;
}

/**
 * Apply all guardrails in sequence
 */
export function applyGuardrails(
  suggestions: InitiativeSuggestion[],
  existingSuggestions: InitiativeSuggestion[],
  thresholds: SuggestionThresholds,
  meetingId: string,
  enableDedup: boolean = true
): InitiativeSuggestion[] {
  let filtered = suggestions;
  
  // 1. Deduplicate against existing
  if (enableDedup) {
    filtered = deduplicateSuggestions(filtered, existingSuggestions, thresholds);
  }
  
  // 2. Apply rate limits
  filtered = applyRateLimits(filtered, thresholds, meetingId);
  
  // 3. Score and rank
  filtered = scoreAndRankSuggestions(filtered);
  
  return filtered;
}

// ============================================
// Helper Functions
// ============================================

/**
 * Compute cosine similarity between two vectors
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  
  normA = Math.sqrt(normA);
  normB = Math.sqrt(normB);
  
  if (normA === 0 || normB === 0) return 0;
  
  return dotProduct / (normA * normB);
}

/**
 * Compute text similarity (simple word overlap)
 */
function textSimilarity(text1: string, text2: string): number {
  const words1 = new Set(text1.toLowerCase().split(/\s+/).filter(w => w.length >= 3));
  const words2 = new Set(text2.toLowerCase().split(/\s+/).filter(w => w.length >= 3));
  
  if (words1.size === 0 || words2.size === 0) return 0;
  
  let intersection = 0;
  for (const word of words1) {
    if (words2.has(word)) {
      intersection++;
    }
  }
  
  const union = words1.size + words2.size - intersection;
  return intersection / union;
}

/**
 * Compute centroid of embeddings
 */
function computeCentroid(embeddings: number[][]): number[] {
  if (embeddings.length === 0) return [];
  
  const dim = embeddings[0].length;
  const centroid = new Array(dim).fill(0);
  
  for (const embedding of embeddings) {
    for (let i = 0; i < dim; i++) {
      centroid[i] += embedding[i];
    }
  }
  
  for (let i = 0; i < dim; i++) {
    centroid[i] /= embeddings.length;
  }
  
  return centroid;
}

/**
 * Get payload content for comparison
 */
function getPayloadContent(suggestion: InitiativeSuggestion): string {
  if (suggestion.action === 'comment') {
    return (suggestion.payload as any).body || '';
  } else if (suggestion.action === 'mutate_release_date') {
    return (suggestion.payload as any).rationale || '';
  }
  return '';
}

/**
 * Merge evidence from source into target suggestion
 */
function mergeEvidence(
  target: InitiativeSuggestion,
  source: InitiativeSuggestion
): void {
  // Add belief IDs
  for (const beliefId of source.belief_ids) {
    if (!target.belief_ids.includes(beliefId)) {
      target.belief_ids.push(beliefId);
    }
  }
  
  // Add evidence spans
  for (const span of source.evidence_spans) {
    const exists = target.evidence_spans.some(
      s => s.belief_id === span.belief_id &&
           s.start_char === span.start_char &&
           s.end_char === span.end_char
    );
    if (!exists) {
      target.evidence_spans.push(span);
    }
  }
  
  // Boost priority slightly
  target.priority_score = Math.min(1, target.priority_score + 0.05);
}

/**
 * Filter suggestions by confidence threshold
 */
export function filterByConfidence(
  suggestions: InitiativeSuggestion[],
  minConfidence: number
): InitiativeSuggestion[] {
  // Note: per spec, we don't drop low-confidence suggestions
  // Instead, we mark them as needs_clarification if not already
  return suggestions.map(s => {
    if (s.action === 'mutate_release_date') {
      const payload = s.payload as any;
      if (payload.confidence < minConfidence && s.status === 'suggested') {
        return {
          ...s,
          status: 'needs_clarification' as const,
        };
      }
    }
    return s;
  });
}
