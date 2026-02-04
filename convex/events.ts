import { query } from "./_generated/server";
import { v } from "convex/values";

// Query to get all events for a suggestion
export const listBySuggestion = query({
  args: { suggestionId: v.id("suggestions") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("suggestionEvents")
      .withIndex("by_suggestionId", (q) => q.eq("suggestionId", args.suggestionId))
      .collect();
  },
});

// Query to get recent events (for raw events debug view)
export const listRecent = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 50;
    return await ctx.db
      .query("suggestionEvents")
      .order("desc")
      .take(limit);
  },
});

// Query to get report data for a date range
export const getReportData = query({
  args: {
    startDate: v.number(),
    endDate: v.number(),
  },
  handler: async (ctx, args) => {
    // Get all notes in date range
    const allNotes = await ctx.db.query("notes").collect();
    const notes = allNotes.filter(
      (n) => n.createdAt >= args.startDate && n.createdAt <= args.endDate
    );
    
    // Get all suggestions for those notes
    const noteIds = new Set(notes.map((n) => n._id));
    const allSuggestions = await ctx.db.query("suggestions").collect();
    const suggestions = allSuggestions.filter((s) => noteIds.has(s.noteId));
    
    // Get all events for those notes
    const allEvents = await ctx.db.query("suggestionEvents").collect();
    const events = allEvents.filter((e) => noteIds.has(e.noteId));
    
    // Calculate metrics
    const notesCreated = notes.length;
    const suggestionsGenerated = suggestions.length;
    
    const shownEvents = events.filter((e) => e.eventType === "shown");
    const appliedEvents = events.filter((e) => e.eventType === "applied");
    const dismissedEvents = events.filter((e) => e.eventType === "dismissed");
    
    const suggestionsShown = shownEvents.length;
    const suggestionsApplied = appliedEvents.length;
    const suggestionsDismissed = dismissedEvents.length;
    
    const applyRate = suggestionsShown > 0 
      ? Math.round((suggestionsApplied / suggestionsShown) * 100) 
      : 0;
    
    // Dismiss reason distribution
    const dismissReasonCounts: Record<string, number> = {};
    for (const event of dismissedEvents) {
      const reason = event.dismissReason || "unknown";
      dismissReasonCounts[reason] = (dismissReasonCounts[reason] || 0) + 1;
    }
    
    // Time-based insights
    const appliedWithTime = appliedEvents.filter((e) => e.timeToEventSeconds !== undefined);
    const avgTimeToApply = appliedWithTime.length > 0
      ? Math.round(appliedWithTime.reduce((sum, e) => sum + (e.timeToEventSeconds || 0), 0) / appliedWithTime.length)
      : null;
    
    const appliedWithTimeSaved = appliedEvents.filter((e) => e.selfReportedTimeSavedMinutes !== undefined);
    const avgTimeSaved = appliedWithTimeSaved.length > 0
      ? Math.round(appliedWithTimeSaved.reduce((sum, e) => sum + (e.selfReportedTimeSavedMinutes || 0), 0) / appliedWithTimeSaved.length)
      : null;
    
    // Per-note breakdown
    const noteBreakdown = notes.map((note) => {
      const noteSuggestions = suggestions.filter((s) => s.noteId === note._id);
      const noteEvents = events.filter((e) => e.noteId === note._id);
      
      const shown = noteEvents.filter((e) => e.eventType === "shown").length;
      const applied = noteEvents.filter((e) => e.eventType === "applied").length;
      const dismissed = noteEvents.filter((e) => e.eventType === "dismissed").length;
      
      return {
        noteId: note._id,
        title: note.title || note.body.slice(0, 50) + (note.body.length > 50 ? "..." : ""),
        createdAt: note.createdAt,
        totalSuggestions: noteSuggestions.length,
        shown,
        applied,
        dismissed,
        applyRate: shown > 0 ? Math.round((applied / shown) * 100) : 0,
      };
    });
    
    // Initiative metrics
    const appliedSuggestions = suggestions.filter((s) => s.status === "applied");
    const appliedWithInitiative = appliedSuggestions.filter((s) => s.initiativeId !== undefined);
    const appliedToInitiativeRate = appliedSuggestions.length > 0
      ? Math.round((appliedWithInitiative.length / appliedSuggestions.length) * 100)
      : 0;
    
    // Get all initiatives to calculate avg suggestions per initiative
    const allInitiatives = await ctx.db.query("v0Initiatives").collect();
    const initiativesWithSuggestions = allInitiatives.filter((i) => {
      return suggestions.some((s) => s.initiativeId === i._id);
    });
    
    // Count suggestions per initiative (only for initiatives that have suggestions in this period)
    const suggestionsPerInitiative: number[] = [];
    for (const initiative of initiativesWithSuggestions) {
      const count = suggestions.filter((s) => s.initiativeId === initiative._id).length;
      suggestionsPerInitiative.push(count);
    }
    
    const avgSuggestionsPerInitiative = suggestionsPerInitiative.length > 0
      ? Math.round((suggestionsPerInitiative.reduce((a, b) => a + b, 0) / suggestionsPerInitiative.length) * 10) / 10
      : null;
    
    return {
      // Top-level metrics
      notesCreated,
      suggestionsGenerated,
      suggestionsShown,
      suggestionsApplied,
      suggestionsDismissed,
      applyRate,
      
      // Dismiss reason distribution
      dismissReasonDistribution: dismissReasonCounts,
      
      // Time-based insights
      avgTimeToApplySeconds: avgTimeToApply,
      avgTimeSavedMinutes: avgTimeSaved,
      timeSavedResponseCount: appliedWithTimeSaved.length,
      
      // Per-note breakdown
      noteBreakdown,
      
      // Initiative metrics
      appliedToInitiativeRate,
      appliedWithInitiativeCount: appliedWithInitiative.length,
      totalAppliedCount: appliedSuggestions.length,
      avgSuggestionsPerInitiative,
      initiativesWithSuggestionsCount: initiativesWithSuggestions.length,
    };
  },
});
