/**
 * Suggestion Engine Signal Detection
 * 
 * Rule-based signal extraction from segments.
 * Detects mutation cues, new initiative cues, and filters out-of-scope content.
 */

import type { Segment, Signal, CueType, Initiative } from './types';
import { normalizeText } from './preprocessing';

// ============================================
// Out-of-Scope Patterns (Filter First)
// ============================================

const OUT_OF_SCOPE_PATTERNS = {
  // Communication patterns
  communication: [
    /\b(send|email|share|notify|announce|communicate|forward|cc|bcc)\b.*\b(summary|notes|update|team|everyone)\b/i,
    /\b(send|share)\s+(the|this|a)?\s*(summary|notes|recap)/i,
    /\bemail\s+(the|this|a)?\s*(team|group|everyone)/i,
    /\bnotify\s+(the|this|a)?\s*(stakeholder|team|manager)/i,
  ],
  
  // Research/validation patterns (unless framed as initiative)
  research: [
    /\b(interview|survey|experiment|a\/b test|user research)\b/i,
    /\bdo\s+(some|more)?\s*(research|interviews|testing)/i,
    /\bvalidate\s+(this|the|our)\s*(assumption|hypothesis)/i,
    /\btest\s+(this|the)\s*(idea|concept|approach)/i,
  ],
  
  // Calendar/scheduling patterns
  calendar: [
    /\b(schedule|book|set up|find time|calendar)\s+(a|the)?\s*(meeting|call|sync|chat|room)/i,
    /\bbook\s+(a|the)?\s*(room|space|venue)/i,
    /\bput\s+(it|this)\s+(on|in)\s+(the|my|our)?\s*calendar/i,
    /\bblock\s+(off|out)?\s*(time|calendar)/i,
    /\brecurring\s+(meeting|sync|standup)/i,
  ],
  
  // Generic hygiene/productivity patterns
  hygiene: [
    /\b(remember to|keep in mind|don't forget|note to self)\b/i,
    /\b(follow up|touch base|check in)\b(?!\s+(on|about|regarding)\s+\w+\s+(initiative|project|work))/i,
    /\bstay\s+(on top of|aligned|in sync)/i,
    /\bmake sure\s+(to|we)\s*(remember|don't forget)/i,
  ],
};

/**
 * Check if a segment is explicitly out of scope
 */
export function isOutOfScope(text: string): { outOfScope: boolean; reason?: string } {
  const normalized = normalizeText(text);
  
  for (const [category, patterns] of Object.entries(OUT_OF_SCOPE_PATTERNS)) {
    for (const pattern of patterns) {
      if (pattern.test(normalized)) {
        return { outOfScope: true, reason: category };
      }
    }
  }
  
  return { outOfScope: false };
}

// ============================================
// Mutation Cue Patterns
// ============================================

interface CuePattern {
  patterns: RegExp[];
  cueType: CueType;
  confidenceBoost: number;
}

const MUTATION_CUES: CuePattern[] = [
  // Timeline changes
  {
    patterns: [
      /\b(push|delay|postpone|move|shift|slip|extend)\s+.{0,30}(to|by|until)\s+(q[1-4]|next|end of|january|february|march|april|may|june|july|august|september|october|november|december)/i,
      /\b(push|delay|postpone|move|shift|slip|extend)\s+(to|by|until|back)/i,
      /\b(pull in|move up|bring forward|accelerate)\s+.{0,20}(to|by)/i,
      /\b(new|updated|revised)\s+(deadline|due date|target date|timeline|eta)/i,
      /\b(deadline|due date|release|timeline)\s+(is|changed to|moved to|now|pushed to|delayed to)\s+/i,
      /\b(end of|by)\s+(q[1-4]|january|february|march|april|may|june|july|august|september|october|november|december)/i,
      /\bto\s+(q[1-4])\s+(\d{4})?\b/i,
    ],
    cueType: 'mutation_timeline',
    confidenceBoost: 0.2,
  },
  
  // Scope changes
  {
    patterns: [
      /\b(expand|extend|add|include|grow)\s+(the)?\s*(scope|work|feature)/i,
      /\b(cut|remove|drop|descope|reduce)\s+(the)?\s*(scope|feature|requirement)/i,
      /\b(scope|feature)\s+(creep|change|expansion)/i,
      /\b(add|include|remove)\s+.{3,30}\s+(from|to)\s+(the)?\s*(scope|initiative|project)/i,
      /\b(no longer|not going to)\s+(include|do|deliver|build)/i,
    ],
    cueType: 'mutation_scope',
    confidenceBoost: 0.15,
  },
  
  // Priority changes
  {
    patterns: [
      /\b(now|is|becomes?)\s+(top|highest|high|critical|p0|p1)\s*priority/i,
      /\b(deprioritize|lower priority|de-prioritize|back burner)/i,
      /\b(priority|prioritize)\s+(is|changed|moved|shifted)/i,
      /\b(raise|increase|bump up|elevate)\s+(the)?\s*priority/i,
      /\b(more|less)\s+(urgent|important|critical)\s+(than|now)/i,
      /\bafter\s+.{3,30}\s+(is done|ships|launches)/i,
    ],
    cueType: 'mutation_priority',
    confidenceBoost: 0.2,
  },
  
  // Ownership changes
  {
    patterns: [
      /\b(will|going to|should)\s+(own|lead|drive|take over|take on)/i,
      /\b(hand off|handoff|transfer|pass)\s+(to|ownership)/i,
      /\b(new|changed)\s*(owner|lead|driver|responsible|point person)/i,
      /\b(take|taking)\s+(over|on|ownership)/i,
      /\b(assign|assigned|reassign|reassigned)\s+(to|from)/i,
    ],
    cueType: 'mutation_ownership',
    confidenceBoost: 0.2,
  },
  
  // Status changes
  {
    patterns: [
      /\b(pause|pausing|paused|halt|halted|stop|stopped)\s+(the|this)?\s*(initiative|project|work)/i,
      /\b(resume|resuming|restart|restarting|unpause)\s+(the|this)?\s*(initiative|project|work)/i,
      /\b(done|complete|completed|finished|shipped|launched)/i,
      /\b(cancel|cancelled|kill|killed|abandon|abandoned)/i,
      /\b(activate|activated|start|started|kick off|kicked off)/i,
    ],
    cueType: 'mutation_status',
    confidenceBoost: 0.15,
  },
];

// ============================================
// Assertiveness vs Speculation Patterns (v0-correct)
// ============================================

const ASSERTIVE_PATTERNS = [
  /\b(we will|let's|agreed to|we decided to|we are going to)\b/i,
  /\b(we're (going to|doing|building|shipping|creating))\b/i,
  /\b(committed to|committing to)\b/i,
  /\b(definitely|absolutely|certainly)\s+(will|going to|need)\b/i,
];

const SPECULATIVE_PATTERNS = [
  /\b(maybe|might|could|possibly|perhaps)\b/i,
  /\b(we should (explore|consider|think about|look into))\b/i,
  /\b(what if|how about|worth considering)\b/i,
  /\b(if we decide|if we go with|depending on)\b/i,
  /\b(would be nice|could be interesting)\b/i,
];

// ============================================
// New Initiative Cue Patterns (v0-correct)
// Focus on strong creation signals
// ============================================

const NEW_INITIATIVE_CUES: CuePattern[] = [
  // Strong creation signals - explicit initiative/project language
  {
    patterns: [
      /\b(we should spin up|need to spin up|let's spin up)\b/i,
      /\b(this deserves its own initiative)\b/i,
      /\b(let's track this as a project)\b/i,
      /\b(we need a proper initiative for)\b/i,
      /\b(we will (create|start|launch|kick off))\s+(a\s+new|an?\s*|new\s*)?(initiative|project|workstream)/i,
      /\b(let's (create|start|launch|kick off))\s+(a\s+new|an?\s*|new\s*)?(initiative|project|workstream)/i,
      /\b(agreed to (create|start|launch|spin up))\s+(a\s+new|an?\s*|new\s*)?(initiative|project)/i,
    ],
    cueType: 'new_initiative',
    confidenceBoost: 0.3,
  },
  
  // Tracking/backlog patterns (assertive)
  {
    patterns: [
      /\b(we will track|let's track|tracking)\s+(this|as|a|an)\s*(initiative|project|item)/i,
      /\b(make|turn)\s+(this|it)\s+(into)?\s*(a|an)?\s*(project|initiative)/i,
      /\b(add|adding)\s+(this\s+)?to\s+(the)?\s*(backlog|roadmap)\b/i,
      /\bnew\s+(initiative|project|workstream|effort)\s*:\s*/i,
    ],
    cueType: 'new_initiative',
    confidenceBoost: 0.25,
  },
  
  // Decision patterns (only when linked to execution)
  {
    patterns: [
      /\b(we|team)\s+(decided|agreed)\s+(to|that)\s+(create|build|launch|ship|start)/i,
      /\bdecision\s*:\s*(create|build|launch|ship|start)/i,
      /\b(final decision|agreed)\s*:\s*(we (will|are going to))/i,
    ],
    cueType: 'decision',
    confidenceBoost: 0.2,
  },
  
  // Backlog/task patterns (lower confidence)
  {
    patterns: [
      /\b(add|create|file)\s+(a|an)?\s*(ticket|issue|task)\s*(for|to track)\b/i,
      /\b(needs to be|should be)\s+(tracked|on the board|in the backlog)/i,
    ],
    cueType: 'backlog_item',
    confidenceBoost: 0.15,
  },
  
  // Checklist patterns (keep for artifact detection, but lower priority)
  {
    patterns: [
      /\b(checklist|action items)\s*(:|for)/i,
      /\b(steps|tasks)\s+(to|before)\s+(launch|release|ship)/i,
    ],
    cueType: 'checklist',
    confidenceBoost: 0.1,
  },
];

// ============================================
// Modality Detection (v0-correct)
// ============================================

/**
 * Compute assertiveness score for a text segment
 * Returns a score from -1 (speculative) to +1 (assertive)
 */
export function computeModalityScore(text: string): number {
  let score = 0;
  
  // Check assertive patterns
  for (const pattern of ASSERTIVE_PATTERNS) {
    if (pattern.test(text)) {
      score += 0.4;
    }
  }
  
  // Check speculative patterns
  for (const pattern of SPECULATIVE_PATTERNS) {
    if (pattern.test(text)) {
      score -= 0.5;
    }
  }
  
  // Clamp to [-1, 1]
  return Math.max(-1, Math.min(1, score));
}

/**
 * Check if text is assertive enough for NEW_INITIATIVE suggestions
 */
export function isAssertive(text: string): boolean {
  const score = computeModalityScore(text);
  return score >= 0; // At minimum, not speculative
}

// ============================================
// Signal Detection (v0-correct)
// ============================================

/**
 * Detect signals in a single segment
 * v0-correct: Focus on intent certainty, not attribute completeness
 */
export function detectSignalsInSegment(
  segment: Segment,
  initiativeIds: string[]
): Signal[] {
  const signals: Signal[] = [];
  const text = segment.text;
  const normalized = segment.normalized_text;
  
  // First, check if out of scope
  const { outOfScope, reason } = isOutOfScope(text);
  if (outOfScope) {
    // Out of scope - but could still be valid if it has initiative-like structure
    // Check for concrete attributes (owner, scope, timeline)
    const hasConcreteAttributes = 
      /\b(owner|lead|responsible|by|due|deadline|scope|deliver|goal|outcome)\b/i.test(normalized);
    
    if (!hasConcreteAttributes) {
      return []; // Truly out of scope, skip
    }
  }

  // Check mutation cues (VERY STRICT - requires exactly one initiative)
  for (const cuePattern of MUTATION_CUES) {
    for (const pattern of cuePattern.patterns) {
      if (pattern.test(text)) {
        // Only emit mutation signal if exactly one initiative is referenced
        if (initiativeIds.length === 1) {
          signals.push({
            segment_id: segment.id,
            text: text,
            cue_type: cuePattern.cueType,
            referenced_initiative_ids: initiativeIds,
            confidence_boost: cuePattern.confidenceBoost,
          });
        }
        break; // One match per cue type per segment
      }
    }
  }

  // Check new initiative cues (INTENT-STRICT, ATTRIBUTE-LOOSE)
  for (const cuePattern of NEW_INITIATIVE_CUES) {
    for (const pattern of cuePattern.patterns) {
      if (pattern.test(text)) {
        // v0-correct: Check assertiveness for NEW_INITIATIVE and decision cues
        if (cuePattern.cueType === 'new_initiative' || cuePattern.cueType === 'decision') {
          if (!isAssertive(text)) {
            // Speculative language - reject
            continue;
          }
        }
        
        signals.push({
          segment_id: segment.id,
          text: text,
          cue_type: cuePattern.cueType,
          referenced_initiative_ids: initiativeIds,
          confidence_boost: cuePattern.confidenceBoost,
        });
        break; // One match per cue type per segment
      }
    }
  }

  // Check structured sections for additional context
  if (segment.section === 'decisions') {
    // Boost decision signals if assertive
    const existingDecision = signals.find(s => s.cue_type === 'decision');
    if (!existingDecision && isAssertive(text)) {
      signals.push({
        segment_id: segment.id,
        text: text,
        cue_type: 'decision',
        referenced_initiative_ids: initiativeIds,
        confidence_boost: 0.15,
      });
    }
  }

  if (segment.section === 'actions') {
    // Check if this looks like a new task vs. a mutation
    const hasMutationSignal = signals.some(s => s.cue_type.startsWith('mutation_'));
    if (!hasMutationSignal && initiativeIds.length === 0 && isAssertive(text)) {
      signals.push({
        segment_id: segment.id,
        text: text,
        cue_type: 'backlog_item',
        referenced_initiative_ids: [],
        confidence_boost: 0.1,
      });
    }
  }

  return signals;
}

/**
 * Extract all signals from preprocessed segments
 */
export function extractSignals(
  segments: Segment[],
  initiativeMappings: Map<string, string[]>
): Signal[] {
  const allSignals: Signal[] = [];

  for (const segment of segments) {
    const initiativeIds = initiativeMappings.get(segment.id) || [];
    const signals = detectSignalsInSegment(segment, initiativeIds);
    allSignals.push(...signals);
  }

  return allSignals;
}

// ============================================
// Signal Deduplication
// ============================================

/**
 * Deduplicate signals that are essentially the same
 */
export function deduplicateSignals(signals: Signal[]): Signal[] {
  const seen = new Set<string>();
  const deduplicated: Signal[] = [];

  for (const signal of signals) {
    // Create a key based on segment, cue type, and target initiatives
    const key = `${signal.segment_id}:${signal.cue_type}:${signal.referenced_initiative_ids.sort().join(',')}`;
    
    if (!seen.has(key)) {
      seen.add(key);
      deduplicated.push(signal);
    }
  }

  return deduplicated;
}
