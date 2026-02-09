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
import { DropStage, DropReason } from './debugTypes';

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

/**
 * Export section-level suppression check for use in fallback candidate creation
 * IMPORTANT: This function NEVER throws - it wraps shouldSuppressSection in try-catch
 * to ensure suppression is a normal control-flow outcome, not an exception
 */
export function checkSectionSuppression(
  headingText: string,
  structuralFeatures: StructuralFeatures,
  rawText: string,
  hasForceRoleAssignment: boolean = false,
  bodyLines?: Line[]
): boolean {
  try {
    // Reconstruct full text from body_lines if available
    let fullText = rawText;
    if (bodyLines && bodyLines.length > 0) {
      fullText = bodyLines.map(l => l.text).join('\n');
    }
    return shouldSuppressSection(headingText, structuralFeatures, fullText, hasForceRoleAssignment);
  } catch (error) {
    // Suppression check failed - treat as NOT suppressed to avoid dropping valid content
    console.warn('[checkSectionSuppression] Error during suppression check:', error);
    return false;
  }
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
 * Generate title from impact line for project_update suggestions
 * Strips leading result phrases and truncates to 60 chars
 */
function generateTitleFromImpactLine(impactLine: string): string {
  // Strip list markers first
  let title = normalizeLineForSynthesis(impactLine);

  // Strip leading result phrases
  title = stripResultPhrases(title);

  // Capitalize first letter
  title = capitalizeFirst(title);

  // Truncate to 60 chars if needed
  if (title.length > 60) {
    title = truncateTitle(title, 60);
  }

  return title;
}

/**
 * Check if heading indicates a topic-isolated sub-section
 * Returns topic label if found, null otherwise
 */
function extractTopicLabel(headingText: string): string | null {
  // Check if heading matches pattern: "Parent: topic label"
  // E.g., "Meeting Notes > Discussion details: new feature requests"
  const parts = headingText.split(':');
  if (parts.length >= 2) {
    const potentialTopic = parts[parts.length - 1].trim().toLowerCase();
    // Check if it matches known topic anchors
    const knownTopics = ['new feature requests', 'project timelines', 'internal operations', 'cultural shift'];
    if (knownTopics.includes(potentialTopic)) {
      return parts[parts.length - 1].trim();
    }
  }
  return null;
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

  // Special case: topic-isolated sub-sections
  // Use first meaningful line as title base
  const topicLabel = extractTopicLabel(headingText);
  if (topicLabel) {
    // Extract first meaningful sentence from body for title
    const sentences = bodyText
      .split(/[.!?\n]+/)
      .map(s => normalizeLineForSynthesis(s.trim()))
      .filter(s => s.length > 10 && s.length < 100);

    if (sentences.length > 0) {
      // For "Project Timelines" with multiple project mentions, use first project as title
      let title = capitalizeFirst(sentences[0]);
      // Truncate if needed
      if (title.length > 70) {
        title = truncateTitle(title, 70);
      }
      return title;
    }
  }

  // IMPACT-FIRST: Check for impact lines (e.g., "slip by 2 sprints")
  const sentences = bodyText
    .split(/[.!?\n]+/)
    .map(s => s.trim())
    .filter(s => s.length > 20);

  const impactLines = sentences.filter(isPlanChangeImpactLine);

  if (impactLines.length > 0) {
    // Found impact line - use it for the title
    return generateTitleFromImpactLine(impactLines[0]);
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
  // Strip list markers preserving case
  let title = normalizeLineForSynthesis(proposalLine);

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
 * Normalize text for synthesis outputs (strip list markers, preserve case)
 * Use this for any text that will appear in synthesis outputs (body, title, evidence)
 */
function normalizeLineForSynthesis(text: string): string {
  let processed = text.trim();

  // Strip list markers at start of line
  processed = processed
    .replace(/^\s*[-*+•]\s+/, '')      // bullet markers
    .replace(/^\s*\d+[.)]\s+/, '');    // numbered list markers

  // Collapse whitespace
  return processed.replace(/\s+/g, ' ');
}

/**
 * Strip leading result phrases from text
 * Removes phrases like "As a result,", "Result:", "So", etc.
 */
function stripResultPhrases(text: string): string {
  let processed = text.trim();

  const resultPhrases = [
    /^as a result,?\s*/i,
    /^result:\s*/i,
    /^so,?\s*/i,
    /^therefore,?\s*/i,
    /^consequently,?\s*/i,
  ];

  for (const phrase of resultPhrases) {
    processed = processed.replace(phrase, '');
  }

  return processed.trim();
}

/**
 * Normalize text for proposal detection (lowercase, strip list markers)
 * Uses same preprocessing as classifiers for consistency
 */
function normalizeForProposal(text: string): string {
  // Use the synthesis normalizer, then lowercase
  return normalizeLineForSynthesis(text).toLowerCase();
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
    // Strip list markers before adding to parts
    parts.push(capitalizeFirst(normalizeLineForSynthesis(proposalLines[0])));

    // If we have multiple proposal lines, include a second one if space allows
    if (proposalLines.length > 1) {
      parts.push(capitalizeFirst(normalizeLineForSynthesis(proposalLines[1])));
    } else {
      // Look for problem/context statement to pair with the proposal
      const nonProposalLines = lines.filter(l => !isProposalLine(l) && l.length > 20);
      if (nonProposalLines.length > 0) {
        // Add problem context if the proposal line doesn't already include it
        const firstProposal = proposalLines[0].toLowerCase();
        const firstContext = nonProposalLines[0].toLowerCase();
        if (!firstProposal.includes(firstContext.substring(0, 30))) {
          parts.push(capitalizeFirst(normalizeLineForSynthesis(nonProposalLines[0])));
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
        .map(l => normalizeLineForSynthesis(l)) // Strip bullet markers
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
          parts.push(capitalizeFirst(normalizeLineForSynthesis(match[2].trim())));
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
          const solution = normalizeLineForSynthesis(match[2].trim());
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
      parts.push(capitalizeFirst(normalizeLineForSynthesis(match[2].trim())));
      break;
    }
  }

  // Fallback: extract meaningful sentences, prioritizing imperatives
  if (parts.length === 0) {
    const sentences = bodyText
      .split(/[.!?]+/)
      .map(s => normalizeLineForSynthesis(s.trim()))
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
      .map(s => normalizeLineForSynthesis(s.trim()))
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
 * Check if a line contains a plan change impact statement
 * Impact lines describe concrete schedule/scope changes with time deltas
 */
function isPlanChangeImpactLine(line: string): boolean {
  const normalized = line.toLowerCase();

  // Check for time-shift verbs (more flexible pattern)
  const hasTimeShiftVerb = /\b(slip|delay|push|move|shift|pull|bring)\b/i.test(normalized);

  if (!hasTimeShiftVerb) return false;

  // Check for time delta patterns
  const hasTimeDelta = /\b\d+\s+(sprint|week|month|day|quarter)s?\b/i.test(normalized);

  if (!hasTimeDelta) return false;

  // Check for subject tokens that indicate impact on deliverables/plans
  const hasSubject = /\b(deliverables?|releases?|rollouts?|launchs?|launches|self-service|roadmaps?|initiatives?|scopes?|features?|projects?|timelines?|milestones?)\b/i.test(normalized);

  return hasSubject;
}

/**
 * Generate standalone body for project_update suggestions
 * Format: what changed → why → timing (if present)
 * Prioritizes impact lines (e.g., "self-service deliverables will slip by 2 sprints")
 */
function generateProjectUpdateBody(section: ClassifiedSection): string {
  const bodyText = section.raw_text;
  const headingText = section.heading_text || '';
  const parts: string[] = [];

  // IMPACT-FIRST: Check for plan change impact lines
  const sentences = bodyText
    .split(/[.!?\n]+/)
    .map(s => s.trim())
    .filter(s => s.length > 20);

  const impactLines = sentences.filter(isPlanChangeImpactLine);

  if (impactLines.length > 0) {
    // Check if this is a topic-isolated sub-section with multiple updates
    const topicLabel = extractTopicLabel(headingText);
    const isTopicIsolated = topicLabel !== null;

    // For topic-isolated sections, include ALL meaningful sentences (up to 3) to capture multiple projects
    // This ensures we include both "slip" updates and "on track" statuses
    if (isTopicIsolated && sentences.length > 1) {
      // Use ALL sentences from the sub-section (they're already isolated by topic)
      const meaningfulSentences = sentences
        .slice(0, 3)
        .map(s => normalizeLineForSynthesis(s))
        .map(s => capitalizeFirst(stripResultPhrases(s)));
      parts.push(...meaningfulSentences);
    } else {
      // Single section or non-isolated: use first impact line only
      const normalizedImpact = normalizeLineForSynthesis(impactLines[0]);
      const cleanedImpact = stripResultPhrases(normalizedImpact);
      parts.push(capitalizeFirst(cleanedImpact));

      // Look for target/timeline to add as context
      const timingPatterns = [
        /\b(target|timeline|goal)\s+(?:is\s+)?(?:to\s+)?([^.!?\n]{10,100})/i,
        /\b(by\s+(?:early|mid|late)?\s*Q[1-4])/i,
        /\b(complete.*by\s+[^.!?\n]{5,50})/i,
      ];

      for (const pattern of timingPatterns) {
        const match = bodyText.match(pattern);
        if (match) {
          const timing = match[2] || match[1] || match[0];
          if (timing && timing.length >= 5) {
            parts.push(capitalizeFirst(normalizeLineForSynthesis(timing.trim())));
            break;
          }
        }
      }
    }

    // Build body and return early (skip fallback logic)
    let body = parts.join('. ').trim();
    if (!body.endsWith('.')) body += '.';

    // Truncate if needed
    if (body.length > 300) {
      body = body.substring(0, 297) + '...';
    }

    return body;
  }

  // FALLBACK: No impact line found, use existing extraction logic
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
        parts.push(capitalizeFirst(normalizeLineForSynthesis(change.trim())));
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
      parts.push(capitalizeFirst(normalizeLineForSynthesis(match[2].trim())));
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
      parts.push(capitalizeFirst(normalizeLineForSynthesis(timing.trim())));
      break;
    }
  }

  // Fallback: extract first meaningful sentences or bullets
  if (parts.length === 0) {
    const fallbackSentences = bodyText
      .split(/[.!?]+/)
      .map(s => normalizeLineForSynthesis(s.trim()))
      .filter(s => s.length > 20 && s.length < 200);
    parts.push(...fallbackSentences.slice(0, 2));
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
    // Strip bullet markers if present using synthesis normalizer
    const cleanLine = normalizeLineForSynthesis(line);
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
 * Strips list markers from all preview text
 */
function extractEvidencePreviews(evidenceSpans: EvidenceSpan[]): string[] | undefined {
  if (!evidenceSpans || evidenceSpans.length === 0) {
    return undefined;
  }

  const previews: string[] = [];

  for (const span of evidenceSpans.slice(0, 2)) {
    if (span.text) {
      const text = span.text.trim();
      // Strip list markers from each sentence
      const sentences = text
        .split(/[.!?\n]/)
        .map(s => normalizeLineForSynthesis(s.trim()))
        .filter(s => s.length > 20);

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

      // Strip result phrases from preview
      preview = stripResultPhrases(preview);

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
 * For project_update type: prioritizes impact lines (schedule/scope changes)
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
  } else if (type === 'project_update') {
    // IMPACT-FIRST HEURISTIC: For project_update type, prefer impact lines
    const impactLineObjs = bodyLines.filter((l) =>
      l.text.trim().length > 20 && isPlanChangeImpactLine(l.text)
    );

    if (impactLineObjs.length > 0) {
      // Found impact lines - use them as primary evidence
      relevantLines.push(...impactLineObjs.slice(0, 2));

      // Add target/timeline context if we have room
      if (relevantLines.length < 2) {
        // Look for lines with target/timeline keywords
        const targetLines = bodyLines.filter(
          (l) => l.text.trim().length > 20 &&
                 !isPlanChangeImpactLine(l.text) &&
                 /\b(target|timeline|goal|complete|by\s+(?:early|mid|late)?\s*Q[1-4])\b/i.test(l.text)
        );
        relevantLines.push(...targetLines.slice(0, 2 - relevantLines.length));
      }

      // Skip to span grouping
      // (fall through to span creation logic below)
    } else {
      // No impact lines - fall back to default logic
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
    // Non-idea/non-project_update types use existing logic
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
// Derivative Content Suppression
// ============================================

/**
 * Normalize text for derivative content detection
 * Removes punctuation, collapses whitespace, lowercases
 */
function normalizeForDerivativeCheck(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, '') // Remove punctuation
    .replace(/\s+/g, ' ')     // Collapse whitespace
    .trim();
}

/**
 * Compute overlap ratio between section text and emitted evidence
 * Returns a ratio [0, 1] representing how much of the section appears in emitted evidence
 */
function computeOverlapRatio(sectionText: string, emittedEvidenceTexts: string[]): number {
  if (emittedEvidenceTexts.length === 0) return 0;

  const normalizedSection = normalizeForDerivativeCheck(sectionText);
  const sectionWords = normalizedSection.split(/\s+/).filter(w => w.length > 3);

  if (sectionWords.length === 0) return 0;

  // Build combined evidence text
  const combinedEvidence = normalizeForDerivativeCheck(emittedEvidenceTexts.join(' '));
  const evidenceSet = new Set(combinedEvidence.split(/\s+/).filter(w => w.length > 3));

  // Count how many section words appear in evidence
  let matchCount = 0;
  for (const word of sectionWords) {
    if (evidenceSet.has(word)) {
      matchCount++;
    }
  }

  return matchCount / sectionWords.length;
}

/**
 * Check if a section is derivative (mostly redundant with already-emitted content)
 * Returns true if overlap >= 70%
 */
function isDerivativeSection(
  section: ClassifiedSection,
  emittedEvidenceTexts: string[]
): boolean {
  const DERIVATIVE_THRESHOLD = 0.70;
  const overlapRatio = computeOverlapRatio(section.raw_text, emittedEvidenceTexts);
  return overlapRatio >= DERIVATIVE_THRESHOLD;
}

/**
 * Check if heading indicates a summary/overview/recap section
 */
function isSummaryHeading(headingText?: string): boolean {
  if (!headingText) return false;
  const normalized = headingText.toLowerCase().trim();
  const summaryHeadings = ['summary', 'overview', 'tl;dr', 'tldr', 'recap', 'key takeaways'];
  return summaryHeadings.some(h => normalized === h || normalized.startsWith(h + ':'));
}

// ============================================
// Explicit Request Detection (B-lite Fix)
// ============================================

/**
 * Explicit request patterns that indicate actionable asks
 * Used for Discussion details sections with fallbackSkipped
 */
const EXPLICIT_REQUEST_PATTERNS = [
  /\basksfor\b/i,
  /\basks?\s+for\b/i,
  /\brequest(?:s|ed)?\b/i,
  /\bwould\s+like\b/i,
  /\bneed(?:s)?\s+to\b/i,
  /\bneed(?:s)?\s+(?:a|an|the)\b/i,
  /\bwant(?:s)?\s+to\b/i,
  /\bwant(?:s)?\s+(?:a|an|the)\b/i,
];

/**
 * Check if text contains explicit request language
 * Exported for use in debugGenerator fallback path
 */
export function containsExplicitRequest(text: string): boolean {
  return EXPLICIT_REQUEST_PATTERNS.some(pattern => pattern.test(text));
}

/**
 * Check if section is a Discussion details section with explicit requests
 * Returns true only if ALL conditions met:
 * - Heading contains "Discussion details"
 * - hasTopicAnchors === false (no extractable topic anchors)
 * - Section text contains explicit request language
 */
function isDiscussionDetailsWithExplicitAsk(
  headingText: string,
  bodyLines: Line[],
  rawText: string
): boolean {
  // Extract leaf heading (handle hierarchical paths)
  const leafHeading = headingText.split('>').pop()?.trim() || '';
  const normalizedLeaf = leafHeading.toLowerCase().trim();
  const leafWithoutEmoji = normalizedLeaf.replace(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu, '').trim();

  // Check if heading contains "Discussion details"
  const discussionHeadings = ['discussion details', 'discussion', 'details'];
  const isDiscussionDetails = discussionHeadings.some(h =>
    leafWithoutEmoji === h ||
    normalizedLeaf === h ||
    leafWithoutEmoji.startsWith(h + ':') ||
    normalizedLeaf.startsWith(h + ':')
  );

  if (!isDiscussionDetails) return false;

  // Check hasTopicAnchors === false (using same logic as shouldSplitByTopic)
  const hasTopicAnchors = hasExtractableTopicAnchors(bodyLines);
  if (hasTopicAnchors) return false;

  // Check for explicit request language in section text
  return containsExplicitRequest(rawText);
}

/**
 * Extract first explicit ask from section text for new_feature suggestion
 * Returns the line/sentence containing the explicit request
 * Exported for use in debugGenerator fallback path
 */
export function extractExplicitAsk(text: string): string | null {
  const lines = text.split(/[\n]/);

  // Find first line with explicit request
  for (const line of lines) {
    if (containsExplicitRequest(line) && line.trim().length > 20) {
      // Strip list markers and return
      return normalizeLineForSynthesis(line.trim());
    }
  }

  // Fallback: find first sentence with explicit request
  const sentences = text.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 10);
  for (const sentence of sentences) {
    if (containsExplicitRequest(sentence)) {
      return normalizeLineForSynthesis(sentence);
    }
  }

  return null;
}

/**
 * Generate title from explicit ask text
 * Extracts the main ask after request markers like "asks for", "request", etc.
 * Exported for use in debugGenerator fallback path
 */
export function generateTitleFromExplicitAsk(askText: string): string {
  let title = askText;

  // Try to extract the core ask after request markers
  // Fixed pattern: properly match articles (a|an|the) followed by space as a unit
  const requestMarkerPatterns = [
    /asks?\s+for\s+(?:(?:a|an|the)\s+)?(.+)/i,
    /requests?\s+(?:(?:a|an|the)\s+)?(.+)/i,
    /would\s+like\s+(?:(?:a|an|the)\s+)?(.+)/i,
    /needs?\s+(?:to\s+)?(?:(?:a|an|the)\s+)?(.+)/i,
    /wants?\s+(?:to\s+)?(?:(?:a|an|the)\s+)?(.+)/i,
  ];

  for (const pattern of requestMarkerPatterns) {
    const match = askText.match(pattern);
    if (match && match[1]) {
      title = match[1].trim();
      break;
    }
  }

  // Stop at contextual clauses (but, however, noted, etc.) or sentence breaks
  // IMPORTANT: Check sentence break (period) FIRST before checking contextual clauses
  // so we don't accidentally include trailing text like ". Leo" when there's ". Leo noted"
  const contextualBreaks = [
    /\./,  // sentence break (check first!)
    /\s+but\s+/i,
    /\s+however\s+/i,
    /\s+noted\s+/i,
    /\s+said\s+/i,
    /\s+mentioned\s+/i,
    /\s+explained\s+/i,
  ];

  for (const breakPattern of contextualBreaks) {
    const match = title.match(breakPattern);
    if (match) {
      // Take text before the contextual break
      title = title.substring(0, match.index).trim();
      break;
    }
  }

  // Capitalize first letter
  title = capitalizeFirst(title);

  // Truncate if needed
  if (title.length > 80) {
    title = truncateTitle(title, 80);
  }

  // Ensure title is not just the heading
  if (title.length < 10) {
    title = capitalizeFirst(askText);
    // Apply same contextual break logic to fallback
    for (const breakPattern of contextualBreaks) {
      const match = title.match(breakPattern);
      if (match) {
        title = title.substring(0, match.index).trim();
        break;
      }
    }
    if (title.length > 80) {
      title = truncateTitle(title, 80);
    }
  }

  return title;
}

// ============================================
// Decision Table Normalization
// ============================================

/**
 * Status markers commonly found in decision tables
 */
const STATUS_MARKERS = [
  /\baligned\b/i,
  /\bneeds discussion\b/i,
  /\bpending\b/i,
  /\bin progress\b/i,
  /\bcompleted?\b/i,
  /\bapproved\b/i,
  /\brejected\b/i,
  /\bblocked\b/i,
];

/**
 * Detect if text contains a status marker
 */
function containsStatusMarker(text: string): boolean {
  return STATUS_MARKERS.some(pattern => pattern.test(text));
}

/**
 * Strip status markers from text
 * Returns cleaned text with status markers removed
 */
function stripStatusMarkers(text: string): string {
  let cleaned = text;
  for (const pattern of STATUS_MARKERS) {
    cleaned = cleaned.replace(pattern, '');
  }
  // Clean up extra whitespace/punctuation left behind
  return cleaned.replace(/\s+/g, ' ').replace(/[,;:]\s*$/, '').trim();
}

/**
 * Extract decision from a line (first column before status marker)
 * For table rows like "Decision | Status", extracts "Decision"
 */
function extractDecisionStatement(text: string): string {
  // Strip list markers first
  let cleaned = normalizeLineForSynthesis(text);

  // Check for table separator (| or multiple spaces/tabs)
  const tableSeparators = [/\s*\|\s*/, /\s{3,}/, /\t+/];

  for (const separator of tableSeparators) {
    const parts = cleaned.split(separator);
    if (parts.length >= 2) {
      // Take first column, strip status markers
      const firstCol = parts[0].trim();
      if (firstCol.length > 10) {
        return stripStatusMarkers(firstCol);
      }
    }
  }

  // No table structure detected, strip status markers from full text
  return stripStatusMarkers(cleaned);
}

/**
 * Check if two decision statements are near-duplicates
 * Uses normalized text comparison
 */
function areDecisionsDuplicate(decision1: string, decision2: string): boolean {
  const norm1 = normalizeForDerivativeCheck(decision1);
  const norm2 = normalizeForDerivativeCheck(decision2);

  // Exact match after normalization
  if (norm1 === norm2) return true;

  // Check if one is substring of the other (very similar decisions)
  if (norm1.length > 0 && norm2.length > 0) {
    const longer = norm1.length > norm2.length ? norm1 : norm2;
    const shorter = norm1.length > norm2.length ? norm2 : norm1;
    if (longer.includes(shorter) && shorter.length >= 15) {
      return true;
    }
  }

  return false;
}

// ============================================
// Post-Synthesis Suppression
// ============================================

/**
 * Extract leaf heading from hierarchical heading path
 * E.g., "Project Planning > 🚀 Next steps" -> "🚀 Next steps"
 */
function extractLeafHeading(headingText: string): string {
  const parts = headingText.split('>');
  return parts[parts.length - 1].trim();
}


/**
 * Check if a section should be suppressed (section-level check)
 * Used for both synthesized and fallback candidates
 * IMPORTANT: Does NOT suppress sections with forceRoleAssignment flag
 * IMPORTANT: This function NEVER throws - all errors are caught and logged
 */
function shouldSuppressSection(
  headingText: string,
  structuralFeatures: StructuralFeatures,
  rawText: string,
  hasForceRoleAssignment: boolean = false
): boolean {
  try {
    // Never suppress sections with forceRoleAssignment flag (role assignment takes precedence)
    if (hasForceRoleAssignment) {
      return false;
    }

    // Extract leaf heading (handle hierarchical paths like "Parent > Child")
    const leafHeading = extractLeafHeading(headingText);
    const normalizedHeading = leafHeading.toLowerCase().trim();
    // Remove emojis from normalized heading for comparison
    const headingWithoutEmoji = normalizedHeading.replace(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu, '').trim();

    // A) Next steps suppression (explicit, but only for generic/non-actionable next steps)
    const nextStepsHeadings = [
      'next steps',
      'action items',
      'follow-ups',
      'followups',
      'to do',
      'todo',
    ];
    if (nextStepsHeadings.some(h => headingWithoutEmoji === h || normalizedHeading === h)) {
      return true;
    }

    // B) Summary/recap suppression (explicit, including emoji headings)
    const summaryKeywords = ['summary', 'overview', 'tl;dr', 'tldr', 'recap'];
    // Check if heading contains summary keywords (with or without emoji)
    if (summaryKeywords.some(kw => headingWithoutEmoji.includes(kw) || normalizedHeading.includes(kw))) {
      return true;
    }

    return false;
  } catch (error) {
    // Suppression check failed - treat as NOT suppressed to avoid dropping valid content
    console.warn('[shouldSuppressSection] Error during suppression check:', error);
    return false;
  }
}

/**
 * Check if candidate should be suppressed based on strategic relevance
 * Post-synthesis suppression for low-value candidates
 */
function shouldSuppressCandidate(candidate: Suggestion, section: ClassifiedSection): boolean {
  const headingText = section.heading_text?.trim() || '';
  const normalizedBody = normalizeForComparison(candidate.suggestion?.body || '');
  const hasForceRoleAssignment = section.intent.flags?.forceRoleAssignment || false;

  // First check section-level suppression
  // Reconstruct full text from body_lines to ensure we have all content
  const fullText = section.body_lines.map(l => l.text).join('\n');
  if (shouldSuppressSection(headingText, section.structural_features, fullText, hasForceRoleAssignment)) {
    return true;
  }

  // C) Low-impact internal culture / naming conventions
  const cultureMarkers = [
    'naming convention',
    'server naming',
    'rename',
    'meeting-free',
    'wednesdays',
    'wednesday',
    'ritual',
    'culture shift',
    'avoid confusion',
  ];

  const hasCultureMarker = cultureMarkers.some(marker => normalizedBody.includes(marker));

  if (hasCultureMarker) {
    // Check for hard delivery signals
    const hasProjectName = /\bproject\s+\w+\b/i.test(normalizedBody);
    const hasNumericDelta = /\b\d+\s+(day|week|sprint|month)s?\b/i.test(normalizedBody);
    const hasDateReference = /\b\d{4}-\d{2}-\d{2}\b|Q[1-4]\b/i.test(normalizedBody);
    const hasCustomerImpact = /\b(customer|beta|launch|release|public|external)\b/i.test(normalizedBody);

    const hasHardSignal = hasProjectName || hasNumericDelta || hasDateReference || hasCustomerImpact;

    // Suppress if culture marker present AND no hard delivery signal
    if (!hasHardSignal) {
      return true;
    }
  }

  return false;
}

// ============================================
// Topic Isolation for Mixed Sections
// ============================================

/**
 * Topic anchor labels for splitting mixed-topic sections
 */
const TOPIC_ANCHORS = [
  'new feature requests:',
  'project timelines:',
  'internal operations:',
  'cultural shift:',
];

/**
 * Check if section body contains topic anchors that are extractable
 * (i.e., anchors that appear at the start of lines, not just as substrings)
 *
 * IMPORTANT: This must use the SAME logic as splitSectionByTopic() to avoid
 * eligibility/execution disagreement
 */
function hasExtractableTopicAnchors(lines: Line[]): boolean {
  for (const line of lines) {
    const trimmedText = line.text.trim().toLowerCase();
    const matchedAnchor = TOPIC_ANCHORS.find(anchor => trimmedText.startsWith(anchor));
    if (matchedAnchor) {
      return true;
    }
  }
  return false;
}

/**
 * Debug information for topic isolation decision
 */
export interface TopicIsolationDebug {
  eligible: boolean;
  reason: 'heading_match' | 'bulletCount>=5' | 'charCount>=500' | 'no_topic_anchors' | 'none';
  leafHeadingUsed: string;
  bulletCountSeen: number;
  charCountSeen: number;
  hasTopicAnchors: boolean;
}

/**
 * Check if section should be split by topic
 * Exported for use in debugGenerator fallback logic
 *
 * @param section - The classified section to check
 * @param debugOut - Optional debug output object (only populated when enable_debug is true)
 */
export function shouldSplitByTopic(
  section: ClassifiedSection,
  debugOut?: { topicIsolation?: TopicIsolationDebug }
): boolean {
  const fullHeadingText = section.heading_text || '';
  // Extract leaf heading to check for discussion heading match
  const leafHeading = extractLeafHeading(fullHeadingText);
  const normalizedLeaf = leafHeading.toLowerCase().trim();
  // Remove emojis for heading comparison
  const leafWithoutEmoji = normalizedLeaf.replace(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu, '').trim();

  // Check for explicit "Discussion details" or similar headings
  const discussionHeadings = ['discussion details', 'discussion', 'details'];
  const hasDiscussionHeading = discussionHeadings.some(h =>
    leafWithoutEmoji === h ||
    normalizedLeaf === h ||
    leafWithoutEmoji.startsWith(h + ':') ||
    normalizedLeaf.startsWith(h + ':')
  );

  // Use canonical structural features (avoid recompute drift)
  // Fall back to local computation if structural_features is incomplete
  const bulletCountSeen = section.structural_features?.num_list_items ??
    section.body_lines.filter(l => l.line_type === 'list_item').length;
  const charCountSeen = section.raw_text.length;

  const isLongSection = bulletCountSeen >= 5 || charCountSeen >= 500;

  // Check for topic anchors in body using SAME logic as splitSectionByTopic
  // (line-start match, not substring match, to avoid eligibility/execution disagreement)
  const hasTopicAnchors = hasExtractableTopicAnchors(section.body_lines);

  // Determine eligibility and reason
  let eligible = false;
  let reason: TopicIsolationDebug['reason'] = 'none';

  if (hasDiscussionHeading || isLongSection) {
    if (hasTopicAnchors) {
      eligible = true;
      // Determine primary reason (prioritize heading match)
      if (hasDiscussionHeading) {
        reason = 'heading_match';
      } else if (bulletCountSeen >= 5) {
        reason = 'bulletCount>=5';
      } else if (charCountSeen >= 500) {
        reason = 'charCount>=500';
      }
    } else {
      // Split criteria met but no topic anchors
      reason = 'no_topic_anchors';
    }
  }

  // Populate debug output if provided
  if (debugOut) {
    debugOut.topicIsolation = {
      eligible,
      reason,
      leafHeadingUsed: leafHeading,
      bulletCountSeen,
      charCountSeen,
      hasTopicAnchors,
    };
  }

  return eligible;
}

/**
 * Debug information for topic splitting
 */
export interface TopicSplitDebug {
  topicsFound: string[];
  subSectionIds: string[];
}

/**
 * Split section into topic-based sub-blocks
 * Returns array of sub-sections with isolated content
 * Exported for use in debugGenerator fallback logic
 *
 * @param section - The classified section to split
 * @param debugOut - Optional debug output object (only populated when enable_debug is true)
 */
export function splitSectionByTopic(
  section: ClassifiedSection,
  debugOut?: { topicSplit?: TopicSplitDebug }
): ClassifiedSection[] {
  const lines = section.body_lines;
  const subSections: ClassifiedSection[] = [];
  const topicsFound: string[] = [];

  let currentTopicLabel: string | null = null;
  let currentBlockLines: Line[] = [];
  let subBlockIndex = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmedText = line.text.trim().toLowerCase();

    // Check if line starts with a topic anchor
    const matchedAnchor = TOPIC_ANCHORS.find(anchor => trimmedText.startsWith(anchor));

    if (matchedAnchor) {
      // Save previous block if it exists (only if we have a topic label)
      if (currentBlockLines.length > 0 && currentTopicLabel) {
        const subSection = createSubSection(section, currentTopicLabel, currentBlockLines, subBlockIndex);
        subSections.push(subSection);
        subBlockIndex++;
      }

      // Start new block
      currentTopicLabel = matchedAnchor.replace(':', '').trim();
      topicsFound.push(currentTopicLabel);
      currentBlockLines = [];
      // Don't include the anchor line itself in the block
      continue;
    }

    // Only add line to current block if we're inside a topic
    if (currentTopicLabel) {
      currentBlockLines.push(line);
    }
    // Skip lines before first anchor (they're not part of any topic block)
  }

  // Save final block (only if we have content and a topic label)
  if (currentBlockLines.length > 0 && currentTopicLabel) {
    const subSection = createSubSection(section, currentTopicLabel, currentBlockLines, subBlockIndex);
    subSections.push(subSection);
  }

  // Populate debug output if provided
  if (debugOut) {
    debugOut.topicSplit = {
      topicsFound,
      subSectionIds: subSections.map(s => s.section_id),
    };
  }

  // If no anchors found or no valid sub-sections, return original section
  if (subSections.length === 0) {
    return [section];
  }

  return subSections;
}

/**
 * Create a slug from topic label for fingerprint uniqueness
 */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Create a sub-section from a topic block
 */
function createSubSection(
  parentSection: ClassifiedSection,
  topicLabel: string,
  lines: Line[],
  index: number
): ClassifiedSection {
  const rawText = lines.map(l => l.text).join('\n');
  const slug = slugify(topicLabel);
  const parentHeading = parentSection.heading_text || '';

  return {
    ...parentSection,
    section_id: `${parentSection.section_id}__topic_${slug}__${index}`,
    heading_text: `${parentHeading}: ${topicLabel}`,
    body_lines: lines,
    raw_text: rawText,
    start_line: lines[0]?.index || parentSection.start_line,
    end_line: lines[lines.length - 1]?.index || parentSection.end_line,
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
 * with derivative content suppression, topic isolation, and post-synthesis suppression
 */
export function synthesizeSuggestions(
  sections: ClassifiedSection[]
): Suggestion[] {
  const suggestions: Suggestion[] = [];

  // Track emitted evidence texts for derivative detection
  const emittedEvidenceTexts: string[] = [];

  // Track emitted decisions for decision table deduplication
  const emittedDecisions: string[] = [];

  for (const section of sections) {
    if (!section.is_actionable || !section.suggested_type) {
      continue;
    }

    // B-LITE FIX: Check if this is a Discussion details section with explicit asks
    // These sections should emit at least one real suggestion, bypassing normal suppression
    const headingText = section.heading_text || '';
    const isExplicitAskSection = isDiscussionDetailsWithExplicitAsk(
      headingText,
      section.body_lines,
      section.raw_text
    );

    if (process.env.DEBUG_EXPLICIT_ASK === 'true' && headingText.toLowerCase().includes('discussion')) {
      console.log('[DEBUG_EXPLICIT_ASK] Section check:', {
        headingText,
        isExplicitAskSection,
        hasExplicitRequest: containsExplicitRequest(section.raw_text),
        hasTopicAnchors: hasExtractableTopicAnchors(section.body_lines),
      });
    }

    if (isExplicitAskSection) {
      // Force synthesis of a real new_feature suggestion from explicit ask
      const explicitAsk = extractExplicitAsk(section.raw_text);

      if (process.env.DEBUG_EXPLICIT_ASK === 'true') {
        console.log('[DEBUG_EXPLICIT_ASK] Explicit ask extracted:', {
          explicitAsk: explicitAsk?.substring(0, 100),
          length: explicitAsk?.length,
        });
      }

      if (explicitAsk && explicitAsk.length > 10) {
        // Generate a simple new_feature suggestion from the explicit ask
        const title = generateTitleFromExplicitAsk(explicitAsk);
        const body = capitalizeFirst(explicitAsk);

        // Extract evidence from the ask line
        const askLineObj = section.body_lines.find(l =>
          normalizeLineForSynthesis(l.text).includes(explicitAsk.substring(0, 30))
        );

        const evidenceSpans: EvidenceSpan[] = askLineObj
          ? [{
              start_line: askLineObj.index,
              end_line: askLineObj.index,
              text: askLineObj.text,
            }]
          : [{
              start_line: section.start_line,
              end_line: Math.min(section.end_line, section.start_line + 2),
              text: section.body_lines.slice(0, 2).map(l => l.text).join('\n'),
            }];

        const scores: SuggestionScores = {
          section_actionability: section.intent.new_workstream || 0.6,
          type_choice_confidence: 0.7,
          synthesis_confidence: 0.7,
          overall: 0, // Computed in scoring phase
        };

        const routing: SuggestionRouting = {
          create_new: true,
        };

        const suggestionContext: SuggestionContext = {
          title,
          body,
          evidencePreview: [explicitAsk.substring(0, 150)],
          sourceSectionId: section.section_id,
          sourceHeading: section.heading_text || '',
        };

        const suggestionKey = computeSuggestionKey({
          noteId: section.note_id,
          sourceSectionId: section.section_id,
          type: 'idea',
          title,
        });

        const suggestion: Suggestion = {
          suggestion_id: generateSuggestionId(section.note_id),
          note_id: section.note_id,
          section_id: section.section_id,
          type: 'idea',
          title,
          payload: {
            draft_initiative: {
              title: title.replace(/^New idea:\s*/i, '').trim(),
              description: body,
            },
          },
          evidence_spans: evidenceSpans,
          scores,
          routing,
          suggestionKey,
          structural_hint: 'explicit_ask',
          suggestion: suggestionContext,
        };

        suggestions.push(suggestion);

        if (process.env.DEBUG_EXPLICIT_ASK === 'true') {
          console.log('[DEBUG_EXPLICIT_ASK] Created idea suggestion:', {
            id: suggestion.suggestion_id,
            type: suggestion.type,
            title: suggestion.title.substring(0, 80),
          });
        }

        // Track evidence for derivative detection
        for (const span of suggestion.evidence_spans) {
          emittedEvidenceTexts.push(span.text);
        }

        // Skip normal synthesis path for this section
        continue;
      }
    }

    // Derivative content suppression: check if section is mostly redundant
    // Especially applies to summary/overview/recap sections
    if (isSummaryHeading(section.heading_text) || isDerivativeSection(section, emittedEvidenceTexts)) {
      // Skip synthesis for this section - it's derivative
      continue;
    }

    // Topic isolation now happens BEFORE synthesis in the main pipeline (index.ts and debugGenerator.ts)
    // Sections passed here are already split if needed, so just process them directly
    // Process section directly
    {
      const sectionToProcess = section;
      // Decision table normalization: extract clean decision statements
      // Check if this appears to be a decision section with status markers
      let processedSection = sectionToProcess;
      if (containsStatusMarker(sectionToProcess.raw_text)) {
        // Extract decisions, strip status markers, and check for duplicates
        const lines = sectionToProcess.body_lines;
        const cleanedLines: typeof lines = [];

        for (const line of lines) {
          const decision = extractDecisionStatement(line.text);

          // Check if this decision was already emitted
          if (emittedDecisions.some(prev => areDecisionsDuplicate(decision, prev))) {
            // Skip duplicate decision line
            continue;
          }

          // Create cleaned line with status markers stripped
          cleanedLines.push({
            ...line,
            text: decision,
          });

          // Track this decision
          if (decision.length > 10) {
            emittedDecisions.push(decision);
          }
        }

        // If all decisions were duplicates, skip this section
        if (cleanedLines.length === 0) {
          continue;
        }

        // Update section with cleaned lines
        processedSection = {
          ...sectionToProcess,
          body_lines: cleanedLines,
          raw_text: cleanedLines.map(l => l.text).join('\n'),
        };
      }

      const suggestion = synthesizeSuggestion(processedSection);

      if (process.env.DEBUG_EXPLICIT_ASK === 'true' && processedSection.heading_text?.toLowerCase().includes('discussion')) {
        console.log('[DEBUG_EXPLICIT_ASK] Normal synthesis ran for Discussion details:', {
          suggestionCreated: !!suggestion,
          suggestionType: suggestion?.type,
          suggestionId: suggestion?.suggestion_id,
        });
      }

      if (suggestion) {
        // Post-synthesis suppression: check for low-relevance candidates
        if (shouldSuppressCandidate(suggestion, processedSection)) {
          // Mark as suppressed for debug explainability
          suggestion.dropStage = DropStage.POST_SYNTHESIS_SUPPRESS;
          suggestion.dropReason = DropReason.LOW_RELEVANCE;
          // Skip emitting this candidate
          continue;
        }

        suggestions.push(suggestion);

        // Track evidence text for derivative detection
        for (const span of suggestion.evidence_spans) {
          emittedEvidenceTexts.push(span.text);
        }
      }
    }
  }

  return suggestions;
}
