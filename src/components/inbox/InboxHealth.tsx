import { Card, CardContent } from '@/components/ui/card';
import { Inbox, CheckCircle, XCircle, TrendingUp } from 'lucide-react';

interface InboxHealthProps {
  pending: number;
  uniqueMeetings: number;
  applyRate: number;
  total: number;
}

export function InboxHealth({ pending, uniqueMeetings, applyRate, total }: InboxHealthProps) {
  return (
    <Card className="bg-gradient-to-r from-primary/5 to-primary/10 border-primary/20">
      <CardContent className="py-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary/10 rounded-lg">
              <Inbox className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-sm font-medium">
                You have <span className="text-primary font-bold">{pending}</span> pending suggestions 
                from <span className="text-primary font-bold">{uniqueMeetings}</span> meetings
              </p>
              <p className="text-xs text-muted-foreground">
                Review and apply to keep your roadmap up to date
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-6 text-sm">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-success" />
              <span className="text-muted-foreground">Apply rate:</span>
              <span className="font-medium">{applyRate}%</span>
            </div>
            <div className="text-muted-foreground">
              {total} total suggestions
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
