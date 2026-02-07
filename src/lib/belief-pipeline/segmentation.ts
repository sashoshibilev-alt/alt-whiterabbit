/**
 * Stage 1: Section Segmentation
 * 
 * Parses markdown into sections with stable character offsets
 */

import { NormalizedMeetingNote, Section, SectionType, Stage1Output } from './types';
import { generateId } from './utils';

/**
 * Simple markdown block type
 */
interface MarkdownBlock {
  type: 'heading' | 'paragraph' | 'list' | 'code' | 'empty';
  content: string;
  start_char: number;
  end_char: number;
  heading_level?: number;
  heading_text?: string;
}

/**
 * Parse markdown into blocks
 * This is a simple parser that handles headings, lists, code blocks, and paragraphs
 */
function parseMarkdownBlocks(markdown: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  const lines = markdown.split('\n');
  
  let currentChar = 0;
  let i = 0;
  
  while (i < lines.length) {
    const line = lines[i];
    const lineStart = currentChar;
    const lineEnd = currentChar + line.length + 1; // +1 for newline
    
    // Heading
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      blocks.push({
        type: 'heading',
        content: line,
        start_char: lineStart,
        end_char: lineEnd,
        heading_level: headingMatch[1].length,
        heading_text: headingMatch[2].trim(),
      });
      currentChar = lineEnd;
      i++;
      continue;
    }

    // Numbered section heading (e.g., "1. Customer Feedback", "1. next steps")
    // No indentation (starts at column 0) to distinguish from list items
    const numberedHeadingMatch = line.match(/^(\d+)\.\s+(.+)$/);
    if (numberedHeadingMatch) {
      blocks.push({
        type: 'heading',
        content: line,
        start_char: lineStart,
        end_char: lineEnd,
        heading_level: 2, // treat as h2
        heading_text: numberedHeadingMatch[2].trim(),
      });
      currentChar = lineEnd;
      i++;
      continue;
    }
    
    // Code block (fenced)
    if (line.trim().startsWith('```')) {
      const codeStart = lineStart;
      i++;
      currentChar = lineEnd;
      
      const codeLines: string[] = [line];
      while (i < lines.length) {
        const codeLine = lines[i];
        codeLines.push(codeLine);
        currentChar += codeLine.length + 1;
        
        if (codeLine.trim().startsWith('```')) {
          i++;
          break;
        }
        i++;
      }
      
      blocks.push({
        type: 'code',
        content: codeLines.join('\n'),
        start_char: codeStart,
        end_char: currentChar,
      });
      continue;
    }
    
    // List item
    const listMatch = line.match(/^(\s*)([-*+]|\d+\.)\s+(.+)$/);
    if (listMatch) {
      const listStart = lineStart;
      const listLines: string[] = [line];
      i++;
      currentChar = lineEnd;
      
      // Collect consecutive list items
      while (i < lines.length) {
        const nextLine = lines[i];
        const nextListMatch = nextLine.match(/^(\s*)([-*+]|\d+\.)\s+(.+)$/);
        
        if (nextListMatch || (nextLine.trim() === '' && i + 1 < lines.length)) {
          listLines.push(nextLine);
          currentChar += nextLine.length + 1;
          i++;
        } else {
          break;
        }
      }
      
      blocks.push({
        type: 'list',
        content: listLines.join('\n'),
        start_char: listStart,
        end_char: currentChar,
      });
      continue;
    }
    
    // Empty line
    if (line.trim() === '') {
      blocks.push({
        type: 'empty',
        content: line,
        start_char: lineStart,
        end_char: lineEnd,
      });
      currentChar = lineEnd;
      i++;
      continue;
    }
    
    // Paragraph (collect consecutive non-empty, non-special lines)
    const paraStart = lineStart;
    const paraLines: string[] = [line];
    i++;
    currentChar = lineEnd;
    
    while (i < lines.length) {
      const nextLine = lines[i];
      
      // Stop if we hit a heading, list, code, or empty line
      if (
        nextLine.trim() === '' ||
        nextLine.match(/^#{1,6}\s+/) ||
        nextLine.match(/^(\s*)([-*+]|\d+\.)\s+/) ||
        nextLine.trim().startsWith('```')
      ) {
        break;
      }
      
      paraLines.push(nextLine);
      currentChar += nextLine.length + 1;
      i++;
    }
    
    blocks.push({
      type: 'paragraph',
      content: paraLines.join('\n'),
      start_char: paraStart,
      end_char: currentChar,
    });
  }
  
  return blocks;
}

/**
 * Convert markdown blocks to sections
 */
function blocksToSections(
  blocks: MarkdownBlock[],
  meetingId: string
): Section[] {
  const sections: Section[] = [];
  let currentHeading: string | null = null;
  let sectionIndex = 0;
  
  for (const block of blocks) {
    // Skip empty blocks
    if (block.type === 'empty') {
      continue;
    }
    
    // Update current heading
    if (block.type === 'heading') {
      currentHeading = block.heading_text || null;
      
      // Create a section for the heading itself
      sections.push({
        id: generateId(),
        meeting_id: meetingId,
        index: sectionIndex++,
        title: currentHeading,
        type: 'heading',
        start_char: block.start_char,
        end_char: block.end_char,
        content: block.content,
      });
      continue;
    }
    
    // Determine section type
    let sectionType: SectionType;
    switch (block.type) {
      case 'list':
        sectionType = 'list';
        break;
      case 'code':
        sectionType = 'code';
        break;
      case 'paragraph':
        sectionType = 'body';
        break;
      default:
        sectionType = 'other';
    }
    
    // Create section with current heading context
    sections.push({
      id: generateId(),
      meeting_id: meetingId,
      index: sectionIndex++,
      title: currentHeading,
      type: sectionType,
      start_char: block.start_char,
      end_char: block.end_char,
      content: block.content,
    });
  }
  
  return sections;
}

/**
 * Segment a normalized meeting note into sections
 */
export function segmentMeetingNote(note: NormalizedMeetingNote): Stage1Output {
  const blocks = parseMarkdownBlocks(note.raw_markdown);
  const sections = blocksToSections(blocks, note.id);
  
  return {
    meeting: note,
    sections,
  };
}
