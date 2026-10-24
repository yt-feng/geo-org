/** Login may return to model guidance, a model selection or an owned payment order, never bearer material. */
export function safeAuthReturnPath(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  const path = value.split(/[?#]/, 1)[0];
  if (path === "/advisor" || path === "/en/advisor") return path;
  if (!value.startsWith("/playground") && !value.startsWith("/dashboard/wallet")) return null;
  try {
    const url = new URL(value, "https://tokvilo.invalid");
    if (url.origin !== "https://tokvilo.invalid" || !["/playground", "/dashboard/wallet"].includes(url.pathname)) return null;
    const params = new URLSearchParams();
    if (url.pathname === "/dashboard/wallet") {
      if (url.searchParams.get("lang") === "en" && url.searchParams.getAll("lang").length === 1) params.set("lang", "en");
      const order = url.searchParams.get("paddle_order");
      if (order && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(order) && url.searchParams.getAll("paddle_order").length === 1) params.set("paddle_order", order);
      return `/dashboard/wallet${params.size ? `?${params}` : ""}`;
    }
    const service = url.searchParams.get("service"), model = url.searchParams.get("model"), category = url.searchParams.get("category");
    if (service && ["gateway", "studio", "selected"].includes(service) && url.searchParams.getAll("service").length === 1) params.set("service", service);
    if (model && /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,199}$/.test(model) && url.searchParams.getAll("model").length === 1) params.set("model", model);
    if (category && ["image", "video", "text", "audio"].includes(category) && url.searchParams.getAll("category").length === 1) params.set("category", category);
    if (url.searchParams.get("lang") === "en") params.set("lang", "en");
    return `/playground${params.size ? `?${params}` : ""}`;
  } catch { return null; }
}
