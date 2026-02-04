/**
 * Stage 0: Input Normalization
 * 
 * Normalizes meeting note markdown to ensure stable character offsets
 */

import { MeetingNote, NormalizedMeetingNote } from './types';
import { normalizeLineEndings, stripBoilerplate } from './utils';

/**
 * Normalize a meeting note
 * - Normalizes line endings to \n
 * - Strips trailing whitespace and empty lines at start/end
 * - Preserves exact character offsets for downstream processing
 */
export function normalizeMeetingNote(note: MeetingNote): NormalizedMeetingNote {
  let normalized = note.raw_markdown;
  
  // Normalize line endings
  normalized = normalizeLineEndings(normalized);
  
  // Strip boilerplate (trailing whitespace, empty lines at start/end)
  normalized = stripBoilerplate(normalized);
  
  return {
    ...note,
    raw_markdown: normalized,
  };
}
