import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";
import { createElement } from "react";
import * as jsx from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

async function load(relative, mocks = {}) {
  const filename = new URL(relative, import.meta.url).pathname;
  const output = ts.transpileModule(await readFile(filename, "utf8"), { fileName: filename, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const compiled = { exports: {} };
  vm.runInNewContext(output, {
    module: compiled, exports: compiled.exports, Intl, Date,
    require: name => {
      if (name === "react/jsx-runtime") return jsx;
      if (name === "next/link") return { default: ({ children, ...props }) => createElement("a", props, children), __esModule: true };
      if (Object.hasOwn(mocks, name)) return mocks[name];
      throw new Error(`Unexpected import ${name}`);
    },
  }, { filename });
  return compiled.exports;
}
const blog = await load("../lib/blog.ts");
const card = await load("../components/BlogCard.tsx", { "@/lib/blog": blog });
const shared = {
  "@/lib/blog": blog, "./BlogCard": card,
  "./PublicNav": { PublicNav: () => createElement("nav", { "data-shell": "public-navigation" }) },
  "./PublicFooter": { PublicFooter: () => createElement("footer", { "data-shell": "public-footer" }) },
};
const article = await load("../components/BlogArticle.tsx", shared);
const index = await load("../components/BlogIndex.tsx", shared);
const missing = new Error("NEXT_HTTP_ERROR_FALLBACK;404");
const routes = {};
for (const locale of ["zh", "en"]) {
  const base = locale === "en" ? "../app/en/blog" : "../app/blog";
  routes[locale] = {
    index: await load(`${base}/page.tsx`, { "@/components/BlogIndex": index, "@/lib/blog": blog }),
    article: await load(`${base}/[slug]/page.tsx`, { "@/components/BlogArticle": article, "@/lib/blog": blog, "next/navigation": { notFound() { throw missing; } } }),
  };
}
const graph = html => JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
const plain = html => html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "").replace(/<[^>]+>/g, " ");

test("every original guide has paired substantial content and matching section anchors", () => {
  assert.equal(blog.blogPosts.length, 3);
  assert.equal(new Set(blog.blogPosts.map(post => post.slug)).size, 3);
  for (const post of blog.blogPosts) {
    assert.match(post.slug, /^[a-z0-9]+(?:-[a-z0-9]+)+$/);
    assert.equal(post.author, "tokvilo"); assert.equal(post.date, "2026-10-23");
    for (const locale of ["zh", "en"]) {
      const content = post.content[locale];
      assert.ok(content.title.length > 10); assert.ok(content.description.length > 30);
      assert.equal(content.takeaways.length, 3); assert.equal(content.sections.length, 5);
      const ids = content.sections.map(section => section.id);
      assert.equal(new Set(ids).size, ids.length);
      for (const section of content.sections) {
        assert.ok(section.paragraphs.length >= 2);
        assert.ok(section.paragraphs.join("").length >= 100);
        assert.ok(!section.table || section.table.rows.every(row => row.length === section.table.headers.length));
      }
      assert.ok(["/models", "/billing"].includes(content.cta.href));
    }
    assert.deepEqual(Array.from(post.content.en.sections, section => section.id), Array.from(post.content.zh.sections, section => section.id));
    assert.doesNotMatch(JSON.stringify(post.content.en), /[\u4e00-\u9fff]/);
    assert.doesNotMatch(JSON.stringify(post), /tokenhub|apimart|rkapi|xiaoxincodex|paddle|liandong|链动/i);
  }
});

test("article metadata and structured data use the matching canonical language and original author", async () => {
  for (const locale of ["zh", "en"]) {
    for (const post of blog.blogPosts) {
      const metadata = await routes[locale].article.generateMetadata({ params: Promise.resolve({ slug: post.slug }) });
      const canonical = `https://tokvilo.com${locale === "en" ? "/en" : ""}/blog/${post.slug}`;
      assert.equal(metadata.title, post.content[locale].title); assert.equal(metadata.description, post.content[locale].description);
      assert.equal(metadata.alternates.canonical, canonical);
      assert.equal(metadata.alternates.languages.en, `https://tokvilo.com/en/blog/${post.slug}`);
      assert.equal(metadata.alternates.languages["zh-CN"], `https://tokvilo.com/blog/${post.slug}`);
      assert.equal(metadata.openGraph.type, "article"); assert.equal(metadata.openGraph.url, canonical);
      assert.equal(metadata.robots.index, true); assert.equal(metadata.robots.follow, true);
      const structured = blog.blogStructuredData(locale, post)["@graph"];
      const posting = structured.find(item => item["@type"] === "BlogPosting");
      assert.equal(posting.url, canonical); assert.equal(posting.mainEntityOfPage, canonical);
      assert.equal(posting.author.name, "tokvilo"); assert.equal(posting.inLanguage, locale === "en" ? "en" : "zh-CN");
      assert.equal(posting.datePublished, "2026-10-23T00:00:00Z");
      assert.equal(structured[0].itemListElement.at(-1).item, canonical);
    }
  }
});

test("blog indexes server-render three real article links with language-correct content", () => {
  for (const locale of ["zh", "en"]) {
    const html = renderToStaticMarkup(routes[locale].index.default());
    assert.match(html, /data-shell="public-navigation"/); assert.match(html, /data-shell="public-footer"/);
    assert.equal((html.match(/<h1\b/g) || []).length, 1);
    for (const post of blog.blogPosts) {
      assert.ok(html.includes(`href="${blog.blogPath(locale, post.slug)}"`));
      assert.ok(html.includes(post.content[locale].title));
    }
    assert.ok(html.includes(`href="${locale === "en" ? "/en" : ""}/models"`));
    const listing = graph(html)["@graph"].find(item => item["@type"] === "Blog");
    assert.equal(listing.blogPost.length, 3);
    if (locale === "en") assert.doesNotMatch(plain(html), /[\u4e00-\u9fff]/);
  }
});

test("article routes server-render full content, working TOC anchors, related guides and localized CTAs", async () => {
  for (const locale of ["zh", "en"]) {
    for (const post of blog.blogPosts) {
      const html = renderToStaticMarkup(await routes[locale].article.default({ params: Promise.resolve({ slug: post.slug }) }));
      assert.equal((html.match(/<h1\b/g) || []).length, 1);
      assert.ok(html.includes(post.content[locale].title));
      for (const section of post.content[locale].sections) {
        assert.ok(html.includes(`href="#${section.id}"`)); assert.ok(html.includes(`id="${section.id}"`));
        assert.ok(plain(html).includes(section.title));
      }
      for (const related of blog.blogPosts.filter(item => item.slug !== post.slug)) assert.ok(html.includes(`href="${blog.blogPath(locale, related.slug)}"`));
      assert.ok(html.includes(`href="${blog.blogLink(locale, post.content[locale].cta.href)}"`));
      assert.equal(graph(html)["@graph"].filter(item => item["@type"] === "BlogPosting").length, 1);
      if (locale === "en") assert.doesNotMatch(plain(html), /[\u4e00-\u9fff]/);
    }
  }
});

test("unknown article slugs invoke real notFound in both page rendering and metadata", async () => {
  for (const locale of ["zh", "en"]) {
    for (const slug of ["missing-article", "constructor", "__proto__", "../models"]) {
      assert.equal(blog.getBlogPost(slug), undefined);
      await assert.rejects(routes[locale].article.default({ params: Promise.resolve({ slug }) }), error => error === missing);
      await assert.rejects(routes[locale].article.generateMetadata({ params: Promise.resolve({ slug }) }), error => error === missing);
    }
    assert.deepEqual(Array.from(routes[locale].article.generateStaticParams(), item => item.slug), Array.from(blog.blogPosts, post => post.slug));
  }
});

test("the public API example is uncredentialed and billing examples are labeled as hypothetical", () => {
  const start = blog.getBlogPost("getting-started-with-model-apis");
  for (const locale of ["zh", "en"]) {
    const code = start.content[locale].sections.find(section => section.code).code.value;
    assert.equal(code, 'curl --fail --show-error \\\n  "https://tokvilo.com/api/model-catalog"');
    assert.doesNotMatch(code, /Bearer|api[_-]?key|Authorization/i);
  }
  const billing = blog.getBlogPost("understanding-api-usage-and-billing");
  assert.match(billing.content.en.sections.find(section => section.id === "reservation-and-settlement").paragraphs.join(" "), /hypothetical example.*not a price for any model/);
  assert.match(billing.content.zh.sections.find(section => section.id === "reservation-and-settlement").paragraphs.join(" "), /假设例子，不代表任何模型的实际价格/);
});
