import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ConfidenceBadge, ChangeTypeBadge, StatusBadge } from '@/components/badges/StatusBadges';
import { Suggestion, Initiative } from '@/types';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { AlertTriangle, ChevronRight, Link2Off, XCircle, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';

interface SuggestionCardProps {
  suggestion: Suggestion;
  initiative?: Initiative;
  onSelect: () => void;
  onQuickDismiss: () => void;
  isSelected?: boolean;
  onNavigateToSource?: (sectionId: string) => void;
}

export function SuggestionCard({
  suggestion,
  initiative,
  onSelect,
  onQuickDismiss,
  isSelected,
  onNavigateToSource
}: SuggestionCardProps) {
  const [evidenceOpen, setEvidenceOpen] = useState(false);

  // Use suggestion context if available, otherwise fall back to legacy fields
  const displayTitle = suggestion.suggestion?.title || suggestion.title;
  const displayBody = suggestion.suggestion?.body;
  const evidencePreview = suggestion.suggestion?.evidencePreview;
  const sourceSectionId = suggestion.suggestion?.sourceSectionId;

  // Legacy change preview for backward compatibility
  const changePreview = !suggestion.suggestion ? (
    suggestion.proposedChange.commentText?.slice(0, 80) ||
    (suggestion.proposedChange.before && suggestion.proposedChange.after
      ? `${suggestion.proposedChange.before} → ${suggestion.proposedChange.after}`
      : suggestion.proposedChange.backlogTitle)
  ) : null;

  const handleCardClick = () => {
    if (sourceSectionId && onNavigateToSource) {
      onNavigateToSource(sourceSectionId);
    } else {
      onSelect();
    }
  };

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
          <div className="flex-1 min-w-0" onClick={handleCardClick}>
            <div className="flex items-center gap-2 mb-1">
              <ChangeTypeBadge type={suggestion.changeType} />
              <ConfidenceBadge level={suggestion.confidence} />
              <StatusBadge status={suggestion.status} />
              {suggestion.isEdited && (
                <Badge variant="outline" className="text-xs">Edited</Badge>
              )}
            </div>

            <h4 className="font-medium text-sm mb-1 truncate">{displayTitle}</h4>

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

            {displayBody && (
              <p className="text-xs text-muted-foreground mb-2 line-clamp-3">
                {displayBody}
              </p>
            )}

            {changePreview && (
              <p className="text-xs text-muted-foreground mb-2 line-clamp-1">
                {changePreview}
              </p>
            )}

            {evidencePreview && evidencePreview.length > 0 && (
              <Collapsible open={evidenceOpen} onOpenChange={setEvidenceOpen}>
                <CollapsibleTrigger
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors mb-1"
                  onClick={(e) => e.stopPropagation()}
                >
                  <ChevronDown className={cn("h-3 w-3 transition-transform", evidenceOpen && "rotate-180")} />
                  Evidence
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="pl-4 space-y-1 mb-2">
                    {evidencePreview.slice(0, 2).map((line, idx) => (
                      <p key={idx} className="text-xs italic text-muted-foreground">
                        "{line}"
                      </p>
                    ))}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )}

            {!suggestion.suggestion && (
              <p className="text-xs italic text-muted-foreground line-clamp-1">
                "{suggestion.evidenceQuote}"
              </p>
            )}

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
