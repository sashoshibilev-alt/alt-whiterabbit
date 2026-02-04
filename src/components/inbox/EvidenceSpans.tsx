/**
 * Evidence Spans Component
 * 
 * Displays evidence spans from beliefs with deep-links to meeting notes.
 */

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ExternalLink, ChevronDown, User, Clock, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useState } from 'react';

export interface EvidenceSpan {
  belief_id: string;
  meeting_id: string;
  note_id: string;
  start_char: number;
  end_char: number;
  snippet: string;
  speaker?: string;
  timestamp_ms?: number;
}

interface EvidenceSpansProps {
  spans: EvidenceSpan[];
  className?: string;
  defaultOpen?: boolean;
}

export function EvidenceSpans({ spans, className, defaultOpen = false }: EvidenceSpansProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  
  if (spans.length === 0) {
    return null;
  }
  
  // Group spans by note/meeting
  const groupedByNote = spans.reduce((acc, span) => {
    const key = span.note_id;
    if (!acc[key]) {
      acc[key] = [];
    }
    acc[key].push(span);
    return acc;
  }, {} as Record<string, EvidenceSpan[]>);
  
  return (
    <div className={cn("space-y-2", className)}>
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger asChild>
          <Button 
            variant="ghost" 
            size="sm" 
            className="flex items-center gap-2 w-full justify-between p-2"
          >
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">
                Evidence ({spans.length} {spans.length === 1 ? 'piece' : 'pieces'})
              </span>
            </div>
            <ChevronDown 
              className={cn(
                "h-4 w-4 text-muted-foreground transition-transform",
                isOpen && "transform rotate-180"
              )}
            />
          </Button>
        </CollapsibleTrigger>
        
        <CollapsibleContent>
          <div className="space-y-3 mt-2">
            {Object.entries(groupedByNote).map(([noteId, noteSpans]) => (
              <NoteEvidenceGroup 
                key={noteId}
                noteId={noteId}
                spans={noteSpans}
              />
            ))}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

interface NoteEvidenceGroupProps {
  noteId: string;
  spans: EvidenceSpan[];
}

function NoteEvidenceGroup({ noteId, spans }: NoteEvidenceGroupProps) {
  return (
    <Card className="border-muted">
      <CardContent className="p-3 space-y-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
          <FileText className="h-3 w-3" />
          <span>Meeting Note</span>
        </div>
        
        {spans.map((span, index) => (
          <EvidenceSpanItem key={index} span={span} />
        ))}
      </CardContent>
    </Card>
  );
}

interface EvidenceSpanItemProps {
  span: EvidenceSpan;
}

function EvidenceSpanItem({ span }: EvidenceSpanItemProps) {
  const handleViewInNotes = () => {
    // Deep link to note detail page with character offset
    const url = `/notes/${span.note_id}?highlight=${span.start_char}-${span.end_char}`;
    window.location.href = url;
  };
  
  return (
    <div className="space-y-1 p-2 rounded-md bg-muted/30 hover:bg-muted/50 transition-colors">
      {/* Metadata */}
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        {span.speaker && (
          <div className="flex items-center gap-1">
            <User className="h-3 w-3" />
            <span>{span.speaker}</span>
          </div>
        )}
        {span.timestamp_ms && (
          <div className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            <span>{formatTimestamp(span.timestamp_ms)}</span>
          </div>
        )}
      </div>
      
      {/* Snippet */}
      <blockquote className="text-sm italic border-l-2 border-primary/30 pl-3 py-1">
        "{span.snippet}"
      </blockquote>
      
      {/* View in notes link */}
      <Button 
        variant="link" 
        size="sm" 
        className="h-auto p-0 text-xs"
        onClick={handleViewInNotes}
      >
        <span>View in notes</span>
        <ExternalLink className="h-3 w-3 ml-1" />
      </Button>
    </div>
  );
}

/**
 * Format timestamp for display
 */
function formatTimestamp(ms: number): string {
  const date = new Date(ms);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
  
  if (diffDays === 0) {
    return 'Today';
  } else if (diffDays === 1) {
    return 'Yesterday';
  } else if (diffDays < 7) {
    return `${diffDays} days ago`;
  } else {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
}

/**
 * Inline Evidence Badge
 * 
 * Small badge to show evidence count, can be used inline in suggestion cards
 */
interface EvidenceBadgeProps {
  count: number;
  onClick?: () => void;
  className?: string;
}

export function EvidenceBadge({ count, onClick, className }: EvidenceBadgeProps) {
  return (
    <Badge 
      variant="secondary" 
      className={cn("text-xs cursor-pointer", className)}
      onClick={onClick}
    >
      <FileText className="h-3 w-3 mr-1" />
      {count} {count === 1 ? 'piece' : 'pieces'} of evidence
    </Badge>
  );
}

/**
 * Evidence Preview Tooltip Content
 * 
 * Shows the top evidence snippet in a tooltip for quick context
 */
interface EvidencePreviewProps {
  span: EvidenceSpan;
}

export function EvidencePreview({ span }: EvidencePreviewProps) {
  return (
    <div className="max-w-sm space-y-1">
      {span.speaker && (
        <div className="text-xs text-muted-foreground">
          {span.speaker}
        </div>
      )}
      <blockquote className="text-sm italic">
        "{span.snippet}"
      </blockquote>
    </div>
  );
}
