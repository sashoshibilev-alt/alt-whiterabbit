import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { SourceBadge } from '@/components/badges/StatusBadges';
import { Meeting, Suggestion } from '@/types';
import { Calendar, Clock, Users } from 'lucide-react';
import { cn } from '@/lib/utils';

interface MeetingGroupCardProps {
  meeting: Meeting;
  suggestions: Suggestion[];
  isSelected?: boolean;
  onClick: () => void;
}

export function MeetingGroupCard({ meeting, suggestions, isSelected, onClick }: MeetingGroupCardProps) {
  const pendingCount = suggestions.filter(s => s.status === 'pending').length;

  return (
    <Card 
      className={cn(
        "cursor-pointer transition-colors hover:bg-muted/50",
        isSelected && "ring-2 ring-primary bg-muted/30"
      )}
      onClick={onClick}
    >
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-medium text-sm leading-tight">{meeting.title}</h3>
          {pendingCount > 0 && (
            <Badge variant="default" className="shrink-0">
              {pendingCount}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Calendar className="h-3 w-3" />
            {meeting.date.toLocaleDateString()}
          </span>
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {meeting.duration}m
          </span>
          <span className="flex items-center gap-1">
            <Users className="h-3 w-3" />
            {meeting.attendeesCount}
          </span>
        </div>
        <div className="mt-2">
          <SourceBadge source={meeting.source} />
        </div>
      </CardContent>
    </Card>
  );
}
