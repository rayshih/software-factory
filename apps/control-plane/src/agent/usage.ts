import { usdFromMinorUnits } from "../money.js";

export interface UsageSnapshot {
  input_tokens?: number;
  output_tokens?: number;
  list_cost?: { amount: string; currency: string } | null;
}

export function usageToTracking(usage: UsageSnapshot | null | undefined): {
  costUsd: string;
  tokens: number;
} {
  const tokens = (usage?.input_tokens ?? 0) + (usage?.output_tokens ?? 0);
  const cost = usage?.list_cost;
  if (!cost || cost.currency !== "USD") return { costUsd: "0.000000", tokens };
  return { costUsd: usdFromMinorUnits(cost.amount), tokens };
}
