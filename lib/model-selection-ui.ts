import { modelRequestKind, type CatalogModel } from "./model-catalog";

export type SelectionRate = { dimension: string; unit: string; retailMicrousd: number; condition?: string; label?: string; tierMinInputTokens?: number; tierMaxInputTokens?: number | null };
export type SelectionPrice = { model: string; provider: string; kind: string; billingReady?: boolean; rates: SelectionRate[] };
export type SelectionPricing = { models: SelectionPrice[]; observedAt: string };
export const publicService = (value?: string) => value === "tokenhub" ? "studio" as const : value === "selected" ? "selected" as const : "gateway" as const;
export const modelSelectionKey = (model: CatalogModel) => `${publicService(model.upstream)}:${model.id}`;
export const isChatModel = (model: CatalogModel) => model.category === "text" && modelRequestKind(model.id, model.category) === "chat";
export const selectionPrice = (model: CatalogModel, prices?: SelectionPrice[]) => prices?.find(price => price.model === model.id && publicService(price.provider) === publicService(model.upstream));
export const dollarRate = (value: number) => `$${(value / 1_000_000).toLocaleString("en-US", { maximumFractionDigits: 6 })}`;
export function selectionModels(catalog: CatalogModel[], prices: SelectionPrice[]) {
  return catalog.filter(isChatModel).map(model => ({ ...model, service: publicService(model.upstream), requestKind: "chat" as const,
    // A price entry alone does not establish service credentials or image-input support.
    available: model.available === true && selectionPrice(model, prices)?.billingReady === true,
    inputModalities: ["text" as const],
  }));
}
export function selectionPrices(prices: SelectionPrice[], inputTokens = 2_000) {
  return prices.flatMap(price => {
    const applicable = (rate: SelectionRate) => rate.unit === "1M_tokens" && ((!rate.condition && !rate.dimension.includes(":")) ||
      (/^tier\d+:/.test(rate.dimension) && typeof rate.tierMinInputTokens === "number" && (rate.tierMaxInputTokens === null || typeof rate.tierMaxInputTokens === "number") && inputTokens > rate.tierMinInputTokens && (rate.tierMaxInputTokens === null || inputTokens <= rate.tierMaxInputTokens)));
    const input = price.rates.find(rate => /(?:^|:)input$/.test(rate.dimension) && applicable(rate));
    const output = price.rates.find(rate => /(?:^|:)output$/.test(rate.dimension) && applicable(rate));
    if (!input || !output || input.dimension.replace(/input$/, "") !== output.dimension.replace(/output$/, "") || !Number.isFinite(input.retailMicrousd) || !Number.isFinite(output.retailMicrousd) || input.retailMicrousd < 0 || output.retailMicrousd < 0) return [];
    return [{ modelId: price.model, service: publicService(price.provider), inputUsdPerMillion: input.retailMicrousd / 1_000_000, outputUsdPerMillion: output.retailMicrousd / 1_000_000 }];
  });
}
