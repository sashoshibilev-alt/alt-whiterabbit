import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { useNavigate } from "react-router-dom";
import { CalendarIcon, FileText, Sparkles, Eye, CheckCircle2, XCircle, Clock, TrendingUp, Loader2, Target, Link2 } from "lucide-react";
import { format, subDays, startOfDay, endOfDay } from "date-fns";
import { cn } from "@/lib/utils";
import { V0_DISMISS_REASON_LABELS, V0DismissReason } from "@/types";
import { DateRange } from "react-day-picker";

export default function InternalReportPage() {
  const navigate = useNavigate();
  
  // Default to last 7 days
  const [dateRange, setDateRange] = useState<DateRange>({
    from: subDays(new Date(), 7),
    to: new Date(),
  });

  const startDate = dateRange.from ? startOfDay(dateRange.from).getTime() : 0;
  const endDate = dateRange.to ? endOfDay(dateRange.to).getTime() : Date.now();

  const reportData = useQuery(api.events.getReportData, { startDate, endDate });
  const recentEvents = useQuery(api.events.listRecent, { limit: 50 });

  if (reportData === undefined || recentEvents === undefined) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const dismissReasonEntries = Object.entries(reportData.dismissReasonDistribution) as [V0DismissReason, number][];
  const totalDismissed = dismissReasonEntries.reduce((sum, [_, count]) => sum + count, 0);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-6 border-b bg-background">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Internal Report</h1>
            <p className="text-muted-foreground mt-1">
              Analytics and observability for suggestion quality
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className={cn("justify-start text-left font-normal")}>
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {dateRange.from ? (
                    dateRange.to ? (
                      <>
                        {format(dateRange.from, "LLL dd")} - {format(dateRange.to, "LLL dd, y")}
                      </>
                    ) : (
                      format(dateRange.from, "LLL dd, y")
                    )
                  ) : (
                    "Pick a date range"
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="end">
                <Calendar
                  initialFocus
                  mode="range"
                  defaultMonth={dateRange.from}
                  selected={dateRange}
                  onSelect={(range) => range && setDateRange(range)}
                  numberOfMonths={2}
                />
              </PopoverContent>
            </Popover>
          </div>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-6 space-y-6">
          {/* Top-level Metrics */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardDescription className="flex items-center gap-1.5">
                  <FileText className="h-4 w-4" />
                  Notes Created
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold">{reportData.notesCreated}</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardDescription className="flex items-center gap-1.5">
                  <Sparkles className="h-4 w-4" />
                  Suggestions Generated
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold">{reportData.suggestionsGenerated}</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardDescription className="flex items-center gap-1.5">
                  <Eye className="h-4 w-4" />
                  Suggestions Shown
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold">{reportData.suggestionsShown}</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardDescription className="flex items-center gap-1.5">
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                  Applied
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold text-green-600">{reportData.suggestionsApplied}</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardDescription className="flex items-center gap-1.5">
                  <XCircle className="h-4 w-4 text-orange-600" />
                  Dismissed
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold text-orange-600">{reportData.suggestionsDismissed}</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardDescription className="flex items-center gap-1.5">
                  <TrendingUp className="h-4 w-4 text-blue-600" />
                  Apply Rate
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold text-blue-600">{reportData.applyRate}%</p>
              </CardContent>
            </Card>
          </div>

          {/* Tabs for different views */}
          <Tabs defaultValue="dismiss-reasons" className="space-y-4">
            <TabsList>
              <TabsTrigger value="dismiss-reasons">Dismiss Reasons</TabsTrigger>
              <TabsTrigger value="time-insights">Time Insights</TabsTrigger>
              <TabsTrigger value="initiatives">Initiatives</TabsTrigger>
              <TabsTrigger value="per-note">Per-Note Breakdown</TabsTrigger>
              <TabsTrigger value="raw-events">Raw Events</TabsTrigger>
            </TabsList>

            {/* Dismiss Reasons Tab */}
            <TabsContent value="dismiss-reasons">
              <Card>
                <CardHeader>
                  <CardTitle>Dismiss Reason Distribution</CardTitle>
                  <CardDescription>
                    Why suggestions are being dismissed
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {dismissReasonEntries.length === 0 ? (
                    <p className="text-muted-foreground text-center py-8">
                      No dismissed suggestions in this period
                    </p>
                  ) : (
                    <div className="space-y-4">
                      {dismissReasonEntries.map(([reason, count]) => {
                        const percentage = Math.round((count / totalDismissed) * 100);
                        return (
                          <div key={reason} className="space-y-2">
                            <div className="flex items-center justify-between text-sm">
                              <span>{V0_DISMISS_REASON_LABELS[reason] || reason}</span>
                              <span className="text-muted-foreground">
                                {count} ({percentage}%)
                              </span>
                            </div>
                            <div className="h-2 bg-muted rounded-full overflow-hidden">
                              <div
                                className="h-full bg-orange-500 rounded-full"
                                style={{ width: `${percentage}%` }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Time Insights Tab */}
            <TabsContent value="time-insights">
              <div className="grid gap-4 md:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Clock className="h-5 w-5" />
                      Average Time to Apply
                    </CardTitle>
                    <CardDescription>
                      How quickly suggestions are applied after being shown
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {reportData.avgTimeToApplySeconds !== null ? (
                      <p className="text-4xl font-bold">
                        {reportData.avgTimeToApplySeconds < 60
                          ? `${reportData.avgTimeToApplySeconds}s`
                          : `${Math.round(reportData.avgTimeToApplySeconds / 60)}m`}
                      </p>
                    ) : (
                      <p className="text-muted-foreground">No data yet</p>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <TrendingUp className="h-5 w-5 text-green-600" />
                      Average Time Saved
                    </CardTitle>
                    <CardDescription>
                      Self-reported time savings per applied suggestion
                      {reportData.timeSavedResponseCount > 0 && (
                        <span className="block mt-1 text-xs">
                          Based on {reportData.timeSavedResponseCount} responses
                        </span>
                      )}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {reportData.avgTimeSavedMinutes !== null ? (
                      <p className="text-4xl font-bold text-green-600">
                        {reportData.avgTimeSavedMinutes} min
                      </p>
                    ) : (
                      <p className="text-muted-foreground">No data yet</p>
                    )}
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            {/* Initiatives Tab */}
            <TabsContent value="initiatives">
              <div className="grid gap-4 md:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Link2 className="h-5 w-5 text-purple-600" />
                      Applied → Initiative Rate
                    </CardTitle>
                    <CardDescription>
                      Percentage of applied suggestions linked to an initiative
                      {reportData.totalAppliedCount > 0 && (
                        <span className="block mt-1 text-xs">
                          {reportData.appliedWithInitiativeCount} of {reportData.totalAppliedCount} applied suggestions
                        </span>
                      )}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {reportData.totalAppliedCount > 0 ? (
                      <div>
                        <p className="text-4xl font-bold text-purple-600">
                          {reportData.appliedToInitiativeRate}%
                        </p>
                        <div className="mt-3 h-2 bg-muted rounded-full overflow-hidden">
                          <div
                            className="h-full bg-purple-500 rounded-full transition-all"
                            style={{ width: `${reportData.appliedToInitiativeRate}%` }}
                          />
                        </div>
                      </div>
                    ) : (
                      <p className="text-muted-foreground">No applied suggestions yet</p>
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Target className="h-5 w-5 text-blue-600" />
                      Avg Suggestions per Initiative
                    </CardTitle>
                    <CardDescription>
                      Average number of suggestions linked to each initiative
                      {reportData.initiativesWithSuggestionsCount > 0 && (
                        <span className="block mt-1 text-xs">
                          Across {reportData.initiativesWithSuggestionsCount} initiative{reportData.initiativesWithSuggestionsCount !== 1 ? 's' : ''}
                        </span>
                      )}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {reportData.avgSuggestionsPerInitiative !== null ? (
                      <p className="text-4xl font-bold text-blue-600">
                        {reportData.avgSuggestionsPerInitiative}
                      </p>
                    ) : (
                      <p className="text-muted-foreground">No initiatives with suggestions yet</p>
                    )}
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            {/* Per-Note Breakdown Tab */}
            <TabsContent value="per-note">
              <Card>
                <CardHeader>
                  <CardTitle>Per-Note Breakdown</CardTitle>
                  <CardDescription>
                    Suggestion metrics for each note
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {reportData.noteBreakdown.length === 0 ? (
                    <p className="text-muted-foreground text-center py-8">
                      No notes in this period
                    </p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Note</TableHead>
                          <TableHead className="text-right">Suggestions</TableHead>
                          <TableHead className="text-right">Shown</TableHead>
                          <TableHead className="text-right">Applied</TableHead>
                          <TableHead className="text-right">Dismissed</TableHead>
                          <TableHead className="text-right">Apply Rate</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {reportData.noteBreakdown.map((row) => (
                          <TableRow
                            key={row.noteId}
                            className="cursor-pointer hover:bg-muted/50"
                            onClick={() => navigate(`/notes/${row.noteId}`)}
                          >
                            <TableCell className="font-medium max-w-[200px] truncate">
                              {row.title}
                            </TableCell>
                            <TableCell className="text-right">{row.totalSuggestions}</TableCell>
                            <TableCell className="text-right">{row.shown}</TableCell>
                            <TableCell className="text-right text-green-600">{row.applied}</TableCell>
                            <TableCell className="text-right text-orange-600">{row.dismissed}</TableCell>
                            <TableCell className="text-right">
                              <Badge variant={row.applyRate >= 30 ? "default" : "secondary"}>
                                {row.applyRate}%
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Raw Events Tab */}
            <TabsContent value="raw-events">
              <Card>
                <CardHeader>
                  <CardTitle>Raw Events (Debug)</CardTitle>
                  <CardDescription>
                    Last 50 suggestion events for debugging and verification
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {recentEvents.length === 0 ? (
                    <p className="text-muted-foreground text-center py-8">
                      No events recorded yet
                    </p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Timestamp</TableHead>
                          <TableHead>Event Type</TableHead>
                          <TableHead>Suggestion ID</TableHead>
                          <TableHead>Time to Event</TableHead>
                          <TableHead>Details</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {recentEvents.map((event) => (
                          <TableRow key={event._id}>
                            <TableCell className="font-mono text-xs">
                              {format(event.createdAt, "MMM dd HH:mm:ss")}
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant={
                                  event.eventType === "applied"
                                    ? "default"
                                    : event.eventType === "dismissed"
                                    ? "destructive"
                                    : "secondary"
                                }
                              >
                                {event.eventType}
                              </Badge>
                            </TableCell>
                            <TableCell className="font-mono text-xs">
                              {event.suggestionId.slice(0, 8)}...
                            </TableCell>
                            <TableCell>
                              {event.timeToEventSeconds !== undefined
                                ? `${event.timeToEventSeconds}s`
                                : "-"}
                            </TableCell>
                            <TableCell className="text-sm">
                              {event.eventType === "applied" &&
                                event.selfReportedTimeSavedMinutes !== undefined && (
                                  <span className="text-green-600">
                                    Saved {event.selfReportedTimeSavedMinutes}m
                                  </span>
                                )}
                              {event.eventType === "dismissed" && event.dismissReason && (
                                <span className="text-orange-600">
                                  {V0_DISMISS_REASON_LABELS[event.dismissReason] || event.dismissReason}
                                </span>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </ScrollArea>
    </div>
  );
}
