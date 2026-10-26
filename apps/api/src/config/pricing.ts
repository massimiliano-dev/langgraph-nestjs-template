import { z } from 'zod';

/** USD per 1 million tokens. */
export const PriceSchema = z.object({ input: z.number().nonnegative(), output: z.number().nonnegative() });
export const PricingTableSchema = z.record(z.string().min(1), PriceSchema);
export type Price = z.infer<typeof PriceSchema>;
export type PricingTable = z.infer<typeof PricingTableSchema>;

/**
 * Default list prices, used only to estimate cost in traces and dashboards. Prices change: verify them
 * against your provider and contract, and override with `LLM_PRICING_JSON`, for example
 * `{"my-azure-deployment":{"input":0.4,"output":1.6}}`. Budgets are enforced in tokens, not dollars.
 */
export const DEFAULT_PRICING: PricingTable = {
  'gpt-4.1': { input: 2, output: 8 },
  'gpt-4.1-mini': { input: 0.4, output: 1.6 },
  'gpt-4.1-nano': { input: 0.1, output: 0.4 },
  'gpt-4o': { input: 2.5, output: 10 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
};

/** Estimated cost in USD, or `undefined` when the model is not in the table (unknown is not "free"). */
export function estimateCostUsd(
  pricing: PricingTable,
  model: string,
  tokens: { input: number; output: number },
): number | undefined {
  const price = pricing[model];
  if (!price) return undefined;
  return (tokens.input * price.input + tokens.output * price.output) / 1_000_000;
}
