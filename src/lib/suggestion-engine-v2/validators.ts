/**
 * Suggestion Engine v2 - Quality Validators
 *
 * Hard quality gates V2-V3 that run after synthesis and before scoring.
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
 * - idea: relaxed (evidence spans exist + total chars >= 20)
 * - project_update / plan_change intent: bypasses strict validation (always passes)
 */
export function validateV3EvidenceSanity(
  suggestion: Suggestion,
  section: Section,
  thresholds: ThresholdConfig,
  typeLabel?: 'idea' | 'project_update'
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

  // Check: exact substring mapping (common to all types)
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

  // PROJECT_UPDATE / PLAN_CHANGE PATH: Bypass strict validation
  // Check if section has intent field (ClassifiedSection) and is plan_change
  const sectionWithIntent = section as any;
  if (sectionWithIntent.intent && isPlanChangeIntentLabel(sectionWithIntent.intent)) {
    // Plan change suggestions always pass - no length or bullet requirements
    return { passed: true, validator: 'V3_evidence_sanity' };
  }

  // IDEA PATH: Relaxed rules
  // Evidence spans exist (checked above) and map to section (checked above).
  // Only require minimum 20 non-whitespace chars in section body OR evidence.
  const sectionNonWS = sectionText.replace(/\s/g, '').length;
  const evidenceNonWS = evidenceSpans.reduce(
    (sum, s) => sum + s.text.replace(/\s/g, '').length, 0
  );

  if (sectionNonWS < 20 && evidenceNonWS < 20) {
    return {
      passed: false,
      validator: 'V3_evidence_sanity',
      reason: `Evidence too short for idea (section: ${sectionNonWS} chars, evidence: ${evidenceNonWS} chars, minimum 20)`,
    };
  }

  return { passed: true, validator: 'V3_evidence_sanity' };
}

// ============================================
// V4 - Heading-Only Suppression
// ============================================

/**
 * V4: Heading-only suppression validator
 *
 * Drops suggestions where:
 * - Title is derived from heading (titleSource = 'heading') OR starts with "New idea:"
 * - AND there is no explicit-ask anchor evidence (titleSource !== 'explicit-ask')
 *
 * This prevents garbage "New idea: <Heading>" suggestions from heading-only sections.
 * Preserves sections with explicit asks that may use heading as fallback title.
 */
export function validateV4HeadingOnly(
  suggestion: Suggestion
): ValidationResult {
  // Only applies to idea-type suggestions
  if (suggestion.type !== 'idea') {
    return { passed: true, validator: 'V3_evidence_sanity' };
  }

  const hasExplicitAsk = suggestion.titleSource === 'explicit-ask';
  const isHeadingDerived =
    suggestion.titleSource === 'heading' ||
    suggestion.title.startsWith('New idea:');

  // If title is heading-derived and there's no explicit ask, drop it
  if (isHeadingDerived && !hasExplicitAsk) {
    return {
      passed: false,
      validator: 'V3_evidence_sanity',
      reason: `Heading-only suggestion without explicit ask anchor (titleSource: ${suggestion.titleSource || 'unknown'})`,
    };
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
  typeLabel?: 'idea' | 'project_update'
): {
  passed: boolean;
  results: ValidationResult[];
  failedValidator?: string;
  failureReason?: string;
} {
  const sectionText = section.raw_text;
  const results: ValidationResult[] = [];

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

  // V4: Heading-only suppression
  const v4Result = validateV4HeadingOnly(suggestion);
  results.push(v4Result);
  if (!v4Result.passed) {
    return {
      passed: false,
      results,
      failedValidator: 'V3_evidence_sanity',  // Use V3 label for consistency
      failureReason: v4Result.reason,
    };
  }

  return {
    passed: true,
    results,
  };
}
