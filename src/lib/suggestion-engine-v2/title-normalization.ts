/**
 * Title Normalization
 *
 * Deterministic post-processing to clean up extracted suggestion titles.
 * Strips filler phrases, weak verbs, and ensures titles start with strong imperative verbs.
 *
 * NO LLM. NO embeddings. Pure deterministic rules.
 */

import type { SuggestionType, EvidenceSpan } from './types';

/**
 * Strong imperative verbs we want titles to start with
 * Per requirements: add|build|create|enable|launch|evaluate|investigate|improve|reduce|transition
 */
const STRONG_VERBS = [
  'add',
  'build',
  'create',
  'enable',
  'launch',
  'evaluate',
  'investigate',
  'improve',
  'reduce',
  'transition',
  'implement',
  'develop',
  'update',
  'fix',
  'remove',
  'migrate',
  'refactor',
  'optimize',
  'integrate',
  'deploy',
  'configure',
  'establish',
  'streamline',
  'force',
  'convert',
];

/**
 * Leading markers to strip (case-insensitive)
 * Order matters: more specific patterns first
 * NOTE: "Explore" and "Consider" alone are NOT stripped here
 * because they might be valid imperative verbs that will be mapped later
 *
 * Special handling for "we should explore" and "we should consider":
 * These are converted to just "explore" or "consider" (preserving the verb)
 * so that weak verb mapping can kick in later
 */
const LEADING_MARKERS = [
  /^suggestion:\s*/i,
  /^there\s+is\s+an\s+indirect\s+request\s+for\s+/i,
  /^there\s+is\s+a\s+request\s+to\s+/i,
  /^request\s+for\s+/i,
  /^request\s+to\s+/i,
  /^it\s+would\s+be\s+good\s+to\s+/i,
  /^maybe\s+we\s+could\s+/i,
  /^we\s+could\s+consider\s+/i,
  /^we\s+could\s+/i,  // "We could cache..." → strip subject phrase, leave verb
  /^could\s+we\s+/i,
  /^should\s+we\s+/i,
  /^users?\s+want(?:s)?\s+(?:a|an|the)\s+/i,  // "Users want a Rollback command" → strip subject phrase
  /^users?\s+want(?:s)?\s+/i,
];

/**
 * Filler phrases that appear after a verb (e.g., "Implement maybe we could")
 * These are artifacts from extraction and should be removed
 */
const POST_VERB_FILLERS = [
  /\s+maybe\s+we\s+could\s+/i,
  /\s+we\s+should\s+consider\s+/i,
  /\s+we\s+could\s+consider\s+/i,
  /\s+consider\s+/i,
  /\s+maybe\s+/i,
];

/**
 * Trailing deadline/timeline phrases to remove
 */
const TRAILING_DEADLINES = [
  /\s+by\s+end\s+of\s+\w+$/i,
  /\s+in\s+Q[1-4]$/i,
  /\s+by\s+Q[1-4]$/i,
  /\s+before\s+\w+\s+\d{1,2}$/i,
  /\s+by\s+\w+\s+\d{1,2}$/i,
];

/**
 * Map weak verbs to strong alternatives
 */
const WEAK_VERB_MAPPINGS: Record<string, string> = {
  explore: 'evaluate',
  research: 'investigate',
  'look into': 'investigate',
  'check out': 'evaluate',
  'think about': 'evaluate',
  test: 'evaluate',
};

/**
 * Normalize a suggestion title by applying deterministic rules
 *
 * Rules applied in order:
 * 1. Strip leading markers (Suggestion:, Maybe we could, etc.)
 * 2. Remove post-verb fillers (e.g., "Implement maybe we could" → "Implement")
 * 3. Map weak verbs to strong alternatives where safe
 * 4. Remove trailing deadlines
 * 5. Ensure title starts with a strong verb
 *
 * @param rawTitle - The raw title extracted from content
 * @returns Normalized title starting with a strong imperative verb
 */
export function normalizeSuggestionTitle(rawTitle: string): string {
  if (!rawTitle || rawTitle.trim().length === 0) {
    return '';
  }

  let title = rawTitle.trim();

  // CRITICAL FIX: Handle "Implement " followed by specific hedge phrases
  // These are artifacts from extraction and must be cleaned deterministically
  // Pattern: "Implement <hedge phrase> <rest>" → transform <rest>
  // Note: Only match specific problematic patterns, not generic "Request" which may be valid

  // Pattern 1: "Implement Maybe we could..."
  if (title.match(/^Implement\s+Maybe we could\s+/i)) {
    const rest = title.replace(/^Implement\s+Maybe we could\s+/i, '');
    const nextWord = rest.split(/\s+/)[0].toLowerCase();
    if (STRONG_VERBS.includes(nextWord)) {
      // "Maybe we could launch X" → "launch X" (keep strong verb)
      title = rest;
    } else {
      // "Maybe we could <noun phrase>" → "Add <noun phrase>"
      title = `Add ${rest}`;
    }
  }

  // Pattern 2: "Implement We should consider..." or "Implement We should explore..."
  else if (title.match(/^Implement\s+We should\s+(consider|explore)\s+/i)) {
    const match = title.match(/^Implement\s+We should\s+(consider|explore)\s+(.+)/i);
    if (match) {
      const verb = match[1].toLowerCase();
      const remainder = match[2];
      if (verb === 'consider' && containsUIArtifactNoun(remainder)) {
        title = `Add ${remainder}`;
      } else if (verb === 'explore') {
        title = `Evaluate ${remainder}`;
      } else {
        title = `Evaluate ${remainder}`;
      }
    }
  }

  // Pattern 3: "Implement consider..." (without "We should")
  else if (title.match(/^Implement\s+consider\s+/i)) {
    const rest = title.replace(/^Implement\s+consider\s+/i, '');
    const firstWord = rest.split(/\s+/)[0];
    const isGerund = firstWord.match(/ing$/i) && firstWord.length > 4;

    if (isGerund) {
      // "Implement consider adding templates" → "Implement adding templates"
      title = `Implement ${rest}`;
    } else if (containsUIArtifactNoun(rest)) {
      title = `Add ${rest}`;
    } else {
      title = `Evaluate ${rest}`;
    }
  }

  // Pattern 4: "Implement for more..."
  else if (title.match(/^Implement\s+for more\s+/i)) {
    const rest = title.replace(/^Implement\s+for more\s+/i, '');
    const cleanRest = rest.replace(/^["']([^"']+)["']/, '$1');
    title = `Add more ${cleanRest}`;
  }

  // Pattern 5: "Implement There is (an indirect) request for/to..."
  else if (title.match(/^Implement\s+There is\s+/i)) {
    const match = title.match(/^Implement\s+There is\s+(?:an indirect )?request (?:for|to)\s+(.+)/i);
    if (match) {
      const requestRest = match[1];
      const verbMatch = requestRest.match(/^(add|more)\s+(.+)/i);
      if (verbMatch) {
        const verb = verbMatch[1].toLowerCase();
        const object = verbMatch[2];
        if (verb === 'more') {
          title = `Add more ${object}`;
        } else {
          title = `Add ${object}`;
        }
      } else {
        title = `Add ${requestRest}`;
      }
    } else {
      // Fallback: "Implement There is X" without request pattern
      const rest = title.replace(/^Implement\s+There is\s+/i, '');
      title = `Add ${rest}`;
    }
  }

  // Pattern 6: "Implement Request to..." (only when followed by to/for, not "Requirement to")
  else if (title.match(/^Implement\s+Request\s+(to|for)\s+/i)) {
    const match = title.match(/^Implement\s+Request\s+(?:to|for)\s+(.+)/i);
    if (match) {
      const requestRest = match[1];
      const verbMatch = requestRest.match(/^(add|more)\s+(.+)/i);
      if (verbMatch) {
        const verb = verbMatch[1].toLowerCase();
        const object = verbMatch[2];
        if (verb === 'more') {
          title = `Add more ${object}`;
        } else {
          title = `Add ${object}`;
        }
      } else {
        title = `Add ${requestRest}`;
      }
    }
  }

  // Strip hedge words appearing immediately after action verbs
  // Pattern: "<Verb> <hedge> <rest>" → "<Verb> <rest>"
  // Example: "Implement probably force a string..." → "Implement force a string..."
  // Example: "Add maybe a rollback command..." → "Add a rollback command..."
  // Applied after Implement-specific patterns so it catches remaining cases
  const HEDGE_AFTER_VERB_PATTERN = /^(Implement|Add|Build|Create|Enable|Force|Convert)\s+(probably|maybe|likely|sort\s+of|kind\s+of)\b\s*/i;
  const hedgeMatch = title.match(HEDGE_AFTER_VERB_PATTERN);
  if (hedgeMatch) {
    title = title.replace(HEDGE_AFTER_VERB_PATTERN, `${hedgeMatch[1]} `).trim();
  }

  // Special handling for "we should explore" → "explore" (preserve verb)
  // So that weak verb mapping can map explore → evaluate
  if (title.match(/^we\s+should\s+explore\s+/i)) {
    title = title.replace(/^we\s+should\s+explore\s+/i, 'explore ');
  }

  // Special handling for "we should consider" → check for UI artifacts OR gerunds
  if (title.match(/^we\s+should\s+consider\s+/i)) {
    const rest = title.replace(/^we\s+should\s+consider\s+/i, '');
    const firstWord = rest.split(/\s+/)[0];
    const isGerund = firstWord.match(/ing$/i) && firstWord.length > 4;

    if (containsUIArtifactNoun(rest)) {
      // "we should consider a checklist UI" → "Add a checklist UI"
      title = `Add ${rest}`;
    } else if (isGerund) {
      // "we should consider implementing X" → "implementing X" (preserve gerund)
      title = rest;
    } else {
      // "we should consider X" without UI noun → "evaluate X"
      title = `evaluate ${rest}`;
    }
  }

  // Special handling for standalone "consider" + UI artifact → "Add"
  // Must check BEFORE stripping leading markers
  const considerMatch = title.match(/^consider\s+(.+)/i);
  if (considerMatch) {
    const rest = considerMatch[1];
    if (containsUIArtifactNoun(rest)) {
      // "consider a checklist UI" → "Add a checklist UI"
      title = `Add ${rest}`;
    } else {
      // "consider X" without UI noun → strip "consider"
      title = rest;
    }
  }

  // Step 1: Strip leading markers
  for (const pattern of LEADING_MARKERS) {
    title = title.replace(pattern, '');
  }
  title = title.trim();

  // Step 2: Remove post-verb fillers
  // Example: "Implement maybe we could add X" → "Implement add X"
  for (const pattern of POST_VERB_FILLERS) {
    title = title.replace(pattern, ' ');
  }
  title = title.replace(/\s+/g, ' ').trim();

  // Step 2b: Check for duplicate verbs (artifact from filler removal)
  // "Implement add X" → "Add X" (keep the more specific verb)
  // "Implement launch X" → "Launch X"
  // BUT: "Implement caching" → keep (caching is the object, not a verb)
  const words = title.split(/\s+/);
  if (words.length >= 2) {
    const firstWord = words[0].toLowerCase();
    const secondWord = words[1].toLowerCase();

    // Only remove first verb if BOTH are in STRONG_VERBS list
    // (This handles artifacts like "Implement add X")
    if (STRONG_VERBS.includes(firstWord) && STRONG_VERBS.includes(secondWord)) {
      title = words.slice(1).join(' ');
    }
  }

  // Step 3: Map weak verbs to strong alternatives
  // Check if title starts with a weak verb and the rest is clearly a concrete object
  const lowerTitle = title.toLowerCase();
  for (const [weak, strong] of Object.entries(WEAK_VERB_MAPPINGS)) {
    // Match "Explore X", "Exploring X", "Explored X" at start
    const weakPattern = new RegExp(`^${weak}(?:s|ing|ed)?\\s+(.+)`, 'i');
    const match = title.match(weakPattern);
    if (match && match[1]) {
      const rest = match[1];
      // Only map if the rest looks like a concrete object (contains noun-like words)
      // Avoid mapping pure research like "Explore whether users want X"
      if (!rest.match(/^(?:whether|if|how|why|what)\b/i)) {
        title = `${strong.charAt(0).toUpperCase()}${strong.slice(1)} ${rest}`;
        break;
      }
    }
  }

  // Step 4: Remove trailing deadlines
  for (const pattern of TRAILING_DEADLINES) {
    title = title.replace(pattern, '');
  }
  title = title.trim();

  // Step 5: Ensure title starts with strong verb
  // If it doesn't start with a strong verb, try to infer one from context
  const firstWord = title.split(/\s+/)[0].toLowerCase();

  // Check if title starts with gerund (adding, implementing, etc.)
  // These are valid forms, don't try to infer a verb
  const isGerund = firstWord.endsWith('ing') && firstWord.length > 4;

  const startsWithStrongVerb = STRONG_VERBS.some(verb => firstWord === verb);

  if (!startsWithStrongVerb && !isGerund) {
    // Check if we can infer a verb from the title structure
    const inferredTitle = inferStrongVerb(title);
    if (inferredTitle !== title) {
      title = inferredTitle;
    }
  }

  // Final cleanup: capitalize first letter
  if (title.length > 0) {
    title = title.charAt(0).toUpperCase() + title.slice(1);
  }

  return title;
}

/**
 * UI/artifact nouns that imply creation
 */
const UI_ARTIFACT_NOUNS = [
  'checklist',
  'template',
  'integration',
  'dashboard',
  'report',
  'ui',
  'component',
  'system',
  'tool',
  'feature',
  'service',
  'module',
  'panel',
  'widget',
  'form',
  'modal',
  'dialog',
  'badge',
  'email',
  'workflow',
];

/**
 * Check if text contains UI/artifact nouns
 */
function containsUIArtifactNoun(text: string): boolean {
  const lowerText = text.toLowerCase();
  return UI_ARTIFACT_NOUNS.some(noun =>
    lowerText.match(new RegExp(`\\b${noun}s?\\b`))
  );
}

/**
 * Smart title truncation that preserves meaning
 * Truncates at clause/punctuation/word boundaries, adds ellipsis
 *
 * @param title - The title to truncate
 * @param maxLen - Maximum length (default 80)
 * @returns Truncated title with ellipsis if needed
 */
export function truncateTitleSmart(title: string, maxLen: number = 80): string {
  if (title.length <= maxLen) {
    return title;
  }

  // Try to find good break points in order of preference
  const breakPoints = [
    // Clause boundaries
    { pattern: /[,;—–-]\s+/g, name: 'clause' },
    // Sentence boundaries (period, but be careful with abbreviations)
    { pattern: /\.\s+/g, name: 'sentence' },
    // Parenthetical boundaries
    { pattern: /[()]\s*/g, name: 'paren' },
    // Word boundaries
    { pattern: /\s+/g, name: 'word' },
  ];

  for (const { pattern } of breakPoints) {
    const matches = [...title.matchAll(pattern)];
    if (matches.length === 0) continue;

    // Find the last break point before maxLen - 3 (for "...")
    for (let i = matches.length - 1; i >= 0; i--) {
      const match = matches[i];
      const breakPos = match.index! + match[0].length;

      if (breakPos <= maxLen - 3) {
        // Good break point found
        const truncated = title.substring(0, breakPos).trim();
        // Remove trailing punctuation before ellipsis
        return truncated.replace(/[,;—–-]+$/, '') + '...';
      }
    }
  }

  // No good break point found, hard truncate at word boundary
  const hardLimit = maxLen - 3;
  const truncated = title.substring(0, hardLimit);
  const lastSpace = truncated.lastIndexOf(' ');

  if (lastSpace > hardLimit * 0.6) {
    return truncated.substring(0, lastSpace).trim() + '...';
  }

  // Last resort: hard truncate
  return truncated.trim() + '...';
}

/**
 * Infer a strong verb from title context
 * Examples:
 * - "keyboard shortcut system" → "Add keyboard shortcut system"
 * - "automated regression tests" → "Add automated regression tests"
 * - "better supplier engagement tools" → "Improve supplier engagement tools"
 */
function inferStrongVerb(title: string): string {
  const lowerTitle = title.toLowerCase();

  // Pattern: "use X" → remove "use", let inference continue
  // Example: "use a schema mapper UI" → "a schema mapper UI" → "Add a schema mapper UI"
  if (lowerTitle.match(/^use\s+/)) {
    const withoutUse = title.replace(/^use\s+/i, '').trim();
    // Recursively infer verb for the rest
    return inferStrongVerb(withoutUse);
  }

  // Pattern: "better/improved X" → "Improve X"
  if (lowerTitle.match(/^(?:better|improved|faster|more efficient)\s+/)) {
    return title.replace(/^(?:better|improved|faster|more efficient)\s+/i, 'Improve ');
  }

  // Pattern: "more X" → "Add more X" (when X is a creation noun)
  if (lowerTitle.match(/^more\s+/)) {
    return title.replace(/^more\s+/i, 'Add more ');
  }

  // Pattern: "new X" → "Add X" or "Create X"
  if (lowerTitle.match(/^(?:a\s+)?new\s+/)) {
    return title.replace(/^(?:a\s+)?new\s+/i, 'Add ');
  }

  // Pattern: noun phrases that imply creation
  // "X system", "X tool", "X feature", "X UI", "X component"
  const creationNouns = ['system', 'tool', 'feature', 'ui', 'component', 'service', 'module', 'integration', 'template'];
  for (const noun of creationNouns) {
    if (lowerTitle.match(new RegExp(`\\b${noun}s?\\b`))) {
      return `Add ${title}`;
    }
  }

  // Pattern: adjective + noun (likely describing new feature)
  // "automated tests", "certified badge", "schema mapper"
  if (lowerTitle.match(/^[a-z]+(?:ed|ing)\s+\w+/)) {
    return `Add ${title}`;
  }

  // Default: if nothing matches, keep original
  return title;
}

// ============================================
// Title Quality Contract
// ============================================

/**
 * Title Quality Contract (`enforceTitleContract`)
 *
 * WHY THIS EXISTS:
 * The synthesis pipeline can produce malformed titles like "Update: Discussion They"
 * where the content portion consists entirely of pronouns ("They", "We") or
 * generic words ("Discussion", "General") with no concrete entity. These titles
 * are uninformative and confusing to users.
 *
 * CONTRACT (applied to the content portion of the title, after any prefix):
 * 1. Strip leading stopwords/pronouns from the content portion.
 * 2. Require ≥3 meaningful tokens (excluding stopwords).
 * 3. Reject content dominated by pronouns or generic words alone.
 * 4. On failure, apply a deterministic fallback derived from evidence span tokens.
 *
 * The prefix (e.g. "Update:", "Risk:") is preserved unchanged.
 * Canonical gold note titles pass without modification.
 */

/**
 * Pronouns that dominate-fail a title when they are the only content tokens.
 * A title fails if EVERY token is in this set.
 */
const TITLE_CONTRACT_PRONOUNS = new Set([
  'they', 'we', 'us', 'our', 'their', 'it', 'its',
  'this', 'that', 'these', 'those', 'he', 'she', 'him', 'her',
  'i', 'you', 'me', 'my', 'your',
]);

/**
 * Generic words that, alone, make a title vacuous.
 * A title fails if EVERY token is in this set (combined with pronouns).
 */
const TITLE_CONTRACT_GENERICS = new Set([
  'discussion', 'general', 'update', 'info', 'information',
  'overview', 'summary', 'note', 'notes', 'topic', 'item',
  'meeting', 'call', 'session', 'status', 'check',
]);

/**
 * Stopwords to strip from the start of the content portion.
 * Stripping these before the token check prevents them from padding the count.
 */
const TITLE_CONTRACT_LEADING_STOPWORDS = [
  /^(?:the|a|an|and|or|but|in|on|at|to|for|of|with|by|from|about|as|into|through|during|before|after)\s+/i,
  /^(?:they|we|our|their|it|this|that|these|those)\s+/i,
];

/**
 * Known title prefixes emitted by the engine (e.g. "Update:", "Risk:").
 * We split on these to isolate the content portion.
 */
const KNOWN_TITLE_PREFIXES = /^(Update|Risk|Idea|Bug|Action items|Implement|Fix|Add|Build|Create|Enable|Launch|Evaluate|Investigate|Improve|Reduce|Transition|Develop|Remove|Migrate|Refactor|Optimize|Integrate|Deploy|Configure|Establish|Streamline):\s*/i;

/**
 * Extract the first concrete entity from evidence span tokens.
 * Returns the first noun-like token (≥4 chars, not a stopword/pronoun) found
 * in the evidence text, or null if none is found.
 */
function extractEntityFromEvidence(evidenceSpans: EvidenceSpan[]): string | null {
  const stopwords = new Set([
    ...Array.from(TITLE_CONTRACT_PRONOUNS),
    ...Array.from(TITLE_CONTRACT_GENERICS),
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to',
    'for', 'of', 'with', 'by', 'from', 'about', 'as', 'into',
    'through', 'during', 'before', 'after', 'is', 'are', 'was',
    'were', 'be', 'been', 'have', 'has', 'had', 'do', 'does',
    'did', 'will', 'would', 'could', 'should', 'may', 'might',
    'can', 'not', 'no', 'if', 'so', 'just', 'also', 'only',
    'than', 'then', 'when', 'where', 'which', 'who', 'what', 'how',
  ]);

  for (const span of evidenceSpans) {
    // Split into words, skip punctuation
    const tokens = span.text
      .replace(/[^\w\s-]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length >= 4 && !stopwords.has(t.toLowerCase()));

    if (tokens.length > 0) {
      // Prefer capitalized tokens (proper nouns / product names)
      const proper = tokens.find(t => /^[A-Z]/.test(t));
      return proper ?? tokens[0];
    }
  }
  return null;
}

/**
 * Extract a delta or date token from evidence spans.
 * Returns the first match of patterns like "4-week", "2 weeks", "12th → 19th", etc.
 */
function extractDeltaFromEvidence(evidenceSpans: EvidenceSpan[]): string | null {
  const DELTA_PATTERNS = [
    /\d+-(?:week|day|month|sprint)s?/i,
    /\d+\s+(?:week|day|month|sprint)s?/i,
    /\d+(?:st|nd|rd|th)\s*[→\-–]\s*\d+(?:st|nd|rd|th)/i,
    /from\s+\w+\s+to\s+\w+/i,
    /delayed?\s+to\s+\w+/i,
    /pushed?\s+(?:to|until)\s+\w+/i,
  ];

  for (const span of evidenceSpans) {
    for (const pattern of DELTA_PATTERNS) {
      const match = span.text.match(pattern);
      if (match) return match[0];
    }
  }
  return null;
}

/**
 * Build a deterministic fallback title by type, derived from evidence tokens.
 * Never invents entities — all content comes from evidence span text.
 */
function buildFallbackTitle(type: SuggestionType, evidenceSpans: EvidenceSpan[]): string {
  const entity = extractEntityFromEvidence(evidenceSpans);

  switch (type) {
    case 'project_update': {
      const delta = extractDeltaFromEvidence(evidenceSpans);
      if (entity && delta) return `Update: ${entity} ${delta}`;
      if (entity) return `Update: ${entity} delayed`;
      return 'Update: Timeline adjustment identified';
    }
    case 'risk':
      return entity ? `${entity} risk identified` : 'Risk identified';
    case 'idea':
      return entity ? `${entity} improvement` : 'Idea identified';
    case 'bug':
      return entity ? `${entity} issue` : 'Bug identified';
    default:
      return entity ? `${entity} issue` : 'Issue identified';
  }
}

/**
 * Check whether the content tokens (after stripping stopwords) pass the quality bar.
 * Returns true if the content is acceptable, false if a fallback is needed.
 */
function contentPassesContract(content: string): boolean {
  let stripped = content.trim();

  // Step 1: Strip leading stopwords/pronouns
  for (const pattern of TITLE_CONTRACT_LEADING_STOPWORDS) {
    stripped = stripped.replace(pattern, '');
  }
  stripped = stripped.trim();

  // Step 2: Tokenize and count meaningful tokens
  const tokens = stripped
    .split(/\s+/)
    .filter(t => t.length > 0)
    .map(t => t.toLowerCase().replace(/[^a-z0-9-]/g, ''));

  const meaningfulTokens = tokens.filter(
    t => t.length >= 2 && !TITLE_CONTRACT_PRONOUNS.has(t) && !TITLE_CONTRACT_GENERICS.has(t)
  );

  // Step 3: Require ≥3 meaningful tokens
  if (meaningfulTokens.length < 3) {
    // Allow if there are at least 2 meaningful tokens that aren't generics/pronouns
    // (stricter: require at least 1 non-generic, non-pronoun token)
    const concreteTokens = tokens.filter(
      t => t.length >= 3 && !TITLE_CONTRACT_PRONOUNS.has(t) && !TITLE_CONTRACT_GENERICS.has(t)
    );
    if (concreteTokens.length === 0) return false;
    if (meaningfulTokens.length < 1) return false;
  }

  // Step 4: Reject if every token is a pronoun or generic word
  const allTokens = tokens.filter(t => t.length >= 2);
  if (allTokens.length === 0) return false;

  const allVacuous = allTokens.every(
    t => TITLE_CONTRACT_PRONOUNS.has(t) || TITLE_CONTRACT_GENERICS.has(t)
  );
  if (allVacuous) return false;

  return true;
}

/**
 * Expected title prefix by suggestion type.
 * plan_change uses the same "Update:" prefix as project_update.
 */
const TYPE_PREFIX: Record<string, string> = {
  project_update: 'Update:',
  plan_change: 'Update:',
  risk: 'Risk:',
  idea: 'Idea:',
  bug: 'Bug:',
};

/**
 * Matches any of the four user-facing prefixes at the start of a title.
 * Case-insensitive so "update:" and "Update:" are both caught.
 */
const USER_FACING_PREFIXES = /^(Update|Risk|Idea|Bug):\s*/i;

/**
 * Normalize the title prefix for a suggestion so it matches the expected
 * prefix for its type. Idempotent and deterministic.
 *
 * Rules (applied in order):
 * 1. Determine expectedPrefix from type (e.g. "Update:" for project_update).
 * 2. If no expectedPrefix for this type → return title unchanged (types like
 *    "idea" that currently emit bare imperative titles are left alone so the
 *    contract layer can still add them if needed; only types explicitly listed
 *    in TYPE_PREFIX are normalized).
 * 3. If the title already starts with any known user-facing prefix:
 *    a. If it matches expectedPrefix (case-insensitive) → keep as-is.
 *    b. If it does not match → replace the existing prefix with expectedPrefix,
 *       keeping the trimmed remainder.
 * 4. If the title has no known prefix → prepend expectedPrefix + " " + title.
 * 5. Double-prefix guard: if after the above the title would start with
 *    "Update: Update:" (or any repetition) → collapse to single prefix.
 */
export function normalizeTitlePrefix(type: string, title: string): string {
  const expectedPrefix = TYPE_PREFIX[type];
  if (!expectedPrefix) return title;

  const prefixMatch = title.match(USER_FACING_PREFIXES);

  if (prefixMatch) {
    const existingPrefixRaw = prefixMatch[0]; // e.g. "Update: " or "risk: "
    const existingPrefixWord = prefixMatch[1]; // e.g. "Update" or "risk"
    const expectedPrefixWord = expectedPrefix.slice(0, -1); // strip trailing ":"

    if (existingPrefixWord.toLowerCase() === expectedPrefixWord.toLowerCase()) {
      // Already correct prefix — keep but normalise casing to canonical form
      return expectedPrefix + ' ' + title.slice(existingPrefixRaw.length).trimStart();
    }
    // Wrong prefix — replace with expected, keep remainder
    const remainder = title.slice(existingPrefixRaw.length).trimStart();
    return expectedPrefix + ' ' + remainder;
  }

  // No known prefix — prepend expectedPrefix
  return expectedPrefix + ' ' + title;
}

/**
 * Enforce the title quality contract before final emission.
 *
 * @param type - The suggestion type (for fallback selection)
 * @param title - The normalized title to validate
 * @param evidenceSpans - Evidence spans to derive fallback content from
 * @returns The original title if it passes, or a deterministic fallback
 */
export function enforceTitleContract(
  type: SuggestionType,
  title: string,
  evidenceSpans: EvidenceSpan[]
): string {
  if (!title || title.trim().length === 0) {
    return buildFallbackTitle(type, evidenceSpans);
  }

  // Split off any known prefix (e.g. "Update:", "Risk:")
  const prefixMatch = title.match(KNOWN_TITLE_PREFIXES);
  const prefix = prefixMatch ? prefixMatch[0] : '';
  const content = prefixMatch ? title.slice(prefix.length) : title;

  if (!contentPassesContract(content)) {
    return buildFallbackTitle(type, evidenceSpans);
  }

  return title;
}
