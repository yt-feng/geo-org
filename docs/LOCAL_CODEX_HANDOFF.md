# 本地 Codex 接续：启用真实访问统计

## 工作边界

SEO/GEO 构建、前端埋点、隐藏入口、统计 Worker 和数据库 schema 已在 main 中。不要重做网站，不要覆盖本地未提交工作，不要重置其他人的提交，不要改动现有推荐、咨询或佳农的服务。

当前聊天连接支持仓库代码和 Actions，但不支持 GitHub Secrets 写入，也未连接 Cloudflare。不要绕过这些授权限制。剩余动作由本机已授权的 GitHub CLI 和对应 Cloudflare 账户完成。

公开文档、源代码、PR、日志中均不保存管理员密钥；按拥有者在私下给定的值设置，不使用默认口令。

## 1. 同步与本机条件

在目标仓库确认 `git status` 与 remote。工作区干净时使用 `git pull --ff-only`；有未提交修改时先保护它们，用独立 worktree 或手动整合，不执行 `reset --hard`。

需要 Python 3.10+、GitHub CLI；GitHub Actions 中的 Node 与 Wrangler 已由现有部署流程准备，本机不需要为这条路径再装 Wrangler。

```
gh auth status --hostname github.com
```

未授权时，由用户完成 `gh auth login --hostname github.com`。不要向聊天索要 PAT。Cloudflare API token 需要能管理目标账户中的 analytics Worker、D1 数据库及自定义域名。账户以 `analytics-service/wrangler.jsonc` 为准，先确认它拥有 `eco-geo.org`。

## 2. 使用已完成的配置脚本

```
python3 scripts/setup_analytics.py --deploy --verify-auth
```

脚本会：

1. 核对 GitHub CLI 授权，读取仓库 Actions secret **名称**。
2. 只补缺失的 `CLOUDFLARE_API_TOKEN`、`ANALYTICS_PIN`、`ANALYTICS_SECRET`；签名密钥缺失时安全随机生成。
3. 密钥仅通过 stdin 加密提交给 GitHub CLI；不写文件，不放命令参数，不输出值。
4. 已有 secret 保留不变。中途失败时不会删除成功设置的 secret，再次运行能继续。
5. 启动 main 的 `Deploy Private Analytics` 工作流，确认具体 run ID 并检查其实际结果，不将“已发起”当“已部署”。
6. 使用已给定的 PIN 对线上登录、读统计、退出、退出后拒绝访问做验收。

非交互模式可以从本机进程环境获得 `CLOUDFLARE_API_TOKEN` 与 `ANALYTICS_PIN`。交互模式使用不回显输入。不要把真实值写成源码或提交到 git。保留既有 secret 时，登录验收仍需要私下提供现有 PIN；GitHub 无法读回 secret 值。

拥有者明确要求更换 PIN 时，仅针对 `ANALYTICS_PIN` 使用 `gh secret set ANALYTICS_PIN --repo yt-feng/geo-org` 的隐藏输入，再重跑部署。不要顺手轮换其他密钥。

OAuth 登录的 Wrangler token 不应被挖出并复制到 GitHub Actions。没有合适 API token 时，应由拥有者创建限权 token；账户授权是必要的人工步骤。

## 3. 线上验收与真实上报

无需密钥的检查：

```
python3 scripts/verify_live_site.py
```

已有本机私密环境变量 `ANALYTICS_PIN` 时：

```
python3 scripts/verify_live_site.py --auth
```

结果保存在被忽略的 `.artifacts/live-readiness.json`。退出码：0=所选检查通过；1=至少一项失败；2=静态检查通过但统计后台未就绪。未使用 `--auth` 时，0 不代表管理员登录已验证。任何模式都不伪造访问事件。

还需在真实浏览器做一次最小验收：

- 打开正式域名首页，同意访问统计，浏览一个文章页面；这属于本次验收的真实访问。
- 确认 `metrics.eco-geo.org/api/events` 成功响应，而非只检查 JavaScript 已加载。
- 从页脚小圆点连续点击五次，或用 Alt+Shift+A，进入 `/observatory/`；用拥有者指定的 PIN 登录。
- 检查刚才的页面事件能在对应时间窗口中看到，测试 CSV 导出和退出登录。管理员页面自身不应计入流量。
- 不批量发送人工事件，不提交虚构咨询或客户线索，不把预览截图中的测试数字视为真实流量。
- 通过后向拥有者报告实际部署 run、统计服务健康状态、登录是否成功、实际事件是否入库、隐藏入口与剩余问题。没有检验到的项目明确标为未验证。

入口、权限、保留期、事件定义参见 `docs/seo-geo-analytics.md`。统计采用访客同意模式，不含拒绝采集、浏览器阻止或离线等未成功上报的访问；不能回补历史数据。

## 4. 搜索平台操作不是代码自动完成的

代码层可改善可抓取性和内容结构，但无法代替拥有者在 Google Search Console / Bing Webmaster Tools 验证域名、提交 sitemap、检查真实收录与抓取错误。已有授权则检查现有资源，不要新建重复资源。仅在平台要求时由拥有者完成验证；不要改 DNS 来试错，不承诺排名或 AI 引用率。

## 官方参考

- GitHub Secrets stdin / 加密：https://cli.github.com/manual/gh_secret_set
- GitHub CLI authentication：https://cli.github.com/manual/
- Cloudflare Worker Secrets：https://developers.cloudflare.com/workers/configuration/secrets/
- Google AI features：https://developers.google.com/search/docs/appearance/ai-features
