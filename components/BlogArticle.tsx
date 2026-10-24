import Link from "next/link";
import { blogDate, blogLink, blogPath, blogPosts, blogStructuredData, type BlogLocale, type BlogPost } from "@/lib/blog";
import { BlogArtwork, BlogCard } from "./BlogCard";
import { PublicNav } from "./PublicNav";
import { PublicFooter } from "./PublicFooter";

export function BlogArticle({ post, locale }: { post: BlogPost; locale: BlogLocale }) {
  const english = locale === "en", content = post.content[locale];
  return <div className="market-page" lang={english ? "en" : "zh-CN"}><PublicNav /><main className="blog-main blog-article-main">
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(blogStructuredData(locale, post)).replace(/</g, "\\u003c") }} />
    <nav className="blog-breadcrumb" aria-label={english ? "Breadcrumb" : "面包屑导航"}><Link href={blogLink(locale, "/")}>tokvilo</Link><span aria-hidden="true">/</span><Link href={blogPath(locale)}>{english ? "Blog" : "博客"}</Link><span aria-hidden="true">/</span><span aria-current="page">{content.category}</span></nav>
    <header className="blog-article-header"><span className="landing-eyebrow">{content.category}</span><h1>{content.title}</h1><p>{content.description}</p><div className="blog-byline"><span className="blog-author-mark" aria-hidden="true">t</span><span>{post.author}</span><span className="blog-meta-divider" aria-hidden="true">·</span><time dateTime={post.date}>{blogDate(locale, post.date)}</time><span className="blog-meta-divider" aria-hidden="true">·</span><span>{english ? `${post.readMinutes} min read` : `约 ${post.readMinutes} 分钟`}</span></div></header>
    <div className="blog-article-cover"><BlogArtwork theme={post.theme} locale={locale} /></div>
    <div className="blog-reading-layout"><aside className="blog-contents"><span>{english ? "IN THIS GUIDE" : "本篇目录"}</span><nav aria-label={english ? "Article contents" : "文章目录"}>{content.sections.map(section => <a href={`#${section.id}`} key={section.id}>{section.title}</a>)}</nav><Link href={blogPath(locale)} className="blog-back-link">← {english ? "All guides" : "全部指南"}</Link></aside>
      <article className="blog-prose"><div className="blog-lead">{content.lead.map((paragraph, index) => <p key={index}>{paragraph}</p>)}</div>
        <section className="blog-takeaways" aria-labelledby="key-points"><h2 id="key-points">{english ? "What to take away" : "你会带走什么"}</h2><ul>{content.takeaways.map(item => <li key={item}>{item}</li>)}</ul></section>
        {content.sections.map(section => <section className="blog-prose-section" id={section.id} key={section.id}><h2>{section.title}</h2>{section.paragraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)}{section.list ? <ul>{section.list.map(item => <li key={item}>{item}</li>)}</ul> : null}
          {section.code ? <figure className="blog-code"><div><span>{section.code.language}</span><span>tokvilo</span></div><pre tabIndex={0} aria-label={section.code.caption}><code>{section.code.value}</code></pre><figcaption>{section.code.caption}</figcaption></figure> : null}
          {section.table ? <div className="blog-table-wrap" role="region" aria-label={section.title} tabIndex={0}><table><thead><tr>{section.table.headers.map(header => <th key={header} scope="col">{header}</th>)}</tr></thead><tbody>{section.table.rows.map((row, index) => <tr key={index}>{row.map((cell, cellIndex) => cellIndex === 0 ? <th key={cellIndex} scope="row">{cell}</th> : <td key={cellIndex}>{cell}</td>)}</tr>)}</tbody></table></div> : null}
        </section>)}
        <section className="blog-article-cta"><span className="landing-eyebrow">YOUR NEXT STEP</span><h2>{content.cta.title}</h2><p>{content.cta.description}</p><Link className="button button-primary" href={blogLink(locale, content.cta.href)}>{content.cta.label} ↗</Link></section>
      </article>
    </div>
    <section className="blog-related" aria-labelledby="related-guides"><div className="blog-section-label"><h2 id="related-guides">{english ? "Continue exploring" : "继续阅读"}</h2><Link href={blogPath(locale)}>{english ? "All guides" : "全部指南"} ↗</Link></div><div className="blog-card-grid">{blogPosts.filter(item => item.slug !== post.slug).map(item => <BlogCard post={item} locale={locale} key={item.slug} />)}</div></section>
  </main><PublicFooter /></div>;
}
