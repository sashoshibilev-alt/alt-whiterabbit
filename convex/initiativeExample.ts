/**
 * Initiative System Examples
 * 
 * This file demonstrates common usage patterns for the initiative system.
 * These are example code snippets, not executable tests.
 */

// ============================================
// Example 1: Create and Evolve an Initiative
// ============================================

async function example1_CreateAndEvolve(ctx: any) {
  // Create a new initiative
  const initiativeId = await ctx.runMutation("newInitiatives:create", {
    slug: "reduce-ci-time",
    title: "Reduce CI Time",
    description: "Improve CI pipeline to run in under 5 minutes",
    ownerUserId: "user-alice",
    actorUserId: "user-alice",
  });
  
  // Update some fields
  await ctx.runMutation("newInitiatives:updateFields", {
    id: initiativeId,
    fields: {
      priority: "p1",
      riskLevel: "medium",
      goal: "Reduce average CI time from 20m to 5m by Q2",
      quarter: "2026Q2",
    },
    actorUserId: "user-alice",
  });
  
  // Transition through lifecycle
  await ctx.runMutation("newInitiatives:changeStatus", {
    id: initiativeId,
    newStatus: "proposed",
    reason: "Ready for review",
    actorUserId: "user-alice",
  });
  
  await ctx.runMutation("newInitiatives:changeStatus", {
    id: initiativeId,
    newStatus: "approved",
    reason: "Approved by tech lead",
    actorUserId: "user-bob",
  });
  
  await ctx.runMutation("newInitiatives:changeStatus", {
    id: initiativeId,
    newStatus: "in_progress",
    actorUserId: "user-alice",
  });
  
  // Set release date
  const targetDate = new Date("2026-06-30").getTime();
  await ctx.runMutation("newInitiatives:updateReleaseDate", {
    id: initiativeId,
    dateType: "target",
    newDate: targetDate,
    actorUserId: "user-alice",
  });
  
  return initiativeId;
}

// ============================================
// Example 2: Create and Apply a Suggestion
// ============================================

async function example2_ApplySuggestion(ctx: any, initiativeId: string) {
  // Get current state to build suggestion
  const initiative = await ctx.runQuery("newInitiatives:get", { id: initiativeId });
  
  // Create a suggestion to change release date
  const newDate = new Date("2026-07-15").getTime();
  const suggestionId = await ctx.runMutation("initiativeSuggestions:create", {
    initiativeId: initiativeId,
    createdByUserId: "user-charlie",
    kind: "update_release_date",
    operations: [
      {
        op: "replace",
        path: "/releaseTargetDate",
        from: initiative.releaseTargetDate,
        value: newDate,
      },
    ],
    sourceKind: "user",
  });
  
  // Apply the suggestion
  try {
    const result = await ctx.runMutation("initiativeSuggestions:apply", {
      id: suggestionId,
      appliedByUserId: "user-alice",
    });
    
    console.log("Suggestion applied successfully:", result);
  } catch (error) {
    console.log("Suggestion failed (conflict detected):", error.message);
  }
  
  return suggestionId;
}

// ============================================
// Example 3: Handle Suggestion Conflict
// ============================================

async function example3_ConflictDetection(ctx: any, initiativeId: string) {
  // User A creates a suggestion based on version 5
  const initiative = await ctx.runQuery("newInitiatives:get", { id: initiativeId });
  
  const suggestionA = await ctx.runMutation("initiativeSuggestions:create", {
    initiativeId: initiativeId,
    createdByUserId: "user-alice",
    kind: "update_priority",
    operations: [
      {
        op: "replace",
        path: "/priority",
        from: "p1", // Expects current priority to be p1
        value: "p0",
      },
    ],
  });
  
  // Meanwhile, User B updates priority directly
  await ctx.runMutation("newInitiatives:updateFields", {
    id: initiativeId,
    fields: { priority: "p2" },
    actorUserId: "user-bob",
  });
  
  // Now User A's suggestion will fail because priority is no longer p1
  try {
    await ctx.runMutation("initiativeSuggestions:apply", {
      id: suggestionA,
      appliedByUserId: "user-alice",
    });
  } catch (error) {
    console.log("Expected conflict:", error.message);
    // Suggestion status is now "failed"
    
    // User A would need to create a new suggestion based on current state
    const currentInitiative = await ctx.runQuery("newInitiatives:get", { id: initiativeId });
    
    const suggestionA2 = await ctx.runMutation("initiativeSuggestions:create", {
      initiativeId: initiativeId,
      createdByUserId: "user-alice",
      kind: "update_priority",
      operations: [
        {
          op: "replace",
          path: "/priority",
          from: "p2", // Now expects p2 (current value)
          value: "p0",
        },
      ],
    });
    
    // This should succeed
    await ctx.runMutation("initiativeSuggestions:apply", {
      id: suggestionA2,
      appliedByUserId: "user-alice",
    });
  }
}

// ============================================
// Example 4: Undo Operations
// ============================================

async function example4_UndoOperations(ctx: any, initiativeId: string, suggestionId: string) {
  // Get suggestion impact before undo
  const impact = await ctx.runQuery("initiativeAudit:getSuggestionImpact", {
    suggestionId: suggestionId,
  });
  
  console.log("Suggestion changed:", impact.changes);
  
  // Undo the entire suggestion
  await ctx.runMutation("initiativeAudit:undoSuggestion", {
    suggestionId: suggestionId,
    actorUserId: "user-alice",
  });
  
  // Verify initiative returned to previous state
  const initiative = await ctx.runQuery("newInitiatives:get", { id: initiativeId });
  console.log("After undo:", initiative);
  
  // Alternatively, undo a specific event
  const events = await ctx.runQuery("newInitiatives:getEvents", { id: initiativeId });
  const lastEvent = events[events.length - 1];
  
  await ctx.runMutation("initiativeAudit:undoEvent", {
    eventId: lastEvent._id,
    actorUserId: "user-alice",
  });
}

// ============================================
// Example 5: Audit Trail Queries
// ============================================

async function example5_AuditQueries(ctx: any, initiativeId: string) {
  // Get full audit trail
  const allEvents = await ctx.runQuery("initiativeAudit:getAuditTrail", {
    initiativeId: initiativeId,
  });
  
  console.log(`Total events: ${allEvents.length}`);
  
  // Get events from last 7 days
  const recentEvents = await ctx.runQuery("initiativeAudit:getAuditTrail", {
    initiativeId: initiativeId,
    fromTimestamp: Date.now() - 7 * 24 * 60 * 60 * 1000,
  });
  
  // Get field history for status
  const statusHistory = await ctx.runQuery("initiativeAudit:getFieldHistory", {
    initiativeId: initiativeId,
    field: "status",
  });
  
  console.log("Status transitions:");
  for (const entry of statusHistory) {
    console.log(`  ${entry.oldValue} → ${entry.newValue} at ${new Date(entry.timestamp).toISOString()}`);
  }
  
  // Get who changed what
  const attribution = await ctx.runQuery("initiativeAudit:getWhoChangedWhat", {
    initiativeId: initiativeId,
  });
  
  console.log("Changes by user:");
  for (const [userId, stats] of Object.entries(attribution)) {
    console.log(`  ${userId}: ${stats.totalChanges} total changes`);
    console.log(`    Fields: ${Object.keys(stats.fieldChanges).join(", ")}`);
  }
}

// ============================================
// Example 6: Time-Travel Queries
// ============================================

async function example6_TimeTravelQueries(ctx: any, initiativeId: string) {
  // Get current state
  const current = await ctx.runQuery("newInitiatives:get", { id: initiativeId });
  console.log("Current version:", current.currentVersion);
  
  // Get state at version 5
  const atVersion5 = await ctx.runQuery("newInitiatives:get", {
    id: initiativeId,
    asOfVersion: 5,
  });
  console.log("At version 5:", atVersion5);
  
  // Get state 30 days ago
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const historical = await ctx.runQuery("initiativeAudit:getStateAtTime", {
    initiativeId: initiativeId,
    timestamp: thirtyDaysAgo,
  });
  
  console.log("30 days ago:", historical);
  
  // Get diff between versions
  const diff = await ctx.runQuery("initiativeAudit:getVersionDiff", {
    initiativeId: initiativeId,
    fromVersion: 5,
    toVersion: current.currentVersion,
  });
  
  console.log("Changes from v5 to current:");
  for (const [field, change] of Object.entries(diff.diff)) {
    console.log(`  ${field}: ${change.from} → ${change.to}`);
  }
}

// ============================================
// Example 7: Comments and Collaboration
// ============================================

async function example7_Comments(ctx: any, initiativeId: string) {
  // Add a comment
  const commentId = await ctx.runMutation("initiativeComments:addComment", {
    initiativeId: initiativeId,
    authorUserId: "user-alice",
    body: "We should prioritize the caching optimization first",
  });
  
  // Reply to comment
  const replyId = await ctx.runMutation("initiativeComments:addComment", {
    initiativeId: initiativeId,
    authorUserId: "user-bob",
    body: "Agreed, that will give us the biggest performance win",
    parentCommentId: commentId,
  });
  
  // Get all comments
  const comments = await ctx.runQuery("initiativeComments:listByInitiative", {
    initiativeId: initiativeId,
  });
  
  // Resolve comment
  await ctx.runMutation("initiativeComments:resolveComment", {
    id: commentId,
    resolverUserId: "user-alice",
  });
  
  // System comments are automatically created when suggestions are applied
  // These have isSystem: true
}

// ============================================
// Example 8: External Links (Integration-Ready)
// ============================================

async function example8_ExternalLinks(ctx: any, initiativeId: string) {
  // Link to external issue tracker
  const linkId = await ctx.runMutation("initiativeExternalLinks:create", {
    initiativeId: initiativeId,
    externalSystem: "issue_tracker",
    externalResourceType: "project",
    externalResourceId: "PROJ-123",
    externalUrl: "https://issues.example.com/PROJ-123",
    lastSyncState: {
      status: "In Progress",
      title: "Reduce CI Time",
      updatedAt: Date.now(),
    },
  });
  
  // Update sync state (called by integration service)
  await ctx.runMutation("initiativeExternalLinks:update", {
    id: linkId,
    lastSyncState: {
      status: "In Review",
      title: "Reduce CI Time",
      updatedAt: Date.now(),
    },
  });
  
  // Find initiative by external resource ID
  const result = await ctx.runQuery("initiativeExternalLinks:findByExternalResource", {
    externalSystem: "issue_tracker",
    externalResourceId: "PROJ-123",
  });
  
  console.log("Found initiative:", result.initiative);
  console.log("Last sync state:", result.link.lastSyncState);
}

// ============================================
// Example 9: Batch Operations with Suggestions
// ============================================

async function example9_BatchUpdates(ctx: any, initiativeId: string) {
  // Create a suggestion that updates multiple fields atomically
  const suggestionId = await ctx.runMutation("initiativeSuggestions:create", {
    initiativeId: initiativeId,
    createdByUserId: "user-alice",
    kind: "quarterly_planning",
    operations: [
      {
        op: "replace",
        path: "/priority",
        from: "p1",
        value: "p0",
      },
      {
        op: "replace",
        path: "/quarter",
        from: "2026Q2",
        value: "2026Q1",
      },
      {
        op: "replace",
        path: "/releaseTargetDate",
        from: null,
        value: new Date("2026-03-31").getTime(),
      },
    ],
  });
  
  // All operations are applied atomically or none are applied
  // If any conflict, entire suggestion fails
  await ctx.runMutation("initiativeSuggestions:apply", {
    id: suggestionId,
    appliedByUserId: "user-alice",
  });
}

// ============================================
// Example 10: Complete Lifecycle Demo
// ============================================

async function example10_CompleteDemoLifecycle(ctx: any) {
  console.log("=== Initiative System Demo ===\n");
  
  // 1. Create initiative
  console.log("1. Creating initiative...");
  const id = await example1_CreateAndEvolve(ctx);
  console.log(`   Created: ${id}\n`);
  
  // 2. Apply suggestion
  console.log("2. Applying suggestion...");
  const suggestionId = await example2_ApplySuggestion(ctx, id);
  console.log(`   Suggestion: ${suggestionId}\n`);
  
  // 3. Add comments
  console.log("3. Adding comments...");
  await example7_Comments(ctx, id);
  console.log("   Comments added\n");
  
  // 4. External link
  console.log("4. Creating external link...");
  await example8_ExternalLinks(ctx, id);
  console.log("   External link created\n");
  
  // 5. Audit trail
  console.log("5. Querying audit trail...");
  await example5_AuditQueries(ctx, id);
  
  // 6. Time travel
  console.log("\n6. Time-travel queries...");
  await example6_TimeTravelQueries(ctx, id);
  
  // 7. Undo
  console.log("\n7. Undoing suggestion...");
  await example4_UndoOperations(ctx, id, suggestionId);
  console.log("   Undo complete\n");
  
  console.log("=== Demo Complete ===");
}

export {
  example1_CreateAndEvolve,
  example2_ApplySuggestion,
  example3_ConflictDetection,
  example4_UndoOperations,
  example5_AuditQueries,
  example6_TimeTravelQueries,
  example7_Comments,
  example8_ExternalLinks,
  example9_BatchUpdates,
  example10_CompleteDemoLifecycle,
};
