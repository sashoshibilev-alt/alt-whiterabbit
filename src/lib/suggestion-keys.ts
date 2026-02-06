/**
 * Suggestion Key Utilities
 *
 * Provides stable identifiers for suggestions across regenerates.
 * Key format: noteId:sourceSectionId:type:normalizedTitle
 */

/**
 * Normalize a suggestion title to a canonical form for stable key generation.
 *
 * Normalization rules:
 * - Convert to lowercase
 * - Trim whitespace
 * - Strip punctuation (keep alphanumeric and spaces only)
 * - Collapse multiple whitespace to single space
 *
 * @param title - The suggestion title to normalize
 * @returns Normalized title string
 */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^\w\s]/g, '') // Strip punctuation first
    .replace(/\s+/g, ' ') // Then collapse whitespace
    .trim(); // Final trim to handle edge cases
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
 * @param params - Suggestion key components
 * @returns Stable suggestion key string
 */
export function computeSuggestionKey(params: {
  noteId: string;
  sourceSectionId: string;
  type: 'idea' | 'project_update';
  title: string;
}): string {
  const { noteId, sourceSectionId, type, title } = params;
  const normalized = normalizeTitle(title);
  return `${noteId}:${sourceSectionId}:${type}:${normalized}`;
}
