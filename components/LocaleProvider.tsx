"use client";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { localizedHref, type SiteLocale } from "@/lib/site-locale";
const LocaleContext = createContext<SiteLocale>("zh");
export function LocaleProvider({ children, locale = "zh" }: { children: ReactNode; locale?: SiteLocale }) {
  const [current, setCurrent] = useState(locale);
  useEffect(() => {
    const update = () => {
      const url = new URL(window.location.href);
      const value = url.searchParams.get("lang") === "zh" ? "zh" : /^\/en(?:\/|$)/.test(url.pathname) || url.searchParams.get("lang") === "en" ? "en" : /^\/(login|register|forgot-password|reset-password)$/.test(url.pathname) ? "zh" : locale;
      setCurrent(value); document.documentElement.lang = value === "en" ? "en" : "zh-CN";
    };
    update(); window.addEventListener("popstate", update);
    return () => window.removeEventListener("popstate", update);
  }, [locale]);
  return <LocaleContext.Provider value={current}>{children}</LocaleContext.Provider>;
}
export function useSiteLocale() {
  const locale = useContext(LocaleContext);
  return { locale, isEnglish: locale === "en", t: (zh: string, en: string) => locale === "en" ? en : zh,
    href: (path: string) => localizedHref(path, locale) };
}
function languageTarget(path: string, locale: SiteLocale): string {
  const url = new URL(path, "https://tokvilo.com");
  // Auth callback material can still be present before a form's cleanup effect
  // runs. Never copy bearer tokens, one-use codes or fragments into an anchor.
  if (url.pathname === "/reset-password" || url.pathname === "/login") return url.pathname + (locale === "en" ? "?lang=en" : "");
  return localizedHref(path, locale);
}
export function LanguageSwitcher() {
  const { locale } = useSiteLocale();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = searchParams?.toString() || "";
  const route = (pathname || "/") + (query ? `?${query}` : "");
  const [browserLocation, setBrowserLocation] = useState<{ route: string; path: string } | null>(null);
  // Router state updates the actual href during client navigation. Native-history
  // filters and anchors supplement it only while they belong to that same route.
  const target = languageTarget(browserLocation?.route === route ? browserLocation.path : route, locale === "en" ? "zh" : "en");
  useEffect(() => {
    const update = () => setBrowserLocation({ route, path: window.location.pathname + window.location.search + window.location.hash });
    update();
    window.addEventListener("popstate", update);
    window.addEventListener("hashchange", update);
    window.addEventListener("tokvilo:locationchange", update);
    return () => { window.removeEventListener("popstate", update); window.removeEventListener("hashchange", update); window.removeEventListener("tokvilo:locationchange", update); };
  }, [route]);
  return <a className="language-switch" href={target} lang={locale === "en" ? "zh-CN" : "en"} aria-label={locale === "en" ? "切换为中文" : "Switch to English"}
    onClick={event => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
      event.preventDefault();
      const next = languageTarget(window.location.pathname + window.location.search + window.location.hash, locale === "en" ? "zh" : "en");
      if (window.location.pathname === "/reset-password") {
        window.history.replaceState(window.history.state, "", next);
        window.dispatchEvent(new PopStateEvent("popstate"));
      } else window.location.assign(next);
    }}>{locale === "en" ? "中文" : "EN"}</a>;
}
