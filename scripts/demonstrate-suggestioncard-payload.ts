/**
 * Demonstration: What SuggestionCard receives after the fix
 *
 * This script shows the exact payload structure that SuggestionCard
 * will receive for real suggestions (from getWithComputedSuggestions action)
 */

import { generateSuggestions, adaptConvexNote } from '../src/lib/suggestion-engine-v2';

// Simulate a real note from the database
const realNote = {
  _id: 'note_abc123' as any,
  body: `# Sprint Retrospective

## Mobile Redesign Progress

Great progress on the redesign, but we need to push the release to mid-March because the gesture system is more complex than anticipated.

Additional testing required for navigation patterns to ensure smooth user experience.

- Complete gesture system by March 1
- Beta testing March 1-10
- Target launch: March 15
`,
  createdAt: 1706745600000,
  title: 'Mobile App Sprint Retro',
};

console.log('='.repeat(80));
console.log('DEMONSTRATION: SuggestionCard Payload');
console.log('='.repeat(80));
console.log('\nThis shows what SuggestionCard receives for REAL computed suggestions');
console.log('(from convex/notes.ts getWithComputedSuggestions action)\n');

// Step 1: Engine generates suggestions
const engineNote = adaptConvexNote(realNote);
const engineResult = generateSuggestions(engineNote);

// Step 2: Convex action maps to V0Suggestion format (with suggestion context)
const suggestionForUI = engineResult.suggestions.map((engineSug) => ({
  _id: engineSug.suggestion_id as any,
  noteId: realNote._id,
  content: engineSug.title,
  status: "new" as const,
  createdAt: Date.now(),
  modelVersion: "v2-engine",
  suggestionFamily: engineSug.type,
  modelConfidenceScore: engineSug.scores.overall,
  // THIS IS THE KEY: suggestion context object
  suggestion: engineSug.suggestion ? {
    title: engineSug.suggestion.title,
    body: engineSug.suggestion.body,
    evidencePreview: engineSug.suggestion.evidencePreview,
    sourceSectionId: engineSug.suggestion.sourceSectionId,
    sourceHeading: engineSug.suggestion.sourceHeading,
  } : undefined,
}))[0]; // Take first suggestion for demo

if (!suggestionForUI) {
  console.log('No suggestions generated for this note');
  process.exit(1);
}

console.log('Suggestion object received by SuggestionCard:');
console.log('─'.repeat(80));
console.log(JSON.stringify(suggestionForUI, null, 2));

console.log('\n' + '─'.repeat(80));
console.log('\nHow SuggestionCard renders this:');
console.log('─'.repeat(80));

// Show how SuggestionCard uses the data (from SuggestionCard.tsx lines 32-36)
const displayTitle = suggestionForUI.suggestion?.title || suggestionForUI.content;
const displayBody = suggestionForUI.suggestion?.body;
const evidencePreview = suggestionForUI.suggestion?.evidencePreview;
const sourceSectionId = suggestionForUI.suggestion?.sourceSectionId;

console.log('\n1. TITLE (line 73):');
console.log(`   <h4>{displayTitle}</h4>`);
console.log(`   → "${displayTitle}"`);

console.log('\n2. BODY (lines 86-90):');
if (displayBody) {
  console.log(`   <p className="line-clamp-3">{displayBody}</p>`);
  console.log(`   → "${displayBody}"`);
} else {
  console.log('   (not rendered - no body)');
}

console.log('\n3. EVIDENCE TOGGLE (lines 98-117):');
if (evidencePreview && evidencePreview.length > 0) {
  console.log(`   <Collapsible>`);
  console.log(`     <CollapsibleTrigger>Evidence</CollapsibleTrigger>`);
  console.log(`     <CollapsibleContent>`);
  evidencePreview.slice(0, 2).forEach((line, idx) => {
    console.log(`       ${idx + 1}. "${line}"`);
  });
  console.log(`     </CollapsibleContent>`);
  console.log(`   </Collapsible>`);
} else {
  console.log('   (not rendered - no evidence preview)');
}

console.log('\n4. SOURCE NAVIGATION (lines 45-51):');
if (sourceSectionId) {
  console.log(`   onClick: scrollToSection("${sourceSectionId}")`);
  console.log(`   → Navigates to: "${suggestionForUI.suggestion?.sourceHeading}"`);
} else {
  console.log('   (no navigation - no source section)');
}

console.log('\n' + '='.repeat(80));
console.log('RESULT: ✓ SuggestionCard now displays:');
console.log('  • Title (from suggestion.title)');
console.log('  • Body with line-clamp-3 (from suggestion.body)');
console.log('  • Evidence toggle (when suggestion.evidencePreview exists)');
console.log('  • Source navigation (via suggestion.sourceSectionId)');
console.log('='.repeat(80));
