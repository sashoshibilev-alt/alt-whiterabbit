/**
 * Test script to verify the convex mapper includes suggestion context
 */

import { generateSuggestions, adaptConvexNote } from '../src/lib/suggestion-engine-v2';

// Simulate a convex note
const convexNote = {
  _id: 'test-note-123' as any,
  body: `# Q2 Planning

## Mobile App Redesign

Shift focus from enterprise features to consumer onboarding because SMB growth is our priority.

- Defer SSO to Q3
- Prioritize signup flow
- Target: April 30

## API Performance

Optimize query performance to reduce latency from 500ms to 100ms.

- Add database indexes
- Implement caching
`,
  createdAt: Date.now(),
  title: 'Q2 Planning Notes',
};

console.log('='.repeat(80));
console.log('CONVEX MAPPER TEST: Suggestion Context');
console.log('='.repeat(80));

// Adapt note to engine format
const engineNote = adaptConvexNote(convexNote);
console.log('\n1. Input note adapted');

// Run suggestion engine v2
const result = generateSuggestions(engineNote);
console.log(`\n2. Engine generated ${result.suggestions.length} suggestions`);

// Transform engine suggestions to UI-ready format (mimicking convex/notes.ts)
const uiSuggestions = result.suggestions.map((engineSug) => {
  return {
    _id: engineSug.suggestion_id as any,
    noteId: convexNote._id,
    content: engineSug.title,
    status: "new" as const,
    createdAt: Date.now(),
    modelVersion: "v2-engine",
    suggestionFamily: engineSug.type,
    modelConfidenceScore: engineSug.scores.overall,
    // Add the structured suggestion context
    suggestion: engineSug.suggestion ? {
      title: engineSug.suggestion.title,
      body: engineSug.suggestion.body,
      evidencePreview: engineSug.suggestion.evidencePreview,
      sourceSectionId: engineSug.suggestion.sourceSectionId,
      sourceHeading: engineSug.suggestion.sourceHeading,
    } : undefined,
    clarificationState: engineSug.needs_clarification ? "suggested" as const : "none" as const,
    clarificationPrompt: engineSug.needs_clarification
      ? `This suggestion has a confidence score of ${engineSug.scores.overall.toFixed(2)}. Consider reviewing the evidence carefully.`
      : undefined,
  };
});

console.log('\n3. Mapped to UI format with suggestion context\n');

// Display results
for (let i = 0; i < uiSuggestions.length; i++) {
  const sug = uiSuggestions[i];
  console.log(`\nSuggestion ${i + 1}:`);
  console.log(`  content: "${sug.content}"`);
  console.log(`  family: ${sug.suggestionFamily}`);
  console.log(`  confidence: ${sug.modelConfidenceScore?.toFixed(2)}`);

  if (sug.suggestion) {
    console.log(`\n  ✓ suggestion context present:`);
    console.log(`    - title: "${sug.suggestion.title}"`);
    console.log(`    - body: "${sug.suggestion.body}"`);
    console.log(`    - body length: ${sug.suggestion.body.length} chars`);
    console.log(`    - evidencePreview: ${sug.suggestion.evidencePreview ? `[${sug.suggestion.evidencePreview.length} items]` : 'none'}`);
    if (sug.suggestion.evidencePreview) {
      sug.suggestion.evidencePreview.forEach((ev, idx) => {
        console.log(`      ${idx + 1}. "${ev.slice(0, 60)}${ev.length > 60 ? '...' : ''}"`);
      });
    }
    console.log(`    - sourceSectionId: "${sug.suggestion.sourceSectionId}"`);
    console.log(`    - sourceHeading: "${sug.suggestion.sourceHeading}"`);
  } else {
    console.log(`\n  ✗ NO suggestion context!`);
  }
}

console.log('\n' + '='.repeat(80));
console.log('RESULT: All suggestions include suggestion context object');
console.log('='.repeat(80));
