/**
 * Section Signal Constants and Pure Helpers
 *
 * Single source of truth for all token lists, regexes, and pure predicate
 * helpers used by the suggestion engine's section-classification pipeline.
 *
 * Files that previously each defined their own copies:
 *   - index.ts            (GAMIFICATION_TOKENS, AUTOMATION_HEADING_RE, helpers)
 *   - consolidateBySection.ts (GAMIFICATION_TOKENS)
 *   - finalEmissionEnforcement.ts (EMISSION_GAM_TOKENS, EMISSION_AUTOMATION_RE,
 *                                   EMISSION_SPEC_HEADING_TOKENS)
 *   - classifiers.ts      (SPEC_FRAMEWORK_TOKENS / _TOKEN_LIST / _TIMELINE_EXCLUSIONS)
 *
 * This module has NO imports from other engine files — all exports are pure
 * (depend only on their arguments and the constants defined here).
 *
 * Also contains:
 *   - Concrete-delta and schedule-event detection (moved from classifiers.ts)
 *   - isSpecOrFrameworkSection classifier (moved from classifiers.ts)
 *   - Timeline heading detection (moved from finalEmissionEnforcement.ts)
 *   - project_update suppression decision helper
 */

// ============================================
// Gamification signal tokens
// ============================================

/**
 * Engagement-loop token strings.  When ≥ 2 of these appear in the section's
 * bullet text AND the section has ≥ 4 bullets, the section gets a
 * cluster-level title and multi-bullet body instead of a single-bullet anchor.
 */
export const GAMIFICATION_TOKENS: readonly string[] = [
  'next episode',
  'one more',
  'worth €',
  'earning potential',
  'next highest-value field',
  'next field',
  'reward',
  'gamif',
  'streak',
  'badge',
];

/**
 * Count how many distinct gamification tokens appear in the (already-lowercased)
 * bullet text.
 */
export function countGamificationTokens(textLower: string): number {
  return GAMIFICATION_TOKENS.filter(t => textLower.includes(t)).length;
}

/**
 * Returns true when the section qualifies as a gamification cluster:
 * at least `minBullets` list items AND `minTokens` distinct gamification tokens.
 *
 * @param items       Stripped list-item strings (not pre-lowercased).
 * @param minBullets  Minimum bullet count (default 4).
 * @param minTokens   Minimum distinct token matches (default 2).
 */
export function isGamificationSection(
  items: string[],
  minBullets = 4,
  minTokens = 2,
): boolean {
  if (items.length < minBullets) return false;
  return countGamificationTokens(items.join(' ').toLowerCase()) >= minTokens;
}

/**
 * Derive the canonical cluster-level title for a gamification section.
 *
 * @param heading          Section heading text (already trimmed).
 * @param bulletJoinedLower Bullets joined with ' ' and lowercased.
 * @returns Raw title string (without suggestion-type prefix).
 */
export function computeGamificationClusterTitle(
  heading: string,
  bulletJoinedLower: string,
): string {
  if (
    bulletJoinedLower.includes('next highest-value field') ||
    bulletJoinedLower.includes('next field')
  ) {
    return 'Gamify data collection (next-field rewards)';
  }
  if (bulletJoinedLower.includes('earning potential')) {
    return 'Gamify data collection (earning-potential rewards)';
  }
  return heading || 'Gamify data collection';
}

// ============================================
// Automation signal
// ============================================

/**
 * Heading patterns that indicate an automation / data-pipeline section.
 * When matched and bulletCount >= 2, the body is formatted as a compact
 * multi-bullet list preserving the key action items.
 */
export const AUTOMATION_HEADING_RE =
  /\b(data\s+collection\s+automation|automation|parsing|ocr|upload)\b/i;

/** Returns true when the heading looks like an automation section. */
export function isAutomationSection(heading: string): boolean {
  return AUTOMATION_HEADING_RE.test(heading);
}

/**
 * Build a compact multi-bullet body from stripped list-item strings.
 *
 * @param items     Stripped list-item strings (list markers already removed).
 * @param maxItems  Maximum number of items to include (default 4).
 */
export function buildAutomationMultiBulletBody(
  items: string[],
  maxItems = 4,
): string {
  return items
    .slice(0, maxItems)
    .map(b => `- ${b}`)
    .join('\n');
}

// ============================================
// Spec / Framework signal
// ============================================

/**
 * Combined regex for a quick presence check (any spec/framework token).
 * Exported so consumers (classifiers.ts, finalEmissionEnforcement.ts) can share
 * a single source and avoid redefinition.
 */
export const SPEC_FRAMEWORK_TOKENS =
  /\b(scoring|prioriti[sz]ation|three[-\s]factor|eligibility|additionality|weighting|framework|system)\b/i;

/**
 * Individual token regexes for counting distinct matches in the body.
 * A single incidental mention (e.g. "later prioritization") is not enough;
 * the heading must contain a token OR the body must contain >= 2 distinct tokens.
 */
export const SPEC_FRAMEWORK_TOKEN_LIST: RegExp[] = [
  /\bscoring\b/i,
  /\bprioritization\b/i,
  /\bprioritisation\b/i,
  /\bthree[-\s]factor\b/i,
  /\beligibility\b/i,
  /\badditionality\b/i,
  /\bweighting\b/i,
  /\bframework\b/i,
  /\bsystem\b/i,
];

/**
 * Timeline / status tokens whose presence means the section describes a
 * concrete schedule event, NOT a pure specification.
 */
export const SPEC_FRAMEWORK_TIMELINE_EXCLUSIONS =
  /\b(deploy(?:ed|ing|ment)?|launch(?:ed|ing)?|eta|target\s+date|window|shipped|in\s+progress|complete[d]?)\b/i;

// ============================================
// Concrete-delta detection (moved from classifiers.ts)
// ============================================

// Date regex components (private)
const MONTH_NAMES = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const QUARTER_REFS = '(?:q[1-4]|quarter)';
const DATE_LIKE = `(?:\\d+(?:th|st|nd|rd)|${MONTH_NAMES}|${QUARTER_REFS}|next\\s+\\w+|this\\s+\\w+)`;

/**
 * Regex detecting concrete schedule deltas: numeric time units, date arrows,
 * "from X to Y" date moves, and "moved/pushed/delayed to DATE" patterns.
 */
const PLAN_CHANGE_CONCRETE_DELTA = new RegExp(
  '\\b\\d+-(?:week|day|month|sprint|quarter)s?\\b'
  + '|\\b\\d+\\s+(?:week|day|month|sprint|quarter)s?\\b'
  + '|\\d+(?:th|st|nd|rd)?\\s*[→>-]+\\s*\\d+(?:th|st|nd|rd)?'
  + `|\\bfrom\\s+(?:the\\s+)?${DATE_LIKE}\\s+to\\s+(?:the\\s+)?${DATE_LIKE}`
  + `|\\b(?:moved?|pushed?|delayed?|postponed?|rescheduled?)\\s+(?:to|until|from)\\s+${DATE_LIKE}`,
  'i'
);

/**
 * Returns true when the section text contains a concrete delta (date movement,
 * duration, ETA). Used to gate spec/framework classification and strategy-only
 * detection.
 */
export function hasSectionConcreteDelta(sectionText: string): boolean {
  return PLAN_CHANGE_CONCRETE_DELTA.test(sectionText);
}

// ============================================
// Schedule-event detection (moved from classifiers.ts)
// ============================================

/**
 * Delay/launch/ETA signal words. When present, the section describes a concrete
 * schedule event rather than a strategic direction.
 */
const SCHEDULE_EVENT_WORDS = /\b(?:delay(?:ed|ing)?|launch(?:ed|ing)?|deploy(?:ed|ing|ment)?|release(?:d|ing)?|ship(?:ped|ping)?|eta|go-live|go\s+live|target\s+date|due\s+date|deadline|milestone)\b/i;

/**
 * Returns true when the section text contains schedule-event language.
 */
export function hasSectionScheduleEvent(sectionText: string): boolean {
  return SCHEDULE_EVENT_WORDS.test(sectionText);
}

// ============================================
// Spec / Framework section classifier (moved from classifiers.ts)
// ============================================

/**
 * Returns true when a section describes a specification, scoring rubric,
 * eligibility framework, or similar "design document" content — meaning it
 * should NEVER be typed as project_update.
 *
 * Conditions (ALL must hold):
 *   1. The heading contains a SPEC_FRAMEWORK_TOKEN (strongest signal),
 *      OR the body contains >= 2 distinct tokens.
 *   2. The combined text does NOT contain any timeline / status token.
 *   3. The combined text does NOT contain a concrete delta.
 *   4. The combined text does NOT contain schedule-event language.
 */
export function isSpecOrFrameworkSection(
  sectionText: string,
  bullets: number,
  heading: string
): boolean {
  const combined = (heading + ' ' + sectionText);

  const headingHasToken = SPEC_FRAMEWORK_TOKENS.test(heading);
  if (!headingHasToken) {
    const bodyMatches = SPEC_FRAMEWORK_TOKEN_LIST.filter(re => re.test(sectionText));
    if (bodyMatches.length < 2) return false;
  }

  if (SPEC_FRAMEWORK_TIMELINE_EXCLUSIONS.test(combined)) return false;
  if (hasSectionConcreteDelta(combined)) return false;
  if (hasSectionScheduleEvent(combined)) return false;
  return true;
}

// ============================================
// Timeline heading detection (moved from finalEmissionEnforcement.ts)
// ============================================

/** Heading regex for timeline / implementation-schedule sections. */
export const TIMELINE_HEADING_RE = /\b(timeline|implementation\s+timeline|schedule)\b/i;

/** Returns true when the heading looks like a timeline section. */
export function isTimelineSection(heading: string): boolean {
  return TIMELINE_HEADING_RE.test(heading);
}

// ============================================
// Project-update suppression decision
// ============================================

/**
 * Returns true when a project_update suggestion should be suppressed for
 * a given section. Encapsulates the two suppression rules:
 *   1. Pure spec/framework section (no deltas) → always suppress
 *   2. Heading has spec/framework tokens AND an idea coexists → suppress
 */
export function shouldSuppressProjectUpdate(
  rawText: string,
  numBullets: number,
  heading: string,
  hasCoexistingIdea: boolean,
): boolean {
  if (isSpecOrFrameworkSection(rawText, numBullets, heading)) return true;
  if (SPEC_FRAMEWORK_TOKENS.test(heading) && hasCoexistingIdea) return true;
  return false;
}
