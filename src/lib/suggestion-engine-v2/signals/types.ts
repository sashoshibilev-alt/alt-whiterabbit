export type SignalType =
  | "FEATURE_DEMAND"
  | "PLAN_CHANGE"
  | "SCOPE_RISK"
  | "BUG";

export type SuggestedLabel = "idea" | "project_update" | "risk" | "bug";

export interface Signal {
  signalType: SignalType;
  label: SuggestedLabel;
  proposedType: "idea" | "project_update" | "bug" | "risk";
  confidence: number;
  sentence: string;
  sentenceIndex: number;
}
