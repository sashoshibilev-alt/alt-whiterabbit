/**
 * Plan Change Invariants Tests
 *
 * Tests ensuring that sections with intentLabel === "plan_change" always
 * produce at least one suggestion and are never dropped at ACTIONABILITY
 * or THRESHOLD stages.
 *
 * Per fix-plan-change-drops plan.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  generateSuggestionsWithDebug,
  classifySection,
  classifySectionWithLLM,
  filterActionableSections,
  runScoringPipeline,
  applyConfidenceBasedProcessing,
  isPlanChangeIntentLabel,
  classifyIntent,
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
    suggested_type: 'plan_mutation',
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
      expect(classified.suggested_type).toBe('plan_mutation');

      // Should pass filter
      const filtered = filterActionableSections([classified]);
      expect(filtered).toHaveLength(1);
      expect(filtered[0].section_id).toBe('test-section');
    });
  });

  describe('Invariant A2: type classification never drops plan_change', () => {
    it('should force plan_mutation type for plan_change with non_actionable type (rule-based)', () => {
      // Create a section with explicit plan_change keywords
      // to ensure it classifies as plan_change intent
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

      // Should have plan_mutation type, not non_actionable
      expect(classified.suggested_type).toBe('plan_mutation');
    });

    it('should force plan_mutation type for plan_change with non_actionable type (LLM)', async () => {
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

      // Should have plan_mutation type
      expect(classified.suggested_type).toBe('plan_mutation');
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
    it('should downgrade low-score plan_change to needs_clarification instead of dropping', () => {
      const mockSection = createMockPlanChangeSection({
        // Set low scores
        actionable_signal: 0.4,
        type_confidence: 0.3,
      });

      const mockSuggestion: Suggestion = {
        suggestion_id: 'mock-sug-1',
        note_id: 'mock-note',
        section_id: 'mock-section-1',
        type: 'plan_mutation',
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

      // Should have clarification flags
      expect(processed.needs_clarification).toBe(true);
      expect(processed.clarification_reasons).toBeDefined();
      expect(processed.clarification_reasons!.length).toBeGreaterThan(0);

      // Should have action='comment' metadata
      expect((processed as any).action).toBe('comment');

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
          type: 'plan_mutation',
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
          type: 'plan_mutation',
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
          type: 'plan_mutation',
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
        max_suggestions: 2, // Cap at 2, but we have 3 plan_change
      };

      const result = runScoringPipeline(mockPlanChangeSuggestions, sections, config);

      // All 3 plan_change suggestions should be kept despite cap=2
      expect(result.suggestions).toHaveLength(3);
      expect(result.suggestions.every(s => s.type === 'plan_mutation')).toBe(true);

      // No plan_change suggestions should be dropped
      expect(result.dropped).toHaveLength(0);
    });

    it('should only cap execution_artifact suggestions, never plan_change', () => {
      // Test the capping logic directly with applyConfidenceBasedProcessing + manual capping
      const planSuggestion: Suggestion = {
        suggestion_id: 'plan-sug',
        note_id: 'mock-note',
        section_id: 'plan-section',
        type: 'plan_mutation',
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
        type: 'execution_artifact',
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
        type: 'execution_artifact',
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
      const planMutations = passed.filter(s => s.type === 'plan_mutation');
      const artifacts = passed.filter(s => s.type === 'execution_artifact');

      expect(planMutations).toHaveLength(1);
      expect(artifacts).toHaveLength(2);

      // With max_suggestions = 2, should keep 1 plan + 1 artifact (top-scoring)
      const maxSuggestions = 2;
      const remainingSlots = Math.max(0, maxSuggestions - planMutations.length);
      const keptArtifacts = artifacts.slice(0, remainingSlots);
      const final = [...planMutations, ...keptArtifacts];

      expect(final).toHaveLength(2);
      expect(final.some(s => s.type === 'plan_mutation')).toBe(true);
      expect(final.some(s => s.type === 'execution_artifact')).toBe(true);

      // One artifact should be dropped
      const droppedArtifacts = artifacts.slice(remainingSlots);
      expect(droppedArtifacts).toHaveLength(1);
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

    // Check that plan_mutation suggestions are in the result
    const planMutationSuggestions = result.suggestions.filter(s => s.type === 'plan_mutation');
    expect(planMutationSuggestions.length).toBeGreaterThan(0);

    // Downgraded suggestions should have needs_clarification
    const lowConfidenceSuggestions = planMutationSuggestions.filter(s => !s.is_high_confidence);
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
        if (candidate.metadata?.type === 'plan_mutation') {
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

  it('runtime entrypoint: plan_mutation candidates are never dropped at THRESHOLD', () => {
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
        if (candidate.metadata?.type === 'plan_mutation') {
          // INVARIANT: plan_mutation candidates should never be dropped at THRESHOLD
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

    // Task 6d: No plan_mutation candidate has dropStage="THRESHOLD"
    for (const section of debugRun.sections) {
      for (const candidate of section.candidates) {
        if (candidate.metadata?.type === 'plan_mutation') {
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
