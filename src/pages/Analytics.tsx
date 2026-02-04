/**
 * Analytics Dashboard
 * 
 * View daily suggestion metrics and rule quality scores
 */

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Calendar, TrendingUp, TrendingDown, Target, AlertTriangle } from "lucide-react";
import { format, subDays } from "date-fns";

export default function AnalyticsPage() {
  const today = new Date();
  const yesterday = subDays(today, 1);
  
  const [selectedDate, setSelectedDate] = useState(format(yesterday, "yyyy-MM-dd"));
  
  // Get daily report for selected date
  const dailyReport = useQuery(api.dailyMetrics.getDailyReport, {
    dateUtc: selectedDate,
  });
  
  // Get top and low quality rules
  const topRules = useQuery(api.ruleQuality.getTopRules, { limit: 10 });
  const lowQualityRules = useQuery(api.ruleQuality.getLowQualityRules, { 
    threshold: -0.2, 
    limit: 10 
  });

  const formatPercentage = (value: number) => {
    return `${(value * 100).toFixed(1)}%`;
  };

  const formatNHI = (value: number) => {
    const sign = value >= 0 ? "+" : "";
    return `${sign}${(value * 100).toFixed(1)}%`;
  };

  return (
    <div className="h-full flex flex-col p-6 overflow-hidden">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Shipit Analytics</h1>
        <p className="text-muted-foreground mt-1">
          Behavioral learning metrics and rule quality scores
        </p>
      </div>

      <Tabs defaultValue="daily" className="flex-1 flex flex-col overflow-hidden">
        <TabsList className="mb-4">
          <TabsTrigger value="daily">Daily Report</TabsTrigger>
          <TabsTrigger value="rules">Rule Quality</TabsTrigger>
        </TabsList>

        {/* Daily Report Tab */}
        <TabsContent value="daily" className="flex-1 flex flex-col overflow-hidden space-y-4">
          <div className="flex items-end gap-4">
            <div className="flex-1">
              <Label htmlFor="date-picker">Select Date</Label>
              <Input
                id="date-picker"
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                max={format(yesterday, "yyyy-MM-dd")}
                className="max-w-xs"
              />
            </div>
            <Button
              variant="outline"
              onClick={() => setSelectedDate(format(yesterday, "yyyy-MM-dd"))}
            >
              Yesterday
            </Button>
          </div>

          <ScrollArea className="flex-1">
            {!dailyReport ? (
              <div className="text-center py-8 text-muted-foreground">
                Loading metrics...
              </div>
            ) : !dailyReport.global ? (
              <div className="text-center py-8 text-muted-foreground">
                No data available for {selectedDate}
              </div>
            ) : (
              <div className="space-y-6">
                {/* Global Metrics */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Calendar className="h-5 w-5" />
                      Global Metrics
                    </CardTitle>
                    <CardDescription>
                      Overall performance for {format(new Date(selectedDate), "PPPP")}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div>
                        <div className="text-sm text-muted-foreground">Suggestions Generated</div>
                        <div className="text-2xl font-bold">
                          {dailyReport.global.suggestionsGenerated}
                        </div>
                      </div>
                      <div>
                        <div className="text-sm text-muted-foreground">Applied</div>
                        <div className="text-2xl font-bold text-green-600">
                          {dailyReport.global.suggestionsApplied}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {formatPercentage(dailyReport.global.applyRate)}
                        </div>
                      </div>
                      <div>
                        <div className="text-sm text-muted-foreground">Dismissed</div>
                        <div className="text-2xl font-bold text-orange-600">
                          {dailyReport.global.suggestionsDismissed}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {formatPercentage(dailyReport.global.dismissRate)}
                        </div>
                      </div>
                      <div>
                        <div className="text-sm text-muted-foreground">NHI</div>
                        <div className={`text-2xl font-bold ${
                          dailyReport.global.nhi >= 0 ? "text-green-600" : "text-red-600"
                        }`}>
                          {formatNHI(dailyReport.global.nhi)}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {dailyReport.global.nhi >= 0 ? (
                            <span className="flex items-center gap-1">
                              <TrendingUp className="h-3 w-3" /> Positive
                            </span>
                          ) : (
                            <span className="flex items-center gap-1">
                              <TrendingDown className="h-3 w-3" /> Needs attention
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="mt-4 pt-4 border-t">
                      <div className="text-sm text-muted-foreground">Clarification Rate</div>
                      <div className="text-lg font-semibold">
                        {formatPercentage(dailyReport.global.clarificationRate)}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {dailyReport.global.clarificationRequests} requests
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* By Family */}
                {dailyReport.byFamily.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle>By Suggestion Family</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-3">
                        {dailyReport.byFamily.map((family) => (
                          <div key={family._id} className="p-3 border rounded-lg">
                            <div className="flex items-center justify-between mb-2">
                              <Badge variant="outline">{family.suggestionFamily}</Badge>
                              <Badge 
                                variant={family.nhi >= 0 ? "default" : "destructive"}
                              >
                                NHI: {formatNHI(family.nhi)}
                              </Badge>
                            </div>
                            <div className="grid grid-cols-3 gap-2 text-sm">
                              <div>
                                <span className="text-muted-foreground">Generated: </span>
                                {family.suggestionsGenerated}
                              </div>
                              <div>
                                <span className="text-muted-foreground">Applied: </span>
                                {family.suggestionsApplied} ({formatPercentage(family.applyRate)})
                              </div>
                              <div>
                                <span className="text-muted-foreground">Dismissed: </span>
                                {family.suggestionsDismissed} ({formatPercentage(family.dismissRate)})
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* By Surface */}
                {dailyReport.bySurface.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle>By UI Surface</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-3">
                        {dailyReport.bySurface.map((surface) => (
                          <div key={surface._id} className="p-3 border rounded-lg">
                            <div className="flex items-center justify-between mb-2">
                              <Badge variant="secondary">{surface.surface || "unknown"}</Badge>
                              <Badge 
                                variant={surface.nhi >= 0 ? "default" : "destructive"}
                              >
                                NHI: {formatNHI(surface.nhi)}
                              </Badge>
                            </div>
                            <div className="grid grid-cols-3 gap-2 text-sm">
                              <div>
                                <span className="text-muted-foreground">Generated: </span>
                                {surface.suggestionsGenerated}
                              </div>
                              <div>
                                <span className="text-muted-foreground">Applied: </span>
                                {surface.suggestionsApplied} ({formatPercentage(surface.applyRate)})
                              </div>
                              <div>
                                <span className="text-muted-foreground">Dismissed: </span>
                                {surface.suggestionsDismissed} ({formatPercentage(surface.dismissRate)})
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>
            )}
          </ScrollArea>
        </TabsContent>

        {/* Rule Quality Tab */}
        <TabsContent value="rules" className="flex-1 flex flex-col overflow-hidden space-y-4">
          <ScrollArea className="flex-1">
            <div className="space-y-6">
              {/* Top Performing Rules */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <TrendingUp className="h-5 w-5 text-green-600" />
                    Top Performing Rules
                  </CardTitle>
                  <CardDescription>
                    Rules with highest quality scores
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {!topRules || topRules.length === 0 ? (
                    <div className="text-center py-4 text-muted-foreground">
                      No data available yet
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {topRules.map((rule) => (
                        <div key={rule._id} className="p-3 border rounded-lg">
                          <div className="flex items-center justify-between mb-2">
                            <div className="font-mono text-sm">{rule.ruleOrPromptId}</div>
                            <Badge className="bg-green-600">
                              Score: {rule.qualityScore.toFixed(3)}
                            </Badge>
                          </div>
                          <div className="grid grid-cols-4 gap-2 text-xs">
                            <div>
                              <span className="text-muted-foreground">Apply: </span>
                              {formatPercentage(rule.applyRate)}
                            </div>
                            <div>
                              <span className="text-muted-foreground">Dismiss: </span>
                              {formatPercentage(rule.dismissRate)}
                            </div>
                            <div>
                              <span className="text-muted-foreground">NHI: </span>
                              {formatNHI(rule.nhi)}
                            </div>
                            <div>
                              <span className="text-muted-foreground">Total: </span>
                              {rule.totalGenerated}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Low Quality Rules */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <AlertTriangle className="h-5 w-5 text-orange-600" />
                    Rules Needing Attention
                  </CardTitle>
                  <CardDescription>
                    Rules with low quality scores that should be reviewed
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {!lowQualityRules || lowQualityRules.length === 0 ? (
                    <div className="text-center py-4 text-muted-foreground">
                      No low-quality rules detected
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {lowQualityRules.map((rule) => (
                        <div key={rule._id} className="p-3 border rounded-lg border-orange-300">
                          <div className="flex items-center justify-between mb-2">
                            <div className="font-mono text-sm">{rule.ruleOrPromptId}</div>
                            <Badge variant="destructive">
                              Score: {rule.qualityScore.toFixed(3)}
                            </Badge>
                          </div>
                          <div className="grid grid-cols-4 gap-2 text-xs">
                            <div>
                              <span className="text-muted-foreground">Apply: </span>
                              {formatPercentage(rule.applyRate)}
                            </div>
                            <div>
                              <span className="text-muted-foreground">Dismiss: </span>
                              {formatPercentage(rule.dismissRate)}
                            </div>
                            <div>
                              <span className="text-muted-foreground">NHI: </span>
                              {formatNHI(rule.nhi)}
                            </div>
                            <div>
                              <span className="text-muted-foreground">Total: </span>
                              {rule.totalGenerated}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </div>
  );
}
