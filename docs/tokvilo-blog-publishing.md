# tokvilo 博客发布

文章数据统一维护在 `lib/blog.ts` 的 `blogPosts`，同一条记录包含中文和英文内容。博客页面由服务端渲染，无需为每篇文章创建新的页面文件。

## 添加文章

1. 复制一条现有 `BlogPost`，填写唯一 `slug`、真实发布日期 `date`（`YYYY-MM-DD`）、`author: "tokvilo"`、预计阅读分钟数 `readMinutes` 和插画主题 `theme`（`start`、`compare` 或 `usage`）。
2. 同时完成 `content.zh` 与 `content.en`：标题、摘要、分类、导语、要点、正文 `sections` 和结尾行动入口 `cta`。两种语言使用相同的章节 `id`，供目录锚点使用；段落、列表、代码和表格按现有类型填写。
3. `slug` 使用小写英文与连字符，发布后保持稳定。不要直接改动已发布的路径；确需换路径时，应另行添加旧路径重定向。`date` 保留原始发布日期，目前也用于文章 `dateModified` 与 sitemap 的 `lastmod`；若要独立记录修订时间，需要扩展字段及对应生成逻辑。
4. 数组顺序决定展示顺序：第一篇是博客列表主推文章，首页展示前 3 篇。将新文章放到希望展示的位置即可。

正文使用 tokvilo 品牌，保留有用的产品步骤；涉及服务状态、价格或调用结果时，以实际证据为准。示意数字应明确标为假设例子。

## 哪些内容会自动更新

- `/blog` 和 `/en/blog` 的列表、文章目录、相关文章，以及 `/blog/<slug>` 和 `/en/blog/<slug>` 的正文，均读取 `blogPosts`。
- 公共导航和页脚已有“博客”入口，新增文章自动出现在入口对应的列表中；无需为每篇文章增加菜单项。
- 文章标题、摘要、canonical、语言替代链接、OG 与 JSON-LD 从同一份文章数据生成。
- **新增文章自动进入 sitemap，不需要同步文章 allowlist。** `lib/site-seo.ts` 的 `sitemapXml()` 遍历 `blogPosts`，生成中英文 URL；`publicPageSeo()` 用 `getBlogPost()` 识别已存在的文章。`lib/site-locale.ts` 支持符合上述格式的博客 slug。静态页面清单 `PUBLIC_SITE_PATHS` 只需保留 `/blog`，不用逐篇加入。
- 不存在的 slug 由文章路由调用 `notFound()`，不会作为有效文章进入 sitemap。

## 发布与核验

当前 `tests/blog.test.mjs` 有首批文章的数量、发布日期及内容结构断言。增加文章时，应同步将这些首批限定调整为适用于新内容的断言，保留唯一 slug、双语、SSR、元数据及 404 检查；`tests/site-seo.test.mjs` 的 sitemap 数量已按 `blogPosts.length` 动态计算。

发布前按仓库流程完成构建与相关检查，例如：

```sh
node --test tests/blog.test.mjs tests/site-seo.test.mjs tests/site-locale.test.mjs
npm run build
```

部署后访问真实域名，分别核验：

- 两个列表页都能打开新文章；中文、英文正文及语言切换指向同一 slug。
- 桌面和手机的字号、目录锚点、代码横向滚动、表格、相关文章和行动入口可用。
- 查看服务端 HTML：正文存在，标题与摘要正确，canonical 和 `hreflang` 对应当前语言，JSON-LD 对应当前文章。
- `/sitemap.xml` 同时包含新文章的中英文地址；有效文章返回 `200` 和可索引标记，未知 slug 返回 `404`，不应成为可索引页面。

构建成功与线上可访问分开核验；以真实域名读回的页面和 sitemap 为发布完成依据。
