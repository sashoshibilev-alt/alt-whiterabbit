import { useEffect, useState } from "react";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Id } from "../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useNavigate, useParams, Link } from "react-router-dom";
import { ArrowLeft, Calendar, Clock, FileText, CheckCircle2, XCircle, Sparkles, Loader2, Target, Plus, ExternalLink, RotateCw, Trash2, Bug, Info } from "lucide-react";
import { SuggestionDebugPanel } from "@/components/debug/SuggestionDebugPanel";
import { format, formatDistanceToNow } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { V0_DISMISS_REASON_LABELS, TIME_SAVED_OPTIONS, V0DismissReason } from "@/types";

export default function NoteDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  
  const getWithComputedSuggestions = useAction(api.notes.getWithComputedSuggestions);
  const activeInitiatives = useQuery(api.v0Initiatives.listActive);

  // State to hold the note data from the action
  const [noteData, setNoteData] = useState<{
    note: any;
    suggestions: any[];
  } | null | undefined>(undefined);

  // Trigger to refetch note data
  const [refetchTrigger, setRefetchTrigger] = useState(0);
  const refetchNoteData = () => setRefetchTrigger(prev => prev + 1);

  // Fetch note data when component mounts or id changes
  useEffect(() => {
    if (!id) return;

    setNoteData(undefined); // Set to loading state
    getWithComputedSuggestions({ id: id as Id<"notes"> })
      .then(data => setNoteData(data))
      .catch(err => {
        console.error("Failed to load note:", err);
        setNoteData(null);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, refetchTrigger]); // Note: getWithComputedSuggestions is stable from useAction
  
  const recordShown = useMutation(api.suggestions.recordShown);
  const applySuggestion = useMutation(api.suggestions.apply);
  const applyToInitiative = useMutation(api.suggestions.applyToInitiative);
  const updateTimeSaved = useMutation(api.suggestions.updateTimeSaved);
  const dismissSuggestion = useMutation(api.suggestions.dismiss);
  const regenerateSuggestions = useAction(api.suggestions.regenerate);
  const deleteNote = useMutation(api.notes.remove);
  const requestClarification = useMutation(api.suggestions.requestClarification);
  const answerClarification = useMutation(api.suggestions.answerClarification);
  
  // Track which suggestions have been marked as shown in this session
  const [shownSuggestions, setShownSuggestions] = useState<Set<string>>(new Set());
  
  // Initiative selection modal state
  const [initiativeModalOpen, setInitiativeModalOpen] = useState(false);
  const [applyingSuggestionId, setApplyingSuggestionId] = useState<Id<"suggestions"> | null>(null);
  const [applyingSuggestionContent, setApplyingSuggestionContent] = useState<string>("");
  const [initiativeTab, setInitiativeTab] = useState<"existing" | "new">("existing");
  const [selectedInitiativeId, setSelectedInitiativeId] = useState<string>("");
  const [newInitiativeTitle, setNewInitiativeTitle] = useState("");
  const [newInitiativeDescription, setNewInitiativeDescription] = useState("");
  
  // Time saved modal state
  const [timeSavedModalOpen, setTimeSavedModalOpen] = useState(false);
  const [applyingEventId, setApplyingEventId] = useState<Id<"suggestionEvents"> | null>(null);
  const [selectedTimeSaved, setSelectedTimeSaved] = useState<number | "skip">("skip");
  const [appliedInitiativeId, setAppliedInitiativeId] = useState<Id<"v0Initiatives"> | null>(null);
  
  // Dismiss modal state
  const [dismissModalOpen, setDismissModalOpen] = useState(false);
  const [dismissingSuggestionId, setDismissingSuggestionId] = useState<Id<"suggestions"> | null>(null);
  const [selectedDismissReason, setSelectedDismissReason] = useState<V0DismissReason | "">("");
  const [dismissReasonOther, setDismissReasonOther] = useState("");
  
  const [isProcessing, setIsProcessing] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  
  // Delete confirmation modal state
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  
  // Clarification modal state
  const [clarificationModalOpen, setClarificationModalOpen] = useState(false);
  const [clarifyingSuggestionId, setClarifyingSuggestionId] = useState<Id<"suggestions"> | null>(null);
  const [clarificationText, setClarificationText] = useState("");

  // Record shown events for new suggestions
  useEffect(() => {
    if (!noteData?.suggestions) return;
    
    const newSuggestions = noteData.suggestions.filter(
      (s) => s.status === "new" && !shownSuggestions.has(s._id)
    );
    
    for (const suggestion of newSuggestions) {
      recordShown({ suggestionId: suggestion._id })
        .then(() => {
          setShownSuggestions((prev) => new Set(prev).add(suggestion._id));
        })
        .catch((err) => {
          console.error("Failed to record shown event:", err);
        });
    }
  }, [noteData?.suggestions, shownSuggestions, recordShown]);

  if (!id) {
    return <div>Invalid note ID</div>;
  }

  if (noteData === undefined) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (noteData === null) {
    return (
      <div className="h-full flex flex-col items-center justify-center">
        <FileText className="h-12 w-12 text-muted-foreground/50 mb-4" />
        <h2 className="text-lg font-medium mb-2">Note not found</h2>
        <Button onClick={() => navigate("/notes")}>Back to notes</Button>
      </div>
    );
  }

  const { note, suggestions } = noteData;
  const newSuggestions = suggestions.filter((s) => s.status === "new");
  const appliedSuggestions = suggestions.filter((s) => s.status === "applied");
  const dismissedSuggestions = suggestions.filter((s) => s.status === "dismissed");

  // Opens the initiative selection modal
  const handleApplyClick = (suggestionId: Id<"suggestions">, content: string) => {
    setApplyingSuggestionId(suggestionId);
    setApplyingSuggestionContent(content);
    // Pre-populate new initiative fields from suggestion content
    const suggestedTitle = content.length > 60 ? content.slice(0, 60) + "..." : content;
    setNewInitiativeTitle(suggestedTitle);
    setNewInitiativeDescription(content);
    setInitiativeTab(activeInitiatives && activeInitiatives.length > 0 ? "existing" : "new");
    setSelectedInitiativeId("");
    setInitiativeModalOpen(true);
  };

  // Handles the actual apply after initiative selection
  const handleInitiativeSubmit = async () => {
    if (!applyingSuggestionId) return;
    
    setIsProcessing(true);
    try {
      if (initiativeTab === "existing" && selectedInitiativeId) {
        // Apply to existing initiative
        const result = await applyToInitiative({
          id: applyingSuggestionId,
          initiativeId: selectedInitiativeId as Id<"v0Initiatives">,
        });
        setApplyingEventId(result.eventId);
        setAppliedInitiativeId(result.initiative._id);
        toast({
          title: "Suggestion applied",
          description: `Linked to initiative: ${result.initiative.title}`,
        });
      } else if (initiativeTab === "new" && newInitiativeTitle.trim()) {
        // Create new initiative and apply
        const result = await applyToInitiative({
          id: applyingSuggestionId,
          newInitiative: {
            title: newInitiativeTitle.trim(),
            description: newInitiativeDescription.trim(),
          },
        });
        setApplyingEventId(result.eventId);
        setAppliedInitiativeId(result.initiative._id);
        toast({
          title: "Initiative created",
          description: `New initiative "${result.initiative.title}" created and linked`,
        });
      } else {
        // Apply without initiative (simple apply)
        const eventId = await applySuggestion({ id: applyingSuggestionId });
        setApplyingEventId(eventId);
        setAppliedInitiativeId(null);
        toast({
          title: "Suggestion applied",
          description: "Applied without linking to an initiative",
        });
      }
      
      // Close initiative modal and open time saved modal
      setInitiativeModalOpen(false);
      setTimeSavedModalOpen(true);
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to apply suggestion",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  // Handle simple apply without initiative
  const handleApplyWithoutInitiative = async () => {
    if (!applyingSuggestionId) return;
    
    setIsProcessing(true);
    try {
      const eventId = await applySuggestion({ id: applyingSuggestionId });
      setApplyingEventId(eventId);
      setAppliedInitiativeId(null);
      setInitiativeModalOpen(false);
      setTimeSavedModalOpen(true);
      toast({
        title: "Suggestion applied",
        description: "Applied without linking to an initiative",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to apply suggestion",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleTimeSavedSubmit = async () => {
    if (applyingEventId && selectedTimeSaved !== "skip") {
      await updateTimeSaved({
        eventId: applyingEventId,
        timeSavedMinutes: selectedTimeSaved,
      });
    }
    setTimeSavedModalOpen(false);
    setApplyingEventId(null);
    setAppliedInitiativeId(null);
    setSelectedTimeSaved("skip");
    setApplyingSuggestionId(null);
    setApplyingSuggestionContent("");
    setNewInitiativeTitle("");
    setNewInitiativeDescription("");
  };

  const handleDismissClick = (suggestionId: Id<"suggestions">) => {
    setDismissingSuggestionId(suggestionId);
    setDismissModalOpen(true);
  };

  const handleDismissSubmit = async () => {
    if (!dismissingSuggestionId || !selectedDismissReason) return;
    
    setIsProcessing(true);
    try {
      await dismissSuggestion({
        id: dismissingSuggestionId,
        dismissReason: selectedDismissReason,
        dismissReasonOther: selectedDismissReason === "other" ? dismissReasonOther : undefined,
      });
      toast({
        title: "Suggestion dismissed",
        description: "Your feedback has been recorded",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to dismiss suggestion",
        variant: "destructive",
      });
    } finally {
      setDismissModalOpen(false);
      setDismissingSuggestionId(null);
      setSelectedDismissReason("");
      setDismissReasonOther("");
      setIsProcessing(false);
    }
  };

  const handleRegenerateSuggestions = async () => {
    if (!id) return;

    setIsRegenerating(true);
    try {
      const result = await regenerateSuggestions({ noteId: id as Id<"notes"> });

      // Refetch the note data after regeneration
      refetchNoteData();

      if (result.newCount === 0) {
        toast({
          title: "No new suggestions",
          description: result.noteChanged
            ? "No suggestions found for the current note content"
            : "Try editing the note to generate new suggestions",
        });
      } else if (result.added > 0) {
        toast({
          title: "Suggestions regenerated",
          description: `${result.added} new suggestion${result.added > 1 ? 's' : ''} generated`,
        });
      } else if (result.added < 0) {
        toast({
          title: "Suggestions updated",
          description: "Some previous suggestions are no longer relevant",
        });
      } else {
        toast({
          title: "Suggestions unchanged",
          description: "The same suggestions are still relevant",
        });
      }
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to regenerate suggestions",
        variant: "destructive",
      });
    } finally {
      setIsRegenerating(false);
    }
  };

  const handleDeleteNote = async () => {
    if (!id) return;
    
    try {
      await deleteNote({ id: id as Id<"notes"> });
      toast({
        title: "Note deleted",
        description: "The note and all associated suggestions have been removed",
      });
      navigate("/notes");
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to delete note",
        variant: "destructive",
      });
    }
  };

  const handleRequestClarification = async (suggestionId: Id<"suggestions">) => {
    try {
      await requestClarification({ suggestionId });
      setClarificationModalOpen(true);
      setClarifyingSuggestionId(suggestionId);
      toast({
        title: "Clarification requested",
        description: "Shipit will provide more context for this suggestion",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to request clarification",
        variant: "destructive",
      });
    }
  };

  const handleSubmitClarification = async () => {
    if (!clarifyingSuggestionId || !clarificationText.trim()) return;
    
    try {
      await answerClarification({ 
        suggestionId: clarifyingSuggestionId, 
        clarificationText: clarificationText.trim() 
      });
      toast({
        title: "Clarification added",
        description: "The suggestion has been updated with additional context",
      });
      setClarificationModalOpen(false);
      setClarifyingSuggestionId(null);
      setClarificationText("");
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to submit clarification",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-4 border-b bg-background shrink-0">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate("/notes")}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold truncate">
              {note.title || "Untitled Note"}
            </h1>
            <div className="flex items-center gap-4 text-sm text-muted-foreground mt-1">
              {note.meetingAt && (
                <div className="flex items-center gap-1">
                  <Calendar className="h-4 w-4" />
                  <span>{format(note.meetingAt, "PPP")}</span>
                </div>
              )}
              <div className="flex items-center gap-1">
                <Clock className="h-4 w-4" />
                <span>Captured {formatDistanceToNow(note.capturedAt, { addSuffix: true })}</span>
              </div>
            </div>
          </div>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setDeleteModalOpen(true)}
          >
            <Trash2 className="h-4 w-4 mr-2" />
            Delete Note
          </Button>
        </div>
      </div>

      {/* Main Content - Two Panel Layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel - Note Content */}
        <div className="w-1/2 border-r flex flex-col">
          <div className="p-4 border-b shrink-0">
            <h2 className="font-semibold flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Meeting Notes
            </h2>
          </div>
          <ScrollArea className="flex-1 p-4">
            <div className="prose prose-sm max-w-none">
              <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">
                {note.body}
              </pre>
            </div>
          </ScrollArea>
        </div>

        {/* Right Panel - Suggestions */}
        <div className="w-1/2 flex flex-col">
          <div className="p-4 border-b shrink-0">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold flex items-center gap-2">
                <Sparkles className="h-4 w-4" />
                Suggestions ({suggestions.length})
              </h2>
              <Button
                variant="outline"
                size="sm"
                onClick={handleRegenerateSuggestions}
                disabled={isRegenerating}
              >
                {isRegenerating ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <RotateCw className="h-4 w-4 mr-2" />
                )}
                Regenerate
              </Button>
            </div>
          </div>
          <ScrollArea className="flex-1 p-4">
            {suggestions.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Sparkles className="h-8 w-8 mx-auto mb-3 opacity-50" />
                <p>No suggestions yet for this note</p>
              </div>
            ) : (
              <div className="space-y-3">
                {/* New Suggestions */}
                {newSuggestions.length > 0 && (
                  <div className="space-y-3">
                    <h3 className="text-sm font-medium text-muted-foreground">
                      New ({newSuggestions.length})
                    </h3>
                    {newSuggestions.map((suggestion) => {
                      const needsClarification = suggestion.clarificationState === "suggested";
                      const clarificationRequested = suggestion.clarificationState === "requested";
                      const clarified = suggestion.clarificationState === "answered";
                      
                      return (
                        <Card key={suggestion._id} className={needsClarification ? "border-orange-300" : ""}>
                          <CardContent className="p-4">
                            <p className="text-sm mb-3">{suggestion.content}</p>
                            {suggestion.clarificationPrompt && needsClarification && (
                              <div className="mb-3 p-2 bg-orange-50 dark:bg-orange-950/20 rounded text-xs">
                                <Info className="h-3 w-3 inline mr-1" />
                                {suggestion.clarificationPrompt}
                              </div>
                            )}
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex gap-2 flex-wrap">
                                <Badge variant="secondary">New</Badge>
                                {needsClarification && (
                                  <Badge variant="outline" className="border-orange-500 text-orange-700">
                                    Needs clarification
                                  </Badge>
                                )}
                                {clarificationRequested && (
                                  <Badge variant="outline" className="border-blue-500 text-blue-700">
                                    Clarification requested
                                  </Badge>
                                )}
                                {clarified && (
                                  <Badge variant="outline" className="border-green-500 text-green-700">
                                    Clarified
                                  </Badge>
                                )}
                              </div>
                              <div className="flex gap-2">
                                {needsClarification && (
                                  <Button
                                    size="sm"
                                    variant="default"
                                    onClick={() => handleRequestClarification(suggestion._id)}
                                    disabled={isProcessing}
                                  >
                                    <Info className="h-4 w-4 mr-1" />
                                    Ask Shipit to clarify
                                  </Button>
                                )}
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleDismissClick(suggestion._id)}
                                  disabled={isProcessing}
                                >
                                  <XCircle className="h-4 w-4 mr-1" />
                                  Dismiss
                                </Button>
                                {!needsClarification && (
                                  <Button
                                    size="sm"
                                    onClick={() => handleApplyClick(suggestion._id, suggestion.content)}
                                    disabled={isProcessing}
                                  >
                                    <CheckCircle2 className="h-4 w-4 mr-1" />
                                    Apply
                                  </Button>
                                )}
                                {(needsClarification || clarificationRequested) && (
                                  <Button
                                    size="sm"
                                    variant="secondary"
                                    onClick={() => handleApplyClick(suggestion._id, suggestion.content)}
                                    disabled={isProcessing}
                                  >
                                    <CheckCircle2 className="h-4 w-4 mr-1" />
                                    Apply anyway
                                  </Button>
                                )}
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                )}

                {/* Applied Suggestions */}
                {appliedSuggestions.length > 0 && (
                  <div className="space-y-3">
                    <Separator className="my-4" />
                    <h3 className="text-sm font-medium text-muted-foreground">
                      Applied ({appliedSuggestions.length})
                    </h3>
                    {appliedSuggestions.map((suggestion) => (
                      <Card key={suggestion._id} className="bg-green-50 dark:bg-green-950/20">
                        <CardContent className="p-4">
                          <p className="text-sm mb-2">{suggestion.content}</p>
                          <div className="flex items-center gap-2 flex-wrap">
                            <Badge className="bg-green-600">
                              <CheckCircle2 className="h-3 w-3 mr-1" />
                              Applied
                            </Badge>
                            {suggestion.initiativeId && (
                              <Link to={`/initiatives/${suggestion.initiativeId}`}>
                                <Badge variant="outline" className="cursor-pointer hover:bg-muted">
                                  <Target className="h-3 w-3 mr-1" />
                                  View Initiative
                                  <ExternalLink className="h-3 w-3 ml-1" />
                                </Badge>
                              </Link>
                            )}
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}

                {/* Dismissed Suggestions */}
                {dismissedSuggestions.length > 0 && (
                  <div className="space-y-3">
                    <Separator className="my-4" />
                    <h3 className="text-sm font-medium text-muted-foreground">
                      Dismissed ({dismissedSuggestions.length})
                    </h3>
                    {dismissedSuggestions.map((suggestion) => (
                      <Card key={suggestion._id} className="bg-muted/50 opacity-75">
                        <CardContent className="p-4">
                          <p className="text-sm mb-2">{suggestion.content}</p>
                          <Badge variant="outline" className="text-orange-600">
                            <XCircle className="h-3 w-3 mr-1" />
                            Dismissed: {suggestion.dismissReason && V0_DISMISS_REASON_LABELS[suggestion.dismissReason]}
                          </Badge>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Debug Panel - Admin only */}
            <SuggestionDebugPanel noteId={id as Id<"notes">} />
          </ScrollArea>
        </div>
      </div>

      {/* Initiative Selection Modal */}
      <Dialog open={initiativeModalOpen} onOpenChange={setInitiativeModalOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Target className="h-5 w-5" />
              Apply to Initiative
            </DialogTitle>
            <DialogDescription>
              Link this suggestion to an initiative for tracking, or apply without linking.
            </DialogDescription>
          </DialogHeader>
          
          <Tabs value={initiativeTab} onValueChange={(v) => setInitiativeTab(v as "existing" | "new")} className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="existing" disabled={!activeInitiatives || activeInitiatives.length === 0}>
                Existing Initiative
              </TabsTrigger>
              <TabsTrigger value="new">
                <Plus className="h-4 w-4 mr-1" />
                New Initiative
              </TabsTrigger>
            </TabsList>
            
            <TabsContent value="existing" className="space-y-4 mt-4">
              {activeInitiatives && activeInitiatives.length > 0 ? (
                <div className="space-y-2">
                  <Label>Select an initiative</Label>
                  <Select value={selectedInitiativeId} onValueChange={setSelectedInitiativeId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Choose an initiative..." />
                    </SelectTrigger>
                    <SelectContent>
                      {activeInitiatives.map((initiative) => (
                        <SelectItem key={initiative._id} value={initiative._id}>
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="text-xs">
                              {initiative.status}
                            </Badge>
                            {initiative.title}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No active initiatives. Create a new one instead.
                </p>
              )}
            </TabsContent>
            
            <TabsContent value="new" className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label htmlFor="initiative-title">Title</Label>
                <Input
                  id="initiative-title"
                  value={newInitiativeTitle}
                  onChange={(e) => setNewInitiativeTitle(e.target.value)}
                  placeholder="Initiative title..."
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="initiative-description">Description</Label>
                <Textarea
                  id="initiative-description"
                  value={newInitiativeDescription}
                  onChange={(e) => setNewInitiativeDescription(e.target.value)}
                  placeholder="Initiative description..."
                  rows={3}
                />
              </div>
            </TabsContent>
          </Tabs>
          
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button
              variant="ghost"
              onClick={handleApplyWithoutInitiative}
              disabled={isProcessing}
            >
              Apply without initiative
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setInitiativeModalOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleInitiativeSubmit}
                disabled={
                  isProcessing ||
                  (initiativeTab === "existing" && !selectedInitiativeId) ||
                  (initiativeTab === "new" && !newInitiativeTitle.trim())
                }
              >
                {isProcessing ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : null}
                {initiativeTab === "new" ? "Create & Apply" : "Apply"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Time Saved Modal */}
      <Dialog open={timeSavedModalOpen} onOpenChange={setTimeSavedModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>How much time did this save?</DialogTitle>
            <DialogDescription>
              Your feedback helps us improve suggestion quality
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <RadioGroup
              value={String(selectedTimeSaved)}
              onValueChange={(v) => setSelectedTimeSaved(v === "skip" ? "skip" : Number(v))}
            >
              {TIME_SAVED_OPTIONS.map((option) => (
                <div key={option.value} className="flex items-center space-x-2">
                  <RadioGroupItem value={String(option.value)} id={`time-${option.value}`} />
                  <Label htmlFor={`time-${option.value}`}>{option.label}</Label>
                </div>
              ))}
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="skip" id="time-skip" />
                <Label htmlFor="time-skip">Skip</Label>
              </div>
            </RadioGroup>
          </div>
          {appliedInitiativeId && (
            <div className="py-2 px-4 bg-muted rounded-md mb-4">
              <p className="text-sm text-muted-foreground">
                Linked to initiative.{" "}
                <Link to={`/initiatives/${appliedInitiativeId}`} className="text-primary hover:underline">
                  View initiative →
                </Link>
              </p>
            </div>
          )}
          <DialogFooter>
            <Button onClick={handleTimeSavedSubmit}>
              {selectedTimeSaved === "skip" ? "Skip" : "Submit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dismiss Reason Modal */}
      <Dialog open={dismissModalOpen} onOpenChange={setDismissModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Why are you dismissing this?</DialogTitle>
            <DialogDescription>
              Your feedback helps us improve suggestion relevance
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-4">
            <RadioGroup
              value={selectedDismissReason}
              onValueChange={(v) => setSelectedDismissReason(v as V0DismissReason)}
            >
              {Object.entries(V0_DISMISS_REASON_LABELS).map(([value, label]) => (
                <div key={value} className="flex items-center space-x-2">
                  <RadioGroupItem value={value} id={`dismiss-${value}`} />
                  <Label htmlFor={`dismiss-${value}`}>{label}</Label>
                </div>
              ))}
            </RadioGroup>
            
            {selectedDismissReason === "other" && (
              <div className="space-y-2">
                <Label htmlFor="other-reason">Please explain</Label>
                <Textarea
                  id="other-reason"
                  value={dismissReasonOther}
                  onChange={(e) => setDismissReasonOther(e.target.value)}
                  placeholder="Tell us more..."
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDismissModalOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDismissSubmit}
              disabled={!selectedDismissReason || isProcessing}
            >
              {isProcessing ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : null}
              Dismiss
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Modal */}
      <Dialog open={deleteModalOpen} onOpenChange={setDeleteModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this note?</DialogTitle>
            <DialogDescription>
              This will permanently delete the note and all its suggestions. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteModalOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setDeleteModalOpen(false);
                handleDeleteNote();
              }}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Delete Note
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Clarification Modal */}
      <Dialog open={clarificationModalOpen} onOpenChange={setClarificationModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Clarification from Shipit</DialogTitle>
            <DialogDescription>
              Here's additional context about this suggestion. You can now apply it with more confidence.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-4">
            <div className="p-3 bg-blue-50 dark:bg-blue-950/20 rounded text-sm">
              <Info className="h-4 w-4 inline mr-2" />
              This is a simulated clarification response. In a full implementation, this would call an LLM to provide context.
            </div>
            <div className="space-y-2">
              <Label htmlFor="clarification">Additional context (optional)</Label>
              <Textarea
                id="clarification"
                value={clarificationText}
                onChange={(e) => setClarificationText(e.target.value)}
                placeholder="Add your own notes or questions..."
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setClarificationModalOpen(false)}>
              Close
            </Button>
            <Button onClick={handleSubmitClarification} disabled={!clarificationText.trim()}>
              Save Context
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
