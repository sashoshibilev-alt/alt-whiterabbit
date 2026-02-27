/**
 * Suggestion display helpers
 *
 * Maps SuggestionType to user-facing prefix labels and strips
 * legacy "Add Update:" / "Add idea:" artifacts from titles.
 */

import type { SuggestionType } from './types';

/** Map SuggestionType → user-facing prefix */
const TYPE_PREFIX: Record<SuggestionType, string> = {
  idea: 'Idea',
  project_update: 'Update',
  risk: 'Risk',
  bug: 'Bug',
};

/**
 * Returns a short prefix string for the given suggestion type.
 * Returns undefined for unknown types so the UI can gracefully omit.
 */
export function getTypePrefix(type: SuggestionType | undefined): string | undefined {
  if (!type) return undefined;
  return TYPE_PREFIX[type];
}

/**
 * Regex that matches legacy "Add <Type>:" prefixes at the start of titles.
 * Examples: "Add Update: …", "Add idea: …", "Add Idea: …"
 */
const LEGACY_PREFIX_RE = /^Add\s+(Update|Idea|Risk|Bug)\s*:\s*/i;

/**
 * Regex that matches bare engine-generated type prefixes at the start of titles.
 * Examples: "Update: …", "Idea: …", "Risk: …", "Bug: …"
 * These are added by normalizeTitlePrefix in the engine pipeline and must be
 * stripped so the UI can re-add the prefix from suggestion.type without doubling.
 */
const ENGINE_PREFIX_RE = /^(Update|Idea|Risk|Bug)\s*:\s*/i;

/**
 * Strips legacy "Add <Type>:" and bare engine "<Type>:" prefixes from a title.
 * Returns the cleaned title suitable for display with getTypePrefix().
 */
export function stripLegacyPrefix(title: string): string {
  return title.replace(LEGACY_PREFIX_RE, '').replace(ENGINE_PREFIX_RE, '');
}
