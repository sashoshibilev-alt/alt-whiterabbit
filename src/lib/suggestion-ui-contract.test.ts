/**
 * UI Contract Test: Suggestion Payload Shape
 *
 * Locks the payload structure that the UI receives from getWithComputedSuggestions.
 * This test prevents regressions where engine/debug shows context but UI payload doesn't.
 *
 * Required fields for each suggestion:
 * - suggestion.title (non-empty string)
 * - suggestion.body (non-empty string, plain text)
 * - suggestion.evidencePreview (array, may be empty)
 * - suggestion.sourceSectionId (non-empty string)
 * - suggestion.sourceHeading (non-empty string)
 * - type (one of: idea | project_update)
 */

import { describe, it, expect } from 'vitest';
import { generateSuggestions, adaptConvexNote, type NoteInput } from './suggestion-engine-v2';

// Fixed note input designed to produce both idea and project_update suggestions
const FIXED_NOTE_INPUT: NoteInput = {
  note_id: 'ui-contract-test-note',
  raw_markdown: `# Product Strategy Session

## New Initiative: Customer Portal

Build a self-service customer portal to reduce support load by 50%.

Objective: Enable customers to manage their accounts, view usage, and access documentation without contacting support.

Scope:
- Account management (billing, users, settings)
- Usage dashboard with key metrics
- Integrated documentation and help center
- Self-service password reset and 2FA

Target: Launch beta by end of Q2, full release in Q3.

## Roadmap Adjustment

We need to push the mobile app redesign from Q2 to Q3 because the gesture system is more complex than anticipated and requires additional UX research.

- Defer all mobile redesign work to Q3
- Prioritize customer portal in Q2 instead
- Add 2 weeks for UX research on gesture patterns
- Target mobile beta for mid-Q3

This shift allows us to address the more urgent support cost issue while giving the design team proper time for the mobile experience.
`,
};

describe('UI Contract: Suggestion Payload Shape', () => {
  it('should return suggestions with complete suggestion context for UI consumption', () => {
    // This test simulates the exact logic in convex/notes.ts getWithComputedSuggestions action

    // Step 1: Adapt note (as done in getWithComputedSuggestions)
    const convexNote = {
      _id: 'test-note-id' as any,
      body: FIXED_NOTE_INPUT.raw_markdown,
      createdAt: Date.now(),
      title: 'Product Strategy Session',
    };

    const engineNote = adaptConvexNote(convexNote);

    // Step 2: Generate suggestions using v2 engine (as done in getWithComputedSuggestions)
    const result = generateSuggestions(engineNote);

    // Step 3: Transform to UI format (as done in getWithComputedSuggestions)
    const uiSuggestions = result.suggestions.map((engineSug) => ({
      _id: engineSug.suggestion_id as any,
      noteId: convexNote._id,
      content: engineSug.title,
      status: "new" as const,
      createdAt: Date.now(),
      modelVersion: "v2-engine",
      suggestionFamily: engineSug.type,
      modelConfidenceScore: engineSug.scores.overall,
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
    }));

    // Assertions: Verify we get at least 1 idea and 1 project_update
    expect(uiSuggestions.length).toBeGreaterThan(0);

    const ideas = uiSuggestions.filter(s => s.suggestionFamily === 'idea');
    const projectUpdates = uiSuggestions.filter(s => s.suggestionFamily === 'project_update');

    expect(ideas.length).toBeGreaterThanOrEqual(1);
    expect(projectUpdates.length).toBeGreaterThanOrEqual(1);
  });

  it('should include all required suggestion context fields for every emitted suggestion', () => {
    // Generate suggestions using the same fixed note
    const engineNote = adaptConvexNote({
      _id: 'test-note-id' as any,
      body: FIXED_NOTE_INPUT.raw_markdown,
      createdAt: Date.now(),
      title: 'Product Strategy Session',
    });

    const result = generateSuggestions(engineNote);

    // Map to UI format
    const uiSuggestions = result.suggestions.map((engineSug) => ({
      _id: engineSug.suggestion_id as any,
      noteId: 'test-note-id' as any,
      content: engineSug.title,
      status: "new" as const,
      createdAt: Date.now(),
      modelVersion: "v2-engine",
      suggestionFamily: engineSug.type,
      modelConfidenceScore: engineSug.scores.overall,
      suggestion: engineSug.suggestion ? {
        title: engineSug.suggestion.title,
        body: engineSug.suggestion.body,
        evidencePreview: engineSug.suggestion.evidencePreview,
        sourceSectionId: engineSug.suggestion.sourceSectionId,
        sourceHeading: engineSug.suggestion.sourceHeading,
      } : undefined,
    }));

    // Contract assertions: Every suggestion MUST have these fields
    for (const suggestion of uiSuggestions) {
      // Suggestion object must exist
      expect(suggestion.suggestion).toBeDefined();
      expect(suggestion.suggestion).not.toBeNull();

      // Title must be non-empty string
      expect(suggestion.suggestion!.title).toBeDefined();
      expect(typeof suggestion.suggestion!.title).toBe('string');
      expect(suggestion.suggestion!.title.length).toBeGreaterThan(0);

      // Body must be non-empty string (plain text)
      expect(suggestion.suggestion!.body).toBeDefined();
      expect(typeof suggestion.suggestion!.body).toBe('string');
      expect(suggestion.suggestion!.body.length).toBeGreaterThan(0);

      // Evidence preview must be an array (may be empty)
      expect(suggestion.suggestion!.evidencePreview).toBeDefined();
      expect(Array.isArray(suggestion.suggestion!.evidencePreview)).toBe(true);

      // Source section ID must be non-empty string
      expect(suggestion.suggestion!.sourceSectionId).toBeDefined();
      expect(typeof suggestion.suggestion!.sourceSectionId).toBe('string');
      expect(suggestion.suggestion!.sourceSectionId.length).toBeGreaterThan(0);

      // Source heading must be non-empty string
      expect(suggestion.suggestion!.sourceHeading).toBeDefined();
      expect(typeof suggestion.suggestion!.sourceHeading).toBe('string');
      expect(suggestion.suggestion!.sourceHeading.length).toBeGreaterThan(0);

      // Type must be one of the allowed values
      expect(['idea', 'project_update']).toContain(suggestion.suggestionFamily);
    }
  });

  it('should handle idea suggestions (type === idea)', () => {
    const engineNote = adaptConvexNote({
      _id: 'test-note-id' as any,
      body: FIXED_NOTE_INPUT.raw_markdown,
      createdAt: Date.now(),
      title: 'Product Strategy Session',
    });

    const result = generateSuggestions(engineNote);

    const ideas = result.suggestions.filter(s => s.type === 'idea');

    expect(ideas.length).toBeGreaterThanOrEqual(1);

    for (const idea of ideas) {
      // Ideas should have type=idea
      expect(idea.type).toBe('idea');

      // All required fields should be present
      expect(idea.suggestion).toBeDefined();
      expect(idea.suggestion!.title).toBeDefined();
      expect(idea.suggestion!.body).toBeDefined();
      expect(idea.suggestion!.evidencePreview).toBeDefined();
      expect(idea.suggestion!.sourceSectionId).toBeDefined();
      expect(idea.suggestion!.sourceHeading).toBeDefined();
    }
  });

  it('should handle project_update suggestions (intentLabel === plan_change)', () => {
    const engineNote = adaptConvexNote({
      _id: 'test-note-id' as any,
      body: FIXED_NOTE_INPUT.raw_markdown,
      createdAt: Date.now(),
      title: 'Product Strategy Session',
    });

    const result = generateSuggestions(engineNote);

    // Project updates are suggestions where type=project_update (which maps to intentLabel=plan_change in the engine)
    const projectUpdates = result.suggestions.filter(s => s.type === 'project_update');

    expect(projectUpdates.length).toBeGreaterThanOrEqual(1);

    for (const update of projectUpdates) {
      // Project updates (type=project_update) correspond to intentLabel=plan_change in engine
      expect(update.type).toBe('project_update');

      // All required fields should be present
      expect(update.suggestion).toBeDefined();
      expect(update.suggestion!.title).toBeDefined();
      expect(update.suggestion!.body).toBeDefined();
      expect(update.suggestion!.evidencePreview).toBeDefined();
      expect(update.suggestion!.sourceSectionId).toBeDefined();
      expect(update.suggestion!.sourceHeading).toBeDefined();
    }
  });
});
