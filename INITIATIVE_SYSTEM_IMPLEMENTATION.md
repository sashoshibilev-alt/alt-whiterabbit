# Initiative System Implementation

## Overview

This document describes the implementation of the internal, event-sourced initiative execution system in Shipit. The system is designed to be:

- **Deterministic**: All state changes are derived from events via pure functions
- **Auditable**: Complete history of all changes with provenance
- **Replayable**: State can be reconstructed from events at any point in time
- **Integration-ready**: Generic metadata structures for future external tool integrations
- **No external dependencies**: All execution happens internally (no Linear, Jira, etc. concepts in core logic)

## Architecture

### Event Sourcing Foundation

The system uses event sourcing as its core pattern:

1. **Events are the source of truth**: All state changes are represented as immutable events
2. **Materialized views for performance**: Current state is maintained in `newInitiatives` table for fast reads
3. **Pure fold function**: State is deterministically rebuilt by folding events: `state = fold(events)`
4. **Time-travel queries**: Historical state can be reconstructed by folding events up to any point

### Key Concepts

#### 1. Initiative Lifecycle

Initiatives progress through a state machine with validated transitions:

```
draft → proposed → approved → in_progress → released → completed → archived
                      ↓             ↓            ↓
                  cancelled → archived
                      ↓
                   blocked → in_progress
```

Each state transition creates an `InitiativeStatusChanged` event with provenance tracking.

#### 2. Event Types

- `InitiativeCreated` - Initial creation
- `InitiativeFieldUpdated` - Any field change (with old/new values)
- `InitiativeStatusChanged` - Status transitions
- `ReleaseDateChanged` - Release date modifications
- `SuggestionCreated` - Suggestion proposal
- `SuggestionApplied` - Successful suggestion application
- `SuggestionDismissed` - Suggestion rejection
- `SuggestionFailed` - Suggestion validation failure
- `SuggestionUndoApplied` - Suggestion undo
- `InitiativeCommentAdded/Edited/Deleted` - Comment lifecycle

#### 3. Deterministic Suggestions

Suggestions use JSON Patch-inspired operations with conflict detection:

```typescript
{
  "operations": [
    {
      "op": "replace",
      "path": "/status",
      "from": "approved",      // Expected current value
      "value": "in_progress"   // New value
    }
  ]
}
```

**Conflict Detection**: Before applying, the system verifies that `current(path) == from` for all operations. If any mismatch is detected, the suggestion fails atomically with no state changes.

#### 4. Undo via Compensating Events

Undo works by creating new events that reverse previous changes:

- Original event: `{field: "status", oldValue: "draft", newValue: "proposed"}`
- Undo event: `{field: "status", oldValue: "proposed", newValue: "draft", undoOfEventId: "..."}`

The original event is never modified or deleted, preserving complete audit history.

## Database Schema

### Core Tables

#### `newInitiatives` (Materialized View)
Current state of all initiatives. Indexes on slug, status, dates, owner, quarter.

#### `initiativeEvents` (Append-Only Log)
All events with sequence numbers, provenance, and payloads. Indexes on:
- `by_initiativeId_sequence` - Event stream per initiative
- `by_globalSequence` - System-wide ordering
- `by_commandId` - Idempotency checks
- `by_suggestionId` - Track suggestion impact

#### `initiativeVersions` (Snapshots)
Optional materialized snapshots at key versions for fast diffs and recovery.

#### `initiativeComments`
Comments with threading, soft-deletion, and resolution tracking.

#### `initiativeSuggestions`
Patch-based suggestions with lifecycle tracking.

#### `initiativeExternalLinks`
Generic external system links (not tool-specific).

## API Reference

### Initiative Commands

```typescript
// Create initiative
await newInitiatives.create({
  slug: "improve-ci-speed",
  title: "Improve CI Speed",
  description: "Reduce CI time from 20m to 5m",
  ownerUserId: "user-123"
});

// Update fields
await newInitiatives.updateFields({
  id: initiativeId,
  fields: {
    priority: "p1",
    releaseTargetDate: Date.now() + 30*24*60*60*1000
  }
});

// Change status
await newInitiatives.changeStatus({
  id: initiativeId,
  newStatus: "in_progress",
  reason: "Starting work on Q1 goals"
});
```

### Suggestion Commands

```typescript
// Create suggestion
const suggestionId = await initiativeSuggestions.create({
  initiativeId: initiativeId,
  createdByUserId: "user-123",
  kind: "update_release_date",
  operations: [
    {
      op: "replace",
      path: "/releaseTargetDate",
      from: oldDate,
      value: newDate
    }
  ]
});

// Apply suggestion (with conflict detection)
await initiativeSuggestions.apply({
  id: suggestionId,
  appliedByUserId: "user-123"
});

// Dismiss suggestion
await initiativeSuggestions.dismiss({
  id: suggestionId,
  reason: "Already completed this work",
  dismissedByUserId: "user-123"
});
```

### Audit & Undo Commands

```typescript
// Undo an event
await initiativeAudit.undoEvent({
  eventId: eventId,
  actorUserId: "user-123"
});

// Undo a suggestion (reverses all its changes)
await initiativeAudit.undoSuggestion({
  suggestionId: suggestionId,
  actorUserId: "user-123"
});

// Get audit trail
const events = await initiativeAudit.getAuditTrail({
  initiativeId: initiativeId,
  fromTimestamp: Date.now() - 7*24*60*60*1000, // Last 7 days
  actorUserId: "user-123" // Optional filter
});

// Get field history
const history = await initiativeAudit.getFieldHistory({
  initiativeId: initiativeId,
  field: "status"
});

// Get version diff
const diff = await initiativeAudit.getVersionDiff({
  initiativeId: initiativeId,
  fromVersion: 5,
  toVersion: 10
});
```

### Time-Travel Queries

```typescript
// Read initiative at specific version
const historicalState = await newInitiatives.get({
  id: initiativeId,
  asOfVersion: 5
});

// Read initiative at specific time
const stateAtTime = await initiativeAudit.getStateAtTime({
  initiativeId: initiativeId,
  timestamp: Date.now() - 30*24*60*60*1000 // 30 days ago
});
```

### External Links

```typescript
// Create external link (generic, not tool-specific)
await initiativeExternalLinks.create({
  initiativeId: initiativeId,
  externalSystem: "issue_tracker",
  externalResourceType: "project",
  externalResourceId: "PROJ-123",
  externalUrl: "https://example.com/projects/PROJ-123",
  lastSyncState: { status: "in_progress", title: "..." }
});

// Find initiative by external resource
const result = await initiativeExternalLinks.findByExternalResource({
  externalSystem: "issue_tracker",
  externalResourceId: "PROJ-123"
});
```

## Implementation Files

### Core Modules

1. **`convex/schema.ts`** - Database schema definitions with all enums and validators
2. **`convex/initiativeEventStore.ts`** - Event types, fold function, state machine, JSON Pointer utilities
3. **`convex/newInitiatives.ts`** - Initiative commands, queries, event appending, materialization
4. **`convex/initiativeComments.ts`** - Comment CRUD operations
5. **`convex/initiativeSuggestions.ts`** - Suggestion creation, validation, application with conflict detection
6. **`convex/initiativeAudit.ts`** - Undo commands, audit queries, history APIs
7. **`convex/initiativeExternalLinks.ts`** - External system linkage (integration-ready)

### Key Algorithms

#### Event Fold (State Reconstruction)

```typescript
function foldEvents(events: InitiativeEvent[]): InitiativeState | null {
  let state: InitiativeState | null = null;
  
  for (const event of events) {
    state = applyEvent(state, event);
  }
  
  return state;
}
```

#### Suggestion Application (Deterministic)

1. Load current state by folding all events
2. For each operation in suggestion payload:
   - Get current value at path
   - Verify `currentValue == operation.from`
   - If mismatch, collect conflict and continue
3. If any conflicts, mark suggestion as failed (no state changes)
4. If all validations pass:
   - Create events for each operation
   - Append events atomically
   - Update materialized view
   - Mark suggestion as applied

#### Undo Algorithm

1. Load event(s) to undo
2. For each event (in reverse order if undoing multiple):
   - Create compensating event with swapped old/new values
   - Tag with `undoOfEventId` for audit trail
3. Append compensating events
4. Reload and materialize state

## Design Principles

### 1. No External Concepts in Core Logic

The domain model uses generic terms:
- **NOT** "Linear project", "Jira epic", "GitHub milestone"
- **YES** "Initiative", "external resource", "external system"

Integration-specific logic lives in separate modules that map between generic domain and tool-specific APIs.

### 2. Determinism & Replayability

- State is a pure function of events
- No wall-clock time in business logic (timestamps are data fields only)
- Given the same events, fold always produces identical state
- Schema versioning supports evolution without breaking replays

### 3. Full Auditability

- Every change has an event with actor, timestamp, origin
- Soft deletes (no hard deletes in normal flows)
- Compensating events for undo (not deletion)
- Complete provenance chain via `commandId`, `correlationId`, `suggestionId`

### 4. Conflict-Free Suggestions

- Suggestions include expected current values (`from` in patch operations)
- Application fails deterministically if values don't match
- No race conditions or lost updates
- Users re-create suggestions against new version if conflicts occur

## Testing Strategy

### Unit Tests

- Event fold function with various event sequences
- State machine transition validation
- JSON Pointer path operations
- Suggestion operation validation

### Integration Tests

- Full suggestion lifecycle (create → apply → verify state)
- Conflict detection scenarios
- Undo and audit trail verification
- Time-travel query correctness

### Property-Based Tests

- Idempotency: Applying same command twice produces same result
- Commutativity: Independent suggestions commute
- Reversibility: Undo brings state back to previous version

## Future Enhancements

### Potential Additions

1. **Snapshots for Performance**: Periodic snapshots in `initiativeVersions` to avoid replaying thousands of events
2. **Event Projections**: Additional read models optimized for specific queries
3. **Saga Pattern**: Multi-initiative workflows with compensating transactions
4. **Event Subscriptions**: Real-time notifications for event streams
5. **Integration Services**: Tool-specific adapters that consume events and sync to external systems

### Migration Path

To add external integrations:

1. Create integration-specific module (e.g., `linearIntegration.ts`)
2. Map initiative events to Linear API calls
3. Use `initiativeExternalLinks` to track Linear project IDs
4. Store sync state in `lastSyncState` field
5. **Core domain logic remains unchanged**

## Performance Considerations

- **Read performance**: Materialized views provide O(1) current state access
- **Write performance**: Event append is O(1), materialization is O(fields)
- **Query performance**: Indexes on common query patterns
- **Scaling**: Event streams can be sharded by initiative ID
- **Archival**: Old events can be archived to cold storage after snapshots

## Security & Permissions

Current implementation uses simple `actorUserId` tracking. Production would add:

- Role-based access control (RBAC)
- Initiative-level permissions (owner, contributors, viewers)
- Field-level permissions (e.g., only sponsors can approve)
- Audit log access controls
- Data retention policies

## Monitoring & Observability

Recommended metrics:

- Event append rate and latency
- Fold operation performance
- Suggestion success/failure/conflict rates
- Undo frequency
- Materialized view drift detection
- External sync lag (when integrations added)

---

## Getting Started

### 1. Deploy Schema

The schema is defined in `convex/schema.ts`. Convex will automatically apply it.

### 2. Create Your First Initiative

```typescript
const id = await newInitiatives.create({
  slug: "pilot-initiative",
  title: "Pilot Initiative",
  description: "Testing the new system",
  ownerUserId: "your-user-id"
});
```

### 3. Apply a Suggestion

```typescript
// Create suggestion
const suggestionId = await initiativeSuggestions.create({
  initiativeId: id,
  createdByUserId: "your-user-id",
  kind: "update_priority",
  operations: [{
    op: "replace",
    path: "/priority",
    from: null,
    value: "p1"
  }]
});

// Apply it
await initiativeSuggestions.apply({
  id: suggestionId,
  appliedByUserId: "your-user-id"
});
```

### 4. Explore History

```typescript
// Get all events
const events = await newInitiatives.getEvents({ id });

// Get field history
const priorityHistory = await initiativeAudit.getFieldHistory({
  initiativeId: id,
  field: "priority"
});
```

---

## Summary

This implementation provides a production-ready, event-sourced initiative system with:

✅ Complete audit trail  
✅ Deterministic suggestion application  
✅ Conflict detection  
✅ Undo capability  
✅ Time-travel queries  
✅ Integration-ready architecture  
✅ No external tool dependencies in core logic  

The system is ready for internal use and can be extended with external integrations without modifying core domain logic.
