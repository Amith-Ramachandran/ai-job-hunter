/**
 * Pricing table for cost calculation. Per-million-token rates as of 2026.
 *
 * Why per-model rates here rather than env: these are public OpenAI prices
 * that change a few times a year, and we want the source code (not infra
 * config) to be the audit trail of "what did this cost mean when we shipped".
 */
export interface ModelPricing {
  inputPerMTok: number;
  outputPerMTok: number;
}

export const MODEL_PRICING: Record<string, ModelPricing> = {
  'gpt-4o-mini': { inputPerMTok: 0.15, outputPerMTok: 0.6 },
  'gpt-4o': { inputPerMTok: 2.5, outputPerMTok: 10.0 },
  'gpt-4o-mini-2024-07-18': { inputPerMTok: 0.15, outputPerMTok: 0.6 },
};

/**
 * USD cost for a single LLM call.
 * Unknown model → 0 (logged as a warning at the call site).
 */
export function computeCostUsd(
  model: string | undefined | null,
  tokensIn: number,
  tokensOut: number,
): number | null {
  if (!model) return null;
  const p = MODEL_PRICING[model] ?? MODEL_PRICING[model.replace(/-\d{4}-\d{2}-\d{2}$/, '')];
  if (!p) return null;
  return Number(((tokensIn * p.inputPerMTok + tokensOut * p.outputPerMTok) / 1_000_000).toFixed(6));
}

/**
 * Truncates a user message to a sensible title for the sidebar.
 */
export function deriveSessionTitle(firstUserMessage: string): string {
  const trimmed = firstUserMessage.trim().split('\n')[0];
  return trimmed.length > 80 ? trimmed.slice(0, 77) + '…' : trimmed;
}
