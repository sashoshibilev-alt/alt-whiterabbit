/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as beliefPipeline from "../beliefPipeline.js";
import type * as beliefToInitiative from "../beliefToInitiative.js";
import type * as beliefToInitiativeV2 from "../beliefToInitiativeV2.js";
import type * as cron from "../cron.js";
import type * as dailyMetrics from "../dailyMetrics.js";
import type * as events from "../events.js";
import type * as initiativeAudit from "../initiativeAudit.js";
import type * as initiativeComments from "../initiativeComments.js";
import type * as initiativeEventStore from "../initiativeEventStore.js";
import type * as initiativeExample from "../initiativeExample.js";
import type * as initiativeExternalLinks from "../initiativeExternalLinks.js";
import type * as initiativeSuggestions from "../initiativeSuggestions.js";
import type * as initiatives from "../initiatives.js";
import type * as newInitiatives from "../newInitiatives.js";
import type * as notes from "../notes.js";
import type * as ruleQuality from "../ruleQuality.js";
import type * as suggestionDebug from "../suggestionDebug.js";
import type * as suggestionEngine from "../suggestionEngine.js";
import type * as suggestionRanking from "../suggestionRanking.js";
import type * as suggestions from "../suggestions.js";
import type * as v0Initiatives from "../v0Initiatives.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  beliefPipeline: typeof beliefPipeline;
  beliefToInitiative: typeof beliefToInitiative;
  beliefToInitiativeV2: typeof beliefToInitiativeV2;
  cron: typeof cron;
  dailyMetrics: typeof dailyMetrics;
  events: typeof events;
  initiativeAudit: typeof initiativeAudit;
  initiativeComments: typeof initiativeComments;
  initiativeEventStore: typeof initiativeEventStore;
  initiativeExample: typeof initiativeExample;
  initiativeExternalLinks: typeof initiativeExternalLinks;
  initiativeSuggestions: typeof initiativeSuggestions;
  initiatives: typeof initiatives;
  newInitiatives: typeof newInitiatives;
  notes: typeof notes;
  ruleQuality: typeof ruleQuality;
  suggestionDebug: typeof suggestionDebug;
  suggestionEngine: typeof suggestionEngine;
  suggestionRanking: typeof suggestionRanking;
  suggestions: typeof suggestions;
  v0Initiatives: typeof v0Initiatives;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
