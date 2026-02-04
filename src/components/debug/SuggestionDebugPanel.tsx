/**
 * Suggestion Debug Panel
 *
 * Admin-only UI component for viewing debug information about suggestion generation.
 * Features:
 * - Run debug: Trigger a fresh debug run for a note
 * - Copy JSON: Copy the full debug report to clipboard
 * - Summary metrics: Quick overview of suggestion generation results
 * - Section accordion: Drill down into individual section details
 */

import { useState, useEffect } from "react";
import { useQuery, useAction } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import {
  Bug,
  Copy,
  Play,
  Loader2,
  ChevronDown,
  CheckCircle2,
  XCircle,
  AlertCircle,
} from "lucide-react";
import type {
  DebugRun,
  SectionDebug,
  CandidateSuggestionDebug,
  DebugRunSummary,
  DropStage,
  DropReason,
} from "@/lib/suggestion-engine-v2/debugTypes";
import { computeDebugRunSummary } from "@/lib/suggestion-engine-v2/debugTypes";

// ============================================
// Props
// ============================================

interface SuggestionDebugPanelProps {
  noteId: Id<"notes">;
  // Optional: control visibility from parent
  visible?: boolean;
}

// ============================================
// Main Component
// ============================================

export function SuggestionDebugPanel({
  noteId,
  visible = true,
}: SuggestionDebugPanelProps) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [localDebugRun, setLocalDebugRun] = useState<DebugRun | null>(null);
  const [persistSuggestions, setPersistSuggestions] = useState(true);

  // Fetch latest debug run from server
  const latestRunResult = useQuery(
    api.suggestionDebug.getLatestByNote,
    open ? { noteId } : "skip"
  );

  // Action to create a new debug run
  const createDebugRun = useAction(api.suggestionDebug.createDebugRun);

  // Use local state if available, otherwise use server data
  const debugRun = localDebugRun || latestRunResult?.debugRun || null;
  const summary = debugRun ? computeDebugRunSummary(debugRun) : null;

  // Don't render if not visible (e.g., non-admin user)
  if (!visible) {
    return null;
  }

  const handleRunDebug = async () => {
    setLoading(true);
    try {
      const result = await createDebugRun({
        noteId,
        verbosity: "REDACTED",
        persistSuggestions,
      });

      if (result.error) {
        toast({
          title: "Debug failed",
          description: result.error,
          variant: "destructive",
        });
        return;
      }

      if (result.debugRun) {
        setLocalDebugRun(result.debugRun);
        
        // Build description based on what was done
        let description = result.stored
          ? "Report saved and available for review."
          : `Report generated (not stored: ${result.storageSkippedReason})`;
        
        if (persistSuggestions && result.suggestionsCreated) {
          description += ` ${result.suggestionsCreated} suggestion${result.suggestionsCreated > 1 ? 's' : ''} added to list.`;
        } else if (persistSuggestions && result.suggestionsCreated === 0) {
          description += " No suggestions to persist.";
        }
        
        toast({
          title: "Debug run completed",
          description,
        });
      }
    } catch (err) {
      toast({
        title: "Error",
        description: "Failed to run debug. Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleCopyJson = async () => {
    if (!debugRun) return;

    try {
      await navigator.clipboard.writeText(JSON.stringify(debugRun, null, 2));
      toast({
        title: "Copied",
        description: "Debug JSON copied to clipboard.",
      });
    } catch {
      toast({
        title: "Error",
        description: "Failed to copy to clipboard.",
        variant: "destructive",
      });
    }
  };

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="border rounded-md p-2 mt-4 bg-muted/30"
    >
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="gap-2">
              <Bug className="h-4 w-4" />
              Debug
              <ChevronDown
                className={`h-4 w-4 transition-transform ${
                  open ? "rotate-180" : ""
                }`}
              />
            </Button>
          </CollapsibleTrigger>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={handleRunDebug}
              disabled={loading}
            >
              {loading ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Play className="h-4 w-4 mr-2" />
              )}
              Run debug
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleCopyJson}
              disabled={!debugRun}
            >
              <Copy className="h-4 w-4 mr-2" />
              Copy JSON
            </Button>
          </div>
        </div>
        {open && (
          <div className="flex items-center gap-2 px-2">
            <Checkbox
              id="persist-suggestions"
              checked={persistSuggestions}
              onCheckedChange={(checked) => setPersistSuggestions(checked === true)}
            />
            <label
              htmlFor="persist-suggestions"
              className="text-xs text-muted-foreground cursor-pointer"
            >
              Add suggestions to list
            </label>
          </div>
        )}
      </div>

      <CollapsibleContent className="mt-3">
        {!debugRun && latestRunResult === undefined && (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {!debugRun && latestRunResult !== undefined && (
          <p className="text-sm text-muted-foreground text-center py-4">
            No debug run yet for this note. Click "Run debug" to generate one.
          </p>
        )}

        {debugRun && summary && (
          <ScrollArea className="h-96 mt-2 pr-2">
            <DebugRunHeader debugRun={debugRun} />
            <DebugRunSummaryView summary={summary} />
            <SectionAccordion sections={debugRun.sections} />
          </ScrollArea>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

// ============================================
// Sub-components
// ============================================

function DebugRunHeader({ debugRun }: { debugRun: DebugRun }) {
  return (
    <div className="text-xs text-muted-foreground mb-3 space-y-1">
      <div className="flex gap-4 flex-wrap">
        <span>
          <strong>Run ID:</strong> {debugRun.meta.runId.slice(0, 8)}...
        </span>
        <span>
          <strong>Version:</strong> {debugRun.meta.generatorVersion}
        </span>
        <span>
          <strong>Time:</strong> {debugRun.runtimeStats?.totalMs}ms
        </span>
        <span>
          <strong>Lines:</strong> {debugRun.noteSummary.lineCount}
        </span>
      </div>
    </div>
  );
}

function DebugRunSummaryView({ summary }: { summary: DebugRunSummary }) {
  // Aggregation metrics per fix-plan-change-suppression plan
  const emittedCandidatesCount = summary.emittedCandidatesCount;
  const finalSuggestionsCount = emittedCandidatesCount - summary.droppedCandidatesCount;
  
  // Aggregation invariant check: emitted > 0 implies suggestions > 0
  const aggregationValid = emittedCandidatesCount === 0 || finalSuggestionsCount > 0;

  return (
    <div className="flex flex-col gap-2 text-xs mb-4 p-2 bg-background rounded border">
      <div className="flex gap-3 items-center flex-wrap">
        <span className="font-medium">Sections:</span>
        <Badge variant={summary.emittedCount > 0 ? "default" : "outline"}>
          {summary.emittedCount} emitted
        </Badge>
        <span className="text-muted-foreground">
          / {summary.totalSections} total
        </span>
      </div>

      {/* Aggregation metrics (per fix-plan-change-suppression plan) */}
      <div className="flex gap-3 items-center flex-wrap">
        <span className="font-medium">Candidates:</span>
        <Badge variant={finalSuggestionsCount > 0 ? "default" : "outline"}>
          {finalSuggestionsCount} final
        </Badge>
        <span className="text-muted-foreground">
          ({emittedCandidatesCount} emitted - {summary.droppedCandidatesCount} dropped)
        </span>
        {!aggregationValid && (
          <Badge variant="destructive" className="text-[10px]">
            ⚠ INVARIANT VIOLATION
          </Badge>
        )}
      </div>

      {Object.keys(summary.dropStageHistogram).length > 0 && (
        <div className="flex flex-wrap gap-1 items-center">
          <span className="font-medium mr-1">Drop stages:</span>
          {Object.entries(summary.dropStageHistogram).map(([stage, count]) => (
            <Badge key={stage} variant="outline" className="text-[10px]">
              {stage}: {count}
            </Badge>
          ))}
        </div>
      )}

      {summary.dropReasonTop.length > 0 && (
        <div className="flex flex-wrap gap-1 items-center">
          <span className="font-medium mr-1">Top reasons:</span>
          {summary.dropReasonTop.map(({ reason, count }) => (
            <Badge key={reason} variant="outline" className="text-[10px]">
              {reason}: {count}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

function SectionAccordion({ sections }: { sections: SectionDebug[] }) {
  if (sections.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-4">
        No sections found in note.
      </p>
    );
  }

  return (
    <Accordion type="multiple" className="w-full">
      {sections.map((section) => (
        <AccordionItem key={section.sectionId} value={section.sectionId}>
          <AccordionTrigger className="hover:no-underline">
            <SectionHeader section={section} />
          </AccordionTrigger>
          <AccordionContent>
            <SectionDetails section={section} />
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}

function SectionHeader({ section }: { section: SectionDebug }) {
  return (
    <div className="flex flex-col items-start gap-1 text-left w-full">
      <div className="flex items-center gap-2 w-full">
        <span className="font-medium text-sm truncate max-w-xs">
          {section.headingTextPreview || `Section ${section.sectionId}`}
        </span>
        {section.emitted ? (
          <Badge variant="default" className="ml-auto">
            <CheckCircle2 className="h-3 w-3 mr-1" />
            Emitted
          </Badge>
        ) : (
          <Badge variant="outline" className="ml-auto">
            <XCircle className="h-3 w-3 mr-1" />
            Dropped
          </Badge>
        )}
      </div>
      <div className="flex flex-wrap gap-2 text-[10px] text-muted-foreground">
        {section.dropStage && section.dropReason && (
          <span className="text-orange-600">
            {section.dropStage} / {section.dropReason}
          </span>
        )}
        <span>
          Lines {section.lineRange[0]}-{section.lineRange[1]}
        </span>
        <span>Score: {section.scoreSummary.overallScore.toFixed(2)}</span>
      </div>
    </div>
  );
}

function SectionDetails({ section }: { section: SectionDebug }) {
  return (
    <div className="space-y-3 text-xs">
      {/* Classification */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <span className="font-medium">Intent:</span>{" "}
          {section.intentClassification.topLabel} (
          {section.intentClassification.topScore.toFixed(2)})
        </div>
        <div>
          <span className="font-medium">Type:</span>{" "}
          {section.typeClassification.topLabel} (
          {section.typeClassification.topScore.toFixed(2)})
        </div>
      </div>

      {/* Decisions */}
      <div className="flex gap-2 items-center flex-wrap">
        <span className="font-medium">Decisions:</span>
        <Badge variant={section.decisions.isActionable ? "default" : "outline"}>
          {section.decisions.isActionable ? "Actionable" : "Not Actionable"}
        </Badge>
        <span className="text-muted-foreground">
          Intent: {section.decisions.intentLabel}, Type:{" "}
          {section.decisions.typeLabel}
        </span>
      </div>

      {/* Validators */}
      {section.validatorSummary && (
        <div className="flex flex-wrap gap-2 items-center">
          <span className="font-medium">Validators:</span>
          {section.validatorSummary.v1 && (
            <ValidatorBadge
              name="V1"
              passed={section.validatorSummary.v1.passed}
            />
          )}
          {section.validatorSummary.v2 && (
            <ValidatorBadge
              name="V2"
              passed={section.validatorSummary.v2.passed}
            />
          )}
          {section.validatorSummary.v3 && (
            <ValidatorBadge
              name="V3"
              passed={section.validatorSummary.v3.passed}
            />
          )}
        </div>
      )}

      {/* Error */}
      {section.errorMessage && (
        <div className="flex items-start gap-2 text-destructive bg-destructive/10 p-2 rounded">
          <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
          <div>
            <span className="font-medium">Error at {section.errorStage}:</span>{" "}
            {section.errorMessage}
          </div>
        </div>
      )}

      {/* Candidates */}
      {section.candidates.length > 0 && (
        <div className="space-y-2">
          <span className="font-medium">
            Candidates ({section.candidates.length}):
          </span>
          {section.candidates.map((candidate) => (
            <CandidateCard key={candidate.candidateId} candidate={candidate} />
          ))}
        </div>
      )}
    </div>
  );
}

function ValidatorBadge({ name, passed }: { name: string; passed: boolean }) {
  return (
    <Badge variant={passed ? "outline" : "destructive"}>
      {passed ? (
        <CheckCircle2 className="h-3 w-3 mr-1" />
      ) : (
        <XCircle className="h-3 w-3 mr-1" />
      )}
      {name} {passed ? "pass" : "fail"}
    </Badge>
  );
}

function CandidateCard({ candidate }: { candidate: CandidateSuggestionDebug }) {
  return (
    <div className="border rounded p-2 space-y-1.5 bg-background">
      <div className="flex items-center gap-2 flex-wrap">
        {candidate.emitted ? (
          <Badge variant="default" className="text-[10px]">
            Emitted
          </Badge>
        ) : (
          <Badge variant="outline" className="text-[10px]">
            Dropped
          </Badge>
        )}
        {!candidate.emitted && candidate.dropStage && candidate.dropReason && (
          <span className="text-[10px] text-muted-foreground">
            {candidate.dropStage} / {candidate.dropReason}
          </span>
        )}
        <span className="text-[10px] text-muted-foreground ml-auto">
          Score: {candidate.scoreBreakdown.overallScore.toFixed(2)}
        </span>
      </div>

      {candidate.suggestionPreview && (
        <div className="text-[11px] text-muted-foreground line-clamp-2">
          {candidate.suggestionPreview.preview}
        </div>
      )}

      {candidate.evidence && candidate.evidence.spans.length > 0 && (
        <div className="text-[10px] text-muted-foreground">
          Evidence lines: {candidate.evidence.lineIds.join(", ")}
        </div>
      )}

      {candidate.validatorResults.length > 0 && (
        <div className="flex gap-1 flex-wrap">
          {candidate.validatorResults.map((v, i) => (
            <Badge
              key={i}
              variant={v.passed ? "outline" : "destructive"}
              className="text-[9px]"
            >
              {v.name}: {v.passed ? "pass" : "fail"}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================
// Export
// ============================================

export default SuggestionDebugPanel;
