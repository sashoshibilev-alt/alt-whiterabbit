/**
 * Utility functions for the belief-first reasoning pipeline
 */

/**
 * Generate a unique ID
 */
export function generateId(): string {
  return crypto.randomUUID();
}

/**
 * Clamp a number between 0 and 1
 */
export function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Normalize line endings to \n
 */
export function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/**
 * Strip trailing whitespace from each line and remove empty lines at start/end
 */
export function stripBoilerplate(text: string): string {
  const lines = text.split('\n');
  
  // Remove trailing whitespace from each line
  const trimmedLines = lines.map(line => line.trimEnd());
  
  // Find first and last non-empty line
  let firstNonEmpty = 0;
  let lastNonEmpty = trimmedLines.length - 1;
  
  while (firstNonEmpty < trimmedLines.length && trimmedLines[firstNonEmpty] === '') {
    firstNonEmpty++;
  }
  
  while (lastNonEmpty >= 0 && trimmedLines[lastNonEmpty] === '') {
    lastNonEmpty--;
  }
  
  // Return the trimmed content
  if (firstNonEmpty > lastNonEmpty) {
    return '';
  }
  
  return trimmedLines.slice(firstNonEmpty, lastNonEmpty + 1).join('\n');
}

/**
 * String similarity score (simple Jaccard similarity on words)
 * Used for grouping belief candidates by subject_handle
 */
export function stringSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\s+/));
  const wordsB = new Set(b.toLowerCase().split(/\s+/));
  
  const wordsAArray = Array.from(wordsA);
  const intersection = new Set(wordsAArray.filter(x => wordsB.has(x)));
  const union = new Set(Array.from(wordsA).concat(Array.from(wordsB)));
  
  if (union.size === 0) return 0;
  return intersection.size / union.size;
}

/**
 * Normalize a subject handle string
 * Converts to lowercase and removes extra whitespace
 */
export function normalizeSubjectHandle(handle: string): string {
  return handle.toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Check if a subject handle is semantically vague
 * Returns true if the handle contains uncertainty markers
 */
export function isVagueSubjectHandle(handle: string): boolean {
  const vagueTerms = ['maybe', 'might', 'possibly', 'perhaps', 'roughly', 'probably', 'unsure'];
  const lowerHandle = handle.toLowerCase();
  return vagueTerms.some(term => lowerHandle.includes(term));
}

/**
 * Check if text contains ambiguous timeline language
 */
export function hasAmbiguousTimeline(text: string): boolean {
  const ambiguousTerms = ['soon', 'later', 'eventually', 'sometime', 'tbd', 'unclear'];
  const lowerText = text.toLowerCase();
  return ambiguousTerms.some(term => lowerText.includes(term));
}

/**
 * Check if text contains ambiguous scope language
 */
export function hasAmbiguousScope(text: string): boolean {
  const ambiguousTerms = ['maybe', 'possibly', 'might include', 'could add', 'unclear scope'];
  const lowerText = text.toLowerCase();
  return ambiguousTerms.some(term => lowerText.includes(term));
}

/**
 * Calculate mean of an array of numbers
 */
export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, val) => sum + val, 0) / values.length;
}

/**
 * Calculate max of an array of numbers
 */
export function max(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.max(...values);
}

/**
 * Group items by a key function
 */
export function groupBy<T, K extends string | number>(
  items: T[],
  keyFn: (item: T) => K
): Record<K, T[]> {
  const result: Record<string | number, T[]> = {};
  for (const item of items) {
    const key = keyFn(item);
    if (!result[key]) {
      result[key] = [];
    }
    result[key].push(item);
  }
  return result as Record<K, T[]>;
}
