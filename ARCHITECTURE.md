# Eco GEO 网站架构说明

本文档说明当前 Eco GEO 静态网站正在做什么、代码如何组织、Blog 如何生成、GitHub Actions 如何自动更新，以及后续维护时需要遵守的边界。

## 1. 网站定位

Eco GEO 是一个面向「品牌化 GEO」咨询服务的静态官网。

核心主张是：在 AI 搜索和生成式答案时代，品牌不只是争传统搜索排名，而是要让 AI 正确理解、可信引用、持续推荐品牌。网站围绕三个方法论组织信息：

- `AIBE`：AI 品牌认知资产，用于衡量品牌在 AI 答案里的可见度、引用可信度、语义一致性等。
- `KNIT`：可信知识网络，用官网、报告、媒体、案例、FAQ、专家观点等内容资产让 AI 更容易引用品牌。
- `Prompt Matrix`：围绕关键用户问题集做诊断和持续监测。

当前网站有三个目标：

- 咨询转化：通过首页叙事、服务品牌、品牌评测 Demo 和邮件入口获得咨询线索。
- 内容资产沉淀：通过大量行业化 Blog 文章覆盖「品牌化GEO」「Eco-GEO」「白帽 GEO」「AI搜索优化」相关问题。
- 权威信任建设：通过 About、编辑政策、隐私、条款、联系页、主题 Hub、Article schema、作者/审核人和可验证来源，把站点从文章集合升级为更值得引用的信息源。

## 2. 技术形态

这是一个无前端构建步骤的静态站点。仓库没有 `package.json`、前端框架或后端服务，页面主要由 HTML、内联 CSS 和少量原生 JavaScript 组成。

部署和生成分开：

- `.github/workflows/pages.yml`：把仓库当前文件作为 GitHub Pages artifact 部署到自定义域名。
- `.github/workflows/generate-daily-blog.yml`：每天自动生成 1 篇新文章，并提交到 `main`。
- `.github/workflows/generate-blog.yml`：手动从 Excel 全量或指定范围生成 Blog。
- `.github/workflows/generate-blog-sample.yml`：手动按分类抽样生成 Blog。

站点主域统一为：

```text
https://eco-geo.org
```

相关文件：

- `CNAME` 指向 `eco-geo.org`。
- `.nojekyll` 避免 GitHub Pages 走 Jekyll 处理。
- `robots.txt` 指向 `https://eco-geo.org/sitemap.xml`。
- `sitemap.xml`、canonical、JSON-LD 和 `blog/posts.json.url` 都应保持同一主域。

本地预览建议使用 HTTP 服务，因为 Blog 列表页会通过 `fetch('posts.json')` 读取数据：

```bash
python3 -m http.server 8000
```

然后访问：

```text
http://localhost:8000/
```

## 3. 目录结构

```text
.
├── index.html                         # 中文首页
├── 404.html                           # 自定义 404 页面
├── CNAME                              # GitHub Pages 自定义域名
├── .nojekyll                          # 禁用 Jekyll 处理
├── robots.txt                         # 爬虫入口，引用 sitemap
├── llms.txt                           # 给 AI/agent 的站点摘要
├── sitemap.xml                        # 站点地图
├── requirements.txt                   # Python 生成脚本依赖
├── authority_website_optimization_standard.md
│                                       # 权威信息源优化标准，作为内部维护依据
├── logo.svg                           # Eco GEO 主 logo
├── credentials.svg                    # 旧的资质/品牌整图资产，首页当前未直接使用
├── assets/
│   ├── blog_articles.xlsx             # Blog 选题源数据
│   ├── authors/                       # 作者头像资产
│   └── logos/                         # 首页服务品牌 logo SVG
├── brand-audit/
│   └── index.html                     # 独立品牌评测 Demo
├── blog/
│   ├── index.html                     # Blog 列表页，客户端搜索/筛选/分页
│   ├── posts.json                     # 中文 Blog 列表数据源
│   ├── page/<n>/index.html            # 静态分页页
│   └── articles/<slug>/index.html     # 单篇中文文章
├── about/ editorial-policy/ privacy/ terms/ contact/
│                                       # 信任、政策和联系页面
├── resources/
│   ├── brand-geo/
│   ├── aibe/
│   └── ai-search-visibility/          # 主题 Hub 页面
├── en/                                # 英文站点外壳、英文 Blog 入口和未来日更文章
├── ar/                                # 阿拉伯语站点外壳、阿语 Blog 入口和未来日更文章
└── scripts/
    ├── generate_blog.py               # 从 Excel 调 DeepSeek 生成完整 Blog
    ├── generate_blog_sample.py        # 按分类抽样、并发、可断点提交的生成器
    ├── generate_daily_blog.py         # 每日新闻信号 + 多语言增量文章生成器
    ├── i18n_site.py                   # 英文/阿拉伯语站点外壳生成器
    ├── authority_site.py              # 权威站点标准维护器
    └── enhance_blog_index.py          # 覆盖生成增强版 Blog 列表页
```

当前快照中：

- `blog/posts.json` 有 601 篇中文文章。
- `blog/articles/` 有 601 个中文文章目录。
- `blog/page/` 有 25 个分页目录，从 `/blog/page/2/` 到 `/blog/page/26/`。
- Blog 覆盖 60 个行业分类，历史文章已按从 2024-05-25 开始每天一篇的节奏回填。
- `en/blog/posts.json` 和 `ar/blog/posts.json` 当前为空；后续每日自动生成的新文章会同步写入英文和阿拉伯语版本。

## 4. 页面架构

### 4.1 首页

入口文件是 `index.html`。

首页是单文件实现，主要区块如下：

- 顶部导航：跳转到首页 section，并链接到品牌评测 Demo、Blog 和中英阿语言版本。
- Hero：解释 Brand-first GEO，给出咨询入口和品牌评测 Demo 入口。
- Why：解释为什么 AI 答案时代要关注品牌被理解和引用的方式。
- Credentials：展示服务过的国际品牌和项目经验，使用 `assets/logos/*.svg`。
- Method：讲 AIBE 诊断、GEO 策略框架、KNIT 可信知识网络三步方法。
- AIBE Lite：纯前端的示例诊断工具。
- Use cases：列出 B2B/SaaS、咨询/服务、出海/多语言等适用场景。
- Insights：引导进入「前沿观点」文章库。
- Contact：邮件咨询入口和交付物示例。

首页底部有固定咨询入口，作为全站 landing CTA 的一部分。

### 4.2 品牌评测 Demo

`brand-audit/index.html` 是独立的品牌评测 Demo 页面。

它在浏览器端根据品牌名、官网、行业、目标市场和品牌阶段生成示例 AIBE 分数，不上传数据、不调用外部接口。结果区提供预填品牌信息的邮件入口，引导看完 Demo 的访客联系 `yt.feng@foxmail.com` 做正式 AIBE 初诊。

### 4.3 信任和政策页面

以下页面由 `scripts/authority_site.py` 维护：

- `/about/`
- `/editorial-policy/`
- `/privacy/`
- `/terms/`
- `/contact/`

这些页面的作用是补齐站点身份、编辑标准、联系方式、隐私和条款，让搜索引擎、用户和 AI 系统能判断站点来源与责任边界。

### 4.4 主题 Hub

`resources/` 下的主题 Hub 由 `scripts/authority_site.py` 维护：

- `/resources/brand-geo/`
- `/resources/aibe/`
- `/resources/ai-search-visibility/`

它们用于承接核心主题词，连接首页、服务解释和相关文章，增强站点的信息结构。

## 5. 导航和多语言架构

全站导航目标是保持一致：

- 左侧为 Eco GEO logo。
- 中间为核心页面入口。
- 右上角为地球 icon 语言切换。
- 底部为固定咨询 CTA。

多语言由 `scripts/i18n_site.py` 和 `scripts/authority_site.py` 共同维护：

- 中文为主站根目录。
- 英文在 `/en/`。
- 阿拉伯语在 `/ar/`，页面设置 `dir="rtl"`。
- 已存在对应页面时，`authority_site.py` 会补充 canonical 和 `hreflang`。
- 每日新生成文章会同步写入中文、英文、阿拉伯语版本。

当前英文和阿拉伯语站点已经有首页、品牌评测、Blog 入口、About、编辑政策、隐私、条款和联系页。历史 601 篇中文文章尚未批量回填英文/阿语版本。

## 6. Blog 展示架构

Blog 有两套展示层。

### 6.1 增强版客户端列表页

`blog/index.html` 是增强版 Blog 列表页，运行时读取 `blog/posts.json`。

它提供：

- 关键词搜索：匹配标题、摘要、作者、标签、分类。
- 分类筛选：从 `posts.json` 自动统计分类。
- 客户端分页：每页 24 篇。
- URL 状态同步：`q`、`category`、`page` 写入 query string。
- 固定 Unsplash 图片池：列表页从稳定的 `images.unsplash.com` 图片池按文章 slug 选图。

列表页不依赖本地封面图。

### 6.2 静态分页页

`blog/page/<n>/index.html` 是生成脚本产出的静态分页页，适合传统爬虫和无 JavaScript 兜底。

如果重新运行 `scripts/generate_blog.py` 或 `scripts/generate_blog_sample.py`，它们可能重写 `blog/index.html` 为脚本内置静态版本。要恢复当前搜索/筛选体验，需要再运行：

```bash
python3 scripts/enhance_blog_index.py
```

## 7. Blog 文章架构

每篇中文文章是一个完整静态 HTML：

```text
blog/articles/<slug>/index.html
```

文章页面包含：

- HTML `title` 和 `meta description`。
- 统一导航、Eco GEO logo、语言切换和底部 CTA。
- Cover 图片，使用 `images.unsplash.com` 外部 URL。
- 作者 `Eco GEO Editorial Team`。
- 审核人 `Eco GEO Research Desk`。
- 编辑与事实核查说明。
- 正文 `body_html`。
- 标签。
- canonical。
- BlogPosting JSON-LD。
- 可选的来源列表。

文章 slug 由 Excel 行号、标题片段和 SHA1 摘要组成，形如：

```text
00001-geo-ai-e6a842ca
```

文章页不使用本地封面图，封面统一走 Unsplash 外部图。

## 8. 内容生成链路

内容源头是：

```text
assets/blog_articles.xlsx
```

### 8.1 全量生成

`scripts/generate_blog.py` 做完整生成：

1. 用 `openpyxl` 读取 Excel。
2. 根据表头猜测标题、分类、关键词字段。
3. 为每个选题调用 DeepSeek Chat Completions。
4. 要求模型输出 JSON：`title`、`excerpt`、`body_html`、`tags`。
5. 生成单篇文章 HTML。
6. 生成 `blog/posts.json`。
7. 生成 `blog/index.html` 和 `blog/page/<n>/index.html`。
8. 重写 `sitemap.xml`。
9. 尝试 patch 首页 Blog 入口文案。

### 8.2 抽样批量生成

`scripts/generate_blog_sample.py` 用于按分类抽样批量生产：

- 先读取 Excel 全量选题。
- 每个分类最多选 `--per-category-limit` 篇。
- 默认并发 worker 为 5。
- 支持每完成一定数量就提交和推送 checkpoint。
- 当前 600 篇历史基础文章来自按 60 个分类、每类 10 篇的抽样生成。

### 8.3 每日增量生成

`scripts/generate_daily_blog.py` 用于 GitHub Actions 的每日增量生成：

- 读取 `assets/blog_articles.xlsx` 选题库。
- 根据 `blog/posts.json`、已有 slug 和文章文件跳过已生成选题。
- 每次选择一个未生成选题。
- 通过 Google News RSS 获取 0-3 条公开新闻信号。
- 调用 DeepSeek 生成一篇中文评论文章。
- 把新文章插入 `blog/posts.json` 顶部。
- 同步生成英文和阿拉伯语文章版本。
- 刷新静态分页、sitemap 和首页文章数量。
- 重新运行增强版 Blog 列表页、英文/阿拉伯语站点外壳和 `authority_site.py`。

新文章策略：

- 标题使用 `Eco-GEO：` 前缀。
- 正文自然包含 `Eco-GEO`、`品牌化GEO`、`GEO服务`、`AI搜索优化` 等关键词。
- 内容面向正在考虑做 GEO 的用户意图。
- 如果使用新闻信号，只做评论和分析，不编造数据、出处或事实。
- 文章底部尽量保留可验证来源。

## 9. GitHub Actions

### 9.1 Pages 部署

`.github/workflows/pages.yml` 在 push 后部署静态站点。

它不生成内容，只负责发布当前仓库文件。

### 9.2 每日日更

`.github/workflows/generate-daily-blog.yml`：

- 触发方式：每天 UTC 00:30 自动运行，也可手动触发。
- 运行环境：Ubuntu + Python 3.11。
- 依赖安装：`pip install -r requirements.txt`。
- 生成命令：`python scripts/generate_daily_blog.py --excel assets/blog_articles.xlsx --out blog`。
- 提交方式：使用 `GITHUB_TOKEN` 自动 commit 到 `main`。
- push 后再由 Pages workflow 部署。

必需 GitHub Secret：

```text
DEEPSEEK_API_KEY
```

主要环境变量：

```text
SITE_URL                  # 默认 https://eco-geo.org
DEEPSEEK_API_URL          # 默认 https://api.deepseek.com/chat/completions
DEEPSEEK_MODEL            # 默认 deepseek-chat
DEEPSEEK_MAX_TOKENS       # 默认 2200
DEEPSEEK_TEMPERATURE      # 默认 0.72
DEEPSEEK_REQUEST_DELAY    # 默认 0.2
DEEPSEEK_RETRIES          # 默认 3
NEWS_QUERY                # 可选，覆盖 Google News RSS 查询
NEWS_RSS_URL              # 可选，改用指定 RSS 源
NEWS_MAX_ITEMS            # 默认 3
NEWS_CONTEXT_DISABLED     # 设置为 1 时禁用新闻信号
```

### 9.3 手动生成

`.github/workflows/generate-blog.yml` 用于从 Excel 手动生成指定范围或全量文章。

`.github/workflows/generate-blog-sample.yml` 用于按分类抽样生成，适合 demo 或分批扩展内容库。

两个手动工作流都会在生成后运行：

```bash
python3 scripts/enhance_blog_index.py
python3 scripts/i18n_site.py
python3 scripts/authority_site.py
```

## 10. 权威站点标准层

`scripts/authority_site.py` 是当前最重要的维护脚本之一。它把 `authority_website_optimization_standard.md` 中的原则落到静态站点上。

主要职责：

- 生成和维护 About、编辑政策、隐私、条款、联系页。
- 生成和维护主题 Hub 页面。
- 为页面补充 canonical、description、schema 和 `hreflang`。
- 为文章补充作者、审核人、编辑说明和事实核查说明。
- 统一文章 URL、标题、作者字段和 reviewer 字段。
- 维护 `robots.txt`、`llms.txt` 和 `sitemap.xml`。
- 修正导航、footer、联系入口和语言切换等全站公共结构。

权威站点层的原则：

- 用户页面只展示最终内容，不展示内部实现说明或沟通过程。
- 文章涉及事实、数据、时事时优先引用可验证来源。
- 不把模型推理过程、临时说明、内部 TODO 暴露给用户。
- 所有公开页面应能说明站点是谁、联系方式是什么、内容如何产生、如何审核、用户如何联系。

## 11. Blog 数据模型

`blog/posts.json` 是中文 Blog 列表页的数据源，每篇文章大致包含：

```json
{
  "order": "1",
  "row": "1",
  "slug": "00001-geo-ai-e6a842ca",
  "title": "Eco-GEO：文章标题",
  "excerpt": "文章摘要",
  "category": "酒店旅游",
  "tags": "GEO, 品牌化GEO, 白帽GEO, AI搜索, ...",
  "author": "Eco GEO Editorial Team",
  "reviewed_by": "Eco GEO Research Desk",
  "date": "2026-01-14",
  "image": "https://images.unsplash.com/photo-...?...",
  "url": "https://eco-geo.org/blog/articles/..."
}
```

字段职责：

- `order`：展示和生成顺序。
- `row`：对应 Excel 原始行。
- `slug`：文章目录名，也是列表页链接目标。
- `title`：文章标题，统一使用 `Eco-GEO：` 前缀。
- `date`：发布日期。历史 600 篇文章已按从 2024-05-25 开始每天一篇的节奏回填，新增文章继续向后推进。
- `category`：分类筛选维度。
- `tags`：搜索和文章标签展示。
- `image`：生成时写入的 Unsplash 外部图 URL。增强版列表页会按 slug 选固定 Unsplash 图，文章页和静态分页页会使用外部 cover 图。
- `url`：写入 sitemap 的来源之一。

## 12. 视觉和内容规范

当前前端风格是深色背景、绿色强调色、统一 logo 和固定底部 CTA。

需要继续保持的规范：

- 顶部 navigation bar 在首页、Blog、文章页、品牌评测页、信任页和多语言页保持一致。
- Blog 入口中文展示为「前沿观点」，并在对应页面高亮。
- 服务品牌 logo 使用 `assets/logos/*.svg`，需要在深色背景上有白色底垫，保证可读性。
- 封面图使用 Unsplash 外部 URL，不使用本地封面图。
- 不在公开页面展示内部说明，例如「已改为独立 SVG Logo Grid」这类实现备注。
- 公开页面文案应面向访客、客户、搜索引擎和 AI 引用系统，而不是面向开发者。

## 13. 外部依赖

运行时依赖：

- GitHub Pages 或任意静态文件服务器。
- `images.unsplash.com` 用于 Blog 列表页、静态分页页和文章页 cover 图。
- `mailto:` 用于联系入口。

生成时依赖：

- Python 3.11。
- `openpyxl`。
- DeepSeek API。
- `DEEPSEEK_API_KEY`。
- Google News RSS 或自定义 RSS 源，用于每日文章的时事信号。

本地安装依赖：

```bash
python3 -m pip install -r requirements.txt
```

如果使用 `generate_blog_sample.py` 的 checkpoint 功能，需要当前目录是 git repo，并且有 push 权限。压缩包解出的本地快照不具备 checkpoint commit 能力，但 GitHub Actions 和正式 git clone 可以正常提交。

## 14. 标准维护命令

改完页面或生成内容后，建议按这个顺序恢复站点标准层：

```bash
python3 scripts/enhance_blog_index.py
python3 scripts/i18n_site.py
python3 scripts/authority_site.py
```

检查命令：

```bash
python3 -m py_compile scripts/generate_blog.py scripts/generate_blog_sample.py scripts/generate_daily_blog.py scripts/i18n_site.py scripts/authority_site.py scripts/enhance_blog_index.py
git diff --check
```

本地预览：

```bash
python3 -m http.server 8000
```

## 15. 常见修改入口

- 改首页文案、结构或 AIBE Lite：编辑 `index.html`。
- 改独立品牌评测 Demo：编辑 `brand-audit/index.html`。
- 改首页品牌 logo 列表：编辑 `index.html` 和 `assets/logos/`。
- 改 Blog 列表交互：优先编辑 `scripts/enhance_blog_index.py`，再运行脚本生成 `blog/index.html`。
- 改文章模板、生成 prompt、sitemap 输出：编辑 `scripts/generate_blog.py`。
- 改每日自动生成策略：编辑 `scripts/generate_daily_blog.py` 和 `.github/workflows/generate-daily-blog.yml`。
- 改英文/阿拉伯语站点外壳：编辑 `scripts/i18n_site.py`。
- 改权威信任页面、robots、llms、主题 Hub：编辑 `scripts/authority_site.py`。
- 改批量生成策略、并发、每类文章数：编辑或运行 `scripts/generate_blog_sample.py`。
- 改内容选题：更新 `assets/blog_articles.xlsx`，然后重新生成 Blog。

## 16. 后续工程化建议

- 在 `README.md` 增加面向维护者的生成和发布命令摘要。
- 对模型输出的 `body_html` 做更严格的白名单清洗，避免异常 HTML。
- 给文章生成增加来源质量分级，例如官方公告、监管文件、主流媒体、行业报告优先。
- 增加一次性历史文章英文/阿拉伯语回填脚本，让多语言内容库不仅覆盖新增文章。
- 增加轻量链接检查，定期确认文章页、主题 Hub、Blog 分页和语言切换没有 404。
