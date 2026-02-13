/**
 * Title Normalization
 *
 * Deterministic post-processing to clean up extracted suggestion titles.
 * Strips filler phrases, weak verbs, and ensures titles start with strong imperative verbs.
 *
 * NO LLM. NO embeddings. Pure deterministic rules.
 */

/**
 * Strong imperative verbs we want titles to start with
 */
const STRONG_VERBS = [
  'implement',
  'add',
  'build',
  'create',
  'enable',
  'investigate',
  'evaluate',
  'launch',
  'develop',
  'improve',
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
  'reduce',
  'streamline',
];

/**
 * Leading markers to strip (case-insensitive)
 * Order matters: more specific patterns first
 */
const LEADING_MARKERS = [
  /^suggestion:\s*/i,
  /^request\s+for\s+/i,
  /^request\s+to\s+/i,
  /^it\s+would\s+be\s+good\s+to\s+/i,
  /^maybe\s+we\s+could\s+/i,
  /^we\s+should\s+consider\s+/i,
  /^we\s+could\s+consider\s+/i,
  /^consider\s+/i,
  /^could\s+we\s+/i,
  /^should\s+we\s+/i,
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
  explore: 'investigate',
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
