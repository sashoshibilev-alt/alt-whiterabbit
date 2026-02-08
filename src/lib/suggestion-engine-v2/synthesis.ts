/**
 * Suggestion Engine v2 - Synthesis
 *
 * Generates suggestion titles, payloads, and evidence spans.
 */

import type {
  ClassifiedSection,
  SuggestionType,
  SuggestionPayload,
  EvidenceSpan,
  Suggestion,
  SuggestionScores,
  SuggestionRouting,
  SuggestionContext,
  Line,
} from './types';
import { normalizeForComparison } from './preprocessing';
import { computeSuggestionKey } from '../suggestion-keys';
import { PROPOSAL_VERBS_IDEA_ONLY } from './classifiers';

// ============================================
// ID Generation
// ============================================

let suggestionCounter = 0;

function generateSuggestionId(noteId: string): string {
  return `sug_${noteId.slice(0, 8)}_${++suggestionCounter}_${Date.now().toString(36)}`;
}

/**
 * Reset suggestion counter (for testing)
 */
export function resetSuggestionCounter(): void {
  suggestionCounter = 0;
}

// ============================================
// Title Generation
// ============================================

/**
 * Extract key noun phrases from text
 */
function extractKeyNouns(text: string): string[] {
  // Simple extraction: find capitalized words and multi-word phrases
  const words = text.split(/\s+/);
  const nouns: string[] = [];

  for (let i = 0; i < words.length; i++) {
    const word = words[i].replace(/[^a-zA-Z0-9]/g, '');
    // Skip common stop words and short words
    if (word.length < 3) continue;
    if (isStopWord(word.toLowerCase())) continue;

    // Check for capitalized words (potential proper nouns)
    if (/^[A-Z][a-z]+$/.test(word)) {
      nouns.push(word);
    }
  }

  // Also extract quoted phrases
  const quotedPhrases = text.match(/"[^"]+"|'[^']+'/g);
  if (quotedPhrases) {
    nouns.push(...quotedPhrases.map((p) => p.replace(/['"]/g, '')));
  }

  return [...new Set(nouns)].slice(0, 5);
}

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'is', 'are', 'was', 'were',
  'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did',
  'will', 'would', 'could', 'should', 'may', 'might', 'must', 'shall',
  'can', 'this', 'that', 'these', 'those', 'to', 'for', 'with', 'from',
  'by', 'about', 'into', 'through', 'during', 'before', 'after', 'above',
  'below', 'between', 'under', 'again', 'further', 'then', 'once', 'here',
  'there', 'when', 'where', 'why', 'how', 'all', 'each', 'few', 'more',
  'most', 'other', 'some', 'such', 'only', 'own', 'same', 'so', 'than',
  'too', 'very', 'just', 'also', 'now', 'new', 'way', 'want', 'need',
]);

function isStopWord(word: string): boolean {
  return STOP_WORDS.has(word);
}

/**
 * Generate a title for a project update suggestion
 */
function generateProjectUpdateTitle(section: ClassifiedSection): string {
  const headingText = section.heading_text || '';
  const bodyText = section.raw_text;

  // Special case: role assignment sections
  if (section.intent.flags?.forceRoleAssignment && headingText) {
    return `Action items: ${headingText}`;
  }

  // Try to use heading if it names a workstream
  if (headingText && headingText.length > 3 && headingText.length < 60) {
    // Check if heading is specific enough
    const normalized = headingText.toLowerCase();
    if (!isGenericHeading(normalized)) {
      return `Update ${headingText} plan`;
    }
  }

  // Extract key change from body
  const changePatterns = [
    /\b(shift|pivot|refocus)\s+(?:to|towards?)\s+([^.!?\n]+)/i,
    /\b(narrow|expand|adjust)\s+(?:the\s+)?([^.!?\n]+)/i,
    /\b(from\s+.{5,30}\s+to\s+[^.!?\n]+)/i,
  ];

  for (const pattern of changePatterns) {
    const match = bodyText.match(pattern);
    if (match) {
      const change = match[2] || match[1];
      if (change && change.length < 50) {
        return `Project update: ${capitalizeFirst(change.trim())}`;
      }
    }
  }

  // Fallback: use key nouns from the section
  const keyNouns = extractKeyNouns(bodyText);
  if (keyNouns.length > 0) {
    return `Update ${keyNouns.slice(0, 2).join(' ')} plan`;
  }

  // Last resort
  return `Update project scope and focus`;
}

/**
 * Truncate title to max length safely (avoid cutting mid-word)
 */
function truncateTitle(title: string, maxLength: number): string {
  if (title.length <= maxLength) {
    return title;
  }

  // Find last space before maxLength
  const truncated = title.substring(0, maxLength);
  const lastSpace = truncated.lastIndexOf(' ');

  if (lastSpace > maxLength * 0.6) {
    // If we have a reasonable break point, use it
    return truncated.substring(0, lastSpace).trim();
  }

  // Otherwise, hard truncate
  return truncated.trim();
}

/**
 * Generate title from proposal line
 * Strips list markers, capitalizes, truncates to 80 chars
 */
function generateTitleFromProposal(proposalLine: string): string {
  // Strip list markers using existing helper
  let title = normalizeForProposal(proposalLine);

  // Capitalize first letter
  title = capitalizeFirst(title);

  // Truncate if needed
  if (title.length > 80) {
    title = truncateTitle(title, 80);
  }

  return title;
}

/**
 * Generate title from friction complaint
 * Creates solution-shaped title (e.g., "Reduce clicks to complete annual attestations")
 */
function generateTitleFromFriction(frictionType: string, target: string): string {
  let title: string;
  const normalizedTarget = target.trim();

  if (frictionType === 'clicks') {
    title = `Reduce clicks to ${normalizedTarget.toLowerCase()}`;
  } else if (frictionType === 'steps') {
    title = `Reduce steps to ${normalizedTarget.toLowerCase()}`;
  } else {
    title = `Streamline ${normalizedTarget.toLowerCase()}`;
  }

  // Truncate if needed
  if (title.length > 80) {
    title = truncateTitle(title, 80);
  }

  return title;
}

/**
 * Generate a title for an idea suggestion
 * Priority:
 * 1. Proposal line (if detected) → contentful title without "New idea:" prefix
 * 2. Friction complaint (if detected) → solution-shaped title without "New idea:" prefix
 * 3. Fallback → "New idea: <Heading>" or generic fallback
 */
function generateIdeaTitle(section: ClassifiedSection): string {
  const headingText = section.heading_text || '';
  const bodyText = section.raw_text;

  // PROPOSAL-FIRST: Check for proposal lines
  const lines = bodyText.split(/[.!?\n]+/).map(s => s.trim()).filter(s => s.length > 10);
  const proposalLines = lines.filter(isProposalLine);

  if (proposalLines.length > 0) {
    // Generate title from first proposal line
    return generateTitleFromProposal(proposalLines[0]);
  }

  // FRICTION HEURISTIC: Check for friction complaint
  const frictionComplaint = detectFrictionComplaint(bodyText);
  if (frictionComplaint) {
    // Generate solution-shaped title from friction complaint
    return generateTitleFromFriction(
      frictionComplaint.frictionType,
      frictionComplaint.target
    );
  }

  // FALLBACK: Try to use heading if it names a workstream
  if (headingText && headingText.length > 3 && headingText.length < 60) {
    const normalized = headingText.toLowerCase();
    if (!isGenericHeading(normalized)) {
      return `New idea: ${headingText}`;
    }
  }

  // Look for launch/build phrases
  const creationPatterns = [
    /\b(launch|build|create|spin up|kick off)\s+(?:a\s+|an\s+|the\s+)?([^.!?\n]+)/i,
    /\bnew\s+(initiative|project|workstream|program)\s*(?:for|:)\s*([^.!?\n]+)/i,
  ];

  for (const pattern of creationPatterns) {
    const match = bodyText.match(pattern);
    if (match) {
      const target = match[2];
      if (target && target.length < 50 && target.length > 3) {
        return `New idea: ${capitalizeFirst(target.trim())}`;
      }
    }
  }

  // Extract key nouns
  const keyNouns = extractKeyNouns(bodyText);
  if (keyNouns.length > 0) {
    return `New ${keyNouns.slice(0, 2).join(' ')} idea`;
  }

  // Last resort
  return `New idea from section`;
}

/**
 * Check if heading is too generic
 */
function isGenericHeading(heading: string): boolean {
  const genericHeadings = [
    'general', 'notes', 'discussion', 'topics', 'items',
    'agenda', 'meeting notes', 'summary', 'overview', 'misc',
    'miscellaneous', 'other', 'next steps', 'action items',
  ];
  return genericHeadings.some((g) => heading.includes(g));
}

function capitalizeFirst(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// ============================================
// Payload Generation
// ============================================

/**
 * Generate after_description for plan mutation
 */
function generateAfterDescription(section: ClassifiedSection): string {
  const bodyText = section.raw_text;
  const lines = bodyText.split('\n').filter((l) => l.trim());

  // Extract key points from the section
  const bullets = lines
    .filter((l) => /^[-*•]\s/.test(l.trim()))
    .map((l) => l.trim().replace(/^[-*•]\s+/, ''));

  const keyPoints: string[] = [];

  // Look for scope/focus statements
  const scopePatterns = [
    /\b(focus(?:ing)?\s+on|prioritiz(?:e|ing))\s+([^.!?\n]+)/gi,
    /\b(scope|in scope|out of scope)\s*(?::|is|includes?)\s*([^.!?\n]+)/gi,
    /\b(key\s+change|main\s+change|primary\s+focus)\s*(?::|is)\s*([^.!?\n]+)/gi,
  ];

  for (const pattern of scopePatterns) {
    const matches = bodyText.matchAll(pattern);
    for (const match of matches) {
      if (match[2] && match[2].length > 10) {
        keyPoints.push(match[2].trim());
      }
    }
  }

  // Add relevant bullets
  for (const bullet of bullets.slice(0, 3)) {
    if (bullet.length > 15 && bullet.length < 200) {
      keyPoints.push(bullet);
    }
  }

  // Build description
  if (keyPoints.length === 0) {
    // Fallback: summarize first few sentences
    const sentences = bodyText.split(/[.!?]+/).filter((s) => s.trim().length > 20);
    return sentences.slice(0, 2).join('. ').trim() + '.';
  }

  // Format as flowing description
  const uniquePoints = [...new Set(keyPoints)].slice(0, 4);
  let description = uniquePoints.map((p) => capitalizeFirst(p.trim())).join('. ');

  // Clean up
  description = description.replace(/\.\s*\./g, '.').trim();
  if (!description.endsWith('.')) {
    description += '.';
  }

  return description;
}

/**
 * Generate draft_initiative for execution artifact
 */
function generateDraftInitiative(
  section: ClassifiedSection,
  title: string
): { title: string; description: string } {
  const bodyText = section.raw_text;
  const lines = bodyText.split('\n').filter((l) => l.trim());

  // Extract objective
  let objective = '';
  const objectivePatterns = [
    /\b(objective|goal|mission|aim|purpose)\s*(?::|is|to)\s*([^.!?\n]+)/i,
    /\b(success\s+looks\s+like|when\s+complete|outcome)\s*(?::|is)\s*([^.!?\n]+)/i,
  ];

  for (const pattern of objectivePatterns) {
    const match = bodyText.match(pattern);
    if (match && match[2]) {
      objective = capitalizeFirst(match[2].trim());
      break;
    }
  }

  // Extract scope
  let scope = '';
  const scopePatterns = [
    /\b(scope|includes?|covers?)\s*(?::|is)\s*([^.!?\n]+)/i,
    /\b(in scope|within scope)\s*(?::|is)?\s*([^.!?\n]+)/i,
  ];

  for (const pattern of scopePatterns) {
    const match = bodyText.match(pattern);
    if (match && match[2]) {
      scope = capitalizeFirst(match[2].trim());
      break;
    }
  }

  // Extract approach/phases
  let approach = '';
  const approachPatterns = [
    /\b(approach|strategy|plan|phases?)\s*(?::|is)\s*([^.!?\n]+)/i,
    /\b(first|phase\s*1|step\s*1)\s*(?::|,)\s*([^.!?\n]+)/i,
  ];

  for (const pattern of approachPatterns) {
    const match = bodyText.match(pattern);
    if (match && match[2]) {
      approach = capitalizeFirst(match[2].trim());
      break;
    }
  }

  // Build description from extracted parts + bullets
  const bullets = lines
    .filter((l) => /^[-*•]\s/.test(l.trim()))
    .map((l) => l.trim().replace(/^[-*•]\s+/, ''))
    .slice(0, 4);

  const descriptionParts: string[] = [];

  if (objective) {
    descriptionParts.push(`Objective: ${objective}`);
  }
  if (scope) {
    descriptionParts.push(`Scope: ${scope}`);
  }
  if (approach) {
    descriptionParts.push(`Approach: ${approach}`);
  }

  // Add bullets as additional context
  if (bullets.length > 0 && descriptionParts.length < 3) {
    descriptionParts.push(`Key points: ${bullets.join('; ')}`);
  }

  // Fallback if nothing extracted
  if (descriptionParts.length === 0) {
    const sentences = bodyText.split(/[.!?]+/).filter((s) => s.trim().length > 20);
    descriptionParts.push(...sentences.slice(0, 3).map((s) => s.trim()));
  }

  return {
    title: title.replace(/^New initiative:\s*/i, '').trim(),
    description: descriptionParts.join(' ').trim(),
  };
}

// ============================================
// Body Generation (Standalone Context)
// ============================================

/**
 * Imperative verbs that mark action-oriented sentences
 */
const IMPERATIVE_VERBS = [
  'add', 'remove', 'update', 'change', 'introduce', 'show', 'hide', 'rename',
  'move', 'split', 'merge', 'track', 'instrument', 'alert', 'surface',
  'display', 'log', 'notify', 'create', 'implement', 'fix',
];

/**
 * Check if a sentence starts with an imperative verb
 */
function isImperativeSentence(sentence: string): boolean {
  const trimmed = sentence.trim();
  const firstWord = trimmed.split(/\s+/)[0]?.toLowerCase().replace(/[^a-z]/g, '');
  return IMPERATIVE_VERBS.includes(firstWord);
}

/**
 * Normalize text for proposal detection (lowercase, strip list markers)
 * Uses same preprocessing as classifiers for consistency
 */
function normalizeForProposal(text: string): string {
  let processed = text.toLowerCase().trim();

  // Strip list markers at start of line
  processed = processed
    .replace(/^\s*[-*+•]\s+/, '')      // bullet markers
    .replace(/^\s*\d+[.)]\s+/, '');    // numbered list markers

  // Collapse whitespace
  return processed.replace(/\s+/g, ' ');
}

/**
 * Check if a line is a proposal line (for idea synthesis only)
 * A proposal line either:
 * 1. Starts with a proposal verb (e.g., "Reduce required steps...")
 * 2. Contains "by <verb+ing>" pattern (e.g., "improve UX by merging screens")
 */
function isProposalLine(line: string): boolean {
  const normalized = normalizeForProposal(line);

  // Check if line starts with a proposal verb
  for (const verb of PROPOSAL_VERBS_IDEA_ONLY) {
    const regex = new RegExp(`^${verb}\\b`, 'i');
    if (regex.test(normalized)) {
      return true;
    }
  }

  // Check for "by <verb+ing>" pattern
  // Common patterns: "by merging", "by reducing", "by consolidating"
  const byVerbIngPattern = /\bby\s+(\w+ing)\b/i;
  const match = normalized.match(byVerbIngPattern);
  if (match) {
    // Extract the base verb from the gerund (e.g., "merging" -> "merge")
    const gerund = match[1].toLowerCase();
    for (const verb of PROPOSAL_VERBS_IDEA_ONLY) {
      // Check if gerund starts with the verb stem (handles "reducing" -> "reduce")
      if (gerund.startsWith(verb)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Friction markers that indicate clicks/steps complaints
 */
const FRICTION_MARKERS = [
  /\bclicks?\b/i,
  /\b(?:too\s+many|number\s+of)\s+steps?\b/i,
  /\bfriction\b/i,
  /\btakes?\s+too\s+long\b/i,
  /\b(?:difficult|hard)\s+to\b/i,
  /\bburden(?:some)?\b/i,
  /\bcumbersome\b/i,
];

/**
 * Target object patterns for friction complaints
 */
const FRICTION_TARGET_PATTERNS = [
  /\battestation(?:s)?\b/i,
  /\bworkflow(?:s)?\b/i,
  /\bflow(?:s)?\b/i,
  /\bprocess(?:es)?\b/i,
  /\bcompletion\b/i,
];

/**
 * Detect if section is primarily a friction/clicks complaint
 * Returns the friction type ('clicks', 'steps', or 'generic') and target object if detected
 */
function detectFrictionComplaint(text: string): { frictionType: string; target: string } | null {
  const lowerText = text.toLowerCase();

  // Check for friction markers
  let frictionType: string | null = null;
  for (const marker of FRICTION_MARKERS) {
    if (marker.test(lowerText)) {
      if (/\bclicks?\b/i.test(lowerText)) {
        frictionType = 'clicks';
      } else if (/\bsteps?\b/i.test(lowerText)) {
        frictionType = 'steps';
      } else {
        frictionType = 'generic';
      }
      break;
    }
  }

  if (!frictionType) return null;

  // Check for target object
  for (const pattern of FRICTION_TARGET_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      return { frictionType, target: match[0] };
    }
  }

  return null;
}

/**
 * Generate solution-shaped body for friction complaints
 */
function generateFrictionSolution(frictionType: string, target: string): string {
  // Normalize target (keep original case)
  const normalizedTarget = target.trim();

  if (frictionType === 'clicks') {
    return `Reduce clicks required to ${normalizedTarget.toLowerCase()}.`;
  } else if (frictionType === 'steps') {
    return `Reduce steps required to ${normalizedTarget.toLowerCase()}.`;
  } else {
    return `Streamline ${normalizedTarget.toLowerCase()} to improve usability.`;
  }
}

/**
 * Generate standalone body for idea suggestions
 * Format: problem → proposed change → purpose (if present)
 * Prefers proposal lines (with proposal verbs or "by <verb+ing>") when available
 */
function generateIdeaBody(section: ClassifiedSection): string {
  const bodyText = section.raw_text;
  const parts: string[] = [];

  // PROPOSAL-FIRST HEURISTIC: Check for proposal lines first
  const lines = bodyText.split(/[.!?\n]+/).map(s => s.trim()).filter(s => s.length > 10);
  const proposalLines = lines.filter(isProposalLine);

  if (proposalLines.length > 0) {
    // Found proposal line(s) - use the first one as primary
    parts.push(capitalizeFirst(proposalLines[0]));

    // If we have multiple proposal lines, include a second one if space allows
    if (proposalLines.length > 1) {
      parts.push(capitalizeFirst(proposalLines[1]));
    } else {
      // Look for problem/context statement to pair with the proposal
      const nonProposalLines = lines.filter(l => !isProposalLine(l) && l.length > 20);
      if (nonProposalLines.length > 0) {
        // Add problem context if the proposal line doesn't already include it
        const firstProposal = proposalLines[0].toLowerCase();
        const firstContext = nonProposalLines[0].toLowerCase();
        if (!firstProposal.includes(firstContext.substring(0, 30))) {
          parts.push(capitalizeFirst(nonProposalLines[0]));
        }
      }
    }
  } else {
    // FRICTION COMPLAINT HEURISTIC: Check for friction/clicks complaints
    const frictionComplaint = detectFrictionComplaint(bodyText);
    if (frictionComplaint) {
      // Generate solution-shaped body for friction complaint
      const solutionBody = generateFrictionSolution(
        frictionComplaint.frictionType,
        frictionComplaint.target
      );
      parts.push(solutionBody);

      // Optionally add problem context if available (stripped of bullet markers)
      const contextLines = lines
        .map(l => normalizeForProposal(l)) // Strip bullet markers
        .filter(l => l.length > 20);

      if (contextLines.length > 0 && parts.length < 2) {
        // Add first contextual line that's not just repeating the solution
        const firstContext = contextLines[0];
        if (!firstContext.toLowerCase().startsWith('reduce') &&
            !firstContext.toLowerCase().startsWith('streamline')) {
          parts.push(capitalizeFirst(firstContext));
        }
      }

      // EARLY RETURN: friction path is complete, skip all fallback extraction
      // Build body and return directly
      let body = parts.join('. ').trim();
      // Clean up any double punctuation that might have been introduced
      body = body.replace(/\.\s*\./g, '.').replace(/\s+\./g, '.');
      if (!body.endsWith('.')) body += '.';

      // Truncate if needed
      if (body.length > 300) {
        body = body.substring(0, 297) + '...';
      }

      return body || 'New initiative proposed in section.';
    } else {
      // No proposal lines or friction complaint - fall back to existing pattern-based extraction

      // Extract problem statement
      const problemPatterns = [
        /\b(problem|issue|challenge|pain\s+point)\s*(?::|is|involves?)\s*([^.!?\n]{10,150})/i,
        /\b(currently|today|right\s+now)\s+([^.!?\n]{10,150})/i,
      ];

      for (const pattern of problemPatterns) {
        const match = bodyText.match(pattern);
        if (match && match[2]) {
          parts.push(capitalizeFirst(match[2].trim()));
          break;
        }
      }

      // Extract proposed change/solution
      // Include common imperative verbs that introduce actions
      const solutionPatterns = [
        /\b(add|remove|update|change|introduce|show|hide|rename|move|split|merge|track|instrument|alert|surface|display|log|notify|create|implement|fix|launch|build|develop)\s+(?:a\s+|an\s+|the\s+)?([^.!?\n]{10,150})/i,
        /\b(solution|approach|idea)\s*(?::|is|would\s+be)\s*([^.!?\n]{10,150})/i,
      ];

      for (const pattern of solutionPatterns) {
        const match = bodyText.match(pattern);
        if (match && match[2]) {
          const verb = match[1].toLowerCase();
          const solution = match[2].trim();
          // For imperative verbs (launch, build, create, etc.), include the verb
          if (IMPERATIVE_VERBS.includes(verb)) {
            parts.push(capitalizeFirst(verb + ' ' + solution));
          } else {
            parts.push(capitalizeFirst(solution));
          }
          break;
        }
      }
    }
  }

  // Extract purpose/goal if present (only for non-friction paths)
  const purposePatterns = [
    /\b(goal|purpose|objective|to)\s+(?:is\s+)?(?:to\s+)?([^.!?\n]{10,100})/i,
    /\b(enable|allow|help)\s+(?:us\s+to\s+)?([^.!?\n]{10,100})/i,
  ];

  for (const pattern of purposePatterns) {
    const match = bodyText.match(pattern);
    if (match && match[2]) {
      parts.push(capitalizeFirst(match[2].trim()));
      break;
    }
  }

  // Fallback: extract meaningful sentences, prioritizing imperatives
  if (parts.length === 0) {
    const sentences = bodyText
      .split(/[.!?]+/)
      .map(s => s.trim())
      .filter(s => s.length > 20 && s.length < 200);

    // Separate imperative and non-imperative sentences
    const imperatives = sentences.filter(isImperativeSentence);
    const nonImperatives = sentences.filter(s => !isImperativeSentence(s));

    // Prioritize including at least one imperative if present
    if (imperatives.length > 0) {
      // If we have imperatives, include first non-imperative + imperative
      if (nonImperatives.length > 0) {
        parts.push(nonImperatives[0]);
        parts.push(imperatives[0]);
      } else {
        // Only imperatives available
        parts.push(...imperatives.slice(0, 2));
      }
    } else {
      // No imperatives, use first sentences
      parts.push(...sentences.slice(0, 2));
    }
  } else if (parts.length === 1) {
    // If we only extracted one part (e.g., problem), check for imperative
    const sentences = bodyText
      .split(/[.!?]+/)
      .map(s => s.trim())
      .filter(s => s.length > 20 && s.length < 200);

    const imperatives = sentences.filter(isImperativeSentence);
    if (imperatives.length > 0) {
      parts.push(imperatives[0]);
    }
  }

  // Build body with max 300 characters
  let body = parts.join('. ').trim();
  // Clean up any double punctuation (in case parts already had trailing periods)
  body = body.replace(/\.\s*\./g, '.').replace(/\s+\./g, '.');
  if (!body.endsWith('.')) body += '.';

  // Truncate if needed
  if (body.length > 300) {
    body = body.substring(0, 297) + '...';
  }

  return body || 'New initiative proposed in section.';
}

/**
 * Generate standalone body for project_update suggestions
 * Format: what changed → why → timing (if present)
 */
function generateProjectUpdateBody(section: ClassifiedSection): string {
  const bodyText = section.raw_text;
  const parts: string[] = [];

  // Extract what changed
  const changePatterns = [
    /\b(shift|pivot|refocus|change|adjust|narrow|expand)\s+(?:to|towards?|the\s+)?([^.!?\n]{10,150})/i,
    /\b(now|moving|transitioning)\s+(?:to|towards?)\s+([^.!?\n]{10,150})/i,
    /\b(from\s+.{5,50}\s+to\s+[^.!?\n]{5,150})/i,
  ];

  for (const pattern of changePatterns) {
    const match = bodyText.match(pattern);
    if (match) {
      const change = match[2] || match[1];
      if (change && change.length >= 10) {
        parts.push(capitalizeFirst(change.trim()));
        break;
      }
    }
  }

  // Extract why/reason
  const reasonPatterns = [
    /\b(because|since|due\s+to|reason)\s+([^.!?\n]{10,150})/i,
    /\b(to\s+better|in\s+order\s+to|so\s+that)\s+([^.!?\n]{10,150})/i,
  ];

  for (const pattern of reasonPatterns) {
    const match = bodyText.match(pattern);
    if (match && match[2]) {
      parts.push(capitalizeFirst(match[2].trim()));
      break;
    }
  }

  // Extract timing if present
  const timingPatterns = [
    /\b(by\s+Q[1-4]|by\s+\w+\s+\d{4}|this\s+quarter|next\s+quarter)\b/i,
    /\b(target|timeline|deadline)\s*(?::|is)\s*([^.!?\n]{5,100})/i,
  ];

  for (const pattern of timingPatterns) {
    const match = bodyText.match(pattern);
    if (match) {
      const timing = match[2] || match[0];
      parts.push(capitalizeFirst(timing.trim()));
      break;
    }
  }

  // Fallback: extract first meaningful sentences or bullets
  if (parts.length === 0) {
    const sentences = bodyText
      .split(/[.!?]+/)
      .map(s => s.trim())
      .filter(s => s.length > 20 && s.length < 200);
    parts.push(...sentences.slice(0, 2));
  }

  // Build body with max 300 characters
  let body = parts.join('. ').trim();
  if (!body.endsWith('.')) body += '.';

  // Truncate if needed
  if (body.length > 300) {
    body = body.substring(0, 297) + '...';
  }

  return body || 'Project scope and focus updated.';
}

/**
 * Role assignment patterns for body extraction
 * Matches "ROLE to VERB" task assignment lines
 */
const ROLE_ASSIGNMENT_PATTERNS = [
  /\bpm to\b/i,
  /\bcs to\b/i,
  /\beng to\b/i,
  /\bdesign(?:er)? to\b/i,
  /\bproject manager to\b/i,
  /\bproduct manager to\b/i,
  /\bengineering to\b/i,
  /\bcustomer success to\b/i,
];

/**
 * Check if a line contains a role assignment pattern
 */
function isRoleAssignmentLine(text: string): boolean {
  const normalized = normalizeForComparison(text);
  return ROLE_ASSIGNMENT_PATTERNS.some(pattern => pattern.test(normalized));
}

/**
 * Generate body for role assignment sections
 * Extracts top 2-3 task assignment lines (e.g., "PM to document...", "CS to manage...")
 */
function generateRoleAssignmentBody(section: ClassifiedSection): string {
  const bodyText = section.raw_text;
  const lines = bodyText.split(/[\n]/).map(l => l.trim()).filter(l => l.length > 10);

  // Find lines with role assignments
  const roleAssignmentLines: string[] = [];
  for (const line of lines) {
    // Strip bullet markers if present
    const cleanLine = line.replace(/^[-*•]\s+/, '').trim();
    if (isRoleAssignmentLine(cleanLine)) {
      roleAssignmentLines.push(cleanLine);
    }
  }

  // Take top 2-3 role assignment lines
  const selectedLines = roleAssignmentLines.slice(0, 3);

  if (selectedLines.length === 0) {
    // Fallback: shouldn't happen since flag was set, but handle gracefully
    // Extract first meaningful sentences
    const sentences = bodyText
      .split(/[.!?]+/)
      .map(s => s.trim())
      .filter(s => s.length > 20 && s.length < 200);
    return sentences.slice(0, 2).join('. ').trim() + '.' || 'Action items defined.';
  }

  // Build body from selected lines, stripping trailing punctuation before joining
  const normalizedLines = selectedLines.map(line => {
    const capitalized = capitalizeFirst(line);
    // Strip trailing punctuation (., ;, :) but keep ?/!
    return capitalized.replace(/[.;:]+\s*$/, '').trim();
  });

  let body = normalizedLines.join('. ').trim();
  if (!body.endsWith('.')) body += '.';

  // Truncate if needed
  if (body.length > 300) {
    body = body.substring(0, 297) + '...';
  }

  return body;
}

/**
 * Extract evidence previews from evidence spans
 * Returns 1-2 short quotes (max 150 chars each)
 * Prioritizes imperative sentences when present
 */
function extractEvidencePreviews(evidenceSpans: EvidenceSpan[]): string[] | undefined {
  if (!evidenceSpans || evidenceSpans.length === 0) {
    return undefined;
  }

  const previews: string[] = [];

  for (const span of evidenceSpans.slice(0, 2)) {
    if (span.text) {
      const text = span.text.trim();
      const sentences = text.split(/[.!?\n]/).map(s => s.trim()).filter(s => s.length > 20);

      // Check for imperative sentences in this span
      const imperatives = sentences.filter(isImperativeSentence);

      let preview: string;
      if (imperatives.length > 0) {
        // Include both problem context and action if possible
        if (sentences.length > 1 && imperatives[0] !== sentences[0]) {
          // First sentence is non-imperative, combine with imperative
          preview = sentences[0] + '. ' + imperatives[0];
        } else {
          // Just use the imperative
          preview = imperatives[0];
        }
      } else {
        // No imperatives, use first sentence
        preview = sentences[0] || text;
      }

      // Truncate to 150 characters
      if (preview.length > 150) {
        preview = preview.substring(0, 147) + '...';
      }

      if (preview.length > 20) {
        previews.push(preview);
      }
    }
  }

  return previews.length > 0 ? previews : undefined;
}

// ============================================
// Evidence Extraction
// ============================================

/**
 * Extract evidence spans from section
 * For idea type: prioritizes proposal lines over complaint/problem lines
 */
function extractEvidenceSpans(
  section: ClassifiedSection,
  type: SuggestionType
): EvidenceSpan[] {
  const spans: EvidenceSpan[] = [];
  const bodyLines = section.body_lines;

  // Find most relevant lines based on type
  const relevantLines: Line[] = [];

  // PROPOSAL-FIRST HEURISTIC: For idea type, prefer proposal lines
  if (type === 'idea') {
    // Find lines that are proposals
    const proposalLineObjs = bodyLines.filter((l) =>
      l.text.trim().length > 10 && isProposalLine(l.text)
    );

    if (proposalLineObjs.length > 0) {
      // Found proposal lines - use them as primary evidence
      relevantLines.push(...proposalLineObjs.slice(0, 2));

      // Add context lines (non-proposal) if we have room and they add value
      if (relevantLines.length < 2) {
        const contextLines = bodyLines.filter(
          (l) => l.text.trim().length > 20 && !isProposalLine(l.text)
        );
        relevantLines.push(...contextLines.slice(0, 2 - relevantLines.length));
      }

      // Skip to span grouping
      // (fall through to span creation logic below)
    } else {
      // No proposal lines found - fall back to default logic
      // Prioritize list items as they often contain key decisions
      const listItems = bodyLines.filter((l) => l.line_type === 'list_item');
      if (listItems.length > 0) {
        relevantLines.push(...listItems.slice(0, 3));
      }

      // Add non-blank paragraph lines if needed
      if (relevantLines.length < 2) {
        const paragraphLines = bodyLines.filter(
          (l) => l.line_type === 'paragraph' && l.text.trim().length > 20
        );
        relevantLines.push(...paragraphLines.slice(0, 3 - relevantLines.length));
      }
    }
  } else {
    // Non-idea types use existing logic
    // Prioritize list items as they often contain key decisions
    const listItems = bodyLines.filter((l) => l.line_type === 'list_item');
    if (listItems.length > 0) {
      relevantLines.push(...listItems.slice(0, 3));
    }

    // Add non-blank paragraph lines if needed
    if (relevantLines.length < 2) {
      const paragraphLines = bodyLines.filter(
        (l) => l.line_type === 'paragraph' && l.text.trim().length > 20
      );
      relevantLines.push(...paragraphLines.slice(0, 3 - relevantLines.length));
    }
  }

  // Sort by line index
  relevantLines.sort((a, b) => a.index - b.index);

  // Group contiguous lines into spans
  if (relevantLines.length > 0) {
    let currentSpan: Line[] = [relevantLines[0]];

    for (let i = 1; i < relevantLines.length; i++) {
      const line = relevantLines[i];
      const prevLine = currentSpan[currentSpan.length - 1];

      // If lines are adjacent or near-adjacent, merge
      if (line.index - prevLine.index <= 2) {
        currentSpan.push(line);
      } else {
        // Finalize current span and start new one
        spans.push(createSpan(currentSpan));
        currentSpan = [line];
      }
    }

    // Finalize last span
    if (currentSpan.length > 0) {
      spans.push(createSpan(currentSpan));
    }
  }

  // Ensure we have at least one span
  if (spans.length === 0 && bodyLines.length > 0) {
    // Use first few non-blank lines
    const nonBlankLines = bodyLines.filter(
      (l) => l.line_type !== 'blank' && l.text.trim().length > 0
    );
    if (nonBlankLines.length > 0) {
      spans.push(createSpan(nonBlankLines.slice(0, 3)));
    }
  }

  return spans;
}

function createSpan(lines: Line[]): EvidenceSpan {
  return {
    start_line: lines[0].index,
    end_line: lines[lines.length - 1].index,
    text: lines.map((l) => l.text).join('\n'),
  };
}

// ============================================
// Full Synthesis Pipeline
// ============================================

/**
 * Synthesize a suggestion from a classified section
 */
export function synthesizeSuggestion(section: ClassifiedSection): Suggestion | null {
  const type = section.suggested_type;
  if (!type || type === 'non_actionable') {
    return null;
  }

  // Generate title
  const title =
    type === 'project_update'
      ? generateProjectUpdateTitle(section)
      : generateIdeaTitle(section);

  // Generate payload
  let payload: SuggestionPayload;
  if (type === 'project_update') {
    payload = {
      after_description: generateAfterDescription(section),
    };
  } else {
    const draftInitiative = generateDraftInitiative(section, title);
    payload = {
      draft_initiative: draftInitiative,
    };
  }

  // Extract evidence spans
  const evidenceSpans = extractEvidenceSpans(section, type);

  // Initial scores (will be refined in scoring phase)
  const scores: SuggestionScores = {
    section_actionability: Math.max(
      section.intent.plan_change,
      section.intent.new_workstream
    ),
    type_choice_confidence: section.type_confidence || 0.5,
    synthesis_confidence: 0.7, // Default, refined later
    overall: 0, // Computed in scoring phase
  };

  // Default routing (refined in routing phase)
  const routing: SuggestionRouting = {
    create_new: true,
  };

  // Generate standalone context (additive)
  let body: string;
  if (section.intent.flags?.forceRoleAssignment) {
    // Role assignment sections use action items style body
    body = generateRoleAssignmentBody(section);
  } else if (type === 'project_update') {
    body = generateProjectUpdateBody(section);
  } else {
    body = generateIdeaBody(section);
  }

  const suggestionContext: SuggestionContext = {
    title,
    body,
    evidencePreview: extractEvidencePreviews(evidenceSpans),
    sourceSectionId: section.section_id,
    sourceHeading: section.heading_text || '',
  };

  // Compute stable suggestion key
  const suggestionKey = computeSuggestionKey({
    noteId: section.note_id,
    sourceSectionId: section.section_id,
    type,
    title,
  });

  return {
    suggestion_id: generateSuggestionId(section.note_id),
    note_id: section.note_id,
    section_id: section.section_id,
    type,
    title,
    payload,
    evidence_spans: evidenceSpans,
    scores,
    routing,
    suggestionKey,
    structural_hint: section.typeLabel,
    suggestion: suggestionContext,
  };
}

/**
 * Synthesize suggestions from all actionable sections
 */
export function synthesizeSuggestions(
  sections: ClassifiedSection[]
): Suggestion[] {
  const suggestions: Suggestion[] = [];

  for (const section of sections) {
    if (!section.is_actionable || !section.suggested_type) {
      continue;
    }

    const suggestion = synthesizeSuggestion(section);
    if (suggestion) {
      suggestions.push(suggestion);
    }
  }

  return suggestions;
}
