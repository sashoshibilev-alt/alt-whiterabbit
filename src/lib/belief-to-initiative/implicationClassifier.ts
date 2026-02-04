/**
 * Implication Classifier
 * 
 * Determines whether a belief implies commentary, timeline changes, or both.
 * Computes concrete date extraction and delta estimation.
 */

import type {
  BeliefWithRouting,
  BeliefImplication,
  ImplicationKind,
} from './types';

/**
 * Classify a belief's implication for initiative actions
 */
export function classifyImplication(belief: BeliefWithRouting): BeliefImplication {
  const kind = determineImplicationKind(belief);
  const hasConcrete = hasConcreteDate(belief);
  const estimatedDelta = estimateDeltaDays(belief);
  
  return {
    belief_id: belief.id,
    kind,
    has_concrete_date: hasConcrete,
    estimated_delta_days: estimatedDelta,
    confidence: belief.confidence_score,
  };
}

/**
 * Determine the kind of implication from a belief
 */
function determineImplicationKind(belief: BeliefWithRouting): ImplicationKind {
  // Check if belief has timeline dimension
  const isTimelineRelated = 
    belief.dimension === 'timeline' ||
    belief.timeline_signal?.refers_to_date === true;
  
  if (!isTimelineRelated) {
    // Not timeline-related, so it's pure commentary
    return 'pure_commentary';
  }
  
  // Check timeline signal details
  const signal = belief.timeline_signal;
  const text = belief.summary.toLowerCase();
  
  // Check for explicit timeline risk patterns
  const riskPatterns = [
    /\b(won't|can't|cannot|unlikely|impossible)\s+(make|hit|meet)\b/i,
    /\b(will\s+)?(slip|delay|push|postpone)\b/i,
    /\b(not\s+going\s+to|won't\s+be\s+ready)\b/i,
    /\b(at\s+risk|in\s+jeopardy|behind\s+schedule)\b/i,
    /\b(probably|likely)\s+\d+\s*(weeks?|months?|days?)\s+(late|behind)/i,
  ];
  
  // Check for pull-in patterns
  const pullInPatterns = [
    /\b(ahead\s+of\s+schedule|early|sooner)\b/i,
    /\b(can\s+ship|ready\s+to\s+ship)\s+(earlier|sooner|before)/i,
    /\b(pull\s+in|move\s+up|accelerate)\b/i,
  ];
  
  // Check for uncertain patterns
  const uncertainPatterns = [
    /\b(might|may|could|possibly)\s+(slip|delay)\b/i,
    /\b(not\s+sure|unclear|uncertain)\s+(about|if|whether).*\b(date|timeline|schedule)\b/i,
    /\b(depends\s+on|contingent\s+on)\b/i,
  ];
  
  // Determine kind based on patterns and signal strength
  if (signal && signal.likelihood_meeting_current_date !== null) {
    const likelihood = signal.likelihood_meeting_current_date;
    
    if (likelihood < 0.4) {
      // Strong risk signal
      return 'timeline_risk';
    } else if (likelihood > 0.8 && belief.polarity === 'positive') {
      // Positive signal with high confidence
      return 'timeline_pull_in';
    } else if (likelihood >= 0.4 && likelihood <= 0.6) {
      // Uncertain range
      return 'timeline_uncertain';
    }
  }
  
  // Pattern matching
  const hasRiskPattern = riskPatterns.some(p => p.test(text));
  const hasPullInPattern = pullInPatterns.some(p => p.test(text));
  const hasUncertainPattern = uncertainPatterns.some(p => p.test(text));
  
  if (hasUncertainPattern) {
    return 'timeline_uncertain';
  }
  
  if (hasPullInPattern) {
    return 'timeline_pull_in';
  }
  
  if (hasRiskPattern) {
    return 'timeline_risk';
  }
  
  // Default: if timeline-related but no clear signal, treat as commentary
  // unless there's a delta or mentioned date
  if (signal?.mentioned_date || signal?.suggested_delta_days !== undefined) {
    return 'timeline_risk'; // assume risk if specific date/delta mentioned
  }
  
  return 'pure_commentary';
}

/**
 * Check if belief has a concrete date we can work with
 */
function hasConcreteDate(belief: BeliefWithRouting): boolean {
  const signal = belief.timeline_signal;
  
  if (!signal) {
    return false;
  }
  
  // Concrete if we have a mentioned date
  if (signal.mentioned_date) {
    return isValidDate(signal.mentioned_date);
  }
  
  // Concrete if we have a specific delta
  if (signal.suggested_delta_days !== null && signal.suggested_delta_days !== undefined) {
    return true;
  }
  
  // Try to extract from text
  const extractedDate = extractDateFromText(belief.summary);
  return extractedDate !== null;
}

/**
 * Estimate delta in days from belief
 */
function estimateDeltaDays(belief: BeliefWithRouting): number | undefined {
  const signal = belief.timeline_signal;
  
  // Use signal delta if available
  if (signal?.suggested_delta_days !== null && signal?.suggested_delta_days !== undefined) {
    return signal.suggested_delta_days;
  }
  
  // Try to extract from text
  const text = belief.summary.toLowerCase();
  
  // Extract explicit durations
  const weekMatch = text.match(/(\d+)\s*weeks?/);
  if (weekMatch) {
    const weeks = parseInt(weekMatch[1], 10);
    return weeks * 7;
  }
  
  const monthMatch = text.match(/(\d+)\s*months?/);
  if (monthMatch) {
    const months = parseInt(monthMatch[1], 10);
    return months * 30; // approximate
  }
  
  const dayMatch = text.match(/(\d+)\s*days?/);
  if (dayMatch) {
    return parseInt(dayMatch[1], 10);
  }
  
  // Coarse estimates for common phrases
  if (/\ba\s+week\b/.test(text)) return 7;
  if (/\ba\s+couple\s+(of\s+)?weeks\b/.test(text)) return 14;
  if (/\ba\s+few\s+weeks\b/.test(text)) return 21;
  if (/\ba\s+month\b/.test(text)) return 30;
  if (/\bseveral\s+weeks\b/.test(text)) return 21;
  
  return undefined;
}

/**
 * Extract a date from text (simple patterns)
 */
function extractDateFromText(text: string): string | null {
  // ISO dates
  const isoMatch = text.match(/\b\d{4}-\d{2}-\d{2}\b/);
  if (isoMatch && isValidDate(isoMatch[0])) {
    return isoMatch[0];
  }
  
  // Month names
  const monthNames = [
    'january', 'february', 'march', 'april', 'may', 'june',
    'july', 'august', 'september', 'october', 'november', 'december'
  ];
  
  for (let i = 0; i < monthNames.length; i++) {
    const month = monthNames[i];
    const regex = new RegExp(`\\b${month}\\s+(\\d{1,2})(st|nd|rd|th)?`, 'i');
    const match = text.match(regex);
    
    if (match) {
      const day = parseInt(match[1], 10);
      const year = new Date().getFullYear();
      const monthNum = String(i + 1).padStart(2, '0');
      const dayNum = String(day).padStart(2, '0');
      return `${year}-${monthNum}-${dayNum}`;
    }
  }
  
  // Quarter references (approximate to end of quarter)
  const quarterMatch = text.match(/\bq([1-4])\b/i);
  if (quarterMatch) {
    const quarter = parseInt(quarterMatch[1], 10);
    const year = new Date().getFullYear();
    const month = quarter * 3;
    return `${year}-${String(month).padStart(2, '0')}-30`;
  }
  
  return null;
}

/**
 * Validate a date string
 */
function isValidDate(dateStr: string): boolean {
  const date = new Date(dateStr);
  return !isNaN(date.getTime());
}

/**
 * Batch classify implications for multiple beliefs
 */
export function classifyImplications(beliefs: BeliefWithRouting[]): BeliefImplication[] {
  return beliefs.map(classifyImplication);
}
