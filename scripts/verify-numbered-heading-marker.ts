/**
 * Verify that the debug marker appears for numbered headings
 *
 * This script confirms that suggestion-engine-v2 preprocessing adds
 * the _debug_segmentation_version marker when numbered headings are detected.
 */

import { preprocessNote } from '../src/lib/suggestion-engine-v2/preprocessing';
import type { NoteInput } from '../src/lib/suggestion-engine-v2/types';

const testNote: NoteInput = {
  note_id: 'marker-test',
  raw_markdown: `1. Customer Feedback

We heard concerns about pricing complexity from 3 enterprise prospects.

2. Technical Debt

The authentication flow needs refactoring.

# Regular Markdown Heading

This should not have the marker.`,
};

console.log('Testing numbered heading marker detection...\n');

const result = preprocessNote(testNote);

console.log(`Total sections: ${result.sections.length}\n`);

result.sections.forEach((section, idx) => {
  console.log(`Section ${idx + 1}:`);
  console.log(`  Heading: ${section.heading_text}`);
  console.log(`  Debug marker: ${section._debug_segmentation_version || 'none'}`);
  console.log(`  First line text: "${section.body_lines[0]?.text || '(no body)'}"`);
  console.log('');
});

// Verify markers
const customerSection = result.sections.find(s => s.heading_text === 'Customer Feedback');
const techDebtSection = result.sections.find(s => s.heading_text === 'Technical Debt');
const regularSection = result.sections.find(s => s.heading_text === 'Regular Markdown Heading');

if (!customerSection) {
  console.error('❌ FAIL: Customer Feedback section not found');
  process.exit(1);
}

if (customerSection._debug_segmentation_version !== 'v2-numbered-headings') {
  console.error(`❌ FAIL: Customer Feedback section missing marker (got: ${customerSection._debug_segmentation_version})`);
  process.exit(1);
}

if (!techDebtSection) {
  console.error('❌ FAIL: Technical Debt section not found');
  process.exit(1);
}

if (techDebtSection._debug_segmentation_version !== 'v2-numbered-headings') {
  console.error(`❌ FAIL: Technical Debt section missing marker (got: ${techDebtSection._debug_segmentation_version})`);
  process.exit(1);
}

if (!regularSection) {
  console.error('❌ FAIL: Regular Markdown Heading section not found');
  process.exit(1);
}

if (regularSection._debug_segmentation_version !== undefined) {
  console.error(`❌ FAIL: Regular Markdown Heading should NOT have marker (got: ${regularSection._debug_segmentation_version})`);
  process.exit(1);
}

console.log('✅ SUCCESS: Debug marker correctly identifies numbered headings');
console.log('');
console.log('Summary:');
console.log('- Numbered headings (1., 2.) have marker: v2-numbered-headings');
console.log('- Regular markdown headings (#) have no marker');
console.log('');
console.log('The marker will appear in debug JSON if this code is running at runtime.');
