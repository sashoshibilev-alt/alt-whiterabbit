import { useState, useRef } from "react";
import { useMutation, useAction } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Upload, CalendarIcon, Loader2, Sparkles, Save } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { Id } from "../../convex/_generated/dataModel";

export default function AddNotePage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [meetingDate, setMeetingDate] = useState<Date | undefined>();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  
  const createNote = useMutation(api.notes.create);
  const generateSuggestions = useAction(api.suggestions.generate);

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Check file type
    if (!file.name.endsWith(".txt") && !file.name.endsWith(".md")) {
      toast({
        title: "Invalid file type",
        description: "Please upload a .txt or .md file",
        variant: "destructive",
      });
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      setBody(content);
      
      // Use filename as title if no title set
      if (!title) {
        const filename = file.name.replace(/\.(txt|md)$/, "");
        setTitle(filename);
      }
      
      toast({
        title: "File loaded",
        description: "File content has been loaded into the editor",
      });
    };
    reader.readAsText(file);
  };

  const handleSave = async (generateAfterSave: boolean) => {
    if (!body.trim()) {
      toast({
        title: "Note body required",
        description: "Please enter some meeting notes",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);
    if (generateAfterSave) {
      setIsGenerating(true);
    }

    try {
      const noteId = await createNote({
        title: title.trim() || undefined,
        body: body.trim(),
        meetingAt: meetingDate?.getTime(),
      });

      if (generateAfterSave) {
        toast({
          title: "Note saved",
          description: "Generating suggestions...",
        });

        try {
          await generateSuggestions({ noteId: noteId as Id<"notes"> });
          toast({
            title: "Suggestions generated",
            description: "AI suggestions are ready for review",
          });
        } catch (error) {
          toast({
            title: "Generation failed",
            description: "Note was saved but suggestion generation failed. You can retry later.",
            variant: "destructive",
          });
        }
      } else {
        toast({
          title: "Note saved",
          description: "Your note has been saved successfully",
        });
      }

      navigate(`/notes/${noteId}`);
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to save note. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
      setIsGenerating(false);
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-6 border-b bg-background">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate("/notes")}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold">Add Meeting Note</h1>
            <p className="text-muted-foreground mt-1">
              Paste your meeting notes or upload a file
            </p>
          </div>
        </div>
      </div>

      {/* Form */}
      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-3xl mx-auto space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Note Details</CardTitle>
              <CardDescription>
                Add a title and meeting date to help organize your notes
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="title">Title (optional)</Label>
                <Input
                  id="title"
                  placeholder="e.g., Sprint Planning - Week 4"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </div>
              
              <div className="space-y-2">
                <Label>Meeting Date (optional)</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "w-full justify-start text-left font-normal",
                        !meetingDate && "text-muted-foreground"
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {meetingDate ? format(meetingDate, "PPP") : "Select date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={meetingDate}
                      onSelect={setMeetingDate}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
              </div>
              
              <div className="text-sm text-muted-foreground">
                <span className="font-medium">Source:</span> Manual
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Meeting Notes</CardTitle>
              <CardDescription>
                Paste your notes directly or upload a .txt/.md file
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".txt,.md"
                  className="hidden"
                  onChange={handleFileUpload}
                />
                <Button
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="h-4 w-4 mr-2" />
                  Upload .txt/.md file
                </Button>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="body">Notes *</Label>
                <Textarea
                  id="body"
                  placeholder="Paste your meeting notes here...

Example:
- Discussed the new feature rollout timeline
- John mentioned we need to push the deadline to next week
- Action item: Review the design specs by Friday
- Budget approved for additional QA resources"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  className="min-h-[300px] font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground">
                  {body.length} characters
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Action Buttons */}
          <div className="flex gap-3 justify-end pb-6">
            <Button
              variant="outline"
              onClick={() => handleSave(false)}
              disabled={isSubmitting || !body.trim()}
            >
              {isSubmitting && !isGenerating ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              Save without suggestions
            </Button>
            <Button
              onClick={() => handleSave(true)}
              disabled={isSubmitting || !body.trim()}
            >
              {isGenerating ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4 mr-2" />
                  Save & generate suggestions
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
