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
