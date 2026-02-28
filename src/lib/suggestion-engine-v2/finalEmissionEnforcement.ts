/**
 * Final-emission enforcement
 *
 * Applied after the full pipeline to guarantee invariants regardless of
 * whether earlier stages (synthesis, consolidation, scoring, title contract)
 * correctly preserved the overrides.
 *
 * Shared between generateRunResult (index.ts) and generateSuggestionsWithDebug (debugGenerator.ts).
 */

import type { Suggestion, ClassifiedSection } from './types';
import { normalizeTitlePrefix } from './title-normalization';
import { computeSuggestionKey } from '../suggestion-keys';
import {
  AUTOMATION_HEADING_RE,
  SPEC_FRAMEWORK_TOKENS,
  computeGamificationClusterTitle,
  buildAutomationMultiBulletBody,
  isSpecOrFrameworkSection,
  isGamificationSection,
  isTimelineSection,
  shouldSuppressProjectUpdate,
} from './sectionSignals';

/**
 * Apply final-emission enforcement rules to the suggestion list.
 * Mutates nothing; returns a new array.
 *
 * Rules:
 * 1) Spec/framework suppression: remove project_update from spec/framework sections
 * 2) Gamification cluster override: enforce cluster title + multi-bullet body
 * 3) Automation multi-bullet enrichment
 * 4) Spec/framework multi-bullet enrichment
 * 5) Timeline section consolidation (collapse or synthesize project_update)
 */
export function applyFinalEmissionEnforcement(
  suggestions: Suggestion[],
  sectionMap: Map<string, ClassifiedSection>,
  noteId: string,
): Suggestion[] {
  let finalSuggestions = [...suggestions];

  // Helper to resolve section for a suggestion (handles __topic_ subsections)
  const resolveSection = (sectionId: string): ClassifiedSection | undefined =>
    sectionMap.get(sectionId) ||
    (sectionId.includes('__topic_')
      ? sectionMap.get(sectionId.split('__topic_')[0])
      : undefined);

  // Helper to extract list items from a section
  const extractItems = (sec: ClassifiedSection): string[] =>
    sec.body_lines
      .filter(l => l.line_type === 'list_item')
      .map(l => l.text.replace(/^[\s\-*+]+/, '').replace(/^\d+\.\s*/, '').trim())
      .filter(t => t.length > 0);

  // ── Rule 1: Spec/framework suppression ──
  const sectionsWithIdea = new Set<string>();
  for (const s of finalSuggestions) {
    if (s.type === 'idea') sectionsWithIdea.add(s.section_id);
  }

  finalSuggestions = finalSuggestions.filter(s => {
    if (s.type === 'project_update') {
      const sec = resolveSection(s.section_id);
      if (sec) {
        const heading = sec.heading_text || '';
        const numBullets = sec.structural_features?.num_list_items ?? 0;
        if (shouldSuppressProjectUpdate(sec.raw_text, numBullets, heading, sectionsWithIdea.has(s.section_id))) {
          return false;
        }
      }
    }
    return true;
  });

  // ── Rules 2-4: Enrichment (gamification, automation, spec multi-bullet) ──
  for (let i = 0; i < finalSuggestions.length; i++) {
    const s = finalSuggestions[i];
    const sec = resolveSection(s.section_id);
    if (!sec) continue;

    const heading = sec.heading_text?.trim() ?? '';
    const allItems = extractItems(sec);

    // 2) Gamification cluster override
    const bulletJoined = allItems.join(' ').toLowerCase();
    if (isGamificationSection(allItems) && s.type === 'idea') {
      const clusterTitle = computeGamificationClusterTitle(heading, bulletJoined);
      const prefixed = normalizeTitlePrefix('idea', clusterTitle);
      const kept = allItems.slice(0, 4);
      const clusterBody = kept.join('. ').replace(/\.+/g, '.').replace(/\.\s*$/, '') + '.';

      finalSuggestions[i] = {
        ...s,
        title: prefixed,
        suggestion: s.suggestion
          ? { ...s.suggestion, title: prefixed, body: clusterBody }
          : s.suggestion,
        payload: {
          ...s.payload,
          draft_initiative: s.payload.draft_initiative
            ? { ...s.payload.draft_initiative, title: clusterTitle, description: clusterBody }
            : s.payload.draft_initiative,
        },
      };
      continue;
    }

    // 3) Automation multi-bullet enrichment
    if (s.type === 'idea' && AUTOMATION_HEADING_RE.test(heading) && allItems.length >= 2) {
      const multiBullet = buildAutomationMultiBulletBody(allItems);
      finalSuggestions[i] = {
        ...s,
        suggestion: s.suggestion
          ? { ...s.suggestion, body: multiBullet }
          : s.suggestion,
        payload: {
          ...s.payload,
          draft_initiative: s.payload.draft_initiative
            ? { ...s.payload.draft_initiative, description: multiBullet }
            : s.payload.draft_initiative,
        },
      };
      continue;
    }

    // 4) Spec/framework multi-bullet enrichment
    if (s.type === 'idea' && SPEC_FRAMEWORK_TOKENS.test(heading) && allItems.length >= 3) {
      const multiBullet = allItems.map(b => `- ${b}`).join('\n');
      finalSuggestions[i] = {
        ...s,
        suggestion: s.suggestion
          ? { ...s.suggestion, body: multiBullet }
          : s.suggestion,
        payload: {
          ...s.payload,
          draft_initiative: s.payload.draft_initiative
            ? { ...s.payload.draft_initiative, description: multiBullet }
            : s.payload.draft_initiative,
        },
      };
    }
  }

  // ── Rule 5: Timeline section consolidation ──
  const timelineSectionIds = new Set<string>();
  for (const [secId, sec] of sectionMap) {
    const h = sec.heading_text?.trim() ?? '';
    if (isTimelineSection(h)) {
      timelineSectionIds.add(secId);
    }
  }

  if (timelineSectionIds.size > 0) {
    const nonTimeline: Suggestion[] = [];
    const bySectionTimeline = new Map<string, Suggestion[]>();
    for (const s of finalSuggestions) {
      if (timelineSectionIds.has(s.section_id)) {
        const group = bySectionTimeline.get(s.section_id);
        if (group) group.push(s);
        else bySectionTimeline.set(s.section_id, [s]);
      } else {
        nonTimeline.push(s);
      }
    }

    const buildTimelineUpdate = (
      secId: string,
      sec: ClassifiedSection,
      base?: Suggestion,
    ): Suggestion | null => {
      const heading = sec.heading_text?.trim() ?? '';
      const allItems = extractItems(sec);
      if (allItems.length === 0) return null;
      const multiBullet = allItems.map(b => `- ${b}`).join('\n');
      const title = normalizeTitlePrefix('project_update', heading);
      const suggestionKey = computeSuggestionKey({ noteId, sourceSectionId: secId, type: 'project_update', title });

      if (base) {
        return {
          ...base,
          type: 'project_update' as const,
          title,
          suggestionKey,
          suggestion: base.suggestion
            ? { ...base.suggestion, title, body: multiBullet, sourceHeading: heading }
            : { title, body: multiBullet, evidencePreview: allItems, sourceSectionId: secId, sourceHeading: heading },
          payload: {
            ...base.payload,
            draft_initiative: base.payload.draft_initiative
              ? { ...base.payload.draft_initiative, title: heading, description: multiBullet }
              : base.payload.draft_initiative,
          },
        };
      }

      // Synthetic suggestion when no candidates survived
      return {
        suggestion_id: `sug_timeline_${noteId.slice(0, 8)}_${secId.slice(-2)}`,
        note_id: noteId,
        section_id: secId,
        type: 'project_update' as const,
        title,
        suggestionKey,
        payload: { draft_initiative: { title: heading, description: multiBullet } },
        evidence_spans: allItems.slice(0, 3).map((t, i) => ({ text: `- ${t}`, offset: i, length: t.length })),
        scores: { section_actionability: 0.7, type_choice_confidence: 0.8, synthesis_confidence: 0.7, overall: 0.7 },
        routing: { create_new: true },
        suggestion: { title, body: multiBullet, evidencePreview: allItems, sourceSectionId: secId, sourceHeading: heading },
      };
    };

    // Consolidate existing timeline suggestions
    for (const [secId, group] of bySectionTimeline) {
      const sec = sectionMap.get(secId);
      if (!sec) { nonTimeline.push(...group); continue; }
      const base = group.find(s => s.type === 'project_update') ?? group[0];
      const update = buildTimelineUpdate(secId, sec, base);
      if (update) nonTimeline.push(update);
      else nonTimeline.push(...group);
    }

    // Create synthetic project_update for timeline sections with no surviving suggestions
    for (const secId of timelineSectionIds) {
      if (bySectionTimeline.has(secId)) continue;
      const sec = sectionMap.get(secId);
      if (!sec) continue;
      const update = buildTimelineUpdate(secId, sec);
      if (update) nonTimeline.push(update);
    }

    finalSuggestions = nonTimeline;
  }

  return finalSuggestions;
}
