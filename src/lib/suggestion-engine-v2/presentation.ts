/**
 * Suggestion Engine v2 - Presentation Helper
 *
 * Engine uncapped: UI uses this helper to cap display at defaultCapPerType.
 *
 * groupSuggestionsForDisplay() takes the full engine output and returns:
 *   - buckets: sorted by type/label, each with top N shown + hidden remainder
 *   - flatShown: all shown suggestions in display order
 *
 * This is a pure helper with no side effects. It does NOT drop suggestions
 * from the engine output — it only controls what the UI shows by default.
 */

import type { Suggestion } from './types';
import { rankingScore } from './scoring';

// ============================================
// Types
// ============================================

export interface SuggestionBucket {
  /** Bucket key: "project_update", "idea", "risk", or "bug" */
  key: string;
  /** Human-readable label for UI display */
  title: string;
  /** Total suggestions in this bucket */
  total: number;
  /** Top N suggestions to show by default */
  shown: Suggestion[];
  /** Number of suggestions hidden (total - shown.length) */
  hiddenCount: number;
  /** Remaining suggestions not shown by default */
  hidden: Suggestion[];
}

export interface GroupedSuggestions {
  buckets: SuggestionBucket[];
  /** All shown suggestions concatenated in display order */
  flatShown: Suggestion[];
}

// ============================================
// Bucket resolution
// ============================================

/**
 * Determine which bucket a suggestion belongs to.
 *
 * Bucketing rules (priority order):
 * 1. metadata.label === "risk"  → "risk"
 * 2. metadata.label === "bug"   → "bug"
 * 3. type === "project_update"  → "project_update"
 * 4. type === "idea"            → "idea"
 */
function getBucketKey(s: Suggestion): string {
  const label = s.metadata?.label;
  if (label === 'risk') return 'risk';
  if (label === 'bug') return 'bug';
  return s.type; // "project_update" | "idea"
}

const BUCKET_TITLES: Record<string, string> = {
  risk: 'Risks',
  bug: 'Bugs',
  project_update: 'Plan Changes',
  idea: 'Ideas',
};

// Display order for buckets (risks first, then plan changes, then ideas, then bugs)
const BUCKET_ORDER: Record<string, number> = {
  risk: 0,
  project_update: 1,
  idea: 2,
  bug: 3,
};

// ============================================
// Main helper
// ============================================

export interface GroupSuggestionsOptions {
  /** Max suggestions to show per bucket before collapsing. Default: 5. */
  capPerType?: number;
}

/**
 * Group suggestions for display.
 *
 * Returns bucketed suggestions sorted by rankingScore within each bucket,
 * with the top `capPerType` shown and the rest in `hidden`.
 *
 * Usage:
 *   const { buckets, flatShown } = groupSuggestionsForDisplay(
 *     engine.suggestions,
 *     { capPerType: 5 }
 *   );
 *   // Show flatShown; for each bucket where hiddenCount > 0,
 *   // render a "Show all (N)" affordance.
 */
export function groupSuggestionsForDisplay(
  suggestions: Suggestion[],
  options: GroupSuggestionsOptions = {}
): GroupedSuggestions {
  const capPerType = options.capPerType ?? 5;

  // Group suggestions by bucket key
  const byKey = new Map<string, Suggestion[]>();
  for (const s of suggestions) {
    const key = getBucketKey(s);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push(s);
  }

  // Sort each bucket by rankingScore (descending), then split into shown/hidden
  const buckets: SuggestionBucket[] = [];
  for (const [key, items] of byKey.entries()) {
    const sorted = [...items].sort((a, b) => rankingScore(b) - rankingScore(a));
    const shown = sorted.slice(0, capPerType);
    const hidden = sorted.slice(capPerType);
    buckets.push({
      key,
      title: BUCKET_TITLES[key] ?? key,
      total: sorted.length,
      shown,
      hiddenCount: hidden.length,
      hidden,
    });
  }

  // Sort buckets by display order
  buckets.sort((a, b) => {
    const orderA = BUCKET_ORDER[a.key] ?? 99;
    const orderB = BUCKET_ORDER[b.key] ?? 99;
    return orderA - orderB;
  });

  const flatShown = buckets.flatMap(b => b.shown);

  return { buckets, flatShown };
}
