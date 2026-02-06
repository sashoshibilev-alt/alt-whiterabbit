/**
 * Tests for suggestion key utilities
 */

import { describe, it, expect } from 'vitest';
import { normalizeTitle, computeSuggestionKey } from './suggestion-keys';

describe('normalizeTitle', () => {
  it('converts to lowercase', () => {
    expect(normalizeTitle('Build User Dashboard')).toBe('build user dashboard');
  });

  it('trims whitespace', () => {
    expect(normalizeTitle('  Build dashboard  ')).toBe('build dashboard');
  });

  it('collapses multiple whitespace to single space', () => {
    expect(normalizeTitle('Build   user    dashboard')).toBe('build user dashboard');
    expect(normalizeTitle('Build\t\nuser dashboard')).toBe('build user dashboard');
  });

  it('strips punctuation', () => {
    expect(normalizeTitle('Build user dashboard!')).toBe('build user dashboard');
    expect(normalizeTitle('User: dashboard (v2)')).toBe('user dashboard v2');
    expect(normalizeTitle('Q1 launch - MVP')).toBe('q1 launch mvp');
  });

  it('preserves alphanumeric characters', () => {
    expect(normalizeTitle('v2 API migration')).toBe('v2 api migration');
    expect(normalizeTitle('Q3 2024 goals')).toBe('q3 2024 goals');
  });

  it('handles empty string', () => {
    expect(normalizeTitle('')).toBe('');
  });

  it('handles only punctuation', () => {
    expect(normalizeTitle('!!!')).toBe('');
  });

  it('is deterministic for equivalent titles', () => {
    const title1 = 'Build User Dashboard!';
    const title2 = 'Build   user  dashboard';
    const title3 = 'build user dashboard.';

    expect(normalizeTitle(title1)).toBe(normalizeTitle(title2));
    expect(normalizeTitle(title2)).toBe(normalizeTitle(title3));
  });
});

describe('computeSuggestionKey', () => {
  it('creates stable key from components', () => {
    const key = computeSuggestionKey({
      noteId: 'note123',
      sourceSectionId: 'sec456',
      type: 'idea',
      title: 'Build user dashboard',
    });

    expect(key).toBe('note123:sec456:idea:build user dashboard');
  });

  it('normalizes title in key', () => {
    const key = computeSuggestionKey({
      noteId: 'note123',
      sourceSectionId: 'sec456',
      type: 'idea',
      title: 'Build User Dashboard!',
    });

    expect(key).toBe('note123:sec456:idea:build user dashboard');
  });

  it('distinguishes between types', () => {
    const ideaKey = computeSuggestionKey({
      noteId: 'note123',
      sourceSectionId: 'sec456',
      type: 'idea',
      title: 'Update timeline',
    });

    const updateKey = computeSuggestionKey({
      noteId: 'note123',
      sourceSectionId: 'sec456',
      type: 'project_update',
      title: 'Update timeline',
    });

    expect(ideaKey).not.toBe(updateKey);
  });

  it('distinguishes between sections', () => {
    const key1 = computeSuggestionKey({
      noteId: 'note123',
      sourceSectionId: 'sec456',
      type: 'idea',
      title: 'Build dashboard',
    });

    const key2 = computeSuggestionKey({
      noteId: 'note123',
      sourceSectionId: 'sec789',
      type: 'idea',
      title: 'Build dashboard',
    });

    expect(key1).not.toBe(key2);
  });

  it('distinguishes between notes', () => {
    const key1 = computeSuggestionKey({
      noteId: 'note123',
      sourceSectionId: 'sec456',
      type: 'idea',
      title: 'Build dashboard',
    });

    const key2 = computeSuggestionKey({
      noteId: 'note999',
      sourceSectionId: 'sec456',
      type: 'idea',
      title: 'Build dashboard',
    });

    expect(key1).not.toBe(key2);
  });

  it('produces same key for equivalent titles', () => {
    const key1 = computeSuggestionKey({
      noteId: 'note123',
      sourceSectionId: 'sec456',
      type: 'idea',
      title: 'Build User Dashboard!',
    });

    const key2 = computeSuggestionKey({
      noteId: 'note123',
      sourceSectionId: 'sec456',
      type: 'idea',
      title: 'Build   user  dashboard',
    });

    expect(key1).toBe(key2);
  });

  it('handles empty title', () => {
    const key = computeSuggestionKey({
      noteId: 'note123',
      sourceSectionId: 'sec456',
      type: 'idea',
      title: '',
    });

    expect(key).toBe('note123:sec456:idea:');
  });
});
