// Token prices, in USD per 1M tokens.
//
// UNVERIFIED. Azure's pricing page currently shows placeholders for this model
// family, so these are third-party figures. Check them against
// https://azure.microsoft.com/pricing/details/cognitive-services/openai-service/
// before showing a cost figure to anyone who cares about it.
//
// The /insights page exposes these as editable inputs precisely because they
// cannot be measured — everything the app can measure (tokens, compute units,
// latency) is read from the API instead.

export const TOKEN_PRICES: Record<string, { input: number; output: number }> = {
  "gpt-5.4-mini": { input: 0.75, output: 4.5 },
  "gpt-5.4-nano": { input: 0.15, output: 0.9 },
  "text-embedding-3-small": { input: 0.02, output: 0 },
};

export const DEFAULT_PRICES = TOKEN_PRICES["gpt-5.4-mini"];

/** Cost of one answer in USD. Cached prompt tokens bill at a discount. */
export function answerCost(
  promptTokens: number,
  completionTokens: number,
  prices = DEFAULT_PRICES,
): number {
  return (
    (promptTokens / 1_000_000) * prices.input +
    (completionTokens / 1_000_000) * prices.output
  );
}

// AI Search Serverless bills per compute unit. The rate was unpublished while
// this was built (billing began 13 September 2026), so search cost is reported
// in compute units and converted only if a rate is supplied.
export const SEARCH_CU_RATE_UNKNOWN = true;
