import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { MetadataHead, mergeMetadata } from "../node_modules/vinext/dist/shims/metadata.js";

const require = createRequire(import.meta.url);
const source = path => readFile(new URL(`../${path}`, import.meta.url), "utf8");
function compile(text, dependencies = {}) {
  const mod = { exports: {} };
  vm.runInNewContext(ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
    module: mod, exports: mod.exports, URL, Headers, Request, Response,
    require: name => Object.hasOwn(dependencies, name) ? dependencies[name] : require(name),
  });
  return mod.exports;
}
const locale = compile(await source("lib/site-locale.ts"));
const credits = compile(await source("lib/credits.ts"));
const blog = compile(await source("lib/blog.ts"), { "./credits": credits });
const seo = compile(await source("lib/site-seo.ts"), { "./site-locale": locale, "./blog": blog });
const rootSource = await source("app/layout.tsx");
const rootDependencies = Object.fromEntries([...rootSource.matchAll(/import "(.+\.css)"/g)].map(match => [match[1], {}]));
async function renderLayout(path, extraHeaders = {}) {
  const headers = new Headers({ [seo.SITE_PATH_HEADER]: path, ...extraHeaders });
  const layout = compile(rootSource, {
    ...rootDependencies,
    "next/headers": { headers: async () => headers },
    "@/lib/site-seo": seo,
    "@/components/LocaleProvider": { LocaleProvider: ({ children }) => children },
    "@/components/SessionKeepAlive": { SessionKeepAlive: () => null },
  });
  return { metadata: await layout.generateMetadata(), html: renderToStaticMarkup(await layout.default({ children: "page" })) };
}
const headHtml = metadata => renderToStaticMarkup(React.createElement(MetadataHead, { metadata: mergeMetadata([metadata]) }));

test("public Chinese and English documents render canonical, reciprocal hreflang and indexable metadata", async () => {
  for (const path of locale.PUBLIC_SITE_PATHS) {
    for (const language of ["zh", "en"]) {
      const route = locale.localizedHref(path, language);
      const { metadata, html } = await renderLayout(route + "?utm_source=example");
      const head = headHtml(metadata);
      assert.match(html, new RegExp(`<html lang="${language === "en" ? "en" : "zh-CN"}"`));
      assert.match(head, /name="robots" content="index,\s*follow"/);
      assert.ok(head.includes(`rel="canonical" href="https://tokvilo.com${route}"`), route);
      for (const [lang, url] of Object.entries(seo.publicPageSeo(route).languages)) assert.ok(head.includes(`hrefLang="${lang}" href="${url}"`), route + ":" + lang);
      assert.doesNotMatch(head, /utm_source|localhost|noindex/);
    }
  }
});

test("private pages, unknown blog slugs and invalid paths stay out of search", async () => {
  for (const path of ["/dashboard", "/dashboard/wallet?lang=en", "/admin/billing", "/login", "/register", "/forgot-password", "/reset-password?code=opaque", "/api/model-catalog", "/playground?lang=en", "/studio", "/selected", "/tokenhub", "/blog/not-a-real-post", "/en/blog/not-a-real-post", "/unpublished", "", "//attacker.example/"]) {
    const head = headHtml((await renderLayout(path)).metadata);
    assert.match(head, /name="robots" content="noindex,\s*nofollow,\s*nocache"/, path);
    assert.doesNotMatch(head, /rel="canonical"|hrefLang=|opaque|attacker\.example/, path);
  }
  assert.match((await renderLayout("/login?lang=en")).html, /<html lang="en"/);
});

test("canonical origin is fixed and public language comes from route, not spoofed forwarding or query headers", async () => {
  const { metadata, html } = await renderLayout("/en/models?lang=zh", { host: "evil.example", "x-forwarded-host": "evil.example", "x-forwarded-proto": "http" });
  const head = headHtml(metadata);
  assert.match(head, /href="https:\/\/tokvilo.com\/en\/models"/);
  assert.doesNotMatch(head, /evil\.example|http:\/\//);
  assert.match(html, /<html lang="en"/);
  assert.equal(seo.siteLocaleForPath("/models?lang=en"), "zh");
});

test("each published article has localized canonical and translated description", () => {
  for (const post of blog.blogPosts) for (const language of ["zh", "en"]) {
    const path = locale.localizedHref(`/blog/${post.slug}`, language);
    const metadata = seo.siteMetadata(path);
    assert.equal(metadata.description, post.content[language].description);
    const head = headHtml(metadata);
    assert.ok(head.includes(`rel="canonical" href="https://tokvilo.com${path}"`));
    assert.ok(head.includes(`hrefLang="zh-CN" href="https://tokvilo.com/blog/${post.slug}"`));
    assert.ok(head.includes(`hrefLang="en" href="https://tokvilo.com/en/blog/${post.slug}"`));
  }
});

test("actual vinext metadata merge keeps one canonical and shares the translated page title", () => {
  for (const post of blog.blogPosts) for (const language of ["zh", "en"]) {
    const metadata = mergeMetadata([seo.siteMetadata(blog.blogPath(language, post.slug)), { title: { template: "%s · tokvilo" } }, blog.blogPageMetadata(language, post)]);
    const html = renderToStaticMarkup(React.createElement(MetadataHead, { metadata }));
    assert.equal((html.match(/rel="canonical"/g) || []).length, 1);
    assert.equal((html.match(/rel="alternate"/g) || []).length, 3);
    assert.equal(metadata.title, `${post.content[language].title} · tokvilo`);
    assert.equal(metadata.openGraph.type, "article");
    assert.equal(metadata.twitter.title, post.content[language].title);
    assert.equal(metadata.alternates.canonical, blog.blogCanonical(language, post.slug));
  }
  const model = mergeMetadata([seo.siteMetadata("/en/models"), { title: "AI model library" }]);
  assert.equal(model.openGraph.title, "AI model library · tokvilo");
  assert.equal(model.twitter.title, model.openGraph.title);
});

test("sitemap includes every public locale and published article exactly once with reciprocal alternatives", () => {
  const xml = seo.sitemapXml();
  const locations = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]);
  assert.equal(locations.length, (locale.PUBLIC_SITE_PATHS.length + blog.blogPosts.length) * 2);
  assert.equal(new Set(locations).size, locations.length);
  assert.match(xml, /xmlns:xhtml="http:\/\/www.w3.org\/1999\/xhtml"/);
  for (const path of locale.PUBLIC_SITE_PATHS) for (const language of ["zh", "en"]) assert.ok(locations.includes(seo.SITE_ORIGIN + locale.localizedHref(path, language)));
  for (const post of blog.blogPosts) {
    for (const language of ["zh", "en"]) assert.ok(locations.includes(seo.SITE_ORIGIN + locale.localizedHref(`/blog/${post.slug}`, language)));
    assert.ok(xml.includes(`<lastmod>${post.date}</lastmod>`));
  }
  assert.equal((xml.match(/hreflang="x-default"/g) || []).length, locations.length);
  for (const location of locations) assert.doesNotMatch(location, /dashboard|admin|login|register|api\/|playground|\?/);
});

test("robots permits public pages, excludes private routes, and blocks alternate hosts", () => {
  const robots = seo.robotsText("tokvilo.com");
  assert.match(robots, /^User-agent: \*\nAllow: \/\n/);
  for (const path of ["/api", "/dashboard", "/admin", "/login", "/reset-password", "/playground"]) assert.ok(robots.includes(`Disallow: ${path}\n`));
  assert.match(robots, /Sitemap: https:\/\/tokvilo.com\/sitemap.xml/);
  assert.equal(seo.robotsText("www.tokvilo.com"), robots);
  for (const host of ["localhost", "preview.workers.dev", "api.eco-geo.org"]) assert.equal(seo.robotsText(host), "User-agent: *\nDisallow: /\n");
});

const workerSource = await source("worker/index.ts");
function worker(handler) {
  const dependencies = Object.fromEntries([...workerSource.matchAll(/from "(\.\.\/lib\/[^\"]+)"/g)].map(match => [match[1], {}]));
  return compile(workerSource, { ...dependencies, "../lib/site-seo": seo, "vinext/server/image-optimization": { DEFAULT_DEVICE_SIZES: [], DEFAULT_IMAGE_SIZES: [] }, "vinext/server/app-router-entry": { default: { fetch: handler } } }).default;
}

test("real Worker discovery routes return XML/text and HEAD without invoking the app handler", async () => {
  const app = worker(() => { throw Error("Must not render app"); });
  for (const path of ["/robots.txt", "/sitemap.xml"]) {
    const response = await app.fetch(new Request(seo.SITE_ORIGIN + path), {}, {});
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), path.endsWith("xml") ? /application\/xml/ : /text\/plain/);
    assert.ok((await response.text()).length > 0);
    const head = await app.fetch(new Request(seo.SITE_ORIGIN + path, { method: "HEAD" }), {}, {});
    assert.equal(await head.text(), "");
    const post = await app.fetch(new Request(seo.SITE_ORIGIN + path, { method: "POST" }), {}, {});
    assert.equal(post.status, 405);
  }
});

test("Worker overwrites caller path header and only indexes successful public HTML", async () => {
  for (const [path, status, contentType, expected] of [
    ["/en/blog", 200, "text/html", "index, follow"],
    ["/models", 404, "text/html", "noindex, nofollow"],
    ["/models", 503, "text/html", "noindex, nofollow"],
    ["/models", 200, "text/x-component", "noindex, nofollow"],
    ["/api/model-catalog", 200, "application/json", "noindex, nofollow"],
    ["/admin/billing", 200, "text/html", "noindex, nofollow"],
    ["/login?lang=en", 200, "text/html", "noindex, nofollow"],
    ["/en/blog/missing", 404, "text/html", "noindex, nofollow"],
  ]) {
    let seenPath;
    const app = worker(request => { seenPath = request.headers.get(seo.SITE_PATH_HEADER); return new Response("fixture", { status, headers: { "content-type": contentType } }); });
    const response = await app.fetch(new Request(seo.SITE_ORIGIN + path, { headers: { [seo.SITE_PATH_HEADER]: "/" } }), {}, {});
    assert.equal(seenPath, path);
    assert.equal(response.headers.get("x-robots-tag"), expected, path);
    if (contentType === "text/html") assert.equal(response.headers.get("content-language"), seo.siteLocaleForPath(path) === "en" ? "en" : "zh-CN");
  }
  const app = worker(() => new Response("fixture", { headers: { "content-type": "text/html" } }));
  assert.equal((await app.fetch(new Request("https://preview.workers.dev/en/blog"), {}, {})).headers.get("x-robots-tag"), "noindex, nofollow");
});

test("Worker path propagation preserves signed webhook request bytes and authorization headers", async () => {
  const body = '{"event_type":"transaction.completed", "exact":"bytes"}\n';
  const app = worker(async request => {
    assert.equal(await request.text(), body);
    assert.equal(request.headers.get("paddle-signature"), "fixture-signature");
    assert.equal(request.headers.get("authorization"), "Bearer fixture");
    return new Response("{}", { headers: { "content-type": "application/json" } });
  });
  const response = await app.fetch(new Request(seo.SITE_ORIGIN + "/api/billing/paddle/webhook", { method: "POST", body, headers: { "paddle-signature": "fixture-signature", authorization: "Bearer fixture" } }), {}, {});
  assert.equal(response.status, 200);
});
