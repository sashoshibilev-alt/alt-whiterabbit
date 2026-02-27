/**
 * Deterministic hash of note content using djb2 algorithm.
 * Returns an 8-character hex string.
 */
export function computeNoteHash(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
