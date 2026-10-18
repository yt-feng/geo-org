import { AUDIT_CHAT_MODELS, AUDIT_VIDEO_POLICIES, type AuditKind } from "./tokenhub-audit-cases";

type Json = Record<string, unknown>;
export type CatalogModel = { model: string; kind: AuditKind | "unknown"; label: string; sources: string[]; enabled: boolean | null };
export type CatalogSnapshotRow = { campaign_id: string; day: number; state: "fetching" | "succeeded" | "partial" | "failed"; attempt_count: number; next_attempt_at: string; models_json: string | null; models_hash: string | null; pricing_json: string | null; pricing_hash: string | null; catalog_json: string; error_json: string; fetched_at: string | null; updated_at: string };
function object(value: unknown): value is Json { return !!value && typeof value === "object" && !Array.isArray(value); }
function strings(value: unknown): string[] { return (Array.isArray(value) ? value : [value]).filter((item): item is string => typeof item === "string"); }
export function knownAuditModels(): CatalogModel[] {
  return [
    ...AUDIT_CHAT_MODELS.map(model => ({ model, kind: "chat" as const, label: model, sources: [], enabled: null })),
    { model: "dola-seedream-5-0-pro-260628", kind: "image", label: "dola-seedream-5-0-pro-260628", sources: [], enabled: null },
    ...Object.keys(AUDIT_VIDEO_POLICIES).map(model => ({ model, kind: "video" as const, label: model, sources: [], enabled: null })),
  ];
}
export function validCatalogSource(value: unknown, source: "models" | "pricing") {
  // An empty or malformed response cannot erase yesterday's verified model set.
  return object(value) && !value.error && value.success !== false && Array.isArray(value.data) && value.data.length > 0 &&
    (source === "models" ? value.object === "list" : typeof value.currencyCode === "string") &&
    value.data.every(item => object(item) && typeof item.id === "string" && item.id.length > 0 && item.id.length <= 200);
}
export function normalizeAuditCatalog(models: unknown, pricing: unknown): CatalogModel[] {
  const known = new Map(knownAuditModels().map(item => [item.model, item])), result = new Map<string, CatalogModel>();
  for (const [source, value] of [["models", models], ["pricing", pricing]] as const) {
    if (!object(value) || !Array.isArray(value.data)) continue;
    for (const raw of value.data) {
      if (!object(raw) || typeof raw.id !== "string" || !raw.id || raw.id.length > 200) continue;
      const deployments = Array.isArray(raw.deployments) ? raw.deployments.filter(object) : [];
      const types = [...strings(raw.modelType), ...strings(raw.capabilities), ...strings(raw.type)].join(" ").toLowerCase();
      const prices = deployments.map(item => item.pricing).filter(object);
      const kind = known.get(raw.id)?.kind ?? (prices.some(p => object(p.video)) || /video/.test(types) ? "video" : prices.some(p => object(p.fixed) && p.fixed.priceUnit === "image") || /image/.test(types) ? "image" : /chat|text|completion/.test(types) ? "chat" : "unknown");
      const prior = result.get(raw.id), label = typeof raw.label === "string" ? raw.label : typeof raw.name === "string" ? raw.name : prior?.label ?? raw.id;
      result.set(raw.id, { model: raw.id, kind: kind === "unknown" ? prior?.kind ?? kind : kind, label: label.slice(0, 200), sources: [...(prior?.sources ?? []), source], enabled: deployments.length ? deployments.some(item => item.enabled === true) : prior?.enabled ?? null });
    }
  }
  return Array.from(result.values());
}
