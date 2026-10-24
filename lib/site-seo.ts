import type { Metadata } from "next";
import { blogPosts, getBlogPost } from "./blog";
import { localizedHref, PUBLIC_SITE_PATHS, type SiteLocale } from "./site-locale";

export const SITE_ORIGIN = "https://tokvilo.com";
// The Worker overwrites this header from the actual request URL. Never use a
// caller's Host/Forwarded headers to construct canonical URLs or language links.
export const SITE_PATH_HEADER = "x-tokvilo-request-path";

const descriptions: Record<string, Record<SiteLocale, string>> = {
  "/": { zh: "通过 tokvilo 发现 AI 模型，比较版本与价格，使用统一 API 和工作台构建应用。", en: "Discover AI models, compare versions and prices, and build with a unified API and playground on tokvilo." },
  "/models": { zh: "按厂商与模型系列浏览 tokvilo AI 模型，比较文本、图像、视频与音频模型的版本、价格和接口能力。", en: "Explore the tokvilo AI model library by provider and family. Compare text, image, video and audio models, prices and API capabilities." },
  "/pricing": { zh: "查看 tokvilo AI 模型服务的用量价格和计费说明，按需使用统一账户余额。", en: "Review tokvilo AI model usage prices and billing details. Pay for API and playground usage from one account balance." },
  "/products": { zh: "浏览 tokvilo 数字商品与服务，提交需求表单，24 小时内获得邮件回复。", en: "Browse tokvilo digital products and services. Submit an inquiry and receive an email reply within 24 hours." },
  "/billing": { zh: "了解 tokvilo API 服务用量包、在线支付和企业银行转账安排。", en: "Learn about tokvilo API service usage packs, online payments and enterprise bank transfer arrangements." },
  "/compare": { zh: "并排比较 AI 模型不同版本的代码、数学、写作、创意、推理能力与官方价格。查看来源与适用条件。", en: "Compare AI model versions for coding, math, writing, creativity, reasoning and official prices with sources and conditions." },
  "/advisor": { zh: "通过 tokvilo 模型选型问卷与 AI 对话，按任务、预算、上下文和输入需求获得模型建议。", en: "Find models for your task, budget, context and inputs with the tokvilo questionnaire and AI model advisor." },
  "/blog": { zh: "阅读 tokvilo 的 AI 模型、API 接入、工作台使用和用量计费指南。", en: "Read practical tokvilo guides to AI models, API integration, the playground and usage billing." },
  "/terms": { zh: "阅读 tokvilo 服务条款，了解账户、服务使用和支付安排。", en: "Read the tokvilo terms of service, including accounts, service usage and payment arrangements." },
  "/privacy": { zh: "了解 tokvilo 如何处理账户、服务使用与支持相关的数据。", en: "Learn how tokvilo handles data related to your account, service usage and support." },
  "/refunds": { zh: "了解 tokvilo 的退款政策、适用范围与申请方式。", en: "Review the tokvilo refund policy, its scope and how to request help." },
};

function routeUrl(path: string): URL | null {
  if (!path.startsWith("/") || path.startsWith("//")) return null;
  try { return new URL(path, SITE_ORIGIN); } catch { return null; }
}

export function siteLocaleForPath(path: string): SiteLocale {
  const page = publicPageSeo(path);
  if (page) return page.locale;
  const url = routeUrl(path);
  return url && (/^\/en(?:\/|$)/.test(url.pathname) || url.searchParams.get("lang") === "en") ? "en" : "zh";
}

export function publicPageSeo(path: string) {
  const url = routeUrl(path);
  if (!url) return null;
  const pathname = url.pathname.replace(/\/+$/, "") || "/";
  const locale: SiteLocale = /^\/en(?:\/|$)/.test(pathname) ? "en" : "zh";
  const clean = pathname.replace(/^\/en(?=\/|$)/, "") || "/";
  const post = clean.startsWith("/blog/") ? getBlogPost(clean.slice("/blog/".length)) : undefined;
  if (!(PUBLIC_SITE_PATHS as readonly string[]).includes(clean) && !post) return null;
  const languages = {
    "zh-CN": SITE_ORIGIN + localizedHref(clean, "zh"),
    en: SITE_ORIGIN + localizedHref(clean, "en"),
    "x-default": SITE_ORIGIN + localizedHref(clean, "zh"),
  };
  return {
    locale,
    canonical: languages[locale === "en" ? "en" : "zh-CN"],
    languages,
    description: post ? post.content[locale].description : descriptions[clean][locale],
  };
}

export function siteMetadata(path: string): Metadata {
  const page = publicPageSeo(path);
  const locale = page?.locale || siteLocaleForPath(path);
  const description = page?.description || descriptions["/"][locale];
  return {
    metadataBase: new URL(SITE_ORIGIN),
    title: { default: "tokvilo", template: "%s · tokvilo" },
    description,
    icons: { icon: "/icon.svg" },
    robots: page ? { index: true, follow: true } : { index: false, follow: false, nocache: true },
    ...(page ? { alternates: { canonical: page.canonical, languages: page.languages } } : {}),
    // Let the framework fill the final child page title/description after
    // metadata merging, rather than giving every share card the homepage title.
    openGraph: { type: "website", siteName: "tokvilo", ...(page ? { url: page.canonical } : {}), locale: locale === "en" ? "en_US" : "zh_CN", alternateLocale: [locale === "en" ? "zh_CN" : "en_US"] },
    twitter: { card: "summary" },
  };
}

export function isPublicSiteHost(hostname: string): boolean {
  return hostname === "tokvilo.com" || hostname === "www.tokvilo.com";
}

export function robotsTag(url: URL, response: Pick<Response, "status" | "headers">): string {
  return response.status === 200 && (response.headers.get("content-type") || "").includes("text/html") && isPublicSiteHost(url.hostname) && publicPageSeo(url.pathname)
    ? "index, follow"
    : "noindex, nofollow";
}

const privatePaths = ["/api", "/dashboard", "/admin", "/login", "/register", "/forgot-password", "/reset-password", "/playground", "/studio", "/selected", "/tokenhub"];

export function robotsText(hostname: string): string {
  if (!isPublicSiteHost(hostname)) return "User-agent: *\nDisallow: /\n";
  return ["User-agent: *", "Allow: /", ...privatePaths.map(path => `Disallow: ${path}`), "", `Sitemap: ${SITE_ORIGIN}/sitemap.xml`, ""].join("\n");
}

const escapeXml = (value: string): string => value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char]!);

export function sitemapXml(): string {
  const routes = [
    ...PUBLIC_SITE_PATHS.map(path => ({ path, date: undefined as string | undefined })),
    ...blogPosts.map(post => ({ path: `/blog/${post.slug}`, date: post.date })),
  ];
  const entries = routes.flatMap(({ path, date }) => (["zh", "en"] as const).map(locale => {
    const page = publicPageSeo(localizedHref(path, locale))!;
    const alternates = Object.entries(page.languages).map(([language, href]) => `<xhtml:link rel="alternate" hreflang="${language}" href="${escapeXml(href)}"/>`).join("");
    return `<url><loc>${escapeXml(page.canonical)}</loc>${date ? `<lastmod>${escapeXml(date)}</lastmod>` : ""}${alternates}</url>`;
  }));
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${entries.join("")}</urlset>\n`;
}

/** Explicit Worker routes avoid framework-specific metadata route discovery. */
export function discoveryResponse(request: Request): Response | null {
  const url = new URL(request.url);
  if (url.pathname !== "/robots.txt" && url.pathname !== "/sitemap.xml") return null;
  if (request.method !== "GET" && request.method !== "HEAD") return new Response(null, { status: 405, headers: { allow: "GET, HEAD", "x-robots-tag": "noindex, nofollow" } });
  const robots = url.pathname === "/robots.txt";
  const body = robots ? robotsText(url.hostname) : sitemapXml();
  return new Response(request.method === "HEAD" ? null : body, { headers: { "content-type": robots ? "text/plain; charset=utf-8" : "application/xml; charset=utf-8", "cache-control": "public, max-age=3600", "x-content-type-options": "nosniff" } });
}
