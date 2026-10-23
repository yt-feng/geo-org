export type SiteLocale = "zh" | "en";
const publicPaths = new Set(["/", "/models", "/pricing", "/products"]);
export function localizedHref(path: string, locale: SiteLocale): string {
  if (!path.startsWith("/") || path.startsWith("//")) return path;
  const url = new URL(path, "https://tokvilo.com");
  const clean = url.pathname.replace(/^\/en(?=\/|$)/, "") || "/";
  if (publicPaths.has(clean)) {
    url.pathname = locale === "en" ? `/en${clean === "/" ? "" : clean}` : clean;
    url.searchParams.delete("lang");
  } else {
    url.pathname = clean;
    if (locale === "en") url.searchParams.set("lang", "en"); else url.searchParams.delete("lang");
  }
  return url.pathname + url.search + url.hash;
}
