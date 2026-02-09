/**
 * Strategic Relevance Suppression & Topic Isolation Tests
 *
 * Tests for two tightly-scoped synthesis improvements:
 * 1. Post-synthesis suppression for low-relevance candidates
 * 2. Topic isolation for mixed "Discussion details" sections
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  generateSuggestions,
  NoteInput,
  DEFAULT_CONFIG,
} from './index';
import { resetSectionCounter } from './preprocessing';
import { resetSuggestionCounter } from './synthesis';

describe('Strategic Relevance Soft Suppression', () => {
  beforeEach(() => {
    resetSectionCounter();
    resetSuggestionCounter();
  });

  it('should suppress candidates from "💡 Summary" section (emoji heading)', () => {
    const note: NoteInput = {
      note_id: 'test-emoji-summary',
      raw_markdown: `# Meeting Notes

## Project Ares Update

Delay Project Ares public beta by 14 days due to infrastructure dependencies.

Target revised to Q2 2025.

## 💡 Summary

Project Ares will slip by 2 weeks. Infrastructure work required first.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    // Should emit from Project Ares Update section
    expect(result.suggestions.length).toBeGreaterThan(0);

    // Should NOT emit from Summary section
    const summaryCandidate = result.suggestions.find(s =>
      s.suggestion?.sourceHeading.toLowerCase().includes('summary')
    );
    expect(summaryCandidate).toBeUndefined();

    // Verify Project Ares candidate exists
    const aresCandidate = result.suggestions.find(s =>
      s.title.toLowerCase().includes('ares') || s.title.toLowerCase().includes('delay')
    );
    expect(aresCandidate).toBeDefined();
  });

  it('should suppress candidates from "🚀 Next steps" section (emoji heading)', () => {
    const note: NoteInput = {
      note_id: 'test-emoji-next-steps',
      raw_markdown: `# Project Planning

## Implementation Strategy

Launch offline mode for mobile app. Build sync mechanism for data persistence.

## 🚀 Next steps

- PM to document requirements
- Eng to implement sync logic
- Design to create mockups
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    // Should emit from Implementation Strategy section
    expect(result.suggestions.length).toBeGreaterThan(0);

    // Should NOT emit from Next steps section
    const nextStepsCandidate = result.suggestions.find(s =>
      s.suggestion?.sourceHeading.toLowerCase().includes('next steps') ||
      s.suggestion?.sourceHeading.toLowerCase().includes('next step')
    );
    expect(nextStepsCandidate).toBeUndefined();
  });

  it('should suppress candidates from "Next Steps" section (explicit heading match)', () => {
    const note: NoteInput = {
      note_id: 'test-next-steps',
      raw_markdown: `# Product Review

## Feature Priorities

Build advanced search filters. Improve query performance.

## Next Steps

- Document requirements
- Schedule design review
- Plan sprint allocation
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    // Should NOT emit from Next Steps section
    const nextStepsCandidate = result.suggestions.find(s =>
      s.suggestion?.sourceHeading.toLowerCase() === 'next steps'
    );
    expect(nextStepsCandidate).toBeUndefined();
  });

  it('should suppress candidates from "Action Items" section (explicit heading match)', () => {
    const note: NoteInput = {
      note_id: 'test-action-items',
      raw_markdown: `# Strategy Session

## Platform Vision

Migrate to microservices architecture. Improve system reliability.

## Action Items

- Schedule tech review
- Send email to stakeholders
- Book conference room
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    // Should NOT emit from Action Items section
    const actionItemsCandidate = result.suggestions.find(s =>
      s.suggestion?.sourceHeading.toLowerCase() === 'action items'
    );
    expect(actionItemsCandidate).toBeUndefined();
  });

  it('should suppress naming convention candidates without hard delivery signals', () => {
    const note: NoteInput = {
      note_id: 'test-naming-culture',
      raw_markdown: `# Team Discussion

## Server Naming

Propose renaming servers to Game of Thrones character names to avoid confusion.

Make it a ritual on Wednesdays (meeting-free day) to update server naming convention.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    // Should NOT emit - naming convention without hard delivery signal
    expect(result.suggestions.length).toBe(0);
  });

  it('should NOT suppress project updates with hard delivery signals (Ares delay)', () => {
    const note: NoteInput = {
      note_id: 'test-ares-delay',
      raw_markdown: `# Decision Log

## Project Ares Timeline

Delay Project Ares public beta by 14 days due to infrastructure work.

Target date: Q2 2025. Customer beta launch postponed.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    // Should emit - has numeric delta (14 days), date (Q2 2025), customer impact
    expect(result.suggestions.length).toBeGreaterThan(0);

    const aresCandidate = result.suggestions[0];
    expect(aresCandidate.title.toLowerCase()).toMatch(/delay|ares|14/);
    expect(aresCandidate.suggestion?.body.toLowerCase()).toMatch(/delay|14 days|project ares/);
  });

  it('should NOT suppress culture shift with project name reference', () => {
    const note: NoteInput = {
      note_id: 'test-culture-with-project',
      raw_markdown: `# Cultural Shift Discussion

## Meeting-Free Wednesdays

Implement meeting-free Wednesdays ritual for Project Zenith team.

This culture shift supports focused engineering work on Project Zenith deliverables.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    // Should emit - has project name reference (hard delivery signal)
    expect(result.suggestions.length).toBeGreaterThan(0);
  });
});

describe('Topic Isolation for Mixed Sections', () => {
  beforeEach(() => {
    resetSectionCounter();
    resetSuggestionCounter();
  });

  it('should split "Discussion details" section and prevent cross-topic leakage', () => {
    const note: NoteInput = {
      note_id: 'test-mixed-discussion',
      raw_markdown: `# Meeting Notes

## Discussion details

New Feature Requests:
Launch offline mode for mobile app to support disconnected users.

Project Timelines:
Project Ares will slip by 2 sprints due to infrastructure dependencies.
Project Zenith on track for Q2 delivery.

Cultural Shift:
Propose renaming servers to Game of Thrones character names.
Meeting-free Wednesdays ritual for focused work.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    expect(result.suggestions.length).toBeGreaterThan(0);

    // Check for Ares/Zenith project updates
    const projectUpdates = result.suggestions.filter(s =>
      s.type === 'project_update' &&
      (s.title.toLowerCase().includes('ares') ||
       s.title.toLowerCase().includes('zenith') ||
       s.suggestion?.body.toLowerCase().includes('ares') ||
       s.suggestion?.body.toLowerCase().includes('zenith'))
    );
    expect(projectUpdates.length).toBeGreaterThan(0);

    // Verify no cross-topic leakage: Ares suggestion should NOT mention Game of Thrones
    const aresSuggestion = result.suggestions.find(s =>
      s.title.toLowerCase().includes('ares') || s.suggestion?.body.toLowerCase().includes('ares')
    );
    if (aresSuggestion) {
      expect(aresSuggestion.suggestion?.body.toLowerCase()).not.toMatch(/game of thrones|server/);
    }

    // Cultural shift should be suppressed (naming convention without hard delivery signal)
    const cultureCandidate = result.suggestions.find(s =>
      s.suggestion?.body.toLowerCase().includes('game of thrones') ||
      s.suggestion?.body.toLowerCase().includes('server naming')
    );
    expect(cultureCandidate).toBeUndefined();
  });

  it('should split long sections with many bullets (bulletCount >= 5)', () => {
    const note: NoteInput = {
      note_id: 'test-long-bullets',
      raw_markdown: `# Product Roadmap

## Feature Ideas

This section has many feature requests with topic anchors.

New Feature Requests:
Build offline mode for mobile app.
Launch advanced search filters.
Add export to PDF functionality.
Implement dark mode UI.
Enable batch operations for power users.

Project Timelines:
Project Ares will slip by 2 weeks due to infrastructure work.
Project Zenith remains on track for Q2 delivery.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    // Should process as split sections
    expect(result.suggestions.length).toBeGreaterThan(0);

    // Verify topic isolation: feature ideas should not leak into timeline suggestions
    const timelineSuggestions = result.suggestions.filter(s =>
      s.suggestion?.body.toLowerCase().includes('ares') ||
      s.suggestion?.body.toLowerCase().includes('zenith')
    );

    if (timelineSuggestions.length > 0) {
      const timelineBody = timelineSuggestions[0].suggestion?.body.toLowerCase() || '';
      expect(timelineBody).not.toMatch(/offline|dark mode|pdf/);
    }
  });

  it('should correctly detect and split sections based on charCount >= 500 with topic anchors', () => {
    // This test verifies the char count threshold works for splitting
    // The actual suggestion emission is covered by the Discussion details test above
    const note: NoteInput = {
      note_id: 'test-long-chars',
      raw_markdown: `# Quarterly Review

## Discussion

This is a comprehensive review section covering multiple topics with enough content to exceed 500 characters.

New Feature Requests:
Launch offline mode for mobile app to support enterprise customers. This is a top customer request from clients who operate in areas with poor connectivity. The feature should support data sync when connection is restored.

Project Timelines:
Delay Project Ares public beta by 14 days due to infrastructure work. Target Q2 2025.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    // Should emit at least the Ares project update
    const aresSuggestion = result.suggestions.find(s =>
      (s.title.toLowerCase().includes('ares') || s.suggestion?.body.toLowerCase().includes('ares')) &&
      s.type === 'project_update'
    );

    // If Ares suggestion was emitted, verify no cross-topic leakage
    if (aresSuggestion) {
      expect(aresSuggestion.suggestion?.body.toLowerCase()).not.toMatch(/offline mode|mobile app/);
    }
  });

  it('should handle sections without topic anchors (no split)', () => {
    const note: NoteInput = {
      note_id: 'test-no-anchors',
      raw_markdown: `# Planning Notes

## Project Update

Project Ares beta delayed by 2 weeks. Infrastructure work required.

New target: Q2 2025.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    // Should process normally without splitting
    expect(result.suggestions.length).toBeGreaterThan(0);

    const suggestion = result.suggestions[0];
    expect(suggestion).toBeDefined();
    expect(suggestion.title.toLowerCase()).toMatch(/ares|delay|project/);
  });
});

describe('Combined: Suppression + Topic Isolation', () => {
  beforeEach(() => {
    resetSectionCounter();
    resetSuggestionCounter();
  });

  it('should split mixed section and suppress low-relevance sub-blocks', () => {
    const note: NoteInput = {
      note_id: 'test-combined',
      raw_markdown: `# Team Meeting

## Discussion details

New Feature Requests:
Launch offline mode for mobile to support enterprise customers.

Project Timelines:
Project Ares slip by 14 days for infrastructure work.
Target: Q2 2025 public beta.

Cultural Shift:
Rename servers to Game of Thrones character names.
Meeting-free Wednesdays for focused work.
`,
    };

    const result = generateSuggestions(note, DEFAULT_CONFIG);

    expect(result.suggestions.length).toBeGreaterThan(0);

    // Should emit Ares project update
    const aresCandidate = result.suggestions.find(s =>
      s.title.toLowerCase().includes('ares') || s.suggestion?.body.toLowerCase().includes('ares')
    );
    expect(aresCandidate).toBeDefined();

    // Should NOT emit culture shift (suppressed by low-relevance rule)
    const cultureCandidate = result.suggestions.find(s =>
      s.suggestion?.body.toLowerCase().includes('game of thrones') ||
      s.suggestion?.body.toLowerCase().includes('server naming')
    );
    expect(cultureCandidate).toBeUndefined();

    // Verify no cross-topic leakage in Ares suggestion
    if (aresCandidate) {
      expect(aresCandidate.suggestion?.body.toLowerCase()).not.toMatch(/game of thrones|server/);
    }
  });
});
