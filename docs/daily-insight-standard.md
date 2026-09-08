# 每日深度洞察：编辑与生成标准

## 要解决的问题

2026-09-08 核查 GitHub main 最近一篇文章：正文约 1,455 汉字，5 个小节，无分析表格，无文内来源引用。旧流程主要依赖 RSS/Tavily 短摘要，模型失败时会发布通用模板。新流程以一个具体经营决策组织研究与写作。

## 内容验收

中文目标 3,200–4,800 汉字；长度只作为最低完整性检查，不代表深度。每篇需有明确且可检验的核心判断、三个有信息增量的结论、因果机制、业务分群及资源取舍、可复算的指标或经济性示例、反论点与证据局限、负责人/时间/指标/继续或停止条件。

至少读取三份原始正文、覆盖两个出版域；明确行业的选题还必须包含对应行业的正文依据；Tavily/RSS 仅用于找原文。文内引用与已读取资料的 ID、URL 一一对应；不将 AI 合成摘要当来源，不将平台说明当经营效果实证。模型可以提出假设，但必须说明假设，不能虚构采访、客户实绩或实验数据。两张有分析用途的表格需有标题、表头和数据行。

采用独立请求进行研究提纲、草稿、主编审稿，失败最多实质修改两轮。审稿六维为观点、证据、机制、取舍、可执行性、原创性，每维至少 4/5，总分至少 25/30；事实核查须覆盖至少五项不同论断。不达标停止该篇，不发布模板替代品。评分是自动编辑检查，并不代表人工或 BCG 认可。

中文通过后，英文与阿语并行本地化和审稿；两版均完成才进入发布。英文、阿语必须保留中文的完整分析、表格、数字、引用和限定条件，并分别审稿。三种语言均通过后才写入站点；翻译失败不会留下已发布的中文半成品。

## 工作流与维护

日更计划于每天北京时间 08:30 触发（GitHub 排队可能延迟），沿用 Excel 未生成选题和三语输出。生产使用 DeepSeek V4 Pro thinking，稿件和提纲输出预算 24,000 tokens，审稿预算 16,000 tokens；提纲要求精简为 1,500–2,200 汉字。流程：选题 → 原文检索/读取 → 研究提纲 → 写作/审稿/修订 → 英阿本地化与审稿 → 保存 → 提交 main → Vercel Git 集成部署主站；另行触发仓库的 Pages 发布链路。

`generate_daily_blog.py --preview-dir .artifacts/preview` 或 GitHub workflow 的 `preview=true` 生成样稿、保持网站不变。审稿记录在 `.artifacts/insights/<slug>/<lang>.json`，GitHub artifact 保留 14 天；记录原创研究提纲、各轮草稿、审稿与修订回应，以及来源读取边界与正文哈希；网站只保存来源元数据，不保存第三方正文。

默认三次 Tavily 检索分配为两条独立行业查询和一条 AI 搜索平台查询，各用对应的一手出版源域名单。行业来自 Excel 的「行业」字段，不能用发展阶段分类替代。

`RESEARCH_SOURCE_FILE` 可指定选题资料目录（JSON `sources` 数组，条目含 `url/title/tags`）。默认从允许的一手来源域采集；`text_file` 仅用于显式离线测试。源码中的抓取与质量门槛有不可降低的底线。新增出版源需检查正文提取结果和来源适用范围。

本地验证：`python -m unittest discover -s tests -p 'test_insight*.py' -v`。上线核实须核对生成审稿、提交 SHA、对应 Vercel 生产部署及 eco-geo.org 公开文章，Pages 状态或单一绿色生成任务不能证明主站文章已对外更新。

## 参考的研究组织方法

参考 BCG 公开文章对关键结论、研究方法、分群比较、情景与管理行动的组织方式，采用原创论证，不复制其措辞或声称关联：

- [Moving the Agentic Marketing Transformation from Illusion to Reality](https://www.bcg.com/publications/2026/making-the-agentic-marketing-transformation-a-reality)
- [Agentic Scenarios Every Marketer Must Prepare For](https://www.bcg.com/publications/2026/agentic-scenarios-every-marketer-must-prepare-for)
- [Google Search Central: AI features and your website](https://developers.google.com/search/docs/appearance/ai-features)

生成后显式触发部署是因为 [GITHUB_TOKEN 产生的 push 不会触发其他 push 工作流](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow)。

Vercel 是主站当前生产部署平台；GITHUB_TOKEN 的限制不能用来推断 Vercel Git 集成未运行。Pages 手动触发仅针对独立的 Pages 链路。

长输出采用 SSE 流式接收，要求正常结束标记与完整 JSON。每 60 秒报告阶段进度，单次请求整体上限 1,200 秒、读取空闲上限 300 秒。输出截断立即停止并报告，不使用相同预算重复请求。Excel 的 60 个现有行业都有独立中英文检索配置，正文依据仍需每次实际读取与验证。
