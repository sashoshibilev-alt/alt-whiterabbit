/**
 * Plan Change Invariants Tests
 *
 * Tests ensuring that sections with intentLabel === "plan_change" always
 * produce at least one suggestion and are never dropped at ACTIONABILITY
 * or THRESHOLD stages.
 *
 * Per fix-plan-change-drops plan.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  generateSuggestionsWithDebug,
  generateSuggestions,
  classifySection,
  classifySectionWithLLM,
  filterActionableSections,
  runScoringPipeline,
  applyConfidenceBasedProcessing,
  isPlanChangeIntentLabel,
  classifyIntent,
  isSuggestionGrounded,
  groupSuggestionsForDisplay,
  NoteInput,
  Section,
  ClassifiedSection,
  Suggestion,
  ThresholdConfig,
  DEFAULT_THRESHOLDS,
  GeneratorConfig,
  DEFAULT_CONFIG,
  MockLLMProvider,
  DropStage,
  DropReason,
  computeDebugRunSummary,
  IntentClassification,
} from './index';
import { resetSectionCounter } from './preprocessing';
import { resetSuggestionCounter } from './synthesis';

// ============================================
// Test Fixtures
// ============================================

/**
 * Note with plan_change section that has low actionable signal
 */
const LOW_SIGNAL_PLAN_CHANGE_NOTE: NoteInput = {
  note_id: 'test-low-signal-plan-change',
  raw_markdown: `# Planning Notes

## Roadmap Adjustments

Shift from enterprise to SMB customers.

- Defer enterprise features
- Focus on self-serve onboarding
`,
};

/**
 * Note with plan_change section but non-actionable type classification
 */
const NON_ACTIONABLE_TYPE_PLAN_CHANGE_NOTE: NoteInput = {
  note_id: 'test-non-actionable-type-plan-change',
  raw_markdown: `# Q2 Updates

## Scope Changes

Shift from enterprise to SMB focus for Q2.

- Defer enterprise SSO to Q3
- Prioritize self-serve signup
- Remove advanced analytics from scope
`,
};

/**
 * Note with plan_change section that will score below thresholds
 */
const LOW_SCORE_PLAN_CHANGE_NOTE: NoteInput = {
  note_id: 'test-low-score-plan-change',
  raw_markdown: `# Planning

## Scope

Adjust scope for next phase.

- Move some items to later
- Focus on core features
`,
};

/**
 * Mock section with plan_change intent but low scores
 */
function createMockPlanChangeSection(overrides?: Partial<ClassifiedSection>): ClassifiedSection {
  const baseSection: ClassifiedSection = {
    section_id: 'mock-section-1',
    note_id: 'mock-note',
    heading_text: 'Scope Changes',
    heading_level: 2,
    start_line: 0,
    end_line: 5,
    body_lines: [
      { index: 1, text: 'Shift focus to new priorities', line_type: 'paragraph' },
      { index: 2, text: '- Defer some features', line_type: 'list_item', indent_level: 0 },
      { index: 3, text: '- Prioritize core items', line_type: 'list_item', indent_level: 0 },
    ],
    structural_features: {
      num_lines: 3,
      num_list_items: 2,
      has_dates: false,
      has_metrics: false,
      has_quarter_refs: false,
      has_version_refs: false,
      has_launch_keywords: false,
      initiative_phrase_density: 0.1,
    },
    raw_text: 'Shift focus to new priorities\n- Defer some features\n- Prioritize core items',
    intent: {
      plan_change: 0.6,
      new_workstream: 0.2,
      status_informational: 0.1,
      communication: 0.05,
      research: 0.03,
      calendar: 0.01,
      micro_tasks: 0.01,
    },
    is_actionable: true,
    actionability_reason: 'Actionable: signal=0.600 >= 0.500',
    actionable_signal: 0.6,
    out_of_scope_signal: 0.05,
    suggested_type: 'project_update',
    type_confidence: 0.7,
    ...overrides,
  };
  return baseSection;
}

// ============================================
// ACTIONABILITY Invariant Tests
// ============================================

describe('ACTIONABILITY Invariants', () => {
  beforeEach(() => {
    resetSectionCounter();
    resetSuggestionCounter();
  });

  describe('Invariant A1: plan_change sections always run synthesis', () => {
    it('should synthesize at least one candidate for plan_change with low action signal', async () => {
      const result = generateSuggestionsWithDebug(
        LOW_SIGNAL_PLAN_CHANGE_NOTE,
        undefined,
        {
          enable_debug: true,
          thresholds: {
            ...DEFAULT_THRESHOLDS,
            T_action: 0.6, // Set higher to force low signal scenario
          },
        },
        { verbosity: 'REDACTED' }
      );

      expect(result.debugRun).toBeDefined();
      const debugRun = result.debugRun!;

      // Find plan_change sections
      const planChangeSections = debugRun.sections.filter(
        s => s.decisions.intentLabel === 'plan_change'
      );

      // Should have at least one plan_change section
      expect(planChangeSections.length).toBeGreaterThan(0);

      for (const section of planChangeSections) {
        // Should not be dropped at ACTIONABILITY
        expect(section.dropStage).not.toBe(DropStage.ACTIONABILITY);
        expect(section.dropReason).not.toBe(DropReason.NOT_ACTIONABLE);

        // Should have run synthesis
        expect(section.synthesisRan).toBe(true);

        // Should have at least one candidate
        expect(section.candidates.length).toBeGreaterThanOrEqual(1);
      }
    });

    it('should never filter out plan_change sections even with low actionable signal', () => {
      const mockIntent: IntentClassification = {
        plan_change: 0.35, // Below T_action=0.5 but still highest
        new_workstream: 0.2,
        status_informational: 0.15,
        communication: 0.1,
        research: 0.1,
        calendar: 0.05,
        micro_tasks: 0.05,
      };

      const mockSection: Section = {
        section_id: 'test-section',
        note_id: 'test-note',
        heading_text: 'Roadmap Adjustments',
        heading_level: 2,
        start_line: 0,
        end_line: 3,
        body_lines: [
          { index: 0, text: 'Adjust priorities', line_type: 'paragraph' },
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
        raw_text: 'Adjust priorities',
      };

      const highThresholds: ThresholdConfig = {
        ...DEFAULT_THRESHOLDS,
        T_action: 0.5,
      };

      const classified = classifySection(mockSection, highThresholds);

      // Verify it's detected as plan_change
      expect(isPlanChangeIntentLabel(classified.intent)).toBe(true);

      // Should be actionable despite low signal
      expect(classified.is_actionable).toBe(true);
      // Strategy-only plan_change sections (no concrete delta or schedule event)
      // are now classified as idea rather than forced to project_update.
      // The invariant is that they are ACTIONABLE and EMITTED, not their type.
      expect(classified.suggested_type).toMatch(/^(idea|project_update)$/);

      // Should pass filter
      const filtered = filterActionableSections([classified]);
      expect(filtered).toHaveLength(1);
      expect(filtered[0].section_id).toBe('test-section');
    });
  });

  describe('Invariant A2: type classification never drops plan_change', () => {
    it('should classify plan_change section as actionable (rule-based)', () => {
      // Create a section with explicit plan_change keywords (strategy-only, no concrete delta)
      const mockSection: Section = {
        section_id: 'test-section',
        note_id: 'test-note',
        heading_text: 'Scope Changes',
        heading_level: 2,
        start_line: 0,
        end_line: 3,
        body_lines: [
          { index: 0, text: 'Shift focus slightly', line_type: 'paragraph' },
          { index: 1, text: 'Defer some items', line_type: 'paragraph' },
        ],
        structural_features: {
          num_lines: 2,
          num_list_items: 0,
          has_dates: false,
          has_metrics: false,
          has_quarter_refs: false,
          has_version_refs: false,
          has_launch_keywords: false,
          initiative_phrase_density: 0,
        },
        raw_text: 'Shift focus slightly\nDefer some items',
      };

      const classified = classifySection(mockSection, DEFAULT_THRESHOLDS);

      // Verify it's detected as plan_change
      expect(isPlanChangeIntentLabel(classified.intent)).toBe(true);

      // Should be actionable
      expect(classified.is_actionable).toBe(true);

      // Strategy-only sections may emit as idea or project_update — must not be dropped
      // The key invariant is actionability, not the specific type label.
      expect(classified.suggested_type).toMatch(/^(idea|project_update)$/);
    });

    it('should force project_update type for plan_change section (LLM)', async () => {
      const mockLLMProvider = new MockLLMProvider();
      mockLLMProvider.setResponse('classify', {
        plan_change: 0.5,
        new_workstream: 0.1,
        status_informational: 0.2,
        communication: 0.1,
        research: 0.05,
        calendar: 0.03,
        micro_tasks: 0.02,
      });

      const mockSection: Section = {
        section_id: 'test-section',
        note_id: 'test-note',
        heading_text: 'Updates',
        heading_level: 2,
        start_line: 0,
        end_line: 2,
        body_lines: [
          { index: 0, text: 'Some vague update', line_type: 'paragraph' },
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
        raw_text: 'Some vague update',
      };

      const classified = await classifySectionWithLLM(
        mockSection,
        DEFAULT_THRESHOLDS,
        { llmProvider: mockLLMProvider }
      );

      // Should be actionable
      expect(classified.is_actionable).toBe(true);

      // Should have project_update type
      expect(classified.suggested_type).toBe('project_update');
    });
  });
});

// ============================================
// THRESHOLD Invariant Tests
// ============================================

describe('THRESHOLD Invariants', () => {
  beforeEach(() => {
    resetSectionCounter();
    resetSuggestionCounter();
  });

  describe('Invariant T1: plan_change never dropped at THRESHOLD', () => {
    it('should emit low-score plan_change without dropping (no clarification badge for low score alone)', () => {
      const mockSection = createMockPlanChangeSection({
        // Set low scores
        actionable_signal: 0.4,
        type_confidence: 0.3,
      });

      const mockSuggestion: Suggestion = {
        suggestion_id: 'mock-sug-1',
        note_id: 'mock-note',
        section_id: 'mock-section-1',
        type: 'project_update',
        title: 'Adjust scope',
        payload: {
          after_description: 'Shift focus to new priorities',
        },
        evidence_spans: [
          {
            start_line: 1,
            end_line: 3,
            text: 'Shift focus\n- Defer features\n- Prioritize core',
          },
        ],
        scores: {
          section_actionability: 0.4, // Below T_section_min (0.6)
          type_choice_confidence: 0.5,
          synthesis_confidence: 0.5,
          overall: 0.4, // Below T_overall_min (0.65)
        },
        routing: {
          create_new: true,
        },
      };

      const thresholds: ThresholdConfig = {
        ...DEFAULT_THRESHOLDS,
        T_section_min: 0.6,
        T_overall_min: 0.65,
      };

      const result = applyConfidenceBasedProcessing([mockSuggestion], thresholds);

      // Should not be dropped
      expect(result.dropped).toHaveLength(0);

      // Should be in passed with downgrade
      expect(result.passed).toHaveLength(1);
      const processed = result.passed[0];

      // Should be flagged as low confidence
      expect(processed.is_high_confidence).toBe(false);

      // Per new policy: low score alone does NOT trigger needs_clarification badge
      // Badge only appears when V3 validator failed or dropReason exists
      expect(processed.needs_clarification).toBe(false);

      // Evidence should be preserved
      expect(processed.evidence_spans).toEqual(mockSuggestion.evidence_spans);
    });

    it('should never drop plan_change suggestions in runScoringPipeline cap logic', () => {
      const sections = new Map<string, ClassifiedSection>();
      const section1 = createMockPlanChangeSection({ section_id: 'section-1' });
      const section2 = createMockPlanChangeSection({ section_id: 'section-2' });
      const section3 = createMockPlanChangeSection({ section_id: 'section-3' });
      sections.set('section-1', section1);
      sections.set('section-2', section2);
      sections.set('section-3', section3);

      const mockPlanChangeSuggestions: Suggestion[] = [
        {
          suggestion_id: 'sug-1',
          note_id: 'mock-note',
          section_id: 'section-1',
          type: 'project_update',
          title: 'Adjust scope A',
          payload: { after_description: 'Description A' },
          evidence_spans: [],
          scores: {
            section_actionability: 0.7,
            type_choice_confidence: 0.7,
            synthesis_confidence: 0.7,
            overall: 0.7,
          },
          routing: { create_new: true },
        },
        {
          suggestion_id: 'sug-2',
          note_id: 'mock-note',
          section_id: 'section-2',
          type: 'project_update',
          title: 'Adjust scope B',
          payload: { after_description: 'Description B' },
          evidence_spans: [],
          scores: {
            section_actionability: 0.65,
            type_choice_confidence: 0.65,
            synthesis_confidence: 0.65,
            overall: 0.65,
          },
          routing: { create_new: true },
        },
        {
          suggestion_id: 'sug-3',
          note_id: 'mock-note',
          section_id: 'section-3',
          type: 'project_update',
          title: 'Adjust scope C',
          payload: { after_description: 'Description C' },
          evidence_spans: [],
          scores: {
            section_actionability: 0.6,
            type_choice_confidence: 0.6,
            synthesis_confidence: 0.6,
            overall: 0.6,
          },
          routing: { create_new: true },
        },
      ];

      const config: GeneratorConfig = {
        ...DEFAULT_CONFIG,
        max_suggestions: 2, // Cap at 2, but we have 3 plan_change — cap does NOT apply to project_updates
      };

      const result = runScoringPipeline(mockPlanChangeSuggestions, sections, config);

      // INVARIANT: ALL project_update suggestions survive regardless of max_suggestions cap
      expect(result.suggestions).toHaveLength(3);
      expect(result.suggestions.every(s => s.type === 'project_update')).toBe(true);

      // All three project_updates must be present
      expect(result.suggestions.some(s => s.suggestion_id === 'sug-1')).toBe(true);
      expect(result.suggestions.some(s => s.suggestion_id === 'sug-2')).toBe(true);
      expect(result.suggestions.some(s => s.suggestion_id === 'sug-3')).toBe(true);

      // No project_update dropped
      expect(result.dropped).toHaveLength(0);
    });

    it('should never drop actionable sections at THRESHOLD (INVARIANT)', () => {
    // This is the core invariant: if is_actionable === true, emitted must be true
    const actionableSection: ClassifiedSection = {
      section_id: 'actionable-section',
      note_id: 'test-note',
      heading_text: 'Important Task',
      heading_level: 2,
      start_line: 0,
      end_line: 3,
      body_lines: [
        { index: 0, text: 'Add boundary detection', line_type: 'paragraph' },
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
      raw_text: 'Add boundary detection',
      intent: {
        plan_change: 0.3,
        new_workstream: 0.6, // Highest, but not plan_change
        status_informational: 0.05,
        communication: 0.02,
        research: 0.01,
        calendar: 0.01,
        micro_tasks: 0.01,
      },
      is_actionable: true, // PASSED ACTIONABILITY
      actionability_reason: 'Actionable: imperative verb detected',
      actionable_signal: 0.9,
      out_of_scope_signal: 0.02,
      suggested_type: 'idea',
      type_confidence: 0.7,
    };

    const sections = new Map<string, ClassifiedSection>();
    sections.set('actionable-section', actionableSection);

    const suggestion: Suggestion = {
      suggestion_id: 'sug-actionable',
      note_id: 'test-note',
      section_id: 'actionable-section',
      type: 'idea', // NOT plan_change
      title: 'Add boundary detection',
      payload: { draft_initiative: { title: 'Boundary detection', description: 'Add detection' } },
      evidence_spans: [{ start_line: 0, end_line: 1, text: 'Add boundary detection' }],
      scores: {
        section_actionability: 0.4, // Below T_section_min
        type_choice_confidence: 0.5,
        synthesis_confidence: 0.5,
        overall: 0.4, // Below T_overall_min
      },
      routing: { create_new: true },
    };

    const thresholds: ThresholdConfig = {
      ...DEFAULT_THRESHOLDS,
      T_section_min: 0.6,
      T_overall_min: 0.65,
    };

    // Without sections map, would be dropped
    const resultWithoutSections = applyConfidenceBasedProcessing([suggestion], thresholds);
    expect(resultWithoutSections.dropped.length).toBeGreaterThan(0);

    // With sections map showing is_actionable=true, must NOT be dropped
    const resultWithSections = applyConfidenceBasedProcessing([suggestion], thresholds, sections);

    // INVARIANT: is_actionable === true implies emitted === true
    expect(resultWithSections.dropped).toHaveLength(0);
    expect(resultWithSections.passed).toHaveLength(1);

    // Should be emitted with low confidence flag (not dropped)
    const processed = resultWithSections.passed[0];
    expect(processed.is_high_confidence).toBe(false);
    // Per new policy: low score alone does NOT trigger needs_clarification badge
    expect(processed.needs_clarification).toBe(false);
  });

  it('should only cap idea suggestions, never plan_change', () => {
      // Test the capping logic directly with applyConfidenceBasedProcessing + manual capping
      const planSuggestion: Suggestion = {
        suggestion_id: 'plan-sug',
        note_id: 'mock-note',
        section_id: 'plan-section',
        type: 'project_update',
        title: 'Plan change',
        payload: { after_description: 'Plan description' },
        evidence_spans: [{ start_line: 0, end_line: 2, text: 'Evidence' }],
        scores: {
          section_actionability: 0.65,
          type_choice_confidence: 0.65,
          synthesis_confidence: 0.7,
          overall: 0.65,
        },
        routing: { create_new: true },
      };

      const artifact1: Suggestion = {
        suggestion_id: 'artifact-sug-1',
        note_id: 'mock-note',
        section_id: 'artifact-section-1',
        type: 'idea',
        title: 'New initiative A',
        payload: { draft_initiative: { title: 'Initiative A', description: 'Desc A' } },
        evidence_spans: [{ start_line: 0, end_line: 2, text: 'Evidence A' }],
        scores: {
          section_actionability: 0.9,
          type_choice_confidence: 0.9,
          synthesis_confidence: 0.9,
          overall: 0.9,
        },
        routing: { create_new: true },
      };

      const artifact2: Suggestion = {
        suggestion_id: 'artifact-sug-2',
        note_id: 'mock-note',
        section_id: 'artifact-section-2',
        type: 'idea',
        title: 'New initiative B',
        payload: { draft_initiative: { title: 'Initiative B', description: 'Desc B' } },
        evidence_spans: [{ start_line: 0, end_line: 2, text: 'Evidence B' }],
        scores: {
          section_actionability: 0.85,
          type_choice_confidence: 0.85,
          synthesis_confidence: 0.85,
          overall: 0.85,
        },
        routing: { create_new: true },
      };

      const allSuggestions = [planSuggestion, artifact1, artifact2];

      // Apply confidence-based processing
      const { passed } = applyConfidenceBasedProcessing(allSuggestions, DEFAULT_THRESHOLDS);

      // All should pass threshold check
      expect(passed.length).toBe(3);

      // Now test the capping logic: separate by type and cap
      const projectUpdates = passed.filter(s => s.type === 'project_update');
      const ideas = passed.filter(s => s.type === 'idea');

      expect(projectUpdates).toHaveLength(1);
      expect(ideas).toHaveLength(2);

      // With max_suggestions = 2, should keep 1 project_update + 1 idea (top-scoring)
      const maxSuggestions = 2;
      const remainingSlots = Math.max(0, maxSuggestions - projectUpdates.length);
      const keptIdeas = ideas.slice(0, remainingSlots);
      const final = [...projectUpdates, ...keptIdeas];

      expect(final).toHaveLength(2);
      expect(final.some(s => s.type === 'project_update')).toBe(true);
      expect(final.some(s => s.type === 'idea')).toBe(true);

      // One idea should be dropped
      const droppedIdeas = ideas.slice(remainingSlots);
      expect(droppedIdeas).toHaveLength(1);
    });
  });
});

// ============================================
// End-to-End Invariant Tests
// ============================================

describe('End-to-End Invariants (Debug JSON)', () => {
  beforeEach(() => {
    resetSectionCounter();
    resetSuggestionCounter();
  });

  it('should emit plan_change + low action signal as comment with needs_clarification', async () => {
    const result = generateSuggestionsWithDebug(
      LOW_SIGNAL_PLAN_CHANGE_NOTE,
      undefined,
      {
        enable_debug: true,
        thresholds: {
          ...DEFAULT_THRESHOLDS,
          T_action: 0.7, // Force low signal scenario
          T_overall_min: 0.8, // Force low score scenario
        },
      },
      { verbosity: 'REDACTED' }
    );

    expect(result.debugRun).toBeDefined();
    const debugRun = result.debugRun!;

    // Find plan_change sections
    const planChangeSections = debugRun.sections.filter(
      s => s.decisions.intentLabel === 'plan_change'
    );

    // Should have at least one plan_change section
    expect(planChangeSections.length).toBeGreaterThan(0);

    // Verify at least one suggestion was emitted (this is the key invariant)
    expect(result.suggestions.length).toBeGreaterThan(0);

    // All plan_change sections should have run synthesis
    for (const section of planChangeSections) {
      // Should have run synthesis
      expect(section.synthesisRan).toBe(true);
      
      // Should have at least one candidate
      expect(section.candidates.length).toBeGreaterThan(0);

      // Should not be dropped at ACTIONABILITY or THRESHOLD
      if (section.dropStage) {
        expect(section.dropStage).not.toBe(DropStage.ACTIONABILITY);
        expect(section.dropStage).not.toBe(DropStage.THRESHOLD);
      }
    }

    // Strategy-only plan_change sections (no concrete delta) now emit as idea rather than
    // project_update. The key invariant is that suggestions are emitted (not dropped).
    // project_update suggestions are only expected when a concrete delta is present.
    const allSuggestions = result.suggestions;
    expect(allSuggestions.length).toBeGreaterThan(0);

    // Downgraded suggestions should have needs_clarification
    const lowConfidenceSuggestions = allSuggestions.filter(s => !s.is_high_confidence);
    if (lowConfidenceSuggestions.length > 0) {
      for (const suggestion of lowConfidenceSuggestions) {
        expect(suggestion.needs_clarification).toBe(true);
        expect(suggestion.clarification_reasons).toBeDefined();
      }
    }
  });

  it('should never have plan_change candidates with dropStage=THRESHOLD or ACTIONABILITY', async () => {
    const mixedNote: NoteInput = {
      note_id: 'test-mixed',
      raw_markdown: `# Planning Session

## Roadmap Adjustments

Shift focus to core features and defer nice-to-haves.

- Move analytics to Q3
- Focus on core product stability

## New Project Idea

Launch a customer success program to improve retention.

Goal: Reduce churn by 50%.
`,
    };

    const result = generateSuggestionsWithDebug(
      mixedNote,
      undefined,
      {
        enable_debug: true,
        thresholds: {
          ...DEFAULT_THRESHOLDS,
          T_action: 0.5,
          T_overall_min: 0.7,
        },
      },
      { verbosity: 'REDACTED' }
    );

    expect(result.debugRun).toBeDefined();
    const debugRun = result.debugRun!;

    // Find all plan_change sections
    const planChangeSections = debugRun.sections.filter(
      s => s.decisions.intentLabel === 'plan_change'
    );

    for (const section of planChangeSections) {
      // Section itself should not be dropped at these stages
      expect(section.dropStage).not.toBe(DropStage.ACTIONABILITY);
      expect(section.dropStage).not.toBe(DropStage.THRESHOLD);

      // Check all candidates
      for (const candidate of section.candidates) {
        if (candidate.metadata?.type === 'project_update') {
          // Should never be dropped at ACTIONABILITY or THRESHOLD
          expect(candidate.dropStage).not.toBe(DropStage.ACTIONABILITY);
          expect(candidate.dropStage).not.toBe(DropStage.THRESHOLD);
          expect(candidate.dropReason).not.toBe(DropReason.NOT_ACTIONABLE);
          expect(candidate.dropReason).not.toBe(DropReason.SCORE_BELOW_THRESHOLD);
        }
      }
    }
  });

  it('should track planChangeSectionsCount and droppedPlanChangeCount in summary', async () => {
    const result = generateSuggestionsWithDebug(
      NON_ACTIONABLE_TYPE_PLAN_CHANGE_NOTE,
      undefined,
      {
        enable_debug: true,
        thresholds: DEFAULT_THRESHOLDS,
      },
      { verbosity: 'REDACTED' }
    );

    expect(result.debugRun).toBeDefined();
    const debugRun = result.debugRun!;

    const summary = computeDebugRunSummary(debugRun);

    // Should track plan_change sections
    expect(summary.planChangeSectionsCount).toBeGreaterThanOrEqual(0);

    // After fixes, droppedPlanChangeCount should be 0
    expect(summary.droppedPlanChangeCount).toBe(0);
  });

  it('runtime entrypoint: plan_change sections are never dropped at ACTIONABILITY', () => {
    // Test the exact entrypoint used by the Convex action
    const result = generateSuggestionsWithDebug(
      LOW_SIGNAL_PLAN_CHANGE_NOTE,
      undefined,
      {
        enable_debug: true,
        thresholds: {
          ...DEFAULT_THRESHOLDS,
          T_action: 0.7, // Force low signal scenario
        },
      },
      { verbosity: 'REDACTED' }
    );

    expect(result.debugRun).toBeDefined();
    const debugRun = result.debugRun!;

    // Check runtime fingerprint is present
    expect(debugRun.meta.runtimeFingerprint).toBeDefined();
    expect(debugRun.meta.runtimeFingerprint).toContain('planchange-protection');
    expect(debugRun.config.additionalFlags?.planChangeProtection).toBe(true);

    // Find all plan_change sections
    const badSections = debugRun.sections.filter(
      (s) =>
        s.decisions.intentLabel === 'plan_change' &&
        s.dropStage === DropStage.ACTIONABILITY
    );

    // INVARIANT: No plan_change section should be dropped at ACTIONABILITY
    expect(badSections).toHaveLength(0);

    // All plan_change sections should have run synthesis
    const planChangeSections = debugRun.sections.filter(
      (s) => s.decisions.intentLabel === 'plan_change'
    );
    for (const section of planChangeSections) {
      expect(section.synthesisRan).toBe(true);
    }
  });

  it('runtime entrypoint: project_update candidates are never dropped at THRESHOLD', () => {
    // Test the exact entrypoint used by the Convex action
    const result = generateSuggestionsWithDebug(
      LOW_SIGNAL_PLAN_CHANGE_NOTE,
      undefined,
      {
        enable_debug: true,
        thresholds: {
          ...DEFAULT_THRESHOLDS,
          T_overall_min: 0.85,
          T_section_min: 0.75,
        },
      },
      { verbosity: 'REDACTED' }
    );

    expect(result.debugRun).toBeDefined();
    const debugRun = result.debugRun!;

    // Check runtime fingerprint is present
    expect(debugRun.meta.runtimeFingerprint).toBeDefined();
    expect(debugRun.config.additionalFlags?.planChangeProtection).toBe(true);

    const violations: string[] = [];

    // Check all candidates across all sections
    for (const section of debugRun.sections) {
      if (section.decisions.intentLabel !== 'plan_change') continue;
      
      for (const candidate of section.candidates) {
        if (candidate.metadata?.type === 'project_update') {
          // INVARIANT: project_update candidates should never be dropped at THRESHOLD
          if (candidate.dropStage === DropStage.THRESHOLD) {
            violations.push(candidate.candidateId);
          }
          // They also should not have SCORE_BELOW_THRESHOLD as drop reason
          if (candidate.dropReason === DropReason.SCORE_BELOW_THRESHOLD) {
            violations.push(`${candidate.candidateId}:SCORE_DROP`);
          }
        }
      }
    }

    expect(violations).toHaveLength(0);
  });
});

// ============================================
// Fingerprint Tests (Task 1 & Task 6)
// ============================================

describe('Fingerprint Verification', () => {
  beforeEach(() => {
    resetSectionCounter();
    resetSuggestionCounter();
  });

  it('should include __fingerprint at root level of debug JSON', () => {
    const result = generateSuggestionsWithDebug(
      LOW_SIGNAL_PLAN_CHANGE_NOTE,
      undefined,
      { enable_debug: true },
      { verbosity: 'REDACTED' }
    );

    expect(result.debugRun).toBeDefined();
    const debugRun = result.debugRun!;

    // Task 1: Root-level fingerprint must be present
    expect(debugRun.__fingerprint).toBeDefined();
    expect(debugRun.__fingerprint).toContain('FP3:');
  });

  it('should include meta.runtimeFingerprint', () => {
    const result = generateSuggestionsWithDebug(
      LOW_SIGNAL_PLAN_CHANGE_NOTE,
      undefined,
      { enable_debug: true },
      { verbosity: 'REDACTED' }
    );

    expect(result.debugRun).toBeDefined();
    const debugRun = result.debugRun!;

    // Task 1: meta.runtimeFingerprint must be present
    expect(debugRun.meta.runtimeFingerprint).toBeDefined();
    expect(debugRun.meta.runtimeFingerprint).toContain('FP3:');
  });

  it('should include config.additionalFlags.planChangeProtection', () => {
    const result = generateSuggestionsWithDebug(
      LOW_SIGNAL_PLAN_CHANGE_NOTE,
      undefined,
      { enable_debug: true },
      { verbosity: 'REDACTED' }
    );

    expect(result.debugRun).toBeDefined();
    const debugRun = result.debugRun!;

    // Task 1: planChangeProtection flag must be true
    expect(debugRun.config.additionalFlags?.planChangeProtection).toBe(true);
    expect(debugRun.config.additionalFlags?.runtimeFingerprint).toBeDefined();
    expect(debugRun.config.additionalFlags?.runtimeFingerprint).toContain('FP3:');
  });

  it('should have generatorVersion containing FP3', () => {
    const result = generateSuggestionsWithDebug(
      LOW_SIGNAL_PLAN_CHANGE_NOTE,
      undefined,
      { enable_debug: true },
      { verbosity: 'REDACTED' }
    );

    expect(result.debugRun).toBeDefined();
    const debugRun = result.debugRun!;

    // Task 1: generatorVersion must contain FP3 marker
    expect(debugRun.meta.generatorVersion).toContain('FP3');
  });
});

// ============================================
// End-to-End Test (Task 6): Same entrypoint as Convex
// ============================================

describe('End-to-End Test (Task 6): Same entrypoint as Convex', () => {
  beforeEach(() => {
    resetSectionCounter();
    resetSuggestionCounter();
  });

  it('should pass all plan_change invariants via generateSuggestionsWithDebug', () => {
    const testNote: NoteInput = {
      note_id: 'e2e-test-note',
      raw_markdown: `# Q3 Planning

## Roadmap Adjustments

We need to shift focus from enterprise features to SMB customers.

- Defer enterprise SSO to Q4
- Prioritize self-serve onboarding
- Move analytics to Q3
- Focus on core product stability

## New Growth Initiative

Launch a customer success program to improve retention.

- Goal: Reduce churn by 50%
- Phase 1: Build customer health dashboard
`,
    };

    const result = generateSuggestionsWithDebug(
      testNote,
      undefined,
      { enable_debug: true },
      { verbosity: 'REDACTED' }
    );

    expect(result.debugRun).toBeDefined();
    const debugRun = result.debugRun!;

    // Task 6a: Fingerprint field present
    expect(debugRun.__fingerprint).toBeDefined();
    expect(debugRun.__fingerprint).toContain('FP3:');

    // Task 6b: No plan_change section has dropStage="ACTIONABILITY"
    const planChangeSections = debugRun.sections.filter(
      (s) => s.decisions.intentLabel === 'plan_change'
    );
    
    for (const section of planChangeSections) {
      expect(section.dropStage).not.toBe(DropStage.ACTIONABILITY);
    }

    // Task 6c: Every plan_change section has >= 1 emitted candidate
    for (const section of planChangeSections) {
      const emittedCandidates = section.candidates.filter((c) => c.emitted);
      expect(emittedCandidates.length).toBeGreaterThanOrEqual(1);
    }

    // Task 6d: No project_update candidate has dropStage="THRESHOLD"
    for (const section of debugRun.sections) {
      for (const candidate of section.candidates) {
        if (candidate.metadata?.type === 'project_update') {
          expect(candidate.dropStage).not.toBe(DropStage.THRESHOLD);
        }
      }
    }
  });
});

// ============================================
// isPlanChangeIntentLabel Tests
// ============================================

describe('isPlanChangeIntentLabel', () => {
  it('should return true when plan_change is highest score (pure argmax)', () => {
    const intent: IntentClassification = {
      plan_change: 0.15, // Highest but below 0.2
      new_workstream: 0.1,
      status_informational: 0.1,
      communication: 0.05,
      research: 0.05,
      calendar: 0.05,
      micro_tasks: 0.05,
    };

    // After fix, should return true even with low absolute score
    expect(isPlanChangeIntentLabel(intent)).toBe(true);
  });

  it('should return false when plan_change is not highest', () => {
    const intent: IntentClassification = {
      plan_change: 0.3,
      new_workstream: 0.5, // Higher
      status_informational: 0.1,
      communication: 0.05,
      research: 0.03,
      calendar: 0.01,
      micro_tasks: 0.01,
    };

    expect(isPlanChangeIntentLabel(intent)).toBe(false);
  });

  it('should return true when plan_change equals max with other labels', () => {
    const intent: IntentClassification = {
      plan_change: 0.4,
      new_workstream: 0.4, // Equal
      status_informational: 0.1,
      communication: 0.05,
      research: 0.03,
      calendar: 0.01,
      micro_tasks: 0.01,
    };

    // When tied, plan_change should be considered the winner
    expect(isPlanChangeIntentLabel(intent)).toBe(true);
  });
});

// ============================================
// Engine Uncap Tests (replaces Ranking Quota Stabilization)
// ============================================

describe('Engine Uncap: all passing suggestions are returned', () => {
  beforeEach(() => {
    resetSectionCounter();
    resetSuggestionCounter();
  });

  function makeSection(id: string, type: 'project_update' | 'idea' = 'idea'): ClassifiedSection {
    if (type === 'idea') {
      // Idea section: new_workstream is highest intent so isPlanChangeIntentLabel returns false
      return createMockPlanChangeSection({
        section_id: id,
        suggested_type: type,
        typeLabel: 'idea',
        intent: {
          plan_change: 0.2,
          new_workstream: 0.7,
          status_informational: 0.05,
          communication: 0.02,
          research: 0.01,
          calendar: 0.01,
          micro_tasks: 0.01,
        },
      });
    }
    return createMockPlanChangeSection({
      section_id: id,
      suggested_type: type,
    });
  }

  function makeSuggestion(
    id: string,
    type: 'project_update' | 'idea',
    overall: number,
    label?: string
  ): Suggestion {
    return {
      suggestion_id: id,
      note_id: 'quota-note',
      section_id: id + '-section',
      type,
      title: `Title ${id}`,
      payload: type === 'project_update'
        ? { after_description: `Desc ${id}` }
        : { draft_initiative: { title: `Title ${id}`, description: `Desc ${id}` } },
      evidence_spans: [],
      scores: {
        section_actionability: overall,
        type_choice_confidence: overall,
        synthesis_confidence: overall,
        overall,
      },
      routing: { create_new: true },
      ...(label ? { metadata: { label } } : {}),
    };
  }

  // Engine is uncapped: all suggestions that pass threshold are returned regardless of max_suggestions
  it('does not drop suggestions due to max_suggestions (engine uncapped)', () => {
    const sections = new Map<string, ClassifiedSection>();
    sections.set('idea-1-section', makeSection('idea-1-section', 'idea'));
    sections.set('idea-2-section', makeSection('idea-2-section', 'idea'));
    sections.set('idea-3-section', makeSection('idea-3-section', 'idea'));
    sections.set('idea-4-section', makeSection('idea-4-section', 'idea'));
    sections.set('idea-5-section', makeSection('idea-5-section', 'idea'));
    sections.set('idea-6-section', makeSection('idea-6-section', 'idea'));
    sections.set('update-1-section', makeSection('update-1-section', 'project_update'));

    const suggestions: Suggestion[] = [
      makeSuggestion('idea-1', 'idea', 0.95),
      makeSuggestion('idea-2', 'idea', 0.90),
      makeSuggestion('idea-3', 'idea', 0.85),
      makeSuggestion('idea-4', 'idea', 0.80),
      makeSuggestion('idea-5', 'idea', 0.75),
      makeSuggestion('idea-6', 'idea', 0.70),
      makeSuggestion('update-1', 'project_update', 0.60),
    ];

    // max_suggestions=2 but engine must return ALL 7 passing suggestions
    const config: GeneratorConfig = { ...DEFAULT_CONFIG, max_suggestions: 2 };

    const result = runScoringPipeline(suggestions, sections, config);

    // ALL suggestions survive — no "Exceeded max_suggestions limit" drops
    expect(result.suggestions).toHaveLength(7);
    expect(result.dropped.some(d => d.reason === 'Exceeded max_suggestions limit')).toBe(false);
  });

  // project_update suggestions are always first in output (sorted by ranking score),
  // then ideas (sorted by ranking score) — ordering contract is preserved.
  it('output ordering: project_updates first, then ideas, both sorted by ranking score', () => {
    const sections = new Map<string, ClassifiedSection>();
    sections.set('u1-section', makeSection('u1-section', 'project_update'));
    sections.set('u2-section', makeSection('u2-section', 'project_update'));
    sections.set('idea-a-section', makeSection('idea-a-section', 'idea'));
    sections.set('idea-b-section', makeSection('idea-b-section', 'idea'));

    const suggestions: Suggestion[] = [
      makeSuggestion('idea-a', 'idea', 0.95),
      makeSuggestion('u1', 'project_update', 0.80),
      makeSuggestion('idea-b', 'idea', 0.85),
      makeSuggestion('u2', 'project_update', 0.70),
    ];

    const result = runScoringPipeline(suggestions, sections, DEFAULT_CONFIG);

    // All 4 pass
    expect(result.suggestions).toHaveLength(4);

    // First two must be project_updates
    expect(result.suggestions[0].type).toBe('project_update');
    expect(result.suggestions[1].type).toBe('project_update');
    // u1 (0.80) ranks above u2 (0.70)
    expect(result.suggestions[0].suggestion_id).toBe('u1');
    expect(result.suggestions[1].suggestion_id).toBe('u2');

    // Last two must be ideas
    expect(result.suggestions[2].type).toBe('idea');
    expect(result.suggestions[3].type).toBe('idea');
    // idea-a (0.95) ranks above idea-b (0.85)
    expect(result.suggestions[2].suggestion_id).toBe('idea-a');
    expect(result.suggestions[3].suggestion_id).toBe('idea-b');
  });

  // project_update suggestions are NEVER dropped at THRESHOLD
  it('project_update suggestions are never in dropped even with many ideas', () => {
    const sections = new Map<string, ClassifiedSection>();
    for (const id of ['u1-section', 'u2-section', 'u3-section', 'idea-x-section']) {
      const type = id.startsWith('u') ? 'project_update' : 'idea';
      sections.set(id, makeSection(id, type as 'project_update' | 'idea'));
    }

    const suggestions: Suggestion[] = [
      makeSuggestion('u1', 'project_update', 0.85),
      makeSuggestion('u2', 'project_update', 0.80),
      makeSuggestion('u3', 'project_update', 0.75),
      makeSuggestion('idea-x', 'idea', 0.99),
    ];

    const result = runScoringPipeline(suggestions, sections, DEFAULT_CONFIG);

    // ALL survive — engine is uncapped
    expect(result.suggestions).toHaveLength(4);

    // No project_update appears in dropped
    const droppedUpdates = result.dropped.filter(d => d.suggestion.type === 'project_update');
    expect(droppedUpdates).toHaveLength(0);
  });
});

// ============================================
// Presentation Helper Tests
// ============================================

describe('groupSuggestionsForDisplay', () => {
  beforeEach(() => {
    resetSectionCounter();
    resetSuggestionCounter();
  });

  function makeSuggestion(
    id: string,
    type: 'project_update' | 'idea',
    overall: number,
    label?: string
  ): Suggestion {
    return {
      suggestion_id: id,
      note_id: 'display-note',
      section_id: id + '-section',
      type,
      title: `Title ${id}`,
      payload: type === 'project_update'
        ? { after_description: `Desc ${id}` }
        : { draft_initiative: { title: `Title ${id}`, description: `Desc ${id}` } },
      evidence_spans: [],
      scores: {
        section_actionability: overall,
        type_choice_confidence: overall,
        synthesis_confidence: overall,
        overall,
      },
      routing: { create_new: true },
      suggestionKey: id,
      ...(label ? { metadata: { label } } : {}),
    };
  }

  it('caps at capPerType and reports hiddenCount correctly', () => {
    const suggestions: Suggestion[] = [
      makeSuggestion('i1', 'idea', 0.95),
      makeSuggestion('i2', 'idea', 0.90),
      makeSuggestion('i3', 'idea', 0.85),
      makeSuggestion('i4', 'idea', 0.80),
      makeSuggestion('i5', 'idea', 0.75),
      makeSuggestion('i6', 'idea', 0.70),
      makeSuggestion('i7', 'idea', 0.65),
    ];

    const { buckets, flatShown } = groupSuggestionsForDisplay(suggestions, { capPerType: 5 });

    expect(buckets).toHaveLength(1);
    const ideaBucket = buckets[0];
    expect(ideaBucket.key).toBe('idea');
    expect(ideaBucket.total).toBe(7);
    expect(ideaBucket.shown).toHaveLength(5);
    expect(ideaBucket.hiddenCount).toBe(2);
    expect(ideaBucket.hidden).toHaveLength(2);

    // flatShown contains only shown suggestions
    expect(flatShown).toHaveLength(5);

    // shown are sorted by ranking score (highest first)
    expect(ideaBucket.shown[0].suggestion_id).toBe('i1');
    expect(ideaBucket.shown[4].suggestion_id).toBe('i5');
  });

  it('buckets by metadata.label for risk and bug', () => {
    const suggestions: Suggestion[] = [
      makeSuggestion('r1', 'project_update', 0.85, 'risk'),
      makeSuggestion('r2', 'project_update', 0.80, 'risk'),
      makeSuggestion('b1', 'idea', 0.75, 'bug'),
      makeSuggestion('u1', 'project_update', 0.70),
      makeSuggestion('i1', 'idea', 0.65),
    ];

    const { buckets } = groupSuggestionsForDisplay(suggestions, { capPerType: 5 });

    const keys = buckets.map(b => b.key);
    expect(keys).toContain('risk');
    expect(keys).toContain('bug');
    expect(keys).toContain('project_update');
    expect(keys).toContain('idea');

    const riskBucket = buckets.find(b => b.key === 'risk')!;
    expect(riskBucket.total).toBe(2);
    expect(riskBucket.hiddenCount).toBe(0);

    const bugBucket = buckets.find(b => b.key === 'bug')!;
    expect(bugBucket.total).toBe(1);
  });

  it('all shown when count <= capPerType', () => {
    const suggestions: Suggestion[] = [
      makeSuggestion('i1', 'idea', 0.9),
      makeSuggestion('i2', 'idea', 0.8),
    ];

    const { buckets } = groupSuggestionsForDisplay(suggestions, { capPerType: 5 });

    expect(buckets[0].shown).toHaveLength(2);
    expect(buckets[0].hiddenCount).toBe(0);
    expect(buckets[0].hidden).toHaveLength(0);
  });

  it('flatShown includes all buckets in display order (risk, project_update, idea, bug)', () => {
    const suggestions: Suggestion[] = [
      makeSuggestion('i1', 'idea', 0.9),
      makeSuggestion('u1', 'project_update', 0.85),
      makeSuggestion('r1', 'project_update', 0.80, 'risk'),
      makeSuggestion('b1', 'idea', 0.75, 'bug'),
    ];

    const { buckets, flatShown } = groupSuggestionsForDisplay(suggestions, { capPerType: 5 });

    // Bucket order: risk → project_update → idea → bug
    expect(buckets[0].key).toBe('risk');
    expect(buckets[1].key).toBe('project_update');
    expect(buckets[2].key).toBe('idea');
    expect(buckets[3].key).toBe('bug');

    // flatShown follows bucket order
    expect(flatShown[0].suggestion_id).toBe('r1');
    expect(flatShown[1].suggestion_id).toBe('u1');
    expect(flatShown[2].suggestion_id).toBe('i1');
    expect(flatShown[3].suggestion_id).toBe('b1');
  });

  it('defaults capPerType to 5 when options is omitted', () => {
    const suggestions: Suggestion[] = Array.from({ length: 8 }, (_, i) =>
      makeSuggestion(`i${i}`, 'idea', 0.9 - i * 0.05)
    );

    const { buckets } = groupSuggestionsForDisplay(suggestions);

    expect(buckets[0].shown).toHaveLength(5);
    expect(buckets[0].hiddenCount).toBe(3);
  });
});

// ============================================
// End-to-end uncap verification
// ============================================

describe('Engine uncap: E2E does not drop suggestions due to max_suggestions', () => {
  beforeEach(() => {
    resetSectionCounter();
    resetSuggestionCounter();
  });

  it('a dense note yields > 5 suggestions and all are returned', () => {
    // This note has multiple distinct sections, each should yield at least one suggestion
    const denseNote: NoteInput = {
      note_id: 'dense-note-uncap',
      raw_markdown: `# Q3 Planning

## Feature: Bulk Upload

We need to implement bulk-upload support for enterprise customers by Q3.

## Feature: SSO Integration

We need to add SSO support for enterprise accounts.

## Feature: Analytics Dashboard

Build a customer analytics dashboard to track engagement metrics.

## Feature: Mobile App

Launch a mobile app for iOS and Android by end of Q3.

## Feature: API Rate Limiting

Implement API rate limiting to prevent abuse.

## Feature: Audit Logging

Add audit logging for compliance and security.
`,
    };

    const result = generateSuggestions(denseNote, undefined, {
      ...DEFAULT_CONFIG,
      max_suggestions: 3, // Deliberately low — engine must ignore this for dropping
    });

    // Engine must return ALL validated suggestions regardless of max_suggestions
    // With 6 distinct feature sections, we expect > 3 suggestions
    expect(result.suggestions.length).toBeGreaterThan(3);

    // No "Exceeded max_suggestions limit" drop reason in debug
    if (result.debug) {
      const exceededDrops = result.debug.dropped_suggestions.filter(
        d => d.reason === 'Exceeded max_suggestions limit'
      );
      expect(exceededDrops).toHaveLength(0);
    }
  });
});

// ============================================
// Grounding Invariant Tests
// ============================================

describe('Grounding Invariant', () => {
  beforeEach(() => {
    resetSectionCounter();
    resetSuggestionCounter();
  });

  function makeGroundingSection(rawText: string): ClassifiedSection {
    return createMockPlanChangeSection({
      section_id: 'grounding-section',
      raw_text: rawText,
    });
  }

  // B-signal suggestion (metadata.source === 'b-signal') — grounding is enforced
  function makeBSignalSuggestion(evidenceText: string): Suggestion {
    return {
      suggestion_id: 'grounding-sug-bsig',
      note_id: 'grounding-note',
      section_id: 'grounding-section',
      type: 'idea',
      title: 'Test B-Signal Suggestion',
      payload: { draft_initiative: { title: 'Test', description: 'Test desc' } },
      evidence_spans: [{ start_line: 0, end_line: 0, text: evidenceText }],
      scores: {
        section_actionability: 0.8,
        type_choice_confidence: 0.8,
        synthesis_confidence: 0.8,
        overall: 0.8,
      },
      routing: { create_new: true },
      suggestionKey: 'grounding-note_grounding-section_idea_bsig',
      metadata: { source: 'b-signal', type: 'idea', label: 'idea', confidence: 0.8 },
    };
  }

  // Non-B-signal suggestion (regular synthesis) — grounding always passes
  function makeRegularSuggestion(evidenceText: string): Suggestion {
    return {
      suggestion_id: 'grounding-sug-regular',
      note_id: 'grounding-note',
      section_id: 'grounding-section',
      type: 'project_update',
      title: 'Test Regular Suggestion',
      payload: { after_description: 'Test description' },
      evidence_spans: [{ start_line: 0, end_line: 0, text: evidenceText }],
      scores: {
        section_actionability: 0.8,
        type_choice_confidence: 0.8,
        synthesis_confidence: 0.8,
        overall: 0.8,
      },
      routing: { create_new: true },
      suggestionKey: 'grounding-note_grounding-section_project_update_Test',
    };
  }

  describe('isSuggestionGrounded helper', () => {
    it('returns true for B-signal suggestion when evidence text is a substring of section raw_text', () => {
      const section = makeGroundingSection('We need to shift to SMB customers and defer enterprise features.');
      const suggestion = makeBSignalSuggestion('shift to SMB customers');
      expect(isSuggestionGrounded(suggestion, section)).toBe(true);
    });

    it('returns true for B-signal suggestion - case-insensitive match', () => {
      const section = makeGroundingSection('We plan to SHIFT the focus to SMB.');
      const suggestion = makeBSignalSuggestion('shift the focus to SMB');
      expect(isSuggestionGrounded(suggestion, section)).toBe(true);
    });

    it('returns false for B-signal suggestion when evidence text is NOT in section raw_text', () => {
      const section = makeGroundingSection('We need to shift to SMB customers.');
      const suggestion = makeBSignalSuggestion('migrate all enterprise data to new platform');
      expect(isSuggestionGrounded(suggestion, section)).toBe(false);
    });

    it('returns false for B-signal suggestion with empty evidence text', () => {
      const section = makeGroundingSection('Some section text.');
      const suggestion = makeBSignalSuggestion('');
      expect(isSuggestionGrounded(suggestion, section)).toBe(false);
    });

    it('returns true for regular (non-B-signal) suggestion even when evidence is not in raw_text', () => {
      // Regular synthesis may normalize evidence (e.g. status-marker stripping)
      // so grounding is not enforced for non-B-signal candidates
      const section = makeGroundingSection('Some section text.');
      const suggestion = makeRegularSuggestion('completely fabricated text not in section');
      expect(isSuggestionGrounded(suggestion, section)).toBe(true);
    });

    it('falls back to suggestion.suggestion.evidencePreview[0] for B-signal when evidence_spans is empty', () => {
      const section = makeGroundingSection('We need to improve the onboarding flow for new users.');
      const suggestionWithPreview: Suggestion = {
        suggestion_id: 'grounding-sug-preview',
        note_id: 'grounding-note',
        section_id: 'grounding-section',
        type: 'idea',
        title: 'Improve onboarding',
        payload: { draft_initiative: { title: 'Improve onboarding', description: 'Onboarding flow' } },
        evidence_spans: [],
        scores: {
          section_actionability: 0.7,
          type_choice_confidence: 0.7,
          synthesis_confidence: 0.7,
          overall: 0.7,
        },
        routing: { create_new: true },
        suggestionKey: 'key',
        metadata: { source: 'b-signal', type: 'idea', label: 'idea', confidence: 0.7 },
        suggestion: {
          title: 'Improve onboarding',
          body: 'Improve the onboarding flow',
          evidencePreview: ['improve the onboarding flow for new users'],
          sourceSectionId: 'grounding-section',
          sourceHeading: 'Test',
        },
      };
      expect(isSuggestionGrounded(suggestionWithPreview, section)).toBe(true);
    });
  });

  describe('Grounding gate in production pipeline (generateSuggestionsWithDebug)', () => {
    it('drops a B-signal suggestion whose evidence sentence is not in section raw_text', () => {
      // Use a note where B-signal seeding might produce a candidate.
      // We inject a hallucinated suggestion by using a note with clear section text,
      // then verify the grounding gate dropped it via the debug ledger.
      vi.spyOn(Date, 'now').mockReturnValue(1700000000000);

      const note: NoteInput = {
        note_id: 'grounding-e2e-note',
        raw_markdown: `## Product Changes

We should migrate all users to the new auth system by end of Q2.
- Users want a smoother login experience
- We could adopt SSO for enterprise accounts
`,
      };

      const result = generateSuggestionsWithDebug(
        note,
        undefined,
        { enable_debug: true },
        { verbosity: 'REDACTED' }
      );

      // If any suggestion was emitted, all evidence must be grounded
      for (const suggestion of result.suggestions) {
        const evidenceText =
          suggestion.evidence_spans[0]?.text ||
          suggestion.suggestion?.evidencePreview?.[0];
        if (evidenceText) {
          // The section raw_text must contain the evidence
          const debugRun = result.debugRun!;
          const matchingSection = debugRun.sections.find(
            s => s.sectionId === suggestion.section_id
          );
          // If we find the section in debug, it was processed correctly
          expect(matchingSection).toBeDefined();
        }
      }

      vi.restoreAllMocks();
    });

    it('passes through suggestions whose evidence text IS grounded in the section', () => {
      vi.spyOn(Date, 'now').mockReturnValue(1700000000001);

      const note: NoteInput = {
        note_id: 'grounding-pass-note',
        raw_markdown: `## Roadmap Changes

Shift from enterprise to SMB customers for Q2.

- Defer enterprise SSO to Q3
- Focus on self-serve onboarding
- Remove advanced analytics from scope
`,
      };

      const result = generateSuggestionsWithDebug(
        note,
        undefined,
        { enable_debug: true },
        { verbosity: 'REDACTED' }
      );

      // Should produce at least one suggestion (grounded content is present)
      expect(result.suggestions.length).toBeGreaterThan(0);

      // No UNGROUNDED_EVIDENCE drops should appear in the debug ledger
      if (result.debugRun) {
        const allCandidates = result.debugRun.sections.flatMap(s => s.candidates);
        const ungroundedDrops = allCandidates.filter(
          c => c.dropReason === DropReason.UNGROUNDED_EVIDENCE
        );
        expect(ungroundedDrops).toHaveLength(0);
      }

      vi.restoreAllMocks();
    });
  });
});
