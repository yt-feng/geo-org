import Link from "next/link";
import { blogDate, blogPath, type BlogLocale, type BlogPost } from "@/lib/blog";

export function BlogArtwork({ theme, locale, compact = false }: { theme: BlogPost["theme"]; locale: BlogLocale; compact?: boolean }) {
  const words = theme === "start"
    ? locale === "en" ? ["DISCOVER", "CONFIGURE", "CREATE"] : ["发现模型", "配置参数", "发起创作"]
    : theme === "compare"
      ? locale === "en" ? ["TASK", "COMPARE", "DECIDE"] : ["确定任务", "对照比较", "选择模型"]
      : locale === "en" ? ["QUOTE", "RESERVE", "SETTLE"] : ["查看报价", "预留额度", "确认结算"];
  return <div className={`blog-artwork blog-artwork-${theme}${compact ? " is-compact" : ""}`} aria-hidden="true">
    <div className="blog-artwork-top"><span>TOKVILO / FIELD NOTES</span><span>{theme === "start" ? "01" : theme === "compare" ? "02" : "03"}</span></div>
    <div className="blog-artwork-flow">{words.map((word, index) => <div key={word}><span className="blog-artwork-node">{theme === "compare" ? <><i /><i /><i /></> : theme === "usage" ? <span className="blog-artwork-meter"><i /><i /><i /><i /></span> : index === 0 ? "⌘" : index === 1 ? "{ }" : "↗"}</span><span>{word}</span></div>)}</div>
    <div className="blog-artwork-bottom"><span>{locale === "en" ? "A practical guide" : "从理解到使用"}</span><span>tokvilo ↗</span></div>
  </div>;
}

export function BlogCard({ post, locale, featured = false }: { post: BlogPost; locale: BlogLocale; featured?: boolean }) {
  const content = post.content[locale];
  return <article className={`blog-card${featured ? " blog-card-featured" : ""}`}>
    <Link className="blog-card-link" href={blogPath(locale, post.slug)} aria-labelledby={`post-title-${post.slug}`}>
      <BlogArtwork theme={post.theme} locale={locale} compact={!featured} />
      <div className="blog-card-copy"><div className="blog-card-meta"><span>{content.category}</span><span>{locale === "en" ? `${post.readMinutes} min read` : `约 ${post.readMinutes} 分钟`}</span></div>
        <h2 id={`post-title-${post.slug}`}>{content.title}</h2><p>{content.description}</p>
        <div className="blog-card-bottom"><time dateTime={post.date}>{blogDate(locale, post.date)}</time><span>{locale === "en" ? "Read the guide" : "阅读指南"} <span aria-hidden="true">↗</span></span></div>
      </div>
    </Link>
  </article>;
}
