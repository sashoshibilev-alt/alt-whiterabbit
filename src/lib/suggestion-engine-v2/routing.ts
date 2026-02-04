/**
 * Suggestion Engine v2 - Routing
 *
 * Post-generation routing that attaches suggestions to existing initiatives
 * or marks them as create_new. Never discards suggestions.
 */

import type {
  Suggestion,
  SuggestionRouting,
  InitiativeSnapshot,
  ThresholdConfig,
} from './types';

// ============================================
// Text Similarity (Fallback)
// ============================================

/**
 * Compute Jaccard similarity between two sets
 */
function jaccardSimilarity(set1: Set<string>, set2: Set<string>): number {
  const intersection = new Set([...set1].filter((x) => set2.has(x)));
  const union = new Set([...set1, ...set2]);
  if (union.size === 0) return 0;
  return intersection.size / union.size;
}

/**
 * Tokenize text into words for similarity
 */
function tokenizeForSimilarity(text: string): Set<string> {
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2);
  return new Set(tokens);
}

/**
 * Compute cosine similarity between two word frequency vectors
 */
function cosineSimilarity(text1: string, text2: string): number {
  const tokens1 = tokenizeForSimilarity(text1);
  const tokens2 = tokenizeForSimilarity(text2);

  if (tokens1.size === 0 || tokens2.size === 0) return 0;

  // Simple Jaccard as a proxy for cosine (without embeddings)
  return jaccardSimilarity(tokens1, tokens2);
}

/**
 * Enhanced text similarity using TF-IDF-like weighting
 */
function enhancedSimilarity(text1: string, text2: string): number {
  const tokens1 = text1
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3);
  const tokens2 = text2
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3);

  if (tokens1.length === 0 || tokens2.length === 0) return 0;

  // Create frequency maps
  const freq1 = new Map<string, number>();
  const freq2 = new Map<string, number>();

  for (const token of tokens1) {
    freq1.set(token, (freq1.get(token) || 0) + 1);
  }
  for (const token of tokens2) {
    freq2.set(token, (freq2.get(token) || 0) + 1);
  }

  // Compute dot product
  let dotProduct = 0;
  let norm1 = 0;
  let norm2 = 0;

  const allTokens = new Set([...freq1.keys(), ...freq2.keys()]);

  for (const token of allTokens) {
    const f1 = freq1.get(token) || 0;
    const f2 = freq2.get(token) || 0;
    dotProduct += f1 * f2;
    norm1 += f1 * f1;
    norm2 += f2 * f2;
  }

  if (norm1 === 0 || norm2 === 0) return 0;

  return dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
}

// ============================================
// Suggestion Text Extraction
// ============================================

/**
 * Get the text to use for suggestion embedding/similarity
 */
function getSuggestionText(suggestion: Suggestion): string {
  const title = suggestion.title;
  const description =
    suggestion.payload.after_description ||
    suggestion.payload.draft_initiative?.description ||
    '';
  return `${title}\n${description}`;
}

/**
 * Get the text to use for initiative embedding/similarity
 */
function getInitiativeText(initiative: InitiativeSnapshot): string {
  return `${initiative.title}\n${initiative.description || ''}`;
}

// ============================================
// Similarity Computation
// ============================================

/**
 * Compute similarity between a suggestion and all initiatives
 */
function computeSimilarities(
  suggestion: Suggestion,
  initiatives: InitiativeSnapshot[]
): Array<{ initiative: InitiativeSnapshot; similarity: number }> {
  const suggestionText = getSuggestionText(suggestion);

  return initiatives.map((initiative) => {
    const initiativeText = getInitiativeText(initiative);
    const similarity = enhancedSimilarity(suggestionText, initiativeText);
    return { initiative, similarity };
  });
}

/**
 * Find the best matching initiative
 */
function findBestMatch(
  suggestion: Suggestion,
  initiatives: InitiativeSnapshot[]
): { initiative: InitiativeSnapshot | null; similarity: number } {
  if (initiatives.length === 0) {
    return { initiative: null, similarity: 0 };
  }

  const similarities = computeSimilarities(suggestion, initiatives);

  // Sort by similarity descending
  similarities.sort((a, b) => b.similarity - a.similarity);

  const best = similarities[0];
  return {
    initiative: best.initiative,
    similarity: best.similarity,
  };
}

// ============================================
// Routing Logic
// ============================================

/**
 * Route a single suggestion (attach to initiative or mark create_new)
 */
export function routeSuggestion(
  suggestion: Suggestion,
  initiatives: InitiativeSnapshot[],
  thresholds: ThresholdConfig
): Suggestion {
  // If no initiatives provided, mark as create_new
  if (!initiatives || initiatives.length === 0) {
    return {
      ...suggestion,
      routing: {
        create_new: true,
      },
    };
  }

  // Find best match
  const { initiative, similarity } = findBestMatch(suggestion, initiatives);

  // Apply routing rule
  let routing: SuggestionRouting;

  if (initiative && similarity >= thresholds.T_attach) {
    routing = {
      attached_initiative_id: initiative.id,
      similarity,
      create_new: false,
    };
  } else {
    routing = {
      similarity: similarity || undefined,
      create_new: true,
    };
  }

  return {
    ...suggestion,
    routing,
  };
}

/**
 * Route all suggestions
 */
export function routeSuggestions(
  suggestions: Suggestion[],
  initiatives: InitiativeSnapshot[],
  thresholds: ThresholdConfig
): Suggestion[] {
  return suggestions.map((suggestion) =>
    routeSuggestion(suggestion, initiatives, thresholds)
  );
}

// ============================================
// Routing Analytics
// ============================================

/**
 * Compute routing statistics
 */
export function computeRoutingStats(suggestions: Suggestion[]): {
  total: number;
  attached: number;
  create_new: number;
  avgSimilarity: number;
} {
  const attached = suggestions.filter(
    (s) => s.routing.attached_initiative_id && !s.routing.create_new
  );
  const createNew = suggestions.filter((s) => s.routing.create_new);

  const similarities = suggestions
    .filter((s) => s.routing.similarity !== undefined)
    .map((s) => s.routing.similarity!);

  const avgSimilarity =
    similarities.length > 0
      ? similarities.reduce((sum, s) => sum + s, 0) / similarities.length
      : 0;

  return {
    total: suggestions.length,
    attached: attached.length,
    create_new: createNew.length,
    avgSimilarity,
  };
}

// ============================================
// Embedding Support (Placeholder)
// ============================================

/**
 * Placeholder for embedding-based similarity
 * In production, this would call an embedding API (OpenAI, local model, etc.)
 */
export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
  computeSimilarity(embedding1: number[], embedding2: number[]): number;
}

/**
 * Route with embeddings (when embedding provider is available)
 */
export async function routeWithEmbeddings(
  suggestion: Suggestion,
  initiatives: InitiativeSnapshot[],
  thresholds: ThresholdConfig,
  embedProvider: EmbeddingProvider
): Promise<Suggestion> {
  if (!initiatives || initiatives.length === 0) {
    return {
      ...suggestion,
      routing: {
        create_new: true,
      },
    };
  }

  // Get suggestion embedding
  const suggestionText = getSuggestionText(suggestion);
  const suggestionEmbed = await embedProvider.embed(suggestionText);

  // Get initiative embeddings and compute similarities
  let bestInitiative: InitiativeSnapshot | null = null;
  let bestSimilarity = 0;

  for (const initiative of initiatives) {
    const initiativeText = getInitiativeText(initiative);
    const initiativeEmbed = await embedProvider.embed(initiativeText);
    const similarity = embedProvider.computeSimilarity(
      suggestionEmbed,
      initiativeEmbed
    );

    if (similarity > bestSimilarity) {
      bestSimilarity = similarity;
      bestInitiative = initiative;
    }
  }

  // Apply routing rule
  let routing: SuggestionRouting;

  if (bestInitiative && bestSimilarity >= thresholds.T_attach) {
    routing = {
      attached_initiative_id: bestInitiative.id,
      similarity: bestSimilarity,
      create_new: false,
    };
  } else {
    routing = {
      similarity: bestSimilarity || undefined,
      create_new: true,
    };
  }

  return {
    ...suggestion,
    routing,
  };
}
