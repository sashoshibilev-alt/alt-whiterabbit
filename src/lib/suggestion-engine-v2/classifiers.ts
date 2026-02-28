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
import { extractSignalsFromSentences } from './signals';
import {
  SPEC_FRAMEWORK_TOKENS,
  SPEC_FRAMEWORK_TOKEN_LIST,
  SPEC_FRAMEWORK_TIMELINE_EXCLUSIONS,
} from './sectionSignals';

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
  'requirement',  // "requirement to implement" pattern
];

/**
 * V3 Action verbs for directive detection
 *
 * ⚠️ Keep this list in sync with IMPERATIVE_WORK_VERBS in synthesis.ts.
 * These verb sets must remain aligned for idea detection consistency.
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
 * Proposal verbs for idea synthesis (used only in synthesis, not for actionability)
 * These verbs signal solution-oriented language that should be preferred when
 * generating idea suggestion bodies and evidence spans.
 */
export const PROPOSAL_VERBS_IDEA_ONLY = [
  'add',
  'reduce',
  'merge',
  'streamline',
  'simplify',
  'remove',
  'eliminate',
  'consolidate',
  'log',
  'cut',
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
 * Concrete delta evidence patterns for plan_change tightening.
 *
 * A "concrete delta" means the sentence contains a measurable, time-bounded
 * change — not just vague directional language like "shift priorities" or
 * "move faster".  We recognise two shapes:
 *
 * Shape 1 — numeric time unit (most important):
 *   "4-week delay", "2-month slip", "14-day extension"  (hyphenated)
 *   "2 weeks", "14 days", "3 months", "1 sprint"        (space-separated)
 *
 * Shape 2 — explicit date / milestone change:
 *   "12th → 19th"          (ordinal dates with unicode/ASCII arrow)
 *   "from the 12th to 19th" (ordinal from-to)
 *   "from June to August"   (month-name from-to)
 *   "delayed to Q3", "pushed until March", "moved to next quarter"
 *
 * "from X to Y" is restricted to date-like X (ordinal, month name, quarter)
 * to prevent matching strategic pivots like "shift from enterprise to SMB".
 *
 * This is intentionally conservative: the goal is to reduce false positives
 * (vague pressure language triggering plan_change) without touching true
 * positives (actual schedule changes with measurable deltas).
 *
 * Why candidate-level evaluation matters (post-Stage 4.55):
 *   Dense-paragraph extraction emits one candidate per signal-bearing sentence.
 *   The section-level isPlanChangeDominant flag was previously set whenever
 *   any sentence in the section contained a change operator, causing the
 *   plan_change override to bleed into unrelated sibling candidates.  By
 *   requiring a concrete delta we ensure only the sentence that actually
 *   describes "change + how much" qualifies for plan_change override.
 */

// Month names (abbreviated or full) for use in date-delta patterns
const MONTH_NAMES = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';

// Quarter references
const QUARTER_REFS = '(?:q[1-4]|quarter)';

// Date-like tokens: ordinals, months, quarters, "next <timeframe>"
const DATE_LIKE = `(?:\\d+(?:th|st|nd|rd)|${MONTH_NAMES}|${QUARTER_REFS}|next\\s+\\w+|this\\s+\\w+)`;

const PLAN_CHANGE_CONCRETE_DELTA = new RegExp(
  // Shape 1a: hyphenated numeric time unit (e.g. "4-week", "2-month")
  '\\b\\d+-(?:week|day|month|sprint|quarter)s?\\b'
  // Shape 1b: bare numeric time unit (e.g. "2 weeks", "14 days")
  + '|\\b\\d+\\s+(?:week|day|month|sprint|quarter)s?\\b'
  // Shape 2a: arrow between ordinals or numbers (e.g. "12th → 19th", "3 -> 5")
  + '|\\d+(?:th|st|nd|rd)?\\s*[→>-]+\\s*\\d+(?:th|st|nd|rd)?'
  // Shape 2b: "from <date-like> to <date-like>" (restricted to date tokens;
  //            optional "the" before each ordinal, e.g. "from the 12th to the 19th")
  + `|\\bfrom\\s+(?:the\\s+)?${DATE_LIKE}\\s+to\\s+(?:the\\s+)?${DATE_LIKE}`
  // Shape 2c: "moved/pushed/delayed/postponed to/until <date-like>"
  + `|\\b(?:moved?|pushed?|delayed?|postponed?|rescheduled?)\\s+(?:to|until|from)\\s+${DATE_LIKE}`,
  'i'
);

/**
 * Returns true when a text span qualifies for plan_change override at the
 * candidate (sentence) level.
 *
 * Requires BOTH:
 *   A) At least one explicit change marker (a word from V3_CHANGE_OPERATORS), AND
 *   B) Concrete delta evidence (PLAN_CHANGE_CONCRETE_DELTA).
 *
 * The section-level isPlanChangeDominant flag uses the broader hasChangeOperators
 * check (any V3_CHANGE_OPERATOR without requiring a delta) to preserve existing
 * behaviour for strategic pivot language like "shift from enterprise to SMB".
 *
 * This function is specifically for dense-paragraph candidate annotation so
 * that each sentence-derived candidate can independently report whether it
 * qualifies for plan_change override — preventing sibling sentences in the
 * same parent section from inheriting the override via section-level intent.
 */
export function hasPlanChangeEligibility(text: string): boolean {
  const hasChangeOperator = V3_CHANGE_OPERATORS.some((op) => text.toLowerCase().includes(op));
  if (!hasChangeOperator) return false;
  return PLAN_CHANGE_CONCRETE_DELTA.test(text);
}

/**
 * Returns true when the section text (full body) contains a concrete delta.
 * Used at the section level to gate the ACTIONABILITY bypass and type tie-breaking.
 *
 * This is intentionally identical to hasPlanChangeEligibility applied to the
 * full section text — so that sections with ANY sentence containing a concrete
 * delta qualify, even if other sentences are strategy-only.
 */
export function hasSectionConcreteDelta(sectionText: string): boolean {
  return PLAN_CHANGE_CONCRETE_DELTA.test(sectionText);
}

/**
 * Delay/launch/ETA signal words.  When these appear in a section, the section
 * describes a concrete schedule event (deployment, launch, ETA) rather than a
 * strategic direction — so it should still be classified as project_update even
 * if no numeric delta is present.
 */
const SCHEDULE_EVENT_WORDS = /\b(?:delay(?:ed|ing)?|launch(?:ed|ing)?|deploy(?:ed|ing|ment)?|release(?:d|ing)?|ship(?:ped|ping)?|eta|go-live|go\s+live|target\s+date|due\s+date|deadline|milestone)\b/i;

/**
 * Returns true when the section text contains schedule-event language (delay,
 * launch, deploy, ETA, etc.) without requiring a numeric delta.
 */
function hasSectionScheduleEvent(sectionText: string): boolean {
  return SCHEDULE_EVENT_WORDS.test(sectionText);
}

/**
 * Returns true when the section is "strategy-only" — it has change-operator
 * language that classifies it as plan_change at the intent level, but it
 * contains NO concrete delta (date movement, duration, ETA) and NO schedule-event
 * words.  In that case the section is better represented as an idea.
 *
 * Important: callers are responsible for excluding sections with explicit imperative
 * actions (e.g. "Remove deprecated feature flags") which may accidentally score high
 * on plan_change due to substring matches in V3_CHANGE_OPERATORS.  Use
 * hasExplicitImperativeAction(section) at the call site to guard those cases.
 *
 * Examples that return true (strategy-only → should be idea):
 *   "We should shift from enterprise to SMB customers."
 *   "The team plans to pivot the go-to-market approach."
 *   "We need to refocus engineering on the core platform."
 *
 * Examples that return false (has delta or schedule event → keep project_update):
 *   "Move the launch from 12th to 19th."   ← concrete delta
 *   "Delay by 4 weeks due to vendor issues."   ← concrete delta
 *   "Ham Light deployment is scheduled for next week."   ← schedule-event word
 */
export function isStrategyOnlySection(sectionText: string): boolean {
  if (hasSectionConcreteDelta(sectionText)) return false;
  if (hasSectionScheduleEvent(sectionText)) return false;
  return true;
}

/**
 * Strategy heading pattern for the TYPE ARBITRATION layer.
 *
 * A section whose heading contains one of these words is a strategic-direction
 * section, not a schedule-mutation section.  When the section also has no
 * concrete delta and no timeline tokens (i.e. isStrategyOnlySection returns
 * true) the section should be classified as idea regardless of bullet count.
 *
 * Examples that match:
 *   "### Agatha Gamification Strategy"
 *   "## Engagement Approach"
 *   "## Technical Framework"
 *   "## Content System"
 *   "## Black Box Prioritization System"
 *   "## Data Collection Automation"
 *   "## Playbook for At-Risk Customers"
 *   "## Product Vision"
 *   "## Scoring Rubric for Field Prioritization"
 *   "## Decision Criteria for Customer Triage"
 *   "## Weighting Methodology"
 *   "## Claims Decisioning Heuristics"
 */
const STRATEGY_HEADING_PATTERN = /\b(strategy|strategies|approach|framework|system|philosophy|direction|principles?|prioriti[sz]ation|automation|playbook|vision|scoring|scorecard|rubric|criteria|weighting|model|methodology|decisioning|heuristics)\b/i;

/**
 * Explicit timeline token pattern — used to gate the strategy-heading override.
 *
 * If the heading itself contains a timeline reference (e.g. "Q3 Strategy",
 * "Sprint 4 Approach") the section may still describe a scheduled block of
 * work rather than pure direction, so the override should NOT apply.
 */
const TIMELINE_TOKEN_PATTERN = /\b(q[1-4]|sprint\s*\d+|h[12]\s+\d{4}|week\s*\d+|by\s+(?:end\s+of\s+)?(?:q[1-4]|january|february|march|april|may|june|july|august|september|october|november|december))\b/i;

/**
 * Returns true when:
 *   1. The section heading matches STRATEGY_HEADING_PATTERN, AND
 *   2. The section body has >= 3 bullet items (is a strategy list, not a
 *      single-sentence direction statement), AND
 *   3. The full section text contains no concrete delta or schedule event
 *      (isStrategyOnlySection returns true), AND
 *   4. The heading itself contains no explicit timeline token.
 *
 * Used as part of the TYPE ARBITRATION layer in computeTypeLabel:
 * sections that match are forced to 'idea' even when bullet_count >= 3,
 * overriding the default "bullets = action plan = project_update" assumption.
 *
 * Examples that return true (strategy heading + bullets, no delta):
 *   "### Agatha Gamification Strategy\n- Move away from farm data burden\n- Focus on immediate reward\n..."
 *   "## Engagement Approach\n- Prioritize daily active users\n- Reduce friction\n..."
 *
 * Examples that return false (has delta, schedule event, or no strategy heading):
 *   "## Launch Timeline\n- Q3 rollout\n- ..."   ← has timeline token in heading
 *   "## Scope Changes\n- Defer to Q3 due to 4-week slip\n..."   ← has concrete delta
 *   "## Bug Fixes\n- Fix login redirect\n..."   ← heading not a strategy word
 */
export function isStrategyHeadingSection(
  headingText: string,
  sectionText: string,
  numListItems: number
): boolean {
  // Heading must match a strategy/direction word
  if (!STRATEGY_HEADING_PATTERN.test(headingText)) return false;
  // Must have >= 3 bullets (otherwise it's a single-item note, not a strategy block)
  if (numListItems < 3) return false;
  // Heading must NOT contain a timeline token (e.g. "Q3 Strategy" is still a plan)
  if (TIMELINE_TOKEN_PATTERN.test(headingText)) return false;
  // Full section text must have no concrete delta or schedule event
  if (!isStrategyOnlySection(sectionText)) return false;
  return true;
}

// ============================================
// Spec / Framework Section Classifier
// ============================================
// Token constants (SPEC_FRAMEWORK_TOKENS, SPEC_FRAMEWORK_TOKEN_LIST,
// SPEC_FRAMEWORK_TIMELINE_EXCLUSIONS) are imported from ./sectionSignals.

/**
 * Returns true when a section describes a specification, scoring rubric,
 * eligibility framework, or similar "design document" content — meaning it
 * should NEVER be typed as project_update.
 *
 * Conditions (ALL must hold):
 *   1. The heading contains a SPEC_FRAMEWORK_TOKEN (strongest signal),
 *      OR the body contains >= 2 distinct tokens (to avoid false positives
 *      from incidental mentions like "later prioritization").
 *   2. The combined text does NOT contain any timeline / status token.
 *   3. The combined text does NOT contain a concrete delta (date change, duration).
 *   4. The combined text does NOT contain schedule-event language (delay, launch, etc.).
 *
 * When this returns true, the section should only emit `idea` candidates.
 */
export function isSpecOrFrameworkSection(
  sectionText: string,
  bullets: number,
  heading: string
): boolean {
  const combined = (heading + ' ' + sectionText);

  // Heading token match is the strongest signal
  const headingHasToken = SPEC_FRAMEWORK_TOKENS.test(heading);
  if (!headingHasToken) {
    // Fallback: body must contain >= 2 distinct spec/framework tokens
    const bodyMatches = SPEC_FRAMEWORK_TOKEN_LIST.filter(re => re.test(sectionText));
    if (bodyMatches.length < 2) return false;
  }

  if (SPEC_FRAMEWORK_TIMELINE_EXCLUSIONS.test(combined)) return false;
  if (hasSectionConcreteDelta(combined)) return false;
  if (hasSectionScheduleEvent(combined)) return false;
  return true;
}

/**
 * Mechanism verbs that indicate a real initiative or feature proposal.
 * These are concrete construction/implementation verbs, not vague directional verbs.
 */
const INITIATIVE_MECHANISM_VERBS = /\b(build|implement|add|introduce|create|design|automate|integrate|ship|launch|deploy|roll\s+out|parse|score|prioritize|calculate)\b/i;

/**
 * System/feature nouns that anchor a strategy discussion to a concrete artifact.
 */
const INITIATIVE_SYSTEM_NOUNS = /\b(system|workflow|scoring|prioritization|automation|integration|parser|dashboard|overlay|trigger|contract\s+signing)\b/i;

/**
 * Concrete example patterns: currency symbols, percentages, time units, area units,
 * or a numeric value followed by a unit token.
 */
const INITIATIVE_CONCRETE_EXAMPLES = /(?:€|%|minutes?|hectares?|fields?)|\b\d+\s*(?:€|%|min|minutes?|hectares?|fields?)\b/i;

/**
 * Returns true when the text contains at least one "initiative quality" signal —
 * a mechanism verb, a system/feature noun, or a concrete example (units/numbers).
 *
 * This guards the strategy-only plan_change early-return path so that generic
 * fluff ("We discussed strategy and alignment for Q2") does not inflate idea
 * counts, while real initiative proposals ("Netflix-style; show earning potential
 * per field (€300, 2 minutes)") still get emitted as ideas.
 *
 * Only applied to the strategy-only early-return path — no other classification
 * paths are affected.
 */
export function hasInitiativeQualitySignal(text: string): boolean {
  if (INITIATIVE_MECHANISM_VERBS.test(text)) return true;
  if (INITIATIVE_SYSTEM_NOUNS.test(text)) return true;
  if (INITIATIVE_CONCRETE_EXAMPLES.test(text)) return true;
  return false;
}

/**
 * Operational heading keywords that disqualify a section from the structural idea bypass.
 * Sections with these words in their heading are plan/execution sections, not conceptual ideas.
 */
const STRUCTURAL_BYPASS_OPERATIONAL_KEYWORDS = /\b(deployment|deploy|release|rollout|roll\s+out|timeline|schedule|notes|discussion)\b/i;

/**
 * Generic single-word headings that carry no meaningful concept signal.
 * A heading that is exactly one of these words (case-insensitive) is excluded
 * from the structural idea bypass.
 */
const STRUCTURAL_BYPASS_GENERIC_HEADINGS = new Set([
  'general',
  'notes',
  'discussion',
  'other',
  'summary',
  'updates',
  'misc',
]);

/**
 * Returns true when a section qualifies for the structural idea bypass (Stage 4.59):
 * a conceptual section that has enough structure to emit an idea even when its
 * actionability signal is 0.
 *
 * All conditions must hold:
 *   1. heading_level <= 3 (not a deeply nested sub-section)
 *   2. num_list_items >= 3 (enough bullets to signal a structured concept)
 *   3. hasDeltaSignal is false (no concrete delta → this is conceptual, not a change)
 *   4. heading does not contain operational keywords (deployment, release, rollout, etc.)
 *   5. heading is not a generic low-signal word (General, Notes, Discussion, Other,
 *      Summary, Updates, Misc)
 *   6. raw_text.length >= 150 (enough content to justify an idea)
 */
export function qualifiesForStructuralIdeaBypass(
  section: { heading_level?: number; structural_features?: { num_list_items?: number }; heading_text?: string; raw_text?: string },
  hasDeltaSignal: boolean
): boolean {
  if ((section.heading_level ?? 0) > 3) return false;
  if ((section.structural_features?.num_list_items ?? 0) < 3) return false;
  if (hasDeltaSignal) return false;
  if (STRUCTURAL_BYPASS_OPERATIONAL_KEYWORDS.test(section.heading_text ?? '')) return false;
  if (STRUCTURAL_BYPASS_GENERIC_HEADINGS.has((section.heading_text ?? '').trim().toLowerCase())) return false;
  if ((section.raw_text ?? '').length < 150) return false;
  return true;
}

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
 *
 * IMPORTANT: Only includes true scheduling markers (weekdays, explicit date phrases).
 * Timeline references (q1-q4, quarter, month names) are NOT included here because
 * they typically indicate project timelines, not calendar scheduling tasks.
 *
 * Example timeline (NOT calendar): "Push to Q3", "Reassess next quarter"
 * Example calendar (IS out-of-scope): "Schedule meeting next Thursday"
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
 * Implicit idea need/lack signals
 */
const IMPLICIT_IDEA_NEED_SIGNALS = [
  'we need',
  "we don't have",
  "users can't",
  "it's hard to",
  'missing',
  'no way to',
  "can't",
  'lack of',
  'lacking',
];

/**
 * Implicit idea outcome/purpose signals
 */
const IMPLICIT_IDEA_PURPOSE_SIGNALS = [
  'so we can',
  'so we',
  'so that',
  'to help',
  'to see',
  'because',
  'in order to',
  'so users can',
];

/**
 * Implicit idea capability/system nouns
 */
const IMPLICIT_IDEA_CAPABILITY_NOUNS = [
  'boundary detection',
  'dashboard',
  'errors',
  'visibility',
  'alerts',
  'tracking',
  'monitoring',
  'reporting',
  'analytics',
  'notifications',
  'logging',
  'metrics',
  'search',
  'filtering',
  'sorting',
  'pagination',
];

/**
 * V3 Role assignment patterns for "ROLE to VERB" micro-tasks
 * Detects task assignments like "PM to document", "CS to manage", "Eng to implement"
 */
const V3_ROLE_ASSIGNMENT_PATTERNS = [
  'pm to',
  'cs to',
  'eng to',
  'design to',
  'designer to',
  'project manager to',
  'product manager to',
  'engineering to',
  'customer success to',
];

/**
 * V3 Decision markers for project update detection
 * Detects decision language like "will be logged", "no near-term", "revisit in Q2"
 */
const V3_DECISION_MARKERS = [
  'will be logged',
  'will be',
  'no near-term',
  'near-term',
  'revisit',
  'decided',
  'agreed',
  'approved',
];

/**
 * V3 PM request language patterns for actionability detection.
 * These phrases are common in PM notes describing user pain, feature requests,
 * or team obligations — all of which should produce actionable suggestions.
 *
 * Scored at +0.76 (same tier as implicit feature request) to clear
 * T_action (0.5) + short_section_penalty (0.15) + borderline margin (0.1).
 *
 * NOTE: "request to" is handled separately in matchPMRequestLanguage() with
 * a guard requiring a nearby action verb, to avoid false positives from
 * reported-speech contexts like "in response to a request to review...".
 */
const V3_PM_REQUEST_PATTERNS = [
  'users need',
  'users struggle',
  'requires us to',
  'we should consider',
  'maybe we could',
  'suggestion:',
  'this will require',
  'friction around',
];

/**
 * Normalize smart quotes to ASCII equivalents
 * Ensures "don't" and "don't" behave identically in negation/imperative detection
 */
function normalizeSmartQuotes(text: string): string {
  return text
    .replace(/[\u2018\u2019]/g, "'") // ' and ' → '
    .replace(/[\u201C\u201D]/g, '"'); // " and " → "
}

/**
 * Preprocess a line for v3 matching (lowercase, trim, collapse whitespace, normalize quotes)
 *
 * CRITICAL: Strips list markers (bullets, numbered) BEFORE other processing to ensure
 * imperative verbs at list start are detected correctly.
 */
function preprocessLine(lineText: string): string {
  let processed = normalizeSmartQuotes(lineText)
    .toLowerCase()
    .trim();

  // Strip list markers at start of line:
  // - Bullets: ^\s*[-*+•]\s+
  // - Numbered: ^\s*\d+[.)]\s+
  // This allows "• Add feature" to match imperative-at-start detection
  processed = processed
    .replace(/^\s*[-*+•]\s+/, '')      // bullet markers
    .replace(/^\s*\d+[.)]\s+/, '');    // numbered list markers

  // Collapse whitespace
  return processed.replace(/\s+/g, ' ');
}

/**
 * Split text into sentence fragments using deterministic boundaries
 * Handles periods, exclamation marks, question marks, and ellipsis
 * Returns trimmed non-empty fragments
 */
function splitIntoSentences(text: string): string[] {
  // Split on sentence boundaries: . ! ? (optionally followed by space/end)
  // Also handle ellipsis (...) as a sentence boundary
  const fragments = text.split(/[.!?]\s+|\.\.\.+\s*/);

  // Trim and filter empty fragments
  return fragments
    .map(s => s.trim())
    .filter(s => s.length > 0);
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
 * V3 Rule 9: Role assignment pattern = +0.85
 *
 * Maps to actionableSignal. Detects micro-task assignments like:
 * "PM to document the feature request"
 * "CS to manage the customer escalation"
 * "Eng to implement the fix"
 */
function matchRoleAssignment(line: string): number {
  return V3_ROLE_ASSIGNMENT_PATTERNS.some(pattern => line.includes(pattern)) ? 0.85 : 0.0;
}

/**
 * V3 Rule 10: Decision marker = +0.70
 *
 * Maps to actionableSignal. Detects decision language like:
 * "Feature request will be logged"
 * "No near-term resourcing available"
 * "Revisit during next planning cycle"
 *
 * Score of 0.70 ensures passing T_action (0.5) even with short-section penalty (0.15)
 */
function matchDecisionMarker(line: string): number {
  return V3_DECISION_MARKERS.some(marker => line.includes(marker)) ? 0.70 : 0.0;
}

/**
 * V3 Rule 12: PM request language = +0.76
 *
 * Maps to actionableSignal. Detects common PM phrasing that expresses
 * user pain, feature requests, or team obligations:
 * "Users need better error visibility"
 * "Request to add dark mode support"
 * "The PM requests a better onboarding flow"
 * "There is friction around the checkout process"
 *
 * Score of 0.76 ensures passing T_action (0.5) + short_section_penalty (0.15)
 * with margin >= 0.1 for borderline check.
 *
 * Guarded patterns ("request to", "requests a/an/for/that"):
 * - "request to" requires a nearby action verb to avoid reported-speech false positives
 * - "requests a/an/for/that" requires action verb OR product noun to ensure genuine feature requests
 */
function matchPMRequestLanguage(line: string): number {
  // Check unconditional patterns first
  if (V3_PM_REQUEST_PATTERNS.some(pattern => line.includes(pattern))) {
    return 0.76;
  }

  // Guarded: "request to" requires a nearby action verb after it
  if (line.includes('request to')) {
    const afterRequest = line.slice(line.indexOf('request to') + 'request to'.length);
    if (V3_ACTION_VERBS.some(verb => new RegExp(`\\b${verb}\\b`, 'i').test(afterRequest))) {
      return 0.76;
    }
  }

  // Guarded: "requests a/an/for/that" requires action verb OR product noun after it
  // Matches: "PM requests a dark mode feature", "team requests an API endpoint"
  // Avoids: reported-speech contexts without clear product objects
  const requestsPatterns = ['requests a ', 'requests an ', 'requests for ', 'requests that '];
  for (const pattern of requestsPatterns) {
    if (line.includes(pattern)) {
      const afterRequest = line.slice(line.indexOf(pattern) + pattern.length);
      const hasVerb = V3_ACTION_VERBS.some(verb => new RegExp(`\\b${verb}\\b`, 'i').test(afterRequest));
      const hasNoun = V3_PRODUCT_NOUNS.some(noun => new RegExp(`\\b${noun}\\b`, 'i').test(afterRequest));
      if (hasVerb || hasNoun) {
        return 0.76;
      }
    }
  }

  return 0.0;
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
 * Detect implicit idea statement = +0.61
 *
 * An implicit idea is a problem/need statement that contains:
 * 1. A need/lack signal (e.g., "we need", "we don't have", "missing")
 * 2. A concrete capability noun (e.g., "boundary detection", "dashboard")
 * 3. A purpose/outcome clause (e.g., "so we can", "to help")
 * 4. NO explicit scheduling or completion markers
 *
 * Returns +0.61 if all conditions are met, 0.0 otherwise.
 * Note: 0.6 chosen to ensure implicit ideas pass borderline check (threshold = 0.5, margin requirement >= 0.1).
 */
function matchImplicitIdea(line: string): number {
  const hasNeedSignal = IMPLICIT_IDEA_NEED_SIGNALS.some(signal => line.includes(signal));
  const hasPurposeSignal = IMPLICIT_IDEA_PURPOSE_SIGNALS.some(signal => line.includes(signal));

  // Check for capability nouns - use word boundary matching for common words
  const hasCapabilityNoun = IMPLICIT_IDEA_CAPABILITY_NOUNS.some(noun => {
    if (noun.includes(' ')) {
      // Multi-word phrases use includes
      return line.includes(noun);
    }
    // Single words use word boundary for precision
    const regex = new RegExp(`\\b${noun}\\b`, 'i');
    return regex.test(line);
  });

  const hasSchedulingMarker = V3_CALENDAR_MARKERS.some(marker => markerMatchesWord(line, marker));
  const hasCompletionMarker = ['done', 'completed', 'finished', 'shipped'].some(marker => line.includes(marker));

  if (hasNeedSignal && hasPurposeSignal && hasCapabilityNoun && !hasSchedulingMarker && !hasCompletionMarker) {
    return 0.61;
  }

  return 0.0;
}

/**
 * Pain/friction signals for implicit feature request detection
 * High-precision signals focused on explicit complaints and dissatisfaction
 */
const IMPLICIT_FEATURE_REQUEST_PAIN_SIGNALS = [
  'dissatisfied',
  'too many clicks',
  'number of clicks',
  'confusing',
  'frustrating',
  'usability issue',
  'hard to use',
  'difficult to',
  'painful',
  'annoying',
  'slow',
  'inefficient',
  'broken',
  'impacting',
];

/**
 * Product scope/impact context signals for implicit feature request detection
 * Focus on workflow, process, and stakeholder impact rather than generic user mentions
 */
const IMPLICIT_FEATURE_REQUEST_CONTEXT_SIGNALS = [
  'workflow',
  'attestation',
  'completion',
  'usability',
  'customer satisfaction',
  'user experience',
  'productivity',
  'efficiency',
  'employees',
];

/**
 * Detect implicit feature request = +0.76
 *
 * An implicit feature request is a problem statement that contains:
 * 1. A pain/friction signal (e.g., "dissatisfied", "too many clicks", "confusing")
 * 2. A product scope/impact context (e.g., "workflow", "usability", "customer satisfaction")
 *
 * This rule is high-precision and designed for "Customer Feedback" style sections
 * that describe clear product problems with impact, even without explicit imperatives.
 *
 * Returns +0.76 if both conditions are met, 0.0 otherwise.
 * Note: 0.76 chosen to ensure these suggestions pass scoring thresholds with
 * confidence, even for short sections (above T_action + short_section_penalty = 0.65,
 * with margin >= 0.1 for borderline check, accounting for floating-point precision).
 */
function matchImplicitFeatureRequest(text: string): number {
  const hasPainSignal = IMPLICIT_FEATURE_REQUEST_PAIN_SIGNALS.some(signal => text.includes(signal));
  const hasContextSignal = IMPLICIT_FEATURE_REQUEST_CONTEXT_SIGNALS.some(signal => text.includes(signal));

  if (hasPainSignal && hasContextSignal) {
    return 0.76;
  }

  return 0.0;
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
  // 7. Implicit idea statement (need + capability + purpose): +0.61
  // 9. Role assignment pattern (ROLE to VERB): +0.85
  // 10. Decision marker (will be logged, no near-term): +0.70
  // 12. PM request language (users need, request to, friction around): +0.76
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
  // Track max score from change operators specifically, as only these
  // should trigger out-of-scope override (not regular imperative verbs)
  let maxChangeOperatorScore = 0;

  // Track which types of signals fired for intent distribution
  let hasChangeOperators = false;
  let hasStructuredTasks = false;
  let hasCalendarMarkers = false;
  let hasCommunicationMarkers = false;
  let hasMicroAdminMarkers = false;
  // Track forced routing overrides
  let hasRoleAssignment = false;
  let hasDecisionMarker = false;

  // Process each line
  for (const line of lines) {
    // Skip empty or very short lines (headings, fragments)
    if (line.length < 5) continue;

    // Split line into sentences for sentence-level evaluation
    // This ensures imperatives like "Add inline alert." are detected even when
    // not at line start (e.g., "Users don't notice failures. Add inline alert.")
    const sentences = splitIntoSentences(line);

    // Score each sentence fragment and take max score
    let maxLineScore = 0;
    let maxNonHedgedLineSentenceScore = 0;

    for (const sentence of sentences) {
      if (sentence.length < 5) continue;

      // Compute positive signals (all contribute to actionableSignal)
      let sentenceScore = 0;

      // Rule 1: Strong request pattern
      sentenceScore = Math.max(sentenceScore, matchStrongRequestPattern(sentence));

      // Rule 2: Imperative verb at start
      sentenceScore = Math.max(sentenceScore, matchImperativeVerb(sentence));

      // Rule 3: Change operator
      const changeOpScore = matchChangeOperator(sentence);
      if (changeOpScore > 0) {
        hasChangeOperators = true;
        maxChangeOperatorScore = Math.max(maxChangeOperatorScore, changeOpScore);
      }
      sentenceScore = Math.max(sentenceScore, changeOpScore);

      // Rule 4: Status/progress markers (includes decisions like "done", "blocked")
      sentenceScore = Math.max(sentenceScore, matchStatusMarkers(sentence));

      // Rule 5: Structured task syntax
      const structuredTaskScore = matchStructuredTask(sentence);
      if (structuredTaskScore > 0) hasStructuredTasks = true;
      sentenceScore = Math.max(sentenceScore, structuredTaskScore);

      // Rule 9: Role assignment pattern (ROLE to VERB)
      const roleAssignmentScore = matchRoleAssignment(sentence);
      if (roleAssignmentScore > 0) hasRoleAssignment = true;
      sentenceScore = Math.max(sentenceScore, roleAssignmentScore);

      // Rule 10: Decision marker
      const decisionMarkerScore = matchDecisionMarker(sentence);
      if (decisionMarkerScore > 0) hasDecisionMarker = true;
      sentenceScore = Math.max(sentenceScore, decisionMarkerScore);

      // Rule 12: PM request language
      sentenceScore = Math.max(sentenceScore, matchPMRequestLanguage(sentence));

      // Snapshot non-hedged score before applying hedged directive rule
      const nonHedgedSentenceScore = sentenceScore;

      // Rule 6b: Hedged directive (self-sufficient, no action verb required)
      sentenceScore = Math.max(sentenceScore, matchHedgedDirective(sentence));

      // Rule 6: Target object bonus (only if already actionable)
      sentenceScore += matchTargetObjectBonus(sentence, sentenceScore);

      // Negative rule: Negation override
      if (hasNegationOverride(sentence)) {
        sentenceScore = 0.0;
      }

      // Clamp sentence score to [0,1]
      sentenceScore = Math.min(1.0, Math.max(0.0, sentenceScore));

      // Track max score across sentences in this line
      maxLineScore = Math.max(maxLineScore, sentenceScore);
      maxNonHedgedLineSentenceScore = Math.max(maxNonHedgedLineSentenceScore, nonHedgedSentenceScore);
    }

    // Update global max scores with this line's max sentence score
    maxActionableScore = Math.max(maxActionableScore, maxLineScore);
    maxNonHedgedActionableScore = Math.max(maxNonHedgedActionableScore, maxNonHedgedLineSentenceScore);

    // Compute out-of-scope signal (still at line level, not sentence level)
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
  // Track if we have multiple action verbs (>= 2) for V3 override logic
  const hasMultipleActionVerbs = actionVerbMatches >= 2;
  if (hasMultipleActionVerbs && maxOutOfScopeScore < 0.4) {
    maxActionableScore = Math.max(maxActionableScore, 0.8);
    maxNonHedgedActionableScore = Math.max(maxNonHedgedActionableScore, 0.8);
  }

  // Rule 8: Implicit idea statement (section-level check)
  // Check the full section text for implicit idea patterns
  const implicitIdeaSignal = matchImplicitIdea(lowerText);
  if (implicitIdeaSignal > 0) {
    maxActionableScore = Math.max(maxActionableScore, implicitIdeaSignal);
    // Note: implicit ideas are not added to maxNonHedgedActionableScore
    // because they're a lower-confidence signal
  }

  // Rule 11: Implicit feature request (section-level check)
  // High-precision rule for problem statements with pain + product context
  // Check full section text including heading for maximum recall
  const fullSectionText = ((section.heading_text || '') + ' ' + section.raw_text).toLowerCase();
  const implicitFeatureRequestSignal = matchImplicitFeatureRequest(fullSectionText);
  if (implicitFeatureRequestSignal > 0) {
    maxActionableScore = Math.max(maxActionableScore, implicitFeatureRequestSignal);
    // Note: implicit feature requests are not added to maxNonHedgedActionableScore
    // because they're a different pattern than explicit imperatives
  }

  // V3 OVERRIDE: If we have strong signals of substantial product work, clamp outOfScopeSignal <= 0.3
  // This prevents high-actionability sections with incidental calendar/communication references
  // from being filtered as out-of-scope.
  //
  // CRITICAL: This override applies to:
  // 1. Change operators with score >= 0.8 (plan mutations like "Move", "Defer", "Shift")
  //    Example: "Move launch to next week" → actionable (plan change with calendar reference)
  // 2. Multiple action verbs (>= 2, indicating substantial product work)
  //    Example: "Launch Partner Portal... Build backend, Create flow... Goal: Q4" → actionable
  // 3. High non-hedged score (>= 0.8) from substantial sections (>= 5 lines)
  //    Example: "Build a self-service customer portal... Scope: [bullets]... Target: Q2" → actionable
  //
  // This override does NOT apply to:
  // - Single imperative verbs in short sections (< 5 lines)
  //   Example: "Update doc link" → respects out-of-scope (micro-admin)
  //   Example: "Send email to team" → respects out-of-scope (communication)
  //
  // The distinction ensures that substantial product work with incidental date/communication
  // references passes through, while simple admin/communication imperatives are correctly filtered.
  const isSubstantialSection = section.structural_features.num_lines >= 5;
  if (maxChangeOperatorScore >= 0.8 || hasMultipleActionVerbs ||
      (maxNonHedgedActionableScore >= 0.8 && isSubstantialSection)) {
    maxOutOfScopeScore = Math.min(0.3, maxOutOfScopeScore);
  }

  // Map actionableSignal to plan_change/new_workstream distribution
  // Heuristic: if section has change operators, structured tasks, decision markers,
  // or role assignments → plan_change dominant (planning/update family)
  // Otherwise → new_workstream dominant
  const isPlanChangeDominant = hasChangeOperators || hasStructuredTasks || hasDecisionMarker || hasRoleAssignment;

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

  const result: IntentClassification = {
    plan_change,
    new_workstream,
    status_informational,
    communication,
    research,
    calendar,
    micro_tasks,
  };

  // Store flags separately to avoid contaminating scoresByLabel in debug JSON
  if (hasRoleAssignment || hasDecisionMarker) {
    result.flags = {};
    if (hasRoleAssignment) result.flags.forceRoleAssignment = true;
    if (hasDecisionMarker) result.flags.forceDecisionMarker = true;
  }

  return result;
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
 * Check if section contains an explicit imperative action
 * Returns true if any sentence starts with a known imperative verb
 */
function hasExplicitImperativeAction(section: Section): boolean {
  // Guard: ensure body_lines exists
  if (!section.body_lines || section.body_lines.length === 0) {
    return false;
  }

  const lines = section.body_lines.map(l => preprocessLine(l.text));

  for (const line of lines) {
    // Skip very short lines
    if (line.length < 5) continue;

    // Split line into sentences using shared sentence splitting logic
    const sentences = splitIntoSentences(line);

    for (const sentence of sentences) {
      if (sentence.length < 5) continue;

      // Check if sentence starts with an imperative verb
      for (const verb of V3_ACTION_VERBS) {
        const regex = new RegExp(`^${verb}\\b`, 'i');
        if (regex.test(sentence)) {
          return true;
        }
      }
    }
  }

  return false;
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
 * IMPERATIVE FLOOR: sections containing explicit imperative verbs at sentence start
 * are ALWAYS considered actionable, regardless of other signals.
 *
 * Note: Uses >= for actionability threshold so equality passes.
 */
export function isActionable(
  intent: IntentClassification,
  section: Section,
  thresholds: ThresholdConfig
): { actionable: boolean; reason: string; actionableSignal: number; outOfScopeSignal: number; rescuedByBSignal: boolean } {
  const { actionableSignal, outOfScopeSignal } = computeActionabilitySignals(intent);

  // Short sections require higher thresholds (penalty for very short sections)
  const shortSectionPenalty = section.structural_features.num_lines <= 2 ? 0.15 : 0;
  const effectiveThreshold = thresholds.T_action + shortSectionPenalty;

  // PLAN_CHANGE PROTECTION: Use canonical helper to detect plan_change intent
  const isPlanChange = isPlanChangeIntentLabel(intent);

  if (isPlanChange) {
    // PLAN_CHANGE OVERRIDE: bypass ACTIONABILITY gate only when the section
    // contains a concrete delta (date movement, duration, ETA) or a schedule
    // event word.  Strategy-only language ("shift from enterprise to SMB",
    // "pivot the go-to-market approach") does NOT qualify for the bypass.
    // Without a concrete delta, the section still participates in normal
    // actionability evaluation so vague pivots don't force-emit project_update.
    const sectionText = ((section.heading_text || '') + ' ' + section.raw_text);
    const hasConcreteDelta = !isStrategyOnlySection(sectionText);
    if (hasConcreteDelta) {
      return {
        actionable: true,
        reason: `plan_change override: bypass ACTIONABILITY gate (signal=${actionableSignal.toFixed(3)}, outOfScope=${outOfScopeSignal.toFixed(3)}, T_action=${effectiveThreshold.toFixed(3)})`,
        actionableSignal,
        outOfScopeSignal,
        rescuedByBSignal: false,
      };
    }
    // Strategy-only plan_change: fall through to normal actionability evaluation.
    // The section may still pass on its own merits (e.g. high actionableSignal).
  }

  // Existing non-plan_change gates remain as-is

  // Dominance-based out-of-scope gate:
  // Compute oosTop = max(calendar, communication)
  // Compute inTop = max(plan_change, micro_tasks, new_workstream, status_informational, research)
  // Only drop if: oosTop >= 0.75 AND (oosTop - inTop) >= 0.20
  const oosTop = Math.max(intent.calendar, intent.communication);
  const inTop = Math.max(
    intent.plan_change,
    intent.micro_tasks,
    intent.new_workstream,
    intent.status_informational,
    intent.research
  );
  const dominanceGap = oosTop - inTop;

  if (oosTop >= 0.75 && dominanceGap >= 0.20) {
    return {
      actionable: false,
      reason: `Out-of-scope dominance: oosTop=${oosTop.toFixed(3)} >= 0.75, gap=${dominanceGap.toFixed(3)} >= 0.20 (cal=${intent.calendar.toFixed(2)}, comm=${intent.communication.toFixed(2)} vs inTop=${inTop.toFixed(3)})`,
      actionableSignal,
      outOfScopeSignal,
      rescuedByBSignal: false,
    };
  }

  // IMPERATIVE FLOOR: Check for explicit imperative action after out-of-scope check
  // This ensures imperatives bypass borderline/shortness logic but still respect out-of-scope signals
  const hasImperative = hasExplicitImperativeAction(section);
  if (hasImperative) {
    return {
      actionable: true,
      reason: `imperative floor: section contains explicit imperative action (signal=${actionableSignal.toFixed(3)}, outOfScope=${outOfScopeSignal.toFixed(3)})`,
      actionableSignal,
      outOfScopeSignal,
      rescuedByBSignal: false,
    };
  }

  // Check actionability: actionableSignal >= T_action (with penalty for short sections)
  // Using >= means that a section with actionableSignal == T_action passes
  if (actionableSignal < effectiveThreshold) {
    // B-signal rescue: before dropping, check if any B-signal extractor fires with confidence >= 0.65
    const sentences = (section.body_lines ?? []).map(l => l.text);
    const bSignals = extractSignalsFromSentences(sentences);
    const hasRescueSignal = bSignals.some(s => s.confidence >= 0.65);
    if (hasRescueSignal) {
      const rescuedSignal = Math.max(actionableSignal, 0.7);
      return {
        actionable: true,
        // rescuedByBSignal flag: downstream type-gate uses this boolean instead of parsing the reason string
        rescuedByBSignal: true,
        reason: `B-signal rescue: actionableSignal boosted from ${actionableSignal.toFixed(3)} to ${rescuedSignal.toFixed(3)} (bSignalCount=${bSignals.length})`,
        actionableSignal: rescuedSignal,
        outOfScopeSignal,
      };
    }
    return {
      actionable: false,
      reason: `Action signal too low: ${actionableSignal.toFixed(3)} < ${effectiveThreshold.toFixed(3)} (T_action=${thresholds.T_action}, penalty=${shortSectionPenalty.toFixed(2)})`,
      actionableSignal,
      outOfScopeSignal,
      rescuedByBSignal: false,
    };
  }

  // Additional check: very short sections with borderline signals need extra scrutiny
  // Only apply if the section barely crosses the threshold
  const marginAboveThreshold = actionableSignal - effectiveThreshold;
  if (marginAboveThreshold < 0.1 && section.structural_features.num_lines <= 3) {
    // B-signal rescue: before dropping, check if any B-signal extractor fires with confidence >= 0.65
    const sentences = (section.body_lines ?? []).map(l => l.text);
    const bSignals = extractSignalsFromSentences(sentences);
    const hasRescueSignal = bSignals.some(s => s.confidence >= 0.65);
    if (hasRescueSignal) {
      const rescuedSignal = Math.max(actionableSignal, 0.7);
      return {
        actionable: true,
        // rescuedByBSignal flag: downstream type-gate uses this boolean instead of parsing the reason string
        rescuedByBSignal: true,
        reason: `B-signal rescue: actionableSignal boosted from ${actionableSignal.toFixed(3)} to ${rescuedSignal.toFixed(3)} (bSignalCount=${bSignals.length})`,
        actionableSignal: rescuedSignal,
        outOfScopeSignal,
      };
    }
    return {
      actionable: false,
      reason: `Insufficient content for borderline signal: margin=${marginAboveThreshold.toFixed(3)}, lines=${section.structural_features.num_lines}`,
      actionableSignal,
      outOfScopeSignal,
      rescuedByBSignal: false,
    };
  }

  return {
    actionable: true,
    reason: `Actionable: signal=${actionableSignal.toFixed(3)} >= ${effectiveThreshold.toFixed(3)}, outOfScope=${outOfScopeSignal.toFixed(3)} < ${thresholds.T_out_of_scope}`,
    actionableSignal,
    outOfScopeSignal,
    rescuedByBSignal: false,
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
 * OVERRIDE: Decision markers and role assignments force project_update type.
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

  // OVERRIDE: Decision markers and role assignments force project_update
  if (intent.flags?.forceDecisionMarker || intent.flags?.forceRoleAssignment) {
    p_mutation = Math.max(p_mutation, 0.8);
  }

  // Cap at 1
  p_mutation = Math.min(1, p_mutation);
  p_artifact = Math.min(1, p_artifact);

  // Determine type based on higher probability
  if (p_mutation < 0.2 && p_artifact < 0.2 && !intent.flags?.forceDecisionMarker) {
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
 * OVERRIDE: Decision markers and role assignments force project_update type.
 *
 * CENTRALIZATION NOTE: This is the single canonical type-label derivation function.
 * All callers (section typing in classifySection, sentence typing in synthesis.ts)
 * MUST call this function. Do not inline or duplicate this logic elsewhere.
 */
export function computeTypeLabel(
  section: Section,
  intent: IntentClassification
): 'idea' | 'project_update' {
  // Force project_update for decision markers
  if (intent.flags?.forceDecisionMarker) {
    return 'project_update';
  }
  // Force project_update for role assignments (to avoid "New idea:" titles)
  if (intent.flags?.forceRoleAssignment) {
    return 'project_update';
  }
  if (isPlanChangeIntentLabel(intent)) {
    const headingText = section.heading_text || '';
    const sectionText = (headingText + ' ' + section.raw_text);
    const numListItems = section.structural_features?.num_list_items ?? 0;

    // SPEC/FRAMEWORK OVERRIDE: sections describing scoring rubrics, eligibility
    // criteria, weighting frameworks, etc. are design documents — never project_update.
    if (isSpecOrFrameworkSection(sectionText, numListItems, headingText)) {
      return 'idea';
    }

    // Strategy-only language ("shift from enterprise to SMB", "pivot the go-to-market
    // approach") has change operators but no concrete delta or schedule event.
    // These sections describe strategic direction, not a schedule mutation, so they
    // are better represented as ideas.
    //
    // A section keeps project_update when it has:
    //   - A concrete delta (date movement, duration): "delay by 4 weeks"
    //   - A schedule event word (launch, deploy, ETA): "Ham Light deployment"
    //   - A structured task / heading + bullet cluster (role assignments, decision markers
    //     are already handled above via forceDecisionMarker / forceRoleAssignment)
    if (isStrategyOnlySection(sectionText)) {
      // TYPE ARBITRATION: Strategy heading + bullet list + no delta → force idea.
      // Sections like "### Agatha Gamification Strategy" with 3+ bullet points are
      // strategic direction blocks, not schedule mutations, even though they have bullets.
      if (isStrategyHeadingSection(headingText, sectionText, numListItems)) {
        return 'idea';
      }
      // Also treat zero-bullet strategy sections as ideas (single-sentence pivots).
      if (numListItems === 0) {
        return 'idea';
      }
    }
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
  // Exception: strategy-only sections (no concrete delta or schedule event) do NOT
  // get forced project_update here — they should resolve via normal type classification.
  const _sectionTextForTypeGuard = ((section.heading_text || '') + ' ' + section.raw_text);
  const _isStrategyOnly = isStrategyOnlySection(_sectionTextForTypeGuard);
  if (!actionabilityResult.actionable && isPlanChange && !_isStrategyOnly) {
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

  // Strategy-only plan_change sections: not actionable by normal signal, but still
  // emit as idea so that strategy pivots are captured rather than silently dropped.
  // INITIATIVE QUALITY GUARD: only emit when the text contains at least one concrete
  // signal (mechanism verb, system/feature noun, or concrete example with units/numbers).
  // Generic fluff ("We discussed strategy and alignment for Q2") is blocked here.
  if (!actionabilityResult.actionable && isPlanChange && _isStrategyOnly) {
    const _hasInitiativeQuality = hasInitiativeQualitySignal(_sectionTextForTypeGuard);
    if (_hasInitiativeQuality) {
      const typeLabel = computeTypeLabel(section, intent);
      return {
        ...section,
        intent,
        is_actionable: true,
        actionability_reason: `${actionabilityResult.reason} (strategy-only plan_change: emit as idea)`,
        actionable_signal: actionabilityResult.actionableSignal,
        out_of_scope_signal: actionabilityResult.outOfScopeSignal,
        suggested_type: 'idea',
        type_confidence: 0.5,
        typeLabel,
      };
    }
    // No initiative quality signal: fall through to normal non-actionable handling
    // (the section will not be emitted as idea via this path).
  }

  // Classify type if actionable
  let suggestedType: SectionType | undefined;
  let typeConfidence: number | undefined;

  if (actionabilityResult.actionable) {
    const typeResult = classifyType(section, intent);

    if (typeResult.type === 'non_actionable') {
      if (isPlanChange && !_isStrategyOnly) {
        // Strengthened PLAN_CHANGE PROTECTION at TYPE stage
        // Force project_update type and ensure actionability stays true
        // Exception: strategy-only plan_change sections fall through to idea/new_workstream path.
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
        // NEW_WORKSTREAM PROTECTION: If section passed actionability gate with new_workstream intent,
        // force it to 'idea' type rather than dropping it. This ensures implicit ideas and other
        // new_workstream sections are not lost due to weak pattern matching in classifyType.
        const isNewWorkstream = intent.new_workstream > intent.plan_change;
        if (isNewWorkstream && intent.new_workstream >= 0.5) {
          suggestedType = 'idea';
          typeConfidence = 0.7;
          // Return early with forced idea to prevent drop
          return {
            ...section,
            intent,
            is_actionable: true,
            actionability_reason:
              `${actionabilityResult.reason} (type non_actionable overridden for new_workstream)`,
            actionable_signal: actionabilityResult.actionableSignal,
            out_of_scope_signal: actionabilityResult.outOfScopeSignal,
            suggested_type: suggestedType,
            type_confidence: typeConfidence,
            typeLabel: 'idea',
          };
        }

        // B-SIGNAL RESCUE PROTECTION: If actionability was rescued by a B-signal,
        // protect the section at the TYPE gate by forcing 'idea' type.
        if (actionabilityResult.rescuedByBSignal) {
          return {
            ...section,
            intent,
            is_actionable: true,
            actionability_reason:
              `${actionabilityResult.reason} (type non_actionable overridden for b-signal rescue)`,
            actionable_signal: actionabilityResult.actionableSignal,
            out_of_scope_signal: actionabilityResult.outOfScopeSignal,
            suggested_type: 'idea',
            type_confidence: 0.5,
            typeLabel: 'idea',
          };
        }

        // Non-plan_change, non-new_workstream can still be dropped by TYPE
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

      // For plan_change sections, force to project_update —
      // unless the section is strategy-only (no concrete delta or schedule event).
      if (isPlanChange && !_isStrategyOnly && suggestedType !== 'project_update') {
        suggestedType = 'project_update';
      }

      // OVERRIDE: Force project_update for decision markers and role assignments
      if ((intent.flags?.forceDecisionMarker || intent.flags?.forceRoleAssignment) && suggestedType !== 'project_update') {
        suggestedType = 'project_update';
      }

      // STRATEGY-ONLY OVERRIDE: If classifyType returned project_update but the section
      // is strategy-only (no concrete delta or schedule event), downgrade to idea.
      // This handles the case where PLAN_MUTATION_PATTERNS match strategic language like
      // "prioritize" that makes p_mutation > p_artifact but without a real schedule mutation.
      // Decision markers and role assignments are always exempt (already handled above).
      // Sections with explicit imperative actions are also exempt: imperatives represent
      // concrete tasks (e.g. "Remove deprecated feature flags"), not strategic pivots.
      const _hasImperative = hasExplicitImperativeAction(section);
      if (_isStrategyOnly && suggestedType === 'project_update' && !intent.flags?.forceDecisionMarker && !intent.flags?.forceRoleAssignment && !_hasImperative) {
        suggestedType = 'idea';
      }

      // Guard: project_update only for plan_change intent OR forced overrides.
      // Non-plan_change sections without overrides should be idea.
      if (!isPlanChange && !intent.flags?.forceDecisionMarker && !intent.flags?.forceRoleAssignment && suggestedType === 'project_update') {
        suggestedType = 'idea';
      }
    }
  }

  // For plan_change sections with no suggested type, force project_update —
  // unless the section is strategy-only (no concrete delta or schedule event).
  if (isPlanChange && !_isStrategyOnly && !suggestedType) {
    suggestedType = 'project_update';
    typeConfidence = 0.2; // explicit "fallback" confidence
  }

  // Compute typeLabel for validator behavior
  const typeLabel = computeTypeLabel(section, intent);

  // STRATEGY HEADING GUARD: computeTypeLabel is the canonical type arbiter.
  // If it decided 'idea' (e.g. strategy heading + no delta), ensure suggested_type
  // agrees — prevents synthesis from using project_update title/body format when
  // the section is a strategy-direction block, not a schedule mutation.
  if (typeLabel === 'idea' && suggestedType === 'project_update') {
    suggestedType = 'idea';
  }

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
  // First pass: heal any plan_change sections that are marked non-actionable.
  // Exception: strategy-only sections (no concrete delta or schedule event) must NOT
  // be force-healed here — they are emitted as ideas via normal actionability or the
  // strategy-only plan_change path in classifySection, and forcing them through without
  // a corrected typeLabel would let them reach synthesis as project_update.
  const upgraded = classifiedSections.map((s) => {
    const isPlanChange = isPlanChangeIntentLabel(s.intent);
    if (isPlanChange && !s.is_actionable) {
      const sectionText = ((s.heading_text || '') + ' ' + s.raw_text);
      const isStrategyOnly = isStrategyOnlySection(sectionText);
      if (isStrategyOnly) {
        // Strategy-only plan_change: do not force-heal here; keep existing actionability
        // so the section is filtered out rather than reaching synthesis as project_update.
        return s;
      }
      // Non-strategy plan_change: force actionable and document the override
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

  // Second pass: filter to include non-strategy plan_change or actionable sections.
  // Strategy-only plan_change sections that failed actionability are excluded here
  // (they were never valid project_update candidates).
  return upgraded.filter((s) => {
    const isPlanChange = isPlanChangeIntentLabel(s.intent);
    if (isPlanChange) {
      const sectionText = ((s.heading_text || '') + ' ' + s.raw_text);
      const isStrategyOnly = isStrategyOnlySection(sectionText);
      // Only force-include non-strategy plan_change sections
      return !isStrategyOnly || s.is_actionable;
    }
    return s.is_actionable;
  });
}

// ============================================
// Candidate-Level Plan Change Detection
// ============================================

/**
 * Conditional verbs that indicate scope removal/deferral decisions
 */
const PLAN_CHANGE_REMOVAL_VERBS = /\b(pull|remove|de-scope|descope|delay|postpone|exclude)\b/i;

/**
 * Go-to-market artifact keywords
 */
const GTM_ARTIFACT_KEYWORDS = /\b(marketing blast|launch|announcement|press|campaign|release)\b/i;

/**
 * Determine if an anchor line is a plan-change candidate.
 *
 * Returns true if the line:
 *   - starts with a conditional "if" clause, AND
 *   - contains a removal/deferral verb (pull, remove, de-scope, delay, postpone, exclude)
 *   - OR contains a go-to-market artifact (marketing blast, launch, announcement, press, campaign, release)
 *
 * When true, the caller MUST force the candidate's type to "project_update" and
 * override the section-level typeLabel for that candidate only.
 */
export function isPlanChangeCandidate(anchorLine: string): boolean {
  const normalized = anchorLine.toLowerCase().trim();
  if (!/^if\b/i.test(normalized)) {
    return false;
  }
  return PLAN_CHANGE_REMOVAL_VERBS.test(normalized) || GTM_ARTIFACT_KEYWORDS.test(normalized);
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
        // NEW_WORKSTREAM PROTECTION: If section passed actionability gate with new_workstream intent,
        // force it to 'idea' type rather than dropping it. This ensures implicit ideas and other
        // new_workstream sections are not lost due to weak pattern matching in classifyType.
        const isNewWorkstream = intent.new_workstream > intent.plan_change;
        if (isNewWorkstream && intent.new_workstream >= 0.5) {
          suggestedType = 'idea';
          typeConfidence = 0.7;
          // Return early with forced idea to prevent drop
          return {
            ...section,
            intent,
            is_actionable: true,
            actionability_reason:
              `${actionabilityResult.reason} (type non_actionable overridden for new_workstream)`,
            actionable_signal: actionabilityResult.actionableSignal,
            out_of_scope_signal: actionabilityResult.outOfScopeSignal,
            suggested_type: suggestedType,
            type_confidence: typeConfidence,
            typeLabel: 'idea',
          };
        }

        // B-SIGNAL RESCUE PROTECTION: If actionability was rescued by a B-signal,
        // protect the section at the TYPE gate by forcing 'idea' type.
        if (actionabilityResult.rescuedByBSignal) {
          return {
            ...section,
            intent,
            is_actionable: true,
            actionability_reason:
              `${actionabilityResult.reason} (type non_actionable overridden for b-signal rescue)`,
            actionable_signal: actionabilityResult.actionableSignal,
            out_of_scope_signal: actionabilityResult.outOfScopeSignal,
            suggested_type: 'idea',
            type_confidence: 0.5,
            typeLabel: 'idea',
          };
        }

        // Non-plan_change, non-new_workstream can still be dropped by TYPE
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
