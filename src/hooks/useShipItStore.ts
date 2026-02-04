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

export const useShipItStore = create<ShipItState>((set, get) => ({
  suggestions: mockSuggestions,
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
