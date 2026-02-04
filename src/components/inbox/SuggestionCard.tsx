import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ConfidenceBadge, ChangeTypeBadge, StatusBadge } from '@/components/badges/StatusBadges';
import { Suggestion, Initiative } from '@/types';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { AlertTriangle, ChevronRight, Link2Off, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SuggestionCardProps {
  suggestion: Suggestion;
  initiative?: Initiative;
  onSelect: () => void;
  onQuickDismiss: () => void;
  isSelected?: boolean;
}

export function SuggestionCard({ 
  suggestion, 
  initiative, 
  onSelect, 
  onQuickDismiss,
  isSelected 
}: SuggestionCardProps) {
  const changePreview = suggestion.proposedChange.commentText?.slice(0, 80) ||
    (suggestion.proposedChange.before && suggestion.proposedChange.after 
      ? `${suggestion.proposedChange.before} → ${suggestion.proposedChange.after}`
      : suggestion.proposedChange.backlogTitle);

  return (
    <Card 
      className={cn(
        "cursor-pointer transition-colors hover:bg-muted/50",
        isSelected && "ring-2 ring-primary bg-muted/30",
        suggestion.status !== 'pending' && "opacity-60"
      )}
    >
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0" onClick={onSelect}>
            <div className="flex items-center gap-2 mb-1">
              <ChangeTypeBadge type={suggestion.changeType} />
              <ConfidenceBadge level={suggestion.confidence} />
              <StatusBadge status={suggestion.status} />
              {suggestion.isEdited && (
                <Badge variant="outline" className="text-xs">Edited</Badge>
              )}
            </div>
            
            <h4 className="font-medium text-sm mb-1 truncate">{suggestion.title}</h4>
            
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
              {initiative ? (
                <span className="truncate">→ {initiative.name}</span>
              ) : (
                <span className="flex items-center gap-1 text-warning">
                  <Link2Off className="h-3 w-3" />
                  Unlinked
                </span>
              )}
            </div>

            {changePreview && (
              <p className="text-xs text-muted-foreground mb-2 line-clamp-1">
                {changePreview}
              </p>
            )}

            <p className="text-xs italic text-muted-foreground line-clamp-1">
              "{suggestion.evidenceQuote}"
            </p>

            {/* Warnings */}
            <div className="flex items-center gap-2 mt-2">
              {suggestion.isNonOwnerUpdate && (
                <Tooltip>
                  <TooltipTrigger>
                    <span className="inline-flex items-center gap-1 text-xs text-warning">
                      <AlertTriangle className="h-3 w-3" />
                      Non-owner
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    Update stated by non-owner; review carefully
                  </TooltipContent>
                </Tooltip>
              )}
              {suggestion.confidence === 'low' && (
                <Tooltip>
                  <TooltipTrigger>
                    <span className="text-xs text-muted-foreground">Ambiguous</span>
                  </TooltipTrigger>
                  <TooltipContent>
                    Low confidence suggestion - review evidence carefully
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <Button 
              variant="ghost" 
              size="sm"
              onClick={onSelect}
            >
              <span className="sr-only">Review</span>
              <ChevronRight className="h-4 w-4" />
            </Button>
            {suggestion.status === 'pending' && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button 
                    variant="ghost" 
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      onQuickDismiss();
                    }}
                  >
                    <span className="sr-only">Dismiss</span>
                    <XCircle className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Quick dismiss</TooltipContent>
              </Tooltip>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// Need to import Badge
import { Badge } from '@/components/ui/badge';
