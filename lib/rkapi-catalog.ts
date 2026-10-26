import snapshot from "./rkapi-catalog-snapshot.json";
import { getRkapiDisplayPricing } from "./rkapi-pricing";

export const rkapiCatalogObservedAt = snapshot.observedAt;

/** Public metadata only; source rates and credential group names never leave the server. */
export async function rkapiModelCatalog() {
  const pricing = await getRkapiDisplayPricing();
  return snapshot.models.map(model => ({ id: model.id, name: model.name, provider: model.manufacturer,
    category: model.category as "image" | "text", description: model.kind === "chat" ? "通过 tokvilo 精选使用对话与文本生成能力。" : "通过 tokvilo 精选使用图像生成能力。",
    capabilities: model.kind === "chat" ? ["文本生成", "对话"] : ["文生图"], docs: "/dashboard/docs?provider=selected", upstream: "selected" as const,
    available: pricing.models.find(price => price.model === model.id)?.billingReady === true, requestKind: model.kind as "chat" | "image" }));
}
