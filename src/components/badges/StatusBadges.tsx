import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { ConfidenceLevel, ChangeType, SuggestionStatus, InitiativeStatus, MeetingSource } from '@/types';

interface ConfidenceBadgeProps {
  level: ConfidenceLevel;
  className?: string;
}

export function ConfidenceBadge({ level, className }: ConfidenceBadgeProps) {
  return (
    <Badge 
      variant={
        level === 'high' ? 'success' : 
        level === 'medium' ? 'warning' : 
        'secondary'
      }
      className={className}
    >
      {level === 'high' ? 'High' : level === 'medium' ? 'Medium' : 'Low'}
    </Badge>
  );
}

interface ChangeTypeBadgeProps {
  type: ChangeType;
  className?: string;
}

export function ChangeTypeBadge({ type, className }: ChangeTypeBadgeProps) {
  const labels: Record<ChangeType, string> = {
    progress_update: 'Progress',
    timeline_change: 'Timeline',
    new_idea: 'New Idea'
  };

  return (
    <Badge variant="outline" className={className}>
      {labels[type]}
    </Badge>
  );
}

interface StatusBadgeProps {
  status: SuggestionStatus;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  return (
    <Badge 
      variant={
        status === 'applied' ? 'success' : 
        status === 'dismissed' ? 'destructive' : 
        'default'
      }
      className={className}
    >
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </Badge>
  );
}

interface InitiativeStatusBadgeProps {
  status: InitiativeStatus;
  className?: string;
}

export function InitiativeStatusBadge({ status, className }: InitiativeStatusBadgeProps) {
  const labels: Record<InitiativeStatus, string> = {
    planned: 'Planned',
    in_progress: 'In Progress',
    done: 'Done'
  };

  return (
    <Badge 
      variant={
        status === 'done' ? 'success' : 
        status === 'in_progress' ? 'default' : 
        'secondary'
      }
      className={className}
    >
      {labels[status]}
    </Badge>
  );
}

interface SourceBadgeProps {
  source: MeetingSource;
  className?: string;
}

export function SourceBadge({ source, className }: SourceBadgeProps) {
  return (
    <Badge variant="outline" className={cn("text-xs", className)}>
      {source === 'granola' ? 'Granola' : 'Gemini Notes'}
    </Badge>
  );
}
