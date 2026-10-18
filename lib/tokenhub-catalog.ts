export type TokenHubModel = {
  id: string; name: string; provider: string; category: string[]; capabilities: string[];
  modelType: "chat" | "image" | "video" | "unknown"; sources: string[];
  accountAccess: "listed_by_authenticated_model_api" | "unverified_public_catalog";
  integrationStatus: "ready" | "catalog_only"; endpoint: string | null; taskEndpoint: string | null; limitations: string[];
};
type Json = Record<string, unknown>;
function object(value: unknown): value is Json { return !!value && typeof value === "object" && !Array.isArray(value); }
function strings(value: unknown): string[] { return (Array.isArray(value) ? value : [value]).filter((item): item is string => typeof item === "string" && item.length > 0 && item.length <= 80).slice(0, 32); }
function text(value: unknown, fallback = "") { return typeof value === "string" ? value.slice(0, 200) : fallback; }

export function validTokenHubCatalog(value: unknown, source: "models_api" | "pricing"): value is Json & { data: unknown[] } {
  return object(value) && !value.error && value.success !== false && Array.isArray(value.data) &&
    (source === "models_api" ? value.object === "list" : value.currencyCode === "USD" && value.data.length > 0 && value.data.every(item => object(item) && typeof item.id === "string" && item.id.length > 0 && item.id.length <= 200));
}

// This is discovery, not a fixed product allowlist. New IDs remain visible even
// when their transport has no supported adapter yet.
export function mergeTokenHubCatalog(models: unknown, pricing: unknown): TokenHubModel[] {
  const rawModels = new Map<string, { raw: Json; sources: string[]; deployments: Json[] }>();
  for (const [source, payload] of [["models_api", models], ["pricing", pricing]] as const) {
    if (!validTokenHubCatalog(payload, source)) continue;
    for (const raw of payload.data) {
      if (!object(raw) || typeof raw.id !== "string" || !raw.id || raw.id.length > 200) continue;
      const previous = rawModels.get(raw.id);
      rawModels.set(raw.id, { raw: { ...raw, ...(previous?.raw ?? {}) }, sources: Array.from(new Set([...(previous?.sources ?? []), source])), deployments: Array.isArray(raw.deployments) ? raw.deployments.filter(object) : previous?.deployments ?? [] });
    }
  }
  return Array.from(rawModels.entries()).map(([id, entry]) => {
    const { raw, sources, deployments } = entry;
    const declared = [...strings(raw.modelType), ...strings(raw.capabilities), ...strings(raw.type)];
    const types = declared.join(" ").toLowerCase(), providers = strings(raw.baseProviderTypes);
    const rates = deployments.map(item => item.pricing).filter(object);
    const isVideo = /video/.test(types) || rates.some(rate => object(rate.video));
    const isImage = /image/.test(types) || rates.some(rate => object(rate.fixed) && rate.fixed.priceUnit === "image");
    const isChat = /chat|text|language|llm|completion/.test(types) || providers.includes("openai") && rates.some(rate => object(rate.input) && object(rate.output));
    const modelType = isVideo ? "video" : isImage ? "image" : isChat ? "chat" : "unknown";
    const supported = modelType === "chat" || modelType === "video" && /^(?:dreamina|doubao)-seedance-2-(?:0(?:-fast|-mini)?|5)(?:-\d{6})?$/.test(id) || modelType === "image" && /^dola-seedream-5-0-pro-\d{6}$/.test(id);
    const endpoint = !supported ? null : modelType === "chat" ? "/api/tokenhub/v1/chat/completions" : modelType === "image" ? "/api/tokenhub/v3/images/generations" : "/api/tokenhub/v3/contents/generations/tasks";
    return {
      id, name: text(raw.name, text(raw.label, id)), provider: text(raw.provider, text(raw.owned_by, text(raw.providerName))),
      category: Array.from(new Set([...(modelType === "unknown" ? [] : [modelType]), ...strings(raw.modelType), ...strings(raw.capabilities)])),
      capabilities: supported ? modelType === "chat" ? ["chat_completions"] : modelType === "image" ? ["image_generation"] : ["video_generation", "video_task_polling", "video_task_cancellation"] : strings(raw.capabilities),
      modelType, sources, accountAccess: sources.includes("models_api") ? "listed_by_authenticated_model_api" : "unverified_public_catalog",
      integrationStatus: supported ? "ready" : "catalog_only", endpoint,
      taskEndpoint: supported && modelType === "video" ? "/api/tokenhub/v3/contents/generations/tasks/{task_id}" : null,
      limitations: supported ? ["non_streaming_json_only", ...(modelType === "video" ? ["eco_geo_owned_tasks_only", "idempotency_key_required"] : [])] : ["adapter_not_verified"],
    } satisfies TokenHubModel;
  });
}
