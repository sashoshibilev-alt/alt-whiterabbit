/**
 * Suggestion Engine for Convex
 * 
 * This is a Convex-compatible version of the suggestion engine.
 * It implements the deterministic pipeline for generating high-confidence
 * plan mutations and execution artifacts from meeting notes.
 */

// ============================================
// Types
// ============================================

interface Note {
  id: string;
  raw_text: string;
  created_at: number;
}

interface Initiative {
  id: string;
  title: string;
  status: string;
  owner_name?: string;
  priority?: string;
  description?: string;
}

interface Segment {
  id: string;
  text: string;
  normalized_text: string;
  index: number;
}

interface Signal {
  segment_id: string;
  text: string;
  cue_type: string;
  referenced_initiative_ids: string[];
  confidence_boost: number;
}

interface GeneratedSuggestion {
  content: string;
  type: 'PLAN_MUTATION' | 'EXECUTION_ARTIFACT';
  confidence: number;
}

// ============================================
// Out-of-Scope Patterns
// ============================================

const OUT_OF_SCOPE_PATTERNS = [
  // Communication
  /\b(send|email|share|notify|announce)\s+(the|this|a)?\s*(summary|notes|update|team|everyone)/i,
  /\bemail\s+(the|this|a)?\s*(team|group|everyone)/i,
  // Calendar
  /\b(schedule|book|set up|find time)\s+(a|the)?\s*(meeting|call|sync)/i,
  /\bput\s+(it|this)\s+(on|in)\s+(the|my|our)?\s*calendar/i,
  // Generic hygiene
  /\b(remember to|keep in mind|don't forget)\b/i,
  /\b(follow up|touch base)\b(?!\s+(on|about)\s+\w+\s+(initiative|project))/i,
];

function isOutOfScope(text: string): boolean {
  const normalized = text.toLowerCase();
  return OUT_OF_SCOPE_PATTERNS.some(pattern => pattern.test(normalized));
}

// ============================================
// Signal Patterns
// ============================================

const MUTATION_PATTERNS = {
  timeline: [
    /\b(push|delay|postpone|move|shift|extend)\s+(to|by|until)/i,
    /\b(pull in|move up|bring forward)\s+(to|by)/i,
    /\b(deadline|due date|release)\s+(is|changed to|moved to|now)\s+/i,
    /\b(end of|by)\s+(q[1-4]|january|february|march|april|may|june|july|august|september|october|november|december)/i,
  ],
  priority: [
    /\b(now|is|becomes?)\s+(top|highest|high|critical|p0|p1)\s*priority/i,
    /\b(deprioritize|lower priority|back burner)/i,
    /\b(raise|increase|bump up)\s+(the)?\s*priority/i,
  ],
  ownership: [
    /\b(will|going to|should)\s+(own|lead|drive|take over)/i,
    /\b(hand off|handoff|transfer)\s+(to|ownership)/i,
    /\b(new|changed)\s*(owner|lead)/i,
  ],
  status: [
    /\b(pause|pausing|paused|halt|halted)\s+(the|this)?\s*(initiative|project)/i,
    /\b(resume|restart|unpause)\s+(the|this)?\s*(initiative|project)/i,
    /\b(done|complete|completed|finished|shipped|launched)\b/i,
    /\b(cancel|cancelled|kill|killed)\b/i,
  ],
};

// v0-correct: Strong creation signals focusing on intent certainty
const NEW_INITIATIVE_PATTERNS = [
  // Strong creation signals - explicit initiative/project language
  /\b(we should spin up|need to spin up|let's spin up)\b/i,
  /\b(this deserves its own initiative)\b/i,
  /\b(let's track this as a project)\b/i,
  /\b(we need a proper initiative for)\b/i,
  /\b(we will (create|start|launch|kick off))\s+(a\s+new|an?\s*|new\s*)?(initiative|project|workstream)/i,
  /\b(let's (create|start|launch|kick off))\s+(a\s+new|an?\s*|new\s*)?(initiative|project|workstream)/i,
  /\b(agreed to (create|start|launch|spin up))\s+(a\s+new|an?\s*|new\s*)?(initiative|project)/i,
  // Tracking/backlog patterns (assertive)
  /\b(we will track|let's track|tracking)\s+(this|as|a|an)\s*(initiative|project|item)/i,
  /\b(make|turn)\s+(this|it)\s+(into)?\s*(a|an)?\s*(project|initiative)/i,
  /\b(add|adding)\s+(this\s+)?to\s+(the)?\s*(backlog|roadmap)\b/i,
  /\bnew\s+(initiative|project|workstream|effort)\s*:\s*/i,
];

// v0-correct: Assertiveness vs speculation patterns
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
// Extraction Helpers
// ============================================

function extractTimeline(text: string): string | null {
  const patterns = [
    /\b(q[1-4])\s*(\d{4})?\b/i,
    /\b(next|this)\s+(week|month|quarter|sprint)\b/i,
    /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s*(\d{4})?\b/i,
    /\bend of\s+(q[1-4]|month|quarter|year)\b/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return match[0];
    }
  }
  return null;
}

function extractPriority(text: string): string | null {
  const normalized = text.toLowerCase();
  if (/\b(p0|critical|highest|top|urgent)\b/.test(normalized)) return 'CRITICAL';
  if (/\b(p1|high|important)\b/.test(normalized)) return 'HIGH';
  if (/\b(p2|medium)\b/.test(normalized)) return 'MEDIUM';
  if (/\b(p3|low|backlog|back burner)\b/.test(normalized)) return 'LOW';
  return null;
}

function extractOwner(text: string): string | null {
  const patterns = [
    /\b([A-Z][a-z]+)\s+(will|to|should)\s+(own|lead|drive)/i,
    /\b(owned|led)\s+by\s+([A-Z][a-z]+)/i,
    /\b(hand(?:ed)?|transfer(?:red)?)\s+to\s+([A-Z][a-z]+)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const name = match[1]?.match(/^[A-Z]/) ? match[1] : match[2];
      if (name && name.length >= 2) return name;
    }
  }
  return null;
}

function extractTitle(text: string): string {
  let title = text
    .replace(/^(we should|let's|need to|decided to|agreed to|we are going to|we're going to|we will)\s+/i, '')
    .replace(/^(create|start|spin up|kick off|launch)\s+(a|an|new)?\s*(initiative|project)?\s*(for|to|called)?\s*/i, '')
    .replace(/^(build|ship|deliver)\s+(a|an|the)?\s*/i, '')
    .trim();

  if (title.length > 0) {
    title = title.charAt(0).toUpperCase() + title.slice(1);
  }
  if (title.length > 100) {
    title = title.substring(0, 97) + '...';
  }
  return title;
}

/**
 * v0-correct: Check if title is generic/junk
 */
function isGenericTitle(title: string): boolean {
  const normalized = title.toLowerCase().trim();
  
  if (normalized.length < 5) return true;
  
  const genericPrefixes = [
    'next steps', 'follow up', 'follow-up', 'todo', 'to do',
    'action item', 'action items', 'tbd', 'untitled', 'misc',
    'miscellaneous', 'things to do', 'stuff to do', 'work on',
    'look into', 'check on', 'update on',
  ];
  
  for (const prefix of genericPrefixes) {
    if (normalized.startsWith(prefix) || normalized === prefix) return true;
  }
  
  const genericWords = ['this', 'that', 'it', 'something', 'things', 'stuff', 'items'];
  if (genericWords.includes(normalized)) return true;
  
  return false;
}

/**
 * v0-correct: Compute modality score (assertive vs speculative)
 */
function computeModalityScore(text: string): number {
  let score = 0;
  
  for (const pattern of ASSERTIVE_PATTERNS) {
    if (pattern.test(text)) score += 0.4;
  }
  
  for (const pattern of SPECULATIVE_PATTERNS) {
    if (pattern.test(text)) score -= 0.5;
  }
  
  return Math.max(-1, Math.min(1, score));
}

/**
 * v0-correct: Check if text is assertive enough for NEW_INITIATIVE
 */
function isAssertive(text: string): boolean {
  return computeModalityScore(text) >= 0;
}

// ============================================
// Segmentation
// ============================================

let segmentCounter = 0;

function segmentNote(note: Note): Segment[] {
  const segments: Segment[] = [];
  const text = note.raw_text;
  
  // Extract bullet points
  const bulletPattern = /^[-*•]\s+(.+)$/gm;
  let match;
  while ((match = bulletPattern.exec(text)) !== null) {
    segments.push({
      id: `seg_${++segmentCounter}`,
      text: match[1].trim(),
      normalized_text: match[1].toLowerCase().trim(),
      index: segments.length,
    });
  }

  // Extract sentences
  const sentences = text
    .replace(/([.!?])\s+/g, '$1\n')
    .split('\n')
    .map(s => s.trim())
    .filter(s => s.length > 15);

  for (const sentence of sentences) {
    const normalized = sentence.toLowerCase();
    const alreadyCaptured = segments.some(seg => seg.normalized_text === normalized);
    if (!alreadyCaptured) {
      segments.push({
        id: `seg_${++segmentCounter}`,
        text: sentence,
        normalized_text: normalized,
        index: segments.length,
      });
    }
  }

  return segments;
}

// ============================================
// Initiative Matching
// ============================================

function matchInitiatives(text: string, initiatives: Initiative[]): string[] {
  const matched: string[] = [];
  const normalizedText = text.toLowerCase();

  for (const initiative of initiatives) {
    const normalizedTitle = initiative.title.toLowerCase();
    
    // Exact title match
    if (normalizedText.includes(normalizedTitle)) {
      matched.push(initiative.id);
      continue;
    }

    // Word overlap match
    const textWords = new Set(normalizedText.split(/\s+/).filter(w => w.length >= 3));
    const titleWords = normalizedTitle.split(/\s+/).filter(w => w.length >= 3);
    
    let matchCount = 0;
    for (const word of titleWords) {
      if (textWords.has(word)) matchCount++;
    }
    
    if (matchCount >= 2 || (titleWords.length > 0 && matchCount / titleWords.length >= 0.6)) {
      matched.push(initiative.id);
    }
  }

  return [...new Set(matched)];
}

// ============================================
// Signal Detection
// ============================================

/**
 * v0-correct: Detect signals with assertiveness checking
 */
function detectSignals(segments: Segment[], initiatives: Initiative[]): Signal[] {
  const signals: Signal[] = [];

  for (const segment of segments) {
    // Skip out-of-scope content
    if (isOutOfScope(segment.text)) {
      // Check for concrete attributes that override out-of-scope
      if (!/\b(owner|lead|responsible|due|deadline|scope|deliver|goal)\b/i.test(segment.text)) {
        continue;
      }
    }

    const matchedInitiatives = matchInitiatives(segment.text, initiatives);

    // Check mutation patterns (VERY STRICT - requires exactly one initiative)
    for (const [cueType, patterns] of Object.entries(MUTATION_PATTERNS)) {
      for (const pattern of patterns) {
        if (pattern.test(segment.text)) {
          // v0-correct: Only emit mutation signal if exactly one initiative is referenced
          if (matchedInitiatives.length === 1) {
            signals.push({
              segment_id: segment.id,
              text: segment.text,
              cue_type: `mutation_${cueType}`,
              referenced_initiative_ids: matchedInitiatives,
              confidence_boost: 0.2,
            });
          }
          break;
        }
      }
    }

    // Check new initiative patterns (INTENT-STRICT, ATTRIBUTE-LOOSE)
    for (const pattern of NEW_INITIATIVE_PATTERNS) {
      if (pattern.test(segment.text)) {
        // v0-correct: Check assertiveness for new initiatives
        if (!isAssertive(segment.text)) {
          // Speculative language - reject
          continue;
        }
        
        signals.push({
          segment_id: segment.id,
          text: segment.text,
          cue_type: 'new_initiative',
          referenced_initiative_ids: matchedInitiatives,
          confidence_boost: 0.3, // Increased from 0.25
        });
        break;
      }
    }
  }

  return signals;
}

// ============================================
// Suggestion Generation
// ============================================

function buildSuggestionContent(signal: Signal, initiatives: Initiative[]): GeneratedSuggestion | null {
  const text = signal.text;
  const cueType = signal.cue_type;

  // Handle mutations
  if (cueType.startsWith('mutation_') && signal.referenced_initiative_ids.length === 1) {
    const targetId = signal.referenced_initiative_ids[0];
    const target = initiatives.find(i => i.id === targetId);
    if (!target) return null;

    const changeType = cueType.replace('mutation_', '');
    let content = '';
    let confidence = 0.6 + signal.confidence_boost;

    switch (changeType) {
      case 'timeline': {
        const newTimeline = extractTimeline(text);
        if (!newTimeline) return null;
        content = `[Timeline Change] Update "${target.title}" timeline to ${newTimeline}\n\nEvidence: "${text}"`;
        break;
      }
      case 'priority': {
        const newPriority = extractPriority(text);
        if (!newPriority) return null;
        content = `[Priority Change] Update "${target.title}" priority to ${newPriority}\n\nEvidence: "${text}"`;
        break;
      }
      case 'ownership': {
        const newOwner = extractOwner(text);
        if (!newOwner) return null;
        content = `[Ownership Change] Transfer "${target.title}" ownership to ${newOwner}\n\nEvidence: "${text}"`;
        break;
      }
      case 'status': {
        const normalized = text.toLowerCase();
        let newStatus = '';
        if (/\b(pause|paused|halt)\b/.test(normalized)) newStatus = 'paused';
        else if (/\b(done|complete|shipped|launched)\b/.test(normalized)) newStatus = 'done';
        else if (/\b(cancel|killed)\b/.test(normalized)) newStatus = 'cancelled';
        else if (/\b(resume|restart|activate)\b/.test(normalized)) newStatus = 'active';
        
        if (!newStatus) return null;
        content = `[Status Change] Update "${target.title}" status to ${newStatus}\n\nEvidence: "${text}"`;
        break;
      }
      default:
        return null;
    }

    return { content, type: 'PLAN_MUTATION', confidence };
  }

  // Handle new initiatives (v0-correct: INTENT-STRICT, ATTRIBUTE-LOOSE)
  if (cueType === 'new_initiative') {
    // v0-correct: Extract title and check for generic/junk titles
    const title = extractTitle(text);
    if (!title || isGenericTitle(title)) {
      return null; // Generic or empty title - reject
    }

    // v0-correct: No longer require goal/owner/timeline
    // Intent (creation signal + non-generic title + assertiveness) is sufficient
    const owner = extractOwner(text);
    const timeline = extractTimeline(text);

    let content = `[New Initiative] ${title}`;
    if (owner) content += `\nOwner: ${owner}`;
    if (timeline) content += `\nTimeline: ${timeline}`;
    content += `\n\nEvidence: "${text}"`;

    return {
      content,
      type: 'EXECUTION_ARTIFACT',
      confidence: 0.6 + signal.confidence_boost,
    };
  }

  return null;
}

// ============================================
// Main Generator Function
// ============================================

export interface SuggestionEngineConfig {
  maxSuggestions?: number;
  confidenceThreshold?: number;
}

export function generateSuggestionsFromNote(
  noteBody: string,
  noteId: string,
  initiatives: Initiative[] = [],
  config: SuggestionEngineConfig = {}
): string[] {
  const maxSuggestions = config.maxSuggestions ?? 3;
  const confidenceThreshold = config.confidenceThreshold ?? 0.7;

  const note: Note = {
    id: noteId,
    raw_text: noteBody,
    created_at: Date.now(),
  };

  // Step 1: Segment the note
  const segments = segmentNote(note);
  if (segments.length === 0) return [];

  // Step 2: Detect signals
  const signals = detectSignals(segments, initiatives);
  if (signals.length === 0) return [];

  // Step 3: Build suggestions
  const suggestions: GeneratedSuggestion[] = [];
  const seenContent = new Set<string>();

  for (const signal of signals) {
    const suggestion = buildSuggestionContent(signal, initiatives);
    if (!suggestion) continue;

    // Confidence filter
    if (suggestion.confidence < confidenceThreshold) continue;

    // Dedupe
    const contentKey = suggestion.content.toLowerCase().substring(0, 100);
    if (seenContent.has(contentKey)) continue;
    seenContent.add(contentKey);

    suggestions.push(suggestion);
  }

  // Sort by confidence and cap
  suggestions.sort((a, b) => b.confidence - a.confidence);
  return suggestions.slice(0, maxSuggestions).map(s => s.content);
}

// ============================================
// Adapter for V0 Initiatives
// ============================================

export function adaptV0Initiative(v0Initiative: {
  _id: string;
  title: string;
  status: string;
  description: string;
}): Initiative {
  return {
    id: v0Initiative._id,
    title: v0Initiative.title,
    status: v0Initiative.status,
    description: v0Initiative.description,
  };
}
