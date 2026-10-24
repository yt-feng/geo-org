export type SiteLocale = "zh" | "en";
export const PUBLIC_SITE_PATHS = ["/", "/models", "/pricing", "/products", "/billing", "/compare", "/advisor", "/blog", "/terms", "/privacy", "/refunds"] as const;
const publicPaths = new Set<string>(PUBLIC_SITE_PATHS);
export function isLocalizedPublicPath(path: string): boolean {
  return publicPaths.has(path) || /^\/blog\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(path);
}
export function localizedHref(path: string, locale: SiteLocale): string {
  if (!path.startsWith("/") || path.startsWith("//")) return path;
  const url = new URL(path, "https://tokvilo.com");
  const clean = url.pathname.replace(/^\/en(?=\/|$)/, "") || "/";
  if (isLocalizedPublicPath(clean)) {
    url.pathname = locale === "en" ? `/en${clean === "/" ? "" : clean}` : clean;
    url.searchParams.delete("lang");
  } else {
    url.pathname = clean;
    if (locale === "en") url.searchParams.set("lang", "en"); else url.searchParams.delete("lang");
  }
  return url.pathname + url.search + url.hash;
}
