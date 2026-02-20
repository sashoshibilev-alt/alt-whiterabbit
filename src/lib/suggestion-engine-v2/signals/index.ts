import { extractFeatureDemand } from "./extractFeatureDemand";
import { extractPlanChange } from "./extractPlanChange";
import { extractScopeRisk } from "./extractScopeRisk";
import { extractBug } from "./extractBug";
import type { Signal } from "./types";

export type { Signal, SignalType, SuggestedLabel } from "./types";

/**
 * Run all signal extractors over a list of sentences and return the combined results.
 *
 * Each extractor operates independently. Results are flattened and returned as-is
 * (no deduplication at this stage).
 */
export function extractSignalsFromSentences(sentences: string[]): Signal[] {
  return [
    ...extractFeatureDemand(sentences),
    ...extractPlanChange(sentences),
    ...extractScopeRisk(sentences),
    ...extractBug(sentences),
  ];
}
