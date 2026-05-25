# Eco GEO 网站架构说明

本文档基于当前本地文件快照整理，用来说明这个网站正在做什么、页面如何组织、Blog 内容如何生成，以及后续维护时应该注意的边界。

## 1. 网站定位

Eco GEO 是一个面向「品牌化 GEO」咨询服务的静态官网。

核心主张是：在 AI 搜索和生成式答案时代，品牌不只是争传统搜索排名，而是要让 AI 正确理解、可信引用、持续推荐品牌。首页把这个主张包装成三个主要方法论：

- `AIBE`：AI 品牌认知资产，用于衡量品牌在 AI 答案里的可见度、引用可信度、语义一致性等。
- `KNIT`：可信知识网络，用官网、报告、媒体、案例、FAQ、专家观点等内容资产让 AI 更容易引用品牌。
- `Prompt Matrix`：围绕关键用户问题集做诊断和持续监测。

当前网站有两个明显目标：

- 咨询转化：通过首页叙事、服务品牌、方法论、轻量诊断工具和邮件入口获得咨询线索。
- 内容资产沉淀：通过大量行业化 Blog 文章覆盖「品牌化 GEO」「白帽 GEO」「AI 搜索」相关问题，形成可被搜索引擎和 AI 系统读取的内容库。

## 2. 技术形态

这是一个无构建步骤的静态站点。当前仓库没有 `package.json`、前端框架或后端服务，页面由 HTML 内联 CSS 和少量原生 JavaScript 组成。

部署方式是 GitHub Pages：

- `.github/workflows/pages.yml` 只负责把仓库当前文件作为静态 artifact 上传并部署。
- 工作流不会自动生成 Blog，也不会安装 Python 依赖。
- `CNAME` 当前指向 `eco-geo.org`。
- `.nojekyll` 用于避免 GitHub Pages 走 Jekyll 处理。

本地预览建议使用 HTTP 服务，因为 `blog/index.html` 会通过 `fetch('posts.json')` 读取数据，直接用 `file://` 打开可能无法正常加载：

```bash
python3 -m http.server 8000
```

然后访问 `http://localhost:8000/`。

## 3. 目录结构

```text
.
├── index.html                 # 官网首页
├── 404.html                   # 自定义 404 页面
├── CNAME                      # GitHub Pages 自定义域名
├── robots.txt                 # 爬虫入口，引用 sitemap
├── sitemap.xml                # 站点地图，由 Blog 生成脚本写入
├── logo.svg                   # Eco GEO 主 logo
├── credentials.svg            # 旧的资质/品牌整图资产，首页当前未直接使用
├── assets/
│   ├── blog_articles.xlsx     # Blog 选题源数据
│   ├── authors/               # 作者头像资产，目前生成脚本主要用内联 SVG 头像
│   └── logos/                 # 首页 Credentials 区域使用的品牌 logo SVG
├── blog/
│   ├── index.html             # Blog 列表页，客户端搜索/筛选/分页
│   ├── posts.json             # Blog 列表数据源
│   ├── page/<n>/index.html    # 静态分页页，用于传统爬取/兜底
│   └── articles/<slug>/index.html
│                               # 单篇文章静态 HTML
└── scripts/
    ├── generate_blog.py        # 从 Excel 调 DeepSeek 生成完整 Blog
    ├── generate_blog_sample.py # 按分类抽样、并发、可断点提交的生成器
    └── enhance_blog_index.py   # 覆盖生成增强版 Blog 列表页
```

当前快照中：

- `blog/posts.json` 有 600 篇文章。
- `blog/articles/` 有 600 个文章目录。
- `blog/page/` 有 24 个分页目录，加上 `blog/index.html` 作为第一页，共 25 页。
- Blog 覆盖 60 个行业分类，每个分类 10 篇文章。

## 4. 首页架构

入口文件是 `index.html`。

首页是单文件实现，主要区块如下：

- 顶部导航：锚点跳转到首页不同 section，并链接到 `brand-audit/` 与 `blog/`。
- Hero：解释 Brand-first GEO，给出咨询入口和品牌评测 Demo 入口。
- Why：解释为什么 AI 答案时代要关注品牌被理解和引用的方式。
- Credentials：展示服务过的国际品牌和项目经验，使用 `assets/logos/*.svg`。
- Method：讲 AIBE 诊断、GEO 策略框架、KNIT 可信知识网络三步方法。
- AIBE Lite：纯前端的示例诊断工具。
- Use cases：列出 B2B/SaaS、咨询/服务、出海/多语言等适用场景。
- Insights：引导进入前沿观点文章库。
- Contact：邮件咨询入口和交付物示例。

首页的 AIBE Lite 不调用外部接口，也不上传数据。它用品牌名字符做一个确定性伪随机评分，只用于演示诊断框架。

## 4.1 品牌评测工具页

`brand-audit/index.html` 是独立的品牌评测 Demo 页面。它在浏览器端根据品牌名、官网、行业、目标市场和品牌阶段生成示例 AIBE 分数，不上传数据、不调用外部接口。结果区提供预填品牌信息的邮件入口，引导看完 Demo 的访客联系 `yt.feng@foxmail.com` 做正式 AIBE 初诊。

## 5. Blog 展示架构

Blog 有两套展示层：

### 5.1 增强版客户端列表页

`blog/index.html` 当前是增强版 Blog 列表页，运行时读取 `blog/posts.json`。

它提供：

- 关键词搜索：匹配标题、摘要、作者、标签、分类。
- 分类筛选：从 `posts.json` 自动统计分类。
- 客户端分页：每页 24 篇。
- URL 状态同步：`q`、`category`、`page` 会写入 query string。
- 固定图片池：列表页不用 `posts.json` 里的 `image` 字段，而是从稳定的 `images.unsplash.com` 固定图片池按文章 slug 选图。

### 5.2 静态分页页

`blog/page/<n>/index.html` 是生成脚本产出的静态分页页，适合传统爬虫和无 JavaScript 兜底。

需要注意：如果重新运行 `scripts/generate_blog.py` 或 `scripts/generate_blog_sample.py`，它们会重写 `blog/index.html` 为脚本内置的静态版本。要恢复当前这种搜索/筛选体验，需要再运行：

```bash
python3 scripts/enhance_blog_index.py
```

## 6. Blog 文章架构

每篇文章是一个完整静态 HTML：

```text
blog/articles/<slug>/index.html
```

文章页面结构由 `scripts/generate_blog.py` 的 `article_html()` 生成：

- HTML `title` 和 `meta description` 来自模型输出。
- Header 复用 Eco GEO logo 和导航。
- Cover 图片使用稳定的 `images.unsplash.com` 外部图片 URL。
- 作者名由标题确定性生成，头像是内联 SVG。
- 正文 `body_html` 来自 DeepSeek 输出。
- 底部展示最多 6 个标签。

文章 slug 由 Excel 行号、英文/数字化标题片段和 SHA1 摘要组成，形如：

```text
00001-geo-ai-e6a842ca
```

## 7. 内容生成链路

内容源头是 `assets/blog_articles.xlsx`。

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

`scripts/generate_blog_sample.py` 是当前更像实际批量生产用的脚本：

- 先读取 Excel 全量选题。
- 每个分类最多选 `--per-category-limit` 篇。
- 默认并发 worker 为 5。
- 支持每完成一定数量就提交和推送 checkpoint。
- 当前产物看起来是按 `60` 个分类、每类 `10` 篇生成出的 600 篇文章。

需要的关键环境变量：

```text
DEEPSEEK_API_KEY          # 必需
SITE_URL                  # 生成文章 URL 和 sitemap，默认 https://eco-geo.org
DEEPSEEK_API_URL          # 默认 https://api.deepseek.com/chat/completions
DEEPSEEK_MODEL            # 默认 deepseek-chat
DEEPSEEK_MAX_TOKENS       # 默认 2200
DEEPSEEK_TEMPERATURE      # 默认 0.72
DEEPSEEK_REQUEST_DELAY    # 默认 0.2
DEEPSEEK_RETRIES          # 默认 3
```

当前本地环境没有安装 `openpyxl`，所以在本机重新生成前需要先安装依赖。仓库目前没有 `requirements.txt`。

## 8. Blog 数据模型

`blog/posts.json` 是 Blog 列表页的数据源，每篇文章大致包含：

```json
{
  "order": "1",
  "row": "1",
  "slug": "00001-geo-ai-e6a842ca",
  "title": "文章标题",
  "excerpt": "文章摘要",
  "category": "酒店旅游",
  "tags": "GEO, 品牌化GEO, 白帽GEO, AI搜索, ...",
  "author": "Harper Gray",
  "image": "https://images.unsplash.com/photo-...?...",
  "url": "https://yt-feng.github.io/geo-org/blog/articles/..."
}
```

字段职责：

- `order`：展示和生成顺序。
- `row`：对应 Excel 原始行。
- `slug`：文章目录名，也是列表页链接目标。
- `category`：分类筛选维度。
- `tags`：搜索和文章标签展示。
- `image`：生成时写入的 Unsplash 外部图 URL。当前增强版列表页不用它，但文章页和静态分页页会使用外部 cover 图。
- `url`：写入 sitemap 的来源之一。

## 9. SEO 和部署注意点

当前有几个需要统一的地方：

- 首页 canonical 和结构化数据使用 `https://eco-geo.org/`。
- `CNAME` 也是 `eco-geo.org`。
- 但 `robots.txt` 指向 `https://yt-feng.github.io/geo-org/sitemap.xml`。
- `sitemap.xml` 和 `blog/posts.json` 里的文章 URL 也使用 `https://yt-feng.github.io/geo-org/...`。

如果正式主域是 `eco-geo.org`，建议后续把 `SITE_URL`、`robots.txt`、`sitemap.xml`、`posts.json.url`、canonical 统一到这个域名。

## 10. 外部依赖

运行时依赖：

- GitHub Pages 或任意静态文件服务器。
- Blog 列表页、静态分页页和文章页会加载 `images.unsplash.com` 图片。
- 联系入口使用 `mailto:`。

生成时依赖：

- Python 3。
- `openpyxl`。
- DeepSeek API 和 `DEEPSEEK_API_KEY`。
- 如果使用 `generate_blog_sample.py` 的 checkpoint 功能，还需要当前目录是 git repo，并且有 push 权限。

当前本地目录是压缩包解出的快照，不是 git 工作树，所以 checkpoint commit 功能在本地不可用。

## 11. 维护建议

常见修改入口：

- 改首页文案、结构或 AIBE Lite：编辑 `index.html`。
- 改独立品牌评测 Demo：编辑 `brand-audit/index.html`。
- 改首页品牌 logo 列表：编辑 `index.html` 和 `assets/logos/`。
- 改 Blog 列表交互：优先编辑 `scripts/enhance_blog_index.py`，再运行脚本生成 `blog/index.html`。
- 改文章模板、生成 prompt、sitemap 输出：编辑 `scripts/generate_blog.py`。
- 改批量生成策略、并发、每类文章数：编辑或运行 `scripts/generate_blog_sample.py`。
- 改内容选题：更新 `assets/blog_articles.xlsx`，然后重新生成 Blog。

建议补齐的工程化事项：

- 增加 `requirements.txt`，至少包含 `openpyxl`。
- 增加一个明确的生成命令说明，例如放到 `README.md`。
- 把 GitHub Actions 拆成「生成 Blog」和「部署 Pages」两个流程，或者明确生成只在本地/手动完成。
- 统一 `eco-geo.org` 和 `yt-feng.github.io/geo-org` 两套 URL。
- 在生成文章前对模型输出的 `body_html` 做白名单清洗，避免模型异常输出脚本或不期望的 HTML。
- 如果图片稳定性重要，把关键图片本地化或使用明确可控的 CDN URL。
