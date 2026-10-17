# TokenHub 七天抽样审计

本次审计预算上限为 **5 美元**。在七天内比较四个文字模型的能力表现、独立分词结果和平台用量，并保留图片、视频的小样本。测试数据只含合成题目。我们没有原厂 API 对照组；报告不能把测试题正确率称为人类 IQ，也不能由模型名称、回复自称或正常计数证明模型身份。

## 固定计划与预算

活动从 `campaign.startedAt` 起运行七天，每 12 小时一个时段，共 14 个时段。第 `floor(slot / 2) + 1` 天不是 UTC 自然日。北京时间只用于显示，调度和证据时间使用 ISO UTC。超出七天边界不再提交收费任务；已经提交的视频可以继续有限次只读查询。错过的时段保留缺测状态，不补发整批任务。

| 样本 | 次数 | 每次保守预留 | 总预留 |
| --- | ---: | ---: | ---: |
| GLM 5.3 Flash，14 时段 × short/long | 28 | $0.01 | $0.28 |
| GLM 5.2，14 时段 × short/long | 28 | $0.05 | $1.40 |
| DeepSeek V4 Pro，14 时段 × short/long | 28 | $0.04 | $1.12 |
| DeepSeek V4 Flash，14 时段 × short/long | 28 | $0.01 | $0.28 |
| Seedream 图片，时段 0 和 13 各一张 | 2 | $0.12 | $0.24 |
| Seedance 视频，时段 0 和 13 各一条 | 2 | $0.60 | $1.20 |
| 合计 | 116 | | **$4.52** |

预留数是发出请求前的费用约束，**不是实际已花金额**。每次文字请求输入 JSON 的 UTF-8 长度不超过 4096 字节，`max_tokens=8192`；价格目录必须先通过单位、币种、精度和最高单价校验。专用 TokenHub key 限额 $5，并与日常业务 key 分开。预算、过期、暂停、错误回执和未知结果的处理以服务端审计状态为准，不重新提交结果未知的收费请求。独立分析器不发送任何收费或只读 API 请求。

计划版本升级为 `tokenhub-audit-v2`，原有活动 ID、开始时间、七天截止时间和 12 小时时段保持不变。生产首轮已发出的两条 GLM 5.3 Flash 请求使用 `max_tokens=4096` 且均截断；这两条校准样本保留原请求、响应和每条 $0.03 预留，不重新发出，也不计入能力分。后续未发请求统一使用 8192 输出上限和上表分模型预留。因此新计划全量预留为 $4.52，本次活动连同两条历史校准请求的全量预留为 **$4.56**，仍低于 $5 总额。看板和导出按已保存预留加剩余计划预留计算，不能把旧请求改价或抹掉。

文字模型：

- `glm-5-3-flash-260828`
- `glm-5-2-260617`
- `deepseek-v4-pro-ga-260813`
- `deepseek-v4-flash-ga-260731`

## 能力图例与判分

每个时段为全部模型提供相同题组，包含状态运算、0/1 背包、最短路径、精确提取四个可由本地算法验证的子题。难度固定为12次运算、10件背包物品/容量20、7节点图和10条记录。每天偶数时段为重复核心题的 anchor，奇数时段为固定难度的随机 fresh。每题组有独立 nonce；short/long 具有相同题目和答案，long 增加无关参考文本。nonce 不匹配按响应完整性失败处理，不计能力分，并单列数量，避免旧响应碰巧得分或被混成智力零分。

展示为“模型 × 七天”的**已评分子题正确率**矩阵，并同时显示分母、请求失败、缺测和截断率。例如 `12/16` 代表本次小样本的子题得分，不代表综合智力或对原厂模型的等价证明。分析另分 anchor/fresh；重复 anchor 提高跨天可比性，但可能涉及缓存，fresh 检查新题表现。fresh 的具体题目仍不同，单日分数变化不能直接解释为模型退化。同一题组的跨模型和短长变体具有配对意义。

`finish_reason=length` 的结果标为截断，不纳入能力准确率，但必须显示截断数/已收到响应数。否则只保留完成得好的样本会产生选择偏差。请求失败、空回答、nonce 不匹配和未执行样本不计作“答错”，分别显示数量；这些不能被隐藏成已通过。格式错误或答案错误属于已收到的任务执行结果，可得零分。JSON 中 score 使用0到100百分比，并附整数分子/分母。

112 次请求不是 112 次独立身份试验：short/long 复用了子题，同一时段四个模型也共享题组。每个模型有14个题组时段，其中7个重复 anchor、7个随机 fresh；也不能把这14个时段算成14组独立能力题。测试不保证能检出每次模型替换，因此不从零异常推导“100% 没有掺水”，不对这些相关子题套用独立二项试验置信区间。

## Token 核验与证据边界

每个文字请求核对 `prompt_tokens`、`completion_tokens`、`total_tokens` 是否存在、是否为非负整数，以及 `total = prompt + completion`。存在缓存命中/未命中字段时核对其和；reasoning 子计数不能超过 completion 总数。单独保存可见回答与可见 reasoning 的计数；不能只统计页面显示的最终短答案。兼容 `reasoning_content`、`reasoning` 和 `reasoning_details` 中的 `reasoning.text`；同一推理内容在多个字段出现时只选一份，不累加。不同字段不一致时标出歧义；摘要和加密块不能当作完整 reasoning。

独立分词文件固定在 [manifest](../scripts/tokenhub-tokenizers/manifest.json)，来自原厂 `deepseek-ai` 仓库：

| TokenHub 声明版本 | 官方文件仓库 | 固定 commit |
| --- | --- | --- |
| Flash 0731 | `DeepSeek-V4-Flash-0731` | `7872f01b1d1fe23eabc4c98b48bffcef5a386062` |
| Pro 0813 | `DeepSeek-V4-Pro-0813` | `72e1d3230f6c080a530b0a1d46f8eb4602340597` |

每份 `tokenizer.json`、配置、编码说明和编码源码均记录 SHA-256。官方 Python 编码源码仅静态审阅，不导入、不执行；没有模型权重，也不用 `trust_remote_code`。本地可信 `tokenizers==0.22.1` 只加载 hash 匹配的 JSON。固定自检字符串应产生 **14 个 token**，token ID 序列的 SHA-256 也必须匹配 manifest；两份版本文件当前具有相同 tokenizer hash，这证明文件一致，不证明线上模型一致。

分析器只实现经过审阅的“可选 system + 单条 user”模板子集，显式加入 BOS、User、Assistant 和 thinking 分隔标记。tools、复杂多轮、特殊 response format、高 reasoning effort 等未覆盖的输入不套用该模板。

**即使本地候选模板计数与平台完全一致，状态也只为 provisional（暂定一致）**：我们尚无上游实际模板、额外 system 内容、模型别名映射或隐藏 reasoning 的原厂凭据。输出同时给出裸文字数、候选完整模板数和平台计数的差值，不把模板差或隐藏 reasoning 武断认定为虚增。

short/long 的消息结构和核心任务相同，可以消去固定模板开销。分析器对 DeepSeek 比较：

`平台 long.prompt_tokens − 平台 short.prompt_tokens`

与

`官方 tokenizer(long 候选模板) − 官方 tokenizer(short 候选模板)`。

差值为零标为暂定一致；差异标为待解释。绝对差大于 `max(8 token, 独立差分的 2%)` 另标 materialDifference，便于复核。这是本审计的筛查阈值，不是厂商承诺的误差范围，也不是自动认定造假的标准。至少三个不同题组可复现的同方向差异才支持“系统性异常”的进一步调查。

GLM 尚未有本次精确版本独立 tokenizer，因此它们的绝对 token 核验标为“证据不足”。[智谱官方分词接口](https://docs.bigmodel.cn/api-reference/模型-api/文本分词器)支持 `glm-5.2` 等模型，但需要原厂凭据；当前 schema 未明确列出 `glm-5.3-flash`。不能拿另一版 GLM 的 tokenizer 强行核算。

## Thinking、缓存和路由

[智谱官方文档](https://docs.bigmodel.cn/cn/guide/capabilities/thinking-mode)说明 GLM-5.3 / GLM-5.3-Flash 强制思考，不能关闭。其他受支持 GLM 可发送 `thinking:{type:"disabled"}`。[DeepSeek 官方](https://api-docs.deepseek.com/guides/thinking_mode/)也提供 thinking 开关，但并不能仅凭提交参数证明 TokenHub 已原样传给指定版本。

本轮保留实际 reasoning 与截断证据，不给所有模型统一强关 thinking，也不忽略 reasoning 后宣称输出 token 多报。`temperature=0` 不保证跨服务、硬件和模型版本输出逐字相同。

TokenHub 提供[故障切换](https://docs.ai-tokenhub.ai/en/api-guides/fallbacks)和[语义缓存](https://docs.ai-tokenhub.ai/en/api-guides/semantic-cache)机制。审计请求携带禁用 fallback/cache 的路由选项，保存回执和头部，但这些参数及返回的 `model`、`extra_fields.provider`、fingerprint 仍只是服务方声明。缺失缓存标记不证明从未命中过缓存；context KV cache 与“直接返回旧答案”的语义缓存也不是同一概念。

截至 2026-10-18，[DeepSeek 官方当前 Flash 别名](https://api-docs.deepseek.com/quick_start/pricing/)已改指 V4.1-Flash-1017，而 TokenHub 声明 Flash-0731。以后补原厂对照必须先匹配版本；不能把新版官方 Flash 与旧版 TokenHub Flash 的表现差异当成替换证据。

## 金额与媒体核验

估价按当次保存的价格快照独立重算，并按命中缓存/未命中输入和输出分开计算。图片按实际成功 URL 数量计估价；本轮视频采用无参考视频、480p 配置。**估价等于服务器估价不等于实际扣款正确。**分析器始终把实际账单标为 `pending_actual_ledger`，需要单独取得该审计 key 的逐请求账单或能够排除其他业务的精确余额流水再结算。仅显示两位小数的余额不适合逐请求微美元对账。

[Seedance 公开公式](https://docs.ai-tokenhub.ai/en/api-guides/Dreamina-Seedance-2.0-Billing-Instructions)为 `(输入视频秒数 + 输出秒数) × 输出宽 × 高 × fps / 1024`；有参考视频时还可能涉及最低用量。本轮无参考视频便于复核，最终用实际媒体文件的宽高、时长、帧率/帧数、音轨与 returned usage 对照。图片核对实际尺寸、张数和内容；视频核对4秒、480p、16:9、连续运动及无音轨。媒体视觉质量无法单独证明 Seedance/Seedream 身份。

## 离线操作

完整证据输入是 `getAuditStatus(..., true)` 的 JSON：`{campaign, cases:[...]}`。每 case 包含 slot、caseId、requestedModel、request、response、usage、expected.answers/nonce、价格快照与 hash。分析器自行重新判题，不沿用服务端 grading 作为答案真值；差异会标记。输入不经网络发送，输出不复制完整提示词或回答。

```sh
python3 -m venv .artifacts/tokenhub-audit/venv
.artifacts/tokenhub-audit/venv/bin/python -m pip install --only-binary=:all: --no-deps tokenizers==0.22.1
.artifacts/tokenhub-audit/venv/bin/python scripts/tokenhub-audit-analyze.py --self-test
.artifacts/tokenhub-audit/venv/bin/python tests/tokenhub-audit-analyze.test.py
.artifacts/tokenhub-audit/venv/bin/python scripts/tokenhub-audit-analyze.py \
  .artifacts/tokenhub-audit/evidence.json \
  --output .artifacts/tokenhub-audit/analysis.json
```

分词文件保存在被 Git 忽略的 `.artifacts/tokenhub-audit/tokenizers/<官方仓库短名>/`。恢复环境时只下载 manifest 中固定 commit 的四类文件到对应路径，再运行 `--self-test`；分析器自身不会自动联网补文件。缺少依赖、文件或 hash 不匹配时仍可做结构/能力分析，但 token 结果明确不可用。不要下载模型权重或执行下载的 Python 源码。

返回的 `cases[].status` 为 `provisional`、`insufficient_evidence` 或 `needs_review`；`tokenVerification` 给出具体原因。后端可以按 slot、caseId、请求/响应 hash 关联回写每 case 的 `independentAnalysis`，不能将另一批响应的计数覆盖进当前证据。顶层保留 evidence 文件 hash、manifest hash、库版本及全部计数发现。能力矩阵使用 `dailyCapability`；pair 检查使用 `pairs`。

结论只使用“发现可复现异常”“本次样本未见该类异常”“证据不足”。全部七天样本结束、计量核验完成、原厂身份对照和实际账单对账是四个不同完成条件，不能相互替代。


### 同步远端证据与离线分析

使用 Wrangler 已有登录导出 D1 证据；脚本只读取显式非密钥列，输出文件权限为 `0600`。先导出，再执行上面的离线分析命令，最后导入分析结果：

```sh
python3 scripts/tokenhub-audit-sync.py \
  --output .artifacts/tokenhub-audit/evidence.json
python3 scripts/tokenhub-audit-sync.py \
  --import-analysis .artifacts/tokenhub-audit/analysis.json
python3 -m unittest discover -s tests -p 'test_tokenhub_audit_sync.py' -v
```

导入逐项核对当前 campaign、requestHash 和 responseHash，并在写入时再次使用相同条件。未返回响应的记录跳过；不匹配的分析不覆盖当前证据。脚本不打印原始 SQL、响应内容或凭证，私有临时 SQL 文件用完即删除。最后一条命令只运行离线 fixture，不访问远端。
