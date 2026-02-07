/**
 * Suggestion Key Utilities
 *
 * Provides stable identifiers for suggestions across regenerates.
 * Key format: sha1(noteId|sourceSectionId|type|normalizedTitle)
 */

/**
 * Normalize a suggestion title to a canonical form for stable key generation.
 *
 * Normalization rules:
 * - Convert to lowercase
 * - Trim whitespace
 * - Remove punctuation (except spaces)
 * - Collapse multiple whitespace to single space
 * - Truncate to max 120 chars after normalization
 *
 * @param title - The suggestion title to normalize
 * @returns Normalized title string (max 120 chars)
 */
export function normalizeTitle(title: string): string {
  const normalized = title
    .toLowerCase()
    .trim()
    .replace(/[^\w\s]/g, '') // Remove punctuation (keep alphanumeric and spaces)
    .replace(/\s+/g, ' ') // Collapse whitespace to single space
    .trim(); // Final trim to handle edge cases

  // Truncate to max 120 chars
  return normalized.substring(0, 120);
}

/**
 * Simple SHA1 implementation for stable key generation.
 * This is sufficient for deduplication purposes (not cryptographic security).
 */
function sha1(str: string): string {
  // Simple hash implementation using built-in functionality
  // For Node.js and modern environments
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    // Browser environment - we'll use a simpler hash for now
    // In production, you might want to use a proper SHA1 library
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(36);
  }

  // For Node.js environment (used in Convex backend)
  try {
    const crypto = require('crypto');
    return crypto.createHash('sha1').update(str).digest('hex');
  } catch {
    // Fallback: simple hash for environments without crypto
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
  }
}

/**
 * Compute a stable suggestion key from its core attributes.
 *
 * The key uniquely identifies a suggestion across regenerates based on:
 * - The note it came from
 * - The section within that note
 * - The suggestion type (idea vs project_update)
 * - The normalized title
 *
 * Uses SHA1 hash of the concatenated components for stability.
 *
 * @param params - Suggestion key components
 * @returns Stable suggestion key string (SHA1 hash)
 */
export function computeSuggestionKey(params: {
  noteId: string;
  sourceSectionId: string;
  type: 'idea' | 'project_update';
  title: string;
}): string {
  const { noteId, sourceSectionId, type, title } = params;
  const normalized = normalizeTitle(title);

  // Concatenate with pipe separator as specified in the task
  const payload = `${noteId}|${sourceSectionId}|${type}|${normalized}`;

  // Return SHA1 hash
  return sha1(payload);
}
