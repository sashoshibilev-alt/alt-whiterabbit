/**
 * Suggestion Engine v2 - LLM-based Classifiers
 *
 * LLM-based intent and type classification as an alternative to rule-based classification.
 * Enabled via the `use_llm_classifiers` flag in GeneratorConfig.
 *
 * Design principles:
 * - LLM returns probability scores, not just top labels
 * - A section can have high research AND high plan_change/new_workstream scores
 * - Actionability gating happens downstream based on numeric signals
 */

import type {
  Section,
  IntentClassification,
  SectionType,
} from './types';

// ============================================
// LLM Response Types
// ============================================

/**
 * Expected response from LLM intent classification
 */
export interface LLMIntentResponse {
  plan_change: number;
  new_workstream: number;
  status_informational: number;
  communication: number;
  research: number;
  calendar: number;
  micro_tasks: number;
  confidence: number;
  reasoning?: string;
}

/**
 * Expected response from LLM type classification
 */
export interface LLMTypeResponse {
  type: SectionType;
  confidence: number;
  p_mutation: number;
  p_artifact: number;
  reasoning?: string;
}

// ============================================
// LLM Provider Interface
// ============================================

/**
 * Interface for LLM providers (OpenAI, Anthropic, local, etc.)
 */
export interface LLMProvider {
  /**
   * Call the LLM with a prompt and get structured JSON response
   */
  complete<T>(prompt: string, schema: object): Promise<T>;
}

// ============================================
// Prompt Templates
// ============================================

const INTENT_CLASSIFICATION_PROMPT = `You are classifying the intent of a section from meeting notes or planning documents.

Section text:
"""
{{SECTION_TEXT}}
"""

Classify this section by assigning probability scores (0.0 to 1.0) for each intent category:

- plan_change: Modifications to existing plans, scopes, timelines, or priorities. Includes reprioritization, deferrals, scope changes, pivot decisions.
- new_workstream: Creation of new initiatives, projects, programs, or workstreams. Includes launching new efforts, spinning up teams, starting new programs.
- status_informational: Status updates, progress reports, FYIs without action implications.
- communication: Tasks about sending messages, scheduling meetings, notifying people.
- research: Investigation, analysis, exploration tasks. NOTE: Research tied to deliverables (e.g., "research to build dashboard") should ALSO have high plan_change/new_workstream.
- calendar: Meeting scheduling, recurring meetings, calendar management.
- micro_tasks: Small administrative tasks like updating docs, following up, cleaning up files.

Important:
- A section CAN have high scores in multiple categories (e.g., research + new_workstream)
- Focus on the primary PURPOSE of the section
- Consider both explicit statements and implied intent

Return JSON with exactly these fields:
{
  "plan_change": 0.0-1.0,
  "new_workstream": 0.0-1.0,
  "status_informational": 0.0-1.0,
  "communication": 0.0-1.0,
  "research": 0.0-1.0,
  "calendar": 0.0-1.0,
  "micro_tasks": 0.0-1.0,
  "confidence": 0.0-1.0,
  "reasoning": "brief explanation"
}`;

const TYPE_CLASSIFICATION_PROMPT = `You are classifying the type of actionable content in a section.

Section text:
"""
{{SECTION_TEXT}}
"""

Intent signals:
- plan_change: {{PLAN_CHANGE}}
- new_workstream: {{NEW_WORKSTREAM}}

Classify whether this section represents:

1. project_update: Changes to an EXISTING initiative, project, or plan. Examples:
   - "Shift focus from X to Y"
   - "Defer feature Z to next quarter"
   - "Reduce scope to core functionality"

2. idea: A NEW initiative, project, or workstream being created. Examples:
   - "Launch customer success program"
   - "Build new analytics dashboard"
   - "Create partner integration platform"

3. non_actionable: Content that doesn't warrant a suggestion (fallback)

Return JSON with exactly these fields:
{
  "type": "project_update" | "idea" | "non_actionable",
  "confidence": 0.0-1.0,
  "p_mutation": 0.0-1.0,
  "p_artifact": 0.0-1.0,
  "reasoning": "brief explanation"
}`;

// ============================================
// LLM Classification Functions
// ============================================

/**
 * Classify section intent using LLM
 */
export async function classifyIntentWithLLM(
  section: Section,
  llmProvider: LLMProvider
): Promise<IntentClassification> {
  const sectionText = `${section.heading_text ? `## ${section.heading_text}\n\n` : ''}${section.raw_text}`;

  const prompt = INTENT_CLASSIFICATION_PROMPT.replace('{{SECTION_TEXT}}', sectionText);

  const schema = {
    type: 'object',
    properties: {
      plan_change: { type: 'number', minimum: 0, maximum: 1 },
      new_workstream: { type: 'number', minimum: 0, maximum: 1 },
      status_informational: { type: 'number', minimum: 0, maximum: 1 },
      communication: { type: 'number', minimum: 0, maximum: 1 },
      research: { type: 'number', minimum: 0, maximum: 1 },
      calendar: { type: 'number', minimum: 0, maximum: 1 },
      micro_tasks: { type: 'number', minimum: 0, maximum: 1 },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
      reasoning: { type: 'string' },
    },
    required: ['plan_change', 'new_workstream', 'status_informational', 'communication', 'research', 'calendar', 'micro_tasks', 'confidence'],
  };

  try {
    const response = await llmProvider.complete<LLMIntentResponse>(prompt, schema);

    return {
      plan_change: response.plan_change,
      new_workstream: response.new_workstream,
      status_informational: response.status_informational,
      communication: response.communication,
      research: response.research,
      calendar: response.calendar,
      micro_tasks: response.micro_tasks,
    };
  } catch (error) {
    // Return neutral scores on failure - caller should fall back to rule-based
    console.warn('LLM intent classification failed, returning neutral scores:', error);
    return {
      plan_change: 0.25,
      new_workstream: 0.25,
      status_informational: 0.25,
      communication: 0.25,
      research: 0.25,
      calendar: 0.25,
      micro_tasks: 0.25,
    };
  }
}

/**
 * Classify section type using LLM
 */
export async function classifyTypeWithLLM(
  section: Section,
  intent: IntentClassification,
  llmProvider: LLMProvider
): Promise<{
  type: SectionType;
  confidence: number;
  p_mutation: number;
  p_artifact: number;
}> {
  const sectionText = `${section.heading_text ? `## ${section.heading_text}\n\n` : ''}${section.raw_text}`;

  const prompt = TYPE_CLASSIFICATION_PROMPT
    .replace('{{SECTION_TEXT}}', sectionText)
    .replace('{{PLAN_CHANGE}}', intent.plan_change.toFixed(2))
    .replace('{{NEW_WORKSTREAM}}', intent.new_workstream.toFixed(2));

  const schema = {
    type: 'object',
    properties: {
      type: { type: 'string', enum: ['project_update', 'idea', 'non_actionable'] },
      confidence: { type: 'number', minimum: 0, maximum: 1 },
      p_mutation: { type: 'number', minimum: 0, maximum: 1 },
      p_artifact: { type: 'number', minimum: 0, maximum: 1 },
      reasoning: { type: 'string' },
    },
    required: ['type', 'confidence', 'p_mutation', 'p_artifact'],
  };

  try {
    const response = await llmProvider.complete<LLMTypeResponse>(prompt, schema);

    return {
      type: response.type,
      confidence: response.confidence,
      p_mutation: response.p_mutation,
      p_artifact: response.p_artifact,
    };
  } catch (error) {
    // Return non_actionable on failure
    console.warn('LLM type classification failed:', error);
    return {
      type: 'non_actionable',
      confidence: 0.5,
      p_mutation: 0.25,
      p_artifact: 0.25,
    };
  }
}

// ============================================
// Hybrid Classification (LLM + Rule-based)
// ============================================

/**
 * Blend LLM and rule-based intent scores
 *
 * Strategy:
 * - If LLM confidence is high (> 0.7), use mostly LLM scores
 * - If LLM confidence is moderate, blend with rule-based
 * - If LLM fails or confidence is low, fall back to rule-based
 */
export function blendIntentScores(
  llmIntent: IntentClassification | null,
  ruleIntent: IntentClassification,
  llmConfidence: number = 0.5
): IntentClassification {
  if (!llmIntent || llmConfidence < 0.3) {
    // Fall back to rule-based
    return ruleIntent;
  }

  // Weight based on confidence
  const llmWeight = Math.min(0.8, llmConfidence);
  const ruleWeight = 1 - llmWeight;

  return {
    plan_change: llmIntent.plan_change * llmWeight + ruleIntent.plan_change * ruleWeight,
    new_workstream: llmIntent.new_workstream * llmWeight + ruleIntent.new_workstream * ruleWeight,
    status_informational: llmIntent.status_informational * llmWeight + ruleIntent.status_informational * ruleWeight,
    communication: llmIntent.communication * llmWeight + ruleIntent.communication * ruleWeight,
    research: llmIntent.research * llmWeight + ruleIntent.research * ruleWeight,
    calendar: llmIntent.calendar * llmWeight + ruleIntent.calendar * ruleWeight,
    micro_tasks: llmIntent.micro_tasks * llmWeight + ruleIntent.micro_tasks * ruleWeight,
  };
}

// ============================================
// Mock LLM Provider (for testing)
// ============================================

/**
 * Mock LLM provider for testing
 */
export class MockLLMProvider implements LLMProvider {
  private responses: Map<string, unknown> = new Map();

  /**
   * Set a mock response for a pattern
   */
  setResponse(pattern: string, response: unknown): void {
    this.responses.set(pattern, response);
  }

  async complete<T>(prompt: string, _schema: object): Promise<T> {
    // Find matching pattern
    for (const [pattern, response] of this.responses) {
      if (prompt.includes(pattern)) {
        return response as T;
      }
    }

    // Default response
    return {
      plan_change: 0.5,
      new_workstream: 0.5,
      status_informational: 0.2,
      communication: 0.1,
      research: 0.2,
      calendar: 0.1,
      micro_tasks: 0.1,
      confidence: 0.7,
      reasoning: 'Default mock response',
    } as T;
  }
}
