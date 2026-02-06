/**
 * Suggestion Engine v2 - Classifiers
 *
 * Section intent classification and type determination.
 * Distinguishes plan mutations from execution artifacts and filters non-actionable content.
 *
 * Key signals:
 * - actionableSignal = max(plan_change, new_workstream)
 * - outOfScopeSignal = max(calendar, communication, micro_tasks)
 * - isActionable = actionableSignal >= T_action && outOfScopeSignal < T_out_of_scope
 *
 * Note: research is excluded from outOfScopeSignal to allow high-research sections with
 * concrete execution language (UI verbs, deliverables) to be treated as actionable.
 */

import type {
  Section,
  IntentClassification,
  ClassifiedSection,
  SectionType,
  ThresholdConfig,
} from './types';

// ============================================
// Intent Classification Patterns
// ============================================

/**
 * Positive signals for plan-level content
 */
const PLAN_CHANGE_PATTERNS = [
  // Heading patterns
  /^(roadmap|execution|next phase|scope|plan|strategy|priorities)/i,
  // Future state language
  /\b(shift|pivot|reframe|reprioritize|defer|accelerate|narrow|expand|refocus)\b/i,
  /\b(from\s+.+\s+to|instead of|stop doing|start doing|move from)\b/i,
  // Scope language
  /\b(in scope|out of scope|descope|include|exclude|add to scope|remove from)\b/i,
  // Sequencing
  /\b(phase\s*\d|pilot first|full rollout|later cohort|before|after|then)\b/i,
  // Change indicators
  /\b(update|change|modify|adjust|revise)\s+(the|our|this)?\s*(scope|plan|approach|timeline)/i,
];

const NEW_WORKSTREAM_PATTERNS = [
  // Creation language
  /\b(launch|spin up|kick off|create|build|start|introduce|roll out|ship)\s+/i,
  // Program/initiative language
  /\b(new\s+(initiative|project|workstream|program|effort|track))\b/i,
  /\b(initiative|project|workstream|program)\s*:/i,
  // Goal-oriented
  /\b(goal|objective|mission|vision)\s*:/i,
  /\b(deliver|achieve|accomplish|complete)\s+/i,
];

/**
 * Deliverable-oriented patterns that indicate research tied to concrete outputs
 * When present, research signal should not block actionability
 */
const DELIVERABLE_PATTERNS = [
  // Concrete output types
  /\b(dashboard|report|page|system|platform|tool|app|application|service)\b/i,
  /\b(document|spec|specification|design|prototype|wireframe|mockup)\b/i,
  /\b(transparency|visibility|tracking|monitoring)\s+(report|page|dashboard|system)/i,
  // Outcome-oriented phrases
  /\b(publish|release|deploy|deliver|ship|produce|output)\b/i,
  /\b(build\s+.{3,30}|create\s+.{3,30}|develop\s+.{3,30})\b/i,
  // Milestone/deadline language with deliverables
  /\b(by\s+(end\s+of\s+)?(q\d|quarter|month|week)|deadline|due\s+date)\b/i,
];

/**
 * Product execution heading keywords that indicate actionable execution notes
 * These are weaker signals than strategic plan patterns but still actionable
 */
const PRODUCT_EXECUTION_HEADING_KEYWORDS = /\b(fix|bug|copy|structure|update|demo|translation|transparency|calculator|cta)\b/i;

/**
 * Change language in bullets that indicates actionable content
 */
const CHANGE_LANGUAGE_PATTERNS = [
  /\bshould\b/i,
  /\bneed to\b/i,
  /\bmove\b/i,
  /\badd\b/i,
  /\bupdate\b/i,
  /\bremove\b/i,
  /\bfocus on\b/i,
  /\bbalance between\b/i,
];

/**
 * UI change verbs that indicate concrete execution work
 * When present with research signals, treats section as execution rather than pure research
 */
const UI_CHANGE_VERBS = /\b(add|remove|show|label|notation)\b/i;

/**
 * Negative signals (out-of-scope content)
 */
const COMMUNICATION_PATTERNS = [
  /\b(send|email|share|notify|announce|forward|cc)\s+(the|this|a)?\s*(summary|notes|update|team)/i,
  /\b(let\s+.+\s+know|tell\s+.+\s+about|inform\s+.+\s+of)\b/i,
  /\b(slack|message|dm|ping)\s+/i,
];

const RESEARCH_PATTERNS = [
  /\b(investigate|figure out|explore|look into|research|understand|analyze)\b/i,
  /\b(do\s+(some|more)?\s*research|conduct\s+.+\s+analysis)\b/i,
  /\b(interview|survey|user research|competitive analysis)\b/i,
  /\b(find out|learn more|gather data|collect feedback)\b/i,
];

const CALENDAR_PATTERNS = [
  /\b(schedule|book|set up|find time|calendar|meeting)\s+(a|the)?\s*(meeting|call|sync)/i,
  /\b(next|this)\s+(monday|tuesday|wednesday|thursday|friday|week|month)\b/i,
  /\b(recurring|weekly|daily|monthly)\s+(meeting|sync|standup|check-in)/i,
  /\b(block\s+(off|out)?\s*time|add to calendar)\b/i,
];

const MICRO_TASK_PATTERNS = [
  /\b(update|edit|fix|tweak)\s+(the|a)?\s*(slide|doc|document|spreadsheet|deck)\b/i,
  /\b(add\s+.+\s+to\s+the\s+(list|doc|page))\b/i,
  /\b(clean up|organize|format|review)\s+(the|this)?\s*(notes|doc|file)/i,
  /\b(follow up|check in|touch base)\s+(with|on)\b/i,
  /\b(send\s+a\s+quick|drop\s+a|ping)\b/i,
];

// ============================================
// Intent Classification
// ============================================

/**
 * Count pattern matches in text
 */
function countPatternMatches(text: string, patterns: RegExp[]): number {
  let count = 0;
  for (const pattern of patterns) {
    if (pattern.test(text)) {
      count++;
    }
  }
  return count;
}

/**
 * Compute raw signal strength (0-1) based on pattern matches
 */
function computeSignalStrength(matchCount: number, totalPatterns: number): number {
  // Logarithmic scaling to avoid saturation
  const normalized = Math.min(1, matchCount / Math.max(1, totalPatterns * 0.3));
  return normalized;
}

/**
 * Check if text contains deliverable-oriented patterns
 */
function hasDeliverablePatterns(text: string): boolean {
  return DELIVERABLE_PATTERNS.some(pattern => pattern.test(text));
}

/**
 * Check if heading contains product execution keywords
 */
function hasProductExecutionHeading(headingText: string | undefined): boolean {
  if (!headingText) return false;
  return PRODUCT_EXECUTION_HEADING_KEYWORDS.test(headingText);
}

/**
 * Check if bullets contain change language
 */
function hasChangeLanguageInBullets(section: Section): boolean {
  const bulletText = section.body_lines
    .filter(line => line.line_type === 'list_item')
    .map(line => line.text)
    .join(' ');
  
  return CHANGE_LANGUAGE_PATTERNS.some(pattern => pattern.test(bulletText));
}

/**
 * Check if text contains UI change verbs
 */
function hasUIChangeVerbs(text: string): boolean {
  return UI_CHANGE_VERBS.test(text);
}

/**
 * Detect workstream-like structural cues in a section
 * Returns a boost value (0-0.3) based on structural features
 */
function computeWorkstreamStructuralBoost(section: Section): number {
  let boost = 0;
  const sf = section.structural_features;
  const text = (section.heading_text || '') + ' ' + section.raw_text;

  // Title-case section titles suggest formal workstream naming
  if (section.heading_text) {
    const isTitleCase = /^[A-Z][a-z]+(\s+[A-Z][a-z]+)+/.test(section.heading_text);
    if (isTitleCase) {
      boost += 0.1;
    }
  }

  // Workstream-like keywords in heading
  if (section.heading_text && /\b(milestone|deliverable|dashboard|report|initiative|program|workstream)\b/i.test(section.heading_text)) {
    boost += 0.15;
  }

  // Substantial content suggests workstream planning
  if (sf.num_lines >= 5) {
    boost += 0.1;
  }

  // Presence of metrics, KPIs, or percentages suggests initiative planning
  if (/\b(\d+%|\d+\s*(days?|weeks?|months?)|kpi|metric|target|goal)\b/i.test(text)) {
    boost += 0.1;
  }

  // Imperative or outcome-focused verbs in text
  const imperativePattern = /\b(launch|build|create|deliver|implement|ship|develop|establish|deploy)\s+\w/i;
  if (imperativePattern.test(text)) {
    boost += 0.1;
  }

  return Math.min(0.35, boost); // Cap the structural boost
}

// ============================================
// Actionability Gate v3 - Constants and Helpers
// ============================================

/**
 * V3 Request stems for strong request pattern detection
 */
const V3_REQUEST_STEMS = [
  'please',
  'can you',
  'could you',
  'would you',
  'i want you to',
  "i'd like you to",
  'i would like you to',
  'i would really like you to',
  'we should',
  'we probably should',
  'should',
  "let's",
  'lets',
  'need to',
  'we need to',
  'maybe we need',
  'we may need to',
  'it would be good to',
  'asking for',
  'requested',
  'want to',
  'would like',
];

/**
 * V3 Action verbs for directive detection
 */
const V3_ACTION_VERBS = [
  'add',
  'implement',
  'build',
  'create',
  'enable',
  'disable',
  'remove',
  'delete',
  'fix',
  'update',
  'change',
  'refactor',
  'improve',
  'support',
  'integrate',
  'adjust',
  'modify',
  'revise',
];

/**
 * V3 Change operators for plan mutation detection
 * Extended from spec to include commonly-used change language from existing patterns
 * Includes verb forms: base, gerund (-ing), past tense (-ed)
 */
const V3_CHANGE_OPERATORS = [
  'move',
  'moving',
  'moved',
  'push',
  'pushing',
  'pushed',
  'delay',
  'delaying',
  'delayed',
  'slip',
  'slipping',
  'slipped',
  'bring forward',
  'bringing forward',
  'brought forward',
  'postpone',
  'postponing',
  'postponed',
  'deprioritize',
  'deprioritizing',
  'deprioritized',
  'prioritize',
  'prioritizing',
  'prioritized',
  // Additional change operators from production patterns
  'shift',
  'shifting',
  'shifted',
  'pivot',
  'pivoting',
  'pivoted',
  'reframe',
  'reframing',
  'reframed',
  'reprioritize',
  'reprioritizing',
  'reprioritized',
  'defer',
  'deferring',
  'deferred',
  'accelerate',
  'accelerating',
  'accelerated',
  'narrow',
  'narrowing',
  'narrowed',
  'expand',
  'expanding',
  'expanded',
  'refocus',
  'refocusing',
  'refocused',
  'adjust',
  'adjusting',
  'adjusted',
  'modify',
  'modifying',
  'modified',
  'revise',
  'revising',
  'revised',
  'take over',
  'taking over',
  'took over',
  'instead of',
  'now p0',
  'now p1',
  'now p2',
];

/**
 * V3 Status/progress markers
 */
const V3_STATUS_MARKERS = [
  'done',
  'shipped',
  'deployed',
  'released',
  'implemented',
  'merged',
  'blocked',
  'waiting on',
  'in progress',
];

/**
 * V3 Product/target nouns for bonus scoring
 */
const V3_PRODUCT_NOUNS = [
  'onboarding',
  'signup',
  'flow',
  'ui',
  'api',
  'integration',
  'pricing',
  'dashboard',
  'tracking',
  'analytics',
];

/**
 * V3 Bullet action verbs — when ≥2 bullets start with these verbs the section
 * is treated as actionable (micro_tasks or idea).
 */
const V3_ACTIONABILITY_VERBS = [
  'add', 'verify', 'update', 'share', 'remove', 'fix', 'create', 'build',
  'implement', 'test', 'review', 'check', 'ensure', 'set up', 'deploy',
  'migrate', 'refactor', 'integrate', 'move', 'send', 'confirm', 'finalize',
];

/**
 * V3 Hedged directive phrases that are self-sufficient actionable signals.
 * These don't require a paired action verb — the hedge + directive structure
 * itself expresses intent (e.g. "maybe we need to rethink the pricing model").
 * Scored at +0.9 to pass the actionability gate.
 */
const V3_HEDGED_DIRECTIVES = [
  'we should',
  'we probably should',
  'maybe we need',
  'we may need to',
  'it would be good to',
  "let's",
  'lets',
];

/**
 * V3 Negation patterns that override action verbs
 */
const V3_NEGATION_PATTERNS = [
  "don't",
  'do not',
  'no need to',
  'not necessary to',
];

/**
 * V3 Calendar markers for out-of-scope detection
 */
const V3_CALENDAR_MARKERS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
  'next week',
  'this week',
  'next month',
  'q1',
  'q2',
  'q3',
  'q4',
  'quarter',
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

/**
 * V3 Communication markers for out-of-scope detection
 */
const V3_COMMUNICATION_MARKERS = [
  'email',
  'send',
  'slack',
  'follow up',
  'reach out',
  'ping',
];

/**
 * V3 Micro/admin markers for out-of-scope detection
 */
const V3_MICRO_ADMIN_MARKERS = [
  'rename file',
  'update doc link',
  'fix typo',
];

/**
 * Preprocess a line for v3 matching (lowercase, trim, collapse whitespace)
 */
function preprocessLine(lineText: string): string {
  return lineText
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * V3 Rule 1: Strong request pattern (request stem + action verb) = +1.0
 *
 * Maps to actionableSignal. This is the highest-precision signal for
 * explicit user requests like "I would really like you to add..."
 */
function matchStrongRequestPattern(line: string): number {
  const hasStem = V3_REQUEST_STEMS.some(stem => line.includes(stem));
  const hasVerb = V3_ACTION_VERBS.some(verb => {
    const regex = new RegExp(`\\b${verb}\\b`, 'i');
    return regex.test(line);
  });
  return hasStem && hasVerb ? 1.0 : 0.0;
}

/**
 * V3 Rule 2: Imperative verb at line start = +0.9
 *
 * Maps to actionableSignal. Detects commands like "Add boundary detection"
 */
function matchImperativeVerb(line: string): number {
  for (const verb of V3_ACTION_VERBS) {
    const regex = new RegExp(`^${verb}\\b`, 'i');
    if (regex.test(line)) {
      return 0.9;
    }
  }
  return 0.0;
}

/**
 * V3 Rule 3: Change operator pattern = +0.8
 *
 * Maps to actionableSignal. Detects plan mutations like "Move launch to next week"
 */
function matchChangeOperator(line: string): number {
  return V3_CHANGE_OPERATORS.some(op => line.includes(op)) ? 0.8 : 0.0;
}

/**
 * V3 Rule 4: Status/progress markers = +0.7
 *
 * Maps to actionableSignal. Detects status updates like "Blocked by security review"
 * or decisions like "Done", "Shipped"
 */
function matchStatusMarkers(line: string): number {
  return V3_STATUS_MARKERS.some(marker => line.includes(marker)) ? 0.7 : 0.0;
}

/**
 * V3 Rule 5: Structured task syntax = +0.8
 *
 * Maps to actionableSignal. Detects markdown tasks, TODOs, action items
 */
function matchStructuredTask(line: string): number {
  if (
    line.includes('- [ ]') ||
    line.includes('todo:') ||
    line.includes('action:') ||
    line.includes('owner:')
  ) {
    return 0.8;
  }
  return 0.0;
}

/**
 * V3 Rule 6b: Hedged directive = +0.9
 *
 * Maps to actionableSignal. Detects hedged but directive phrases like
 * "we should rethink the pricing model" or "maybe we need a new approach".
 * These phrases are self-sufficient — they don't require a paired action verb
 * because the hedge + directive structure itself implies a call to action.
 */
function matchHedgedDirective(line: string): number {
  return V3_HEDGED_DIRECTIVES.some(phrase => line.includes(phrase)) ? 0.9 : 0.0;
}

/**
 * V3 Rule 6: Target object bonus = +0.2
 *
 * Maps to actionableSignal. Applied only if currentScore >= 0.6 and line contains
 * a product noun. Reduces noise by requiring existing actionable signal.
 */
function matchTargetObjectBonus(line: string, currentScore: number): number {
  if (currentScore >= 0.6 && V3_PRODUCT_NOUNS.some(noun => line.includes(noun))) {
    return 0.2;
  }
  return 0.0;
}

/**
 * V3 Negative Rule: Negation override
 *
 * If a line contains both a negation pattern and an action verb,
 * the line score is forced to 0.0
 */
function hasNegationOverride(line: string): boolean {
  const hasNegation = V3_NEGATION_PATTERNS.some(neg => line.includes(neg));
  const hasVerb = V3_ACTION_VERBS.some(verb => {
    const regex = new RegExp(`\\b${verb}\\b`, 'i');
    return regex.test(line);
  });
  return hasNegation && hasVerb;
}

/**
 * Check if a marker appears in text as a whole word (word-boundary match).
 * Prevents false positives like "maybe" matching the "may" calendar marker.
 */
function markerMatchesWord(line: string, marker: string): boolean {
  // Multi-word markers use includes (word boundaries are implicit)
  if (marker.includes(' ')) {
    return line.includes(marker);
  }
  const regex = new RegExp(`\\b${marker}\\b`);
  return regex.test(line);
}

/**
 * V3 Out-of-scope signal computation
 *
 * Returns max out-of-scope signal for a line plus matched markers for debug:
 * - Calendar markers: +0.6
 * - Communication markers: +0.6
 * - Micro/admin markers: +0.4
 */
function computeOutOfScopeForLine(line: string): { score: number; markers: string[] } {
  let score = 0;
  const markers: string[] = [];

  const calendarMatches = V3_CALENDAR_MARKERS.filter(marker => markerMatchesWord(line, marker));
  if (calendarMatches.length > 0) {
    score = Math.max(score, 0.6);
    markers.push(...calendarMatches.map(m => `calendar:${m}`));
  }

  const commMatches = V3_COMMUNICATION_MARKERS.filter(marker => markerMatchesWord(line, marker));
  if (commMatches.length > 0) {
    score = Math.max(score, 0.6);
    markers.push(...commMatches.map(m => `communication:${m}`));
  }

  const microMatches = V3_MICRO_ADMIN_MARKERS.filter(marker => markerMatchesWord(line, marker));
  if (microMatches.length > 0) {
    score = Math.max(score, 0.4);
    markers.push(...microMatches.map(m => `micro:${m}`));
  }

  return { score, markers };
}

/**
 * Classify a section's intent
 */
export function classifyIntent(section: Section): IntentClassification {
  // ============================================
  // ACTIONABILITY GATE V3 - Rule-Based Implementation
  // ============================================
  //
  // V3 computes per-section actionableSignal and outOfScopeSignal using
  // explicit, explainable rules instead of pattern counting.
  //
  // POSITIVE SIGNALS (all contribute to actionableSignal):
  // 1. Strong request pattern (stem + verb): +1.0
  // 2. Imperative verb at line start: +0.9
  // 3. Change operator (move, delay, etc.): +0.8
  // 4. Status/progress markers (done, blocked): +0.7
  // 5. Structured task syntax (- [ ], TODO:): +0.8
  // 6. Target object bonus (if score >= 0.6): +0.2
  //
  // NEGATIVE SIGNALS:
  // - Negation override: if line has "don't" + verb → score = 0.0
  //
  // OUT-OF-SCOPE SIGNALS:
  // - Calendar markers: 0.6
  // - Communication markers: 0.6
  // - Micro/admin markers: 0.4
  //
  // OVERRIDE:
  // - If actionableSignal >= 0.8, clamp outOfScopeSignal <= 0.3
  //
  // MAPPING TO SCHEMA:
  // - actionableSignal distributed to plan_change/new_workstream
  // - outOfScopeSignal distributed to calendar/communication/micro_tasks
  // - Downstream: computeActionabilitySignals() extracts max(plan_change, new_workstream)
  //
  // ============================================

  const lines = section.body_lines.map(l => preprocessLine(l.text));

  let maxActionableScore = 0;
  let maxOutOfScopeScore = 0;
  // Track max score from non-hedged rules so out-of-scope override only
  // fires when a strong non-hedged signal is present.
  let maxNonHedgedActionableScore = 0;

  // Track which types of signals fired for intent distribution
  let hasChangeOperators = false;
  let hasStructuredTasks = false;
  let hasCalendarMarkers = false;
  let hasCommunicationMarkers = false;
  let hasMicroAdminMarkers = false;

  // Process each line
  for (const line of lines) {
    // Skip empty or very short lines (headings, fragments)
    if (line.length < 5) continue;

    // Compute positive signals (all contribute to actionableSignal)
    let lineScore = 0;

    // Rule 1: Strong request pattern
    lineScore = Math.max(lineScore, matchStrongRequestPattern(line));

    // Rule 2: Imperative verb at start
    lineScore = Math.max(lineScore, matchImperativeVerb(line));

    // Rule 3: Change operator
    const changeOpScore = matchChangeOperator(line);
    if (changeOpScore > 0) hasChangeOperators = true;
    lineScore = Math.max(lineScore, changeOpScore);

    // Rule 4: Status/progress markers (includes decisions like "done", "blocked")
    lineScore = Math.max(lineScore, matchStatusMarkers(line));

    // Rule 5: Structured task syntax
    const structuredTaskScore = matchStructuredTask(line);
    if (structuredTaskScore > 0) hasStructuredTasks = true;
    lineScore = Math.max(lineScore, structuredTaskScore);

    // Snapshot non-hedged score before applying hedged directive rule
    const nonHedgedLineScore = lineScore;

    // Rule 6b: Hedged directive (self-sufficient, no action verb required)
    lineScore = Math.max(lineScore, matchHedgedDirective(line));

    // Rule 6: Target object bonus (only if already actionable)
    lineScore += matchTargetObjectBonus(line, lineScore);

    // Negative rule: Negation override
    if (hasNegationOverride(line)) {
      lineScore = 0.0;
    }

    // Clamp line score to [0,1]
    lineScore = Math.min(1.0, Math.max(0.0, lineScore));

    maxActionableScore = Math.max(maxActionableScore, lineScore);
    maxNonHedgedActionableScore = Math.max(maxNonHedgedActionableScore, nonHedgedLineScore);

    // Compute out-of-scope signal
    const oosResult = computeOutOfScopeForLine(line);
    if (oosResult.score > 0) {
      // Track which marker types fired for intent distribution
      if (V3_CALENDAR_MARKERS.some(m => markerMatchesWord(line, m))) {
        hasCalendarMarkers = true;
      }
      if (V3_COMMUNICATION_MARKERS.some(m => markerMatchesWord(line, m))) {
        hasCommunicationMarkers = true;
      }
      if (V3_MICRO_ADMIN_MARKERS.some(m => markerMatchesWord(line, m))) {
        hasMicroAdminMarkers = true;
      }
      // Debug breadcrumb: markers are tracked in oosResult.markers but not propagated
      // to maintain minimal external contract changes. Available for future debug logging.
    }
    maxOutOfScopeScore = Math.max(maxOutOfScopeScore, oosResult.score);
  }

  // V3 Rule 7: Action-verb pattern boost.
  // Action verbs in the text boost actionability when out-of-scope signals are low.
  // This prevents generic admin task lists from being promoted.
  const lowerText = section.raw_text.toLowerCase();
  const actionVerbMatches = V3_ACTIONABILITY_VERBS.filter(v =>
    new RegExp(`\\b${v}\\s+\\w`, 'i').test(lowerText)
  ).length;
  if (actionVerbMatches >= 2 && maxOutOfScopeScore < 0.4) {
    maxActionableScore = Math.max(maxActionableScore, 0.8);
    maxNonHedgedActionableScore = Math.max(maxNonHedgedActionableScore, 0.8);
  }

  // V3 OVERRIDE: If actionableSignal >= 0.8, clamp outOfScopeSignal <= 0.3
  // This prevents high-actionability sections with calendar references
  // (e.g., "Move launch to next week") from being filtered as out-of-scope.
  // Only apply when the high signal comes from a non-hedged rule — hedged
  // directives about admin tasks ("we should send an email") should still
  // be filtered by out-of-scope logic.
  if (maxNonHedgedActionableScore >= 0.8) {
    maxOutOfScopeScore = Math.min(0.3, maxOutOfScopeScore);
  }

  // Map actionableSignal to plan_change/new_workstream distribution
  // Heuristic: if section has change operators or structured tasks → plan_change dominant
  // Otherwise → new_workstream dominant
  const isPlanChangeDominant = hasChangeOperators || hasStructuredTasks;

  let plan_change: number;
  let new_workstream: number;

  if (isPlanChangeDominant) {
    // Plan change gets full signal, new_workstream gets partial
    plan_change = maxActionableScore;
    new_workstream = maxActionableScore * 0.4;
  } else {
    // New workstream gets full signal, plan_change gets partial
    new_workstream = maxActionableScore;
    plan_change = maxActionableScore * 0.4;
  }

  // Distribute outOfScopeSignal to calendar/communication/micro_tasks
  // based on which markers were detected
  let calendar = 0;
  let communication = 0;
  let micro_tasks = 0;

  if (hasCalendarMarkers) {
    calendar = maxOutOfScopeScore;
  }
  if (hasCommunicationMarkers) {
    communication = maxOutOfScopeScore;
  }
  if (hasMicroAdminMarkers) {
    micro_tasks = maxOutOfScopeScore;
  }

  // If no specific markers detected but score > 0, default to calendar
  if (maxOutOfScopeScore > 0 && !hasCalendarMarkers && !hasCommunicationMarkers && !hasMicroAdminMarkers) {
    calendar = maxOutOfScopeScore;
  }

  // Status/informational is inverse of actionable signals (keep existing logic for compatibility)
  const status_informational = Math.max(0, 0.5 - maxActionableScore + maxOutOfScopeScore * 0.3);

  // Research is not used in v3 gate logic (set to 0)
  const research = 0;

  return {
    plan_change,
    new_workstream,
    status_informational,
    communication,
    research,
    calendar,
    micro_tasks,
  };
}

// ============================================
// Actionability Determination
// ============================================

/**
 * Check if an intent classification represents a plan_change intent label
 * 
 * This mirrors the debug JSON notion of intentLabel === "plan_change".
 * A section is considered plan_change if plan_change score is the highest
 * among all intent scores (pure argmax, no floor).
 */
export function isPlanChangeIntentLabel(intent: IntentClassification): boolean {
  const scoresByLabel = {
    plan_change: intent.plan_change,
    new_workstream: intent.new_workstream,
    status_informational: intent.status_informational,
    communication: intent.communication,
    research: intent.research,
    calendar: intent.calendar,
    micro_tasks: intent.micro_tasks,
  };

  const maxScore = Math.max(...Object.values(scoresByLabel));

  // Match debug semantics: top label is plan_change (pure argmax)
  return scoresByLabel.plan_change === maxScore;
}

/**
 * Compute actionability signals from intent classification
 * 
 * actionableSignal = max(plan_change, new_workstream)
 * outOfScopeSignal = max(calendar, communication, micro_tasks)
 * 
 * Note: research is deliberately excluded from outOfScopeSignal to allow
 * high-research sections with concrete execution language to be actionable.
 * Research signal is dampened in classifyIntent when deliverable patterns or
 * UI verbs are detected.
 */
export function computeActionabilitySignals(intent: IntentClassification): {
  actionableSignal: number;
  outOfScopeSignal: number;
} {
  const actionableSignal = Math.max(intent.plan_change, intent.new_workstream);
  const outOfScopeSignal = Math.max(
    intent.calendar,
    intent.communication,
    intent.micro_tasks
  );
  return { actionableSignal, outOfScopeSignal };
}

/**
 * Determine if a section is actionable based on intent
 * 
 * Gating condition (per spec):
 *   isActionable = actionableSignal >= T_action && outOfScopeSignal < T_out_of_scope
 * 
 * PLAN_CHANGE PROTECTION: plan_change sections are NEVER dropped at ACTIONABILITY stage.
 * They always pass through to ensure "plan_change intent always yields at least one suggestion".
 * 
 * Note: Uses >= for actionability threshold so equality passes.
 */
export function isActionable(
  intent: IntentClassification,
  section: Section,
  thresholds: ThresholdConfig
): { actionable: boolean; reason: string; actionableSignal: number; outOfScopeSignal: number } {
  const { actionableSignal, outOfScopeSignal } = computeActionabilitySignals(intent);

  // Short sections require higher thresholds (penalty for very short sections)
  const shortSectionPenalty = section.structural_features.num_lines <= 2 ? 0.15 : 0;
  const effectiveThreshold = thresholds.T_action + shortSectionPenalty;

  // PLAN_CHANGE PROTECTION: Use canonical helper to detect plan_change intent
  const isPlanChange = isPlanChangeIntentLabel(intent);
  
  if (isPlanChange) {
    // PLAN_CHANGE OVERRIDE: never drop at ACTIONABILITY gate
    return {
      actionable: true,
      reason: `plan_change override: bypass ACTIONABILITY gate (signal=${actionableSignal.toFixed(3)}, outOfScope=${outOfScopeSignal.toFixed(3)}, T_action=${effectiveThreshold.toFixed(3)})`,
      actionableSignal,
      outOfScopeSignal,
    };
  }

  // Existing non-plan_change gates remain as-is
  
  // Check actionability: actionableSignal >= T_action (with penalty for short sections)
  // Using >= means that a section with actionableSignal == T_action passes
  if (actionableSignal < effectiveThreshold) {
    return {
      actionable: false,
      reason: `Action signal too low: ${actionableSignal.toFixed(3)} < ${effectiveThreshold.toFixed(3)} (T_action=${thresholds.T_action}, penalty=${shortSectionPenalty.toFixed(2)})`,
      actionableSignal,
      outOfScopeSignal,
    };
  }

  // Check out-of-scope: outOfScopeSignal < T_out_of_scope
  // Using >= here means that if outOfScopeSignal == T_out_of_scope, section is NOT actionable
  if (outOfScopeSignal >= thresholds.T_out_of_scope) {
    return {
      actionable: false,
      reason: `Out-of-scope signal too high: ${outOfScopeSignal.toFixed(3)} >= ${thresholds.T_out_of_scope} (cal=${intent.calendar.toFixed(2)}, comm=${intent.communication.toFixed(2)}, micro=${intent.micro_tasks.toFixed(2)}) [research=${intent.research.toFixed(2)} excluded from gate]`,
      actionableSignal,
      outOfScopeSignal,
    };
  }

  // Additional check: very short sections with borderline signals need extra scrutiny
  // Only apply if the section barely crosses the threshold
  const marginAboveThreshold = actionableSignal - effectiveThreshold;
  if (marginAboveThreshold < 0.1 && section.structural_features.num_lines <= 3) {
    return {
      actionable: false,
      reason: `Insufficient content for borderline signal: margin=${marginAboveThreshold.toFixed(3)}, lines=${section.structural_features.num_lines}`,
      actionableSignal,
      outOfScopeSignal,
    };
  }

  return {
    actionable: true,
    reason: `Actionable: signal=${actionableSignal.toFixed(3)} >= ${effectiveThreshold.toFixed(3)}, outOfScope=${outOfScopeSignal.toFixed(3)} < ${thresholds.T_out_of_scope}`,
    actionableSignal,
    outOfScopeSignal,
  };
}

// ============================================
// Type Classification
// ============================================

/**
 * Patterns indicating plan mutation (change to existing)
 */
const PLAN_MUTATION_PATTERNS = [
  // Adjustment language
  /\b(narrow|expand|shift|reframe|reprioritize|defer|adjust|revise|update)\b/i,
  // Reference to current state
  /\b(current|existing|today's|our\s+current|the\s+current)\b/i,
  // Comparative/contrastive
  /\b(from\s+.+\s+to|instead of|rather than|no longer|previously)\b/i,
  // Scope modification
  /\b(descope|add to|remove from|in scope|out of scope)\b/i,
];

/**
 * Patterns indicating execution artifact (new creation)
 */
const EXECUTION_ARTIFACT_PATTERNS = [
  // New creation
  /\b(new|launch|spin up|kick off|create|build|start|introduce)\s+(a\s+|an\s+|the\s+)?/i,
  // Program language
  /\b(initiative|project|workstream|program|effort|track)\b/i,
  // Standalone goal
  /\b(objective|goal|mission)\s*:/i,
  // From scratch
  /\b(from scratch|greenfield|net new|brand new)\b/i,
];

/**
 * Classify section type (project_update vs idea)
 */
export function classifyType(section: Section, intent: IntentClassification): {
  type: SectionType;
  confidence: number;
  p_mutation: number;
  p_artifact: number;
} {
  const text = (section.heading_text || '') + ' ' + section.raw_text;

  const mutationMatches = countPatternMatches(text, PLAN_MUTATION_PATTERNS);
  const artifactMatches = countPatternMatches(text, EXECUTION_ARTIFACT_PATTERNS);

  // Base probabilities from pattern matches
  let p_mutation = computeSignalStrength(mutationMatches, PLAN_MUTATION_PATTERNS.length);
  let p_artifact = computeSignalStrength(artifactMatches, EXECUTION_ARTIFACT_PATTERNS.length);

  // Boost from intent classification
  p_mutation += intent.plan_change * 0.3;
  p_artifact += intent.new_workstream * 0.3;

  // Cap at 1
  p_mutation = Math.min(1, p_mutation);
  p_artifact = Math.min(1, p_artifact);

  // Determine type based on higher probability
  if (p_mutation < 0.2 && p_artifact < 0.2) {
    return {
      type: 'non_actionable',
      confidence: 1 - Math.max(p_mutation, p_artifact),
      p_mutation,
      p_artifact,
    };
  }

  if (p_mutation > p_artifact) {
    const margin = p_mutation - p_artifact;
    return {
      type: 'project_update',
      confidence: Math.min(1, 0.5 + margin),
      p_mutation,
      p_artifact,
    };
  } else {
    const margin = p_artifact - p_mutation;
    return {
      type: 'idea',
      confidence: Math.min(1, 0.5 + margin),
      p_mutation,
      p_artifact,
    };
  }
}

// ============================================
// Full Classification Pipeline
// ============================================

/**
 * Compute typeLabel: idea vs project_update.
 *
 * Returns "project_update" when plan_change is the dominant intent.
 * Returns "idea" for all actionable new_workstream sections.
 */
function computeTypeLabel(
  section: Section,
  intent: IntentClassification
): 'idea' | 'project_update' {
  if (isPlanChangeIntentLabel(intent)) {
    return 'project_update';
  }
  return 'idea';
}

/**
 * Classify a section (intent + actionability + type)
 */
export function classifySection(
  section: Section,
  thresholds: ThresholdConfig
): ClassifiedSection {
  // Classify intent
  const intent = classifyIntent(section);

  // Use canonical plan_change detection
  const isPlanChange = isPlanChangeIntentLabel(intent);

  // Determine actionability
  const actionabilityResult = isActionable(intent, section, thresholds);

  // If actionability thinks not actionable BUT intent label is plan_change,
  // upgrade to actionable and rely on downgrade semantics later.
  if (!actionabilityResult.actionable && isPlanChange) {
    return {
      ...section,
      intent,
      is_actionable: true,
      actionability_reason: `${actionabilityResult.reason} (overridden for plan_change intent)`,
      actionable_signal: actionabilityResult.actionableSignal,
      out_of_scope_signal: actionabilityResult.outOfScopeSignal,
      suggested_type: 'project_update',
      type_confidence: 0.3, // explicit low confidence
      typeLabel: 'project_update',
    };
  }

  // Classify type if actionable
  let suggestedType: SectionType | undefined;
  let typeConfidence: number | undefined;

  if (actionabilityResult.actionable) {
    const typeResult = classifyType(section, intent);

    if (typeResult.type === 'non_actionable') {
      if (isPlanChange) {
        // Strengthened PLAN_CHANGE PROTECTION at TYPE stage
        // Force project_update type and ensure actionability stays true
        suggestedType = 'project_update';
        typeConfidence = 0.3;
        // Return early with forced project_update to prevent any drop
        return {
          ...section,
          intent,
          is_actionable: true,
          actionability_reason:
            `${actionabilityResult.reason} (type non_actionable overridden for plan_change)`,
          actionable_signal: actionabilityResult.actionableSignal,
          out_of_scope_signal: actionabilityResult.outOfScopeSignal,
          suggested_type: suggestedType,
          type_confidence: typeConfidence,
          typeLabel: 'project_update',
        };
      } else {
        // Non-plan_change can still be dropped by TYPE
        return {
          ...section,
          intent,
          is_actionable: false,
          actionability_reason: 'Type classification: non-actionable',
          actionable_signal: actionabilityResult.actionableSignal,
          out_of_scope_signal: actionabilityResult.outOfScopeSignal,
          suggested_type: undefined,
          type_confidence: undefined,
        };
      }
    } else {
      suggestedType = typeResult.type;
      typeConfidence = typeResult.confidence;

      // For plan_change sections, force to project_update
      if (isPlanChange && suggestedType !== 'project_update') {
        suggestedType = 'project_update';
      }

      // Guard: project_update only for plan_change intent.
      // Non-plan_change sections should be idea.
      if (!isPlanChange && suggestedType === 'project_update') {
        suggestedType = 'idea';
      }
    }
  }

  // For plan_change sections with no suggested type, force project_update
  if (isPlanChange && !suggestedType) {
    suggestedType = 'project_update';
    typeConfidence = 0.2; // explicit "fallback" confidence
  }

  // Compute typeLabel for validator behavior
  const typeLabel = computeTypeLabel(section, intent);

  return {
    ...section,
    intent,
    is_actionable: actionabilityResult.actionable,
    actionability_reason: actionabilityResult.reason,
    actionable_signal: actionabilityResult.actionableSignal,
    out_of_scope_signal: actionabilityResult.outOfScopeSignal,
    suggested_type: suggestedType,
    type_confidence: typeConfidence,
    typeLabel,
  };
}

/**
 * Classify all sections in a note
 */
export function classifySections(
  sections: Section[],
  thresholds: ThresholdConfig
): ClassifiedSection[] {
  return sections.map((section) => classifySection(section, thresholds));
}

/**
 * Filter to only actionable sections
 * 
 * PLAN_CHANGE PROTECTION: plan_change sections are never filtered out,
 * even if some upstream bug left is_actionable false. This function also
 * heals any plan_change sections that were mis-classified as non-actionable
 * to ensure they always proceed to synthesis.
 */
export function filterActionableSections(
  classifiedSections: ClassifiedSection[]
): ClassifiedSection[] {
  // First pass: heal any plan_change sections that are marked non-actionable
  const upgraded = classifiedSections.map((s) => {
    const isPlanChange = isPlanChangeIntentLabel(s.intent);
    if (isPlanChange && !s.is_actionable) {
      // Force actionable and document the override
      return {
        ...s,
        is_actionable: true,
        actionability_reason:
          s.actionability_reason ||
          'plan_change override: forced actionable at ACTIONABILITY gate',
      };
    }
    return s;
  });

  // Second pass: filter to include plan_change or actionable sections
  return upgraded.filter((s) => {
    const isPlanChange = isPlanChangeIntentLabel(s.intent);
    return isPlanChange || s.is_actionable;
  });
}

// ============================================
// LLM-Enhanced Classification (when enabled)
// ============================================

import type { LLMProvider } from './llmClassifiers';
import { classifyIntentWithLLM, blendIntentScores } from './llmClassifiers';

/**
 * Options for LLM-enhanced classification
 */
export interface LLMClassificationOptions {
  /** LLM provider instance */
  llmProvider: LLMProvider;
  /** Whether to blend LLM + rule-based scores (default: true) */
  blendWithRuleBased?: boolean;
}

/**
 * Classify a section using LLM-enhanced classification
 * Falls back to rule-based if LLM fails
 */
export async function classifySectionWithLLM(
  section: Section,
  thresholds: ThresholdConfig,
  options: LLMClassificationOptions
): Promise<ClassifiedSection> {
  // Get rule-based intent as baseline/fallback
  const ruleBasedIntent = classifyIntent(section);

  let intent: IntentClassification;

  try {
    // Get LLM-based intent
    const llmIntent = await classifyIntentWithLLM(section, options.llmProvider);

    // Blend or use LLM directly
    if (options.blendWithRuleBased !== false) {
      // Blend LLM with rule-based for robustness
      intent = blendIntentScores(llmIntent, ruleBasedIntent, 0.7);
    } else {
      intent = llmIntent;
    }
  } catch (error) {
    // Fall back to rule-based on LLM failure
    console.warn('LLM classification failed, falling back to rule-based:', error);
    intent = ruleBasedIntent;
  }

  // Use canonical plan_change detection
  const isPlanChange = isPlanChangeIntentLabel(intent);

  // Determine actionability
  const actionabilityResult = isActionable(intent, section, thresholds);

  // PLAN_CHANGE PROTECTION: upgrade non-actionable to actionable (low signal override)
  if (!actionabilityResult.actionable && isPlanChange) {
    return {
      ...section,
      intent,
      is_actionable: true,
      actionability_reason: `${actionabilityResult.reason} (overridden for plan_change intent)`,
      actionable_signal: actionabilityResult.actionableSignal,
      out_of_scope_signal: actionabilityResult.outOfScopeSignal,
      suggested_type: 'project_update',
      type_confidence: 0.3,
    };
  }

  // Classify type if actionable
  let suggestedType: SectionType | undefined;
  let typeConfidence: number | undefined;

  if (actionabilityResult.actionable) {
    // For now, use rule-based type classification
    // LLM type classification can be added later if needed
    const typeResult = classifyType(section, intent);

    if (typeResult.type === 'non_actionable') {
      if (isPlanChange) {
        // Strengthened PLAN_CHANGE PROTECTION at TYPE stage
        // Force project_update type and ensure actionability stays true
        suggestedType = 'project_update';
        typeConfidence = 0.3;
        // Return early with forced project_update to prevent any drop
        return {
          ...section,
          intent,
          is_actionable: true,
          actionability_reason:
            `${actionabilityResult.reason} (type non_actionable overridden for plan_change)`,
          actionable_signal: actionabilityResult.actionableSignal,
          out_of_scope_signal: actionabilityResult.outOfScopeSignal,
          suggested_type: suggestedType,
          type_confidence: typeConfidence,
          typeLabel: 'project_update',
        };
      } else {
        // Non-plan_change can still be dropped by TYPE
        return {
          ...section,
          intent,
          is_actionable: false,
          actionability_reason: 'Type classification: non-actionable',
          actionable_signal: actionabilityResult.actionableSignal,
          out_of_scope_signal: actionabilityResult.outOfScopeSignal,
          suggested_type: undefined,
          type_confidence: undefined,
        };
      }
    } else {
      suggestedType = typeResult.type;
      typeConfidence = typeResult.confidence;

      // For plan_change sections, force to project_update
      if (isPlanChange && suggestedType !== 'project_update') {
        suggestedType = 'project_update';
      }

      // Guard: project_update only for plan_change intent.
      if (!isPlanChange && suggestedType === 'project_update') {
        suggestedType = 'idea';
      }
    }
  }

  // Fallback: plan_change with no suggested type → force project_update
  if (isPlanChange && !suggestedType) {
    suggestedType = 'project_update';
    typeConfidence = 0.2;
  }

  // Compute typeLabel for validator behavior
  const typeLabel = computeTypeLabel(section, intent);

  return {
    ...section,
    intent,
    is_actionable: actionabilityResult.actionable,
    actionability_reason: actionabilityResult.reason,
    actionable_signal: actionabilityResult.actionableSignal,
    out_of_scope_signal: actionabilityResult.outOfScopeSignal,
    suggested_type: suggestedType,
    type_confidence: typeConfidence,
    typeLabel,
  };
}

/**
 * Classify all sections with LLM enhancement
 */
export async function classifySectionsWithLLM(
  sections: Section[],
  thresholds: ThresholdConfig,
  options: LLMClassificationOptions
): Promise<ClassifiedSection[]> {
  // Process sections in parallel for efficiency
  return Promise.all(
    sections.map((section) => classifySectionWithLLM(section, thresholds, options))
  );
}
