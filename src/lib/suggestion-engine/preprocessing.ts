/**
 * Suggestion Engine Preprocessing
 * 
 * Handles text normalization, segmentation, and initiative mapping.
 */

import type { Note, Initiative, Segment, StructuredSections } from './types';

// ============================================
// Text Normalization
// ============================================

/**
 * Normalize text for pattern matching (lowercase, trimmed)
 */
export function normalizeText(text: string): string {
  return text.toLowerCase().trim();
}

/**
 * Split text into sentences, handling common edge cases
 */
export function splitIntoSentences(text: string): string[] {
  // Split on sentence boundaries, being careful with abbreviations
  const sentences = text
    .replace(/([.!?])\s+/g, '$1\n')
    .split('\n')
    .map(s => s.trim())
    .filter(s => s.length > 0);
  
  return sentences;
}

/**
 * Split text into paragraphs
 */
export function splitIntoParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map(p => p.trim())
    .filter(p => p.length > 0);
}

/**
 * Extract bullet points and list items from text
 */
export function extractBulletPoints(text: string): string[] {
  const bulletPatterns = [
    /^[-*•]\s+(.+)$/gm,    // Dash, asterisk, or bullet
    /^\d+[.)]\s+(.+)$/gm,  // Numbered lists
    /^[a-z][.)]\s+(.+)$/gim, // Lettered lists
  ];

  const bullets: string[] = [];
  
  for (const pattern of bulletPatterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      bullets.push(match[1].trim());
    }
  }

  return bullets;
}

// ============================================
// Segmentation
// ============================================

let segmentCounter = 0;

/**
 * Generate a unique segment ID
 */
function generateSegmentId(): string {
  return `seg_${++segmentCounter}_${Date.now().toString(36)}`;
}

/**
 * Segment a note into processable units (sentences/bullets)
 */
export function segmentNote(note: Note): Segment[] {
  const segments: Segment[] = [];
  let index = 0;

  // Process structured sections if present
  if (note.structured_sections) {
    for (const [sectionName, items] of Object.entries(note.structured_sections)) {
      if (Array.isArray(items)) {
        for (const item of items) {
          if (typeof item === 'string' && item.trim()) {
            segments.push({
              id: generateSegmentId(),
              text: item.trim(),
              normalized_text: normalizeText(item),
              index: index++,
              section: sectionName,
            });
          }
        }
      }
    }
  }

  // Process raw text
  const rawText = note.raw_text || '';
  
  // First, try to extract bullet points
  const bullets = extractBulletPoints(rawText);
  
  if (bullets.length > 0) {
    for (const bullet of bullets) {
      segments.push({
        id: generateSegmentId(),
        text: bullet,
        normalized_text: normalizeText(bullet),
        index: index++,
      });
    }
  }
  
  // Also split into sentences for non-bullet content
  const sentences = splitIntoSentences(rawText);
  
  for (const sentence of sentences) {
    // Skip if it's already captured as a bullet
    const normalizedSentence = normalizeText(sentence);
    const alreadyCaptured = segments.some(
      seg => seg.normalized_text === normalizedSentence
    );
    
    if (!alreadyCaptured && sentence.length > 10) { // Skip very short segments
      segments.push({
        id: generateSegmentId(),
        text: sentence,
        normalized_text: normalizedSentence,
        index: index++,
      });
    }
  }

  return segments;
}

// ============================================
// Initiative Mapping
// ============================================

/**
 * Extract initiative ID patterns from text (e.g., PROJ-123, INI-456)
 */
export function extractInitiativeIds(text: string): string[] {
  const patterns = [
    /\b([A-Z]{2,10}-\d+)\b/g,  // PROJ-123, INI-456, etc.
    /\binitiative[:\s]+["']?([^"'\n,]+)["']?/gi, // "Initiative: Name"
    /\bproject[:\s]+["']?([^"'\n,]+)["']?/gi,    // "Project: Name"
  ];

  const ids: string[] = [];
  
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      ids.push(match[1].trim());
    }
  }

  return [...new Set(ids)]; // Deduplicate
}

/**
 * Check if text mentions an initiative by title (fuzzy match)
 */
export function matchesInitiativeTitle(text: string, initiative: Initiative): boolean {
  const normalizedText = normalizeText(text);
  const normalizedTitle = normalizeText(initiative.title);
  
  // Exact match
  if (normalizedText.includes(normalizedTitle)) {
    return true;
  }
  
  // Check for significant word overlap (at least 2 words with 3+ chars)
  const textWords = new Set(normalizedText.split(/\s+/).filter(w => w.length >= 3));
  const titleWords = normalizedTitle.split(/\s+/).filter(w => w.length >= 3);
  
  let matchCount = 0;
  for (const word of titleWords) {
    if (textWords.has(word)) {
      matchCount++;
    }
  }
  
  // Require at least 2 matching significant words or 60% of title words
  return matchCount >= 2 || (titleWords.length > 0 && matchCount / titleWords.length >= 0.6);
}

/**
 * Map a segment to potentially related initiatives
 */
export function mapSegmentToInitiatives(
  segment: Segment,
  initiatives: Initiative[],
  linkedInitiativeIds?: string[]
): string[] {
  const matchedIds: string[] = [];

  // First, check explicit linked initiatives
  if (linkedInitiativeIds) {
    for (const id of linkedInitiativeIds) {
      if (initiatives.some(i => i.id === id)) {
        matchedIds.push(id);
      }
    }
  }

  // Extract ID patterns from text
  const extractedIds = extractInitiativeIds(segment.text);
  for (const extractedId of extractedIds) {
    const matchingInitiative = initiatives.find(
      i => i.id === extractedId || i.title.includes(extractedId)
    );
    if (matchingInitiative && !matchedIds.includes(matchingInitiative.id)) {
      matchedIds.push(matchingInitiative.id);
    }
  }

  // Try title matching
  for (const initiative of initiatives) {
    if (!matchedIds.includes(initiative.id) && matchesInitiativeTitle(segment.text, initiative)) {
      matchedIds.push(initiative.id);
    }
  }

  return matchedIds;
}

// ============================================
// Section Detection (Heuristic)
// ============================================

const SECTION_HEADERS = {
  decisions: ['decision', 'decided', 'we decided', 'agreed', 'conclusion'],
  actions: ['action', 'todo', 'to-do', 'task', 'next step', 'follow-up', 'follow up'],
  risks: ['risk', 'concern', 'blocker', 'issue', 'problem'],
  agenda: ['agenda', 'topic', 'discussion point'],
};

/**
 * Detect if a segment is a section header
 */
export function detectSectionHeader(text: string): string | null {
  const normalized = normalizeText(text);
  
  for (const [section, keywords] of Object.entries(SECTION_HEADERS)) {
    for (const keyword of keywords) {
      // Check if it's a header (ends with colon or is short with keyword)
      if (
        normalized.includes(keyword + ':') ||
        normalized.includes(keyword + 's:') ||
        (normalized.length < 30 && normalized.includes(keyword))
      ) {
        return section;
      }
    }
  }
  
  return null;
}

/**
 * Infer structured sections from raw text
 */
export function inferStructuredSections(text: string): StructuredSections {
  const sections: StructuredSections = {};
  const lines = text.split('\n');
  
  let currentSection: string | null = null;
  let currentItems: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const header = detectSectionHeader(trimmed);
    
    if (header) {
      // Save previous section
      if (currentSection && currentItems.length > 0) {
        sections[currentSection as keyof StructuredSections] = currentItems;
      }
      currentSection = header;
      currentItems = [];
    } else if (currentSection) {
      // Add to current section
      const bullet = trimmed.replace(/^[-*•]\s*/, '').replace(/^\d+[.)]\s*/, '');
      if (bullet.length > 5) {
        currentItems.push(bullet);
      }
    }
  }

  // Save last section
  if (currentSection && currentItems.length > 0) {
    sections[currentSection as keyof StructuredSections] = currentItems;
  }

  return sections;
}

// ============================================
// Full Preprocessing Pipeline
// ============================================

export interface PreprocessingResult {
  segments: Segment[];
  structured_sections: StructuredSections;
  initiative_mappings: Map<string, string[]>; // segment_id -> initiative_ids
}

/**
 * Full preprocessing pipeline for a note
 */
export function preprocessNote(
  note: Note,
  initiatives: Initiative[]
): PreprocessingResult {
  // Infer structured sections if not provided
  const structured_sections = note.structured_sections || inferStructuredSections(note.raw_text);
  
  // Segment the note (using inferred sections if original not provided)
  const noteWithSections: Note = {
    ...note,
    structured_sections: note.structured_sections || structured_sections,
  };
  
  const segments = segmentNote(noteWithSections);
  
  // Map segments to initiatives
  const initiative_mappings = new Map<string, string[]>();
  
  for (const segment of segments) {
    const mappedIds = mapSegmentToInitiatives(
      segment,
      initiatives,
      note.linked_initiative_ids
    );
    initiative_mappings.set(segment.id, mappedIds);
  }

  return {
    segments,
    structured_sections,
    initiative_mappings,
  };
}
