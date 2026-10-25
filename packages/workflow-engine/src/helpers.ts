import { isTerminal, type RunState, type StopReason } from "@ads/shared-types";
import type { EngineContext, StepSignals, TransitionResult } from "./types";

export const STATE_ORDER: readonly RunState[] = [
  "INITIALIZED",
  "CHECKOUT",
  "ANALYSIS",
  "ISSUE_TRIAGE",
  "REPAIR_PLANNING",
  "PATCH_GENERATION",
  "TARGETED_TESTS",
  "FULL_REGRESSION",
  "INDEPENDENT_REVIEW",
  "QUALITY_GATE",
];

export function stateIndex(s: RunState): number {
  const i = STATE_ORDER.indexOf(s);
  if (i >= 0) return i;
  if (s === "NEXT_ITERATION") return STATE_ORDER.indexOf("QUALITY_GATE");
  return STATE_ORDER.length;
}

export function budgetExhausted(ctx: EngineContext): StopReason | undefined {
  if (ctx.nowMs - ctx.startedAtMs > ctx.budget.maxRuntimeMs) return "budget_exhausted";
  if (ctx.tokensUsed > ctx.budget.maxTokenBudget) return "budget_exhausted";
  return undefined;
}

export function findRepeatedFailure(ctx: EngineContext): StopReason | undefined {
  for (const count of Object.values(ctx.failureFingerprints)) {
    if (count > ctx.budget.maxRepeatedFailures) return "repeated_failure";
  }
  return undefined;
}

export function recordFailure(ctx: EngineContext, fingerprint: string): EngineContext {
  return {
    ...ctx,
    failureFingerprints: {
      ...ctx.failureFingerprints,
      [fingerprint]: (ctx.failureFingerprints[fingerprint] ?? 0) + 1,
    },
  };
}

export function fail(cur: EngineContext, signals: StepSignals): EngineContext {
  return recordFailure(cur, signals.failureFingerprint ?? `step_failed_${cur.state}`);
}

export function finish(
  cur: EngineContext,
  applied: TransitionResult["applied"],
  stopReason?: StopReason,
  forceState?: RunState,
  reason?: string,
): TransitionResult {
  let context = cur;
  if (forceState && !isTerminal(cur.state)) {
    applied.push({ from: cur.state, to: forceState, reason: reason ?? forceState });
    context = { ...cur, state: forceState };
  }
  return { context, applied, stopReason, terminal: isTerminal(context.state) };
}
