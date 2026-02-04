/**
 * Suggestion Engine Classification
 * 
 * Classifies signals into mutation candidates or execution artifact candidates.
 * Implements deterministic rules from the refactor plan.
 */

import type {
  Signal,
  Initiative,
  MutationCandidate,
  ExecutionArtifactCandidate,
  MutationChangeType,
  ArtifactKind,
  CueType,
  Segment,
  Priority,
  Timeline,
} from './types';

// ============================================
// Cue Type to Candidate Type Mapping
// ============================================

const MUTATION_CUE_TYPES: CueType[] = [
  'mutation_timeline',
  'mutation_scope',
  'mutation_priority',
  'mutation_ownership',
  'mutation_status',
  'mutation_tags',
];

const ARTIFACT_CUE_TYPES: CueType[] = [
  'new_initiative',
  'backlog_item',
  'checklist',
  'decision',
];

const CUE_TO_CHANGE_TYPE: Record<string, MutationChangeType> = {
  'mutation_timeline': 'TIMELINE',
  'mutation_scope': 'SCOPE',
  'mutation_priority': 'PRIORITY',
  'mutation_ownership': 'OWNERSHIP',
  'mutation_status': 'STATUS',
  'mutation_tags': 'TAGS',
};

const CUE_TO_ARTIFACT_KIND: Record<string, ArtifactKind> = {
  'new_initiative': 'NEW_INITIATIVE',
  'backlog_item': 'BACKLOG_DRAFT',
  'checklist': 'CHECKLIST',
  'decision': 'DECISION_RECORD',
};

// ============================================
// Text Extraction Helpers
// ============================================

/**
 * Extract a date/timeline from text
 */
export function extractTimeline(text: string): Timeline | null {
  const normalized = text.toLowerCase();
  
  // Quarter patterns
  const quarterMatch = normalized.match(/\b(q[1-4])\s*(\d{4})?\b/i);
  if (quarterMatch) {
    const quarter = parseInt(quarterMatch[1].substring(1));
    const year = quarterMatch[2] ? parseInt(quarterMatch[2]) : new Date().getFullYear();
    const startMonth = (quarter - 1) * 3;
    return {
      start: new Date(year, startMonth, 1).getTime(),
      end: new Date(year, startMonth + 3, 0).getTime(),
      description: quarterMatch[0].toUpperCase(),
    };
  }

  // Week patterns
  const weekMatch = normalized.match(/\b(next|this)\s+week\b/i);
  if (weekMatch) {
    const now = new Date();
    const offset = weekMatch[1].toLowerCase() === 'next' ? 7 : 0;
    const start = new Date(now.getTime() + offset * 24 * 60 * 60 * 1000);
    return {
      description: weekMatch[0],
    };
  }

  // Month patterns
  const monthMatch = normalized.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\s*(\d{4})?\b/i);
  if (monthMatch) {
    const months = ['january', 'february', 'march', 'april', 'may', 'june', 
                    'july', 'august', 'september', 'october', 'november', 'december'];
    const month = months.indexOf(monthMatch[1].toLowerCase());
    const year = monthMatch[2] ? parseInt(monthMatch[2]) : new Date().getFullYear();
    return {
      start: new Date(year, month, 1).getTime(),
      end: new Date(year, month + 1, 0).getTime(),
      description: monthMatch[0],
    };
  }

  // Sprint/iteration pattern
  const sprintMatch = normalized.match(/\b(next|this)\s+(sprint|iteration)\b/i);
  if (sprintMatch) {
    return {
      description: sprintMatch[0],
    };
  }

  // End of [period] pattern
  const endOfMatch = normalized.match(/\bend of\s+(q[1-4]|month|quarter|year|week)\b/i);
  if (endOfMatch) {
    return {
      description: `End of ${endOfMatch[1]}`,
    };
  }

  return null;
}

/**
 * Extract priority from text
 */
export function extractPriority(text: string): Priority | null {
  const normalized = text.toLowerCase();
  
  if (/\b(p0|critical|highest|top|urgent|emergency)\b/i.test(normalized)) {
    return 'CRITICAL';
  }
  if (/\b(p1|high|important)\b/i.test(normalized)) {
    return 'HIGH';
  }
  if (/\b(p2|medium|moderate)\b/i.test(normalized)) {
    return 'MEDIUM';
  }
  if (/\b(p3|p4|low|minor|backlog|back burner)\b/i.test(normalized)) {
    return 'LOW';
  }

  return null;
}

/**
 * Extract owner/person from text
 */
export function extractOwner(text: string): { id?: string; name?: string } | null {
  // Look for patterns like "Alice will own", "owned by Bob", "John to lead"
  const patterns = [
    { regex: /\b([A-Z][a-z]+)\s+(will|to|should|going to)\s+(own|lead|drive|take)/i, nameGroup: 1 },
    { regex: /\b(owned|led|driven)\s+by\s+([A-Z][a-z]+)/i, nameGroup: 2 },
    { regex: /\b(hand\s*off|handoff|transfer)\s+to\s+([A-Z][a-z]+)/i, nameGroup: 2 },
    { regex: /\b([A-Z][a-z]+)\s+is\s+(taking over|the new owner|responsible)/i, nameGroup: 1 },
    { regex: /\bnew\s+owner[:\s]+([A-Z][a-z]+)/i, nameGroup: 1 },
    { regex: /\b([A-Z][a-z]+)'s\s+(responsibility|initiative|project)/i, nameGroup: 1 },
  ];

  for (const { regex, nameGroup } of patterns) {
    const match = text.match(regex);
    if (match && match[nameGroup]) {
      const name = match[nameGroup];
      if (name && name.length >= 2 && /^[A-Z]/.test(name)) {
        return { name };
      }
    }
  }

  return null;
}

/**
 * Extract title/goal from text for new initiatives
 * v0-correct: More aggressive generic title rejection
 */
export function extractTitle(text: string): string {
  // Remove common prefixes and trim
  let title = text
    .replace(/^(we should|let's|need to|going to|will|decided to|agreed to|we are going to|we're going to)\s+/i, '')
    .replace(/^(create|start|spin up|kick off|launch)\s+(a|an|new)?\s*(initiative|project)?\s*(for|to|called)?\s*/i, '')
    .replace(/^(add|track|make)\s+(this|it)?\s*(as|into|a)?\s*(an?)?\s*(initiative|project|item)?\s*/i, '')
    .replace(/^(build|ship|deliver)\s+(a|an|the)?\s*/i, '')
    .trim();

  // Capitalize first letter
  if (title.length > 0) {
    title = title.charAt(0).toUpperCase() + title.slice(1);
  }

  // Truncate if too long
  if (title.length > 140) {
    title = title.substring(0, 137) + '...';
  }

  return title;
}

/**
 * Check if title is generic/junk
 * v0-correct: Expanded generic title list
 */
export function isGenericTitle(title: string): boolean {
  const normalized = title.toLowerCase().trim();
  
  // Empty or too short
  if (normalized.length < 5) return true;
  
  // Generic prefixes/phrases
  const genericPrefixes = [
    'next steps',
    'follow up',
    'follow-up',
    'todo',
    'to do',
    'action item',
    'action items',
    'tbd',
    'untitled',
    'misc',
    'miscellaneous',
    'things to do',
    'stuff to do',
    'work on',
    'look into',
    'check on',
    'update on',
  ];
  
  for (const prefix of genericPrefixes) {
    if (normalized.startsWith(prefix)) return true;
    if (normalized === prefix) return true;
  }
  
  // Titles that are just pronouns or generic words
  const genericWords = ['this', 'that', 'it', 'something', 'things', 'stuff', 'items'];
  if (genericWords.includes(normalized)) return true;
  
  return false;
}

/**
 * Extract success criteria from text
 */
export function extractSuccessCriteria(text: string): string | null {
  const patterns = [
    /\b(success|done|complete|goal|outcome)\s*[:=]\s*(.+)/i,
    /\b(when|once)\s+(.+)\s+(is done|ships|launches|is complete)/i,
    /\b(deliver|ship|launch|complete)\s+(.+)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[2]) {
      return match[2].trim();
    }
  }

  return null;
}

// ============================================
// Classification Logic
// ============================================

export interface ClassificationResult {
  mutations: MutationCandidate[];
  artifacts: ExecutionArtifactCandidate[];
}

/**
 * Classify a single signal into a candidate
 */
export function classifySignal(
  signal: Signal,
  initiatives: Initiative[],
  segments: Segment[]
): { mutation?: MutationCandidate; artifact?: ExecutionArtifactCandidate } {
  const isMutationCue = MUTATION_CUE_TYPES.includes(signal.cue_type);
  const isArtifactCue = ARTIFACT_CUE_TYPES.includes(signal.cue_type);

  // Determine if this should be a mutation
  if (isMutationCue && signal.referenced_initiative_ids.length > 0) {
    // Need exactly one unambiguous target
    if (signal.referenced_initiative_ids.length === 1) {
      const targetId = signal.referenced_initiative_ids[0];
      const targetInitiative = initiatives.find(i => i.id === targetId);
      
      if (targetInitiative) {
        const mutation = buildMutationCandidate(signal, targetInitiative, segments);
        if (mutation) {
          return { mutation };
        }
      }
    }
    // Multiple references = ambiguous, discard
    return {};
  }

  // Determine if this should be an artifact
  if (isArtifactCue || (isMutationCue && signal.referenced_initiative_ids.length === 0)) {
    // No valid mutation target, could be a new artifact
    const artifact = buildExecutionArtifactCandidate(signal, initiatives, segments);
    if (artifact) {
      return { artifact };
    }
  }

  return {};
}

/**
 * Build a mutation candidate from a signal
 */
function buildMutationCandidate(
  signal: Signal,
  targetInitiative: Initiative,
  segments: Segment[]
): MutationCandidate | null {
  const changeType = CUE_TO_CHANGE_TYPE[signal.cue_type];
  if (!changeType) return null;

  const text = signal.text;
  let proposedBefore: Partial<Initiative> = {};
  let proposedAfter: Partial<Initiative> = {};
  let rationale = text;

  switch (changeType) {
    case 'TIMELINE': {
      const newTimeline = extractTimeline(text);
      if (!newTimeline) return null; // Can't extract concrete timeline
      
      proposedBefore = { timeline: targetInitiative.timeline };
      proposedAfter = { timeline: newTimeline };
      rationale = `Timeline change detected: "${text}"`;
      break;
    }

    case 'PRIORITY': {
      const newPriority = extractPriority(text);
      if (!newPriority) return null; // Can't extract concrete priority
      
      // Only create if different from current
      if (newPriority === targetInitiative.priority) return null;
      
      proposedBefore = { priority: targetInitiative.priority };
      proposedAfter = { priority: newPriority };
      rationale = `Priority change detected: "${text}"`;
      break;
    }

    case 'OWNERSHIP': {
      const newOwner = extractOwner(text);
      if (!newOwner) return null; // Can't extract concrete owner
      
      proposedBefore = { 
        owner_id: targetInitiative.owner_id,
        owner_name: targetInitiative.owner_name,
      };
      proposedAfter = {
        owner_id: newOwner.id,
        owner_name: newOwner.name,
      };
      rationale = `Ownership change detected: "${text}"`;
      break;
    }

    case 'SCOPE': {
      // For scope changes, we capture the text but don't try to parse it
      proposedBefore = { scope: targetInitiative.scope };
      proposedAfter = { scope: `${targetInitiative.scope || ''}\n[Update: ${text}]`.trim() };
      rationale = `Scope change detected: "${text}"`;
      break;
    }

    case 'STATUS': {
      // Detect status from patterns
      const normalized = text.toLowerCase();
      let newStatus: Initiative['status'] | null = null;
      
      if (/\b(pause|paused|halt|halted|on hold)\b/.test(normalized)) {
        newStatus = 'paused';
      } else if (/\b(done|complete|completed|finished|shipped|launched)\b/.test(normalized)) {
        newStatus = 'done';
      } else if (/\b(cancel|cancelled|killed|abandoned)\b/.test(normalized)) {
        newStatus = 'cancelled';
      } else if (/\b(resume|restart|unpause|reactivate)\b/.test(normalized)) {
        newStatus = 'active';
      } else if (/\b(start|started|kick off|activated)\b/.test(normalized)) {
        newStatus = 'active';
      }
      
      if (!newStatus || newStatus === targetInitiative.status) return null;
      
      proposedBefore = { status: targetInitiative.status };
      proposedAfter = { status: newStatus };
      rationale = `Status change detected: "${text}"`;
      break;
    }

    case 'TAGS': {
      // Not fully implementing tag changes for v0
      return null;
    }

    default:
      return null;
  }

  // Calculate confidence
  const baseConfidence = 0.6;
  const confidence = Math.min(1, baseConfidence + signal.confidence_boost);

  return {
    target_initiative_id: targetInitiative.id,
    change_type: changeType,
    evidence_segment_ids: [signal.segment_id],
    proposed_before: proposedBefore,
    proposed_after: proposedAfter,
    rationale,
    confidence,
  };
}

/**
 * Get expanded context from nearby segments
 */
function getExpandedContext(
  signal: Signal,
  segments: Segment[]
): { text: string; segmentIds: string[] } {
  const currentSegment = segments.find(s => s.id === signal.segment_id);
  if (!currentSegment) {
    return { text: signal.text, segmentIds: [signal.segment_id] };
  }

  const currentIndex = currentSegment.index;
  const segmentIds = [signal.segment_id];
  let expandedText = signal.text;

  // Look at nearby segments (up to 2 before and 2 after)
  const nearbySegments = segments.filter(
    s => Math.abs(s.index - currentIndex) <= 2 && s.id !== signal.segment_id
  );

  for (const segment of nearbySegments) {
    expandedText += ' ' + segment.text;
    segmentIds.push(segment.id);
  }

  return { text: expandedText, segmentIds };
}

/**
 * Build an execution artifact candidate from a signal
 * v0-correct: Intent-strict, attribute-loose
 */
function buildExecutionArtifactCandidate(
  signal: Signal,
  initiatives: Initiative[],
  segments: Segment[]
): ExecutionArtifactCandidate | null {
  const text = signal.text;
  const artifactKind = CUE_TO_ARTIFACT_KIND[signal.cue_type] || 'NEW_INITIATIVE';

  // Get expanded context from nearby segments for better extraction
  const { text: expandedText, segmentIds: evidenceSegmentIds } = getExpandedContext(signal, segments);

  // v0-correct: Extract title FIRST and reject generic titles
  const title = extractTitle(text);
  if (!title || isGenericTitle(title)) {
    return null; // Generic or empty title - reject immediately
  }

  // v0-correct: Check for intent clarity, not attribute completeness
  // We want to see that there's a concrete subject (non-generic title is enough)
  // No longer require goal/outcome/owner/timeline for NEW_INITIATIVE
  
  // Optional: Extract owner and timeline if present (but don't require them)
  const owner = extractOwner(expandedText);
  const timeline = extractTimeline(expandedText);

  // Build the candidate based on artifact kind
  const baseCandidate: Partial<ExecutionArtifactCandidate> = {
    artifact_kind: artifactKind,
    evidence_segment_ids: [signal.segment_id], // Keep primary segment as evidence
    title,
    description: expandedText, // Use expanded text for description
    linked_initiative_ids: signal.referenced_initiative_ids,
    confidence: 0.6 + signal.confidence_boost,
  };

  if (owner) {
    baseCandidate.proposed_owner_id = owner.id;
    baseCandidate.proposed_owner_name = owner.name;
  }

  switch (artifactKind) {
    case 'NEW_INITIATIVE': {
      // v0-correct: No longer require success criteria or timeline
      // Intent (creation signal + non-generic title) is sufficient
      const successCriteria = extractSuccessCriteria(text);
      const roughTimeline = timeline?.description || extractTimelineDescription(text);
      
      return {
        ...baseCandidate,
        artifact_kind: 'NEW_INITIATIVE',
        success_criteria: successCriteria || `Complete: ${title}`,
        rough_timeline: roughTimeline || 'TBD',
      } as ExecutionArtifactCandidate;
    }

    case 'BACKLOG_DRAFT': {
      // Needs a parent initiative
      const parentId = signal.referenced_initiative_ids[0];
      if (!parentId || !initiatives.some(i => i.id === parentId)) {
        // No parent, convert to NEW_INITIATIVE instead
        return {
          ...baseCandidate,
          artifact_kind: 'NEW_INITIATIVE',
          success_criteria: `Complete: ${title}`,
          rough_timeline: timeline?.description || 'TBD',
        } as ExecutionArtifactCandidate;
      }
      
      return {
        ...baseCandidate,
        artifact_kind: 'BACKLOG_DRAFT',
        parent_initiative_id: parentId,
      } as ExecutionArtifactCandidate;
    }

    case 'CHECKLIST': {
      // Extract items if possible
      const items = extractChecklistItems(text, segments, signal.segment_id);
      if (items.length === 0) {
        return null; // No items found
      }
      
      return {
        ...baseCandidate,
        artifact_kind: 'CHECKLIST',
        items,
      } as ExecutionArtifactCandidate;
    }

    case 'DECISION_RECORD': {
      return {
        ...baseCandidate,
        artifact_kind: 'DECISION_RECORD',
        decision_summary: text,
        impacted_initiative_ids: signal.referenced_initiative_ids,
      } as ExecutionArtifactCandidate;
    }

    default:
      return null;
  }
}

/**
 * Extract a timeline description (rough text)
 */
function extractTimelineDescription(text: string): string | null {
  const patterns = [
    /\b(by|before|until|due)\s+([^.!?,]+)/i,
    /\b(in|within)\s+(\d+\s+(days?|weeks?|months?|sprints?))/i,
    /\b(next|this)\s+(week|month|quarter|sprint)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return match[0];
    }
  }

  return null;
}

/**
 * Extract checklist items from surrounding context
 */
function extractChecklistItems(
  text: string,
  segments: Segment[],
  currentSegmentId: string
): string[] {
  const items: string[] = [];
  
  // First, try to extract from the text itself
  const bulletPattern = /^[-*•]\s*(.+)$/gm;
  let match;
  while ((match = bulletPattern.exec(text)) !== null) {
    items.push(match[1].trim());
  }

  // If no bullets, try numbered items
  const numberPattern = /^\d+[.)]\s*(.+)$/gm;
  while ((match = numberPattern.exec(text)) !== null) {
    items.push(match[1].trim());
  }

  // Look at adjacent segments for more items
  const currentSegment = segments.find(s => s.id === currentSegmentId);
  if (currentSegment) {
    const currentIndex = currentSegment.index;
    const adjacentSegments = segments.filter(
      s => Math.abs(s.index - currentIndex) <= 3 && s.id !== currentSegmentId
    );
    
    for (const segment of adjacentSegments) {
      // Only add if it looks like an action item
      if (/^[-*•\d]/.test(segment.text) && segment.text.length < 200) {
        const cleaned = segment.text.replace(/^[-*•\d.)\s]+/, '').trim();
        if (cleaned.length > 5 && !items.includes(cleaned)) {
          items.push(cleaned);
        }
      }
    }
  }

  return items.slice(0, 10); // Cap at 10 items
}

/**
 * Classify all signals into candidates
 */
export function classifySignals(
  signals: Signal[],
  initiatives: Initiative[],
  segments: Segment[]
): ClassificationResult {
  const mutations: MutationCandidate[] = [];
  const artifacts: ExecutionArtifactCandidate[] = [];

  for (const signal of signals) {
    const result = classifySignal(signal, initiatives, segments);
    
    if (result.mutation) {
      mutations.push(result.mutation);
    }
    if (result.artifact) {
      artifacts.push(result.artifact);
    }
  }

  return { mutations, artifacts };
}
