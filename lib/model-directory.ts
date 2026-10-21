import { fetchApimartPricingPayload, parseApimartPricing } from "./apimart-pricing";
import { catalogEntry, modelCatalog, tokenhubModelCatalog, modelRequestKind, type ModelCategory, type CatalogModel, type ModelDirectorySource } from "./model-catalog";
import snapshot from "./model-directory-snapshot.json";
import { rkapiCatalogObservedAt, rkapiModelCatalog } from "./rkapi-catalog";

// Legacy top-level freshness refers to the gateway; each service has its own provenance.
type Directory = { models: CatalogModel[]; observedAt: string; live: boolean; sources: ModelDirectorySource[] };
const categories: Record<string, ModelCategory> = { llm: "text", image: "image", video: "video", audio: "audio" };
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
export function parseModelDirectory(payload: unknown): CatalogModel[] {
  if (!object(payload) || payload.success !== true || !object(payload.data) || !object(payload.data.models)) throw new Error("invalid_catalogue");
  // Model discovery must survive a missing/unsupported price table. Availability
  // is scoped to both the model ID and the implemented interface.
  let executable: Set<string> | null = null;
  try { executable = new Set(parseApimartPricing(payload).models.map(model => `${model.kind}:${model.model}`)); }
  catch { /* Preserve the live inventory with unconfirmed billing status. */ }
  const entries: CatalogModel[] = [];
  const seen = new Set<string>();
  for (const [kind, rows] of Object.entries(payload.data.models)) {
    if (!categories[kind] || !Array.isArray(rows)) continue;
    for (const row of rows) {
      if (!object(row) || typeof row.id !== "string" || !row.id || row.id.length > 200 || typeof row.name !== "string") throw new Error("invalid_model");
      const key = `${kind}:${row.id}`;
      if (seen.has(key)) throw new Error("duplicate_model");
      seen.add(key);
      const requestKind = modelRequestKind(row.id, categories[kind]);
      const pricingKind = requestKind === "music" ? "audio" : requestKind;
      entries.push(catalogEntry(row.id, row.name.slice(0, 200), categories[kind],
        executable ? executable.has(`${pricingKind}:${row.id}`) : undefined));
    }
  }
  if (!entries.length) throw new Error("empty_catalogue");
  return entries;
}

/** Directory availability is separate from actual successful paid execution. */
export async function getModelDirectory(): Promise<Directory> {
  const [gateway, selected] = await Promise.allSettled([fetchApimartPricingPayload(), rkapiModelCatalog()]);
  const selectedModels = selected.status === "fulfilled" ? selected.value : [];
  const sources: ModelDirectorySource[] = [{ service: "studio", observedAt: null, live: false }];
  if (selected.status === "fulfilled") sources.push({ service: "selected", observedAt: rkapiCatalogObservedAt, live: false });
  try {
    if (gateway.status === "rejected") throw gateway.reason;
    const models = parseModelDirectory(gateway.value);
    const observedAt = new Date().toISOString();
    return { models: [...tokenhubModelCatalog, ...models, ...selectedModels], observedAt, live: true,
      sources: [{ service: "gateway", observedAt, live: true }, ...sources] };
  } catch {
    // Preserve every last-observed model during a temporary catalogue outage.
    // Do not claim the snapshot confirms current pricing or call availability.
    return { models: [...tokenhubModelCatalog, ...modelCatalog, ...selectedModels], observedAt: snapshot.observedAt, live: false,
      sources: [{ service: "gateway", observedAt: snapshot.observedAt, live: false }, ...sources] };
  }
}
