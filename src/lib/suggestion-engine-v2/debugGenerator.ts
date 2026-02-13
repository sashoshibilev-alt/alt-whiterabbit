/**
 * Suggestion Debug Report - Instrumented Generator
 *
 * This module wraps the suggestion generator with debug instrumentation
 * to produce comprehensive DebugRun reports.
 */

import type {
  NoteInput,
  GeneratorContext,
  GeneratorConfig,
  GeneratorResult,
  Suggestion,
  ClassifiedSection,
} from "./types";
import { DEFAULT_CONFIG } from "./types";
import type { DebugRun, DebugVerbosity } from "./debugTypes";
import { DropReason, DropStage } from "./debugTypes";
import {
  DebugLedger,
  createDebugLedger,
  sectionToDebug,
} from "./DebugLedger";
import { preprocessNote, resetSectionCounter } from "./preprocessing";
import { classifySections, filterActionableSections, isPlanChangeIntentLabel } from "./classifiers";
import {
  synthesizeSuggestions,
  resetSuggestionCounter,
  checkSectionSuppression,
  shouldSplitByTopic,
  splitSectionByTopic,
  containsExplicitRequest,
  extractExplicitAsk,
  generateTitleFromExplicitAsk,
  hasExtractableTopicAnchors,
} from "./synthesis";
import { runQualityValidators } from "./validators";
import { runScoringPipeline } from "./scoring";
import { routeSuggestions } from "./routing";

// ============================================
// Debug Generator Options
// ============================================

export interface DebugGeneratorOptions {
  verbosity?: DebugVerbosity;
  userId?: string;
}

export interface DebugGeneratorResult extends GeneratorResult {
  debugRun?: DebugRun;
}

// ============================================
// Instrumented Generator
// ============================================

/**
 * Generate suggestions with debug instrumentation.
 *
 * This is the main entry point for the debug pipeline. It wraps the
 * standard suggestion generation with comprehensive instrumentation.
 */
export function generateSuggestionsWithDebug(
  note: NoteInput,
  context?: GeneratorContext,
  config?: Partial<GeneratorConfig>,
  debugOptions?: DebugGeneratorOptions
): DebugGeneratorResult {
  // Reset counters for deterministic IDs
  resetSectionCounter();
  resetSuggestionCounter();

  // Merge config with defaults
  const finalConfig: GeneratorConfig = {
    ...DEFAULT_CONFIG,
    ...config,
    thresholds: {
      ...DEFAULT_CONFIG.thresholds,
      ...config?.thresholds,
    },
  };

  // Resolve verbosity
  const verbosity = debugOptions?.verbosity || "OFF";

  // Create debug ledger (returns null if OFF)
  const ledger = createDebugLedger({
    noteId: note.note_id,
    noteBody: note.raw_markdown,
    verbosity,
    config: finalConfig,
    userId: debugOptions?.userId,
  });

  const startTime = Date.now();

  try {
    // ============================================
    // Stage 1: Preprocessing
    // ============================================
    const segmentStart = Date.now();
    const { lines, sections } = preprocessNote(note);
    
    if (ledger) {
      ledger.recordStageTiming(DropStage.SEGMENTATION, Date.now() - segmentStart);
    }

    // Create section debug records
    if (ledger) {
      for (const section of sections) {
        sectionToDebug(ledger, section);
      }
    }

    if (sections.length === 0) {
      return buildResult([], ledger, finalConfig.enable_debug);
    }

    // ============================================
    // Stage 2: Classification
    // ============================================
    const classifyStart = Date.now();
    const classifiedSections = classifySections(sections, finalConfig.thresholds);
    
    // Record classification results
    if (ledger) {
      for (const classified of classifiedSections) {
        const sectionDebug = ledger.getSection(classified.section_id);
        if (sectionDebug) {
          // Include actionability signals for debug instrumentation
          const actionabilitySignals = (classified.actionable_signal !== undefined && classified.out_of_scope_signal !== undefined)
            ? {
                actionableSignal: classified.actionable_signal,
                outOfScopeSignal: classified.out_of_scope_signal,
              }
            : undefined;

          ledger.afterIntentClassification(
            sectionDebug,
            classified.intent,
            classified.is_actionable,
            classified.actionability_reason,
            actionabilitySignals
          );

          if (classified.suggested_type) {
            ledger.afterTypeClassification(
              sectionDebug,
              classified.suggested_type,
              classified.type_confidence || 0
            );
          }
        }
      }
      ledger.recordStageTiming(DropStage.ACTIONABILITY, Date.now() - classifyStart);
    }

    // Filter actionable sections
    const actionableSections = filterActionableSections(classifiedSections);

    // Mark non-actionable sections as dropped
    // PLAN_CHANGE PROTECTION: Never drop plan_change sections at ACTIONABILITY
    // Also heal debug ledger state to match the protection logic
    if (ledger) {
      for (const classified of classifiedSections) {
        const sectionDebug = ledger.getSection(classified.section_id);
        const isPlanChange = isPlanChangeIntentLabel(classified.intent);

        if (!sectionDebug) continue;

        if (isPlanChange && !classified.is_actionable) {
          // Heal debug decisions so JSON reflects the override
          sectionDebug.decisions.isActionable = true;
          sectionDebug.decisions.actionabilityReason =
            sectionDebug.decisions.actionabilityReason ||
            'plan_change override: healed at ACTIONABILITY gate';
        } else if (!classified.is_actionable) {
          // Drop non-plan_change sections that are not actionable
          ledger.dropSection(sectionDebug, DropReason.NOT_ACTIONABLE);
        }
      }
    }

    if (actionableSections.length === 0) {
      return buildResult([], ledger, finalConfig.enable_debug);
    }

    // ============================================
    // Stage 2.5: Topic Isolation (Before Synthesis)
    // ============================================
    // Split mixed-topic sections into topic-isolated subsections BEFORE synthesis
    // This ensures subsections go through normal synthesis instead of fallback path
    const expandedSections: ClassifiedSection[] = [];
    const splitParentSectionIds = new Set<string>();

    for (const section of actionableSections) {
      // Check if section should be split, with debug instrumentation
      const debugInfo: { topicIsolation?: any; topicSplit?: any } = {};
      const shouldSplit = shouldSplitByTopic(section, finalConfig.enable_debug ? debugInfo : undefined);

      if (shouldSplit) {
        const subsections = splitSectionByTopic(section, finalConfig.enable_debug ? debugInfo : undefined);

        // CRITICAL CHECK: Verify actual subsections were created
        // If splitSectionByTopic returns [section] (no split), DO NOT mark as SPLIT_INTO_SUBSECTIONS
        const actuallyCreatedSubsections = subsections.length > 1 ||
          (subsections.length === 1 && subsections[0].section_id !== section.section_id);

        if (!actuallyCreatedSubsections) {
          // Split was eligible but no actual subsections created (e.g., anchors not at line start)
          // Add to expanded sections as-is, do NOT mark as split
          expandedSections.push(section);

          if (finalConfig.enable_debug && ledger) {
            console.warn('[TOPIC_ISOLATION_NO_OP] Split eligible but no subsections created:', {
              sectionId: section.section_id,
              heading: section.heading_text,
              subsectionsReturned: subsections.length,
              firstSubsectionId: subsections[0]?.section_id,
              debugInfo,
            });

            // Record debug info to explain why no split happened
            const sectionDebug = ledger.getSection(section.section_id);
            if (sectionDebug) {
              sectionDebug.metadata = {
                ...sectionDebug.metadata,
                topicIsolation: debugInfo.topicIsolation,
                topicIsolationNoOp: {
                  reason: 'no_subsections_created',
                  eligibilityReason: debugInfo.topicIsolation?.reason,
                  topicsFound: debugInfo.topicSplit?.topicsFound || [],
                },
              };
            }
          }
          continue; // Skip split handling
        }

        // Actual subsections created - proceed with split
        expandedSections.push(...subsections);

        // DEBUG ASSERTION: Log subsection creation (only in dev/test)
        if (finalConfig.enable_debug && process.env.DEBUG_TOPIC_ISOLATION_TRACE === 'true') {
          console.log('[TOPIC_ISOLATION_DEBUG] Created subsections:', {
            parentSectionId: section.section_id,
            subsectionCount: subsections.length,
            subsectionIds: subsections.map(s => s.section_id),
          });
        }

        // Track parent section as split (so we don't emit from it)
        splitParentSectionIds.add(section.section_id);

        // Mark parent section as split in debug ledger with topic isolation info
        if (ledger) {
          const parentDebug = ledger.getSection(section.section_id);
          if (parentDebug) {
            // INVARIANT: Always attach topicSplit metadata before marking as SPLIT_INTO_SUBSECTIONS
            // This ensures parent.metadata contains subsection info even if debug is OFF
            const topicSplitMetadata = {
              topicsFound: debugInfo.topicSplit?.topicsFound || [],
              subSectionIds: subsections.map(s => s.section_id),
              subsectionCount: subsections.length,
              reason: 'split by topic anchors',
            };

            parentDebug.metadata = {
              ...parentDebug.metadata,
              topicSplit: topicSplitMetadata,
            };

            // Add full debug info if enable_debug is true
            if (finalConfig.enable_debug && debugInfo.topicIsolation) {
              parentDebug.metadata = {
                ...parentDebug.metadata,
                topicIsolation: debugInfo.topicIsolation,
              };
            }

            // Now mark parent as split (after metadata is attached)
            parentDebug.emitted = false;
            parentDebug.dropStage = DropStage.TOPIC_ISOLATION;
            parentDebug.dropReason = DropReason.SPLIT_INTO_SUBSECTIONS;
            parentDebug.synthesisRan = false;
          }
        }

        // Create debug entries for subsections
        if (ledger) {
          const ledgerSizeBeforeSubsections = Array.from((ledger as any).sections.values()).length;

          // DEBUG ASSERTION: Check if splitSectionByTopic returned actual subsections or just parent (dev/test only)
          if (finalConfig.enable_debug && process.env.DEBUG_TOPIC_ISOLATION_TRACE === 'true' && subsections.length > 0) {
            const hasActualSubsections = subsections.some(s => s.section_id.includes('__topic_'));
            console.log('[TOPIC_ISOLATION_DEBUG] Subsection type check:', {
              parentSectionId: section.section_id,
              subsectionsLength: subsections.length,
              hasActualSubsections,
              firstSubsectionId: subsections[0]?.section_id,
            });
          }

          for (const subsection of subsections) {
            sectionToDebug(ledger, subsection);
            // Inherit parent section's classification
            const parentDebug = ledger.getSection(section.section_id);
            const subsectionDebug = ledger.getSection(subsection.section_id);
            if (parentDebug && subsectionDebug) {
              ledger.afterIntentClassification(
                subsectionDebug,
                subsection.intent,
                subsection.is_actionable,
                subsection.actionability_reason,
                parentDebug.signals?.actionabilitySignals
              );
              if (subsection.suggested_type) {
                ledger.afterTypeClassification(
                  subsectionDebug,
                  subsection.suggested_type,
                  subsection.type_confidence || 0
                );
              }
            }
          }

          const ledgerSizeAfterSubsections = Array.from((ledger as any).sections.values()).length;

          // HARD INVARIANT CHECK: Verify all subsections were added to ledger
          const expectedSubsectionCount = subsections.length;
          const actualSubsectionsAdded = ledgerSizeAfterSubsections - ledgerSizeBeforeSubsections;

          if (actualSubsectionsAdded !== expectedSubsectionCount) {
            // INVARIANT VIOLATION: Not all subsections were added to ledger
            console.error('[TOPIC_ISOLATION_INVARIANT_VIOLATION] Subsections missing from ledger:', {
              parentSectionId: section.section_id,
              expectedSubsectionCount,
              actualSubsectionsAdded,
              subsectionIds: subsections.map(s => s.section_id),
            });

            // RECOVERY: Mark parent with TOPIC_ISOLATION_FAILED instead of SPLIT_INTO_SUBSECTIONS
            const parentDebug = ledger.getSection(section.section_id);
            if (parentDebug) {
              parentDebug.dropReason = DropReason.INTERNAL_ERROR;
              parentDebug.dropStage = DropStage.TOPIC_ISOLATION;
              parentDebug.metadata = {
                ...parentDebug.metadata,
                topicIsolationFailure: {
                  reason: 'subsections_missing_from_ledger',
                  expectedCount: expectedSubsectionCount,
                  actualCount: actualSubsectionsAdded,
                },
              };
            }
          }

          // DEBUG ASSERTION: Log ledger state after adding subsections (dev/test only)
          if (finalConfig.enable_debug && process.env.DEBUG_TOPIC_ISOLATION_TRACE === 'true') {
            console.log('[TOPIC_ISOLATION_DEBUG] Ledger state after subsections:', {
              ledgerSizeBeforeSubsections,
              ledgerSizeAfterSubsections,
              subsectionsAdded: actualSubsectionsAdded,
              allSectionIds: Array.from((ledger as any).sections.keys()),
            });
          }
        }
      } else {
        // Not split-eligible, add to expanded sections as-is
        expandedSections.push(section);

        // Record debug info even if not split (to explain why)
        if (ledger && finalConfig.enable_debug && debugInfo.topicIsolation) {
          const sectionDebug = ledger.getSection(section.section_id);
          if (sectionDebug) {
            sectionDebug.metadata = {
              ...sectionDebug.metadata,
              topicIsolation: debugInfo.topicIsolation,
            };
          }
        }
      }
    }

    // ============================================
    // Stage 3: Synthesis
    // ============================================
    const synthStart = Date.now();
    let synthesizedSuggestions = synthesizeSuggestions(expandedSections);

    // PLAN_CHANGE PROTECTION (Task 4): Guarantee at least one suggestion per plan_change section
    // If synthesis produced 0 candidates for a plan_change section, emit a fallback suggestion
    const sectionIdsWithSuggestions = new Set(synthesizedSuggestions.map(s => s.section_id));

    // Use expandedSections (which includes subsections) for fallback checks
    for (const section of expandedSections) {
      const isPlanChange = isPlanChangeIntentLabel(section.intent);
      const hasSuggestion = sectionIdsWithSuggestions.has(section.section_id);

      // Skip fallback creation for topic-isolated subsections
      // Topic isolation has already run, so if a subsection has no suggestion, it was suppressed
      const isTopicIsolatedSubsection = section.section_id.includes('__topic_');

      if (isPlanChange && !hasSuggestion && isTopicIsolatedSubsection) {
        // Mark topic-isolated subsection with no candidates as suppressed (not INTERNAL_ERROR)
        if (ledger) {
          const sectionDebug = ledger.getSection(section.section_id);
          if (sectionDebug && sectionDebug.candidates.length === 0) {
            sectionDebug.emitted = false;
            sectionDebug.dropStage = DropStage.POST_SYNTHESIS_SUPPRESS;
            sectionDebug.dropReason = DropReason.LOW_RELEVANCE;
            sectionDebug.synthesisRan = true; // Synthesis did run, it just suppressed the output
          }
        }
        continue; // Skip fallback creation
      }

      if (isPlanChange && !hasSuggestion && !isTopicIsolatedSubsection) {
        // FIX 1: Check section-level suppression before creating fallback
        // Suppression must be normal control flow, not an exception
        const headingText = section.heading_text?.trim() || '';
        const hasForceRoleAssignment = section.intent.flags?.forceRoleAssignment || false;
        const isSuppressed = checkSectionSuppression(headingText, section.structural_features, section.raw_text, hasForceRoleAssignment, section.body_lines);

        if (isSuppressed) {
          // Section is suppressed (e.g., "Next steps", "Summary")
          // Mark section as dropped with SUPPRESSED_SECTION reason at POST_SYNTHESIS_SUPPRESS stage
          if (ledger) {
            const sectionDebug = ledger.getSection(section.section_id);
            if (sectionDebug) {
              // Update section debug state to reflect suppression
              sectionDebug.emitted = false;
              sectionDebug.dropStage = DropStage.POST_SYNTHESIS_SUPPRESS;
              sectionDebug.dropReason = DropReason.SUPPRESSED_SECTION;
              sectionDebug.synthesisRan = false;

              // Mark all candidates as suppressed
              for (const candidate of sectionDebug.candidates) {
                if (!candidate.dropped) {
                  candidate.emitted = false;
                  candidate.dropStage = DropStage.POST_SYNTHESIS_SUPPRESS;
                  candidate.dropReason = DropReason.SUPPRESSED_SECTION;
                }
              }
            }
          }
          continue; // Skip fallback creation
        }

        // FIX 2: Check if section meets criteria for normal synthesis (not fallback)
        // Discussion details or long sections should get normal synthesis, not "Review:" fallback
        const debugInfo: { topicIsolation?: any; topicSplit?: any } = {};
        const isSplitEligible = shouldSplitByTopic(section, finalConfig.enable_debug ? debugInfo : undefined);

        // Extract leaf heading for discussion details check
        const fullHeadingText = section.heading_text || '';
        const leafHeading = fullHeadingText.split('>').pop()?.trim() || '';
        const normalizedLeaf = leafHeading.toLowerCase().trim();
        const leafWithoutEmoji = normalizedLeaf.replace(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu, '').trim();

        const isDiscussionDetails = ['discussion details', 'discussion', 'details'].some(h =>
          leafWithoutEmoji === h ||
          normalizedLeaf === h ||
          leafWithoutEmoji.startsWith(h + ':') ||
          normalizedLeaf.startsWith(h + ':')
        );

        const bulletCount = section.structural_features?.num_list_items ??
          section.body_lines.filter(l => l.line_type === 'list_item').length;
        const charCount = section.raw_text.length;
        const isLongSection = bulletCount >= 5 || charCount >= 500;

        // B-LITE FIX: Check if ANY section has explicit request language (heading-agnostic)
        // If so, force synthesis of a real suggestion
        {
          const hasExplicitRequest = containsExplicitRequest(section.raw_text);
          const hasTopicAnchors = section.body_lines ? hasExtractableTopicAnchors(section.body_lines) : false;

          if (hasExplicitRequest && !hasTopicAnchors) {
            const explicitAsk = extractExplicitAsk(section.raw_text);

            if (explicitAsk && explicitAsk.length > 10) {
              const title = generateTitleFromExplicitAsk(explicitAsk);

              const askLineObj = section.body_lines.find(l => {
                const normalizedLine = l.text.replace(/^\s*[-*+•]\s+/, '').replace(/^\s*\d+[.)]\s+/, '').trim();
                return normalizedLine.length > 10 && explicitAsk.includes(normalizedLine.substring(0, 30));
              });

              const evidenceSpans = askLineObj
                ? [{
                    start_line: askLineObj.index,
                    end_line: askLineObj.index,
                    text: askLineObj.text,
                  }]
                : [{
                    start_line: section.start_line,
                    end_line: Math.min(section.end_line, section.start_line + 2),
                    text: section.body_lines.slice(0, 2).map(l => l.text).join('\n'),
                  }];

              const explicitAskSuggestion: Suggestion = {
                suggestion_id: `explicit_ask_${section.section_id}_${Date.now()}`,
                note_id: section.note_id,
                section_id: section.section_id,
                type: 'idea',
                title,
                payload: {
                  draft_initiative: {
                    title: title.replace(/^New idea:\s*/i, '').trim(),
                    description: explicitAsk.charAt(0).toUpperCase() + explicitAsk.slice(1),
                  },
                },
                evidence_spans: evidenceSpans,
                scores: {
                  section_actionability: section.intent.new_workstream || 0.6,
                  type_choice_confidence: 0.7,
                  synthesis_confidence: 0.7,
                  overall: 0,
                },
                routing: { create_new: true },
                suggestionKey: `${section.note_id}_${section.section_id}_idea_${title}`,
                structural_hint: 'explicit_ask',
                suggestion: {
                  title,
                  body: explicitAsk.charAt(0).toUpperCase() + explicitAsk.slice(1),
                  evidencePreview: [explicitAsk.substring(0, 150)],
                  sourceSectionId: section.section_id,
                  sourceHeading: section.heading_text || '',
                },
              };

              synthesizedSuggestions.push(explicitAskSuggestion);
              sectionIdsWithSuggestions.add(section.section_id);

              if (ledger) {
                console.warn('[EXPLICIT_ASK_B_LITE] Created real suggestion for section with explicit ask:', {
                  sectionId: section.section_id,
                  heading: section.heading_text,
                  title,
                });

                const sectionDebug = ledger.getSection(section.section_id);
                if (sectionDebug) {
                  ledger.afterSynthesis(sectionDebug, explicitAskSuggestion);
                }
              }

              continue;
            }
          }
        }

        // CRITICAL: Discussion details or long sections should NEVER get fallback
        if (isDiscussionDetails || isLongSection) {
          // These sections should get normal synthesis, not fallback
          // If synthesis produced 0 candidates, that's fine - emit nothing, don't fallback
          if (ledger) {
            console.warn('[FALLBACK_SKIP] Section eligible for normal synthesis, not fallback:', {
              sectionId: section.section_id,
              heading: section.heading_text,
              isDiscussionDetails,
              isLongSection,
              bulletCount,
              charCount,
            });

            // Mark section to prevent INTERNAL_ERROR in finalize()
            // This section intentionally skipped fallback and may have 0 candidates
            const sectionDebug = ledger.getSection(section.section_id);
            if (sectionDebug && !sectionDebug.dropReason) {
              // Pre-mark with LOW_RELEVANCE if no candidates (finalize will respect this)
              sectionDebug.metadata = {
                ...sectionDebug.metadata,
                fallbackSkipped: {
                  reason: isDiscussionDetails ? 'discussion_details' : 'long_section',
                  bulletCount,
                  charCount,
                },
              };
            }
          }
          continue; // Skip fallback creation
        }

        if (isSplitEligible) {
          // Split the section and add subsections to expanded list for synthesis
          const subsections = splitSectionByTopic(section, finalConfig.enable_debug ? debugInfo : undefined);

          // CRITICAL CHECK: Verify actual subsections were created
          const actuallyCreatedSubsections = subsections.length > 1 ||
            (subsections.length === 1 && subsections[0].section_id !== section.section_id);

          if (!actuallyCreatedSubsections) {
            // Split was eligible but no actual subsections created
            // Create fallback suggestion instead
            if (ledger) {
              console.warn('[TOPIC_ISOLATION_FALLBACK_NO_OP] Split eligible but no subsections, creating fallback:', {
                sectionId: section.section_id,
                heading: section.heading_text,
                subsectionsReturned: subsections.length,
                debugInfo,
              });
            }
            // Fall through to fallback creation below (do NOT continue)
          } else {
            // Actual subsections created in fallback path
            if (ledger) {
              console.warn('[TOPIC_ISOLATION_FALLBACK_PATH] Section was split-eligible but reached fallback path:', {
                sectionId: section.section_id,
                heading: section.heading_text,
                subsectionCount: subsections.length,
                debugInfo,
              });

              // Record topic isolation info in parent section debug
              const parentDebug = ledger.getSection(section.section_id);
              if (parentDebug) {
                // INVARIANT: Always attach topicSplit metadata before marking as SPLIT_INTO_SUBSECTIONS
                const topicSplitMetadata = {
                  topicsFound: debugInfo.topicSplit?.topicsFound || [],
                  subSectionIds: subsections.map(s => s.section_id),
                  subsectionCount: subsections.length,
                  reason: 'split by topic anchors (fallback path)',
                };

                parentDebug.metadata = {
                  ...parentDebug.metadata,
                  topicSplit: topicSplitMetadata,
                };

                // Add full debug info if enable_debug is true
                if (finalConfig.enable_debug && debugInfo.topicIsolation) {
                  parentDebug.metadata = {
                    ...parentDebug.metadata,
                    topicIsolation: debugInfo.topicIsolation,
                  };
                }

                parentDebug.emitted = false;
                parentDebug.dropStage = DropStage.TOPIC_ISOLATION;
                parentDebug.dropReason = DropReason.SPLIT_INTO_SUBSECTIONS;
              }
            }

            // Process subsections through normal synthesis (retry synthesis for them)
            for (const subsection of subsections) {
              // Skip original section (parent)
              if (subsection.section_id === section.section_id) continue;

              // Create debug entry for subsection
              if (ledger) {
                sectionToDebug(ledger, subsection);
                const subsectionDebug = ledger.getSection(subsection.section_id);
                if (subsectionDebug) {
                  // Inherit parent classification
                  ledger.afterIntentClassification(
                    subsectionDebug,
                    subsection.intent,
                    subsection.is_actionable,
                    subsection.actionability_reason,
                    undefined
                  );
                  if (subsection.suggested_type) {
                    ledger.afterTypeClassification(
                      subsectionDebug,
                      subsection.suggested_type,
                      subsection.type_confidence || 0
                    );
                  }
                }
              }

              // Synthesize subsection
              const subsectionSuggestions = synthesizeSuggestions([subsection]);
              for (const suggestion of subsectionSuggestions) {
                synthesizedSuggestions.push(suggestion);
                sectionIdsWithSuggestions.add(subsection.section_id);

                if (ledger) {
                  const subsectionDebug = ledger.getSection(subsection.section_id);
                  if (subsectionDebug) {
                    ledger.afterSynthesis(subsectionDebug, suggestion);
                  }
                }
              }
            }

            continue; // Skip fallback creation
          }
          // If actuallyCreatedSubsections is false, fall through to fallback creation
        }

        // Create fallback suggestion for plan_change section with 0 candidates
        // Only reaches here if section is NOT suppressed AND NOT split-eligible
        const fallbackSuggestion: Suggestion = {
          suggestion_id: `fallback_${section.section_id}_${Date.now()}`,
          note_id: section.note_id,
          section_id: section.section_id,
          type: 'project_update',
          title: section.heading_text
            ? `Review: ${section.heading_text}`
            : 'Review plan change',
          payload: {
            after_description: `Plan change detected in section. ${
              section.body_lines
                .filter(l => l.line_type === 'list_item')
                .slice(0, 3)
                .map(l => l.text.trim())
                .join(' ')
            }`.trim(),
          },
          evidence_spans: section.body_lines.length > 0
            ? [{
                start_line: section.start_line,
                end_line: Math.min(section.end_line, section.start_line + 5),
                text: section.body_lines.slice(0, 3).map(l => l.text).join('\n'),
              }]
            : [],
          scores: {
            section_actionability: section.actionable_signal || 0.3,
            type_choice_confidence: 0.3,
            synthesis_confidence: 0.3,
            overall: 0.3,
          },
          routing: { create_new: true },
          needs_clarification: true,
          clarification_reasons: ['fallback_synthesis'],
          is_high_confidence: false,
        };

        synthesizedSuggestions.push(fallbackSuggestion);
        sectionIdsWithSuggestions.add(section.section_id);

        if (ledger) {
          console.warn('[PLAN_CHANGE_FALLBACK] Created fallback suggestion for section:', section.section_id);
        }
      }
    }

    // Record synthesis results
    if (ledger) {
      for (const suggestion of synthesizedSuggestions) {
        let sectionDebug = ledger.getSection(suggestion.section_id);

        // Handle topic-isolated subsections: if debug entry not found, try parent section
        if (!sectionDebug && suggestion.section_id.includes('__topic_')) {
          const parentId = suggestion.section_id.split('__topic_')[0];
          sectionDebug = ledger.getSection(parentId);
          if (sectionDebug && finalConfig.enable_debug) {
            console.warn('[DEBUG] Subsection debug entry not found, using parent:', {
              subsectionId: suggestion.section_id,
              parentId,
            });
          }
        }

        if (sectionDebug) {
          ledger.afterSynthesis(sectionDebug, suggestion);
        } else if (finalConfig.enable_debug) {
          console.error('[DEBUG] Section debug entry not found for suggestion:', suggestion.section_id);
        }
      }
      ledger.recordStageTiming(DropStage.SYNTHESIS, Date.now() - synthStart);
    }

    if (synthesizedSuggestions.length === 0) {
      return buildResult([], ledger, finalConfig.enable_debug);
    }

    // Build section lookup map (include both original classified sections and expanded subsections)
    const sectionMap = new Map<string, ClassifiedSection>();
    for (const section of classifiedSections) {
      sectionMap.set(section.section_id, section);
    }
    // Add expanded subsections to map
    for (const section of expandedSections) {
      if (!sectionMap.has(section.section_id)) {
        sectionMap.set(section.section_id, section);
      }
    }

    // ============================================
    // Stage 4: Validation (Hard Gates V1-V3)
    // ============================================
    const validStart = Date.now();
    const validatedSuggestions: Suggestion[] = [];

    for (const suggestion of synthesizedSuggestions) {
      try {
        let section = sectionMap.get(suggestion.section_id);

        // Handle topic-isolated sub-sections: if section not found, try parent section
        if (!section && suggestion.section_id.includes('__topic_')) {
          const parentId = suggestion.section_id.split('__topic_')[0];
          section = sectionMap.get(parentId);
        }

        if (!section) {
          const errorMsg = `Section not found for suggestion ${suggestion.suggestion_id}`;
          if (finalConfig.enable_debug) {
            console.error('[VALIDATION_ERROR]', {
              suggestionId: suggestion.suggestion_id,
              sectionId: suggestion.section_id,
              error: errorMsg,
            });
          }
          if (ledger) {
            ledger.dropCandidateById(
              suggestion.suggestion_id,
              DropReason.INTERNAL_ERROR
            );
          }
          continue;
        }

        const validationResult = runQualityValidators(
          suggestion,
          section,
          finalConfig.thresholds,
          section.typeLabel
        );

        // Record validation results
        if (ledger) {
          const sectionDebug = ledger.getSection(suggestion.section_id);
          if (sectionDebug) {
            ledger.afterValidation(sectionDebug, suggestion, validationResult.results);
          }
        }

        if (validationResult.passed) {
          suggestion.validation_results = validationResult.results;
          validatedSuggestions.push(suggestion);
        } else {
          // Map validator to drop reason
          const dropReason = mapValidatorToDropReason(validationResult.failedValidator);

          if (ledger) {
            ledger.dropCandidateById(suggestion.suggestion_id, dropReason);
          }
        }
      } catch (error) {
        // Capture validation errors in debug mode
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (finalConfig.enable_debug) {
          console.error('[VALIDATION_ERROR]', {
            suggestionId: suggestion.suggestion_id,
            sectionId: suggestion.section_id,
            error: errorMessage,
            stack: error instanceof Error ? error.stack : undefined,
          });
        }
        if (ledger) {
          ledger.dropCandidateById(
            suggestion.suggestion_id,
            DropReason.INTERNAL_ERROR
          );
        }
      }
    }

    if (ledger) {
      ledger.recordStageTiming(DropStage.VALIDATION, Date.now() - validStart);
    }

    if (validatedSuggestions.length === 0) {
      return buildResult([], ledger, finalConfig.enable_debug);
    }

    // ============================================
    // Stage 5: Scoring & Thresholding
    // ============================================
    const scoreStart = Date.now();
    const scoringResult = runScoringPipeline(
      validatedSuggestions,
      sectionMap,
      finalConfig
    );

    // Instrumentation: Log post-scoring state for aggregation debugging
    if (process.env.DEBUG_AGGREGATION === 'true' || finalConfig.enable_debug) {
      console.log('[Aggregation Debug] Post-scoring:', {
        noteId: note.note_id,
        stage: 'post_scoring',
        passedCount: scoringResult.suggestions.length,
        droppedCount: scoringResult.dropped.length,
        downgraded: scoringResult.downgraded_to_clarification || 0,
        passedIds: scoringResult.suggestions.map(s => s.suggestion_id),
      });
    }

    // Record scoring results
    if (ledger) {
      // Record scores for ALL suggestions (passed + dropped) before marking drops
      // This ensures debug output shows computed scores even for dropped suggestions
      for (const suggestion of scoringResult.suggestions) {
        const sectionDebug = ledger.getSection(suggestion.section_id);
        if (sectionDebug) {
          ledger.afterScoring(sectionDebug, suggestion, suggestion.scores);
        }
      }

      // Also record scores for dropped suggestions BEFORE marking them as dropped
      for (const dropped of scoringResult.dropped) {
        const { suggestion } = dropped;
        const sectionDebug = ledger.getSection(suggestion.section_id);
        if (sectionDebug) {
          ledger.afterScoring(sectionDebug, suggestion, suggestion.scores);
        }
      }

      // Record dropped suggestions
      // PLAN_CHANGE PROTECTION: Never drop project_update at THRESHOLD
      for (const dropped of scoringResult.dropped) {
        const { suggestion } = dropped;

        // Never treat plan_change / project_update as score-based drops
        if (suggestion.type === 'project_update') {
          // Log an invariant violation, since scoring.ts should already
          // prevent project_update from entering `dropped`.
          console.error('[PLAN_CHANGE_THRESHOLD_INVARIANT_VIOLATION]', {
            noteId: note.note_id,
            suggestionId: suggestion.suggestion_id,
            reason: dropped.reason,
          });
          continue;
        }

        ledger.dropCandidateById(
          suggestion.suggestion_id,
          DropReason.SCORE_BELOW_THRESHOLD
        );
      }

      ledger.recordStageTiming(DropStage.THRESHOLD, Date.now() - scoreStart);
    }

    if (scoringResult.suggestions.length === 0) {
      return buildResult([], ledger, finalConfig.enable_debug);
    }

    // ============================================
    // Stage 6: Routing
    // ============================================
    const initiatives = context?.initiatives || [];
    const routedSuggestions = routeSuggestions(
      scoringResult.suggestions,
      initiatives,
      finalConfig.thresholds
    );

    // ============================================
    // Stage 7: Dedupe (if any)
    // ============================================
    const dedupeStart = Date.now();
    const finalSuggestions = dedupeSuggestions(routedSuggestions, ledger);

    if (ledger) {
      ledger.recordStageTiming(DropStage.DEDUPE, Date.now() - dedupeStart);
    }

    // Instrumentation: Log final suggestions state
    if (process.env.DEBUG_AGGREGATION === 'true' || finalConfig.enable_debug) {
      console.log('[Aggregation Debug] Final suggestions:', {
        noteId: note.note_id,
        stage: 'final_suggestions',
        count: finalSuggestions.length,
        suggestionIds: finalSuggestions.map(s => s.suggestion_id),
      });
    }

    // Finalize debug run (reconciles emitted flags with final suggestion IDs)
    if (ledger) {
      ledger.finalize(finalSuggestions.map((s) => s.suggestion_id));

      // INVARIANT CHECK: Verify all ledger sections appear in debugRun (always runs when enable_debug=true)
      if (finalConfig.enable_debug) {
        const debugRun = ledger.buildDebugRun();

        // Check ledger consistency
        const ledgerSectionIds = new Set(Array.from((ledger as any).sections.keys()));
        const debugRunSectionIds = new Set(debugRun.sections.map(s => s.sectionId));
        const missingSectionIds = Array.from(ledgerSectionIds).filter(id => !debugRunSectionIds.has(id));

        if (missingSectionIds.length > 0) {
          console.error('[TOPIC_ISOLATION_INVARIANT_VIOLATION] Sections in ledger but missing from debugRun:', {
            missingSectionIds,
            ledgerSize: ledgerSectionIds.size,
            debugRunSize: debugRunSectionIds.size,
          });
        }

        // Detailed logging only in trace mode
        if (process.env.DEBUG_TOPIC_ISOLATION_TRACE === 'true') {
          console.log('[TOPIC_ISOLATION_DEBUG] Final debugRun sections:', {
            totalSections: debugRun.sections.length,
            sectionIds: debugRun.sections.map(s => s.sectionId),
            subsectionCount: debugRun.sections.filter(s => s.sectionId.includes('__topic_')).length,
            ledgerConsistencyCheck: missingSectionIds.length === 0 ? 'PASS' : 'FAIL',
          });
        }
      }
    }

    // INVARIANT CHECK: Ensure emitted candidates match final suggestions
    if (ledger && finalConfig.enable_debug) {
      const debugRun = ledger.buildDebugRun();
      const emittedCandidates = debugRun.sections
        .flatMap(sec => sec.candidates)
        .filter(c => c.emitted);
      
      if (emittedCandidates.length > 0 && finalSuggestions.length === 0) {
        console.error('[AGGREGATION_INVARIANT_VIOLATION]', {
          noteId: note.note_id,
          emittedCount: emittedCandidates.length,
          finalCount: finalSuggestions.length,
          emittedIds: emittedCandidates.map(c => c.candidateId),
        });
      }

      // Check plan_change invariant
      const planChangeCandidates = debugRun.sections
        .flatMap(sec => sec.candidates)
        .filter(c => c.metadata?.type === 'project_update');
      const planChangeSuggestions = finalSuggestions.filter(s => s.type === 'project_update');
      
      if (planChangeCandidates.length > 0 && planChangeSuggestions.length === 0) {
        console.error('[PLAN_CHANGE_INVARIANT_VIOLATION]', {
          noteId: note.note_id,
          planChangeCandidatesCount: planChangeCandidates.length,
          planChangeSuggestionsCount: planChangeSuggestions.length,
        });
      }
    }

    return buildResult(finalSuggestions, ledger, finalConfig.enable_debug);
  } catch (error) {
    // Handle global error
    if (ledger) {
      ledger.markGlobalError(error as Error);
    }
    throw error;
  }
}

// ============================================
// Helper Functions
// ============================================

/**
 * Build the final result object
 */
function buildResult(
  suggestions: Suggestion[],
  ledger: DebugLedger | null,
  includeDebug: boolean
): DebugGeneratorResult {
  const result: DebugGeneratorResult = {
    suggestions,
  };

  if (ledger) {
    result.debugRun = ledger.buildDebugRun();
  }

  return result;
}

/**
 * Map validator name to drop reason
 */
function mapValidatorToDropReason(validator?: string): DropReason {
  switch (validator) {
    case "V2_anti_vacuity":
      return DropReason.VALIDATION_V2_TOO_GENERIC;
    case "V3_evidence_sanity":
      return DropReason.VALIDATION_V3_EVIDENCE_TOO_WEAK;
    case "V4_heading_only":
      return DropReason.VALIDATION_V4_HEADING_ONLY;
    default:
      return DropReason.INTERNAL_ERROR;
  }
}

/**
 * Dedupe suggestions by fingerprint
 */
function dedupeSuggestions(
  suggestions: Suggestion[],
  ledger: DebugLedger | null
): Suggestion[] {
  const seen = new Set<string>();
  const unique: Suggestion[] = [];

  for (const suggestion of suggestions) {
    // Use suggestionKey as stable fingerprint for dedupe
    const fingerprint = suggestion.suggestionKey;

    if (seen.has(fingerprint)) {
      if (ledger) {
        ledger.dropCandidateById(
          suggestion.suggestion_id,
          DropReason.DUPLICATE_FINGERPRINT
        );
      }
      continue;
    }

    seen.add(fingerprint);
    unique.push(suggestion);
  }

  return unique;
}

// ============================================
// Export for index
// ============================================

export { DebugLedger, createDebugLedger, sectionToDebug } from "./DebugLedger";
