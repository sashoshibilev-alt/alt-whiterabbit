import { useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ConfidenceBadge, ChangeTypeBadge, StatusBadge, SourceBadge } from '@/components/badges/StatusBadges';
import { Suggestion, Initiative, Meeting, DismissReason } from '@/types';
import { useShipItStore } from '@/hooks/useShipItStore';
import { AlertTriangle, Calendar, Clock, Users, Link2, FileText, Quote, User, Info, Check, X, Edit2, Plus } from 'lucide-react';
import { EvidenceSpans, EvidenceBadge } from './EvidenceSpans';

interface SuggestionDetailProps {
  suggestion: Suggestion | null;
  initiative?: Initiative;
  meeting?: Meeting;
  allInitiatives: Initiative[];
  conflictingSuggestions: Suggestion[];
  isOpen: boolean;
  onClose: () => void;
}

export function SuggestionDetail({
  suggestion,
  initiative,
  meeting,
  allInitiatives,
  conflictingSuggestions,
  isOpen,
  onClose
}: SuggestionDetailProps) {
  const { applySuggestion, dismissSuggestion, editSuggestion, linkSuggestion, createInitiativeFromSuggestion } = useShipItStore();
  const [showDismissDialog, setShowDismissDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showTranscriptDialog, setShowTranscriptDialog] = useState(false);
  const [showCreateInitiativeDialog, setShowCreateInitiativeDialog] = useState(false);
  const [dismissReason, setDismissReason] = useState<DismissReason | ''>('');
  const [dismissText, setDismissText] = useState('');
  const [editedChange, setEditedChange] = useState<Suggestion['proposedChange']>({});
  const [newInitiativeName, setNewInitiativeName] = useState('');
  const [newInitiativeDescription, setNewInitiativeDescription] = useState('');
  const [newInitiativeOwner, setNewInitiativeOwner] = useState('');

  if (!suggestion || !meeting) return null;

  const currentChange = suggestion.editedChange || suggestion.proposedChange;
  const canApply = suggestion.status === 'pending' && suggestion.targetInitiativeId;

  // Use suggestion context if available
  const displayTitle = suggestion.suggestion?.title || suggestion.title;
  const displayBody = suggestion.suggestion?.body;
  const evidencePreview = suggestion.suggestion?.evidencePreview;

  const handleApply = () => {
    applySuggestion(suggestion.id, 'Current User');
    onClose();
  };

  const handleDismiss = () => {
    if (dismissReason) {
      dismissSuggestion(suggestion.id, 'Current User', dismissReason, dismissText);
      setShowDismissDialog(false);
      setDismissReason('');
      setDismissText('');
      onClose();
    }
  };

  const handleEdit = () => {
    editSuggestion(suggestion.id, editedChange);
    setShowEditDialog(false);
  };

  const openEditDialog = () => {
    setEditedChange({ ...currentChange });
    setShowEditDialog(true);
  };

  const handleLinkInitiative = (initiativeId: string) => {
    linkSuggestion(suggestion.id, initiativeId);
  };

  const openCreateInitiativeDialog = () => {
    const currentChange = suggestion.editedChange || suggestion.proposedChange;
    setNewInitiativeName(currentChange.backlogTitle || '');
    setNewInitiativeDescription(currentChange.backlogDescription || '');
    setNewInitiativeOwner('Current User');
    setShowCreateInitiativeDialog(true);
  };

  const handleCreateInitiative = () => {
    if (newInitiativeName.trim()) {
      createInitiativeFromSuggestion(
        suggestion.id,
        newInitiativeName.trim(),
        newInitiativeDescription.trim(),
        newInitiativeOwner.trim() || 'Current User',
        'Current User'
      );
      setShowCreateInitiativeDialog(false);
      setNewInitiativeName('');
      setNewInitiativeDescription('');
      setNewInitiativeOwner('');
      onClose();
    }
  };

  return (
    <>
      <Sheet open={isOpen} onOpenChange={onClose}>
        <SheetContent className="w-[500px] sm:w-[600px] overflow-y-auto">
          <SheetHeader className="mb-6">
            <div className="flex items-center gap-2 mb-2">
              <ChangeTypeBadge type={suggestion.changeType} />
              <ConfidenceBadge level={suggestion.confidence} />
              <StatusBadge status={suggestion.status} />
              {suggestion.isEdited && <Badge variant="outline">Edited</Badge>}
            </div>
            <SheetTitle className="text-lg">{displayTitle}</SheetTitle>
          </SheetHeader>

          {/* Warnings */}
          {(suggestion.isNonOwnerUpdate || conflictingSuggestions.length > 0) && (
            <div className="space-y-2 mb-6">
              {suggestion.isNonOwnerUpdate && (
                <Alert variant="warning">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>
                    Update stated by non-owner; review carefully.
                  </AlertDescription>
                </Alert>
              )}
              {conflictingSuggestions.length > 0 && (
                <Alert variant="warning">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>
                    Another pending suggestion proposes a different date for this initiative.
                  </AlertDescription>
                </Alert>
              )}
            </div>
          )}

          {/* Proposed Change */}
          <Card className="mb-4">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <FileText className="h-4 w-4" />
                {displayBody ? 'Description' : 'Proposed Change'}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {displayBody ? (
                <div className="p-3 bg-muted rounded-md">
                  <p className="text-sm whitespace-pre-wrap">{displayBody}</p>
                </div>
              ) : (
                <>
                  {suggestion.changeType === 'timeline_change' && (
                    <div className="space-y-2">
                      <p className="text-sm text-muted-foreground">Field: {currentChange.field}</p>
                      <div className="flex items-center gap-2 text-sm">
                        <span className="line-through text-muted-foreground">{currentChange.before}</span>
                        <span>→</span>
                        <span className="font-medium text-primary">{currentChange.after}</span>
                      </div>
                    </div>
                  )}
                  {suggestion.changeType === 'progress_update' && (
                    <div className="p-3 bg-muted rounded-md">
                      <p className="text-sm">{currentChange.commentText}</p>
                    </div>
                  )}
                  {suggestion.changeType === 'new_idea' && (
                    <div className="space-y-2">
                      <p className="font-medium text-sm">{currentChange.backlogTitle}</p>
                      <p className="text-sm text-muted-foreground">{currentChange.backlogDescription}</p>
                    </div>
                  )}
                </>
              )}
              {suggestion.isEdited && suggestion.originalChange && (
                <div className="mt-3 pt-3 border-t">
                  <p className="text-xs text-muted-foreground mb-1">Original:</p>
                  <p className="text-xs text-muted-foreground line-through">
                    {suggestion.originalChange.commentText ||
                     `${suggestion.originalChange.before} → ${suggestion.originalChange.after}` ||
                     suggestion.originalChange.backlogTitle}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Evidence & Provenance */}
          <Card className="mb-4">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Quote className="h-4 w-4" />
                Evidence & Provenance
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {evidencePreview && evidencePreview.length > 0 ? (
                <div className="space-y-2">
                  {evidencePreview.map((line, idx) => (
                    <div key={idx} className="p-3 bg-muted rounded-md border-l-4 border-primary">
                      <p className="text-sm italic">"{line}"</p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-3 bg-muted rounded-md border-l-4 border-primary">
                  <p className="text-sm italic">"{suggestion.evidenceQuote}"</p>
                </div>
              )}
              
              <div className="flex items-center gap-4 text-sm">
                <div className="flex items-center gap-2">
                  <User className="h-4 w-4 text-muted-foreground" />
                  <span>{suggestion.speaker.name}</span>
                  <span className="text-muted-foreground">({suggestion.speaker.role})</span>
                </div>
                <ConfidenceBadge level={suggestion.speakerAttributionConfidence} />
              </div>

              <Separator />

              <div className="space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Meeting:</span>
                  <span className="font-medium">{meeting.title}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground flex items-center gap-1">
                    <Calendar className="h-3 w-3" /> Date:
                  </span>
                  <span>{meeting.date.toLocaleDateString()} {meeting.date.toLocaleTimeString()}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground flex items-center gap-1">
                    <Clock className="h-3 w-3" /> Duration:
                  </span>
                  <span>{meeting.duration} minutes</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground flex items-center gap-1">
                    <Users className="h-3 w-3" /> Attendees:
                  </span>
                  <span>{meeting.attendeesCount}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Source:</span>
                  <SourceBadge source={meeting.source} />
                </div>
              </div>

              <div className="flex gap-2">
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => setShowTranscriptDialog(true)}
                >
                  Open transcript
                </Button>
                <Button variant="outline" size="sm" disabled>
                  Open meeting source
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Evidence Spans - if available from beliefs */}
          {(suggestion as any).evidenceSpans && (
            <div className="mb-4">
              <EvidenceSpans 
                spans={(suggestion as any).evidenceSpans}
                defaultOpen={false}
              />
            </div>
          )}

          {/* Target Mapping */}
          <Card className="mb-6">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Link2 className="h-4 w-4" />
                Target Initiative
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Select 
                value={suggestion.targetInitiativeId || ''} 
                onValueChange={handleLinkInitiative}
                disabled={suggestion.status !== 'pending'}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select an initiative..." />
                </SelectTrigger>
                <SelectContent>
                  {allInitiatives.map(init => (
                    <SelectItem key={init.id} value={init.id}>
                      {init.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {suggestion.changeType === 'new_idea' && suggestion.status === 'pending' && (
                <Button 
                  variant="outline" 
                  className="w-full"
                  onClick={openCreateInitiativeDialog}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Create new initiative
                </Button>
              )}

              {!suggestion.targetInitiativeId && (
                <Alert>
                  <Info className="h-4 w-4" />
                  <AlertDescription>
                    {suggestion.changeType === 'new_idea' 
                      ? 'Link to an existing initiative or create a new one'
                      : 'Unlinked — choose an initiative to apply'}
                  </AlertDescription>
                </Alert>
              )}

              {suggestion.matchingHint && (
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <Info className="h-3 w-3" />
                  {suggestion.matchingHint}
                </p>
              )}
            </CardContent>
          </Card>

          {/* Actions */}
          {suggestion.status === 'pending' && (
            <div className="flex gap-2">
              <Button 
                onClick={handleApply} 
                disabled={!canApply}
                className="flex-1"
              >
                <Check className="h-4 w-4 mr-2" />
                Apply
              </Button>
              <Button 
                variant="outline" 
                onClick={openEditDialog}
              >
                <Edit2 className="h-4 w-4 mr-2" />
                Edit
              </Button>
              <Button 
                variant="destructive" 
                onClick={() => setShowDismissDialog(true)}
              >
                <X className="h-4 w-4 mr-2" />
                Dismiss
              </Button>
            </div>
          )}

          {suggestion.status === 'applied' && (
            <div className="text-sm text-muted-foreground">
              Applied by {suggestion.appliedBy} on {suggestion.appliedAt?.toLocaleDateString()}
            </div>
          )}

          {suggestion.status === 'dismissed' && (
            <div className="text-sm text-muted-foreground">
              Dismissed by {suggestion.dismissedBy} on {suggestion.dismissedAt?.toLocaleDateString()}
              {suggestion.dismissReason && (
                <span className="block mt-1">Reason: {suggestion.dismissReason.replace(/_/g, ' ')}</span>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Dismiss Dialog */}
      <Dialog open={showDismissDialog} onOpenChange={setShowDismissDialog}>
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
            <Button variant="outline" onClick={() => setShowDismissDialog(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDismiss} disabled={!dismissReason}>
              Dismiss
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Suggestion</DialogTitle>
            <DialogDescription>
              Modify the suggested change. Original evidence will be preserved.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {suggestion.changeType === 'timeline_change' && (
              <div className="space-y-2">
                <Label>New Date</Label>
                <Input 
                  value={editedChange.after || ''}
                  onChange={(e) => setEditedChange({ ...editedChange, after: e.target.value })}
                  placeholder="e.g., March 20, 2025"
                />
              </div>
            )}
            {suggestion.changeType === 'progress_update' && (
              <div className="space-y-2">
                <Label>Comment Text</Label>
                <Textarea 
                  value={editedChange.commentText || ''}
                  onChange={(e) => setEditedChange({ ...editedChange, commentText: e.target.value })}
                  rows={4}
                />
              </div>
            )}
            {suggestion.changeType === 'new_idea' && (
              <>
                <div className="space-y-2">
                  <Label>Title</Label>
                  <Input 
                    value={editedChange.backlogTitle || ''}
                    onChange={(e) => setEditedChange({ ...editedChange, backlogTitle: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Description</Label>
                  <Textarea 
                    value={editedChange.backlogDescription || ''}
                    onChange={(e) => setEditedChange({ ...editedChange, backlogDescription: e.target.value })}
                    rows={3}
                  />
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditDialog(false)}>Cancel</Button>
            <Button onClick={handleEdit}>Save Changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Transcript Dialog */}
      <Dialog open={showTranscriptDialog} onOpenChange={setShowTranscriptDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Transcript Excerpt</DialogTitle>
            <DialogDescription>{meeting.title}</DialogDescription>
          </DialogHeader>
          <div className="p-4 bg-muted rounded-md max-h-96 overflow-y-auto">
            <p className="text-sm whitespace-pre-wrap">{meeting.transcriptExcerpt}</p>
          </div>
          <DialogFooter>
            <Button onClick={() => setShowTranscriptDialog(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Initiative Dialog */}
      <Dialog open={showCreateInitiativeDialog} onOpenChange={setShowCreateInitiativeDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New Initiative</DialogTitle>
            <DialogDescription>
              Create a new initiative from this suggestion. It will be added to your roadmap.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Initiative Name</Label>
              <Input 
                value={newInitiativeName}
                onChange={(e) => setNewInitiativeName(e.target.value)}
                placeholder="e.g., Mobile Push Notifications"
              />
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea 
                value={newInitiativeDescription}
                onChange={(e) => setNewInitiativeDescription(e.target.value)}
                placeholder="Describe the initiative..."
                rows={3}
              />
            </div>
            <div className="space-y-2">
              <Label>Owner</Label>
              <Input 
                value={newInitiativeOwner}
                onChange={(e) => setNewInitiativeOwner(e.target.value)}
                placeholder="e.g., John Doe"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateInitiativeDialog(false)}>Cancel</Button>
            <Button onClick={handleCreateInitiative} disabled={!newInitiativeName.trim()}>
              <Plus className="h-4 w-4 mr-2" />
              Create & Apply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
