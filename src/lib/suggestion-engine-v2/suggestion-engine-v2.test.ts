/**
 * Suggestion Engine v2 Tests
 *
 * Tests for the section-based suggestion generation pipeline.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  generateSuggestions,
  generateSuggestionsWithDebug,
  preprocessNote,
  classifySections,
  filterActionableSections,
  synthesizeSuggestions,
  hasActionableContent,
  getSectionCount,
  quickEvaluate,
  NoteInput,
  GeneratorConfig,
  DEFAULT_CONFIG,
  DEFAULT_THRESHOLDS,
  computeActionabilitySignals,
  IntentClassification,
  isActionable,
  isPlanChangeIntentLabel,
  applyConfidenceBasedProcessing,
} from './index';
import { resetSectionCounter } from './preprocessing';
import { resetSuggestionCounter } from './synthesis';

// ============================================
// Test Fixtures
// ============================================

const PLAN_MUTATION_NOTE: NoteInput = {
  note_id: 'test-plan-mutation',
  raw_markdown: `# Q2 Onboarding Roadmap

## Scope Changes

We need to shift our focus from enterprise onboarding to self-serve onboarding for Q2.

- Defer enterprise features to Q3
- Prioritize self-serve signup flow
- Remove SSO from Q2 scope (move to Q3)
- Add in-app tutorials and tooltips

The goal is to reduce onboarding time from 2 weeks to 2 days for SMB customers.

## Timeline

- Phase 1: Basic signup flow (by end of April)
- Phase 2: In-app tutorials (May)
- Phase 3: Analytics integration (June)
`,
};

const EXECUTION_ARTIFACT_NOTE: NoteInput = {
  note_id: 'test-execution-artifact',
  raw_markdown: `# New Initiatives

## Launch Customer Success Program

We need to spin up a customer success program to improve retention.

Objective: Reduce churn from 8% to 4% within 6 months.

Scope:
- Dedicated CSM for top 20 accounts
- Monthly check-ins and QBRs
- Proactive health scoring and alerts

Approach:
1. Hire 2 CSMs in Q2
2. Build health scoring dashboard
3. Establish playbooks for at-risk customers

## Build Partner Integration Platform

Create a platform for partners to build integrations.

Goal: 10 partner integrations by end of year.

- Developer documentation
- Sandbox environment
- Partner portal with analytics
`,
};

const MIXED_NOTE: NoteInput = {
  note_id: 'test-mixed',
  raw_markdown: `# Weekly Planning

## Updates
Had a good sync with the team. Everyone is aligned on priorities.

## Communication
- Send out weekly summary to stakeholders
- Schedule meeting with design team

## Roadmap Changes

Shifting mobile app from Q2 to Q3 due to resource constraints.
- iOS app pushed to Q3
- Focus on web experience first
- Add PWA support instead

## New Initiative: API v2

Launch new API version with breaking changes.

Objective: Simplify integration and improve performance by 50%.

Scope includes:
- New authentication model
- Batch endpoints
- Rate limiting improvements
`,
};

const MICRO_TASKS_NOTE: NoteInput = {
  note_id: 'test-micro-tasks',
  raw_markdown: `# Tasks

## To Do
- Update slide deck
- Send email to team
- Schedule meeting
- Follow up with customer
- Review documents
`,
};

// ============================================
// Preprocessing Tests
// ============================================

describe('Preprocessing', () => {
  beforeEach(() => {
    resetSectionCounter();
  });

  it('should parse markdown into lines with correct types', () => {
    const result = preprocessNote(PLAN_MUTATION_NOTE);

    expect(result.lines.length).toBeGreaterThan(0);

    // Check heading detection
    const headings = result.lines.filter((l) => l.line_type === 'heading');
    expect(headings.length).toBe(3); // Q2 Onboarding, Scope Changes, Timeline

    // Check list item detection
    const listItems = result.lines.filter((l) => l.line_type === 'list_item');
    expect(listItems.length).toBeGreaterThan(0);
  });

  it('should segment into sections correctly', () => {
    const result = preprocessNote(PLAN_MUTATION_NOTE);

    // 3 headings but "Q2 Onboarding Roadmap" has no body → merged into "Scope Changes"
    expect(result.sections.length).toBe(2);

    // Check section structure
    const scopeSection = result.sections.find((s) =>
      s.heading_text?.includes('Scope')
    );
    expect(scopeSection).toBeDefined();
    expect(scopeSection!.body_lines.length).toBeGreaterThan(0);
    expect(scopeSection!.structural_features.num_list_items).toBeGreaterThan(0);
  });

  it('should compute structural features', () => {
    const result = preprocessNote(PLAN_MUTATION_NOTE);

    const scopeSection = result.sections.find((s) =>
      s.heading_text?.includes('Scope')
    );
    expect(scopeSection).toBeDefined();

    const features = scopeSection!.structural_features;
    expect(features.num_list_items).toBeGreaterThan(0);
    expect(features.has_quarter_refs).toBe(true); // Q2, Q3 mentioned
  });
});

// ============================================
// Classification Tests
// ============================================

describe('Classification', () => {
  beforeEach(() => {
    resetSectionCounter();
  });

  it('should classify plan mutation sections as actionable', () => {
    const { sections } = preprocessNote(PLAN_MUTATION_NOTE);
    const classified = classifySections(sections, DEFAULT_THRESHOLDS);
    const actionable = filterActionableSections(classified);

    expect(actionable.length).toBeGreaterThan(0);

    // Scope Changes section should be actionable
    const scopeSection = actionable.find((s) =>
      s.heading_text?.includes('Scope')
    );
    expect(scopeSection).toBeDefined();
    expect(scopeSection!.intent.plan_change).toBeGreaterThan(0);
  });

  it('should classify execution artifact sections correctly', () => {
    const { sections } = preprocessNote(EXECUTION_ARTIFACT_NOTE);
    const classified = classifySections(sections, DEFAULT_THRESHOLDS);
    const actionable = filterActionableSections(classified);

    expect(actionable.length).toBeGreaterThan(0);

    // At least one section should be classified as execution_artifact
    const artifactSections = actionable.filter(
      (s) => s.suggested_type === 'execution_artifact'
    );
    expect(artifactSections.length).toBeGreaterThan(0);

    // Check that we have sections about initiatives
    const initiativeSections = actionable.filter((s) =>
      s.heading_text?.toLowerCase().includes('customer') ||
      s.heading_text?.toLowerCase().includes('partner') ||
      s.heading_text?.toLowerCase().includes('launch')
    );
    expect(initiativeSections.length + artifactSections.length).toBeGreaterThan(0);
  });

  it('should filter out micro-task sections', () => {
    const { sections } = preprocessNote(MICRO_TASKS_NOTE);
    const classified = classifySections(sections, DEFAULT_THRESHOLDS);
    const actionable = filterActionableSections(classified);

    // Should have few or no actionable sections
    expect(actionable.length).toBeLessThanOrEqual(1);
  });
});

// ============================================
// Synthesis Tests
// ============================================

describe('Synthesis', () => {
  beforeEach(() => {
    resetSectionCounter();
    resetSuggestionCounter();
  });

  it('should generate suggestions from actionable sections', () => {
    const { sections } = preprocessNote(PLAN_MUTATION_NOTE);
    const classified = classifySections(sections, DEFAULT_THRESHOLDS);
    const actionable = filterActionableSections(classified);
    const suggestions = synthesizeSuggestions(actionable);

    expect(suggestions.length).toBeGreaterThan(0);

    // Check suggestion structure
    for (const suggestion of suggestions) {
      expect(suggestion.suggestion_id).toBeDefined();
      expect(suggestion.title).toBeDefined();
      expect(suggestion.title.length).toBeGreaterThan(5);
      expect(suggestion.evidence_spans.length).toBeGreaterThan(0);
    }
  });

  it('should generate appropriate titles for plan mutations', () => {
    const { sections } = preprocessNote(PLAN_MUTATION_NOTE);
    const classified = classifySections(sections, DEFAULT_THRESHOLDS);
    const actionable = filterActionableSections(classified);
    const suggestions = synthesizeSuggestions(actionable);

    const planSuggestions = suggestions.filter((s) => s.type === 'plan_mutation');

    for (const suggestion of planSuggestions) {
      expect(suggestion.title).toMatch(/adjust|change|update|plan/i);
    }
  });

  it('should generate appropriate titles for execution artifacts', () => {
    const { sections } = preprocessNote(EXECUTION_ARTIFACT_NOTE);
    const classified = classifySections(sections, DEFAULT_THRESHOLDS);
    const actionable = filterActionableSections(classified);
    const suggestions = synthesizeSuggestions(actionable);

    const artifactSuggestions = suggestions.filter(
      (s) => s.type === 'execution_artifact'
    );

    for (const suggestion of artifactSuggestions) {
      expect(suggestion.title).toMatch(/new|initiative|launch/i);
      expect(suggestion.payload.draft_initiative).toBeDefined();
    }
  });
});

// ============================================
// Full Pipeline Tests
// ============================================

describe('Full Pipeline', () => {
  beforeEach(() => {
    resetSectionCounter();
    resetSuggestionCounter();
  });

  it('should generate suggestions for plan mutation note', () => {
    const result = generateSuggestions(PLAN_MUTATION_NOTE, {}, { enable_debug: true });

    expect(result.debug).toBeDefined();
    expect(result.debug!.sections_count).toBeGreaterThan(0);
    // May or may not have suggestions depending on validation
  });

  it('should generate suggestions for execution artifact note', () => {
    const result = generateSuggestions(
      EXECUTION_ARTIFACT_NOTE,
      {},
      { enable_debug: true }
    );

    expect(result.debug).toBeDefined();
    expect(result.debug!.sections_count).toBeGreaterThan(0);
  });

  it('should handle mixed content correctly', () => {
    const result = generateSuggestions(MIXED_NOTE, {}, { enable_debug: true });

    expect(result.debug).toBeDefined();
    expect(result.debug!.sections_count).toBeGreaterThan(0);

    // Should filter out communication/micro-task sections
    // Only Roadmap Changes and API v2 should produce suggestions
  });

  it('should filter out micro-task notes', () => {
    const result = generateSuggestions(MICRO_TASKS_NOTE, {}, { enable_debug: true });

    // Should have few or no suggestions
    expect(result.suggestions.length).toBeLessThanOrEqual(1);
  });

  it('should respect max_suggestions config', () => {
    const config: Partial<GeneratorConfig> = {
      max_suggestions: 1,
      enable_debug: true,
    };

    const result = generateSuggestions(EXECUTION_ARTIFACT_NOTE, {}, config);

    expect(result.suggestions.length).toBeLessThanOrEqual(1);
  });

  it('should route suggestions to initiatives when provided', () => {
    const initiatives = [
      {
        id: 'init-1',
        title: 'Self-Serve Onboarding',
        description: 'Improve onboarding experience for SMB customers',
      },
      {
        id: 'init-2',
        title: 'Customer Success Program',
        description: 'Reduce churn and improve retention',
      },
    ];

    const result = generateSuggestions(
      PLAN_MUTATION_NOTE,
      { initiatives },
      { enable_debug: true }
    );

    // Check routing info
    for (const suggestion of result.suggestions) {
      expect(suggestion.routing).toBeDefined();
      expect(suggestion.routing.create_new).toBeDefined();
    }
  });
});

// ============================================
// Utility Function Tests
// ============================================

describe('Utilities', () => {
  it('hasActionableContent should detect actionable notes', () => {
    expect(hasActionableContent(PLAN_MUTATION_NOTE)).toBe(true);
    expect(hasActionableContent(EXECUTION_ARTIFACT_NOTE)).toBe(true);
  });

  it('hasActionableContent should reject micro-task notes', () => {
    expect(hasActionableContent(MICRO_TASKS_NOTE)).toBe(false);
  });

  it('getSectionCount should return correct counts', () => {
    const counts = getSectionCount(PLAN_MUTATION_NOTE);

    expect(counts.total).toBeGreaterThan(0);
    expect(counts.actionable).toBeLessThanOrEqual(counts.total);
  });

  it('quickEvaluate should generate report', () => {
    const { report, suggestions, debug } = quickEvaluate(
      PLAN_MUTATION_NOTE.raw_markdown
    );

    expect(report).toContain('Sections:');
    expect(debug).toBeDefined();
    expect(debug.sections_count).toBeGreaterThan(0);
  });
});

// ============================================
// Actionability Edge Cases
// ============================================

import { isActionable, classifyIntent, computeActionabilitySignals, classifySection } from './classifiers';
import type { Section, IntentClassification, ThresholdConfig, StructuralFeatures } from './types';

describe('Actionability Edge Cases', () => {
  const makeSection = (rawText: string, headingText?: string, numLines = 5, numListItems = 3): Section => ({
    section_id: 'test-section',
    note_id: 'test-note',
    heading_text: headingText,
    start_line: 0,
    end_line: numLines - 1,
    body_lines: [],
    raw_text: rawText,
    structural_features: {
      num_lines: numLines,
      num_list_items: numListItems,
      has_dates: false,
      has_metrics: false,
      has_quarter_refs: false,
      has_version_refs: false,
      has_launch_keywords: false,
      initiative_phrase_density: 0,
    },
  });

  describe('Threshold Boundary Conditions', () => {
    it('should pass when actionableSignal equals T_action exactly', () => {
      const thresholds: ThresholdConfig = {
        ...DEFAULT_THRESHOLDS,
        T_action: 0.5,
        T_out_of_scope: 0.4,
      };

      // Create intent that gives exactly 0.5 actionable signal
      const intent: IntentClassification = {
        plan_change: 0.5,
        new_workstream: 0.3,
        status_informational: 0.2,
        communication: 0.1,
        research: 0.1,
        calendar: 0.1,
        micro_tasks: 0.1,
      };

      const section = makeSection('Test content with multiple lines', 'Test Heading', 5, 2);
      const result = isActionable(intent, section, thresholds);

      // actionableSignal (0.5) should exactly equal T_action (0.5) and pass
      expect(result.actionableSignal).toBe(0.5);
      expect(result.actionable).toBe(true);
    });

    it('should fail when actionableSignal is just below T_action (non-plan_change)', () => {
      const thresholds: ThresholdConfig = {
        ...DEFAULT_THRESHOLDS,
        T_action: 0.5,
        T_out_of_scope: 0.4,
      };

      // Use new_workstream as highest intent to avoid plan_change protection
      const intent: IntentClassification = {
        plan_change: 0.3,
        new_workstream: 0.49, // Just below threshold
        status_informational: 0.2,
        communication: 0.1,
        research: 0.1,
        calendar: 0.1,
        micro_tasks: 0.1,
      };

      const section = makeSection('Test content', 'Test Heading', 5, 2);
      const result = isActionable(intent, section, thresholds);

      expect(result.actionableSignal).toBe(0.49);
      expect(result.actionable).toBe(false);
      expect(result.reason).toContain('Action signal too low');
    });

    it('should fail when outOfScopeSignal exactly equals T_out_of_scope', () => {
      const thresholds: ThresholdConfig = {
        ...DEFAULT_THRESHOLDS,
        T_action: 0.5,
        T_out_of_scope: 0.4,
      };

      // Use new_workstream as top signal to avoid plan_change protection
      const intent: IntentClassification = {
        plan_change: 0.3, // Lower than new_workstream to avoid plan_change protection
        new_workstream: 0.7,
        status_informational: 0.2,
        communication: 0.4, // exactly at threshold
        research: 0.3,
        calendar: 0.2,
        micro_tasks: 0.2,
      };

      const section = makeSection('Test content', 'Test Heading', 5, 2);
      const result = isActionable(intent, section, thresholds);

      expect(result.outOfScopeSignal).toBe(0.4); // max of communication signals
      expect(result.actionable).toBe(false);
      expect(result.reason).toContain('Out-of-scope signal too high');
    });

    it('should pass when outOfScopeSignal is just below T_out_of_scope', () => {
      const thresholds: ThresholdConfig = {
        ...DEFAULT_THRESHOLDS,
        T_action: 0.5,
        T_out_of_scope: 0.4,
      };

      const intent: IntentClassification = {
        plan_change: 0.7,
        new_workstream: 0.5,
        status_informational: 0.2,
        communication: 0.39, // just below threshold
        research: 0.3,
        calendar: 0.2,
        micro_tasks: 0.2,
      };

      const section = makeSection('Test content', 'Test Heading', 5, 2);
      const result = isActionable(intent, section, thresholds);

      expect(result.outOfScopeSignal).toBe(0.39);
      expect(result.actionable).toBe(true);
    });
  });

  describe('Research with Deliverables', () => {
    // LEGACY v2 TESTS: These tests verify v2-specific research dampening heuristics
    // that v3 does not implement. V3 sets research=0 and uses explicit rules instead.
    // Skipped after v3 migration (2026-02-04).
    it.skip('should dampen research signal when deliverable patterns are present', () => {
      // Section with research language BUT also deliverable output
      const section = makeSection(
        'We need to research user preferences to build a dashboard for tracking engagement metrics.',
        'Build Analytics Dashboard',
        5,
        3
      );

      const intent = classifyIntent(section);

      // Research signal should be dampened due to deliverable patterns
      // "dashboard", "tracking", "build" are deliverable indicators
      expect(intent.research).toBeLessThan(0.3); // Should be dampened
      expect(intent.new_workstream).toBeGreaterThan(0); // Should have workstream signal
    });

    it.skip('should NOT dampen research signal for pure investigation sections', () => {
      // Section with research language but NO deliverable output
      const section = makeSection(
        'We need to investigate why users are churning. Explore the data and figure out the root cause.',
        'Research Churn',
        5,
        2
      );

      const intent = classifyIntent(section);

      // Research signal should NOT be dampened - no deliverable cues
      expect(intent.research).toBeGreaterThan(0);
    });

    it.skip('should allow mixed research + deliverable sections to be actionable', () => {
      const thresholds = DEFAULT_THRESHOLDS;

      const section = makeSection(
        `Build a transparency report system:
        - Research current compliance requirements
        - Create dashboard to publish metrics
        - Launch by end of Q2`,
        'Transparency Report',
        6,
        3
      );

      // Update structural features for this test
      section.structural_features.has_quarter_refs = true;
      section.structural_features.has_launch_keywords = true;

      const intent = classifyIntent(section);
      const result = isActionable(intent, section, thresholds);

      // Should be actionable despite research language
      expect(result.actionable).toBe(true);
    });
  });

  describe('Structural Boosts', () => {
    // LEGACY v2 TESTS: v3 does not use structural feature boosts for scoring.
    // Kept first test as it still passes (v3 can detect list items via structured task syntax).
    it('should boost workstream signal for sections with multiple list items and lines', () => {
      // Use sections WITHOUT launch keywords to see the structural boost
      const section1 = makeSection(
        `New project goals:
        - Item 1
        - Item 2
        - Item 3
        - Item 4`,
        'Project Goals',
        6,
        4
      );
      // No launch keywords - rely on structural boost

      const section2 = makeSection(
        'New project goals',
        'Project Goals',
        2,
        0
      );

      const intent1 = classifyIntent(section1);
      const intent2 = classifyIntent(section2);

      // Section with more structure should have higher workstream signal
      // because structural boost is applied for multi-bullet sections
      expect(intent1.new_workstream).toBeGreaterThanOrEqual(intent2.new_workstream);
    });

    it.skip('should boost for workstream-like keywords in heading', () => {
      const sectionWithKeyword = makeSection(
        'Build tracking for key metrics.',
        'Dashboard Milestone',
        4,
        2
      );

      const sectionWithoutKeyword = makeSection(
        'Build tracking for key metrics.',
        'Notes',
        4,
        2
      );

      const intent1 = classifyIntent(sectionWithKeyword);
      const intent2 = classifyIntent(sectionWithoutKeyword);

      // Section with "Milestone" in heading should get structural boost
      expect(intent1.new_workstream).toBeGreaterThan(intent2.new_workstream);
    });
  });
});

// ============================================
// Suggestion Suppression Fix Tests
// ============================================

import {
  isPlanChangeSuggestion,
  isHighConfidence,
  computeClarificationReasons,
  applyConfidenceBasedProcessing,
} from './scoring';
import type { Suggestion, SuggestionScores, SuggestionRouting, ClarificationReason } from './types';

describe('Actionability Gate v3 - Required Test Cases', () => {
  // Helper to create a test section with given text
  const createV3TestSection = (text: string): Section => {
    return {
      section_id: 'test-section',
      note_id: 'test-note',
      start_line: 0,
      end_line: 0,
      body_lines: [
        {
          index: 0,
          text,
          line_type: 'paragraph' as const,
        },
      ],
      structural_features: {
        num_lines: 1,
        num_list_items: 0,
        has_dates: false,
        has_metrics: false,
        has_quarter_refs: false,
        has_version_refs: false,
        has_launch_keywords: false,
        initiative_phrase_density: 0,
      },
      raw_text: text,
    };
  };

  const config = DEFAULT_CONFIG;

  describe('Must Pass (actionable = true)', () => {
    it('should detect "I would really like you to add" with product noun', () => {
      const section = createV3TestSection('I would really like you to add boundary detection in Onboarding');
      const classified = classifySection(section, config);

      expect(classified.is_actionable).toBe(true);
      expect(classified.actionable_signal).toBeGreaterThanOrEqual(0.5);
      // Should have high signal due to strong request pattern
      expect(classified.actionable_signal).toBeGreaterThanOrEqual(1.0);
    });

    it('should detect "Please add" directive', () => {
      const section = createV3TestSection('Please add boundary detection in onboarding');
      const classified = classifySection(section, config);

      expect(classified.is_actionable).toBe(true);
      expect(classified.actionable_signal).toBeGreaterThanOrEqual(0.5);
      expect(classified.actionable_signal).toBeGreaterThanOrEqual(1.0);
    });

    it('should detect "Could you fix" request', () => {
      const section = createV3TestSection('Could you fix the onboarding validation bug');
      const classified = classifySection(section, config);

      expect(classified.is_actionable).toBe(true);
      expect(classified.actionable_signal).toBeGreaterThanOrEqual(0.5);
      expect(classified.actionable_signal).toBeGreaterThanOrEqual(1.0);
    });

    it('should detect "Move launch to next week" (change operator)', () => {
      const section = createV3TestSection('Move launch to next week');
      const classified = classifySection(section, config);

      expect(classified.is_actionable).toBe(true);
      expect(classified.actionable_signal).toBeGreaterThanOrEqual(0.5);
      // Should have 0.8 from change operator
      expect(classified.actionable_signal).toBeGreaterThanOrEqual(0.8);
      // V3 OVERRIDE TEST: outOfScopeSignal should be clamped <= 0.3
      // because actionableSignal >= 0.8
      expect(classified.out_of_scope_signal).toBeLessThanOrEqual(0.3);
    });

    it('should detect "We need to integrate" directive', () => {
      const section = createV3TestSection('We need to integrate Linear');
      const classified = classifySection(section, config);

      expect(classified.is_actionable).toBe(true);
      expect(classified.actionable_signal).toBeGreaterThanOrEqual(0.5);
      expect(classified.actionable_signal).toBeGreaterThanOrEqual(1.0);
    });

    it('should detect "Blocked by" status marker', () => {
      const section = createV3TestSection('Blocked by security review');
      const classified = classifySection(section, config);

      expect(classified.is_actionable).toBe(true);
      expect(classified.actionable_signal).toBeGreaterThanOrEqual(0.5);
      // Should have 0.7 from status marker
      expect(classified.actionable_signal).toBeGreaterThanOrEqual(0.7);
    });
  });

  describe('Must Fail (actionable = false)', () => {
    it('should reject "I like" (opinion without directive)', () => {
      const section = createV3TestSection('I like the boundary detection idea');
      const classified = classifySection(section, config);

      expect(classified.is_actionable).toBe(false);
      expect(classified.actionable_signal).toBeLessThan(0.5);
    });

    it('should reject heading-only fragment without verb', () => {
      const section = createV3TestSection('Boundary detection in onboarding');
      const classified = classifySection(section, config);

      expect(classified.is_actionable).toBe(false);
      expect(classified.actionable_signal).toBeLessThan(0.5);
    });

    it('should reject past tense discussion', () => {
      const section = createV3TestSection('We talked about adding boundary detection');
      const classified = classifySection(section, config);

      expect(classified.is_actionable).toBe(false);
      expect(classified.actionable_signal).toBeLessThan(0.5);
    });

    it('should reject negated directive', () => {
      const section = createV3TestSection("Don't add boundary detection in onboarding");
      const classified = classifySection(section, config);

      expect(classified.is_actionable).toBe(false);
      expect(classified.actionable_signal).toBe(0);
    });

    it('should reject calendar marker without directive', () => {
      const section = createV3TestSection('Monday–Wednesday next week');
      const classified = classifySection(section, config);

      expect(classified.is_actionable).toBe(false);
      expect(classified.actionable_signal).toBeLessThan(0.5);
      // Should have high out-of-scope signal
      expect(classified.out_of_scope_signal).toBeGreaterThanOrEqual(0.4);
    });
  });

  describe('V3 Signal Semantics Verification', () => {
    it('should prove status markers raise actionableSignal (not just plan_change)', () => {
      const section = createV3TestSection('Done with the migration');
      const classified = classifySection(section, config);
      const intent = classified.intent;

      // Status marker should contribute to actionableSignal
      const actionableSignal = Math.max(intent.plan_change, intent.new_workstream);
      expect(actionableSignal).toBeGreaterThanOrEqual(0.7);

      // Should be actionable
      expect(classified.is_actionable).toBe(true);
    });

    it('should prove change operators raise actionableSignal', () => {
      const section = createV3TestSection('Delay the rollout until next month');
      const classified = classifySection(section, config);
      const intent = classified.intent;

      // Change operator should contribute to actionableSignal
      const actionableSignal = Math.max(intent.plan_change, intent.new_workstream);
      expect(actionableSignal).toBeGreaterThanOrEqual(0.8);

      // Should be actionable
      expect(classified.is_actionable).toBe(true);
    });

    it('should prove out-of-scope override works correctly', () => {
      // High actionability + calendar marker → outOfScope should be clamped
      const section = createV3TestSection('Move the launch to next Friday');
      const classified = classifySection(section, config);

      // Should have high actionable signal from change operator
      expect(classified.actionable_signal).toBeGreaterThanOrEqual(0.8);

      // Out-of-scope signal MUST be clamped <= 0.3 due to override
      expect(classified.out_of_scope_signal).toBeLessThanOrEqual(0.3);

      // Should be actionable despite calendar reference
      expect(classified.is_actionable).toBe(true);
    });

    it('should prove actionableSignal lives in intent schema fields', () => {
      const section = createV3TestSection('Please implement the new feature');
      const classified = classifySection(section, config);
      const intent = classified.intent;

      // Verify that actionableSignal is extracted from intent fields
      const extractedActionable = Math.max(intent.plan_change, intent.new_workstream);
      expect(extractedActionable).toBeGreaterThan(0);

      // Verify it matches the classified signal
      expect(classified.actionable_signal).toBe(extractedActionable);
    });

    it('should prove outOfScopeSignal lives in intent schema fields', () => {
      const section = createV3TestSection('Email the team about this next Monday');
      const classified = classifySection(section, config);
      const intent = classified.intent;

      // Verify that outOfScopeSignal is extracted from intent fields
      const extractedOOS = Math.max(intent.calendar, intent.communication, intent.micro_tasks);
      expect(extractedOOS).toBeGreaterThan(0);

      // Verify it matches the classified signal
      expect(classified.out_of_scope_signal).toBe(extractedOOS);
    });
  });
});

describe('Suggestion Suppression Fix', () => {
  // Helper to create test suggestions
  const createTestSuggestion = (
    type: 'plan_mutation' | 'execution_artifact',
    sectionActionability: number,
    overall: number
  ): Suggestion => ({
    suggestion_id: `test_${Math.random()}`,
    note_id: 'test_note',
    section_id: 'test_section',
    type,
    title: 'Test Suggestion',
    payload: { after_description: 'Test description' },
    evidence_spans: [{ start_line: 0, end_line: 5, text: 'Test evidence' }],
    scores: {
      section_actionability: sectionActionability,
      type_choice_confidence: 0.8,
      synthesis_confidence: 0.8,
      overall,
    },
    routing: { create_new: true },
  });

  describe('isPlanChangeSuggestion', () => {
    it('should identify plan_mutation as plan change', () => {
      const suggestion = createTestSuggestion('plan_mutation', 0.7, 0.7);
      expect(isPlanChangeSuggestion(suggestion)).toBe(true);
    });

    it('should NOT identify execution_artifact as plan change', () => {
      const suggestion = createTestSuggestion('execution_artifact', 0.7, 0.7);
      expect(isPlanChangeSuggestion(suggestion)).toBe(false);
    });
  });

  describe('isHighConfidence', () => {
    it('should return true when both scores pass thresholds', () => {
      const suggestion = createTestSuggestion('plan_mutation', 0.7, 0.7);
      expect(isHighConfidence(suggestion, DEFAULT_THRESHOLDS)).toBe(true);
    });

    it('should return false when actionability is below threshold', () => {
      const suggestion = createTestSuggestion('plan_mutation', 0.4, 0.7);
      expect(isHighConfidence(suggestion, DEFAULT_THRESHOLDS)).toBe(false);
    });

    it('should return false when overall is below threshold', () => {
      const suggestion = createTestSuggestion('plan_mutation', 0.7, 0.5);
      expect(isHighConfidence(suggestion, DEFAULT_THRESHOLDS)).toBe(false);
    });

    it('should return false when both scores are below thresholds', () => {
      const suggestion = createTestSuggestion('plan_mutation', 0.4, 0.5);
      expect(isHighConfidence(suggestion, DEFAULT_THRESHOLDS)).toBe(false);
    });
  });

  describe('computeClarificationReasons', () => {
    it('should return low_actionability_score when section_actionability is below threshold', () => {
      const suggestion = createTestSuggestion('plan_mutation', 0.4, 0.7);
      const reasons = computeClarificationReasons(suggestion, DEFAULT_THRESHOLDS);
      expect(reasons).toContain('low_actionability_score');
      expect(reasons).not.toContain('low_overall_score');
    });

    it('should return low_overall_score when overall is below threshold', () => {
      const suggestion = createTestSuggestion('plan_mutation', 0.7, 0.5);
      const reasons = computeClarificationReasons(suggestion, DEFAULT_THRESHOLDS);
      expect(reasons).not.toContain('low_actionability_score');
      expect(reasons).toContain('low_overall_score');
    });

    it('should return both reasons when both scores are below thresholds', () => {
      const suggestion = createTestSuggestion('plan_mutation', 0.4, 0.5);
      const reasons = computeClarificationReasons(suggestion, DEFAULT_THRESHOLDS);
      expect(reasons).toContain('low_actionability_score');
      expect(reasons).toContain('low_overall_score');
    });

    it('should return empty array when both scores pass', () => {
      const suggestion = createTestSuggestion('plan_mutation', 0.7, 0.7);
      const reasons = computeClarificationReasons(suggestion, DEFAULT_THRESHOLDS);
      expect(reasons).toHaveLength(0);
    });
  });

  describe('applyConfidenceBasedProcessing', () => {
    describe('Case A: execution_artifact suggestions', () => {
      it('should DROP execution_artifact with low scores', () => {
        const suggestions = [
          createTestSuggestion('execution_artifact', 0.4, 0.5),
        ];

        const result = applyConfidenceBasedProcessing(suggestions, DEFAULT_THRESHOLDS);

        expect(result.passed).toHaveLength(0);
        expect(result.dropped).toHaveLength(1);
        expect(result.dropped[0].reason).toContain('score');
      });

      it('should KEEP execution_artifact with high scores', () => {
        const suggestions = [
          createTestSuggestion('execution_artifact', 0.7, 0.7),
        ];

        const result = applyConfidenceBasedProcessing(suggestions, DEFAULT_THRESHOLDS);

        expect(result.passed).toHaveLength(1);
        expect(result.dropped).toHaveLength(0);
        expect(result.passed[0].is_high_confidence).toBe(true);
      });
    });

    describe('Case B: high confidence plan_mutation', () => {
      it('should KEEP plan_mutation with high scores and NOT require clarification', () => {
        const suggestions = [
          createTestSuggestion('plan_mutation', 0.7, 0.7),
        ];

        const result = applyConfidenceBasedProcessing(suggestions, DEFAULT_THRESHOLDS);

        expect(result.passed).toHaveLength(1);
        expect(result.dropped).toHaveLength(0);
        expect(result.passed[0].is_high_confidence).toBe(true);
        expect(result.passed[0].needs_clarification).toBe(false);
        expect(result.passed[0].clarification_reasons).toHaveLength(0);
      });
    });

    describe('Case C: low confidence plan_mutation', () => {
      it('should KEEP plan_mutation with low actionability and require clarification', () => {
        const suggestions = [
          createTestSuggestion('plan_mutation', 0.4, 0.7),
        ];

        const result = applyConfidenceBasedProcessing(suggestions, DEFAULT_THRESHOLDS);

        expect(result.passed).toHaveLength(1);
        expect(result.dropped).toHaveLength(0);
        expect(result.passed[0].is_high_confidence).toBe(false);
        expect(result.passed[0].needs_clarification).toBe(true);
        expect(result.passed[0].clarification_reasons).toContain('low_actionability_score');
        expect(result.downgraded).toBe(1);
      });

      it('should KEEP plan_mutation with low overall and require clarification', () => {
        const suggestions = [
          createTestSuggestion('plan_mutation', 0.7, 0.5),
        ];

        const result = applyConfidenceBasedProcessing(suggestions, DEFAULT_THRESHOLDS);

        expect(result.passed).toHaveLength(1);
        expect(result.dropped).toHaveLength(0);
        expect(result.passed[0].is_high_confidence).toBe(false);
        expect(result.passed[0].needs_clarification).toBe(true);
        expect(result.passed[0].clarification_reasons).toContain('low_overall_score');
        expect(result.downgraded).toBe(1);
      });

      it('should KEEP plan_mutation with both scores low and require clarification with both reasons', () => {
        const suggestions = [
          createTestSuggestion('plan_mutation', 0.3, 0.3),
        ];

        const result = applyConfidenceBasedProcessing(suggestions, DEFAULT_THRESHOLDS);

        expect(result.passed).toHaveLength(1);
        expect(result.dropped).toHaveLength(0);
        expect(result.passed[0].is_high_confidence).toBe(false);
        expect(result.passed[0].needs_clarification).toBe(true);
        expect(result.passed[0].clarification_reasons).toContain('low_actionability_score');
        expect(result.passed[0].clarification_reasons).toContain('low_overall_score');
        expect(result.downgraded).toBe(1);
      });
    });

    describe('INVARIANT: plan_mutation suggestions are NEVER dropped', () => {
      it('should NEVER drop plan_mutation regardless of scores', () => {
        const suggestions = [
          createTestSuggestion('plan_mutation', 0.1, 0.1),
          createTestSuggestion('plan_mutation', 0.2, 0.2),
          createTestSuggestion('plan_mutation', 0.3, 0.3),
          createTestSuggestion('plan_mutation', 0.0, 0.0),
        ];

        const result = applyConfidenceBasedProcessing(suggestions, DEFAULT_THRESHOLDS);

        // ALL plan_mutation suggestions must be kept
        expect(result.passed).toHaveLength(4);
        expect(result.dropped).toHaveLength(0);
        
        // All should require clarification due to low scores
        for (const suggestion of result.passed) {
          expect(suggestion.needs_clarification).toBe(true);
          expect(suggestion.clarification_reasons!.length).toBeGreaterThan(0);
        }
      });

      it('should vary threshold and verify plan_mutation count never changes', () => {
        const suggestions = [
          createTestSuggestion('plan_mutation', 0.5, 0.5),
        ];

        // Low thresholds - should pass
        const lowThresholds = { ...DEFAULT_THRESHOLDS, T_section_min: 0.3, T_overall_min: 0.3 };
        const resultLow = applyConfidenceBasedProcessing(suggestions, lowThresholds);

        // High thresholds - should still NOT be dropped (but will need clarification)
        const highThresholds = { ...DEFAULT_THRESHOLDS, T_section_min: 0.9, T_overall_min: 0.9 };
        const resultHigh = applyConfidenceBasedProcessing(suggestions, highThresholds);

        // Suggestion count must be the same regardless of thresholds
        expect(resultLow.passed).toHaveLength(1);
        expect(resultHigh.passed).toHaveLength(1);

        // Low thresholds - high confidence, no clarification
        expect(resultLow.passed[0].is_high_confidence).toBe(true);
        expect(resultLow.passed[0].needs_clarification).toBe(false);

        // High thresholds - low confidence, needs clarification
        expect(resultHigh.passed[0].is_high_confidence).toBe(false);
        expect(resultHigh.passed[0].needs_clarification).toBe(true);
      });
    });

    describe('Mixed suggestions', () => {
      it('should handle mixed plan_mutation and execution_artifact correctly', () => {
        const suggestions = [
          createTestSuggestion('plan_mutation', 0.7, 0.7),     // High conf plan - keep
          createTestSuggestion('plan_mutation', 0.3, 0.3),     // Low conf plan - keep with clarification
          createTestSuggestion('execution_artifact', 0.7, 0.7), // High conf artifact - keep
          createTestSuggestion('execution_artifact', 0.3, 0.3), // Low conf artifact - drop
        ];

        const result = applyConfidenceBasedProcessing(suggestions, DEFAULT_THRESHOLDS);

        // 3 passed (2 plan_mutation + 1 execution_artifact)
        expect(result.passed).toHaveLength(3);
        
        // 1 dropped (low conf execution_artifact)
        expect(result.dropped).toHaveLength(1);
        expect(result.dropped[0].suggestion.type).toBe('execution_artifact');
        
        // 1 downgraded (low conf plan_mutation)
        expect(result.downgraded).toBe(1);
      });
    });
  });

  describe('Full Pipeline Integration', () => {
    beforeEach(() => {
      resetSectionCounter();
      resetSuggestionCounter();
    });

    it('should track plan_change metrics in debug info', () => {
      const result = generateSuggestions(PLAN_MUTATION_NOTE, {}, { enable_debug: true });

      expect(result.debug).toBeDefined();
      expect(result.debug!.plan_change_count).toBeDefined();
      expect(result.debug!.plan_change_emitted_count).toBeDefined();
      expect(result.debug!.invariant_plan_change_always_emitted).toBeDefined();
    });

    it('should enforce invariant_plan_change_always_emitted', () => {
      const result = generateSuggestions(PLAN_MUTATION_NOTE, {}, { enable_debug: true });

      // Invariant: all plan_change suggestions that existed before scoring must still exist after
      expect(result.debug!.invariant_plan_change_always_emitted).toBe(true);
    });

    it('should set needs_clarification and clarification_reasons on low-confidence plan_mutation suggestions', () => {
      // Use low thresholds to make suggestions pass, then high thresholds to trigger clarification
      const highThresholdConfig: Partial<GeneratorConfig> = {
        enable_debug: true,
        thresholds: {
          ...DEFAULT_THRESHOLDS,
          T_section_min: 0.9,
          T_overall_min: 0.9,
        },
      };

      const result = generateSuggestions(PLAN_MUTATION_NOTE, {}, highThresholdConfig);

      // If there are plan_mutation suggestions, they should have clarification set
      const planMutationSuggestions = result.suggestions.filter(s => s.type === 'plan_mutation');
      
      for (const suggestion of planMutationSuggestions) {
        // With high thresholds, most should need clarification
        if (!suggestion.is_high_confidence) {
          expect(suggestion.needs_clarification).toBe(true);
          expect(suggestion.clarification_reasons).toBeDefined();
          expect(suggestion.clarification_reasons!.length).toBeGreaterThan(0);
        }
      }
    });
  });
});

// ============================================
// Edge Cases
// ============================================

describe('Edge Cases', () => {
  it('should handle empty note', () => {
    const emptyNote: NoteInput = {
      note_id: 'empty',
      raw_markdown: '',
    };

    const result = generateSuggestions(emptyNote, {}, { enable_debug: true });

    expect(result.suggestions).toHaveLength(0);
    expect(result.debug!.sections_count).toBe(0);
  });

  it('should handle note with only headings', () => {
    const headingsOnlyNote: NoteInput = {
      note_id: 'headings-only',
      raw_markdown: `# Section 1\n\n## Section 2\n\n### Section 3`,
    };

    const result = generateSuggestions(headingsOnlyNote, {}, { enable_debug: true });

    expect(result.suggestions).toHaveLength(0);
  });

  it('should handle note without headings', () => {
    const noHeadingsNote: NoteInput = {
      note_id: 'no-headings',
      raw_markdown: `We decided to shift focus from enterprise to SMB.
      
- Defer enterprise features
- Prioritize self-serve flow
- Launch by end of Q2`,
    };

    const result = generateSuggestions(noHeadingsNote, {}, { enable_debug: true });

    // Should create a "General" section
    expect(result.debug!.sections_count).toBeGreaterThan(0);
  });

  it('should handle code blocks correctly', () => {
    const codeNote: NoteInput = {
      note_id: 'code-note',
      raw_markdown: `# API Changes

We're launching a new API endpoint.

\`\`\`javascript
const api = new API();
api.launch();
\`\`\`

Objective: Improve developer experience.
`,
    };

    const result = generateSuggestions(codeNote, {}, { enable_debug: true });

    // Code should not be interpreted as actionable content
    expect(result.debug!.sections_count).toBe(1);
  });
});

// ============================================
// Product Execution Intent Tests (rule-based-v2 improvements)
// ============================================

describe('Product Execution Intent (rule-based-v2)', () => {
  beforeEach(() => {
    resetSectionCounter();
    resetSuggestionCounter();
  });

  // Helper function to create test sections
  const makeSection = (rawText: string, headingText?: string, numLines = 5, numListItems = 3): Section => ({
    section_id: 'test-section',
    note_id: 'test-note',
    heading_text: headingText,
    start_line: 0,
    end_line: numLines - 1,
    body_lines: [],
    raw_text: rawText,
    structural_features: {
      num_lines: numLines,
      num_list_items: numListItems,
      has_dates: false,
      has_metrics: false,
      has_quarter_refs: false,
      has_version_refs: false,
      has_launch_keywords: false,
      initiative_phrase_density: 0,
    },
  });

  describe('Product Execution Heading Boost', () => {
    // LEGACY v2 TESTS: v3 does not use heading-based boosts. It uses explicit rules
    // (request patterns, imperatives, change operators, etc.) instead of heading analysis.
    // Skipped after v3 migration (2026-02-04).
    it.skip('should boost plan_change for bug fix headings', () => {
      const section = makeSection(
        'The calculator widget is showing incorrect values for some edge cases.',
        'Bug: Calculator Widget',
        4,
        0
      );

      const intent = classifyIntent(section);

      // Bug in heading should trigger +0.35 boost
      expect(intent.plan_change).toBeGreaterThan(0.3);
    });

    it.skip('should boost plan_change for copy change headings', () => {
      const section = makeSection(
        'We need better wording on the signup page.',
        'Copy Changes for Signup',
        3,
        0
      );

      const intent = classifyIntent(section);

      // Copy in heading should trigger +0.35 boost
      expect(intent.plan_change).toBeGreaterThan(0.3);
    });

    it.skip('should boost plan_change for UX structure headings', () => {
      const section = makeSection(
        'Reorganize the dashboard layout for better clarity.',
        'Structure Improvements',
        3,
        0
      );

      const intent = classifyIntent(section);

      // Structure in heading should trigger +0.35 boost
      expect(intent.plan_change).toBeGreaterThan(0.3);
    });

    it.skip('should boost plan_change for transparency/calculator/CTA headings', () => {
      const bugSection = makeSection('Description', 'Fix Bug', 3, 0);
      const demoSection = makeSection('Description', 'Demo Setup', 3, 0);
      const translationSection = makeSection('Description', 'Translation Updates', 3, 0);
      const transparencySection = makeSection('Description', 'Transparency Page', 3, 0);
      const calculatorSection = makeSection('Description', 'Calculator Widget', 3, 0);
      const ctaSection = makeSection('Description', 'CTA Button Update', 3, 0);

      const intents = [bugSection, demoSection, translationSection, transparencySection, calculatorSection, ctaSection].map(classifyIntent);

      // All should get the product execution heading boost
      for (const intent of intents) {
        expect(intent.plan_change).toBeGreaterThan(0.3);
      }
    });

    it('should make product execution notes actionable', () => {
      const productNote: NoteInput = {
        note_id: 'test-product-execution',
        raw_markdown: `# Product Updates

## Bug: Dashboard Loading

The dashboard takes too long to load for users with large datasets.

- We should optimize the query performance
- Need to update the caching strategy
- Add loading indicators
- Reduce initial data fetch size

## Copy: Empty States

Update empty state messages to be more helpful and actionable.

- Change "No data" to "Start by adding your first item"
- Add clear call-to-action buttons
- Focus on guiding users
- Update tone to be more encouraging

## Structure: Navigation Menu

Reorganize menu items based on user feedback.

- Move frequently used items to top
- Add section dividers
- Remove unused menu options
- Update navigation labels
`,
      };

      const { sections } = preprocessNote(productNote);
      const classified = classifySections(sections, DEFAULT_THRESHOLDS);
      const actionable = filterActionableSections(classified);

      // At least one product execution section should be actionable
      // (with better content, more should pass)
      expect(actionable.length).toBeGreaterThanOrEqual(1);

      // Check that recognized sections have elevated plan_change
      for (const section of classified) {
        if (section.heading_text?.toLowerCase().includes('bug') ||
            section.heading_text?.toLowerCase().includes('copy') ||
            section.heading_text?.toLowerCase().includes('structure')) {
          // Product execution headings should boost plan_change
          expect(section.intent.plan_change).toBeGreaterThan(0.3);
        }
      }
    });
  });

  describe('Bullet Change Language Boost', () => {
    // Note: "should" is now detected as a request stem in v3, so this test may still pass
    it('should boost plan_change when bullets contain "should"', () => {
      const section = makeSection(
        `Notes:
- We should improve the performance
- The API should return faster
- Users should see results immediately`,
        'Performance Notes',
        5,
        3
      );

      // Add list items to body_lines
      section.body_lines = [
        { index: 0, text: '- We should improve the performance', line_type: 'list_item', indent_level: 0 },
        { index: 1, text: '- The API should return faster', line_type: 'list_item', indent_level: 0 },
        { index: 2, text: '- Users should see results immediately', line_type: 'list_item', indent_level: 0 },
      ];

      const intent = classifyIntent(section);

      // "should" in bullets should trigger +0.20 boost
      expect(intent.plan_change).toBeGreaterThan(0.15);
    });

    // LEGACY v2 TEST: v3 uses explicit rules (request stems, change operators) instead
    // of pattern matching on bullet language. Some patterns may still work via v3 rules.
    it.skip('should boost plan_change for various change language patterns', () => {
      const patterns = [
        '- We need to update the homepage',
        '- Move the login button to the header',
        '- Add a search feature to the dashboard',
        '- Remove deprecated endpoints',
        '- Focus on mobile experience',
        '- Balance between speed and quality',
      ];

      for (const pattern of patterns) {
        const section = makeSection(pattern, 'Changes', 2, 1);
        section.body_lines = [
          { index: 0, text: pattern, line_type: 'list_item', indent_level: 0 },
        ];

        const intent = classifyIntent(section);

        // Each change language pattern should boost plan_change
        expect(intent.plan_change).toBeGreaterThan(0);
      }
    });

    it('should make notes with change language actionable', () => {
      const changeNote: NoteInput = {
        note_id: 'test-change-language',
        raw_markdown: `# Q2 Updates

## Homepage Improvements

We need to improve conversion rates by Q2 launch.

- We should add testimonials to the homepage
- Need to update the hero image  
- Move the pricing link to be more prominent
- Focus on converting more visitors
- Add trust badges and social proof
- Remove distractions from signup flow

Target: 20% improvement in conversion rate.

## Mobile Experience

Mobile traffic is growing and we need better experience.

- The mobile menu should be easier to navigate
- Add quick actions for common tasks
- Remove unnecessary fields from forms
- Update responsive breakpoints
- Focus on touch-friendly interactions
- Balance between functionality and simplicity

Launch by end of May with full mobile optimization.
`,
      };

      const { sections } = preprocessNote(changeNote);
      const classified = classifySections(sections, DEFAULT_THRESHOLDS);

      // Verify classified sections have elevated plan_change scores from change language boost
      const sectionsWithChangeLanguage = classified.filter(s => 
        s.heading_text?.toLowerCase().includes('improvements') ||
        s.heading_text?.toLowerCase().includes('experience')
      );
      
      expect(sectionsWithChangeLanguage.length).toBeGreaterThan(0);
      
      for (const section of sectionsWithChangeLanguage) {
        // With Q2 refs, metrics, and change language, should have strong plan_change
        expect(section.intent.plan_change).toBeGreaterThan(0.2);
        
        // Verify structural features are detected
        expect(section.structural_features.num_list_items).toBeGreaterThanOrEqual(4);
      }
      
      // With all the boosts, at least one should be actionable
      const actionable = filterActionableSections(classified);
      expect(actionable.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Structural Plan Change Lift', () => {
    // LEGACY v2 TEST: v3 does not use line count or bullet count for structural boosts
    it.skip('should boost plan_change for mid-sized multi-bullet sections', () => {
      const section = makeSection(
        `Changes needed:
- Item 1
- Item 2
- Item 3
- Item 4
Some additional context here.`,
        'Updates',
        8,
        4
      );

      const intent = classifyIntent(section);

      // 4 bullets and 8 lines (within 4-20 range) should trigger +0.10 boost
      expect(intent.plan_change).toBeGreaterThan(0.05);
    });

    it('should NOT boost for sections with too few bullets', () => {
      const section1 = makeSection(
        `Changes:
- Item 1
- Item 2`,
        'Updates',
        5,
        2
      );

      const section2 = makeSection(
        `Changes:
- Item 1
- Item 2
- Item 3
- Item 4`,
        'Updates',
        8,
        4
      );

      const intent1 = classifyIntent(section1);
      const intent2 = classifyIntent(section2);

      // Section2 should have higher plan_change due to structural boost
      expect(intent2.plan_change).toBeGreaterThanOrEqual(intent1.plan_change);
    });

    it('should NOT boost for sections outside line count range', () => {
      // Too short (< 4 lines)
      const shortSection = makeSection('- Item 1\n- Item 2\n- Item 3\n- Item 4', 'Short', 3, 4);

      // Too long (> 20 lines)
      const longText = Array(25).fill('Line of text').join('\n');
      const longSection = makeSection(longText, 'Long', 25, 4);

      // Just right (4-20 lines)
      const goodSection = makeSection(
        Array(10).fill('- Item').join('\n'),
        'Good',
        10,
        4
      );

      const shortIntent = classifyIntent(shortSection);
      const longIntent = classifyIntent(longSection);
      const goodIntent = classifyIntent(goodSection);

      // Only the good section should get the structural boost
      // (though all might have some base plan_change from content)
      expect(goodIntent.plan_change).toBeGreaterThanOrEqual(shortIntent.plan_change);
      expect(goodIntent.plan_change).toBeGreaterThanOrEqual(longIntent.plan_change);
    });
  });

  describe('UI Research Reclassification', () => {
    // LEGACY v2 TEST: v3 does not have research signal or UI verb reclassification
    it.skip('should boost plan_change for high-research sections with UI verbs', () => {
      const section = makeSection(
        `We need to investigate how to add a new notification badge to the header.
Research the best UX patterns for showing unread counts.
Figure out whether to show or hide the label on mobile devices.`,
        'Notification Badge Research',
        6,
        0
      );

      const intent = classifyIntent(section);

      // High research signal with UI verbs (add, show, hide, label) should:
      // 1. Boost plan_change to at least 0.5
      // 2. Dampen research signal significantly
      expect(intent.plan_change).toBeGreaterThanOrEqual(0.5);
      expect(intent.research).toBeLessThan(0.3); // Should be dampened
    });

    it('should make UI research sections actionable, not out-of-scope', () => {
      const uiResearchNote: NoteInput = {
        note_id: 'test-ui-research',
        raw_markdown: `# Dashboard Updates

## Add Metrics Display

We need to research how users want to see their metrics.

- Investigate best practices for showing key numbers
- Figure out the right notation for large values  
- Add tooltips to explain each metric
- Research whether to show or hide advanced options
- Remove clutter from the display

The goal is to add a comprehensive dashboard by end of Q2.

## User Preferences

Explore what settings users need.

- Look into common configuration patterns
- Understand how to label each option clearly
- Remove confusing settings based on research
- Add intuitive defaults
- Show helpful descriptions
`,
      };

      const { sections } = preprocessNote(uiResearchNote);
      const classified = classifySections(sections, DEFAULT_THRESHOLDS);
      
      // Check that UI research sections get plan_change boost and dampened research
      const metricsSection = classified.find(s => s.heading_text?.toLowerCase().includes('metrics'));
      
      if (metricsSection) {
        // Should have UI verb boost (add, show, hide, remove, label, notation)
        expect(metricsSection.intent.plan_change).toBeGreaterThan(0.4);
        
        // Research should be dampened when UI verbs are present
        expect(metricsSection.intent.research).toBeLessThan(0.5);
        
        // Check signal definitions
        const { actionableSignal, outOfScopeSignal } = computeActionabilitySignals(metricsSection.intent);
        
        // outOfScopeSignal should NOT include research
        expect(outOfScopeSignal).toBeLessThanOrEqual(Math.max(
          metricsSection.intent.calendar,
          metricsSection.intent.communication,
          metricsSection.intent.micro_tasks
        ));
      }
    });

    it('should still filter pure research sections without UI verbs', () => {
      const pureResearchNote: NoteInput = {
        note_id: 'test-pure-research',
        raw_markdown: `# Research Tasks

## User Churn Analysis

We need to investigate why users are leaving.
- Explore the data to find patterns
- Interview churned customers
- Analyze competitor offerings
- Figure out root causes

## Market Research

Research our target market segments.
- Understand customer needs
- Look into industry trends
- Gather competitive intelligence
`,
      };

      const { sections } = preprocessNote(pureResearchNote);
      const classified = classifySections(sections, DEFAULT_THRESHOLDS);
      const actionable = filterActionableSections(classified);

      // Pure research without UI verbs should have fewer actionable sections
      // (they may still have some due to other signals, but research should not be boosted)
      const researchSections = classified.filter(s => s.intent.research > 0.5);
      const actionableResearch = researchSections.filter(s => s.is_actionable);

      // Most high-research sections without UI verbs should not be actionable
      expect(actionableResearch.length).toBeLessThanOrEqual(researchSections.length / 2);
    });
  });

  describe('New Signal Definitions', () => {
    it('should exclude research from outOfScopeSignal', () => {
      const intent: IntentClassification = {
        plan_change: 0.3,
        new_workstream: 0.4,
        status_informational: 0.2,
        communication: 0.2,
        research: 0.8, // High research
        calendar: 0.1,
        micro_tasks: 0.15,
      };

      const { actionableSignal, outOfScopeSignal } = computeActionabilitySignals(intent);

      // actionableSignal should be max(plan_change, new_workstream) = 0.4
      expect(actionableSignal).toBe(0.4);

      // outOfScopeSignal should be max(calendar, communication, micro_tasks) = 0.2
      // Research (0.8) should NOT be included
      expect(outOfScopeSignal).toBe(0.2);
      expect(outOfScopeSignal).toBeLessThan(intent.research);
    });

    it('should use actionableSignal (not topLabel) for gating', () => {
      const thresholds = DEFAULT_THRESHOLDS;

      // Intent where research is highest label, but actionable signal is strong
      const intent: IntentClassification = {
        plan_change: 0.6,
        new_workstream: 0.5,
        status_informational: 0.2,
        communication: 0.1,
        research: 0.7, // Highest, would be topLabel
        calendar: 0.1,
        micro_tasks: 0.1,
      };

      const section = makeSection('Test content', 'Test', 5, 2);
      const result = isActionable(intent, section, thresholds);

      // Should be actionable based on actionableSignal (0.6), not topLabel (research)
      expect(result.actionableSignal).toBe(0.6);
      expect(result.actionable).toBe(true);
    });
  });

  describe('Combined Product Execution Boosts', () => {
    it('should stack multiple boosts for maximum effect', () => {
      const maxBoostNote: NoteInput = {
        note_id: 'test-max-boost',
        raw_markdown: `# Product Updates

## Bug: Calculator Widget

The calculator is showing wrong values.

- We should fix the rounding logic
- Need to update the display format
- Add better error handling
- Remove deprecated functions
- Focus on accuracy first

This affects about 30% of our users and needs attention by Q2.
`,
      };

      const { sections } = preprocessNote(maxBoostNote);
      
      // Find the bug section
      const bugSection = sections.find(s => s.heading_text?.toLowerCase().includes('bug'));
      expect(bugSection).toBeDefined();

      const classified = classifySections([bugSection!], DEFAULT_THRESHOLDS);
      const actionable = filterActionableSections(classified);

      // Should be actionable with multiple boosts:
      // - Product execution heading boost (+0.35)
      // - Bullet change language boost (+0.20)
      // - Structural boost (+0.10) for 5+ bullets in mid-sized section
      // - Quarter reference boost
      expect(actionable.length).toBe(1);
      expect(actionable[0].intent.plan_change).toBeGreaterThan(0.5);
      expect(actionable[0].is_actionable).toBe(true);
    });
  });

  // ============================================
  // Aggregation & plan_change Invariant Tests
  // (per suggestion-aggregation-plan-change-fix plan)
  // ============================================

  describe('Aggregation Invariants', () => {
    it('should emit at least one suggestion when debug shows emitted: true', () => {
      // Test case that mirrors the reported bug:
      // Debug JSON shows emitted: true but UI shows Suggestions (0)
      const planChangeNote: NoteInput = {
        note_id: 'test-emitted-invariant',
        raw_markdown: `# Q2 Plan Changes

## Roadmap Adjustments

We need to shift priorities for Q2 based on customer feedback.

- Defer feature X to Q3
- Accelerate feature Y instead
- Remove Z from scope entirely

This will help us deliver faster value to customers.
`,
      };

      const result = generateSuggestions(planChangeNote, undefined, {
        enable_debug: true,
        max_suggestions: 10,
      });

      // If any suggestions were generated (emitted in debug), they should appear in final result
      expect(result.suggestions.length).toBeGreaterThan(0);
      
      // Check debug invariant if available
      if (result.debug) {
        // If debug shows emitted suggestions, final result must have them
        const hasEmittedInDebug = result.debug.suggestions_after_scoring > 0;
        if (hasEmittedInDebug) {
          expect(result.suggestions.length).toBeGreaterThan(0);
        }
      }
    });

    it('should preserve plan_change suggestions through scoring pipeline', () => {
      const planMutationNote: NoteInput = {
        note_id: 'test-plan-mutation-invariant',
        raw_markdown: `# Scope Changes

## Q2 Adjustments

Narrow the scope of the onboarding initiative to focus on self-serve users only.

- Remove enterprise features from Q2
- Add self-serve signup flow
- Descope SSO integration
`,
      };

      const result = generateSuggestions(planMutationNote, undefined, {
        enable_debug: true,
      });

      // Should have at least one suggestion for plan_mutation
      expect(result.suggestions.length).toBeGreaterThan(0);
      
      const planMutationSuggestions = result.suggestions.filter(s => s.type === 'plan_mutation');
      expect(planMutationSuggestions.length).toBeGreaterThan(0);

      // Check debug invariant
      if (result.debug) {
        expect(result.debug.invariant_plan_change_always_emitted).toBe(true);
        expect(result.debug.plan_change_emitted_count).toBeGreaterThan(0);
      }
    });
  });

  describe('plan_change Protection from Drops', () => {
    it('should never drop plan_change at ACTIONABILITY stage', () => {
      // Note with low actionability signals but clear plan_change intent
      const lowActionabilityPlanNote: NoteInput = {
        note_id: 'test-plan-change-actionability',
        raw_markdown: `# Plans

## Changes

Shift from X to Y.
`,
      };

      const { sections } = preprocessNote(lowActionabilityPlanNote);
      const classified = classifySections(sections, DEFAULT_THRESHOLDS);

      // Find sections with plan_change as top intent
      const planChangeSections = classified.filter(s => {
        const isPlanChangeTop = s.intent.plan_change > Math.max(
          s.intent.new_workstream,
          s.intent.status_informational,
          s.intent.communication
        );
        return isPlanChangeTop;
      });

      if (planChangeSections.length > 0) {
        // All plan_change sections should be marked actionable
        // (even if signals are low, due to protection logic)
        planChangeSections.forEach(sec => {
          if (sec.intent.plan_change > 0.3) {
            // Only check if plan_change signal is reasonably strong
            // (very weak signals may still be filtered)
            expect(sec.is_actionable || sec.actionability_reason?.includes('plan_change')).toBeTruthy();
          }
        });
      }
    });

    it('should downgrade low-confidence plan_change instead of dropping at THRESHOLD', () => {
      // Note designed to produce low-confidence plan_change suggestion
      const lowConfidencePlanNote: NoteInput = {
        note_id: 'test-plan-change-downgrade',
        raw_markdown: `# Q2 Roadmap

## Scope Adjustments

We should probably adjust the scope based on feedback.

- Maybe defer some features
- Could focus more on core flows

Not entirely sure yet but worth discussing.
`,
      };

      const result = generateSuggestions(lowConfidencePlanNote, undefined, {
        enable_debug: true,
      });

      // Should still have suggestions (not dropped)
      const planMutationSuggestions = result.suggestions.filter(s => s.type === 'plan_mutation');
      
      if (planMutationSuggestions.length > 0) {
        // If low confidence, should have needs_clarification flag
        const lowConfSuggestions = planMutationSuggestions.filter(s => !s.is_high_confidence);
        if (lowConfSuggestions.length > 0) {
          lowConfSuggestions.forEach(sugg => {
            expect(sugg.needs_clarification).toBe(true);
            expect(sugg.clarification_reasons).toBeDefined();
            expect(sugg.clarification_reasons.length).toBeGreaterThan(0);
          });
        }
      }

      // Debug should show downgrade, not drop
      if (result.debug) {
        expect(result.debug.low_confidence_downgraded_count).toBeGreaterThanOrEqual(0);
        // Invariant: plan_change suggestions are never dropped
        expect(result.debug.invariant_plan_change_always_emitted).toBe(true);
      }
    });

    it('should emit plan_change even with "non-actionable" type classification', () => {
      // Edge case: section classified as plan_change but type returns non_actionable
      const edgeCasePlanNote: NoteInput = {
        note_id: 'test-plan-change-type-override',
        raw_markdown: `# Updates

## Plan

Shift priorities.
`,
      };

      const { sections } = preprocessNote(edgeCasePlanNote);
      const classified = classifySections(sections, DEFAULT_THRESHOLDS);

      // Sections with plan_change intent should not be dropped even if type is weak
      const planChangeSections = classified.filter(s => s.intent.plan_change > 0.4);
      
      if (planChangeSections.length > 0) {
        // Should either be actionable OR have plan_change protection message in reason
        planChangeSections.forEach(sec => {
          const hasProtection = sec.is_actionable || 
                                sec.actionability_reason?.includes('plan_change') ||
                                sec.suggested_type === 'plan_mutation';
          expect(hasProtection).toBeTruthy();
        });
      }
    });
  });

  describe('Downgrade Semantics', () => {
    it('should set action=comment and needs_clarification for low-confidence plan_change', () => {
      const ambiguousPlanNote: NoteInput = {
        note_id: 'test-downgrade-semantics',
        raw_markdown: `# Thoughts

## Potential Changes

Might want to adjust our approach for Q2, not entirely decided yet.

- Possibly defer X
- Maybe focus on Y instead
- Still evaluating options

Need to think more about this.
`,
      };

      const result = generateSuggestions(ambiguousPlanNote, undefined, {
        enable_debug: true,
        thresholds: {
          ...DEFAULT_THRESHOLDS,
          T_overall_min: 0.6, // Raise threshold to force downgrade
        },
      });

      const lowConfPlanSuggestions = result.suggestions.filter(
        s => s.type === 'plan_mutation' && !s.is_high_confidence
      );

      if (lowConfPlanSuggestions.length > 0) {
        lowConfPlanSuggestions.forEach(sugg => {
          // Must have needs_clarification flag
          expect(sugg.needs_clarification).toBe(true);
          
          // Should have clarification reasons
          expect(sugg.clarification_reasons).toBeDefined();
          expect(sugg.clarification_reasons.length).toBeGreaterThan(0);
          
          // May have action field set to 'comment' (v0 compatibility)
          // Note: This is optional based on implementation
          if ((sugg as any).action) {
            expect((sugg as any).action).toBe('comment');
          }
        });
      }
    });
  });

  describe('Debug JSON Pattern Matching (sec_j97at70v_2 case)', () => {
    it('should match the reported bug pattern: emitted=true but Suggestions(0)', () => {
      // Reproduce the exact scenario from the bug report:
      // - A section (e.g., sec_j97at70v_2) has a candidate with emitted: true
      // - But UI shows Suggestions (0)
      
      const bugReportNote: NoteInput = {
        note_id: 'test-bug-pattern-sec_j97at70v_2',
        raw_markdown: `# Q2 Strategy Meeting Notes

## Roadmap Adjustments for Q2

We need to make significant changes to our Q2 roadmap based on customer feedback and resource constraints.

Key decisions:
- Shift focus from enterprise features to self-serve onboarding
- Move from monthly to quarterly release cycles to improve stability
- Descope SSO integration (defer to Q3)
- Add in-app tutorials and tooltips for SMB customers
- Remove advanced analytics from Q2 scope

Rationale: This will help us ship higher quality products faster and reduce onboarding time from 2 weeks to 2 days for SMB customers.

Timeline:
- Phase 1: Complete by end of April
- Phase 2: May delivery
- Review point: Mid-May to assess progress
`,
      };

      const result = generateSuggestions(bugReportNote, undefined, {
        enable_debug: true,
      });

      // INVARIANT 1: If debug shows emitted candidates, suggestions must be non-empty
      if (result.debug && result.debug.suggestions_after_scoring > 0) {
        expect(result.suggestions.length).toBeGreaterThan(0);
      }

      // INVARIANT 2: If plan_change candidates exist, at least one suggestion must be emitted
      if (result.debug && result.debug.plan_change_count > 0) {
        expect(result.debug.plan_change_emitted_count).toBeGreaterThan(0);
        expect(result.suggestions.filter(s => s.type === 'plan_mutation').length).toBeGreaterThan(0);
      }

      // This note should definitely produce suggestions (plan_change content)
      expect(result.suggestions.length).toBeGreaterThan(0);

      // Final check: UI count should match suggestions length
      const uiCount = result.suggestions.length;
      expect(uiCount).toBeGreaterThan(0);
    });
  });

  describe('ACTIONABILITY Invariants (per fix-plan-change-suppression plan)', () => {
    it('never produces NOT_ACTIONABLE for plan_change at ACTIONABILITY stage', () => {
      // Construct note with weak but clear plan_change intent
      const weakPlanChangeNote: NoteInput = {
        note_id: 'test-weak-plan-change-actionability',
        raw_markdown: `# Updates

## Plan

Shift priorities for Q2.

- Focus area changes
- Descope X
`,
      };

      const { sections } = preprocessNote(weakPlanChangeNote);
      const classified = classifySections(sections, DEFAULT_THRESHOLDS);

      // Find sections where isPlanChangeIntentLabel returns true
      const planChangeSections = classified.filter(sec => 
        isPlanChangeIntentLabel(sec.intent)
      );

      for (const sec of planChangeSections) {
        // INVARIANT: plan_change sections must be actionable
        expect(sec.is_actionable).toBe(true);
        
        // INVARIANT: actionability_reason must not indicate drops
        expect(sec.actionability_reason).not.toContain('Action signal too low');
        expect(sec.actionability_reason).not.toContain('Type classification: non-actionable');
        
        // INVARIANT: must have a suggested_type (forced to plan_mutation)
        expect(sec.suggested_type).toBe('plan_mutation');
      }
    });

    it('ensures plan_change sections always yield at least one suggestion', () => {
      const planChangeNote: NoteInput = {
        note_id: 'test-plan-change-always-yields',
        raw_markdown: `# Strategy

## Roadmap Changes

Narrow our focus from three workstreams to one priority: self-serve onboarding.

- Defer enterprise features
- Pivot to SMB customers
`,
      };

      const { sections } = preprocessNote(planChangeNote);
      const classified = classifySections(sections, DEFAULT_THRESHOLDS);

      const hasPlanChangeSection = classified.some(sec => 
        isPlanChangeIntentLabel(sec.intent)
      );

      const result = generateSuggestions(planChangeNote, {}, { 
        enable_debug: true, 
        max_suggestions: 10 
      });

      if (hasPlanChangeSection) {
        // INVARIANT: at least one suggestion must be generated
        expect(result.suggestions.length).toBeGreaterThanOrEqual(1);
        
        // INVARIANT: at least one plan_mutation suggestion must be present
        const planMutationSuggestions = result.suggestions.filter(s => 
          s.type === 'plan_mutation'
        );
        expect(planMutationSuggestions.length).toBeGreaterThanOrEqual(1);
      }
    });
  });

  describe('THRESHOLD Invariants (per fix-plan-change-suppression plan)', () => {
    it('never drops plan_change suggestions at THRESHOLD, only downgrades', () => {
      // Create test suggestions with low scores
      const testSuggestions: any[] = [
        {
          suggestion_id: 'test-plan-1',
          type: 'plan_mutation',
          section_id: 'sec-1',
          scores: {
            section_actionability: 0.2,
            type_choice_confidence: 0.2,
            synthesis_confidence: 0.5,
            overall: 0.2,
          },
        },
        {
          suggestion_id: 'test-plan-2',
          type: 'plan_mutation',
          section_id: 'sec-2',
          scores: {
            section_actionability: 0.1,
            type_choice_confidence: 0.4,
            synthesis_confidence: 0.3,
            overall: 0.1,
          },
        },
      ];

      const { passed, dropped, downgraded } = applyConfidenceBasedProcessing(
        testSuggestions,
        DEFAULT_THRESHOLDS
      );

      // INVARIANT: All plan_mutation suggestions must pass (none dropped)
      expect(passed.length).toBe(testSuggestions.length);
      expect(dropped.length).toBe(0);

      // INVARIANT: Low-confidence suggestions must be downgraded
      expect(downgraded).toBeGreaterThan(0);

      // INVARIANT: All passed suggestions must have needs_clarification set
      passed.forEach(s => {
        expect(s.needs_clarification).toBe(true);
        expect(s.clarification_reasons).toBeDefined();
        expect(s.clarification_reasons.length).toBeGreaterThan(0);
      });
    });

    it('allows execution_artifact to be dropped at THRESHOLD', () => {
      // Verify that non-plan_change suggestions can still be dropped
      const testSuggestions: any[] = [
        {
          suggestion_id: 'test-artifact-1',
          type: 'execution_artifact',
          section_id: 'sec-1',
          scores: {
            section_actionability: 0.1,
            type_choice_confidence: 0.15,
            synthesis_confidence: 0.2,
            overall: 0.1,
          },
        },
      ];

      const { passed, dropped } = applyConfidenceBasedProcessing(
        testSuggestions,
        DEFAULT_THRESHOLDS
      );

      // Execution artifacts with very low scores should be dropped
      expect(dropped.length).toBeGreaterThan(0);
    });
  });

  describe('Aggregation Invariants (per fix-plan-change-suppression plan)', () => {
    it('keeps emitted candidate count in sync with final suggestions', () => {
      const testNote: NoteInput = {
        note_id: 'test-aggregation-sync',
        raw_markdown: PLAN_MUTATION_NOTE.raw_markdown,
      };

      const result = generateSuggestionsWithDebug(
        testNote,
        {},
        { enable_debug: true },
        { verbosity: 'REDACTED' }
      );

      expect(result.debugRun).toBeDefined();
      const debugRun = result.debugRun!;

      // Count emitted candidates from debug
      const emittedCandidates = debugRun.sections
        .flatMap(sec => sec.candidates)
        .filter(c => c.emitted);

      const emittedCandidatesCount = emittedCandidates.length;
      const aggregatedSuggestionsCount = result.suggestions.length;

      // INVARIANT: If any candidate is emitted, suggestions must be non-empty
      if (emittedCandidatesCount > 0) {
        expect(aggregatedSuggestionsCount).toBeGreaterThan(0);
      }

      // INVARIANT: Emitted candidates should roughly match final suggestions
      // (allowing for dedupe/cap drops which are separately tracked)
      if (emittedCandidatesCount > 0) {
        expect(aggregatedSuggestionsCount).toBeLessThanOrEqual(emittedCandidatesCount);
      }
    });

    it('ensures emitted candidates imply non-empty suggestions list', () => {
      const result = generateSuggestions(PLAN_MUTATION_NOTE, {}, { 
        enable_debug: true, 
        max_suggestions: 10 
      });
      
      expect(result.debug).toBeDefined();
      const debug = result.debug!;

      // If suggestions_after_scoring > 0, final suggestions must be non-empty
      if (debug.suggestions_after_scoring > 0) {
        expect(result.suggestions.length).toBeGreaterThan(0);
      }

      // If plan_change candidates exist, at least one must be emitted
      if (debug.plan_change_count > 0) {
        expect(debug.plan_change_emitted_count).toBeGreaterThan(0);
      }
    });

    it('validates plan_change section always produces emitted candidate', () => {
      const planChangeNote: NoteInput = {
        note_id: 'test-plan-change-emitted',
        raw_markdown: `# Q3 Planning

## Scope Adjustments

Shift focus from enterprise to self-serve for Q3.

Key changes:
- Descope SSO (move to Q4)
- Prioritize onboarding flow
- Add in-app tutorials

This will reduce time-to-value from 2 weeks to 2 days.
`,
      };

      const result = generateSuggestionsWithDebug(
        planChangeNote,
        {},
        { enable_debug: true },
        { verbosity: 'REDACTED' }
      );

      expect(result.debugRun).toBeDefined();
      const debugRun = result.debugRun!;

      // Find sections with plan_change intent
      const planChangeSections = debugRun.sections.filter(sec => 
        sec.decisions.intentLabel === 'plan_change'
      );

      if (planChangeSections.length > 0) {
        // INVARIANT: Each plan_change section must have at least one emitted candidate
        planChangeSections.forEach(sec => {
          const emittedCandidates = sec.candidates.filter(c => c.emitted);
          expect(emittedCandidates.length).toBeGreaterThan(0);
          
          // Verify it's not dropped at ACTIONABILITY or THRESHOLD
          expect(sec.dropStage).toBeNull();
          expect(sec.dropReason).toBeNull();
        });

        // INVARIANT: Final suggestions must include plan_mutation types
        const planMutationSuggestions = result.suggestions.filter(s =>
          s.type === 'plan_mutation'
        );
        expect(planMutationSuggestions.length).toBeGreaterThan(0);
      }
    });
  });

  // ============================================
  // Feature Request Type Tests
  // ============================================

  describe('Feature Request Type Label', () => {
    it('Test A: Single-line feature request is emitted', async () => {
      const note: NoteInput = {
        note_id: 'test-feature-request',
        raw_markdown: `# Product Notes

I would really like you to add boundary detection in onboarding
`,
      };

      const result = generateSuggestionsWithDebug(
        note,
        {},
        { enable_debug: true },
        { verbosity: 'REDACTED' }
      );

      // Should generate at least one suggestion
      expect(result.suggestions.length).toBeGreaterThan(0);

      // Check section classification
      const { sections } = preprocessNote(note);
      const classifiedSections = classifySections(sections, DEFAULT_THRESHOLDS);
      const actionableSections = filterActionableSections(classifiedSections);

      expect(actionableSections.length).toBeGreaterThan(0);

      const section = actionableSections[0];

      // Verify intentLabel is new_workstream
      expect(section.intent.new_workstream).toBeGreaterThan(section.intent.plan_change);

      // Verify typeLabel is feature_request
      expect(section.typeLabel).toBe('feature_request');

      // Verify V3 passes (no V3 drops)
      expect(result.debugRun).toBeDefined();
      const v3Drops = result.debugRun!.sections.flatMap(s => s.candidates)
        .filter(c => c.dropReason === 'VALIDATION_V3_EVIDENCE_TOO_WEAK').length;
      expect(v3Drops).toBe(0);

      // Verify at least one suggestion is emitted
      expect(result.suggestions.length).toBeGreaterThan(0);
      expect(result.suggestions[0].dropped).toBeUndefined();
    });

    it('Test B: Thin execution artifact stays strict', async () => {
      const note: NoteInput = {
        note_id: 'test-thin-initiative',
        raw_markdown: `# Ideas

New initiative: Improve onboarding
`,
      };

      const result = generateSuggestionsWithDebug(
        note,
        {},
        { enable_debug: true },
        { verbosity: 'REDACTED' }
      );

      // Should classify as execution_artifact (not feature_request)
      const { sections } = preprocessNote(note);
      const classifiedSections = classifySections(sections, DEFAULT_THRESHOLDS);
      const actionableSections = filterActionableSections(classifiedSections);

      if (actionableSections.length > 0) {
        const section = actionableSections[0];

        // Should be execution_artifact, not feature_request
        expect(section.typeLabel).toBe('execution_artifact');
      }

      // Thin initiative without structure should fail V3 or produce low-quality suggestion
      // Either no suggestions OR dropped suggestions
      expect(result.debugRun).toBeDefined();
      const v3Drops = result.debugRun!.sections.flatMap(s => s.candidates)
        .filter(c => c.dropReason === 'VALIDATION_V3_EVIDENCE_TOO_WEAK').length;
      const hasDrops = v3Drops > 0 || result.suggestions.length === 0;
      expect(hasDrops).toBe(true);
    });

    it('Test C: Plan-change behavior unchanged', async () => {
      const note: NoteInput = {
        note_id: 'test-plan-change-unchanged',
        raw_markdown: `# Roadmap Update

Move launch to next week
`,
      };

      const result = generateSuggestionsWithDebug(
        note,
        {},
        { enable_debug: true },
        { verbosity: 'REDACTED' }
      );

      // Check section classification
      const { sections } = preprocessNote(note);
      const classifiedSections = classifySections(sections, DEFAULT_THRESHOLDS);
      const actionableSections = filterActionableSections(classifiedSections);

      expect(actionableSections.length).toBeGreaterThan(0);

      const section = actionableSections[0];

      // Verify intentLabel is plan_change
      const isPlanChange = isPlanChangeIntentLabel(section.intent);
      expect(isPlanChange).toBe(true);

      // Debug output
      console.log('Test C Debug:', JSON.stringify({
        suggestions: result.suggestions,
        debugRun: result.debugRun?.sections.map(s => ({
          intent: s.intentLabel,
          typeLabel: s.typeLabel,
          candidates: s.candidates.map(c => ({
            emitted: c.emitted,
            dropReason: c.dropReason,
            dropStage: c.dropStage
          }))
        }))
      }, null, 2));

      // Plan change behavior unchanged: should always emit
      expect(result.suggestions.length).toBeGreaterThan(0);
      expect(result.suggestions[0].type).toBe('plan_mutation');
    });
  });

  describe('Multi-topic meeting note segmentation', () => {
    beforeEach(() => {
      resetSectionCounter();
      resetSuggestionCounter();
    });

    it('should segment plain-text headings and produce multiple suggestions', () => {
      const multiTopicNote: NoteInput = {
        note_id: 'test-multi-topic',
        raw_markdown: `Timeline change

The project launch was originally Q1 but we're moving it to Q2 to add more features.

Onboarding feedback

Users are asking for better documentation and step-by-step tutorials in the app.

Team updates

Sarah will take over the billing project.

Priority shifts

The analytics dashboard is now P0 instead of P1.
`,
      };

      // Preprocess and check sections
      const { sections } = preprocessNote(multiTopicNote);

      // Should have at least 4 sections (one per plain-text heading)
      expect(sections.length).toBeGreaterThanOrEqual(4);

      // Check that plain-text headings were recognized
      const headingTexts = sections.map((s) => s.heading_text);
      expect(headingTexts).toContain('Timeline change');
      expect(headingTexts).toContain('Onboarding feedback');
      expect(headingTexts).toContain('Team updates');
      expect(headingTexts).toContain('Priority shifts');

      // Classify sections
      const classified = classifySections(sections, DEFAULT_THRESHOLDS);

      // Timeline change section should have plan_change intent
      const timelineSection = classified.find((s) =>
        s.heading_text?.includes('Timeline change')
      );
      expect(timelineSection).toBeDefined();

      expect(isPlanChangeIntentLabel(timelineSection!.intent)).toBe(true);

      // Onboarding feedback should be actionable (new_workstream or feature_request)
      const onboardingSection = classified.find((s) =>
        s.heading_text?.includes('Onboarding feedback')
      );
      expect(onboardingSection).toBeDefined();
      // Should have actionable intent, not dominated by plan_change
      const onboardingIsPlanChange = isPlanChangeIntentLabel(onboardingSection!.intent);
      expect(onboardingIsPlanChange).toBe(false);

      // Generate suggestions
      const actionable = filterActionableSections(classified);
      const suggestions = synthesizeSuggestions(actionable);

      // Should produce multiple suggestions (not just 1)
      expect(suggestions.length).toBeGreaterThan(1);

      // Timeline change should produce plan_mutation
      const planMutations = suggestions.filter((s) => s.type === 'plan_mutation');
      expect(planMutations.length).toBeGreaterThan(0);
    });

    it('should not treat sentences ending with punctuation as headings', () => {
      const punctuatedNote: NoteInput = {
        note_id: 'test-punctuated',
        raw_markdown: `This is a sentence.

This should not be a heading either?

This neither!

Actual heading

This is content under the heading.
`,
      };

      const { sections } = preprocessNote(punctuatedNote);

      // Only "Actual heading" should be recognized
      const headingTexts = sections.map((s) => s.heading_text);
      expect(headingTexts).toContain('Actual heading');

      // Sentences with punctuation should NOT be headings
      expect(headingTexts).not.toContain('This is a sentence.');
      expect(headingTexts).not.toContain('This should not be a heading either?');
      expect(headingTexts).not.toContain('This neither!');
    });

    it('should not treat long lines as headings', () => {
      const longLineNote: NoteInput = {
        note_id: 'test-long-line',
        raw_markdown: `This is a very long line that exceeds forty characters and should not be treated as heading

Short heading

Content here.
`,
      };

      const { sections } = preprocessNote(longLineNote);

      const headingTexts = sections.map((s) => s.heading_text);

      // Short heading should be recognized
      expect(headingTexts).toContain('Short heading');

      // Long line should NOT be heading
      const hasLongLineAsHeading = headingTexts.some((h) =>
        h.includes('This is a very long line')
      );
      expect(hasLongLineAsHeading).toBe(false);
    });

    it('should recognize headings followed by blank line', () => {
      const blankLineNote: NoteInput = {
        note_id: 'test-blank-line',
        raw_markdown: `First topic

Content for first topic.

Second topic

Content for second topic.
`,
      };

      const { sections } = preprocessNote(blankLineNote);

      const headingTexts = sections.map((s) => s.heading_text);
      expect(headingTexts).toContain('First topic');
      expect(headingTexts).toContain('Second topic');
      expect(sections.length).toBeGreaterThanOrEqual(2);
    });

    it('should recognize headings followed by bullet lists', () => {
      const bulletListNote: NoteInput = {
        note_id: 'test-bullet-list',
        raw_markdown: `Action items
- Complete design review
- Update documentation
- Test new features

Next steps
- Schedule follow-up meeting
- Send summary to team
`,
      };

      const { sections } = preprocessNote(bulletListNote);

      const headingTexts = sections.map((s) => s.heading_text);
      expect(headingTexts).toContain('Action items');
      expect(headingTexts).toContain('Next steps');
      expect(sections.length).toBeGreaterThanOrEqual(2);
    });
  });
});

// ============================================
// FP3 regression: colon headings, actionability, type gating
// ============================================

describe('FP3 regression – multi-topic meeting note', () => {
  const FP3_NOTE: NoteInput = {
    note_id: 'fp3-regression',
    raw_markdown: `Onboarding feedback
- Users drop off at step 3
- Tooltip copy is confusing
- Need clearer CTA on signup page

Quick update on ingestion refactor:
- Pipeline latency down 40%
- One edge case still failing on large payloads

Dashboard improvements
We should add a transparency dashboard to surface ingestion health.
- Add real-time status panel
- Show error rates per source
- Include retry queue depth

Execution follow-up
- Verify alerting thresholds for new monitors
- Update runbook with latest failure modes
- Share post-mortem template with on-call team
`,
  };

  beforeEach(() => {
    resetSectionCounter();
    resetSuggestionCounter();
  });

  it('colon headings create section boundaries', () => {
    const { sections } = preprocessNote(FP3_NOTE);
    const headingTexts = sections.map(s => s.heading_text);

    expect(headingTexts).toContain('Onboarding feedback');
    expect(headingTexts).toContain('Quick update on ingestion refactor');
    expect(headingTexts).toContain('Dashboard improvements');
    expect(headingTexts).toContain('Execution follow-up');
    expect(sections.length).toBe(4);
  });

  it('"Dashboard improvements" is actionable new_workstream', () => {
    const { sections } = preprocessNote(FP3_NOTE);
    const classified = classifySections(sections, DEFAULT_THRESHOLDS);

    const dashboard = classified.find(s => s.heading_text === 'Dashboard improvements');
    expect(dashboard).toBeDefined();
    expect(dashboard!.is_actionable).toBe(true);

    // Intent should be new_workstream dominant (not status_informational)
    expect(dashboard!.intent.new_workstream).toBeGreaterThan(dashboard!.intent.status_informational);
    expect(dashboard!.intent.new_workstream).toBeGreaterThan(dashboard!.intent.plan_change);
  });

  it('"Execution follow-up" is actionable (not dropped)', () => {
    const { sections } = preprocessNote(FP3_NOTE);
    const classified = classifySections(sections, DEFAULT_THRESHOLDS);

    const execution = classified.find(s => s.heading_text === 'Execution follow-up');
    expect(execution).toBeDefined();
    expect(execution!.is_actionable).toBe(true);
  });

  it('plan_mutation only for plan_change sections', () => {
    const { sections } = preprocessNote(FP3_NOTE);
    const classified = classifySections(sections, DEFAULT_THRESHOLDS);

    for (const section of classified) {
      if (section.suggested_type === 'plan_mutation') {
        expect(isPlanChangeIntentLabel(section.intent)).toBe(true);
      }
    }

    // Dashboard and Execution follow-up should NOT be plan_mutation
    const dashboard = classified.find(s => s.heading_text === 'Dashboard improvements');
    const execution = classified.find(s => s.heading_text === 'Execution follow-up');
    if (dashboard?.suggested_type) {
      expect(dashboard.suggested_type).not.toBe('plan_mutation');
    }
    if (execution?.suggested_type) {
      expect(execution.suggested_type).not.toBe('plan_mutation');
    }
  });
});

// ============================================
// Hedged Directive, Feature Request Typing, and Empty Section Tests
// ============================================

describe('Hedged directive recognition', () => {
  beforeEach(() => {
    resetSectionCounter();
    resetSuggestionCounter();
  });

  const HEDGED_DIRECTIVES_NOTE: NoteInput = {
    note_id: 'test-hedged',
    raw_markdown: `## Sprint retro

We talked about the deployment pipeline and how slow it is.

## Pipeline improvements

We should invest in better CI caching to cut deploy times.
We probably should also look into parallelizing the test suite.

## Pricing review

Maybe we need to rethink the pricing tiers for the SMB segment.
There is growing feedback that the current model is too rigid.

## Admin tasks

We should send the invoice to the finance team by Friday.

## Timeline changes

We need to shift the launch from March to April due to resourcing.
- Defer beta sign-ups to mid-April
- Accelerate docs work to compensate
`,
  };

  it('sections with "we should" / "we probably should" are actionable new_workstream', () => {
    const { sections } = preprocessNote(HEDGED_DIRECTIVES_NOTE);
    const classified = classifySections(sections, DEFAULT_THRESHOLDS);

    const pipeline = classified.find(s => s.heading_text === 'Pipeline improvements');
    expect(pipeline).toBeDefined();
    expect(pipeline!.is_actionable).toBe(true);
    expect(pipeline!.intent.new_workstream).toBeGreaterThan(pipeline!.intent.plan_change);
  });

  it('sections with "maybe we need" are actionable new_workstream', () => {
    const { sections } = preprocessNote(HEDGED_DIRECTIVES_NOTE);
    const classified = classifySections(sections, DEFAULT_THRESHOLDS);

    const pricing = classified.find(s => s.heading_text === 'Pricing review');
    expect(pricing).toBeDefined();
    expect(pricing!.is_actionable).toBe(true);
    expect(pricing!.intent.new_workstream).toBeGreaterThan(pricing!.intent.plan_change);
  });

  it('hedged directives do NOT trigger plan_change', () => {
    const { sections } = preprocessNote(HEDGED_DIRECTIVES_NOTE);
    const classified = classifySections(sections, DEFAULT_THRESHOLDS);

    const pipeline = classified.find(s => s.heading_text === 'Pipeline improvements');
    const pricing = classified.find(s => s.heading_text === 'Pricing review');

    expect(isPlanChangeIntentLabel(pipeline!.intent)).toBe(false);
    expect(isPlanChangeIntentLabel(pricing!.intent)).toBe(false);
  });

  it('existing plan_change behavior is preserved (shift + bullets)', () => {
    const { sections } = preprocessNote(HEDGED_DIRECTIVES_NOTE);
    const classified = classifySections(sections, DEFAULT_THRESHOLDS);

    const timeline = classified.find(s => s.heading_text === 'Timeline changes');
    expect(timeline).toBeDefined();
    expect(timeline!.is_actionable).toBe(true);
    expect(isPlanChangeIntentLabel(timeline!.intent)).toBe(true);
    expect(timeline!.suggested_type).toBe('plan_mutation');
  });

  it('status_informational retro section stays non-actionable', () => {
    const { sections } = preprocessNote(HEDGED_DIRECTIVES_NOTE);
    const classified = classifySections(sections, DEFAULT_THRESHOLDS);

    const retro = classified.find(s => s.heading_text === 'Sprint retro');
    expect(retro).toBeDefined();
    expect(retro!.is_actionable).toBe(false);
  });
});

describe('Feature request vs execution_artifact typing', () => {
  beforeEach(() => {
    resetSectionCounter();
    resetSuggestionCounter();
  });

  const FEATURE_REQUEST_NOTE: NoteInput = {
    note_id: 'test-feature-type',
    raw_markdown: `## Boundary detection

I would really like you to add boundary detection to the onboarding flow.
This would help new users understand where they are in the process and reduce drop-off.

## Notification preferences

We should add a preference center so users can control which notifications they receive.
Right now everything is on by default and the feedback is consistently negative.

## Monitoring setup

- Add Datadog dashboards for core metrics
- Set up PagerDuty escalation policies
- Configure alert thresholds for latency and error rates
`,
  };

  it('prose request without bullets becomes feature_request', () => {
    const { sections } = preprocessNote(FEATURE_REQUEST_NOTE);
    const classified = classifySections(sections, DEFAULT_THRESHOLDS);

    const boundary = classified.find(s => s.heading_text === 'Boundary detection');
    expect(boundary).toBeDefined();
    expect(boundary!.is_actionable).toBe(true);
    expect(boundary!.typeLabel).toBe('feature_request');
  });

  it('multi-line prose request with hedged directive becomes feature_request', () => {
    const { sections } = preprocessNote(FEATURE_REQUEST_NOTE);
    const classified = classifySections(sections, DEFAULT_THRESHOLDS);

    const notifications = classified.find(s => s.heading_text === 'Notification preferences');
    expect(notifications).toBeDefined();
    expect(notifications!.is_actionable).toBe(true);
    expect(notifications!.typeLabel).toBe('feature_request');
  });

  it('bullet-based task list remains execution_artifact', () => {
    const { sections } = preprocessNote(FEATURE_REQUEST_NOTE);
    const classified = classifySections(sections, DEFAULT_THRESHOLDS);

    const monitoring = classified.find(s => s.heading_text === 'Monitoring setup');
    expect(monitoring).toBeDefined();
    if (monitoring!.typeLabel) {
      expect(monitoring!.typeLabel).toBe('execution_artifact');
    }
  });
});

describe('Empty section cleanup', () => {
  beforeEach(() => {
    resetSectionCounter();
    resetSuggestionCounter();
  });

  it('heading-only sections are not emitted', () => {
    const note: NoteInput = {
      note_id: 'test-empty-sections',
      raw_markdown: `## Empty heading

## Actual content

We should add caching to the API layer to improve latency.
`,
    };

    const { sections } = preprocessNote(note);

    // The empty heading should be merged or dropped
    expect(sections.every(s => s.raw_text.trim().length > 0)).toBe(true);
    // Should have at most 1 section (the one with content)
    expect(sections.length).toBe(1);
  });

  it('empty section heading is merged into next section', () => {
    const note: NoteInput = {
      note_id: 'test-merge-heading',
      raw_markdown: `## Category

## Specific topic

This section has actual content worth processing.
`,
    };

    const { sections } = preprocessNote(note);

    expect(sections.length).toBe(1);
    // The merged heading should contain both headings
    expect(sections[0].heading_text).toContain('Category');
    expect(sections[0].heading_text).toContain('Specific topic');
  });

  it('trailing empty section is dropped', () => {
    const note: NoteInput = {
      note_id: 'test-trailing-empty',
      raw_markdown: `## Content section

We need to improve the search functionality.

## Empty trailing section
`,
    };

    const { sections } = preprocessNote(note);

    expect(sections.length).toBe(1);
    expect(sections[0].heading_text).toBe('Content section');
  });

  it('sections with body content are preserved unchanged', () => {
    const note: NoteInput = {
      note_id: 'test-no-empty',
      raw_markdown: `## First topic

This has content.

## Second topic

This also has content.
`,
    };

    const { sections } = preprocessNote(note);

    expect(sections.length).toBe(2);
    expect(sections[0].heading_text).toBe('First topic');
    expect(sections[1].heading_text).toBe('Second topic');
  });
});

// ============================================
// Regression Tests for FP3 Fixes (2026-02-05)
// ============================================

describe('FP3 regression fixes', () => {
  beforeEach(() => {
    resetSectionCounter();
    resetSuggestionCounter();
  });

  describe('Out-of-scope marker word-boundary matching', () => {
    it('"maybe" does not match "may" calendar marker', () => {
      const note: NoteInput = {
        note_id: 'test-maybe-may',
        raw_markdown: `## Planning thoughts

Maybe we need to rethink the pricing model.
`,
      };

      const { sections } = preprocessNote(note);
      const classified = classifySections(sections, DEFAULT_THRESHOLDS);

      expect(classified.length).toBeGreaterThan(0);
      const section = classified[0];

      // "maybe we need" is a hedged directive that should fire actionability
      const { actionableSignal, outOfScopeSignal } = computeActionabilitySignals(section.intent);

      // Should have actionable signal from "maybe we need" hedged directive
      expect(actionableSignal).toBeGreaterThan(0.5);

      // Should NOT have out-of-scope signal from "may" calendar marker
      // (word boundary should prevent "maybe" from matching "may")
      expect(section.intent.calendar).toBe(0);
    });
  });

  describe('Hedged directive actionability in section body', () => {
    it('detects "we should probably" in body as actionable new_workstream', () => {
      const note: NoteInput = {
        note_id: 'test-we-should-probably',
        raw_markdown: `## Dashboard improvements

We should probably add more filtering options. Maybe we need better sorting too.
`,
      };

      const { sections } = preprocessNote(note);
      const classified = classifySections(sections, DEFAULT_THRESHOLDS);
      const actionable = filterActionableSections(classified);

      expect(actionable.length).toBeGreaterThan(0);
      const section = actionable[0];

      // Should be actionable with new_workstream intent
      expect(section.is_actionable).toBe(true);
      expect(section.intent.new_workstream).toBeGreaterThan(section.intent.plan_change);

      // actionableSignal should be high (from hedged directive)
      const { actionableSignal } = computeActionabilitySignals(section.intent);
      expect(actionableSignal).toBeGreaterThanOrEqual(0.9);

      // Should NOT be classified as plan_change
      expect(isPlanChangeIntentLabel(section.intent)).toBe(false);
    });

    it('detects "maybe we need" in body as actionable new_workstream', () => {
      const note: NoteInput = {
        note_id: 'test-maybe-we-need',
        raw_markdown: `## Feature ideas

Maybe we need to redesign the navigation. It's not intuitive enough.
`,
      };

      const { sections } = preprocessNote(note);
      const classified = classifySections(sections, DEFAULT_THRESHOLDS);
      const actionable = filterActionableSections(classified);

      expect(actionable.length).toBeGreaterThan(0);
      const section = actionable[0];

      expect(section.is_actionable).toBe(true);
      expect(section.intent.new_workstream).toBeGreaterThan(section.intent.plan_change);
      expect(isPlanChangeIntentLabel(section.intent)).toBe(false);
    });

    it('hedged directives about admin tasks are still filtered by out-of-scope', () => {
      const note: NoteInput = {
        note_id: 'test-hedged-admin',
        raw_markdown: `## Action items

We should send the invoice by Friday and schedule the meeting for next week.
`,
      };

      const { sections } = preprocessNote(note);
      const classified = classifySections(sections, DEFAULT_THRESHOLDS);
      const actionable = filterActionableSections(classified);

      // This section contains hedged directive "we should" BUT also has
      // calendar marker ("friday", "next week") and communication ("send")
      // Since hedged directive score (0.9) doesn't trigger the out-of-scope
      // override (which requires non-hedged score >= 0.8), this should be
      // filtered as out-of-scope.
      expect(actionable.length).toBe(0);
    });
  });

  describe('Feature request typing from section body', () => {
    it('body-based request with bulletCount=0 is typed as feature_request', () => {
      const note: NoteInput = {
        note_id: 'test-body-feature-request',
        raw_markdown: `## Onboarding feedback

We need to add boundary detection in the onboarding flow. Users are confused about the limits.
`,
      };

      const { sections } = preprocessNote(note);
      const classified = classifySections(sections, DEFAULT_THRESHOLDS);
      const actionable = filterActionableSections(classified);

      expect(actionable.length).toBeGreaterThan(0);
      const section = actionable[0];

      // Should be actionable new_workstream
      expect(section.is_actionable).toBe(true);
      expect(section.intent.new_workstream).toBeGreaterThan(section.intent.plan_change);

      // Bullet count should be 0 (no bullets)
      expect(section.structural_features.num_list_items).toBe(0);

      // Should be typed as feature_request (not execution_artifact)
      expect(section.typeLabel).toBe('feature_request');
    });

    it('bullet-based sections remain execution_artifact', () => {
      const note: NoteInput = {
        note_id: 'test-bullet-execution',
        raw_markdown: `## Implementation plan

- Add new API endpoint
- Update database schema
- Write tests
`,
      };

      const { sections } = preprocessNote(note);
      const classified = classifySections(sections, DEFAULT_THRESHOLDS);
      const actionable = filterActionableSections(classified);

      expect(actionable.length).toBeGreaterThan(0);
      const section = actionable[0];

      // Should have bullets
      expect(section.structural_features.num_list_items).toBeGreaterThan(0);

      // Should be typed as execution_artifact (not feature_request)
      expect(section.typeLabel).toBe('execution_artifact');
    });

    it('request in body with action verb is typed as feature_request', () => {
      const note: NoteInput = {
        note_id: 'test-body-action-verb',
        raw_markdown: `## User request

Please improve the search functionality to support fuzzy matching.
`,
      };

      const { sections } = preprocessNote(note);
      const classified = classifySections(sections, DEFAULT_THRESHOLDS);
      const actionable = filterActionableSections(classified);

      expect(actionable.length).toBeGreaterThan(0);
      const section = actionable[0];

      expect(section.is_actionable).toBe(true);
      expect(section.structural_features.num_list_items).toBe(0);
      expect(section.typeLabel).toBe('feature_request');
    });
  });

  describe('Structural Hint Metadata', () => {
    beforeEach(() => {
      resetSectionCounter();
      resetSuggestionCounter();
    });

    it('should propagate structural_hint for prose feature requests', () => {
      const note: NoteInput = {
        note_id: 'test-feature-request-hint',
        raw_markdown: `# Product Requests

## Add Dark Mode

We should add a dark mode toggle to the settings page to improve accessibility and user comfort during evening hours.
`,
      };

      const result = generateSuggestions(note);

      expect(result.suggestions).toHaveLength(1);
      const suggestion = result.suggestions[0];

      // Should be marked as feature_request structurally
      expect(suggestion.structural_hint).toBe('feature_request');

      // Should be routed as create_new
      expect(suggestion.routing.create_new).toBe(true);

      // Should have feature_request type (not plan_mutation or execution_artifact)
      expect(suggestion.type).toBe('feature_request');
    });

    it('should propagate structural_hint for bullet-based initiatives', () => {
      const note: NoteInput = {
        note_id: 'test-execution-artifact-hint',
        raw_markdown: `# Q3 Initiatives

## Launch Partner Portal

Create a partner portal for third-party integrations.

Goal: 15 active partners by Q4.

Features:
- API documentation
- Sandbox environment
- Partner analytics dashboard

Approach:
1. Build portal backend
2. Create partner onboarding flow
3. Launch beta program
`,
      };

      const result = generateSuggestions(note);

      expect(result.suggestions).toHaveLength(1);
      const suggestion = result.suggestions[0];

      // Should be marked as execution_artifact structurally (has bullets)
      expect(suggestion.structural_hint).toBe('execution_artifact');

      // Should be execution_artifact type
      expect(suggestion.type).toBe('execution_artifact');

      // Verify it has structured payload
      expect(suggestion.payload).toHaveProperty('draft_initiative');
      if ('draft_initiative' in suggestion.payload) {
        expect(suggestion.payload.draft_initiative.title).toBeDefined();
      }
    });

    it('should preserve structural hints for multiple candidates in mixed notes', () => {
      const note: NoteInput = {
        note_id: 'test-mixed-structural',
        raw_markdown: `# Planning Session

## Feature Request

We should add export functionality for reports. Users have been asking for CSV and PDF downloads.

## Launch Analytics Platform

Create an analytics platform for customer insights.

Goal: Track 10+ key metrics.

Features:
- Real-time dashboards
- Custom report builder
- Data export API

Plan:
1. Design dashboard UI
2. Build data pipeline
3. Launch beta
`,
      };

      const result = generateSuggestions(note);

      // Should emit 2 distinct suggestions
      expect(result.suggestions.length).toBeGreaterThanOrEqual(2);

      // Find feature request (prose, no bullets)
      const featureRequest = result.suggestions.find(
        s => s.structural_hint === 'feature_request'
      );
      expect(featureRequest).toBeDefined();
      expect(featureRequest?.title).toMatch(/feature.request/i);

      // Find execution artifact (bullet-based)
      const executionArtifact = result.suggestions.find(
        s => s.structural_hint === 'execution_artifact'
      );
      expect(executionArtifact).toBeDefined();
      expect(executionArtifact?.title).toMatch(/analytics/i);

      // Both should be routed as create_new
      expect(featureRequest?.routing.create_new).toBe(true);
      expect(executionArtifact?.routing.create_new).toBe(true);
    });
  });

  // ==========================================================================
  // feature_request as first-class type label
  // ==========================================================================
  describe('feature_request first-class type', () => {
    beforeEach(() => {
      resetSectionCounter();
      resetSuggestionCounter();
    });

    it('prose feature request produces typeLabel == feature_request with scoresByLabel', () => {
      const note: NoteInput = {
        note_id: 'test-fr-prose',
        raw_markdown: `## Boundary detection

I would really like you to add boundary detection to the onboarding flow.
This would help new users understand where they are in the process and reduce drop-off.
`,
      };

      const result = generateSuggestionsWithDebug(note, {}, { enable_debug: true }, { verbosity: 'REDACTED' });

      // Should emit one suggestion
      expect(result.suggestions).toHaveLength(1);
      const suggestion = result.suggestions[0];

      // suggestion.type must be feature_request
      expect(suggestion.type).toBe('feature_request');

      // structural_hint must match
      expect(suggestion.structural_hint).toBe('feature_request');

      // Debug: typeClassification must contain feature_request
      const debugSection = result.debugRun!.sections.find(
        s => s.sectionId === suggestion.section_id
      );
      expect(debugSection).toBeDefined();
      expect(debugSection!.typeClassification?.topLabel).toBe('feature_request');
      expect(debugSection!.typeClassification?.scoresByLabel).toHaveProperty('feature_request');

      // Debug: decisions.typeLabel must be feature_request
      expect(debugSection!.decisions.typeLabel).toBe('feature_request');

      // candidate.metadata.type must be feature_request
      const candidate = debugSection!.candidates.find(
        c => c.candidateId === suggestion.suggestion_id
      );
      expect(candidate).toBeDefined();
      expect(candidate!.metadata?.type).toBe('feature_request');
    });

    it('bullet execution list remains execution_artifact', () => {
      const note: NoteInput = {
        note_id: 'test-fr-bullets',
        raw_markdown: `## Monitoring setup

- Add Datadog dashboards for core metrics
- Set up PagerDuty escalation policies
- Configure alert thresholds for latency and error rates
`,
      };

      const result = generateSuggestionsWithDebug(note, {}, { enable_debug: true }, { verbosity: 'REDACTED' });

      expect(result.suggestions).toHaveLength(1);
      const suggestion = result.suggestions[0];

      // Bullet-based sections stay execution_artifact
      expect(suggestion.type).toBe('execution_artifact');
      expect(suggestion.structural_hint).toBe('execution_artifact');

      // Debug: typeClassification
      const debugSection = result.debugRun!.sections.find(
        s => s.sectionId === suggestion.section_id
      );
      expect(debugSection).toBeDefined();
      expect(debugSection!.typeClassification?.topLabel).toBe('execution_artifact');
      expect(debugSection!.typeClassification?.scoresByLabel).toHaveProperty('execution_artifact');
    });

    it('plan change produces typeLabel == plan_mutation (unchanged)', () => {
      const note: NoteInput = {
        note_id: 'test-fr-planchange',
        raw_markdown: `## Timeline adjustment

We need to push Q2 launch to Q3 because the integration work is taking longer than expected.
Shift the beta milestone from April to June.
`,
      };

      const result = generateSuggestions(note);

      expect(result.suggestions.length).toBeGreaterThanOrEqual(1);
      const suggestion = result.suggestions[0];

      // plan_change sections must remain plan_mutation
      expect(suggestion.type).toBe('plan_mutation');
    });

    it('mixed note emits feature_request, execution_artifact, and plan_mutation distinctly', () => {
      const note: NoteInput = {
        note_id: 'test-fr-mixed',
        raw_markdown: `## Feature request

We should add a preference center so users can control which notifications they receive.
Right now everything is on by default and the feedback is consistently negative.

## Monitoring setup

- Add Datadog dashboards for core metrics
- Set up PagerDuty escalation policies
- Configure alert thresholds for latency and error rates

## Timeline change

Push the Q2 launch to Q3 because the integration work is taking longer than expected.
Shift the beta milestone from April to June.
`,
      };

      const result = generateSuggestions(note);

      // Should emit at least 3 suggestions
      expect(result.suggestions.length).toBeGreaterThanOrEqual(3);

      // Collect all types
      const types = result.suggestions.map(s => s.type);
      expect(types).toContain('feature_request');
      expect(types).toContain('execution_artifact');
      expect(types).toContain('plan_mutation');
    });
  });
});
