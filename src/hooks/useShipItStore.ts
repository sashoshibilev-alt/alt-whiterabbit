import { create } from 'zustand';
import { Suggestion, Initiative, Meeting, Connection, DismissReason, ActivityLogEntry } from '@/types';
import { mockSuggestions, mockInitiatives, mockMeetings, mockConnections } from '@/data/mockData';

interface ShipItState {
  suggestions: Suggestion[];
  initiatives: Initiative[];
  meetings: Meeting[];
  connections: Connection[];

  // Actions
  applySuggestion: (suggestionId: string, userId: string) => void;
  dismissSuggestion: (suggestionId: string, userId: string, reason: DismissReason, reasonText?: string) => void;
  editSuggestion: (suggestionId: string, editedChange: Suggestion['proposedChange']) => void;
  linkSuggestion: (suggestionId: string, initiativeId: string) => void;
  toggleConnection: (connectionId: string) => void;
  createInitiativeFromSuggestion: (suggestionId: string, name: string, description: string, owner: string, userId: string) => void;
}

/**
 * Enrich mock suggestions with computed suggestion context
 * Mirrors the engine output format (from convex/notes.ts getWithComputedSuggestions)
 */
function enrichSuggestionsWithContext(suggestions: Suggestion[]): Suggestion[] {
  const contextMap: Record<string, Suggestion['suggestion']> = {
    'sug-1': {
      title: 'Timeline change: Mobile App Redesign',
      body: 'Mobile redesign release pushed to mid-March because new navigation patterns require more testing than expected.',
      evidencePreview: [
        'We need to push the mobile redesign release to mid-March.',
        'The new navigation patterns require more testing than expected.'
      ],
      sourceSectionId: 'meet-1-section-1',
      sourceHeading: 'Mobile App Sprint Planning'
    },
    'sug-2': {
      title: 'Progress update: Mobile App Redesign',
      body: 'Gesture system more complex than anticipated. Additional testing required for navigation patterns to ensure smooth user experience.',
      evidencePreview: [
        'I agree, the gesture system is more complex than we anticipated.',
        'March 15th seems realistic.'
      ],
      sourceSectionId: 'meet-1-section-2',
      sourceHeading: 'Mobile App Sprint Planning'
    },
    'sug-3': {
      title: 'Progress update: Dashboard Analytics V2',
      body: 'Beta users providing positive feedback on analytics dashboard. Custom reporting feature particularly well-received.',
      evidencePreview: [
        'The analytics dashboard is getting great feedback from beta users.',
        'They love the custom reporting feature.'
      ],
      sourceSectionId: 'meet-2-section-1',
      sourceHeading: 'Product Strategy Review'
    },
    'sug-4': {
      title: 'Timeline change: SSO Integration',
      body: 'SSO should be prioritized sooner because three enterprise prospects mentioned it this week, indicating strong market demand.',
      evidencePreview: [
        'We should consider adding SSO sooner.',
        'Three enterprise prospects mentioned it this week.'
      ],
      sourceSectionId: 'meet-2-section-2',
      sourceHeading: 'Product Strategy Review'
    },
  };

  return suggestions.map(suggestion => {
    if (contextMap[suggestion.id]) {
      return {
        ...suggestion,
        suggestion: contextMap[suggestion.id],
      };
    }
    return suggestion;
  });
}

export const useShipItStore = create<ShipItState>((set, get) => ({
  suggestions: enrichSuggestionsWithContext(mockSuggestions),
  initiatives: mockInitiatives,
  meetings: mockMeetings,
  connections: mockConnections,

  applySuggestion: (suggestionId, userId) => {
    const { suggestions, initiatives, meetings } = get();
    const suggestion = suggestions.find(s => s.id === suggestionId);
    
    if (!suggestion || !suggestion.targetInitiativeId) return;
    
    const meeting = meetings.find(m => m.id === suggestion.meetingId);
    const initiative = initiatives.find(i => i.id === suggestion.targetInitiativeId);
    
    if (!initiative || !meeting) return;

    const now = new Date();
    const changeToApply = suggestion.editedChange || suggestion.proposedChange;
    
    // Create activity log entry
    const logEntry: ActivityLogEntry = {
      id: `log-${Date.now()}`,
      timestamp: now,
      type: 'comment',
      content: `Update from ${meeting.title} (${meeting.date.toLocaleDateString()}): ${
        changeToApply.commentText || 
        `${changeToApply.field} changed from "${changeToApply.before}" to "${changeToApply.after}"` ||
        changeToApply.backlogTitle
      }. Evidence: "${suggestion.evidenceQuote}"`,
      author: userId,
      suggestionId: suggestion.id
    };

    // Update initiative
    const updatedInitiatives = initiatives.map(i => {
      if (i.id !== suggestion.targetInitiativeId) return i;
      
      const updates: Partial<Initiative> = {
        lastUpdated: now,
        activityLog: [...i.activityLog, logEntry]
      };

      // Apply specific changes
      if (suggestion.changeType === 'timeline_change' && changeToApply.after) {
        updates.releaseDate = new Date(changeToApply.after);
      }

      return { ...i, ...updates };
    });

    // Update suggestion
    const updatedSuggestions = suggestions.map(s => {
      if (s.id !== suggestionId) return s;
      return {
        ...s,
        status: 'applied' as const,
        appliedAt: now,
        appliedBy: userId
      };
    });

    set({ suggestions: updatedSuggestions, initiatives: updatedInitiatives });
  },

  dismissSuggestion: (suggestionId, userId, reason, reasonText) => {
    const { suggestions } = get();
    const now = new Date();

    const updatedSuggestions = suggestions.map(s => {
      if (s.id !== suggestionId) return s;
      return {
        ...s,
        status: 'dismissed' as const,
        dismissedAt: now,
        dismissedBy: userId,
        dismissReason: reason,
        dismissReasonText: reasonText
      };
    });

    set({ suggestions: updatedSuggestions });
  },

  editSuggestion: (suggestionId, editedChange) => {
    const { suggestions } = get();

    const updatedSuggestions = suggestions.map(s => {
      if (s.id !== suggestionId) return s;
      return {
        ...s,
        isEdited: true,
        originalChange: s.proposedChange,
        editedChange
      };
    });

    set({ suggestions: updatedSuggestions });
  },

  linkSuggestion: (suggestionId, initiativeId) => {
    const { suggestions, initiatives } = get();
    const initiative = initiatives.find(i => i.id === initiativeId);

    const updatedSuggestions = suggestions.map(s => {
      if (s.id !== suggestionId) return s;
      return {
        ...s,
        targetInitiativeId: initiativeId,
        matchingHint: initiative ? `Manually linked to "${initiative.name}"` : undefined
      };
    });

    set({ suggestions: updatedSuggestions });
  },

  toggleConnection: (connectionId) => {
    const { connections } = get();

    const updatedConnections = connections.map(c => {
      if (c.id !== connectionId) return c;
      return { ...c, isConnected: !c.isConnected };
    });

    set({ connections: updatedConnections });
  },

  createInitiativeFromSuggestion: (suggestionId, name, description, owner, userId) => {
    const { suggestions, initiatives } = get();
    const suggestion = suggestions.find(s => s.id === suggestionId);
    
    if (!suggestion || suggestion.changeType !== 'new_idea') return;

    const now = new Date();
    const newInitiativeId = `init-${Date.now()}`;
    
    // Create the new initiative
    const newInitiative: Initiative = {
      id: newInitiativeId,
      name,
      owner,
      status: 'planned',
      releaseDate: null,
      lastUpdated: now,
      description,
      activityLog: [{
        id: `log-${Date.now()}`,
        timestamp: now,
        type: 'creation',
        content: `Initiative created from meeting suggestion. Evidence: "${suggestion.evidenceQuote}"`,
        author: userId,
        suggestionId: suggestion.id
      }]
    };

    // Update suggestion to link to new initiative and mark as applied
    const updatedSuggestions = suggestions.map(s => {
      if (s.id !== suggestionId) return s;
      return {
        ...s,
        targetInitiativeId: newInitiativeId,
        status: 'applied' as const,
        appliedAt: now,
        appliedBy: userId
      };
    });

    set({ 
      initiatives: [...initiatives, newInitiative],
      suggestions: updatedSuggestions 
    });
  }
}));
