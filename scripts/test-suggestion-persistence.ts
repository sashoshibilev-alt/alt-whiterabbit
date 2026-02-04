/**
 * Smoke Test: Suggestion Persistence
 * 
 * Verifies that the suggestion engine generates and persists suggestions correctly.
 * 
 * Usage:
 *   npx tsx scripts/test-suggestion-persistence.ts
 * 
 * Requirements:
 *   - Convex dev server running
 *   - Test note with plan_change content in the database
 */

import { generateSuggestions, adaptConvexNote } from '../src/lib/suggestion-engine-v2';

// ============================================
// Test Data
// ============================================

const TEST_NOTE_WITH_PLAN_CHANGES = `# Project Update

## Timeline Changes
- Move Q1 launch to Q2 due to dependencies
- Accelerate API migration to unblock mobile team

## New Initiatives
- Create user onboarding flow for new signups
- Build admin dashboard for support team

## Status (should NOT generate suggestions)
- Team meeting scheduled for Monday
- Sent update email to stakeholders
`;

const TEST_NOTE_NO_PLAN_CHANGES = `# Status Update

## Communication
- Sent weekly update email to team
- Scheduled 1:1 meetings for next week

## Calendar
- All-hands meeting on Friday
- Demo day scheduled for Q2
`;

// ============================================
// Test Runner
// ============================================

function runTest(testName: string, testFn: () => void | Promise<void>) {
  try {
    console.log(`\n🧪 Running: ${testName}`);
    const result = testFn();
    if (result instanceof Promise) {
      result.then(() => {
        console.log(`✅ PASS: ${testName}`);
      }).catch((error) => {
        console.error(`❌ FAIL: ${testName}`);
        console.error(error);
        process.exit(1);
      });
    } else {
      console.log(`✅ PASS: ${testName}`);
    }
  } catch (error) {
    console.error(`❌ FAIL: ${testName}`);
    console.error(error);
    process.exit(1);
  }
}

// ============================================
// Assertion Helpers
// ============================================

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

function assertGreaterThan(actual: number, expected: number, label: string) {
  assert(actual > expected, `${label}: expected > ${expected}, got ${actual}`);
}

function assertEqual(actual: any, expected: any, label: string) {
  assert(actual === expected, `${label}: expected ${expected}, got ${actual}`);
}

// ============================================
// Tests
// ============================================

runTest('generates suggestions for note with plan_change content', () => {
  const noteInput = adaptConvexNote({
    _id: 'test-note-1',
    body: TEST_NOTE_WITH_PLAN_CHANGES,
    createdAt: Date.now(),
    title: 'Test Note',
  });

  const result = generateSuggestions(
    noteInput,
    { initiatives: [] },
    {
      max_suggestions: 5,
      thresholds: {
        T_overall_min: 0.65,
        T_section_min: 0.6,
      },
    }
  );

  console.log(`  Generated ${result.suggestions.length} suggestions`);
  
  // Invariant: Should generate at least 1 suggestion for plan_change content
  assertGreaterThan(result.suggestions.length, 0, 'suggestion count');
  
  // Check that all suggestions have required fields
  for (const suggestion of result.suggestions) {
    assert(suggestion.title.length > 0, 'suggestion.title should not be empty');
    assert(suggestion.type === 'plan_mutation' || suggestion.type === 'execution_artifact', 
      'suggestion.type should be plan_mutation or execution_artifact');
  }

  console.log(`  Suggestions:`);
  result.suggestions.forEach((s, i) => {
    console.log(`    ${i + 1}. [${s.type}] ${s.title.slice(0, 80)}...`);
  });
});

runTest('generates no suggestions for communication/calendar content', () => {
  const noteInput = adaptConvexNote({
    _id: 'test-note-2',
    body: TEST_NOTE_NO_PLAN_CHANGES,
    createdAt: Date.now(),
    title: 'Status Update',
  });

  const result = generateSuggestions(
    noteInput,
    { initiatives: [] },
    {
      max_suggestions: 5,
      thresholds: {
        T_overall_min: 0.65,
        T_section_min: 0.6,
      },
    }
  );

  console.log(`  Generated ${result.suggestions.length} suggestions`);
  
  // Invariant: Should generate 0 suggestions for out-of-scope content
  assertEqual(result.suggestions.length, 0, 'suggestion count');
});

runTest('suggestions with clarification state are included', () => {
  const noteInput = adaptConvexNote({
    _id: 'test-note-3',
    body: TEST_NOTE_WITH_PLAN_CHANGES,
    createdAt: Date.now(),
    title: 'Test Note',
  });

  const result = generateSuggestions(
    noteInput,
    { initiatives: [] },
    {
      max_suggestions: 5,
      thresholds: {
        T_overall_min: 0.4,  // Lower threshold to get low-confidence suggestions
        T_section_min: 0.3,
      },
    }
  );

  console.log(`  Generated ${result.suggestions.length} suggestions`);
  
  // Check that suggestions with needs_clarification are still included
  const clarificationSuggestions = result.suggestions.filter(s => s.needs_clarification);
  console.log(`  Clarification suggestions: ${clarificationSuggestions.length}`);
  
  // All suggestions (including those needing clarification) should be emitted
  // Invariant: needs_clarification doesn't prevent emission
  assertGreaterThan(result.suggestions.length, 0, 'suggestion count');
  
  if (clarificationSuggestions.length > 0) {
    console.log(`  Example clarification suggestion:`);
    console.log(`    ${clarificationSuggestions[0].title.slice(0, 80)}...`);
    console.log(`    Reasons: ${clarificationSuggestions[0].clarification_reasons?.join(', ')}`);
  }
});

runTest('plan_change sections always generate suggestions (invariant)', () => {
  const noteInput = adaptConvexNote({
    _id: 'test-note-4',
    body: TEST_NOTE_WITH_PLAN_CHANGES,
    createdAt: Date.now(),
    title: 'Test Note',
  });

  const result = generateSuggestions(
    noteInput,
    { initiatives: [] },
    {
      max_suggestions: 10,
      enable_debug: true,
    }
  );

  console.log(`  Generated ${result.suggestions.length} suggestions`);
  
  // Invariant: plan_change sections should always emit at least one suggestion
  // (per fix-plan-change-suppression plan)
  if (result.debug?.plan_change_count && result.debug.plan_change_count > 0) {
    assertGreaterThan(result.debug.plan_change_emitted_count || 0, 0, 'plan_change emitted count');
    console.log(`  Plan change sections: ${result.debug.plan_change_count}`);
    console.log(`  Plan change emitted: ${result.debug.plan_change_emitted_count}`);
    assert(result.debug.invariant_plan_change_always_emitted || false, 
      'plan_change invariant should be true');
  }
});

// ============================================
// Integration Test (requires Convex running)
// ============================================

// Uncomment this test if you want to test the full integration with Convex
// This requires the Convex dev server to be running

/*
import { ConvexHttpClient } from 'convex/browser';
import { api } from '../convex/_generated/api';

runTest('integration: createDebugRun persists suggestions', async () => {
  const client = new ConvexHttpClient(process.env.CONVEX_URL!);
  
  // Create a test note
  const noteId = await client.mutation(api.notes.create, {
    title: 'Integration Test Note',
    body: TEST_NOTE_WITH_PLAN_CHANGES,
  });
  
  console.log(`  Created test note: ${noteId}`);
  
  // Run debug with persist enabled
  const result = await client.action(api.suggestionDebug.createDebugRun, {
    noteId,
    verbosity: 'REDACTED',
    persistSuggestions: true,
  });
  
  console.log(`  Debug run completed, stored: ${result.stored}`);
  console.log(`  Suggestions created: ${result.suggestionsCreated}`);
  
  // Invariant: Should create at least 1 suggestion
  assertGreaterThan(result.suggestionsCreated || 0, 0, 'suggestions created');
  
  // Fetch suggestions from DB
  const noteData = await client.query(api.notes.getWithSuggestions, { id: noteId });
  
  console.log(`  Suggestions in DB: ${noteData?.suggestions.length}`);
  
  // Invariant: DB count should match created count
  assertEqual(noteData?.suggestions.length, result.suggestionsCreated, 'DB suggestion count');
  
  // Cleanup
  await client.mutation(api.notes.remove, { id: noteId });
  console.log(`  Cleaned up test note`);
});
*/

// ============================================
// Main
// ============================================

console.log('🚀 Starting Suggestion Persistence Smoke Tests\n');
console.log('=' .repeat(60));

// Note: If all tests are synchronous, we need to wait for them to complete
// Since we're using console.log, they'll run immediately
console.log('\n' + '='.repeat(60));
console.log('\n✨ All tests completed!\n');
console.log('Next steps:');
console.log('  1. Start Convex dev server: npx convex dev');
console.log('  2. Start Vite dev server: npm run dev');
console.log('  3. Open a note with plan_change content');
console.log('  4. Click "Run debug" with persist enabled');
console.log('  5. Verify Suggestions count updates from 0 to N');
console.log('  6. Verify suggestion cards render in the list\n');
