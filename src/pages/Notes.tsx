import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Plus, FileText, CheckCircle2, XCircle, Eye } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";

export default function NotesPage() {
  const navigate = useNavigate();
  const notes = useQuery(api.notes.list);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-6 border-b bg-background">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Meeting Notes</h1>
            <p className="text-muted-foreground mt-1">
              Paste your meeting notes to generate actionable suggestions
            </p>
          </div>
          <Button onClick={() => navigate("/notes/new")} size="lg">
            <Plus className="h-5 w-5 mr-2" />
            Add meeting note
          </Button>
        </div>
      </div>

      {/* Notes List */}
      <ScrollArea className="flex-1 p-6">
        {notes === undefined ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-pulse text-muted-foreground">Loading notes...</div>
          </div>
        ) : notes.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <FileText className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <h3 className="text-lg font-medium mb-2">No meeting notes yet</h3>
            <p className="text-muted-foreground mb-6 max-w-md">
              Add your first meeting note to start generating AI-powered suggestions 
              that help you take action on what was discussed.
            </p>
            <Button onClick={() => navigate("/notes/new")}>
              <Plus className="h-4 w-4 mr-2" />
              Add your first note
            </Button>
          </div>
        ) : (
          <div className="grid gap-4 max-w-4xl mx-auto">
            {notes.map((note) => (
              <Card 
                key={note._id} 
                className="cursor-pointer hover:shadow-md transition-shadow"
                onClick={() => navigate(`/notes/${note._id}`)}
              >
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <CardTitle className="text-lg truncate">
                        {note.title || "Untitled Note"}
                      </CardTitle>
                      <CardDescription className="mt-1">
                        {note.meetingAt 
                          ? `Meeting: ${new Date(note.meetingAt).toLocaleDateString()}`
                          : `Captured ${formatDistanceToNow(note.capturedAt, { addSuffix: true })}`
                        }
                      </CardDescription>
                    </div>
                    <Badge variant="secondary" className="ml-4 shrink-0">
                      {note.source === "manual" ? "Manual" : "Granola"}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground line-clamp-2 mb-4">
                    {note.body}
                  </p>
                  
                  {/* Suggestion stats */}
                  <div className="flex items-center gap-4 text-sm">
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <FileText className="h-4 w-4" />
                      <span>{note.totalSuggestions} suggestions</span>
                    </div>
                    
                    {note.totalSuggestions > 0 && (
                      <>
                        <div className="flex items-center gap-1.5 text-green-600">
                          <CheckCircle2 className="h-4 w-4" />
                          <span>{note.appliedCount} applied</span>
                        </div>
                        
                        {note.dismissedCount > 0 && (
                          <div className="flex items-center gap-1.5 text-orange-600">
                            <XCircle className="h-4 w-4" />
                            <span>{note.dismissedCount} dismissed</span>
                          </div>
                        )}
                        
                        {note.shownCount > 0 && (
                          <div className="flex items-center gap-1.5 text-blue-600">
                            <Eye className="h-4 w-4" />
                            <span>
                              {Math.round((note.appliedCount / note.shownCount) * 100)}% apply rate
                            </span>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
