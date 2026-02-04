import { useState, useMemo } from 'react';
import { useShipItStore } from '@/hooks/useShipItStore';
import { getAnalytics } from '@/data/mockData';
import { InboxHealth } from '@/components/inbox/InboxHealth';
import { InboxFilters } from '@/components/inbox/InboxFilters';
import { MeetingGroupCard } from '@/components/inbox/MeetingGroupCard';
import { SuggestionCard } from '@/components/inbox/SuggestionCard';
import { SuggestionDetail } from '@/components/inbox/SuggestionDetail';
import { ConfidenceLevel, ChangeType, SuggestionStatus, DismissReason } from '@/types';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';

export default function InboxPage() {
  const { suggestions, initiatives, meetings, dismissSuggestion } = useShipItStore();
  
  // Filter state
  const [search, setSearch] = useState('');
  const [confidenceFilter, setConfidenceFilter] = useState<ConfidenceLevel | 'all'>('all');
  const [changeTypeFilter, setChangeTypeFilter] = useState<ChangeType | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<SuggestionStatus | 'all'>('pending');
  
  // Selection state
  const [selectedMeetingId, setSelectedMeetingId] = useState<string | null>(null);
  const [selectedSuggestionId, setSelectedSuggestionId] = useState<string | null>(null);
  
  // Quick dismiss state
  const [quickDismissSuggestionId, setQuickDismissSuggestionId] = useState<string | null>(null);
  const [dismissReason, setDismissReason] = useState<DismissReason | ''>('');
  const [dismissText, setDismissText] = useState('');

  const hasFilters = search !== '' || confidenceFilter !== 'all' || changeTypeFilter !== 'all' || statusFilter !== 'pending';

  const clearFilters = () => {
    setSearch('');
    setConfidenceFilter('all');
    setChangeTypeFilter('all');
    setStatusFilter('pending');
  };

  // Filtered suggestions
  const filteredSuggestions = useMemo(() => {
    return suggestions.filter(s => {
      if (confidenceFilter !== 'all' && s.confidence !== confidenceFilter) return false;
      if (changeTypeFilter !== 'all' && s.changeType !== changeTypeFilter) return false;
      if (statusFilter !== 'all' && s.status !== statusFilter) return false;
      if (search) {
        const initiative = initiatives.find(i => i.id === s.targetInitiativeId);
        const searchLower = search.toLowerCase();
        const matchesInitiative = initiative?.name.toLowerCase().includes(searchLower);
        const matchesSuggestion = s.title.toLowerCase().includes(searchLower) || 
                                  s.evidenceQuote.toLowerCase().includes(searchLower);
        if (!matchesInitiative && !matchesSuggestion) return false;
      }
      return true;
    });
  }, [suggestions, initiatives, search, confidenceFilter, changeTypeFilter, statusFilter]);

  // Meetings with filtered suggestions
  const meetingsWithSuggestions = useMemo(() => {
    const meetingMap = new Map<string, typeof filteredSuggestions>();
    filteredSuggestions.forEach(s => {
      const existing = meetingMap.get(s.meetingId) || [];
      meetingMap.set(s.meetingId, [...existing, s]);
    });
    return meetings
      .filter(m => meetingMap.has(m.id))
      .map(m => ({ meeting: m, suggestions: meetingMap.get(m.id)! }))
      .sort((a, b) => b.meeting.date.getTime() - a.meeting.date.getTime());
  }, [meetings, filteredSuggestions]);

  // Current selections
  const selectedMeeting = meetings.find(m => m.id === selectedMeetingId);
  const displayedSuggestions = selectedMeetingId 
    ? filteredSuggestions.filter(s => s.meetingId === selectedMeetingId)
    : filteredSuggestions;
  
  const selectedSuggestion = suggestions.find(s => s.id === selectedSuggestionId);
  const selectedInitiative = initiatives.find(i => i.id === selectedSuggestion?.targetInitiativeId);
  const selectedSuggestionMeeting = meetings.find(m => m.id === selectedSuggestion?.meetingId);
  
  // Find conflicting suggestions
  const conflictingSuggestions = useMemo(() => {
    if (!selectedSuggestion || !selectedSuggestion.targetInitiativeId) return [];
    return suggestions.filter(s => 
      s.id !== selectedSuggestion.id &&
      s.targetInitiativeId === selectedSuggestion.targetInitiativeId &&
      s.changeType === 'timeline_change' &&
      s.status === 'pending'
    );
  }, [selectedSuggestion, suggestions]);

  // Analytics
  const analytics = getAnalytics(suggestions);

  const handleQuickDismiss = () => {
    if (quickDismissSuggestionId && dismissReason) {
      dismissSuggestion(quickDismissSuggestionId, 'Current User', dismissReason, dismissText);
      setQuickDismissSuggestionId(null);
      setDismissReason('');
      setDismissText('');
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* Health Widget */}
      <div className="p-4 border-b">
        <InboxHealth 
          pending={analytics.pending}
          uniqueMeetings={analytics.uniqueMeetings}
          applyRate={analytics.applyRate}
          total={analytics.total}
        />
      </div>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel - Filters + Meetings */}
        <div className="w-72 border-r flex flex-col">
          <div className="p-4">
            <InboxFilters
              search={search}
              confidence={confidenceFilter}
              changeType={changeTypeFilter}
              status={statusFilter}
              onSearchChange={setSearch}
              onConfidenceChange={setConfidenceFilter}
              onChangeTypeChange={setChangeTypeFilter}
              onStatusChange={setStatusFilter}
              onClear={clearFilters}
              hasFilters={hasFilters}
            />
          </div>
          
          <Separator />
          
          <div className="p-4 pb-2">
            <h3 className="text-sm font-medium text-muted-foreground">
              Meetings ({meetingsWithSuggestions.length})
            </h3>
          </div>
          
          <ScrollArea className="flex-1 px-4 pb-4">
            <div className="space-y-2">
              <div 
                className={`p-2 rounded cursor-pointer text-sm transition-colors ${
                  selectedMeetingId === null ? 'bg-muted font-medium' : 'hover:bg-muted/50'
                }`}
                onClick={() => setSelectedMeetingId(null)}
              >
                All meetings
              </div>
              {meetingsWithSuggestions.map(({ meeting, suggestions: meetingSuggestions }) => (
                <MeetingGroupCard
                  key={meeting.id}
                  meeting={meeting}
                  suggestions={meetingSuggestions}
                  isSelected={selectedMeetingId === meeting.id}
                  onClick={() => setSelectedMeetingId(meeting.id)}
                />
              ))}
            </div>
          </ScrollArea>
        </div>

        {/* Main Panel - Suggestions List */}
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="p-4 border-b">
            <h2 className="text-lg font-semibold">
              {selectedMeeting ? selectedMeeting.title : 'All Suggestions'}
            </h2>
            <p className="text-sm text-muted-foreground">
              {displayedSuggestions.length} suggestion{displayedSuggestions.length !== 1 ? 's' : ''}
            </p>
          </div>
          
          <ScrollArea className="flex-1 p-4">
            <div className="space-y-3 max-w-3xl">
              {displayedSuggestions.map(suggestion => (
                <SuggestionCard
                  key={suggestion.id}
                  suggestion={suggestion}
                  initiative={initiatives.find(i => i.id === suggestion.targetInitiativeId)}
                  isSelected={selectedSuggestionId === suggestion.id}
                  onSelect={() => setSelectedSuggestionId(suggestion.id)}
                  onQuickDismiss={() => setQuickDismissSuggestionId(suggestion.id)}
                />
              ))}
              {displayedSuggestions.length === 0 && (
                <div className="text-center py-12 text-muted-foreground">
                  <p>No suggestions match your filters.</p>
                </div>
              )}
            </div>
          </ScrollArea>
        </div>
      </div>

      {/* Suggestion Detail Sheet */}
      <SuggestionDetail
        suggestion={selectedSuggestion || null}
        initiative={selectedInitiative}
        meeting={selectedSuggestionMeeting}
        allInitiatives={initiatives}
        conflictingSuggestions={conflictingSuggestions}
        isOpen={!!selectedSuggestionId}
        onClose={() => setSelectedSuggestionId(null)}
      />

      {/* Quick Dismiss Dialog */}
      <Dialog open={!!quickDismissSuggestionId} onOpenChange={() => setQuickDismissSuggestionId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Dismiss Suggestion</DialogTitle>
            <DialogDescription>
              Please select a reason for dismissing this suggestion.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Reason</Label>
              <Select value={dismissReason} onValueChange={(v) => setDismissReason(v as DismissReason)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a reason..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="not_relevant">Not relevant</SelectItem>
                  <SelectItem value="incorrect_or_low_quality">Incorrect or low quality</SelectItem>
                  <SelectItem value="too_risky_or_disruptive">Too risky or disruptive</SelectItem>
                  <SelectItem value="already_done_or_in_progress">Already done or in progress</SelectItem>
                  <SelectItem value="needs_more_clarification">Needs more clarification</SelectItem>
                  <SelectItem value="wrong_scope_or_target">Wrong scope or target</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {dismissReason === 'other' && (
              <div className="space-y-2">
                <Label>Details</Label>
                <Textarea 
                  value={dismissText}
                  onChange={(e) => setDismissText(e.target.value)}
                  placeholder="Explain why..."
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setQuickDismissSuggestionId(null)}>Cancel</Button>
            <Button variant="destructive" onClick={handleQuickDismiss} disabled={!dismissReason}>
              Dismiss
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
