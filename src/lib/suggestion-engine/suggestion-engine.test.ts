/**
 * Suggestion Engine Unit Tests
 * 
 * Run with: npm test
 */

import { describe, it, expect } from 'vitest';
import {
  generateSuggestions,
  Note,
  Initiative,
  validateSuggestion,
  isValidSuggestion,
} from './index';
import { isOutOfScope } from './signals';
import { extractTimeline, extractPriority, extractOwner } from './classification';
import { segmentNote, mapSegmentToInitiatives } from './preprocessing';

// ============================================
// Test Fixtures
// ============================================

const mockInitiatives: Initiative[] = [
  {
    id: 'init-001',
    title: 'User Onboarding Revamp',
    status: 'active',
    owner_name: 'Alice',
    priority: 'HIGH',
  },
  {
    id: 'init-002',
    title: 'Infrastructure Migration',
    status: 'active',
    owner_name: 'Bob',
    priority: 'MEDIUM',
  },
];

// ============================================
// Out-of-Scope Detection Tests
// ============================================

describe('Out-of-Scope Detection', () => {
  it('filters communication tasks', () => {
    expect(isOutOfScope('Send the meeting summary to the team').outOfScope).toBe(true);
    expect(isOutOfScope('Email everyone about the update').outOfScope).toBe(true);
    expect(isOutOfScope('Share notes with stakeholders').outOfScope).toBe(true);
  });

  it('filters calendar/scheduling tasks', () => {
    expect(isOutOfScope('Schedule a meeting for next week').outOfScope).toBe(true);
    expect(isOutOfScope('Book a room for the review').outOfScope).toBe(true);
    expect(isOutOfScope('Set up a recurring sync').outOfScope).toBe(true);
  });

  it('filters generic follow-ups', () => {
    expect(isOutOfScope('Remember to follow up').outOfScope).toBe(true);
    expect(isOutOfScope('Touch base next week').outOfScope).toBe(true);
    expect(isOutOfScope('Keep in mind for later').outOfScope).toBe(true);
  });

  it('does not filter plan-relevant content', () => {
    expect(isOutOfScope('Push the deadline to Q2').outOfScope).toBe(false);
    expect(isOutOfScope('Alice will own the new project').outOfScope).toBe(false);
    expect(isOutOfScope('Create a new initiative for API versioning').outOfScope).toBe(false);
  });
});

// ============================================
// Extraction Tests
// ============================================

describe('Timeline Extraction', () => {
  it('extracts quarter references', () => {
    const result = extractTimeline('Push to Q2 2026');
    expect(result).not.toBeNull();
    expect(result?.description).toContain('Q2');
  });

  it('extracts relative week references', () => {
    const result = extractTimeline('Deliver next week');
    expect(result).not.toBeNull();
  });

  it('extracts month references', () => {
    const result = extractTimeline('Target is March 2026');
    expect(result).not.toBeNull();
    expect(result?.description?.toLowerCase()).toContain('march');
  });

  it('returns null for no timeline', () => {
    const result = extractTimeline('No timeline mentioned here');
    expect(result).toBeNull();
  });
});

describe('Priority Extraction', () => {
  it('extracts critical priority', () => {
    expect(extractPriority('This is now P0')).toBe('CRITICAL');
    expect(extractPriority('Top priority project')).toBe('CRITICAL');
    expect(extractPriority('This is urgent')).toBe('CRITICAL');
  });

  it('extracts high priority', () => {
    expect(extractPriority('This is P1')).toBe('HIGH');
    expect(extractPriority('High priority item')).toBe('HIGH');
  });

  it('extracts low priority', () => {
    expect(extractPriority('Move to backlog')).toBe('LOW');
    expect(extractPriority('Put on the back burner')).toBe('LOW');
  });

  it('returns null for no priority', () => {
    expect(extractPriority('Regular task')).toBeNull();
  });
});

describe('Owner Extraction', () => {
  it('extracts owner from "will own" pattern', () => {
    const result = extractOwner('Alice will own this project');
    expect(result).not.toBeNull();
    expect(result?.name).toBe('Alice');
  });

  it('extracts owner from "owned by" pattern', () => {
    const result = extractOwner('This is owned by Bob');
    expect(result).not.toBeNull();
    expect(result?.name).toBe('Bob');
  });

  it('extracts owner from handoff pattern', () => {
    const result = extractOwner('Handoff to Charlie');
    expect(result).not.toBeNull();
    expect(result?.name).toBe('Charlie');
  });

  it('returns null when no owner mentioned', () => {
    const result = extractOwner('No specific owner mentioned');
    expect(result).toBeNull();
  });
});

// ============================================
// Preprocessing Tests
// ============================================

describe('Note Segmentation', () => {
  it('segments bullet points', () => {
    const note: Note = {
      id: 'test-1',
      raw_text: `
        - First item
        - Second item
        - Third item
      `,
      created_at: Date.now(),
    };
    const segments = segmentNote(note);
    expect(segments.length).toBeGreaterThanOrEqual(3);
  });

  it('segments sentences', () => {
    const note: Note = {
      id: 'test-2',
      raw_text: 'First sentence. Second sentence. Third sentence.',
      created_at: Date.now(),
    };
    const segments = segmentNote(note);
    expect(segments.length).toBeGreaterThanOrEqual(2);
  });
});

describe('Initiative Mapping', () => {
  it('maps segment to initiative by title mention', () => {
    const segment = {
      id: 'seg-1',
      text: 'Update the User Onboarding Revamp timeline',
      normalized_text: 'update the user onboarding revamp timeline',
      index: 0,
    };
    const mappedIds = mapSegmentToInitiatives(segment, mockInitiatives);
    expect(mappedIds).toContain('init-001');
  });

  it('returns empty for no match', () => {
    const segment = {
      id: 'seg-2',
      text: 'Some unrelated content',
      normalized_text: 'some unrelated content',
      index: 0,
    };
    const mappedIds = mapSegmentToInitiatives(segment, mockInitiatives);
    expect(mappedIds.length).toBe(0);
  });
});

// ============================================
// Generator Tests - Zero Suggestion Scenarios
// ============================================

describe('Generator - Zero Suggestion Scenarios', () => {
  it('returns empty for status updates only', () => {
    const note: Note = {
      id: 'test-status',
      raw_text: 'Alice gave an update on progress. Everything is on track. No blockers.',
      created_at: Date.now(),
    };
    const result = generateSuggestions(note, mockInitiatives);
    expect(result.suggestions).toHaveLength(0);
  });

  it('returns empty for communication tasks', () => {
    const note: Note = {
      id: 'test-comm',
      raw_text: `
        - Send summary to the team
        - Email stakeholders
        - Share notes with everyone
      `,
      created_at: Date.now(),
    };
    const result = generateSuggestions(note, mockInitiatives);
    expect(result.suggestions).toHaveLength(0);
  });

  it('returns empty for scheduling tasks', () => {
    const note: Note = {
      id: 'test-sched',
      raw_text: 'Schedule a follow-up meeting. Book a room for next week.',
      created_at: Date.now(),
    };
    const result = generateSuggestions(note, mockInitiatives);
    expect(result.suggestions).toHaveLength(0);
  });

  it('returns empty for vague ideas', () => {
    const note: Note = {
      id: 'test-vague',
      raw_text: 'We should think about maybe doing something with the docs someday.',
      created_at: Date.now(),
    };
    const result = generateSuggestions(note, mockInitiatives);
    expect(result.suggestions).toHaveLength(0);
  });
});

// ============================================
// Generator Tests - Mutation Scenarios
// ============================================

describe('Generator - Mutation Scenarios', () => {
  it('generates timeline mutation', () => {
    const note: Note = {
      id: 'test-timeline',
      raw_text: 'We decided to push the User Onboarding Revamp deadline to Q2 2026 due to resource constraints.',
      created_at: Date.now(),
    };
    const result = generateSuggestions(note, mockInitiatives, undefined, { 
      enable_debug: true,
      confidence_threshold: 0.5, // Lower threshold for testing
    });
    
    
    // Should generate a suggestion
    expect(result.suggestions.length).toBeGreaterThan(0);
    
    // Should be a plan mutation
    const mutation = result.suggestions.find(s => s.type === 'PLAN_MUTATION');
    expect(mutation).toBeDefined();
  });

  it('generates priority mutation', () => {
    const note: Note = {
      id: 'test-priority',
      raw_text: 'The User Onboarding Revamp is now top priority. We need to ship ASAP.',
      created_at: Date.now(),
    };
    const result = generateSuggestions(note, mockInitiatives, undefined, {
      confidence_threshold: 0.5,
    });
    
    const mutation = result.suggestions.find(
      s => s.type === 'PLAN_MUTATION' && 
      (s as any).mutation.change_type === 'PRIORITY'
    );
    expect(mutation).toBeDefined();
  });
});

// ============================================
// Generator Tests - Artifact Scenarios
// ============================================

describe('Generator - Artifact Scenarios', () => {
  it('generates new initiative artifact', () => {
    const note: Note = {
      id: 'test-new-init',
      raw_text: 'We decided to create a new initiative for API versioning. Sarah will own this project. Goal is to deliver v2 API by end of Q2.',
      created_at: Date.now(),
    };
    const result = generateSuggestions(note, mockInitiatives, undefined, {
      enable_debug: true,
      confidence_threshold: 0.5, // Lower threshold for testing
    });
    
    
    const artifact = result.suggestions.find(s => s.type === 'EXECUTION_ARTIFACT');
    expect(artifact).toBeDefined();
    if (artifact && artifact.type === 'EXECUTION_ARTIFACT') {
      expect(artifact.artifact.artifact_kind).toBe('NEW_INITIATIVE');
    }
  });

  it('does not generate artifact for forbidden titles', () => {
    const note: Note = {
      id: 'test-forbidden',
      raw_text: 'Create an initiative called Next Steps to track follow-ups.',
      created_at: Date.now(),
    };
    const result = generateSuggestions(note, mockInitiatives);
    
    // Should not generate because "Next Steps" is a forbidden title
    const artifact = result.suggestions.find(
      s => s.type === 'EXECUTION_ARTIFACT' &&
      (s as any).artifact.title.toLowerCase().includes('next steps')
    );
    expect(artifact).toBeUndefined();
  });
});

// ============================================
// Validation Tests
// ============================================

describe('Suggestion Validation', () => {
  it('validates a complete plan mutation', () => {
    const suggestion = {
      id: 'test-sug-1',
      type: 'PLAN_MUTATION' as const,
      source_note_id: 'note-1',
      confidence: 0.8,
      evidence_segment_ids: ['seg-1'],
      mutation: {
        target_initiative_id: 'init-001',
        change_type: 'TIMELINE' as const,
        before: { timeline: { description: 'Q1' } },
        after: { timeline: { description: 'Q2' } },
      },
      rationale: 'Timeline change detected',
    };
    
    const result = validateSuggestion(suggestion, mockInitiatives);
    expect(result.valid).toBe(true);
  });

  it('rejects mutation with non-existent initiative', () => {
    const suggestion = {
      id: 'test-sug-2',
      type: 'PLAN_MUTATION' as const,
      source_note_id: 'note-1',
      confidence: 0.8,
      evidence_segment_ids: ['seg-1'],
      mutation: {
        target_initiative_id: 'non-existent',
        change_type: 'TIMELINE' as const,
        before: { timeline: { description: 'Q1' } },
        after: { timeline: { description: 'Q2' } },
      },
      rationale: 'Timeline change detected',
    };
    
    const result = validateSuggestion(suggestion, mockInitiatives);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('does not exist'))).toBe(true);
  });

  it('rejects mutation with identical before/after', () => {
    const suggestion = {
      id: 'test-sug-3',
      type: 'PLAN_MUTATION' as const,
      source_note_id: 'note-1',
      confidence: 0.8,
      evidence_segment_ids: ['seg-1'],
      mutation: {
        target_initiative_id: 'init-001',
        change_type: 'TIMELINE' as const,
        before: { timeline: { description: 'Q1' } },
        after: { timeline: { description: 'Q1' } }, // Same as before
      },
      rationale: 'Timeline change detected',
    };
    
    const result = validateSuggestion(suggestion, mockInitiatives);
    expect(result.valid).toBe(false);
  });
});

// ============================================
// Configuration Tests
// ============================================

describe('Generator Configuration', () => {
  it('respects max_suggestions cap', () => {
    const note: Note = {
      id: 'test-cap',
      raw_text: `
        Decisions:
        - Push User Onboarding to Q2
        - Infrastructure Migration is now P0
        - Create new initiative for monitoring
        - Create new initiative for security
        - Create new initiative for performance
      `,
      created_at: Date.now(),
    };
    
    const result = generateSuggestions(note, mockInitiatives, undefined, {
      max_suggestions: 2,
    });
    
    expect(result.suggestions.length).toBeLessThanOrEqual(2);
  });

  it('respects confidence threshold', () => {
    const note: Note = {
      id: 'test-threshold',
      raw_text: 'Maybe push the User Onboarding Revamp to Q2.',
      created_at: Date.now(),
    };
    
    // Very high threshold should filter out low-confidence suggestions
    const result = generateSuggestions(note, mockInitiatives, undefined, {
      confidence_threshold: 0.99,
    });
    
    // All suggestions should meet the threshold
    for (const s of result.suggestions) {
      expect(s.confidence).toBeGreaterThanOrEqual(0.99);
    }
  });

  it('can disable specific mutation types', () => {
    const note: Note = {
      id: 'test-disable',
      raw_text: 'Push the User Onboarding Revamp to Q2 2026.',
      created_at: Date.now(),
    };
    
    const result = generateSuggestions(note, mockInitiatives, undefined, {
      enable_timeline_mutations: false,
    });
    
    const timelineMutation = result.suggestions.find(
      s => s.type === 'PLAN_MUTATION' && 
      (s as any).mutation.change_type === 'TIMELINE'
    );
    expect(timelineMutation).toBeUndefined();
  });
});
