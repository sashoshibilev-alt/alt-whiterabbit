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

// ============================================
// Tests for extended strategy heading keywords
// (prioritization, automation, playbook, vision)
// ============================================

describe('isStrategyHeadingSection — extended keyword coverage', () => {
  it('returns true for heading containing "Prioritization"', () => {
    const heading = 'Black Box Prioritization System';
    const sectionText = 'Black Box Prioritization System Score claims Use algorithm Automate triage Reduce manual work';
    expect(isStrategyHeadingSection(heading, sectionText, 4)).toBe(true);
  });

  it('returns true for heading containing "Automation"', () => {
    const heading = 'Data Collection Automation';
    const sectionText = 'Data Collection Automation Parse field data Integrate with sensors Generate reports Normalize input';
    expect(isStrategyHeadingSection(heading, sectionText, 4)).toBe(true);
  });

  it('returns true for heading containing "Playbook"', () => {
    const heading = 'Customer Success Playbook';
    const sectionText = 'Customer Success Playbook Identify at-risk accounts Escalate early Provide dedicated support Review monthly';
    expect(isStrategyHeadingSection(heading, sectionText, 4)).toBe(true);
  });

  it('returns true for heading containing "Vision"', () => {
    const heading = 'Product Vision';
    const sectionText = 'Product Vision Move toward self-serve model Reduce sales dependency Enable global scale Automate onboarding';
    expect(isStrategyHeadingSection(heading, sectionText, 4)).toBe(true);
  });

  it('returns false for prioritization heading when concrete delta exists', () => {
    const heading = 'Claims Prioritization System';
    const sectionText = 'Claims Prioritization System Delay by 4 weeks due to vendor issues Score claims Automate triage';
    expect(isStrategyHeadingSection(heading, sectionText, 3)).toBe(false);
  });
});

describe('computeTypeLabel — extended keywords emit idea not project_update', () => {
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

  function makePlanChangeIntent() {
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

  it('Strategy heading + bullets + imperatives + no delta => idea', () => {
    // Imperatives like "Create", "Present", "Show" must NOT prevent idea emission
    const section = makeSection(
      'Agatha Gamification Strategy',
      'Create a points system that rewards key user actions\nPresent weekly leaderboards to drive engagement\nAlways show earning potential on every screen',
      3
    );
    const intent = makePlanChangeIntent();
    expect(computeTypeLabel(section, intent)).toBe('idea');
  });

  it('Strategy heading + bullets + imperatives + concrete date change => project_update', () => {
    const section = makeSection(
      'Agatha Gamification Strategy',
      'Create a points system\nPresent weekly leaderboards\nRollout moved from January to February due to QA blockers',
      3
    );
    const intent = makePlanChangeIntent();
    expect(computeTypeLabel(section, intent)).toBe('project_update');
  });

  it('Prioritization heading + 3+ bullets + no delta => idea', () => {
    const section = makeSection(
      'Black Box Prioritization System',
      'Score each claim automatically\nRank by severity and impact\nFilter out duplicates\nNotify agents of top-priority items',
      4
    );
    const intent = makePlanChangeIntent();
    expect(computeTypeLabel(section, intent)).toBe('idea');
  });

  it('Automation heading + 3+ bullets + no delta => idea', () => {
    const section = makeSection(
      'Data Collection Automation',
      'Parse incoming field data\nIntegrate with IoT sensors\nNormalize data formats\nGenerate daily reports',
      4
    );
    const intent = makePlanChangeIntent();
    expect(computeTypeLabel(section, intent)).toBe('idea');
  });

  it('num_list_items field is present and used as list-density gate', () => {
    // Verify the canonical field name is num_list_items (not bullet_count or bulletCount)
    const section = makeSection('Engagement Strategy', 'Focus on daily users\nReduce friction\nImprove notifications', 3);
    expect(section.structural_features.num_list_items).toBe(3);
    // With 3+ items and no delta, result should be idea
    const intent = makePlanChangeIntent();
    expect(computeTypeLabel(section, intent)).toBe('idea');
  });

  it('num_list_items < 3 does NOT trigger strategy heading override (falls through)', () => {
    // With only 2 bullets, isStrategyHeadingSection returns false regardless of heading.
    // "system" alone in body is not enough for isSpecOrFrameworkSection (needs 2+ tokens).
    const section = makeSection(
      'Agatha Gamification Strategy',
      'Create a points system\nPresent leaderboards',
      2
    );
    const intent = makePlanChangeIntent();
    // Falls through — isStrategyOnlySection is true but heading guard fails => project_update
    expect(computeTypeLabel(section, intent)).toBe('project_update');
  });
});

// ============================================
// classifySection: suggested_type must agree with typeLabel for strategy sections
// (regression guard: fixes plan_change override forcing strategy sections to project_update
//  even when computeTypeLabel correctly returns 'idea')
// ============================================

describe('classifySection — suggested_type consistent with typeLabel for strategy headings', () => {
  beforeEach(() => {
    resetSectionCounter();
    resetSuggestionCounter();
  });

  function makeStrategySection(headingText: string, bullets: string[]): Section {
    return {
      section_id: 'strategy-test',
      note_id: 'test-note',
      heading_text: headingText,
      heading_level: 3,
      start_line: 0,
      end_line: bullets.length + 1,
      body_lines: bullets.map((text, i) => ({
        index: i + 1,
        text,
        line_type: 'list_item' as const,
        indent_level: 0,
      })),
      structural_features: {
        num_lines: bullets.length + 1,
        num_list_items: bullets.length,
        has_dates: false,
        has_metrics: false,
        has_quarter_refs: false,
        has_version_refs: false,
        has_launch_keywords: false,
        initiative_phrase_density: 0,
      },
      raw_text: bullets.join('\n'),
    };
  }

  it('Agatha Gamification Strategy: suggested_type is idea (not project_update)', () => {
    const section = makeStrategySection('Agatha Gamification Strategy', [
      'Move away from showing total farm data burden',
      'Focus on immediate reward',
      'Show earnings potential',
      'Show recent activity',
    ]);
    const result = classifySection(section, DEFAULT_THRESHOLDS);
    expect(result.typeLabel).toBe('idea');
    expect(result.suggested_type).toBe('idea');
    expect(result.suggested_type).not.toBe('project_update');
  });

  it('Black Box Prioritization System: suggested_type is idea (not project_update)', () => {
    // Numbered list — same logic must apply
    const section = makeStrategySection('Black Box Prioritization System', [
      'From current 1-year to 5-year assessment',
      'Build score-based ranking system',
      'Automate the prioritization process',
      'Integrate with existing workflow',
    ]);
    const result = classifySection(section, DEFAULT_THRESHOLDS);
    expect(result.typeLabel).toBe('idea');
    expect(result.suggested_type).toBe('idea');
    expect(result.suggested_type).not.toBe('project_update');
  });

  it('Control: strategy heading + concrete delta keeps project_update', () => {
    const section = makeStrategySection('Agatha Gamification Strategy', [
      'Rollout pushed from Jan 12 to Jan 19 due to QA blockers',
      'Focus on immediate reward',
      'Show earnings potential',
    ]);
    const result = classifySection(section, DEFAULT_THRESHOLDS);
    // Concrete delta ("from Jan 12 to Jan 19") wins — section remains project_update
    expect(result.typeLabel).toBe('project_update');
  });
});

// ============================================
// End-to-end: generateSuggestions with strategy sections + numbered lists
// ============================================

describe('generateSuggestions — strategy sections with numbered lists emit idea', () => {
  beforeEach(() => {
    resetSectionCounter();
    resetSuggestionCounter();
  });

  it('Agatha strategy heading + bullet list + no delta => idea (not project_update)', () => {
    const note: NoteInput = {
      note_id: 'agatha-strategy-bullets',
      raw_markdown: `# Product Notes

### Agatha Gamification Strategy

- Move away from showing total farm data burden
- Focus on immediate reward
- Show earnings potential
- Show recent activity
`,
    };
    const result = generateSuggestions(note, undefined, DEFAULT_CONFIG);
    const projectUpdates = result.suggestions.filter(
      (s) => s.type === 'project_update' &&
        [s.title, ...s.evidence_spans.map((e) => e.text)].join(' ').toLowerCase().match(/gamification|farm data|earnings|reward/)
    );
    expect(projectUpdates.length).toBe(0);
    const ideas = result.suggestions.filter((s) => s.type === 'idea');
    expect(ideas.length).toBeGreaterThanOrEqual(1);
  });

  it('Black Box Prioritization System + numbered list + no delta => idea (not project_update)', () => {
    const note: NoteInput = {
      note_id: 'blackbox-prioritization-numbered',
      raw_markdown: `# Product Notes

## Black Box Prioritization System

1. Build score-based ranking system
2. Automate the prioritization process
3. Integrate with existing workflow
4. Deploy to all teams
`,
    };
    const result = generateSuggestions(note, undefined, DEFAULT_CONFIG);
    const projectUpdates = result.suggestions.filter(
      (s) => s.type === 'project_update' &&
        [s.title, ...s.evidence_spans.map((e) => e.text)].join(' ').toLowerCase().match(/prioritization|black box|ranking/)
    );
    expect(projectUpdates.length).toBe(0);
    const ideas = result.suggestions.filter((s) => s.type === 'idea');
    expect(ideas.length).toBeGreaterThanOrEqual(1);
  });

  it('Control: strategy heading + concrete delta ("pushed from Jan 12 to Jan 19") => project_update', () => {
    const note: NoteInput = {
      note_id: 'agatha-strategy-with-delta',
      raw_markdown: `# Product Notes

### Agatha Gamification Strategy

The rollout has been pushed from Jan 12 to Jan 19 due to QA blockers.

- Focus on immediate reward
- Show earnings potential
- Show recent activity
`,
    };
    const result = generateSuggestions(note, undefined, DEFAULT_CONFIG);
    // Concrete delta present → must emit project_update
    const projectUpdates = result.suggestions.filter((s) => s.type === 'project_update');
    expect(projectUpdates.length).toBeGreaterThanOrEqual(1);
  });
});

// ============================================
// isStrategyHeadingSection — newly expanded keyword coverage
// (scoring, rubric, criteria, weighting, model, methodology,
//  decisioning, heuristics, prioritisation)
// ============================================

describe('isStrategyHeadingSection — expanded keyword coverage (scoring/rubric/criteria/etc.)', () => {
  it('returns true for heading containing "Scoring" (scorecard variant)', () => {
    const heading = 'Scoring Rubric for Field Prioritization';
    const sectionText = 'Scoring Rubric for Field Prioritization Weight urgency Score impact Apply recency factor Normalise across regions';
    expect(isStrategyHeadingSection(heading, sectionText, 4)).toBe(true);
  });

  it('returns true for heading containing "Rubric"', () => {
    const heading = 'Evaluation Rubric';
    const sectionText = 'Evaluation Rubric Assess technical feasibility Evaluate business value Consider risk Grade implementation complexity';
    expect(isStrategyHeadingSection(heading, sectionText, 4)).toBe(true);
  });

  it('returns true for heading containing "Criteria"', () => {
    const heading = 'Acceptance Criteria Framework';
    const sectionText = 'Acceptance Criteria Framework Define done conditions Require test coverage Mandate performance benchmarks Review with stakeholders';
    expect(isStrategyHeadingSection(heading, sectionText, 4)).toBe(true);
  });

  it('returns true for heading containing "Weighting"', () => {
    const heading = 'Weighting Methodology';
    const sectionText = 'Weighting Methodology Assign higher weight to revenue impact Discount operational complexity Factor in customer urgency Normalise final scores';
    expect(isStrategyHeadingSection(heading, sectionText, 4)).toBe(true);
  });

  it('returns true for heading containing "Methodology"', () => {
    const heading = 'Triage Methodology';
    const sectionText = 'Triage Methodology Identify severity class Apply standard impact formula Route to correct team Document decision rationale';
    expect(isStrategyHeadingSection(heading, sectionText, 4)).toBe(true);
  });

  it('returns true for heading containing "Decisioning"', () => {
    const heading = 'Claims Decisioning Heuristics';
    const sectionText = 'Claims Decisioning Heuristics Apply threshold-based routing Use confidence score for auto-approval Escalate low-confidence cases Log all decisions';
    expect(isStrategyHeadingSection(heading, sectionText, 4)).toBe(true);
  });

  it('returns true for heading containing "Heuristics"', () => {
    const heading = 'Prioritization Heuristics';
    const sectionText = 'Prioritization Heuristics Prefer quick wins over large bets Deprioritise items blocked on third parties Review daily against OKRs Apply tiebreaker rules';
    expect(isStrategyHeadingSection(heading, sectionText, 4)).toBe(true);
  });

  it('returns true for British spelling "prioritisation"', () => {
    const heading = 'Black Box Prioritisation System';
    const sectionText = 'Black Box Prioritisation System Score claims Use algorithm Automate triage Reduce manual work';
    expect(isStrategyHeadingSection(heading, sectionText, 4)).toBe(true);
  });

  it('returns false for expanded keyword heading when concrete delta exists', () => {
    const heading = 'Scoring Rubric for Field Prioritization';
    const sectionText = 'Scoring Rubric for Field Prioritization Delay by 4 weeks due to vendor issues Score impact Apply recency factor';
    expect(isStrategyHeadingSection(heading, sectionText, 3)).toBe(false);
  });
});

// ============================================
// computeTypeLabel — Black Box Prioritization System (primary + negative control)
// Spec-required tests: explicit typeLabel assertions
// ============================================

describe('computeTypeLabel — Black Box Prioritization System spec tests', () => {
  function makeSection(headingText: string, rawText: string, numListItems: number): Section {
    return {
      section_id: 'test',
      note_id: 'test-note',
      heading_text: headingText,
      heading_level: 2,
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

  function makePlanChangeIntent() {
    return {
      plan_change: 0.65,
      new_workstream: 0.15,
      status_informational: 0.1,
      communication: 0.05,
      research: 0.03,
      calendar: 0.01,
      micro_tasks: 0.01,
    };
  }

  it('Black Box Prioritization System + numbered list + no delta => typeLabel idea', () => {
    const section = makeSection(
      'Black Box Prioritization System',
      'Three-factor scoring for field prioritization\nScore each claim automatically\nRank by severity and impact\nFilter out duplicates\nNotify agents of top-priority items',
      5
    );
    const intent = makePlanChangeIntent();
    const result = computeTypeLabel(section, intent);
    expect(result).toBe('idea');
  });

  it('Negative control: Black Box Prioritization System + concrete delta => project_update', () => {
    const section = makeSection(
      'Black Box Prioritization System',
      'Three-factor scoring for field prioritization\nPushed from Jan 12 to Jan 19 due to QA blockers\nScore each claim automatically\nRank by severity and impact',
      4
    );
    const intent = makePlanChangeIntent();
    const result = computeTypeLabel(section, intent);
    expect(result).toBe('project_update');
  });
});

// ============================================
// classifySection — Black Box Prioritization System: suggested_type must be idea
// ============================================

describe('classifySection — Black Box Prioritization System emits idea candidate', () => {
  beforeEach(() => {
    resetSectionCounter();
    resetSuggestionCounter();
  });

  function makeStrategySection(headingText: string, bullets: string[]): Section {
    return {
      section_id: 'blackbox-test',
      note_id: 'test-note',
      heading_text: headingText,
      heading_level: 2,
      start_line: 0,
      end_line: bullets.length + 1,
      body_lines: bullets.map((text, i) => ({
        index: i + 1,
        text,
        line_type: 'list_item' as const,
        indent_level: 0,
      })),
      structural_features: {
        num_lines: bullets.length + 1,
        num_list_items: bullets.length,
        has_dates: false,
        has_metrics: false,
        has_quarter_refs: false,
        has_version_refs: false,
        has_launch_keywords: false,
        initiative_phrase_density: 0,
      },
      raw_text: bullets.join('\n'),
    };
  }

  it('Black Box Prioritization System: typeLabel=idea and suggested_type=idea', () => {
    // Use bullets with change-operator language and mechanism verbs so that:
    //   1. plan_change intent is detected (triggers the type-arbitration path)
    //   2. hasInitiativeQualitySignal returns true (mechanism verbs: build, automate, integrate)
    //   3. isStrategyOnlySection returns true (no concrete delta or schedule event)
    // → computeTypeLabel returns 'idea', and the strategy-only early-return sets suggested_type = 'idea'
    const section = makeStrategySection('Black Box Prioritization System', [
      'Move from manual triage to automated scoring system',
      'Build score-based ranking system for field prioritization',
      'Automate the prioritization process to reduce manual work',
      'Integrate with existing claims workflow',
    ]);
    const result = classifySection(section, DEFAULT_THRESHOLDS);
    expect(result.typeLabel).toBe('idea');
    expect(result.suggested_type).toBe('idea');
    expect(result.suggested_type).not.toBe('project_update');
  });

  it('Negative control: same heading + concrete delta ("pushed from Jan 12 to Jan 19") => project_update', () => {
    const section = makeStrategySection('Black Box Prioritization System', [
      'Pushed from Jan 12 to Jan 19 due to QA blockers',
      'Score each claim automatically',
      'Rank by severity and impact',
      'Filter out duplicates',
    ]);
    const result = classifySection(section, DEFAULT_THRESHOLDS);
    expect(result.typeLabel).toBe('project_update');
  });
});
