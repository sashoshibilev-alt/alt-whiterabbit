import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// Clarification state enum values
const clarificationStateValidator = v.union(
  v.literal("none"),
  v.literal("suggested"),
  v.literal("requested"),
  v.literal("answered")
);

// Dismiss reason enum values (updated taxonomy per plan)
const dismissReasonValidator = v.union(
  v.literal("not_relevant"),
  v.literal("incorrect_or_low_quality"),
  v.literal("too_risky_or_disruptive"),
  v.literal("already_done_or_in_progress"),
  v.literal("needs_more_clarification"),
  v.literal("wrong_scope_or_target"),
  v.literal("too_generic"),
  v.literal("other")
);

// Note source enum values
const noteSourceValidator = v.union(
  v.literal("manual"),
  v.literal("granola_manual")
);

// Suggestion status enum values
const suggestionStatusValidator = v.union(
  v.literal("new"),
  v.literal("applied"),
  v.literal("dismissed")
);

// Suggestion event type enum values
const suggestionEventTypeValidator = v.union(
  v.literal("generated"),
  v.literal("viewed"),
  v.literal("shown"),
  v.literal("applied"),
  v.literal("dismissed"),
  v.literal("regenerated"), // v0-correct: Track regeneration events
  v.literal("clarification_requested"),
  v.literal("clarification_answered")
);

// V0 Initiative status enum values
const v0InitiativeStatusValidator = v.union(
  v.literal("draft"),
  v.literal("active"),
  v.literal("done")
);

// ============================================
// NEW: Full Initiative Lifecycle (Event-Sourced)
// ============================================

// Initiative status enum (full lifecycle)
const initiativeStatusValidator = v.union(
  v.literal("draft"),
  v.literal("proposed"),
  v.literal("approved"),
  v.literal("in_progress"),
  v.literal("blocked"),
  v.literal("released"),
  v.literal("completed"),
  v.literal("cancelled"),
  v.literal("archived")
);

// Initiative priority enum
const priorityValidator = v.union(
  v.literal("p0"),
  v.literal("p1"),
  v.literal("p2"),
  v.literal("p3")
);

// Risk level enum
const riskLevelValidator = v.union(
  v.literal("low"),
  v.literal("medium"),
  v.literal("high")
);

// Event origin enum
const eventOriginValidator = v.union(
  v.literal("ui"),
  v.literal("api"),
  v.literal("system"),
  v.literal("import")
);

// Suggestion status enum (extended)
const initiativeSuggestionStatusValidator = v.union(
  v.literal("pending"),
  v.literal("applied"),
  v.literal("dismissed"),
  v.literal("superseded"),
  v.literal("failed")
);

// Suggestion source kind enum
const suggestionSourceKindValidator = v.union(
  v.literal("user"),
  v.literal("system"),
  v.literal("import"),
  v.literal("integration")
);

export default defineSchema({
  // Legacy initiatives table (keeping for backward compatibility)
  initiatives: defineTable({
    name: v.string(),
    owner: v.string(),
    status: v.union(v.literal("planned"), v.literal("in_progress"), v.literal("done")),
    releaseDate: v.union(v.number(), v.null()), // Store as timestamp
    lastUpdated: v.number(), // Store as timestamp
    description: v.string(),
    activityLog: v.array(
      v.object({
        id: v.string(),
        timestamp: v.number(),
        type: v.union(v.literal("comment"), v.literal("update"), v.literal("creation")),
        content: v.string(),
        author: v.string(),
        suggestionId: v.optional(v.string()),
      })
    ),
  }),

  // V0 Initiatives table - simple initiative model for linking applied suggestions
  v0Initiatives: defineTable({
    title: v.string(),
    description: v.string(),
    status: v0InitiativeStatusValidator, // draft, active, done
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_status", ["status"])
    .index("by_createdAt", ["createdAt"]),

  // Notes table - stores meeting notes pasted or uploaded by user
  notes: defineTable({
    title: v.optional(v.string()),
    body: v.string(), // Required - the note content
    source: noteSourceValidator, // manual or granola_manual
    capturedAt: v.number(), // Timestamp when note was captured
    meetingAt: v.optional(v.number()), // Optional timestamp for when meeting occurred
    createdAt: v.number(),
    updatedAt: v.number(),
    // v0-correct: Soft deletion for epistemic hygiene
    deletedAt: v.optional(v.number()), // Timestamp when note was soft-deleted
    isDeleted: v.optional(v.boolean()), // Quick filter for active notes
  })
    .index("by_capturedAt", ["capturedAt"])
    .index("by_createdAt", ["createdAt"])
    .index("by_isDeleted", ["isDeleted"]),

  // Suggestions table - AI-generated suggestions linked to notes
  suggestions: defineTable({
    noteId: v.id("notes"), // FK to notes
    content: v.string(), // The suggestion text (legacy; kept for backward compatibility)
    // Structured suggestion fields (v2 engine output)
    suggestionType: v.optional(v.union(v.literal("idea"), v.literal("project_update"), v.literal("bug"), v.literal("risk"))),
    title: v.optional(v.string()),
    body: v.optional(v.string()),
    evidencePreview: v.optional(v.string()),
    sourceSectionId: v.optional(v.string()),
    suggestionKey: v.optional(v.string()),
    status: suggestionStatusValidator, // new, applied, dismissed
    createdAt: v.number(),
    appliedAt: v.optional(v.number()),
    dismissedAt: v.optional(v.number()),
    dismissReason: v.optional(dismissReasonValidator),
    dismissReasonOther: v.optional(v.string()),
    modelVersion: v.optional(v.string()), // Which LLM/prompt was used
    initiativeId: v.optional(v.id("v0Initiatives")), // FK to initiative when applied
    // v0-correct: Regeneration support
    regenerated: v.optional(v.boolean()), // Whether this suggestion was generated via regenerate
    noteVersionAtCreation: v.optional(v.number()), // Note's updatedAt when suggestion was created
    // v0-correct: Suggestion fingerprint for deduplication
    fingerprint: v.optional(v.string()), // Hash of core content for detecting duplicates
    // v0-correct: Invalidation tracking for epistemic hygiene
    invalidatedByNoteDeletion: v.optional(v.boolean()), // True if source note was deleted
    invalidatedAt: v.optional(v.number()), // Timestamp of invalidation
    // Clarification support
    clarificationState: v.optional(clarificationStateValidator), // none, suggested, requested, answered
    clarificationPrompt: v.optional(v.string()), // Question shown to user
    clarificationAnswerId: v.optional(v.id("suggestionEvents")), // Link to clarification response event
    clarifiedFromSuggestionId: v.optional(v.id("suggestions")), // Link to original if regenerated after clarification
    // Analytics fields
    modelConfidenceScore: v.optional(v.number()), // Model confidence in [0,1]
    ruleOrPromptId: v.optional(v.string()), // Identifier for rule/prompt used
    suggestionFamily: v.optional(v.string()), // Category/type for analytics
    estimatedDiffSize: v.optional(v.string()), // small, medium, large
  })
    .index("by_noteId", ["noteId"])
    .index("by_status", ["status"])
    .index("by_createdAt", ["createdAt"])
    .index("by_initiativeId", ["initiativeId"])
    .index("by_fingerprint", ["noteId", "fingerprint"])
    .index("by_invalidated", ["invalidatedByNoteDeletion"])
    .index("by_clarificationState", ["clarificationState"]),

  // Suggestion events table - primary for observability
  suggestionEvents: defineTable({
    noteId: v.id("notes"),
    suggestionId: v.id("suggestions"),
    eventType: suggestionEventTypeValidator, // generated, viewed, shown, applied, dismissed, clarification_requested, clarification_answered
    createdAt: v.number(),
    timeToEventSeconds: v.optional(v.number()), // Time since first shown/viewed event
    selfReportedTimeSavedMinutes: v.optional(v.number()), // Only for applied events
    dismissReason: v.optional(dismissReasonValidator), // Only for dismissed events
    dismissReasonOther: v.optional(v.string()),
    uiSurface: v.optional(v.string()), // e.g. "note_detail_main", "pr_review", "editor_inline"
    // v0-correct: Invalidation tracking for epistemic hygiene
    invalidatedByNoteDeletion: v.optional(v.boolean()), // True if source note was deleted
    excludeFromMetrics: v.optional(v.boolean()), // True if should be excluded from default analytics
    // Enhanced analytics fields (common envelope)
    userIdHash: v.optional(v.string()), // Salted hash for user tracking
    teamId: v.optional(v.string()),
    suggestionFamily: v.optional(v.string()), // Category for analytics
    ruleOrPromptId: v.optional(v.string()), // Rule/prompt used
    clarificationState: v.optional(v.string()), // State at event time
    // Per-event specific fields
    timeToApplyMs: v.optional(v.number()), // For applied events
    timeToDismissMs: v.optional(v.number()), // For dismissed events
    timeToClarificationMs: v.optional(v.number()), // For clarification_requested events
    timeToAnswerMs: v.optional(v.number()), // For clarification_answered events
    partialApply: v.optional(v.boolean()), // For applied events
    rank: v.optional(v.number()), // Position in list for viewed events
  })
    .index("by_noteId", ["noteId"])
    .index("by_suggestionId", ["suggestionId"])
    .index("by_eventType", ["eventType"])
    .index("by_createdAt", ["createdAt"])
    .index("by_excludeFromMetrics", ["excludeFromMetrics"])
    .index("by_teamId_eventType", ["teamId", "eventType"]),

  // Suggestion debug runs table - stores debug reports for admin analysis
  suggestionDebugRuns: defineTable({
    noteId: v.id("notes"), // FK to notes
    runId: v.string(), // UUID for the debug run
    createdAt: v.number(), // Timestamp
    createdByUserId: v.optional(v.string()), // User who triggered the run
    generatorVersion: v.string(), // Version of the suggestion engine
    verbosity: v.string(), // "OFF" | "REDACTED" | "FULL_TEXT"
    configSnapshotJson: v.any(), // ConfigSnapshot as JSON
    payloadJson: v.any(), // Full DebugRun as JSON
    sizeBytes: v.number(), // Size of payloadJson for limits
    expiresAt: v.number(), // TTL timestamp (created_at + 14 days)
  })
    .index("by_noteId_createdAt", ["noteId", "createdAt"])
    .index("by_expiresAt", ["expiresAt"])
    .index("by_runId", ["runId"]),

  // ============================================
  // NEW: Event-Sourced Initiative System
  // ============================================

  // Initiative table - materialized view (current state)
  newInitiatives: defineTable({
    // Identity & ownership
    slug: v.string(), // Unique human-readable identifier
    title: v.string(),
    description: v.string(), // Rich text/markdown
    status: initiativeStatusValidator,
    ownerUserId: v.optional(v.string()),
    sponsorUserId: v.optional(v.string()),
    teamId: v.optional(v.string()),
    
    // Planning & scoping
    goal: v.optional(v.string()),
    successMetrics: v.optional(v.string()), // JSON or text
    scope: v.optional(v.string()),
    priority: v.optional(priorityValidator),
    riskLevel: v.optional(riskLevelValidator),
    tags: v.optional(v.array(v.string())),
    
    // Lifecycle timestamps
    createdAt: v.number(),
    updatedAt: v.number(),
    proposedAt: v.optional(v.number()),
    approvedAt: v.optional(v.number()),
    startedAt: v.optional(v.number()),
    blockedAt: v.optional(v.number()),
    releasedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    cancelledAt: v.optional(v.number()),
    archivedAt: v.optional(v.number()),
    
    // Release dates
    releaseTargetDate: v.optional(v.number()), // Single target (timestamp for date)
    releaseWindowStart: v.optional(v.number()),
    releaseWindowEnd: v.optional(v.number()),
    releaseNotes: v.optional(v.string()),
    
    // Versioning & determinism
    currentVersion: v.number(), // Derived from event count
    eventStreamVersion: v.number(), // Last applied event sequence
    schemaVersion: v.number(), // For state evolution
    
    // Integration-ready metadata
    businessUnit: v.optional(v.string()),
    productArea: v.optional(v.string()),
    quarter: v.optional(v.string()),
    integrationHints: v.optional(v.any()), // JSON object for future use
  })
    .index("by_slug", ["slug"])
    .index("by_status", ["status"])
    .index("by_createdAt", ["createdAt"])
    .index("by_updatedAt", ["updatedAt"])
    .index("by_ownerUserId", ["ownerUserId"])
    .index("by_quarter", ["quarter"])
    .index("by_releaseTargetDate", ["releaseTargetDate"]),

  // Initiative event table - append-only authoritative log
  initiativeEvents: defineTable({
    initiativeId: v.optional(v.id("newInitiatives")), // Nullable for cross-initiative events
    sequence: v.number(), // Per-initiative monotonic sequence
    globalSequence: v.number(), // System-wide ordering
    type: v.string(), // Event type (InitiativeCreated, InitiativeFieldUpdated, etc.)
    payload: v.any(), // JSON event payload
    schemaVersion: v.number(), // Event payload schema version
    occurredAt: v.number(), // Server timestamp
    
    // Causality & provenance
    actorUserId: v.optional(v.string()),
    origin: eventOriginValidator,
    commandId: v.string(), // UUID for idempotency
    correlationId: v.string(), // UUID for tracing workflows
    suggestionId: v.optional(v.id("initiativeSuggestions")), // Link to suggestion if applicable
  })
    .index("by_initiativeId_sequence", ["initiativeId", "sequence"])
    .index("by_globalSequence", ["globalSequence"])
    .index("by_commandId", ["commandId"])
    .index("by_correlationId", ["correlationId"])
    .index("by_suggestionId", ["suggestionId"])
    .index("by_occurredAt", ["occurredAt"]),

  // Initiative version table - materialized snapshots
  initiativeVersions: defineTable({
    initiativeId: v.id("newInitiatives"),
    version: v.number(), // Matches sequence of last applied event
    state: v.any(), // Full canonical JSON representation
    createdAt: v.number(),
    createdFromEventId: v.id("initiativeEvents"),
  })
    .index("by_initiativeId_version", ["initiativeId", "version"])
    .index("by_createdAt", ["createdAt"]),

  // Initiative comment table
  initiativeComments: defineTable({
    initiativeId: v.id("newInitiatives"),
    authorUserId: v.string(),
    body: v.string(), // Rich text/markdown
    createdAt: v.number(),
    updatedAt: v.optional(v.number()),
    deletedAt: v.optional(v.number()), // Soft delete
    parentCommentId: v.optional(v.id("initiativeComments")), // For threading
    isSystem: v.boolean(), // System-generated comments
    resolvedAt: v.optional(v.number()),
    resolvedByUserId: v.optional(v.string()),
  })
    .index("by_initiativeId_createdAt", ["initiativeId", "createdAt"])
    .index("by_authorUserId", ["authorUserId"])
    .index("by_parentCommentId", ["parentCommentId"])
    .index("by_deletedAt", ["deletedAt"]),

  // Initiative suggestion table (deterministic patch-based)
  initiativeSuggestions: defineTable({
    initiativeId: v.id("newInitiatives"),
    createdByUserId: v.string(),
    status: initiativeSuggestionStatusValidator,
    createdAt: v.number(),
    appliedAt: v.optional(v.number()),
    dismissedAt: v.optional(v.number()),
    dismissedReason: v.optional(v.string()),
    appliedByUserId: v.optional(v.string()),
    kind: v.string(), // Suggestion kind/category
    targetInitiativeVersion: v.number(), // Version suggestion was created against
    resultingInitiativeVersion: v.optional(v.number()), // Version after application
    inputSchemaVersion: v.number(), // For payload evolution
    payload: v.any(), // JSON patch operations
    
    // Integration metadata
    sourceKind: suggestionSourceKindValidator,
    sourceReference: v.optional(v.string()), // Opaque external ID
  })
    .index("by_initiativeId_status", ["initiativeId", "status"])
    .index("by_status", ["status"])
    .index("by_createdAt", ["createdAt"])
    .index("by_appliedAt", ["appliedAt"]),

  // Initiative external link table (generic integration support)
  initiativeExternalLinks: defineTable({
    initiativeId: v.id("newInitiatives"),
    externalSystem: v.string(), // e.g., "issue_tracker", "roadmap_tool"
    externalResourceType: v.string(), // e.g., "project", "epic"
    externalResourceId: v.string(), // Opaque external ID
    externalUrl: v.optional(v.string()), // Human-friendly link
    lastSyncState: v.optional(v.any()), // JSON snapshot of external state
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_initiativeId", ["initiativeId"])
    .index("by_externalSystem_resourceId", ["externalSystem", "externalResourceId"])
    .index("by_updatedAt", ["updatedAt"]),

  // ============================================
  // Shipit Behavioral Learning & Reporting
  // ============================================

  // Daily suggestion metrics table - aggregated facts per day/dimension
  dailySuggestionMetrics: defineTable({
    dateUtc: v.string(), // Date in YYYY-MM-DD format
    teamId: v.optional(v.string()), // Team/workspace ID or "global"
    surface: v.optional(v.string()), // UI surface (pr_review, editor_inline, etc.)
    suggestionFamily: v.optional(v.string()), // Suggestion type/category
    // Core metrics
    suggestionsGenerated: v.number(),
    suggestionsApplied: v.number(),
    suggestionsDismissed: v.number(),
    clarificationRequests: v.number(),
    // Computed rates
    applyRate: v.number(),
    dismissRate: v.number(),
    clarificationRate: v.number(),
    nhi: v.number(), // Net Helpfulness Index
    // Metadata
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_dateUtc", ["dateUtc"])
    .index("by_dateUtc_teamId", ["dateUtc", "teamId"])
    .index("by_dateUtc_surface", ["dateUtc", "surface"])
    .index("by_dateUtc_family", ["dateUtc", "suggestionFamily"]),

  // Rule quality scores - config-level weights for learning without retraining
  ruleQualityScores: defineTable({
    ruleOrPromptId: v.string(), // Identifier for rule/prompt
    suggestionFamily: v.optional(v.string()), // Category
    // Aggregate metrics (rolling window)
    applyRate: v.number(),
    dismissRate: v.number(),
    clarificationRate: v.number(),
    nhi: v.number(), // Net Helpfulness Index
    qualityScore: v.number(), // Derived score for ranking/thresholding
    // Counts for confidence
    totalGenerated: v.number(),
    totalApplied: v.number(),
    totalDismissed: v.number(),
    // Metadata
    lastComputedAt: v.number(),
    windowStartDate: v.string(), // Start of rolling window (YYYY-MM-DD)
    windowEndDate: v.string(), // End of rolling window
  })
    .index("by_ruleOrPromptId", ["ruleOrPromptId"])
    .index("by_qualityScore", ["qualityScore"])
    .index("by_lastComputedAt", ["lastComputedAt"]),

  // ============================================
  // Suggestion Decisions - Stable Apply/Dismiss Persistence
  // ============================================

  // Suggestion decisions table - persists user actions keyed by (noteId, suggestionKey)
  // This allows dismissed/applied suggestions to remain hidden across regenerations
  suggestionDecisions: defineTable({
    noteId: v.id("notes"),
    suggestionKey: v.string(), // Stable key computed from suggestion content
    status: v.union(
      v.literal("dismissed"),
      v.literal("applied"),
      v.literal("needs_clarification")
    ), // User decision
    initiativeId: v.optional(v.id("v0Initiatives")), // FK when applied
    appliedMode: v.optional(v.union(v.literal("existing"), v.literal("created"))), // How it was applied
    dismissedAt: v.optional(v.number()), // Timestamp when dismissed
    appliedAt: v.optional(v.number()), // Timestamp when applied
    appliedToInitiativeId: v.optional(v.id("v0Initiatives")), // Deprecated: use initiativeId
    appliedToType: v.optional(v.union(v.literal("existing"), v.literal("new"))), // Deprecated: use appliedMode
    updatedAt: v.number(), // Timestamp of decision
  })
    .index("by_noteId", ["noteId"])
    .index("by_noteId_suggestionKey", ["noteId", "suggestionKey"])
    .index("by_initiativeId", ["initiativeId"]),
});
