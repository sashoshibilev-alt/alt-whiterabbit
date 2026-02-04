import { useState } from 'react';
import { useShipItStore } from '@/hooks/useShipItStore';
import { Initiative } from '@/types';
import { InitiativeStatusBadge } from '@/components/badges/StatusBadges';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Calendar, User, MessageSquare, Clock, FileText, Link2 } from 'lucide-react';

export default function InitiativesPage() {
  const { initiatives, suggestions } = useShipItStore();
  const [selectedInitiative, setSelectedInitiative] = useState<Initiative | null>(null);

  const relatedSuggestions = suggestions.filter(s => s.targetInitiativeId === selectedInitiative?.id);

  return (
    <div className="h-full flex flex-col p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Initiatives</h1>
        <p className="text-muted-foreground">Mock Linear initiatives for roadmap updates</p>
      </div>

      <Card className="flex-1 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Owner</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Release Date</TableHead>
              <TableHead>Last Updated</TableHead>
              <TableHead className="text-center">Activity</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {initiatives.map(initiative => (
              <TableRow 
                key={initiative.id} 
                className="cursor-pointer hover:bg-muted/50"
                onClick={() => setSelectedInitiative(initiative)}
              >
                <TableCell className="font-medium">{initiative.name}</TableCell>
                <TableCell>
                  <span className="flex items-center gap-2">
                    <User className="h-4 w-4 text-muted-foreground" />
                    {initiative.owner}
                  </span>
                </TableCell>
                <TableCell>
                  <InitiativeStatusBadge status={initiative.status} />
                </TableCell>
                <TableCell>
                  {initiative.releaseDate ? (
                    <span className="flex items-center gap-2 text-sm">
                      <Calendar className="h-4 w-4 text-muted-foreground" />
                      {initiative.releaseDate.toLocaleDateString()}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {initiative.lastUpdated.toLocaleDateString()}
                </TableCell>
                <TableCell className="text-center">
                  <Badge variant="secondary">
                    {initiative.activityLog.length}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      {/* Initiative Detail Sheet */}
      <Sheet open={!!selectedInitiative} onOpenChange={() => setSelectedInitiative(null)}>
        <SheetContent className="w-[500px] sm:w-[600px] overflow-y-auto">
          {selectedInitiative && (
            <>
              <SheetHeader className="mb-6">
                <div className="flex items-center gap-2 mb-2">
                  <InitiativeStatusBadge status={selectedInitiative.status} />
                </div>
                <SheetTitle className="text-lg">{selectedInitiative.name}</SheetTitle>
              </SheetHeader>

              {/* Fields */}
              <Card className="mb-4">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <FileText className="h-4 w-4" />
                    Details
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground flex items-center gap-2">
                      <User className="h-4 w-4" /> Owner
                    </span>
                    <span className="font-medium">{selectedInitiative.owner}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground flex items-center gap-2">
                      <Calendar className="h-4 w-4" /> Release Date
                    </span>
                    <span className="font-medium">
                      {selectedInitiative.releaseDate?.toLocaleDateString() || '—'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground flex items-center gap-2">
                      <Clock className="h-4 w-4" /> Last Updated
                    </span>
                    <span>{selectedInitiative.lastUpdated.toLocaleDateString()}</span>
                  </div>
                  <Separator />
                  <p className="text-muted-foreground">{selectedInitiative.description}</p>
                </CardContent>
              </Card>

              {/* Activity Log */}
              <Card className="mb-4">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <MessageSquare className="h-4 w-4" />
                    Activity Log ({selectedInitiative.activityLog.length})
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-64">
                    <div className="space-y-4">
                      {selectedInitiative.activityLog.map(entry => (
                        <div key={entry.id} className="border-l-2 border-muted pl-4 py-1">
                          <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                            <span>{entry.author}</span>
                            <span>{entry.timestamp.toLocaleDateString()}</span>
                          </div>
                          <p className="text-sm">{entry.content}</p>
                          {entry.suggestionId && (
                            <Badge variant="outline" className="mt-1 text-xs">
                              From suggestion
                            </Badge>
                          )}
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </CardContent>
              </Card>

              {/* Related Suggestions */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Link2 className="h-4 w-4" />
                    Related Suggestions ({relatedSuggestions.length})
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {relatedSuggestions.length > 0 ? (
                    <div className="space-y-2">
                      {relatedSuggestions.map(s => (
                        <div 
                          key={s.id} 
                          className="p-2 rounded bg-muted/50 text-sm"
                        >
                          <div className="flex items-center justify-between mb-1">
                            <span className="font-medium truncate">{s.title}</span>
                            <Badge 
                              variant={
                                s.status === 'applied' ? 'success' : 
                                s.status === 'dismissed' ? 'destructive' : 
                                'default'
                              }
                              className="text-xs"
                            >
                              {s.status}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground truncate">
                            "{s.evidenceQuote}"
                          </p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No suggestions linked to this initiative.</p>
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
