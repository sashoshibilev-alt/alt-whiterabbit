/**
 * Suggestion Engine Test Harness
 * 
 * Offline test harness for validating the suggestion engine.
 * Run with: npx tsx src/lib/suggestion-engine/test-harness.ts
 */

import {
  generateSuggestions,
  Note,
  Initiative,
  Suggestion,
  GeneratorConfig,
} from './index';

// ============================================
// Test Fixtures
// ============================================

const TEST_INITIATIVES: Initiative[] = [
  {
    id: 'init-001',
    title: 'User Onboarding Revamp',
    status: 'active',
    owner_name: 'Alice',
    priority: 'HIGH',
    timeline: {
      start: Date.now() - 30 * 24 * 60 * 60 * 1000,
      end: Date.now() + 60 * 24 * 60 * 60 * 1000,
      description: 'Q1 2026',
    },
    scope: 'Redesign the user onboarding flow to improve activation rates',
  },
  {
    id: 'init-002',
    title: 'Infrastructure Migration',
    status: 'active',
    owner_name: 'Bob',
    priority: 'MEDIUM',
    timeline: {
      description: 'Q2 2026',
    },
    scope: 'Migrate from AWS to GCP',
  },
  {
    id: 'init-003',
    title: 'Mobile App Launch',
    status: 'draft',
    owner_name: 'Charlie',
    priority: 'LOW',
    description: 'Launch native mobile apps for iOS and Android',
  },
];

// ============================================
// Test Cases
// ============================================

interface TestCase {
  name: string;
  note: Note;
  expectedBehavior: 'suggestions' | 'no_suggestions';
  expectedTypes?: ('PLAN_MUTATION' | 'EXECUTION_ARTIFACT')[];
  expectedMinCount?: number;
  expectedMaxCount?: number;
  shouldNotContain?: string[]; // Patterns that should NOT appear in suggestions
}

const TEST_CASES: TestCase[] = [
  // ===========================================
  // Zero-Suggestion Scenarios (Product Rules)
  // ===========================================
  {
    name: 'Status update only - should return no suggestions',
    note: {
      id: 'note-001',
      raw_text: `
        Weekly standup notes:
        - Alice gave an update on the onboarding project
        - Bob mentioned the migration is on track
        - No blockers reported
        - Team morale is good
      `,
      created_at: Date.now(),
    },
    expectedBehavior: 'no_suggestions',
  },
  {
    name: 'Communication tasks only - should return no suggestions',
    note: {
      id: 'note-002',
      raw_text: `
        Meeting outcomes:
        - Send the meeting summary to stakeholders
        - Email the team about next week's schedule
        - Share notes with everyone who couldn't attend
        - Notify the PM about the timeline update
      `,
      created_at: Date.now(),
    },
    expectedBehavior: 'no_suggestions',
  },
  {
    name: 'Calendar/scheduling only - should return no suggestions',
    note: {
      id: 'note-003',
      raw_text: `
        Action items:
        - Schedule a follow-up meeting for next week
        - Book a room for the design review
        - Set up a recurring sync with the team
        - Find time to chat with the new hire
      `,
      created_at: Date.now(),
    },
    expectedBehavior: 'no_suggestions',
  },
  {
    name: 'Generic follow-ups - should return no suggestions',
    note: {
      id: 'note-004',
      raw_text: `
        Remember to:
        - Follow up with the team
        - Touch base next week
        - Keep this in mind for future discussions
        - Stay aligned on priorities
      `,
      created_at: Date.now(),
    },
    expectedBehavior: 'no_suggestions',
  },
  {
    name: 'Vague research ideas - should return no suggestions',
    note: {
      id: 'note-005',
      raw_text: `
        Ideas discussed:
        - Maybe we should interview some users
        - Could do some A/B testing
        - Might want to survey the team
        - Think about doing user research
      `,
      created_at: Date.now(),
    },
    expectedBehavior: 'no_suggestions',
  },

  // ===========================================
  // Timeline Mutation Scenarios
  // ===========================================
  {
    name: 'Timeline change - explicit delay',
    note: {
      id: 'note-010',
      raw_text: `
        Decision: We need to push the User Onboarding Revamp to Q2 due to resource constraints.
        The original Q1 deadline is no longer feasible.
      `,
      created_at: Date.now(),
    },
    expectedBehavior: 'suggestions',
    expectedTypes: ['PLAN_MUTATION'],
    expectedMinCount: 1,
  },
  {
    name: 'Timeline change - pull in deadline',
    note: {
      id: 'note-011',
      raw_text: `
        Good news: We can move up the Infrastructure Migration to end of this month.
        Bob's team finished the prep work early.
      `,
      created_at: Date.now(),
    },
    expectedBehavior: 'suggestions',
    expectedTypes: ['PLAN_MUTATION'],
  },

  // ===========================================
  // Priority Mutation Scenarios
  // ===========================================
  {
    name: 'Priority change - escalation',
    note: {
      id: 'note-020',
      raw_text: `
        Due to competitive pressure, the Mobile App Launch is now top priority.
        We need to ship before the competitor launches their app.
      `,
      created_at: Date.now(),
    },
    expectedBehavior: 'suggestions',
    expectedTypes: ['PLAN_MUTATION'],
  },
  {
    name: 'Priority change - deprioritization',
    note: {
      id: 'note-021',
      raw_text: `
        We decided to deprioritize the Infrastructure Migration until after the mobile launch.
        It's going to the back burner for now.
      `,
      created_at: Date.now(),
    },
    expectedBehavior: 'suggestions',
    expectedTypes: ['PLAN_MUTATION'],
  },

  // ===========================================
  // New Initiative Scenarios
  // ===========================================
  {
    name: 'New initiative - explicit creation',
    note: {
      id: 'note-030',
      raw_text: `
        Decision: We should spin up a new initiative for API versioning.
        Sarah will own this. Goal is to have v2 API ready by end of Q2.
        This will support the mobile app launch.
      `,
      created_at: Date.now(),
    },
    expectedBehavior: 'suggestions',
    expectedTypes: ['EXECUTION_ARTIFACT'],
  },
  {
    name: 'New initiative - should NOT suggest for vague ideas',
    note: {
      id: 'note-031',
      raw_text: `
        We should think about maybe having an initiative for improving docs.
        Something to consider for the future.
      `,
      created_at: Date.now(),
    },
    expectedBehavior: 'no_suggestions',
  },
  {
    name: 'Mixed note - timeline change + new initiative',
    note: {
      id: 'note-040',
      raw_text: `
        Meeting notes:
        
        Decisions:
        1. Push the User Onboarding Revamp deadline to end of March
        2. Create a new initiative for Performance Monitoring - Tom to own, deliver by end of Q1
        
        Action items:
        - Send out summary (Alice)
        - Schedule follow-up
      `,
      created_at: Date.now(),
    },
    expectedBehavior: 'suggestions',
    expectedMinCount: 1, // At least one of the two decisions
    expectedMaxCount: 3, // Capped at 3
    shouldNotContain: ['send', 'schedule', 'follow-up'], // Communication should be filtered
  },

  // ===========================================
  // Ownership Change Scenarios
  // ===========================================
  {
    name: 'Ownership change - handoff',
    note: {
      id: 'note-050',
      raw_text: `
        Handoff: David will take over the User Onboarding Revamp from Alice.
        Alice is moving to a different team next month.
      `,
      created_at: Date.now(),
    },
    expectedBehavior: 'suggestions',
    expectedTypes: ['PLAN_MUTATION'],
  },

  // ===========================================
  // Status Change Scenarios
  // ===========================================
  {
    name: 'Status change - pause initiative',
    note: {
      id: 'note-060',
      raw_text: `
        Decision: We're pausing the Infrastructure Migration until Q3.
        Resources need to focus on the mobile launch.
      `,
      created_at: Date.now(),
    },
    expectedBehavior: 'suggestions',
    expectedTypes: ['PLAN_MUTATION'],
  },
  {
    name: 'Status change - initiative complete',
    note: {
      id: 'note-061',
      raw_text: `
        Good news! The User Onboarding Revamp is done.
        Shipped last night and metrics look good.
      `,
      created_at: Date.now(),
    },
    expectedBehavior: 'suggestions',
    expectedTypes: ['PLAN_MUTATION'],
  },
];

// ============================================
// Test Runner
// ============================================

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  suggestions?: Suggestion[];
  debug?: unknown;
}

function runTestCase(testCase: TestCase, config?: Partial<GeneratorConfig>): TestResult {
  try {
    const result = generateSuggestions(
      testCase.note,
      TEST_INITIATIVES,
      undefined,
      { ...config, enable_debug: true }
    );

    const suggestions = result.suggestions;
    const suggestionCount = suggestions.length;

    // Check expected behavior
    if (testCase.expectedBehavior === 'no_suggestions' && suggestionCount > 0) {
      return {
        name: testCase.name,
        passed: false,
        error: `Expected no suggestions, got ${suggestionCount}`,
        suggestions,
        debug: result.debug,
      };
    }

    if (testCase.expectedBehavior === 'suggestions' && suggestionCount === 0) {
      return {
        name: testCase.name,
        passed: false,
        error: 'Expected suggestions, got none',
        debug: result.debug,
      };
    }

    // Check expected types
    if (testCase.expectedTypes && suggestions.length > 0) {
      const actualTypes = suggestions.map(s => s.type);
      for (const expectedType of testCase.expectedTypes) {
        if (!actualTypes.includes(expectedType)) {
          return {
            name: testCase.name,
            passed: false,
            error: `Expected type ${expectedType} not found. Got: ${actualTypes.join(', ')}`,
            suggestions,
          };
        }
      }
    }

    // Check min count
    if (testCase.expectedMinCount !== undefined && suggestionCount < testCase.expectedMinCount) {
      return {
        name: testCase.name,
        passed: false,
        error: `Expected at least ${testCase.expectedMinCount} suggestions, got ${suggestionCount}`,
        suggestions,
      };
    }

    // Check max count
    if (testCase.expectedMaxCount !== undefined && suggestionCount > testCase.expectedMaxCount) {
      return {
        name: testCase.name,
        passed: false,
        error: `Expected at most ${testCase.expectedMaxCount} suggestions, got ${suggestionCount}`,
        suggestions,
      };
    }

    // Check forbidden patterns
    if (testCase.shouldNotContain && suggestions.length > 0) {
      for (const pattern of testCase.shouldNotContain) {
        const found = suggestions.some(s => {
          const content = JSON.stringify(s).toLowerCase();
          return content.includes(pattern.toLowerCase());
        });
        if (found) {
          return {
            name: testCase.name,
            passed: false,
            error: `Suggestion should not contain "${pattern}"`,
            suggestions,
          };
        }
      }
    }

    return {
      name: testCase.name,
      passed: true,
      suggestions,
    };
  } catch (error) {
    return {
      name: testCase.name,
      passed: false,
      error: `Exception: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

// ============================================
// Main Entry Point
// ============================================

export function runTestHarness(): void {
  console.log('='.repeat(60));
  console.log('SUGGESTION ENGINE TEST HARNESS');
  console.log('='.repeat(60));
  console.log();

  const results: TestResult[] = [];
  let passed = 0;
  let failed = 0;

  for (const testCase of TEST_CASES) {
    const result = runTestCase(testCase);
    results.push(result);

    if (result.passed) {
      passed++;
      console.log(`✓ ${result.name}`);
      if (result.suggestions && result.suggestions.length > 0) {
        console.log(`  → ${result.suggestions.length} suggestion(s)`);
      }
    } else {
      failed++;
      console.log(`✗ ${result.name}`);
      console.log(`  ERROR: ${result.error}`);
      if (result.suggestions) {
        console.log(`  Suggestions: ${JSON.stringify(result.suggestions, null, 2)}`);
      }
      if (result.debug) {
        console.log(`  Debug: ${JSON.stringify(result.debug, null, 2)}`);
      }
    }
    console.log();
  }

  console.log('='.repeat(60));
  console.log(`RESULTS: ${passed} passed, ${failed} failed, ${TEST_CASES.length} total`);
  console.log('='.repeat(60));

  // Exit with error code if any tests failed
  if (failed > 0) {
    process.exit(1);
  }
}

// Run if executed directly
if (typeof require !== 'undefined' && require.main === module) {
  runTestHarness();
}

// Also export for programmatic use
export { TEST_CASES, TEST_INITIATIVES, runTestCase };
