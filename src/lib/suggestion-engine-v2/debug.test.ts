/**
 * Suggestion Debug Report Tests
 *
 * Tests for the debug types, redaction utilities, DebugLedger, and debug generator.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  // Debug types
  DropStage,
  DropReason,
  DROP_REASON_STAGE,
  NON_BLOCKING_DROP_REASONS,
  computeDebugRunSummary,
  type DebugRun,
  type SectionDebug,
  type CandidateSuggestionDebug,
} from "./debugTypes";
import {
  // Redaction utilities
  redactText,
  makePreview,
  makeTextPreviewFromLines,
  makeEvidenceDebug,
  resolveDebugVerbosity,
  shouldPersistDebug,
  shouldIncludeDebugInResponse,
  computeJsonByteSize,
  exceedsPayloadLimit,
  type DebugFeatureFlags,
  type DebugUserContext,
  type DebugEnvContext,
} from "./debugRedaction";
import {
  // DebugLedger
  DebugLedger,
  createDebugLedger,
  sectionToDebug,
  GENERATOR_VERSION,
} from "./DebugLedger";
import {
  // Debug generator
  generateSuggestionsWithDebug,
} from "./debugGenerator";
import { DEFAULT_CONFIG, type NoteInput } from "./types";
import { resetSectionCounter } from "./preprocessing";
import { resetSuggestionCounter } from "./synthesis";

// ============================================
// Test Fixtures
// ============================================

const TEST_NOTE: NoteInput = {
  note_id: "test-debug-note",
  raw_markdown: `# Q2 Planning

## Roadmap Changes

We need to shift focus from enterprise to SMB for Q2.

- Defer enterprise features to Q3
- Prioritize self-serve signup flow
- Add in-app tutorials

The goal is to reduce onboarding time.

## New Initiative: Customer Success

Launch a customer success program.

Objective: Reduce churn from 8% to 4%.

Scope:
- Dedicated CSM for top accounts
- Monthly check-ins
- Health scoring

Approach:
1. Hire CSMs in Q2
2. Build dashboard
`,
};

const SENSITIVE_TEXT = `
Contact john.doe@example.com or call 555-123-4567 for more info.
SSN: 123-45-6789
Card: 4111-1111-1111-1111
`;

// ============================================
// Drop Stage/Reason Mapping Tests
// ============================================

describe("DropStage and DropReason Mapping", () => {
  it("should have a stage mapping for every drop reason", () => {
    for (const reason of Object.values(DropReason)) {
      expect(DROP_REASON_STAGE[reason]).toBeDefined();
    }
  });

  it("should map ACTIONABILITY stage reasons correctly", () => {
    expect(DROP_REASON_STAGE[DropReason.NOT_ACTIONABLE]).toBe(
      DropStage.ACTIONABILITY
    );
    expect(DROP_REASON_STAGE[DropReason.OUT_OF_SCOPE]).toBe(
      DropStage.ACTIONABILITY
    );
  });

  it("should map VALIDATION stage reasons correctly", () => {
    expect(DROP_REASON_STAGE[DropReason.VALIDATION_V2_TOO_GENERIC]).toBe(
      DropStage.VALIDATION
    );
    expect(DROP_REASON_STAGE[DropReason.VALIDATION_V3_EVIDENCE_TOO_WEAK]).toBe(
      DropStage.VALIDATION
    );
  });
});

// ============================================
// Redaction Utility Tests
// ============================================

describe("Redaction Utilities", () => {
  describe("redactText", () => {
    it("should redact email addresses", () => {
      const result = redactText("Contact john@example.com for info");
      expect(result).toBe("Contact [email] for info");
      expect(result).not.toContain("john@example.com");
    });

    it("should redact phone numbers", () => {
      const result = redactText("Call 555-123-4567 or +1 800 555 1234");
      expect(result).toContain("[phone]");
      expect(result).not.toMatch(/\d{3}-\d{3}-\d{4}/);
    });

    it("should redact SSNs", () => {
      const result = redactText("SSN: 123-45-6789");
      expect(result).toBe("SSN: [ssn]");
    });

    it("should redact credit card numbers", () => {
      const result = redactText("Card: 4111-1111-1111-1111");
      expect(result).toBe("Card: [card]");
    });

    it("should redact multiple patterns", () => {
      const result = redactText(SENSITIVE_TEXT);
      expect(result).toContain("[email]");
      expect(result).toContain("[phone]");
      expect(result).toContain("[ssn]");
      expect(result).toContain("[card]");
    });

    it("should preserve non-sensitive text", () => {
      const safeText = "This is a normal planning document.";
      expect(redactText(safeText)).toBe(safeText);
    });
  });

  describe("makePreview", () => {
    it("should truncate long text", () => {
      const longText = "a".repeat(200);
      const result = makePreview(longText, 160);
      expect(result.length).toBe(161); // 160 + ellipsis
      expect(result.endsWith("…")).toBe(true);
    });

    it("should preserve short text", () => {
      const shortText = "Short text";
      const result = makePreview(shortText, 160);
      expect(result).toBe(shortText);
    });

    it("should redact sensitive content in previews", () => {
      const result = makePreview("Email: test@example.com");
      expect(result).toBe("Email: [email]");
    });
  });

  describe("makeTextPreviewFromLines", () => {
    it("should create preview from line range", () => {
      const lines = ["Line 0", "Line 1", "Line 2", "Line 3"];
      const result = makeTextPreviewFromLines(lines, [1, 2]);
      expect(result.lineRange).toEqual([1, 2]);
      expect(result.preview).toContain("Line 1");
      expect(result.preview).toContain("Line 2");
    });
  });

  describe("makeEvidenceDebug", () => {
    it("should create evidence debug from line IDs", () => {
      const lines = ["Evidence line 0", "Evidence line 1", "Evidence line 2"];
      const result = makeEvidenceDebug([0, 2], lines);
      expect(result.lineIds).toEqual([0, 2]);
      expect(result.spans.length).toBe(2);
      expect(result.spans[0].lineIndex).toBe(0);
      expect(result.spans[0].preview).toBe("Evidence line 0");
    });
  });
});

// ============================================
// Verbosity Resolution Tests
// ============================================

describe("Debug Verbosity Resolution", () => {
  const enabledFlags: DebugFeatureFlags = { suggestionDebugEnabled: true };
  const disabledFlags: DebugFeatureFlags = { suggestionDebugEnabled: false };
  const adminUser: DebugUserContext = { isAdmin: true };
  const normalUser: DebugUserContext = { isAdmin: false };
  const devEnv: DebugEnvContext = { isDev: true, allowFullTextDebug: true };
  const prodEnv: DebugEnvContext = { isDev: false, allowFullTextDebug: false };

  it("should return OFF when feature flag is disabled", () => {
    expect(
      resolveDebugVerbosity("REDACTED", disabledFlags, adminUser, devEnv)
    ).toBe("OFF");
  });

  it("should return OFF when user is not admin", () => {
    expect(
      resolveDebugVerbosity("REDACTED", enabledFlags, normalUser, devEnv)
    ).toBe("OFF");
  });

  it("should return REDACTED as default when enabled", () => {
    expect(
      resolveDebugVerbosity(undefined, enabledFlags, adminUser, prodEnv)
    ).toBe("REDACTED");
  });

  it("should allow FULL_TEXT only in dev with explicit flag", () => {
    expect(
      resolveDebugVerbosity("FULL_TEXT", enabledFlags, adminUser, devEnv)
    ).toBe("FULL_TEXT");
  });

  it("should not allow FULL_TEXT in prod", () => {
    expect(
      resolveDebugVerbosity("FULL_TEXT", enabledFlags, adminUser, prodEnv)
    ).toBe("REDACTED");
  });
});

// ============================================
// Persistence Check Tests
// ============================================

describe("Persistence Checks", () => {
  it("shouldPersistDebug returns false for OFF", () => {
    expect(shouldPersistDebug("OFF")).toBe(false);
  });

  it("shouldPersistDebug returns true for REDACTED", () => {
    expect(shouldPersistDebug("REDACTED")).toBe(true);
  });

  it("shouldPersistDebug returns true for FULL_TEXT", () => {
    expect(shouldPersistDebug("FULL_TEXT")).toBe(true);
  });

  it("shouldIncludeDebugInResponse requires admin", () => {
    expect(
      shouldIncludeDebugInResponse("REDACTED", { isAdmin: true })
    ).toBe(true);
    expect(
      shouldIncludeDebugInResponse("REDACTED", { isAdmin: false })
    ).toBe(false);
    expect(
      shouldIncludeDebugInResponse("OFF", { isAdmin: true })
    ).toBe(false);
  });
});

// ============================================
// Payload Size Tests
// ============================================

describe("Payload Size Utilities", () => {
  it("computeJsonByteSize should calculate correctly", () => {
    const obj = { hello: "world" };
    const size = computeJsonByteSize(obj);
    expect(size).toBe(JSON.stringify(obj).length);
  });

  it("exceedsPayloadLimit should detect large payloads", () => {
    const smallObj = { key: "value" };
    const largeObj = { data: "x".repeat(600000) };

    expect(exceedsPayloadLimit(smallObj, 512 * 1024)).toBe(false);
    expect(exceedsPayloadLimit(largeObj, 512 * 1024)).toBe(true);
  });
});

// ============================================
// DebugLedger Tests
// ============================================

describe("DebugLedger", () => {
  beforeEach(() => {
    resetSectionCounter();
    resetSuggestionCounter();
  });

  it("should create a ledger with correct metadata", () => {
    const ledger = new DebugLedger({
      noteId: "test-note",
      noteBody: "Test body",
      verbosity: "REDACTED",
      config: DEFAULT_CONFIG,
      userId: "user-123",
    });

    expect(ledger.isActive()).toBe(true);

    const run = ledger.buildDebugRun();
    expect(run.meta.noteId).toBe("test-note");
    expect(run.meta.generatorVersion).toBe(GENERATOR_VERSION);
    expect(run.meta.verbosity).toBe("REDACTED");
    expect(run.meta.createdByUserId).toBe("user-123");
  });

  it("should track sections", () => {
    const ledger = new DebugLedger({
      noteId: "test",
      noteBody: "Line 1\nLine 2\nLine 3",
      verbosity: "REDACTED",
      config: DEFAULT_CONFIG,
    });

    const section = ledger.createSection({
      sectionId: "section-1",
      headingText: "Test Section",
      lineRange: [0, 2],
      structuralFeatures: {
        lineCount: 3,
        charCount: 20,
        bulletCount: 0,
      },
    });

    expect(section.sectionId).toBe("section-1");
    expect(section.headingTextPreview).toBe("Test Section");
    expect(section.lineRange).toEqual([0, 2]);
  });

  it("should track section drops", () => {
    const ledger = new DebugLedger({
      noteId: "test",
      noteBody: "Test",
      verbosity: "REDACTED",
      config: DEFAULT_CONFIG,
    });

    const section = ledger.createSection({
      sectionId: "section-1",
      lineRange: [0, 0],
      structuralFeatures: { lineCount: 1, charCount: 4, bulletCount: 0 },
    });

    ledger.dropSection(section, DropReason.NOT_ACTIONABLE);

    expect(section.emitted).toBe(false);
    expect(section.dropReason).toBe(DropReason.NOT_ACTIONABLE);
    expect(section.dropStage).toBe(DropStage.ACTIONABILITY);
  });

  it("should build a valid DebugRun", () => {
    const ledger = new DebugLedger({
      noteId: "test",
      noteBody: "Test note body",
      verbosity: "REDACTED",
      config: DEFAULT_CONFIG,
    });

    ledger.createSection({
      sectionId: "section-1",
      headingText: "Test",
      lineRange: [0, 0],
      structuralFeatures: { lineCount: 1, charCount: 14, bulletCount: 0 },
    });

    ledger.finalize([]);

    const run = ledger.buildDebugRun();

    expect(run.meta).toBeDefined();
    expect(run.config).toBeDefined();
    expect(run.noteSummary).toBeDefined();
    expect(run.sections.length).toBe(1);
    expect(run.runtimeStats).toBeDefined();
  });

  it("should return null for OFF verbosity via factory", () => {
    const ledger = createDebugLedger({
      noteId: "test",
      noteBody: "Test",
      verbosity: "OFF",
      config: DEFAULT_CONFIG,
    });

    expect(ledger).toBeNull();
  });
});

// ============================================
// Debug Run Summary Tests
// ============================================

describe("computeDebugRunSummary", () => {
  it("should compute correct summary for zero suggestions", () => {
    const debugRun: DebugRun = {
      meta: {
        noteId: "test",
        runId: "run-1",
        generatorVersion: "test",
        createdAt: new Date().toISOString(),
        verbosity: "REDACTED",
      },
      config: {
        generatorVersion: "test",
        thresholds: {
          actionabilityMinScore: 0.5,
          typeMinScore: 0.5,
          synthesisMinScore: 0.5,
          evidenceMinScore: 0.5,
          validationMinScore: 0.5,
          overallMinScore: 0.65,
        },
        classificationModel: "test",
        typeModel: "test",
        synthesisModel: "test",
        validationModels: { v2: "test", v3: "test" },
        dedupeEnabled: true,
        maxSuggestionsPerNote: 5,
      },
      noteSummary: { lineCount: 10 },
      sections: [
        {
          sectionId: "s1",
          headingTextPreview: "Section 1",
          lineRange: [0, 5],
          structuralFeatures: { lineCount: 5, charCount: 100, bulletCount: 2 },
          intentClassification: {
            topLabel: "plan_change",
            topScore: 0.8,
            scoresByLabel: {},
          },
          typeClassification: {
            topLabel: "project_update",
            topScore: 0.7,
            scoresByLabel: {},
          },
          decisions: {
            isActionable: true,
            intentLabel: "plan_change",
            typeLabel: "project_update",
          },
          synthesisRan: true,
          candidates: [],
          scoreSummary: { overallScore: 0.6 },
          emitted: false,
          dropStage: DropStage.THRESHOLD,
          dropReason: DropReason.SCORE_BELOW_THRESHOLD,
        },
      ],
    };

    const summary = computeDebugRunSummary(debugRun);

    expect(summary.emittedCount).toBe(0);
    expect(summary.totalSections).toBe(1);
    expect(summary.dropStageHistogram[DropStage.THRESHOLD]).toBe(1);
    expect(summary.dropReasonTop.length).toBeGreaterThan(0);
    expect(summary.dropReasonTop[0].reason).toBe(
      DropReason.SCORE_BELOW_THRESHOLD
    );
  });

  it("should NOT include V2 or V3 in NON_BLOCKING_DROP_REASONS", () => {
    expect(NON_BLOCKING_DROP_REASONS.has(DropReason.VALIDATION_V2_TOO_GENERIC)).toBe(false);
    expect(NON_BLOCKING_DROP_REASONS.has(DropReason.VALIDATION_V3_EVIDENCE_TOO_WEAK)).toBe(false);
  });
});

// ============================================
// Debug Generator Integration Tests
// ============================================

describe("generateSuggestionsWithDebug", () => {
  beforeEach(() => {
    resetSectionCounter();
    resetSuggestionCounter();
  });

  it("should return debugRun when verbosity is REDACTED", () => {
    const result = generateSuggestionsWithDebug(
      TEST_NOTE,
      {},
      { enable_debug: true },
      { verbosity: "REDACTED" }
    );

    expect(result.debugRun).toBeDefined();
    expect(result.debugRun!.meta.verbosity).toBe("REDACTED");
    expect(result.debugRun!.sections.length).toBeGreaterThan(0);
  });

  it("should not return debugRun when verbosity is OFF", () => {
    const result = generateSuggestionsWithDebug(
      TEST_NOTE,
      {},
      {},
      { verbosity: "OFF" }
    );

    expect(result.debugRun).toBeUndefined();
    expect(result.suggestions).toBeDefined();
  });

  it("should track all sections including dropped ones", () => {
    const result = generateSuggestionsWithDebug(
      TEST_NOTE,
      {},
      {},
      { verbosity: "REDACTED" }
    );

    const debugRun = result.debugRun!;

    // All sections should be tracked
    expect(debugRun.sections.length).toBeGreaterThan(0);

    // At least some sections should have classification info
    for (const section of debugRun.sections) {
      expect(section.sectionId).toBeDefined();
      expect(section.lineRange).toBeDefined();
      expect(section.structuralFeatures).toBeDefined();
    }
  });

  it("should track candidates and their drop reasons", () => {
    const result = generateSuggestionsWithDebug(
      TEST_NOTE,
      {},
      { enable_debug: true },
      { verbosity: "REDACTED" }
    );

    const debugRun = result.debugRun!;
    const summary = computeDebugRunSummary(debugRun);

    // The debug run should provide useful diagnostics
    expect(summary.totalSections).toBeGreaterThan(0);
  });

  it("should include runtime stats", () => {
    const result = generateSuggestionsWithDebug(
      TEST_NOTE,
      {},
      {},
      { verbosity: "REDACTED" }
    );

    expect(result.debugRun!.runtimeStats).toBeDefined();
    expect(result.debugRun!.runtimeStats!.totalMs).toBeGreaterThanOrEqual(0);
  });

  it("should handle empty notes gracefully", () => {
    const emptyNote: NoteInput = {
      note_id: "empty",
      raw_markdown: "",
    };

    const result = generateSuggestionsWithDebug(
      emptyNote,
      {},
      {},
      { verbosity: "REDACTED" }
    );

    expect(result.suggestions).toHaveLength(0);
    expect(result.debugRun).toBeDefined();
    expect(result.debugRun!.sections).toHaveLength(0);
  });

  it("should produce JSON-serializable debug runs", () => {
    const result = generateSuggestionsWithDebug(
      TEST_NOTE,
      {},
      {},
      { verbosity: "REDACTED" }
    );

    // Should not throw
    const json = JSON.stringify(result.debugRun);
    const parsed = JSON.parse(json);

    expect(parsed.meta.noteId).toBe(TEST_NOTE.note_id);
  });

  it("seeds B-signal candidates in debug pipeline for 'They need bulk-upload by Q3.'", () => {
    // A note with enough body content to pass synthesis validation, plus the target B-signal sentence
    const note: NoteInput = {
      note_id: "bsig-debug-test",
      raw_markdown: [
        "## Roadmap Changes",
        "",
        "We plan to ship the bulk-upload feature in Q2.",
        "- They need bulk-upload by Q3.",
        "- Users want CSV import support.",
        "- This will require dedicated engineering resources.",
      ].join("\n"),
    };

    const result = generateSuggestionsWithDebug(
      note,
      {},
      { enable_debug: true },
      { verbosity: "REDACTED" }
    );

    // At least one candidate must exist in the debug run
    const allCandidates = result.debugRun?.sections.flatMap(s => s.candidates) ?? [];
    expect(allCandidates.length).toBeGreaterThanOrEqual(1);

    // At least one candidate suggestion title must contain "bulk-upload"
    const bulkUploadCandidate = allCandidates.find(c =>
      c.suggestion?.title.toLowerCase().includes("bulk-upload")
    );
    expect(bulkUploadCandidate).toBeDefined();

    // The matching suggestion in the output must have b-signal source metadata
    const bsigSuggestion = result.suggestions.find(s =>
      s.metadata?.source === "b-signal" &&
      s.title.toLowerCase().includes("bulk-upload")
    );
    expect(bsigSuggestion).toBeDefined();
  });
});

// ============================================
// JSON Integrity Tests
// ============================================

describe("JSON Integrity", () => {
  beforeEach(() => {
    resetSectionCounter();
    resetSuggestionCounter();
  });

  it("debug run should have all required fields", () => {
    const result = generateSuggestionsWithDebug(
      TEST_NOTE,
      {},
      {},
      { verbosity: "REDACTED" }
    );

    const debugRun = result.debugRun!;

    // Meta fields
    expect(debugRun.meta.noteId).toBeDefined();
    expect(debugRun.meta.runId).toBeDefined();
    expect(debugRun.meta.generatorVersion).toBeDefined();
    expect(debugRun.meta.createdAt).toBeDefined();
    expect(debugRun.meta.verbosity).toBeDefined();

    // Config
    expect(debugRun.config.thresholds).toBeDefined();

    // Note summary
    expect(debugRun.noteSummary.lineCount).toBeGreaterThan(0);

    // Sections array
    expect(Array.isArray(debugRun.sections)).toBe(true);
  });

  it("sections should have required fields", () => {
    const result = generateSuggestionsWithDebug(
      TEST_NOTE,
      {},
      {},
      { verbosity: "REDACTED" }
    );

    for (const section of result.debugRun!.sections) {
      expect(section.sectionId).toBeDefined();
      expect(section.lineRange).toBeDefined();
      expect(Array.isArray(section.lineRange)).toBe(true);
      expect(section.lineRange.length).toBe(2);
      expect(section.structuralFeatures).toBeDefined();
      expect(section.intentClassification).toBeDefined();
      expect(section.typeClassification).toBeDefined();
      expect(section.decisions).toBeDefined();
      expect(section.scoreSummary).toBeDefined();
      expect(typeof section.emitted).toBe("boolean");
      expect(Array.isArray(section.candidates)).toBe(true);
    }
  });
});
