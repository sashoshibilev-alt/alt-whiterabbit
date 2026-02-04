/**
 * Suggestion Debug Report - Redaction Utilities
 *
 * Utilities for redacting sensitive information from debug reports
 * and resolving debug verbosity based on context.
 */

import type {
  DebugVerbosity,
  TextPreview,
  EvidenceSpanPreview,
  EvidenceDebug,
} from "./debugTypes";

// ============================================
// Redaction Patterns
// ============================================

const EMAIL_REGEX = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const SSN_REGEX = /\b\d{3}-\d{2}-\d{4}\b/g;
const CREDIT_CARD_REGEX = /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g;
// Phone regex - more specific to avoid matching SSNs and credit cards
const PHONE_REGEX = /(?:\+\d{1,3}[\s-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g;

// ============================================
// Redaction Functions
// ============================================

/**
 * Redact potentially sensitive information from text
 */
export function redactText(raw: string): string {
  // Apply more specific patterns first (SSN, credit card) before phone
  return raw
    .replace(EMAIL_REGEX, "[email]")
    .replace(SSN_REGEX, "[ssn]")
    .replace(CREDIT_CARD_REGEX, "[card]")
    .replace(PHONE_REGEX, "[phone]");
}

/**
 * Create a preview from raw text with redaction and truncation
 */
export function makePreview(raw: string, maxLen = 160): string {
  const redacted = redactText(raw.trim());
  if (redacted.length <= maxLen) return redacted;
  return redacted.slice(0, maxLen) + "…";
}

/**
 * Create a TextPreview from lines within a range
 */
export function makeTextPreviewFromLines(
  lines: string[],
  lineRange: [number, number],
  maxLen = 200
): TextPreview {
  const [start, end] = lineRange;
  const slice = lines.slice(start, end + 1).join(" ");
  return {
    lineRange,
    preview: makePreview(slice, maxLen),
  };
}

/**
 * Create an EvidenceSpanPreview from a line
 */
export function makeEvidenceSpanPreview(
  lineIndex: number,
  lineText: string,
  maxLen = 120
): EvidenceSpanPreview {
  return {
    lineIndex,
    preview: makePreview(lineText, maxLen),
  };
}

/**
 * Create an EvidenceDebug object from line IDs and lines
 */
export function makeEvidenceDebug(
  lineIds: number[],
  lines: string[],
  maxLen = 120
): EvidenceDebug {
  const spans = lineIds.map((lineId) => {
    const lineText = lines[lineId] || "";
    return makeEvidenceSpanPreview(lineId, lineText, maxLen);
  });

  return {
    lineIds,
    spans,
  };
}

// ============================================
// Verbosity Resolution
// ============================================

/**
 * Default debug verbosity for production
 */
export const DEFAULT_DEBUG_VERBOSITY: DebugVerbosity = "OFF";

/**
 * Feature flag context for debug features
 */
export interface DebugFeatureFlags {
  suggestionDebugEnabled: boolean;
  allowFullTextDebug?: boolean;
}

/**
 * User context for debug access
 */
export interface DebugUserContext {
  isAdmin: boolean;
  userId?: string;
}

/**
 * Environment context for debug features
 */
export interface DebugEnvContext {
  isDev: boolean;
  allowFullTextDebug: boolean;
}

/**
 * Resolve debug verbosity based on context
 *
 * Rules:
 * - OFF if feature flag is disabled
 * - OFF if user is not admin
 * - FULL_TEXT only in dev mode with explicit env flag
 * - REDACTED as default when enabled
 */
export function resolveDebugVerbosity(
  requested: DebugVerbosity | undefined,
  flags: DebugFeatureFlags,
  user: DebugUserContext,
  env: DebugEnvContext
): DebugVerbosity {
  // Feature flag must be enabled
  if (!flags.suggestionDebugEnabled) {
    return "OFF";
  }

  // User must be admin
  if (!user.isAdmin) {
    return "OFF";
  }

  // FULL_TEXT requires dev mode and explicit flag
  if (
    requested === "FULL_TEXT" &&
    env.isDev &&
    env.allowFullTextDebug
  ) {
    return "FULL_TEXT";
  }

  // REDACTED is the default when debug is enabled
  if (requested === "REDACTED" || requested === undefined) {
    return "REDACTED";
  }

  // Default to REDACTED for safety
  return "REDACTED";
}

/**
 * Check if debug data should be persisted
 */
export function shouldPersistDebug(verbosity: DebugVerbosity): boolean {
  return verbosity !== "OFF";
}

/**
 * Check if debug data should be included in response
 */
export function shouldIncludeDebugInResponse(
  verbosity: DebugVerbosity,
  user: DebugUserContext
): boolean {
  return verbosity !== "OFF" && user.isAdmin;
}

// ============================================
// Utility Functions
// ============================================

/**
 * Truncate an array and add count suffix
 */
export function truncateArray<T>(arr: T[], maxLen: number): T[] {
  if (arr.length <= maxLen) return arr;
  return arr.slice(0, maxLen);
}

/**
 * Sanitize object for JSON storage (remove undefined, functions, etc.)
 */
export function sanitizeForJson<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Compute byte size of JSON payload
 */
export function computeJsonByteSize(obj: unknown): number {
  return new TextEncoder().encode(JSON.stringify(obj)).length;
}

/**
 * Check if payload exceeds size limit
 */
export function exceedsPayloadLimit(
  obj: unknown,
  maxBytes: number = 512 * 1024 // 512 KB default
): boolean {
  return computeJsonByteSize(obj) > maxBytes;
}
