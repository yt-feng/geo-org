/** Login may return to the model workspace, carrying only public selection data. */
export function safeAuthReturnPath(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048 || !value.startsWith("/playground")) return null;
  try {
    const url = new URL(value, "https://tokvilo.invalid");
    if (url.origin !== "https://tokvilo.invalid" || url.pathname !== "/playground") return null;
    const params = new URLSearchParams();
    const service = url.searchParams.get("service"), model = url.searchParams.get("model"), category = url.searchParams.get("category");
    if (service && ["gateway", "studio", "selected"].includes(service) && url.searchParams.getAll("service").length === 1) params.set("service", service);
    if (model && /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,199}$/.test(model) && url.searchParams.getAll("model").length === 1) params.set("model", model);
    if (category && ["image", "video", "text", "audio"].includes(category) && url.searchParams.getAll("category").length === 1) params.set("category", category);
    if (url.searchParams.get("lang") === "en") params.set("lang", "en");
    return `/playground${params.size ? `?${params}` : ""}`;
  } catch { return null; }
}
