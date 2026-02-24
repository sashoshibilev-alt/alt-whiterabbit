/**
 * TYPE ARBITRATION LAYER — project_update prevention for strategy sections
 *
 * Tests the delta requirement gate introduced for `project_update`:
 *
 *   A section may only be classified as project_update if it contains at
 *   least one concrete delta signal (date change, duration, launch/ETA ref).
 *
 *   Sections with a strategy heading (Strategy / System / Approach / Framework)
 *   AND >= 3 bullets AND no explicit timeline tokens are forced to 'idea'
 *   regardless of plan_change intent score.
 *
 * Required test coverage (from spec):
 *   1. Strategy section → emits idea
 *   2. "Launch moved from Jan to Feb" → emits project_update
 *   3. Mixed strategy + delta → project_update
 *   4. Strategy heading + no time tokens → idea
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  isStrategyHeadingSection,
  computeTypeLabel,
  classifySection,
  generateSuggestions,
  DEFAULT_CONFIG,
  DEFAULT_THRESHOLDS,
} from './index';
import type { NoteInput, Section } from './types';
import { resetSectionCounter } from './preprocessing';
import { resetSuggestionCounter } from './synthesis';

// ============================================
// Unit tests: isStrategyHeadingSection
// ============================================

describe('isStrategyHeadingSection — positive cases', () => {
  it('returns true for "Agatha Gamification Strategy" with 3+ bullets and no delta', () => {
    const heading = 'Agatha Gamification Strategy';
    const sectionText = 'Agatha Gamification Strategy Move away from showing total farm data burden Focus on immediate reward Show earnings potential Show recent activity';
    expect(isStrategyHeadingSection(heading, sectionText, 4)).toBe(true);
  });

  it('returns true for "Engagement Approach" with 3 bullets and no delta', () => {
    const heading = 'Engagement Approach';
    const sectionText = 'Engagement Approach Prioritize daily active users Reduce friction Improve notifications';
    expect(isStrategyHeadingSection(heading, sectionText, 3)).toBe(true);
  });

  it('returns true for "Technical Framework" with 3 bullets and no delta', () => {
    const heading = 'Technical Framework';
    const sectionText = 'Technical Framework Use microservices Adopt event-driven patterns Separate read and write models';
    expect(isStrategyHeadingSection(heading, sectionText, 3)).toBe(true);
  });

  it('returns true for "Content System" with 3 bullets and no delta', () => {
    const heading = 'Content System';
    const sectionText = 'Content System Automate content curation Use editorial calendar Personalize recommendations';
    expect(isStrategyHeadingSection(heading, sectionText, 3)).toBe(true);
  });
});

describe('isStrategyHeadingSection — negative cases', () => {
  it('returns false when heading has no strategy word', () => {
    const heading = 'Launch Status';
    const sectionText = 'Launch Status Move away from old rollout Focus on new channels';
    expect(isStrategyHeadingSection(heading, sectionText, 3)).toBe(false);
  });

  it('returns false when bullet count < 3', () => {
    const heading = 'Gamification Strategy';
    const sectionText = 'Gamification Strategy Focus on rewards';
    expect(isStrategyHeadingSection(heading, sectionText, 2)).toBe(false);
  });

  it('returns false when heading contains a timeline token ("Q3 Strategy")', () => {
    const heading = 'Q3 Strategy';
    const sectionText = 'Q3 Strategy Move resources Focus on growth Scale infrastructure';
    expect(isStrategyHeadingSection(heading, sectionText, 3)).toBe(false);
  });

  it('returns false when section has a concrete delta ("delay by 4 weeks")', () => {
    const heading = 'Delivery Approach';
    const sectionText = 'Delivery Approach Delay by 4 weeks due to vendor issues Move to next sprint Adjust milestones';
    expect(isStrategyHeadingSection(heading, sectionText, 3)).toBe(false);
  });

  it('returns false when section has a schedule event word ("launch")', () => {
    const heading = 'Launch Strategy';
    const sectionText = 'Launch Strategy Scheduled launch next month Deploy to staging first Roll out to 10% of users';
    // "launch" keyword triggers hasSectionScheduleEvent, so not strategy-only
    expect(isStrategyHeadingSection(heading, sectionText, 3)).toBe(false);
  });
});

// ============================================
// Unit tests: computeTypeLabel TYPE ARBITRATION
// ============================================

describe('computeTypeLabel — TYPE ARBITRATION for strategy sections', () => {
  function makeSection(headingText: string, rawText: string, numListItems: number): Section {
    return {
      section_id: 'test',
      note_id: 'test-note',
      heading_text: headingText,
      heading_level: 3,
      start_line: 0,
      end_line: numListItems + 1,
      body_lines: [],
      structural_features: {
        num_lines: numListItems + 1,
        num_list_items: numListItems,
        has_dates: false,
        has_metrics: false,
        has_quarter_refs: false,
        has_version_refs: false,
        has_launch_keywords: false,
        initiative_phrase_density: 0,
      },
      raw_text: rawText,
    };
  }

  function makeStrategyIntent() {
    // plan_change is dominant, no delta present
    return {
      plan_change: 0.6,
      new_workstream: 0.2,
      status_informational: 0.1,
      communication: 0.05,
      research: 0.03,
      calendar: 0.01,
      micro_tasks: 0.01,
    };
  }

  it('Test 1: Strategy section → emits idea (not project_update)', () => {
    // "Agatha Gamification Strategy" with 4 bullet points, no delta
    const section = makeSection(
      'Agatha Gamification Strategy',
      'Move away from showing total farm data burden\nFocus on immediate reward\nShow earnings potential\nShow recent activity',
      4
    );
    const intent = makeStrategyIntent();
    const result = computeTypeLabel(section, intent);
    expect(result).toBe('idea');
  });

  it('Test 4: Strategy heading + no time tokens → idea', () => {
    // Variant of Test 1 confirming the rule is heading-driven
    const section = makeSection(
      'Monetisation Approach',
      'Focus on recurring revenue\nReduce one-time fees\nIntroduce tiered pricing',
      3
    );
    const intent = makeStrategyIntent();
    const result = computeTypeLabel(section, intent);
    expect(result).toBe('idea');
  });

  it('Test 2: "Launch moved from Jan to Feb" → project_update', () => {
    // Concrete delta: "from January to February" must retain project_update
    const section = makeSection(
      'Launch Status',
      'Launch moved from January to February due to infra delays.',
      0
    );
    const intent = makeStrategyIntent();
    const result = computeTypeLabel(section, intent);
    expect(result).toBe('project_update');
  });

  it('Test 3: Mixed strategy heading + delta → project_update', () => {
    // Even with a strategy heading, a concrete delta wins → project_update
    const section = makeSection(
      'Delivery Approach',
      'Delay by 4 weeks due to vendor issues.\nMove to next sprint.\nAdjust milestones accordingly.',
      2
    );
    const intent = makeStrategyIntent();
    const result = computeTypeLabel(section, intent);
    expect(result).toBe('project_update');
  });

  it('Non-strategy heading with bullets is NOT forced to idea', () => {
    // A section like "Scope Changes" with bullets is an action plan → project_update
    const section = makeSection(
      'Scope Changes',
      'Defer enterprise SSO\nPrioritize self-serve onboarding\nRemove advanced analytics from scope',
      3
    );
    const intent = makeStrategyIntent();
    const result = computeTypeLabel(section, intent);
    // No strategy heading → falls through to project_update (strategy-only, but no heading match)
    expect(result).toBe('project_update');
  });
});

// ============================================
// Integration tests: classifySection and generateSuggestions
// ============================================

describe('classifySection — strategy sections get typeLabel idea', () => {
  beforeEach(() => {
    resetSectionCounter();
    resetSuggestionCounter();
  });

  it('Agatha Gamification Strategy section is classified as idea not project_update', () => {
    const section: Section = {
      section_id: 'agatha-gamification',
      note_id: 'test-note',
      heading_text: 'Agatha Gamification Strategy',
      heading_level: 3,
      start_line: 0,
      end_line: 4,
      body_lines: [
        { index: 1, text: 'Move away from showing total farm data burden', line_type: 'list_item', indent_level: 0 },
        { index: 2, text: 'Focus on immediate reward', line_type: 'list_item', indent_level: 0 },
        { index: 3, text: 'Show earnings potential', line_type: 'list_item', indent_level: 0 },
        { index: 4, text: 'Show recent activity', line_type: 'list_item', indent_level: 0 },
      ],
      structural_features: {
        num_lines: 4,
        num_list_items: 4,
        has_dates: false,
        has_metrics: false,
        has_quarter_refs: false,
        has_version_refs: false,
        has_launch_keywords: false,
        initiative_phrase_density: 0,
      },
      raw_text: 'Move away from showing total farm data burden\nFocus on immediate reward\nShow earnings potential\nShow recent activity',
    };

    const result = classifySection(section, DEFAULT_THRESHOLDS);
    // Must not be project_update — it is a strategy section
    expect(result.typeLabel).toBe('idea');
    expect(result.suggested_type).not.toBe('project_update');
  });
});

describe('generateSuggestions — full engine with strategy section', () => {
  beforeEach(() => {
    resetSectionCounter();
    resetSuggestionCounter();
  });

  it('Test 1 (end-to-end): Strategy section emits idea, not project_update', () => {
    const note: NoteInput = {
      note_id: 'gamification-strategy-note',
      raw_markdown: `# Product Planning

### Agatha Gamification Strategy

- Move away from showing total farm data burden
- Focus on immediate reward
- Show earnings potential
- Show recent activity
`,
    };
    const result = generateSuggestions(note, undefined, DEFAULT_CONFIG);

    // The strategy section must not produce a project_update suggestion
    const projectUpdates = result.suggestions.filter(s => s.type === 'project_update');
    const strategyUpdate = projectUpdates.find(s => {
      const allText = [s.title, ...s.evidence_spans.map(e => e.text)].join(' ').toLowerCase();
      return allText.includes('gamification') || allText.includes('farm data') || allText.includes('immediate reward');
    });
    expect(strategyUpdate).toBeUndefined();
  });

  it('Test 2 (end-to-end): "Launch moved from Jan to Feb" → emits project_update', () => {
    const note: NoteInput = {
      note_id: 'launch-moved-note',
      raw_markdown: `# Status Update

## Launch Status

The product launch moved from January to February due to infra delays.
`,
    };
    const result = generateSuggestions(note, undefined, DEFAULT_CONFIG);

    const projectUpdates = result.suggestions.filter(s => s.type === 'project_update');
    const launchUpdate = projectUpdates.find(s => {
      const allText = [s.title, ...s.evidence_spans.map(e => e.text)].join(' ').toLowerCase();
      return allText.includes('launch') || allText.includes('january') || allText.includes('february');
    });
    expect(launchUpdate).toBeDefined();
  });
});
