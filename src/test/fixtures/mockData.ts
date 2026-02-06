import { Meeting, Initiative, Suggestion, Connection, ActivityLogEntry } from '@/types';

// Helper to create dates relative to now
const daysAgo = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
};

export const mockInitiatives: Initiative[] = [
  {
    id: 'init-1',
    name: 'Mobile App Redesign',
    owner: 'Alex Chen',
    status: 'in_progress',
    releaseDate: new Date('2025-03-15'),
    lastUpdated: daysAgo(2),
    description: 'Complete overhaul of the mobile experience with new navigation patterns and improved performance.',
    activityLog: [
      { id: 'log-1', timestamp: daysAgo(5), type: 'creation', content: 'Initiative created', author: 'Alex Chen' },
      { id: 'log-2', timestamp: daysAgo(3), type: 'comment', content: 'Design review completed, moving to development', author: 'Sarah Kim' },
    ]
  },
  {
    id: 'init-2',
    name: 'API Rate Limiting',
    owner: 'Jordan Lee',
    status: 'planned',
    releaseDate: new Date('2025-02-28'),
    lastUpdated: daysAgo(7),
    description: 'Implement tiered rate limiting for API endpoints to improve system stability.',
    activityLog: [
      { id: 'log-3', timestamp: daysAgo(7), type: 'creation', content: 'Initiative created', author: 'Jordan Lee' },
    ]
  },
  {
    id: 'init-3',
    name: 'Dashboard Analytics V2',
    owner: 'Morgan Taylor',
    status: 'in_progress',
    releaseDate: new Date('2025-02-14'),
    lastUpdated: daysAgo(1),
    description: 'Enhanced analytics dashboard with real-time metrics and custom reporting.',
    activityLog: [
      { id: 'log-4', timestamp: daysAgo(14), type: 'creation', content: 'Initiative created', author: 'Morgan Taylor' },
      { id: 'log-5', timestamp: daysAgo(10), type: 'update', content: 'Scope expanded to include export functionality', author: 'Morgan Taylor' },
      { id: 'log-6', timestamp: daysAgo(1), type: 'comment', content: 'Beta testing started with 5 enterprise accounts', author: 'Alex Chen' },
    ]
  },
  {
    id: 'init-4',
    name: 'SSO Integration',
    owner: 'Casey Rivera',
    status: 'planned',
    releaseDate: new Date('2025-04-01'),
    lastUpdated: daysAgo(12),
    description: 'Support for SAML and OIDC single sign-on for enterprise customers.',
    activityLog: [
      { id: 'log-7', timestamp: daysAgo(12), type: 'creation', content: 'Initiative created based on customer feedback', author: 'Casey Rivera' },
    ]
  },
  {
    id: 'init-5',
    name: 'Performance Optimization',
    owner: 'Riley Chen',
    status: 'done',
    releaseDate: new Date('2025-01-10'),
    lastUpdated: daysAgo(10),
    description: 'Reduce page load times by 40% through code splitting and caching improvements.',
    activityLog: [
      { id: 'log-8', timestamp: daysAgo(30), type: 'creation', content: 'Initiative created', author: 'Riley Chen' },
      { id: 'log-9', timestamp: daysAgo(15), type: 'update', content: 'Achieved 45% improvement in initial load time', author: 'Riley Chen' },
      { id: 'log-10', timestamp: daysAgo(10), type: 'comment', content: 'Shipped to production, monitoring metrics', author: 'Riley Chen' },
    ]
  },
  {
    id: 'init-6',
    name: 'Notification System Overhaul',
    owner: 'Taylor Park',
    status: 'in_progress',
    releaseDate: new Date('2025-03-01'),
    lastUpdated: daysAgo(4),
    description: 'Rebuild notification infrastructure with better delivery guarantees and user preferences.',
    activityLog: [
      { id: 'log-11', timestamp: daysAgo(20), type: 'creation', content: 'Initiative created', author: 'Taylor Park' },
      { id: 'log-12', timestamp: daysAgo(4), type: 'comment', content: 'Email provider migration completed', author: 'Taylor Park' },
    ]
  },
];

export const mockMeetings: Meeting[] = [
  {
    id: 'meet-1',
    title: 'Mobile App Sprint Planning',
    date: daysAgo(1),
    duration: 45,
    attendeesCount: 6,
    source: 'granola',
    transcriptExcerpt: 'Alex: "We need to push the mobile redesign release to mid-March. The new navigation patterns require more testing than expected." Sarah: "I agree, the gesture system is more complex than we anticipated. March 15th seems realistic." Jordan: "What about the API work we\'re depending on?" Alex: "That should still be on track for late February."'
  },
  {
    id: 'meet-2',
    title: 'Product Strategy Review',
    date: daysAgo(3),
    duration: 60,
    attendeesCount: 8,
    source: 'gemini_notes',
    transcriptExcerpt: 'Morgan: "The analytics dashboard is getting great feedback from beta users. They love the custom reporting feature." Casey: "We should consider adding SSO sooner. Three enterprise prospects mentioned it this week." Riley: "The performance work is done, we hit our targets. Maybe we can reprioritize some resources."'
  },
  {
    id: 'meet-3',
    title: 'Engineering Sync',
    date: daysAgo(5),
    duration: 30,
    attendeesCount: 5,
    source: 'granola',
    transcriptExcerpt: 'Jordan: "I think we should consider a new approach to caching. Redis might not be enough for our scale." Taylor: "The notification system migration is going well. We should be done by end of February." Sarah: "There\'s an interesting pattern we could use for the mobile app that would reduce complexity."'
  },
  {
    id: 'meet-4',
    title: 'Customer Feedback Deep Dive',
    date: daysAgo(7),
    duration: 75,
    attendeesCount: 4,
    source: 'granola',
    transcriptExcerpt: 'Casey: "Customers are asking for webhook support for the analytics dashboard." Morgan: "That\'s interesting, we hadn\'t considered that. It could be a quick win." Alex: "Let\'s add it to the backlog for Q2 consideration."'
  },
  {
    id: 'meet-5',
    title: 'API Team Standup',
    date: daysAgo(8),
    duration: 15,
    attendeesCount: 4,
    source: 'gemini_notes',
    transcriptExcerpt: 'Jordan: "Rate limiting implementation is on track. We might actually finish a week early." Riley: "That would help with the mobile app dependencies." Jordan: "Yeah, I\'m thinking February 20th instead of the 28th."'
  },
  {
    id: 'meet-6',
    title: 'Design Review',
    date: daysAgo(10),
    duration: 45,
    attendeesCount: 5,
    source: 'granola',
    transcriptExcerpt: 'Sarah: "The notification preferences UI is ready for development. I\'ve simplified the options based on user research." Taylor: "This looks great. The toggle groups are much cleaner." Morgan: "Can we apply similar patterns to the analytics settings?"'
  },
  {
    id: 'meet-7',
    title: 'Weekly Leadership Sync',
    date: daysAgo(12),
    duration: 30,
    attendeesCount: 6,
    source: 'gemini_notes',
    transcriptExcerpt: 'Alex: "We need to discuss resource allocation for Q2. The SSO project might need more engineering support." Casey: "I\'d recommend moving it up to March if possible. The enterprise pipeline is strong." Morgan: "That might conflict with the analytics V2 timeline though."'
  },
  {
    id: 'meet-8',
    title: 'Technical Architecture Review',
    date: daysAgo(15),
    duration: 90,
    attendeesCount: 7,
    source: 'granola',
    transcriptExcerpt: 'Riley: "We should think about a unified events system that could support both analytics and notifications." Jordan: "That\'s a bigger project, but it would solve a lot of problems." Taylor: "I like the idea. Maybe we can prototype it during the next hack week."'
  },
  {
    id: 'meet-9',
    title: 'Sprint Retrospective',
    date: daysAgo(18),
    duration: 45,
    attendeesCount: 8,
    source: 'granola',
    transcriptExcerpt: 'Morgan: "The analytics dashboard is almost feature complete. Just need to finish the export functionality." Sarah: "Mobile team is making good progress despite the complexity." Alex: "Let\'s make sure we document the lessons learned from the performance project."'
  },
  {
    id: 'meet-10',
    title: 'Roadmap Planning Q1',
    date: daysAgo(25),
    duration: 120,
    attendeesCount: 10,
    source: 'gemini_notes',
    transcriptExcerpt: 'Casey: "SSO is the top request from enterprise. We should prioritize it." Alex: "The mobile redesign is our flagship project for Q1. We can\'t delay it." Jordan: "API improvements need to land first or everything else gets blocked." Morgan: "What about the analytics dashboard? Beta users are waiting."'
  },
];

export const mockSuggestions: Suggestion[] = [
  // Meeting 1 suggestions - Mobile App Sprint Planning
  {
    id: 'sug-1',
    meetingId: 'meet-1',
    title: 'Timeline change: Mobile App Redesign',
    changeType: 'timeline_change',
    confidence: 'high',
    status: 'pending',
    targetInitiativeId: 'init-1',
    proposedChange: {
      field: 'Release date',
      before: 'March 1, 2025',
      after: 'March 15, 2025'
    },
    evidenceQuote: 'We need to push the mobile redesign release to mid-March. The new navigation patterns require more testing than expected.',
    speaker: { name: 'Alex Chen', role: 'PM' },
    speakerAttributionConfidence: 'high',
    matchingHint: 'Direct mention of "mobile redesign" matches initiative name',
    createdAt: daysAgo(1),
    isNonOwnerUpdate: false,
    hasConflict: false
  },
  {
    id: 'sug-2',
    meetingId: 'meet-1',
    title: 'Progress update: Mobile App Redesign',
    changeType: 'progress_update',
    confidence: 'high',
    status: 'pending',
    targetInitiativeId: 'init-1',
    proposedChange: {
      commentText: 'Gesture system implementation is more complex than anticipated. Additional testing required for navigation patterns.'
    },
    evidenceQuote: 'I agree, the gesture system is more complex than we anticipated.',
    speaker: { name: 'Sarah Kim', role: 'Engineer' },
    speakerAttributionConfidence: 'high',
    matchingHint: 'Context from mobile app discussion',
    createdAt: daysAgo(1),
    isNonOwnerUpdate: true,
    hasConflict: false
  },

  // Meeting 2 suggestions - Product Strategy Review
  {
    id: 'sug-3',
    meetingId: 'meet-2',
    title: 'Progress update: Dashboard Analytics V2',
    changeType: 'progress_update',
    confidence: 'high',
    status: 'pending',
    targetInitiativeId: 'init-3',
    proposedChange: {
      commentText: 'Beta users are providing positive feedback. Custom reporting feature is well-received.'
    },
    evidenceQuote: 'The analytics dashboard is getting great feedback from beta users. They love the custom reporting feature.',
    speaker: { name: 'Morgan Taylor', role: 'PM' },
    speakerAttributionConfidence: 'high',
    matchingHint: 'Direct mention of "analytics dashboard"',
    createdAt: daysAgo(3),
    isNonOwnerUpdate: false,
    hasConflict: false
  },
  {
    id: 'sug-4',
    meetingId: 'meet-2',
    title: 'Timeline change: SSO Integration',
    changeType: 'timeline_change',
    confidence: 'medium',
    status: 'pending',
    targetInitiativeId: 'init-4',
    proposedChange: {
      field: 'Release date',
      before: 'April 1, 2025',
      after: 'March 15, 2025'
    },
    evidenceQuote: 'We should consider adding SSO sooner. Three enterprise prospects mentioned it this week.',
    speaker: { name: 'Casey Rivera', role: 'PM' },
    speakerAttributionConfidence: 'high',
    matchingHint: 'Direct mention of "SSO"',
    createdAt: daysAgo(3),
    isNonOwnerUpdate: false,
    hasConflict: true
  },

  // Meeting 3 suggestions - Engineering Sync
  {
    id: 'sug-5',
    meetingId: 'meet-3',
    title: 'New idea: Redis Alternative Evaluation',
    changeType: 'new_idea',
    confidence: 'low',
    status: 'pending',
    targetInitiativeId: null,
    proposedChange: {
      backlogTitle: 'Evaluate Redis alternatives for caching',
      backlogDescription: 'Research and evaluate alternative caching solutions that can handle increased scale requirements.'
    },
    evidenceQuote: 'I think we should consider a new approach to caching. Redis might not be enough for our scale.',
    speaker: { name: 'Jordan Lee', role: 'Engineer' },
    speakerAttributionConfidence: 'medium',
    createdAt: daysAgo(5),
    isNonOwnerUpdate: false,
    hasConflict: false
  },
  {
    id: 'sug-6',
    meetingId: 'meet-3',
    title: 'Timeline change: Notification System',
    changeType: 'timeline_change',
    confidence: 'medium',
    status: 'pending',
    targetInitiativeId: 'init-6',
    proposedChange: {
      field: 'Release date',
      before: 'March 1, 2025',
      after: 'February 28, 2025'
    },
    evidenceQuote: 'The notification system migration is going well. We should be done by end of February.',
    speaker: { name: 'Taylor Park', role: 'Engineer' },
    speakerAttributionConfidence: 'high',
    matchingHint: 'Direct mention of "notification system"',
    createdAt: daysAgo(5),
    isNonOwnerUpdate: false,
    hasConflict: false
  },

  // Meeting 4 suggestions - Customer Feedback Deep Dive
  {
    id: 'sug-7',
    meetingId: 'meet-4',
    title: 'New idea: Webhook Support for Analytics',
    changeType: 'new_idea',
    confidence: 'medium',
    status: 'pending',
    targetInitiativeId: null,
    proposedChange: {
      backlogTitle: 'Add webhook support to Analytics Dashboard',
      backlogDescription: 'Enable customers to receive analytics events via webhooks for integration with external systems.'
    },
    evidenceQuote: 'Customers are asking for webhook support for the analytics dashboard.',
    speaker: { name: 'Casey Rivera', role: 'PM' },
    speakerAttributionConfidence: 'high',
    createdAt: daysAgo(7),
    isNonOwnerUpdate: false,
    hasConflict: false
  },

  // Meeting 5 suggestions - API Team Standup
  {
    id: 'sug-8',
    meetingId: 'meet-5',
    title: 'Timeline change: API Rate Limiting',
    changeType: 'timeline_change',
    confidence: 'high',
    status: 'pending',
    targetInitiativeId: 'init-2',
    proposedChange: {
      field: 'Release date',
      before: 'February 28, 2025',
      after: 'February 20, 2025'
    },
    evidenceQuote: 'Rate limiting implementation is on track. We might actually finish a week early.',
    speaker: { name: 'Jordan Lee', role: 'Engineer' },
    speakerAttributionConfidence: 'high',
    matchingHint: 'Direct mention of "rate limiting"',
    createdAt: daysAgo(8),
    isNonOwnerUpdate: false,
    hasConflict: false
  },

  // Meeting 6 suggestions - Design Review
  {
    id: 'sug-9',
    meetingId: 'meet-6',
    title: 'Progress update: Notification System',
    changeType: 'progress_update',
    confidence: 'high',
    status: 'applied',
    targetInitiativeId: 'init-6',
    proposedChange: {
      commentText: 'Notification preferences UI is ready for development. Simplified options based on user research.'
    },
    evidenceQuote: 'The notification preferences UI is ready for development. I\'ve simplified the options based on user research.',
    speaker: { name: 'Sarah Kim', role: 'Designer' },
    speakerAttributionConfidence: 'high',
    matchingHint: 'Direct mention of "notification preferences"',
    createdAt: daysAgo(10),
    appliedAt: daysAgo(9),
    appliedBy: 'Alex Chen',
    isNonOwnerUpdate: true,
    hasConflict: false
  },

  // Meeting 7 suggestions - Weekly Leadership Sync
  {
    id: 'sug-10',
    meetingId: 'meet-7',
    title: 'Timeline change: SSO Integration',
    changeType: 'timeline_change',
    confidence: 'medium',
    status: 'pending',
    targetInitiativeId: 'init-4',
    proposedChange: {
      field: 'Release date',
      before: 'April 1, 2025',
      after: 'March 1, 2025'
    },
    evidenceQuote: 'I\'d recommend moving it up to March if possible. The enterprise pipeline is strong.',
    speaker: { name: 'Casey Rivera', role: 'PM' },
    speakerAttributionConfidence: 'high',
    matchingHint: 'Context from SSO discussion',
    createdAt: daysAgo(12),
    isNonOwnerUpdate: false,
    hasConflict: true
  },

  // Meeting 8 suggestions - Technical Architecture Review
  {
    id: 'sug-11',
    meetingId: 'meet-8',
    title: 'New idea: Unified Events System',
    changeType: 'new_idea',
    confidence: 'low',
    status: 'pending',
    targetInitiativeId: null,
    proposedChange: {
      backlogTitle: 'Unified Events System Architecture',
      backlogDescription: 'Design and prototype a unified events system that can support both analytics tracking and notification delivery.'
    },
    evidenceQuote: 'We should think about a unified events system that could support both analytics and notifications.',
    speaker: { name: 'Riley Chen', role: 'Engineer' },
    speakerAttributionConfidence: 'medium',
    createdAt: daysAgo(15),
    isNonOwnerUpdate: false,
    hasConflict: false
  },

  // Meeting 9 suggestions - Sprint Retrospective
  {
    id: 'sug-12',
    meetingId: 'meet-9',
    title: 'Progress update: Dashboard Analytics V2',
    changeType: 'progress_update',
    confidence: 'high',
    status: 'dismissed',
    targetInitiativeId: 'init-3',
    proposedChange: {
      commentText: 'Dashboard is almost feature complete. Export functionality remaining.'
    },
    evidenceQuote: 'The analytics dashboard is almost feature complete. Just need to finish the export functionality.',
    speaker: { name: 'Morgan Taylor', role: 'PM' },
    speakerAttributionConfidence: 'high',
    matchingHint: 'Direct mention of "analytics dashboard"',
    createdAt: daysAgo(18),
    dismissedAt: daysAgo(17),
    dismissedBy: 'Alex Chen',
    dismissReason: 'not_real_decision',
    isNonOwnerUpdate: false,
    hasConflict: false
  },

  // Meeting 10 suggestions - Roadmap Planning Q1
  {
    id: 'sug-13',
    meetingId: 'meet-10',
    title: 'Progress update: SSO priority assessment',
    changeType: 'progress_update',
    confidence: 'medium',
    status: 'applied',
    targetInitiativeId: 'init-4',
    proposedChange: {
      commentText: 'SSO confirmed as top enterprise request. Prioritization discussed in Q1 planning.'
    },
    evidenceQuote: 'SSO is the top request from enterprise. We should prioritize it.',
    speaker: { name: 'Casey Rivera', role: 'PM' },
    speakerAttributionConfidence: 'high',
    matchingHint: 'Direct mention of "SSO"',
    createdAt: daysAgo(25),
    appliedAt: daysAgo(24),
    appliedBy: 'Morgan Taylor',
    isNonOwnerUpdate: false,
    hasConflict: false
  },
  {
    id: 'sug-14',
    meetingId: 'meet-10',
    title: 'Progress update: Mobile Redesign Priority',
    changeType: 'progress_update',
    confidence: 'high',
    status: 'applied',
    targetInitiativeId: 'init-1',
    proposedChange: {
      commentText: 'Mobile redesign confirmed as flagship Q1 project. Cannot be delayed.'
    },
    evidenceQuote: 'The mobile redesign is our flagship project for Q1. We can\'t delay it.',
    speaker: { name: 'Alex Chen', role: 'PM' },
    speakerAttributionConfidence: 'high',
    matchingHint: 'Direct mention of "mobile redesign"',
    createdAt: daysAgo(25),
    appliedAt: daysAgo(24),
    appliedBy: 'Alex Chen',
    isNonOwnerUpdate: false,
    hasConflict: false
  },
];

export const mockConnections: Connection[] = [
  {
    id: 'conn-1',
    name: 'Granola',
    type: 'meeting_source',
    provider: 'granola',
    isConnected: true
  },
  {
    id: 'conn-2',
    name: 'Gemini Notes',
    type: 'meeting_source',
    provider: 'gemini',
    isConnected: false
  },
  {
    id: 'conn-3',
    name: 'Linear',
    type: 'roadmap_system',
    provider: 'linear',
    isConnected: true
  }
];

// Analytics helpers
export const getAnalytics = (suggestions: Suggestion[]) => {
  const pending = suggestions.filter(s => s.status === 'pending').length;
  const applied = suggestions.filter(s => s.status === 'applied').length;
  const dismissed = suggestions.filter(s => s.status === 'dismissed').length;
  const total = suggestions.length;

  const dismissReasons = suggestions
    .filter(s => s.status === 'dismissed' && s.dismissReason)
    .reduce((acc, s) => {
      acc[s.dismissReason!] = (acc[s.dismissReason!] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

  const uniqueMeetings = new Set(suggestions.filter(s => s.status === 'pending').map(s => s.meetingId)).size;

  return {
    pending,
    applied,
    dismissed,
    total,
    applyRate: total > 0 ? Math.round((applied / total) * 100) : 0,
    dismissReasons,
    uniqueMeetings
  };
};
