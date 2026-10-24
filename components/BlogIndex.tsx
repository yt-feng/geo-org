import Link from "next/link";
import { blogLink, blogPosts, blogStructuredData, type BlogLocale } from "@/lib/blog";
import { BlogCard } from "./BlogCard";
import { PublicNav } from "./PublicNav";
import { PublicFooter } from "./PublicFooter";

export function BlogIndex({ locale }: { locale: BlogLocale }) {
  const english = locale === "en";
  return <div className="market-page" lang={english ? "en" : "zh-CN"}><PublicNav /><main className="blog-main">
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(blogStructuredData(locale)).replace(/</g, "\\u003c") }} />
    <header className="blog-intro"><div><span className="landing-eyebrow">TOKVILO / FIELD NOTES</span><h1>{english ? <>Know your tools.<br /><span>Build with clarity.</span></> : <>理解工具，<br /><span>把想法做出来。</span></>}</h1></div><p>{english ? "Practical guides to finding the right model, making your first request, and understanding what you use." : "从选对模型，到第一次请求，再到理解每一笔用量。把复杂的选择，变成清楚的工作流程。"}</p></header>
    <div className="blog-section-label"><h2>{english ? "The starting point" : "从这里开始"}</h2><span>{english ? "Guides from tokvilo" : "tokvilo 原创指南"}</span></div>
    <BlogCard post={blogPosts[0]} locale={locale} featured />
    <section className="blog-more-guides" aria-labelledby="more-guides"><div className="blog-section-label"><h2 id="more-guides">{english ? "Make the next step easier" : "让下一步更清楚"}</h2><span>{english ? "Models · Workflows · Usage" : "模型 · 工作流程 · 用量"}</span></div><div className="blog-card-grid">{blogPosts.slice(1).map(post => <BlogCard key={post.slug} post={post} locale={locale} />)}</div></section>
    <section className="blog-index-cta"><div><span className="landing-eyebrow">PUT IT INTO PRACTICE</span><h2>{english ? "Bring a task. Find a model." : "带着任务，找到合适的模型。"}</h2><p>{english ? "Explore model families and check the current capabilities, prices and interface status before you start." : "按模型系列浏览，先确认当前能力、价格与接口状态，再开始使用。"}</p></div><Link className="button button-primary" href={blogLink(locale, "/models")}>{english ? "Explore models" : "探索模型"} ↗</Link></section>
  </main><PublicFooter /></div>;
}
