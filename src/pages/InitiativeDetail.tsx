import { useQuery, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Id } from "../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useNavigate, useParams, Link } from "react-router-dom";
import { ArrowLeft, Target, Calendar, Clock, FileText, CheckCircle2, Loader2, ExternalLink } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { V0_INITIATIVE_STATUS_LABELS, V0InitiativeStatus } from "@/types";

export default function InitiativeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();

  const data = useQuery(
    api.v0Initiatives.getWithSuggestions,
    id ? { id: id as Id<"v0Initiatives"> } : "skip"
  );
  
  const updateInitiative = useMutation(api.v0Initiatives.update);

  if (!id) {
    return <div>Invalid initiative ID</div>;
  }

  if (data === undefined) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (data === null) {
    return (
      <div className="h-full flex flex-col items-center justify-center">
        <Target className="h-12 w-12 text-muted-foreground/50 mb-4" />
        <h2 className="text-lg font-medium mb-2">Initiative not found</h2>
        <Button onClick={() => navigate("/initiatives")}>Back to initiatives</Button>
      </div>
    );
  }

  const { initiative, suggestions } = data;

  const handleStatusChange = async (newStatus: V0InitiativeStatus) => {
    try {
      await updateInitiative({
        id: initiative._id,
        status: newStatus,
      });
      toast({
        title: "Status updated",
        description: `Initiative status changed to ${V0_INITIATIVE_STATUS_LABELS[newStatus]}`,
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "Failed to update status",
        variant: "destructive",
      });
    }
  };

  const getStatusColor = (status: V0InitiativeStatus) => {
    switch (status) {
      case "draft":
        return "bg-gray-500";
      case "active":
        return "bg-blue-500";
      case "done":
        return "bg-green-500";
      default:
        return "bg-gray-500";
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-6 border-b bg-background shrink-0">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate("/initiatives")}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 mb-2">
              <Badge className={getStatusColor(initiative.status)}>
                {V0_INITIATIVE_STATUS_LABELS[initiative.status]}
              </Badge>
              <Select
                value={initiative.status}
                onValueChange={(v) => handleStatusChange(v as V0InitiativeStatus)}
              >
                <SelectTrigger className="w-[140px] h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="done">Done</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <h1 className="text-2xl font-bold">{initiative.title}</h1>
            <div className="flex items-center gap-4 text-sm text-muted-foreground mt-2">
              <div className="flex items-center gap-1">
                <Calendar className="h-4 w-4" />
                <span>Created {format(initiative.createdAt, "PPP")}</span>
              </div>
              <div className="flex items-center gap-1">
                <Clock className="h-4 w-4" />
                <span>Updated {formatDistanceToNow(initiative.updatedAt, { addSuffix: true })}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <ScrollArea className="flex-1">
        <div className="p-6 space-y-6 max-w-4xl">
          {/* Description */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Target className="h-5 w-5" />
                Description
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                {initiative.description || "No description provided."}
              </p>
            </CardContent>
          </Card>

          {/* Linked Suggestions */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-green-600" />
                Linked Suggestions ({suggestions.length})
              </CardTitle>
              <CardDescription>
                Suggestions that have been applied to this initiative
              </CardDescription>
            </CardHeader>
            <CardContent>
              {suggestions.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  No suggestions linked to this initiative yet.
                </p>
              ) : (
                <div className="space-y-4">
                  {suggestions.map((suggestion) => (
                    <div
                      key={suggestion._id}
                      className="p-4 rounded-lg border bg-green-50/50 dark:bg-green-950/20"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm mb-2">{suggestion.content}</p>
                          <div className="flex items-center gap-3 text-xs text-muted-foreground">
                            {suggestion.appliedAt && (
                              <span className="flex items-center gap-1">
                                <CheckCircle2 className="h-3 w-3 text-green-600" />
                                Applied {formatDistanceToNow(suggestion.appliedAt, { addSuffix: true })}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      
                      {/* Source Note */}
                      {suggestion.note && (
                        <>
                          <Separator className="my-3" />
                          <div className="flex items-start gap-2">
                            <FileText className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                            <div className="flex-1 min-w-0">
                              <Link
                                to={`/notes/${suggestion.noteId}`}
                                className="text-sm font-medium hover:underline flex items-center gap-1"
                              >
                                {suggestion.note.title || "Untitled Note"}
                                <ExternalLink className="h-3 w-3" />
                              </Link>
                              <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                                {suggestion.note.body}
                              </p>
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </ScrollArea>
    </div>
  );
}
