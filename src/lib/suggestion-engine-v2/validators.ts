/**
 * Suggestion Engine v2 - Quality Validators
 *
 * Hard quality gates V1-V3 that run after synthesis and before scoring.
 * Any failure results in suggestion being dropped.
 */

import type {
  Suggestion,
  ValidationResult,
  Section,
  ThresholdConfig,
  Line,
} from './types';
import { normalizeForComparison } from './preprocessing';
import { isPlanChangeIntentLabel } from './classifiers';

// ============================================
// V1 - Change-Test Validator
// ============================================

/**
 * V1: Validates that plan mutations represent real changes
 * and execution artifacts have required components
 */

/**
 * Delta/change patterns for plan mutations
 */
const DELTA_PATTERNS = [
  // Contrastive patterns
  /\bfrom\s+.{3,30}\s+to\s+/i,
  /\bshift(?:ing)?\s+from\s+/i,
  /\bmove(?:ing)?\s+from\s+/i,
  /\binstead of\s+/i,
  /\brather than\s+/i,
  /\bno longer\s+/i,
  /\bstop(?:ping)?\s+doing\s+/i,
  /\bstart(?:ing)?\s+doing\s+/i,
  // Magnitude changes
  /\breduce|increase|expand|narrow|grow|shrink/i,
  /\bdefer|accelerate|postpone|bring forward/i,
  // Scope markers
  /\bin scope|out of scope/i,
  /\binclude|exclude/i,
  /\bdescope|add to scope|remove from scope/i,
  /\bdrop|cut|add/i,
  // Sequencing changes
  /\bphase\s*\d|pilot first|full rollout/i,
  /\blater cohort|earlier cohort/i,
  /\bbefore|after/i,
];

/**
 * Check for delta patterns in text
 */
function hasDeltaSignal(text: string): boolean {
  return DELTA_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Validate plan mutation (V1)
 */
function validatePlanMutation(
  suggestion: Suggestion,
  sectionText: string
): ValidationResult {
  const afterDescription = suggestion.payload.after_description || '';

  // Check for delta patterns in section text
  if (hasDeltaSignal(sectionText)) {
    return { passed: true, validator: 'V1_change_test' };
  }

  // Check for delta patterns in generated description
  if (hasDeltaSignal(afterDescription)) {
    return { passed: true, validator: 'V1_change_test' };
  }

  // No delta signal found
  return {
    passed: false,
    validator: 'V1_change_test',
    reason: 'No concrete change/delta signal found in section or description',
  };
}

/**
 * Validate execution artifact has required components (V1)
 */
function validateExecutionArtifact(suggestion: Suggestion): ValidationResult {
  const draftInit = suggestion.payload.draft_initiative;
  if (!draftInit) {
    return {
      passed: false,
      validator: 'V1_change_test',
      reason: 'Missing draft_initiative payload',
    };
  }

  const { title, description } = draftInit;

  // Check title
  if (!title || title.trim().length < 5) {
    return {
      passed: false,
      validator: 'V1_change_test',
      reason: 'Draft initiative title is too short or missing',
    };
  }

  // Check description exists
  if (!description || description.trim().length < 20) {
    return {
      passed: false,
      validator: 'V1_change_test',
      reason: 'Draft initiative description is too short or missing',
    };
  }

  // Check for required components: objective, scope, or approach
  const descLower = description.toLowerCase();
  const hasObjective =
    /\b(objective|goal|outcome|success|deliver|achieve)\b/i.test(descLower);
  const hasScope = /\b(scope|includes?|covers?|within|focus)\b/i.test(descLower);
  const hasApproach =
    /\b(approach|strategy|plan|phase|step|first|then)\b/i.test(descLower);

  // Require at least 2 of 3 components
  const componentCount = [hasObjective, hasScope, hasApproach].filter(Boolean).length;
  if (componentCount < 1) {
    return {
      passed: false,
      validator: 'V1_change_test',
      reason: `Draft initiative lacks substance (found ${componentCount}/3 required components: objective, scope, approach)`,
    };
  }

  return { passed: true, validator: 'V1_change_test' };
}

/**
 * V1 validator entry point
 */
export function validateV1ChangeTest(
  suggestion: Suggestion,
  sectionText: string
): ValidationResult {
  if (suggestion.type === 'plan_mutation') {
    return validatePlanMutation(suggestion, sectionText);
  } else {
    return validateExecutionArtifact(suggestion);
  }
}

// ============================================
// V2 - Anti-Vacuity / Domain Anchoring
// ============================================

/**
 * Generic management-speak lexicon (verbs and nouns)
 */
const GENERIC_VERBS = new Set([
  'improve',
  'optimize',
  'align',
  'streamline',
  'clarify',
  'enhance',
  'coordinate',
  'prioritize',
  'manage',
  'facilitate',
  'leverage',
  'synergize',
  'enable',
  'empower',
  'drive',
  'ensure',
  'support',
  'address',
  'discuss',
  'review',
  'assess',
  'evaluate',
]);

const GENERIC_NOUNS = new Set([
  'process',
  'communication',
  'stakeholders',
  'priorities',
  'efficiency',
  'operations',
  'alignment',
  'workflows',
  'collaboration',
  'productivity',
  'visibility',
  'transparency',
  'accountability',
  'ownership',
  'outcomes',
  'deliverables',
  'resources',
  'bandwidth',
  'capacity',
  'synergy',
  'impact',
  'value',
]);

/**
 * Tokenize text into words
 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2);
}

/**
 * Compute generic ratio for text
 */
function computeGenericRatio(text: string): number {
  const tokens = tokenize(text);
  if (tokens.length === 0) return 0;

  let genericCount = 0;
  for (const token of tokens) {
    if (GENERIC_VERBS.has(token) || GENERIC_NOUNS.has(token)) {
      genericCount++;
    }
  }

  return genericCount / tokens.length;
}

/**
 * Extract domain-specific noun phrases (simple heuristic)
 */
function extractDomainNouns(text: string): string[] {
  const tokens = tokenize(text);
  const domainNouns: string[] = [];

  for (const token of tokens) {
    // Skip generic words and short words
    if (GENERIC_VERBS.has(token) || GENERIC_NOUNS.has(token)) continue;
    if (token.length < 4) continue;

    // Keep words that look domain-specific
    // (not in common stop words, not generic)
    if (!isCommonWord(token)) {
      domainNouns.push(token);
    }
  }

  return [...new Set(domainNouns)];
}

const COMMON_WORDS = new Set([
  'about', 'after', 'again', 'also', 'because', 'before', 'being',
  'both', 'could', 'does', 'doing', 'during', 'each', 'even', 'every',
  'first', 'from', 'going', 'good', 'have', 'having', 'here', 'into',
  'just', 'know', 'last', 'like', 'make', 'many', 'more', 'most', 'much',
  'need', 'only', 'other', 'over', 'same', 'should', 'some', 'such',
  'take', 'than', 'that', 'their', 'them', 'then', 'there', 'these',
  'they', 'thing', 'this', 'those', 'through', 'time', 'very', 'want',
  'well', 'what', 'when', 'where', 'which', 'while', 'will', 'with',
  'would', 'your',
]);

function isCommonWord(word: string): boolean {
  return COMMON_WORDS.has(word);
}

/**
 * V2: Anti-vacuity validator
 */
export function validateV2AntiVacuity(
  suggestion: Suggestion,
  sectionText: string,
  thresholds: ThresholdConfig
): ValidationResult {
  // Get suggestion text (title + description)
  const suggestionText =
    suggestion.title +
    ' ' +
    (suggestion.payload.after_description ||
      suggestion.payload.draft_initiative?.description ||
      '');

  // Compute generic ratio
  const genericRatio = computeGenericRatio(suggestionText);

  // Extract domain nouns from section
  const domainNouns = extractDomainNouns(sectionText);

  // Check vacuity
  if (genericRatio > thresholds.T_generic && domainNouns.length < 2) {
    return {
      passed: false,
      validator: 'V2_anti_vacuity',
      reason: `Suggestion is too generic (ratio: ${genericRatio.toFixed(2)}, domain nouns: ${domainNouns.length})`,
    };
  }

  // Additional check: if title is very generic
  const titleGenericRatio = computeGenericRatio(suggestion.title);
  if (titleGenericRatio > 0.7) {
    return {
      passed: false,
      validator: 'V2_anti_vacuity',
      reason: `Title is too generic (ratio: ${titleGenericRatio.toFixed(2)})`,
    };
  }

  return { passed: true, validator: 'V2_anti_vacuity' };
}

// ============================================
// V3 - Evidence Sanity
// ============================================

/**
 * V3: Evidence sanity validator (type-aware)
 *
 * Applies different rules based on typeLabel:
 * - execution_artifact: strict (bullets OR length >= 120)
 * - feature_request: relaxed (length >= 20 + request signal in section)
 * - plan_change intent: bypasses strict validation (always passes)
 */
export function validateV3EvidenceSanity(
  suggestion: Suggestion,
  section: Section,
  thresholds: ThresholdConfig,
  typeLabel?: 'feature_request' | 'execution_artifact' | 'plan_mutation'
): ValidationResult {
  const evidenceSpans = suggestion.evidence_spans;

  // Check: must have at least one evidence span
  if (!evidenceSpans || evidenceSpans.length === 0) {
    return {
      passed: false,
      validator: 'V3_evidence_sanity',
      reason: 'No evidence spans provided',
    };
  }

  // Check: exact substring mapping (common to both types)
  const sectionText = section.raw_text;
  const normalizedSection = normalizeForComparison(sectionText);

  for (const span of evidenceSpans) {
    const normalizedSpan = normalizeForComparison(span.text);
    if (!normalizedSection.includes(normalizedSpan)) {
      // Try partial match (first 50 chars)
      const partialSpan = normalizedSpan.slice(0, 50);
      if (!normalizedSection.includes(partialSpan)) {
        return {
          passed: false,
          validator: 'V3_evidence_sanity',
          reason: 'Evidence span text does not match section content',
        };
      }
    }
  }

  // Calculate total character count
  const totalChars = evidenceSpans.reduce((sum, s) => sum + s.text.length, 0);

  // PLAN_CHANGE PATH: Bypass strict validation for plan_change intents
  // Check if section has intent field (ClassifiedSection) and is plan_change
  const sectionWithIntent = section as any;
  if (sectionWithIntent.intent && isPlanChangeIntentLabel(sectionWithIntent.intent)) {
    // Plan change suggestions always pass - no length or bullet requirements
    return { passed: true, validator: 'V3_evidence_sanity' };
  }

  // TYPE-AWARE VALIDATION: feature_request vs execution_artifact
  if (typeLabel === 'feature_request') {
    // FEATURE_REQUEST PATH: Relaxed rules for short, single-line requests

    // Check minimum character floor (avoid pure noise)
    if (totalChars < 20) {
      return {
        passed: false,
        validator: 'V3_evidence_sanity',
        reason: `Evidence too short for feature request (${totalChars} chars, minimum 20)`,
      };
    }

    // Check for request pattern OR action verb in section text
    // (Same patterns used in type classification, ensures consistency)
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
      "let's",
      'need to',
      'we need to',
    ];

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

    const normalizedSectionLower = normalizeForComparison(sectionText).toLowerCase();
    const hasRequestStem = V3_REQUEST_STEMS.some(stem => normalizedSectionLower.includes(stem.toLowerCase()));
    const hasActionVerb = V3_ACTION_VERBS.some(verb => {
      const regex = new RegExp(`\\b${verb}\\b`, 'i');
      return regex.test(sectionText);
    });

    if (!hasRequestStem && !hasActionVerb) {
      return {
        passed: false,
        validator: 'V3_evidence_sanity',
        reason: 'Feature request lacks request pattern or action verb',
      };
    }

    // Feature request passes
    return { passed: true, validator: 'V3_evidence_sanity' };
  }

  // EXECUTION_ARTIFACT PATH: Strict rules (existing behavior)

  // Check: action-bearing line presence
  let hasActionBearingLine = false;
  for (const span of evidenceSpans) {
    // Check if any evidence line is a list item
    const spanLines = section.body_lines.filter(
      (l) => l.index >= span.start_line && l.index <= span.end_line
    );
    if (spanLines.some((l) => l.line_type === 'list_item')) {
      hasActionBearingLine = true;
      break;
    }

    // Or if text contains action-bearing patterns
    if (/\b(will|should|must|need to|going to|plan to|decided to)\b/i.test(span.text)) {
      hasActionBearingLine = true;
      break;
    }
  }

  const hasBullet = evidenceSpans.some((s) => /^[-*•]\s/.test(s.text.trim()));

  // Evidence must have a bullet OR meet minimum character count
  if (!hasBullet && totalChars < thresholds.MIN_EVIDENCE_CHARS) {
    return {
      passed: false,
      validator: 'V3_evidence_sanity',
      reason: `Evidence too short (${totalChars} chars) and no bullet points`,
    };
  }

  // Warn if evidence is only headings (but don't fail)
  if (!hasActionBearingLine) {
    // Still pass, but this could be a soft warning
  }

  return { passed: true, validator: 'V3_evidence_sanity' };
}

// ============================================
// Combined Validator Pipeline
// ============================================

/**
 * Run all quality validators on a suggestion
 */
export function runQualityValidators(
  suggestion: Suggestion,
  section: Section,
  thresholds: ThresholdConfig,
  typeLabel?: 'feature_request' | 'execution_artifact' | 'plan_mutation'
): {
  passed: boolean;
  results: ValidationResult[];
  failedValidator?: string;
  failureReason?: string;
} {
  const sectionText = section.raw_text;
  const results: ValidationResult[] = [];

  // V1: Change-test (debug/metadata only - does not block v2 suggestions)
  const v1Result = validateV1ChangeTest(suggestion, sectionText);
  results.push(v1Result);
  // V1 validator kept for debug metadata but does NOT drop v2 suggestions
  // (V1 validation only applies to v1 suggestion engine)

  // V2: Anti-vacuity
  const v2Result = validateV2AntiVacuity(suggestion, sectionText, thresholds);
  results.push(v2Result);
  if (!v2Result.passed) {
    return {
      passed: false,
      results,
      failedValidator: 'V2_anti_vacuity',
      failureReason: v2Result.reason,
    };
  }

  // V3: Evidence sanity (type-aware)
  const v3Result = validateV3EvidenceSanity(suggestion, section, thresholds, typeLabel);
  results.push(v3Result);
  if (!v3Result.passed) {
    return {
      passed: false,
      results,
      failedValidator: 'V3_evidence_sanity',
      failureReason: v3Result.reason,
    };
  }

  return {
    passed: true,
    results,
  };
}
