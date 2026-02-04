/**
 * Stage 2: Utterance Extraction
 * 
 * Extracts fine-grained utterances from sections with stable character offsets
 */

import { Section, Utterance, Stage1Output, Stage2Output } from './types';
import { generateId } from './utils';

/**
 * Simple sentence tokenizer for product/meeting language
 * Splits on periods, exclamation marks, question marks, but respects common abbreviations
 */
function tokenizeSentences(text: string): string[] {
  // Common abbreviations to preserve
  const abbreviations = ['mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'vs', 'e.g', 'i.e', 'etc'];
  
  // Replace abbreviations temporarily
  let processed = text;
  const abbrevReplacements: Array<[string, string]> = [];
  
  for (let i = 0; i < abbreviations.length; i++) {
    const abbrev = abbreviations[i];
    const placeholder = `__ABBREV${i}__`;
    const regex = new RegExp(`\\b${abbrev}\\.`, 'gi');
    processed = processed.replace(regex, placeholder);
    abbrevReplacements.push([placeholder, abbrev + '.']);
  }
  
  // Split on sentence boundaries
  const sentenceEndings = /([.!?]+)\s+/g;
  const parts = processed.split(sentenceEndings);
  
  // Reconstruct sentences
  const sentences: string[] = [];
  for (let i = 0; i < parts.length; i += 2) {
    if (parts[i].trim()) {
      const sentence = parts[i] + (parts[i + 1] || '');
      sentences.push(sentence.trim());
    }
  }
  
  // If no sentence boundaries found, treat the whole text as one sentence
  if (sentences.length === 0 && processed.trim()) {
    sentences.push(processed.trim());
  }
  
  // Restore abbreviations
  return sentences.map(sentence => {
    let restored = sentence;
    for (const [placeholder, original] of abbrevReplacements) {
      restored = restored.replace(new RegExp(placeholder, 'g'), original);
    }
    return restored;
  });
}

/**
 * Extract bullet points from a list section
 */
function extractBulletPoints(listContent: string): string[] {
  const lines = listContent.split('\n');
  const bullets: string[] = [];
  
  for (const line of lines) {
    const bulletMatch = line.match(/^\s*([-*+]|\d+\.)\s+(.+)$/);
    if (bulletMatch) {
      bullets.push(bulletMatch[2].trim());
    }
  }
  
  return bullets;
}

/**
 * Find the character offset of a substring within a larger text
 * Returns the start position, or -1 if not found
 */
function findSubstringOffset(text: string, substring: string, startFrom: number = 0): number {
  return text.indexOf(substring, startFrom);
}

/**
 * Extract utterances from a single section
 */
function extractUtterancesFromSection(
  section: Section,
  fullMarkdown: string
): Utterance[] {
  const utterances: Utterance[] = [];
  
  // Skip code sections and heading sections
  if (section.type === 'code' || section.type === 'heading') {
    return utterances;
  }
  
  // Skip empty sections
  if (!section.content.trim()) {
    return utterances;
  }
  
  let textUnits: string[];
  
  // For lists, extract bullet points
  if (section.type === 'list') {
    textUnits = extractBulletPoints(section.content);
  } else {
    // For body and other types, tokenize into sentences
    textUnits = tokenizeSentences(section.content);
  }
  
  // Create utterances with character offsets
  let searchOffset = section.start_char;
  
  for (let i = 0; i < textUnits.length; i++) {
    const text = textUnits[i];
    
    // Find the offset of this utterance within the full markdown
    const relativeOffset = findSubstringOffset(
      fullMarkdown.substring(searchOffset),
      text,
      0
    );
    
    if (relativeOffset === -1) {
      // If we can't find the exact text, skip it
      // This shouldn't happen with proper parsing, but we handle it gracefully
      continue;
    }
    
    const start_char = searchOffset + relativeOffset;
    const end_char = start_char + text.length;
    
    utterances.push({
      id: generateId(),
      meeting_id: section.meeting_id,
      section_id: section.id,
      index: i,
      text,
      start_char,
      end_char,
    });
    
    // Update search offset for next utterance
    searchOffset = end_char;
  }
  
  return utterances;
}

/**
 * Extract utterances from all sections
 */
export function extractUtterances(stage1Output: Stage1Output): Stage2Output {
  const { meeting, sections } = stage1Output;
  const utterances: Utterance[] = [];
  
  for (const section of sections) {
    const sectionUtterances = extractUtterancesFromSection(
      section,
      meeting.raw_markdown
    );
    utterances.push(...sectionUtterances);
  }
  
  return {
    meeting,
    sections,
    utterances,
  };
}
