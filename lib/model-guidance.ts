/** Public, source-attributed guidance. No credentials, supplier prices or live availability. */
export type GuidanceText = { zh: string; en: string };
export type GuidanceDimension = "coding" | "math" | "writing" | "creative" | "reasoning" | "speed";
export type GuidanceTask = Exclude<GuidanceDimension, "speed"> | "general";
export type GuidanceModality = "text" | "image" | "audio" | "video";
export type GuidanceAnswers = {
  task: GuidanceTask;
  priority: "economy" | "balanced" | "quality" | "speed";
  context: "short" | "long";
  input: "text" | "image";
};
export type GuidanceSource = { id: string; title: string; url: string; publisher: string; reviewedAt: string };
export type GuidanceEvidence = { label: GuidanceText; detail: GuidanceText; basis: "official" | "editorial" | "unknown"; sourceIds: string[] };
export type ModelGuidance = {
  modelId: string; family: string; generation: string; positioning: GuidanceText;
  dimensions: Record<GuidanceDimension, GuidanceEvidence>;
  contextTokens: number | null; inputModalities: GuidanceModality[];
  benchmarks: Array<{ name: string; value: number; unit: string; condition: GuidanceText; sourceId: string }>;
  sources: GuidanceSource[]; notes: GuidanceText[];
};
export type GuidanceCatalogModel = {
  id: string; name: string; provider: string; category: string;
  requestKind?: string; available?: boolean; service?: "gateway" | "studio" | "selected";
  /** Capabilities explicitly exposed by this platform route, not inferred from vendor documentation. */
  inputModalities?: GuidanceModality[]; contextTokens?: number;
};
export type GuidancePublicPrice = {
  modelId: string; service?: "gateway" | "studio" | "selected";
  inputUsdPerMillion: number; outputUsdPerMillion: number;
};
export type GuidanceRecommendation = {
  model: GuidanceCatalogModel; guidance: ModelGuidance; reasons: GuidanceText[]; tradeoffs: GuidanceText[];
  sameFamilyAlternatives: Array<{ modelId: string; service?: GuidanceCatalogModel["service"]; name: string }>;
};
export type GuidanceRecommendationResult = {
  recommendations: GuidanceRecommendation[];
  excludedCounts: { unavailable: number; unsupported: number; unverified: number; modality: number; context: number; duplicate: number };
  notice: GuidanceText;
};

export const GUIDANCE_REVIEWED_AT = "2026-10-24";
export const GUIDANCE_LONG_CONTEXT_TOKENS = 128_000;
export const guidanceDimensions: GuidanceDimension[] = ["coding", "math", "writing", "creative", "reasoning", "speed"];
const t = (zh: string, en: string): GuidanceText => ({ zh, en });
const source = (id: string, title: string, url: string, publisher: string): GuidanceSource => ({ id, title, url, publisher, reviewedAt: GUIDANCE_REVIEWED_AT });
const official = (label: GuidanceText, detail: GuidanceText, sourceId: string): GuidanceEvidence => ({ label, detail, basis: "official", sourceIds: [sourceId] });
const editorial = (label: GuidanceText, detail: GuidanceText): GuidanceEvidence => ({ label, detail, basis: "editorial", sourceIds: [] });
const unknown = (): GuidanceEvidence => ({ label: t("待核验", "Not verified"), detail: t("尚未核验此版本在这个维度的专门证据。", "Version-specific evidence for this dimension has not been verified."), basis: "unknown", sourceIds: [] });
const speedNote = t("速度描述来自厂商定位，未在 tokvilo 进行同条件延迟测试；推理强度、输出长度和负载会影响耗时。", "Speed descriptions are vendor positioning, not latency measured on tokvilo. Reasoning effort, output length and load affect response time.");
const capabilityNote = t("官方上下文与输入能力是模型规格；tokvilo 的具体接口限制、可用状态及最终报价以请求时为准。", "Official context and input capabilities describe the model. The tokvilo route's limits, availability and final quote apply when you make a request.");
const benchmarkNote = t("评测由发布方报告，测试集、推理设置和执行工具不同；数值不构成统一排名，也不保证你的任务表现。", "Benchmarks are publisher-reported and use different datasets, reasoning settings and execution harnesses. They are not a unified ranking or a guarantee for your task.");
type ProfileSpec = {
  id: string; family: string; generation: string; positioning: GuidanceText; source: GuidanceSource;
  context?: number; inputs?: GuidanceModality[]; dimensions?: Partial<Record<GuidanceDimension, GuidanceEvidence>>;
  benchmarks?: ModelGuidance["benchmarks"]; notes?: GuidanceText[];
  fit: GuidanceTask[]; mode: "focused" | "balanced" | "deliberate"; current?: boolean; recommendable?: boolean;
};
const profiles = new Map<string, ModelGuidance>();
const selection = new Map<string, Pick<ProfileSpec, "fit" | "mode" | "current" | "recommendable">>();
function add(spec: ProfileSpec) {
  if (profiles.has(spec.id)) throw new Error(`Duplicate guidance ID: ${spec.id}`);
  profiles.set(spec.id, {
    modelId: spec.id, family: spec.family, generation: spec.generation, positioning: spec.positioning,
    dimensions: {
      coding: unknown(), math: unknown(), reasoning: unknown(), speed: unknown(),
      writing: editorial(t("先评估文风", "Evaluate the writing style"), t("编辑建议：用同一份材料测试结构、事实保真和语气，再决定是否用于正式文稿。", "Editorial suggestion: test structure, factual fidelity and tone on the same source material before choosing a writing model.")),
      creative: editorial(t("用样稿比较", "Compare sample drafts"), t("编辑建议：比较多份创意稿的原创性和约束遵循；没有通用的创意分数。", "Editorial suggestion: compare originality and adherence to constraints across sample drafts; there is no universal creativity score.")),
      ...spec.dimensions,
    },
    contextTokens: spec.context ?? null, inputModalities: spec.inputs ?? ["text"],
    benchmarks: spec.benchmarks ?? [], sources: [spec.source],
    notes: [capabilityNote, ...(spec.dimensions?.speed?.basis === "official" ? [speedNote] : []), ...(spec.benchmarks?.length ? [benchmarkNote] : []), ...(spec.notes ?? [])],
  });
  selection.set(spec.id, { fit: spec.fit, mode: spec.mode, current: spec.current !== false, recommendable: spec.recommendable !== false });
}
const coding = (id: string, zh: string, en: string) => official(t("代码与工程", "Coding and engineering"), t(zh, en), id);
const reasoning = (id: string, zh: string, en: string) => official(t("多步推理", "Multi-step reasoning"), t(zh, en), id);
const math = (id: string, zh: string, en: string) => official(t("数学与科学", "Math and science"), t(zh, en), id);
const fast = (id: string, zh: string, en: string) => official(t("厂商速度定位", "Vendor speed positioning"), t(zh, en), id);

// Only explicitly reviewed identifiers are mapped. Never strip arbitrary dates or thinking suffixes.
const oa = (id: string) => source(id, `${id} · OpenAI model documentation`, `https://developers.openai.com/api/docs/models/${id}`, "OpenAI");
add({ id: "gpt-6-astra", family: "GPT", generation: "6 Astra", source: oa("gpt-6-astra"), context: 1_050_000, inputs: ["text", "image"], mode: "deliberate", fit: ["coding", "reasoning", "writing", "general"], positioning: t("面向复杂推理、工程与研究交付。", "Designed for demanding reasoning, engineering and research deliverables."), dimensions: {
  coding: coding("gpt-6-astra", "官方重点包括复杂编码和计算机使用。", "The official focus includes complex coding and computer use."),
  reasoning: reasoning("gpt-6-astra", "适用于深度分析和多步骤复杂工作。", "Intended for deep analysis and complex multi-step work."),
  writing: official(t("研究与文档", "Research and documents"), t("官方列出研究和文档创作为重点用途；文风仍需样稿验证。", "The vendor highlights research and document creation; evaluate style with your own samples."), "gpt-6-astra"),
} });
add({ id: "gpt-6.1-sol", family: "GPT", generation: "6.1 Sol", source: oa("gpt-6.1-sol"), context: 1_050_000, inputs: ["text", "image"], mode: "balanced", fit: ["coding", "reasoning", "writing", "general"], positioning: t("复杂任务中的质量、时间与成本平衡选项。", "A balance of quality, time and cost for complex tasks."), dimensions: {
  coding: coding("gpt-6.1-sol", "面向代码和复杂工作流。", "Designed for coding and complex workflows."), reasoning: reasoning("gpt-6.1-sol", "支持多档推理强度；不开启无推理模式。", "Supports multiple reasoning effort levels, without a no-reasoning mode."),
}, notes: [t("官方 Chat Completions 支持不含工具调用的对话；不能据此推定 tokvilo 暴露了所有官方工具。", "Official Chat Completions supports conversations without tool calling; this does not imply that tokvilo exposes every vendor tool.")] });
add({ id: "gpt-6-luna", family: "GPT", generation: "6 Luna", source: oa("gpt-6-luna"), context: 1_050_000, inputs: ["text", "image"], mode: "focused", fit: ["general", "writing"], positioning: t("适合边界清晰、批量较大的任务。", "Intended for focused, high-volume tasks."), dimensions: { reasoning: reasoning("gpt-6-luna", "提供可调推理强度；先将任务拆成清晰步骤。", "Provides adjustable reasoning effort; start with clearly bounded tasks."), speed: fast("gpt-6-luna", "官方定位为高效率、高吞吐任务型号。", "Positioned by the vendor for efficient, high-volume work.") } });
for (const id of ["gpt-4.1", "gpt-4.1-2025-04-14"]) add({ id, family: "GPT", generation: "4.1", source: oa("gpt-4.1"), context: 1_047_576, inputs: ["text", "image"], mode: "balanced", current: false, fit: ["coding", "writing", "general"], positioning: t("旧代长上下文、指令遵循模型，不使用独立推理阶段。", "An earlier long-context instruction-following model without a separate reasoning stage."), dimensions: { coding: coding("gpt-4.1", "官方强调指令遵循和工具调用。", "The vendor emphasizes instruction following and tool calling."), speed: fast("gpt-4.1", "官方描述为无推理阶段的低延迟模型。", "The vendor describes low latency without a reasoning stage.") }, notes: [t("官方文档已标为 Deprecated；目录存在不代表厂商长期保留服务。", "The official documentation marks this model Deprecated; a catalogue entry does not guarantee long-term vendor service.")] });
add({ id: "gpt-5-mini", family: "GPT", generation: "5 mini", source: oa("gpt-5-mini"), context: 400_000, inputs: ["text", "image"], mode: "focused", current: false, fit: ["general", "writing"], positioning: t("旧代轻量推理型号，适合定义明确的任务。", "An earlier lightweight reasoning option for well-defined tasks."), dimensions: { speed: fast("gpt-5-mini", "官方定位为低延迟、高吞吐；相对 GPT-5 更轻量。", "The vendor positions it for low latency and high throughput, lighter than GPT-5.") }, notes: [t("官方文档已标为 Deprecated；请在新任务前核对接口状态。", "Official documentation marks it Deprecated; check route status before starting new work.")] });

const claude = (slug: string, label: string) => source(`claude-${slug}`, `${label} · Claude model documentation`, `https://platform.claude.com/docs/en/models/${slug}/overview`, "Anthropic");
for (const [id, slug, label, mode, latency] of [
  ["claude-opus-5-5", "opus-5-5", "Opus 5.5", "deliberate", "Moderate"],
  ["claude-sonnet-5-5", "sonnet-5-5", "Sonnet 5.5", "balanced", "Fast"],
  ["claude-haiku-5-5", "haiku-5-5", "Haiku 5.5", "focused", "Fastest"],
] as const) add({ id, family: "Claude", generation: label, source: claude(slug, label), context: 1_000_000, inputs: ["text", "image"], mode, fit: mode === "focused" ? ["general", "writing"] : ["coding", "reasoning", "writing", "general"], positioning: mode === "focused" ? t("面向分类、提取和路由等高频任务。", "Designed for frequent classification, extraction and routing.") : mode === "balanced" ? t("兼顾智能与速度的日常复杂任务选项。", "A balance of intelligence and speed for everyday complex work.") : t("侧重长任务、工程与知识工作。", "Focused on long-running engineering and knowledge work."), dimensions: {
  ...(mode !== "focused" ? { coding: coding(id, "官方将工程和复杂工作列为该系列应用方向。", "The vendor positions this series for engineering and complex work.") } : {}),
  reasoning: reasoning(id, "支持自适应推理；更高强度通常需要更多生成用量。", "Supports adaptive reasoning; higher effort generally uses more generation tokens."),
  speed: fast(id, `官方同系列相对延迟标签：${latency}。`, `The vendor's within-family latency label is ${latency}.`),
} });

const gemini = (id: string) => source(id, `${id} · Gemini model documentation`, `https://ai.google.dev/gemini-api/docs/models/${id}`, "Google");
for (const [id, generation, mode, current] of [
  ["gemini-4-argon", "4 Argon", "deliberate", true], ["gemini-3.8-flash", "3.8 Flash", "balanced", true],
  ["gemini-2.5-pro", "2.5 Pro", "deliberate", false], ["gemini-2.5-flash", "2.5 Flash", "focused", false],
] as const) add({ id, family: "Gemini", generation, source: gemini(id), context: 1_048_576, inputs: ["text", "image", "audio", "video"], mode, current, fit: mode === "focused" ? ["general", "writing"] : ["coding", "math", "reasoning", "general"], positioning: mode === "focused" ? t("面向规模化、低延迟且需要推理的任务。", "Designed for scalable, lower-latency tasks that need reasoning.") : mode === "balanced" ? t("Flash 系列中的长程工程和多步骤任务选项。", "A Flash-series option for long engineering sessions and multi-step tasks.") : t("侧重复杂代码、数学和长材料分析。", "Focused on complex code, mathematics and long-material analysis."), dimensions: {
  coding: coding(id, mode === "focused" ? "官方支持代理式工作流；复杂工程应使用样例评估。" : "官方重点包括软件工程或代码库分析。", mode === "focused" ? "The vendor supports agentic workflows; assess complex engineering with your own samples." : "The official focus includes software engineering or codebase analysis."),
  reasoning: reasoning(id, "官方支持思考与多步任务；具体配置取决于接口。", "The vendor supports thinking and multi-step tasks; configuration depends on the route."),
  ...(mode === "deliberate" ? { math: math(id, "官方列出数学、科学或 STEM 推理用途。", "Official uses include mathematics, science or STEM reasoning.") } : { speed: fast(id, "Flash 系列以响应效率为定位；不是 tokvilo 实测速度。", "The Flash series emphasizes response efficiency; this is not measured tokvilo latency.") }),
}, notes: [
  ...(id === "gemini-4-argon" ? [t("1,048,576 tokens 是输入与输出共享窗口，需为输出预留空间。", "The 1,048,576-token window is shared by input and output; leave room for the response.")] : []),
  ...(!current ? [t("Google 对 2.5 系列的新客户访问有额外限制；以 tokvilo 当前路由状态为准。", "Google restricts new-customer access to the 2.5 series; use the current tokvilo route status.")] : []),
] });

// Additional verified families are registered below. These records never imply live execution success.
for (const [slug, label] of [["opus-4-6", "Opus 4.6"], ["sonnet-4-6", "Sonnet 4.6"]] as const) add({ id: `claude-${slug}`, family: "Claude", generation: label, source: claude(slug, label), context: 1_000_000, inputs: ["text", "image"], mode: slug.startsWith("opus") ? "deliberate" : "balanced", current: false, fit: ["reasoning", "writing", "general"], positioning: t("仍有官方文档支持的旧代自适应推理型号。", "An earlier adaptive-reasoning version with current official documentation."), dimensions: { reasoning: reasoning(`claude-${slug}`, "支持自适应推理；旧 extended 配置已被官方标记弃用。", "Supports adaptive reasoning; the old extended setting is marked deprecated.") }, notes: [t("官方标记为 Legacy，保留用于已有工作流的版本对比。", "Marked Legacy by the vendor; included for comparison with established workflows.")] });

const r1Source = source("deepseek-r1", "DeepSeek-R1 model card", "https://github.com/deepseek-ai/DeepSeek-R1/blob/main/README.md", "DeepSeek");
const r1MaySource = source("deepseek-r1-0528", "DeepSeek-R1-0528 model card", "https://huggingface.co/deepseek-ai/DeepSeek-R1-0528", "DeepSeek");
for (const [id, generation, src, maxOutput, samples, aime] of [
  ["deepseek-r1", "R1 · January 2025", r1Source, "32,768", "64", 79.8],
  ["deepseek-r1-0528", "R1 · May 2025", r1MaySource, "64K", "16", 91.4],
] as const) add({ id, family: "DeepSeek", generation, source: src, ...(id === "deepseek-r1" ? { context: 128_000 } : {}), mode: "deliberate", current: false, fit: ["math", "coding", "reasoning"], positioning: t("R1 推理系列；适合以可验证答案评估数学、代码和逻辑题。", "The R1 reasoning series; evaluate it on mathematics, code and logic with checkable answers."), dimensions: {
  coding: coding(src.id, "模型卡包含代码与软件修复评测。", "The model card includes coding and software-fix evaluations."),
  math: math(src.id, "有 AIME 竞赛题评测，设置和版本见下方。", "AIME competition results are available; see the version and settings below."),
  reasoning: reasoning(src.id, "模型经过面向多步思考的强化学习训练。", "The model uses reinforcement learning for multi-step reasoning."),
}, benchmarks: [{ name: "AIME 2024 · pass@1", value: aime, unit: "%", sourceId: src.id, condition: t(`官方报告；最大生成 ${maxOutput} tokens，温度 0.6，top-p 0.95，每题 ${samples} 次采样估计 pass@1。`, `Publisher report; maximum ${maxOutput} generated tokens, temperature 0.6, top-p 0.95, ${samples} samples per question to estimate pass@1.`) }], notes: [t("这里展示发布版本的结果；需确保实际接口没有将此名称重定向到其他版本。", "These results describe the released version; verify that the route has not redirected this name to another version.")] });
const v32 = source("deepseek-v3.2", "DeepSeek-V3.2 release", "https://api-docs.deepseek.com/news/news251201/", "DeepSeek");
add({ id: "deepseek-v3.2", family: "DeepSeek", generation: "V3.2", source: v32, mode: "balanced", current: false, fit: ["reasoning", "coding", "general"], positioning: t("V3.2 将思考和工具使用结合，侧重日常代理任务。", "V3.2 combines thinking and tool use for everyday agentic tasks."), dimensions: { reasoning: reasoning(v32.id, "官方支持思考与非思考模式下的工具使用。", "The vendor supports tool use in thinking and non-thinking modes.") } });

const qwen = (id: string) => source(id, `${id} · Model Studio documentation`, `https://help.aliyun.com/en/model-studio/${id.replaceAll(".", "-")}`, "Alibaba Cloud");
for (const [id, generation, src, mode, current] of [
  ["qwen3.8-max", "3.8 Max", qwen("qwen3.8-max"), "deliberate", true],
  ["qwen3.8-max-0902", "3.8 Max · 2026-09-02", qwen("qwen3.8-max"), "deliberate", true],
  ["qwen3.8-flash", "3.8 Flash", qwen("qwen3.8-flash"), "focused", true],
  ["qwen3.7-plus", "3.7 Plus", qwen("qwen3.7-plus"), "balanced", false],
] as const) add({ id, family: "Qwen", generation, source: src, context: 1_000_000, inputs: ["text", "image", "video"], mode, current, fit: ["coding", "reasoning", "writing", "general"], positioning: mode === "focused" ? t("长材料、代码辅助与视觉理解，偏重响应效率。", "Long materials, coding assistance and visual understanding, with an efficiency focus.") : t("侧重工程、办公材料与长程任务；支持视觉理解。", "Focused on engineering, office materials and long-running tasks, with visual understanding."), dimensions: { coding: coding(src.id, "官方列出代码辅助、工程或视觉生成界面工作流。", "Official uses include coding assistance, engineering or interface work from visual references."), reasoning: reasoning(src.id, "支持思考和复杂任务规划。", "Supports thinking and complex-task planning."), ...(mode === "focused" ? { speed: fast(src.id, "官方以效率和并发应用为定位。", "The vendor emphasizes efficiency and high-concurrency applications.") } : {}) } });
const q27 = source("qwen3.8-27b", "Qwen3.8-27B model card", "https://huggingface.co/Qwen/Qwen3.8-27B", "Qwen");
add({ id: "qwen3.8-27b", family: "Qwen", generation: "3.8 · 27B", source: q27, context: 262_144, inputs: ["text", "image", "video"], mode: "balanced", fit: ["coding", "reasoning", "general"], positioning: t("紧凑的 27B 视觉语言型号，支持可调思考。", "A compact 27B vision-language model with adjustable thinking."), dimensions: { coding: coding(q27.id, "模型卡报告终端工程任务评测。", "The model card reports terminal engineering evaluations."), reasoning: reasoning(q27.id, "思考默认启用，也可以关闭；实际参数支持以接口为准。", "Thinking is on by default and can be disabled; route parameter support still applies.") }, benchmarks: [{ name: "Terminal-Bench 2.1", value: 73.0, unit: "%", sourceId: q27.id, condition: t("官方模型卡的 Qwen3.8-27B 行；Terminus 执行工具。不是 Max 或 Flash 版本成绩。", "The Qwen3.8-27B row in the official model card, using the Terminus harness. This is not a Max or Flash result.") }], notes: [t("展示原生 262,144-token 窗口；扩展到 1M 需要特定部署配置，未按默认能力宣传。", "Shows the native 262,144-token window; extension to 1M needs deployment configuration and is not advertised as the default.")] });

const glm = (id: string) => source(id, `${id} · Z.ai developer documentation`, `https://docs.z.ai/guides/llm/${id}`, "Z.ai");
for (const [id, generation, context, current] of [["glm-4.7", "4.7", 200_000, false], ["glm-5.2", "5.2", 1_000_000, false], ["glm-5.3", "5.3", 1_000_000, true]] as const) add({ id, family: "GLM", generation, source: glm(id), context, mode: "deliberate", current, fit: ["coding", "reasoning", "general"], positioning: t("围绕工程项目、代码修改与长程代理任务设计。", "Designed around engineering projects, code changes and long-running agentic tasks."), dimensions: { coding: coding(id, "官方文档强调跨文件工程任务与任务完成。", "The documentation emphasizes cross-file engineering and task completion."), reasoning: reasoning(id, id === "glm-5.3" ? "始终启用推理，支持 low / high / max。" : "官方支持思考模式和多步执行。", id === "glm-5.3" ? "Reasoning is always enabled, with low / high / max effort." : "The vendor supports thinking mode and multi-step execution.") }, notes: [t("此型号官方输入为文本；不要将 GLM 视觉型号的能力套用到它。", "Official input for this model is text; do not inherit capabilities from GLM vision models.")] });

const grok = source("grok-4.7", "Grok 4.7 developer guide", "https://docs.x.ai/developers/grok-4-7", "xAI");
add({ id: "grok-4.7", family: "Grok", generation: "4.7", source: grok, context: 500_000, inputs: ["text", "image"], mode: "deliberate", fit: ["coding", "reasoning", "writing", "general"], positioning: t("面向工程、代理和知识工作，支持多档推理。", "Designed for engineering, agentic and knowledge work, with several reasoning levels."), dimensions: { coding: coding(grok.id, "官方指南以代码与代理工作流为重点。", "The developer guide emphasizes coding and agentic workflows."), reasoning: reasoning(grok.id, "推理强度有 low、medium、high 和 xhigh。", "Reasoning levels include low, medium, high and xhigh.") }, notes: [t("网页搜索等官方工具需要相应接口支持；普通对话接入不自动包含这些工具。", "Vendor tools such as web search require route support; a plain chat integration does not automatically include them.")] });

const kimi = (id: string, slug: string) => source(id, `${id} · Kimi technical blog`, `https://www.kimi.com/en/blog/${slug}`, "Moonshot AI");
for (const [id, generation, src, context, current] of [["kimi-k2.5", "K2.5", kimi("kimi-k2.5", "kimi-k2-5"), undefined, false], ["kimi-k3", "K3", kimi("kimi-k3", "kimi-k3"), 1_000_000, true]] as const) add({ id, family: "Kimi", generation, source: src, context, inputs: ["text", "image"], mode: "deliberate", current, fit: ["coding", "reasoning", "creative", "writing", "general"], positioning: t("视觉和编码结合，适合界面实现与知识材料处理。", "Combines vision and coding for interface implementation and knowledge work."), dimensions: { coding: coding(src.id, "官方案例包含基于视觉的界面和工程实现。", "Official examples include visual interface work and engineering."), reasoning: reasoning(src.id, "侧重跨多步骤持续执行；官方工具编排并非普通对话的默认能力。", "Focused on sustained multi-step work; official tool orchestration is not a default plain-chat capability."), creative: editorial(t("交互创意候选", "A candidate for interactive ideas"), t("编辑建议：可用截图和明确交互要求测试创意实现，不将演示案例当作成功保证。", "Editorial suggestion: test creative implementation with screenshots and explicit interaction requirements; demos do not guarantee success.")) }, notes: [t("未把官方 Agent Swarm 或办公产品功能作为 tokvilo 对话接口功能。", "Official Agent Swarm and office-product features are not presented as tokvilo chat-route features.")] });

const mm25 = source("minimax-m2.5", "MiniMax M2.5 release", "https://www.minimax.io/news/minimax-m25", "MiniMax");
add({ id: "minimax-m2.5", family: "MiniMax", generation: "M2.5", source: mm25, mode: "balanced", current: false, fit: ["coding", "reasoning", "writing", "general"], positioning: t("围绕工程、工具使用和办公任务训练的文本型号。", "A text model trained around engineering, tool use and office tasks."), dimensions: { coding: coding(mm25.id, "官方覆盖多语言、全栈工程以及软件修复评测。", "The vendor covers multiple programming languages, full-stack engineering and software-fix evaluations."), reasoning: reasoning(mm25.id, "官方强调先分解和规划，再执行任务。", "The vendor emphasizes decomposition and planning before execution."), speed: fast(mm25.id, "厂商报告在其 SWE-bench 测试中比 M2.1 完成更快；不代表任意对话延迟。", "The vendor reports faster completion than M2.1 in its SWE-bench setup; this is not general chat latency.") }, benchmarks: [{ name: "SWE-bench Verified · Droid", value: 79.7, unit: "%", sourceId: mm25.id, condition: t("厂商发布文中的 Droid 执行工具结果；OpenCode 工具下为 76.1%，不混作同一测量。", "Publisher result using the Droid harness; its OpenCode result is 76.1%, a separate measurement.") }] });
const mm3 = source("minimax-m3", "MiniMax M3 model overview", "https://www.minimax.io/models/text/m3", "MiniMax");
add({ id: "minimax-m3", family: "MiniMax", generation: "M3", source: mm3, context: 512_000, inputs: ["text", "image", "video"], mode: "deliberate", fit: ["coding", "reasoning", "general"], positioning: t("面向长程工程与原生多模态任务。", "Designed for long-running engineering and native multimodal tasks."), dimensions: { coding: coding(mm3.id, "官方列出代码、终端执行和长任务案例。", "Official uses include coding, terminal execution and long-running tasks."), reasoning: reasoning(mm3.id, "官方强调自主拆解、工具调用和多步骤执行。", "The vendor emphasizes task decomposition, tool use and multi-step execution.") }, notes: [t("官方标注最高 1M、最低保证 512K 上下文；此处保守展示 512K，仍需服从 tokvilo 接口上限。", "The vendor advertises up to 1M context with a minimum of 512K; this record uses 512K, still subject to the tokvilo route limit.")] });

// Earlier generations retain their exact official IDs for comparison; retired models are comparison-only.
for (const variant of ["mini", "nano"] as const) for (const suffix of ["", "-2025-04-14"]) {
  const base = `gpt-4.1-${variant}`;
  add({ id: base + suffix, family: "GPT", generation: `4.1 ${variant}`, source: oa(base), context: 1_047_576, inputs: ["text", "image"], mode: "focused", current: false, recommendable: variant !== "nano", fit: ["general", "writing"], positioning: t("GPT-4.1 的轻量型号，适合明确指令与长材料处理。", "A lighter GPT-4.1 variant for clear instructions and long materials."), dimensions: { speed: fast(base, "官方描述为不使用独立推理步骤的低延迟型号。", "The vendor describes low latency without a separate reasoning step.") }, notes: [variant === "nano" ? t("官方已标为 Shut down；仅保留历史比较，不进入推荐候选。", "Officially marked Shut down; retained for historical comparison and excluded from recommendations.") : t("官方已标为 Deprecated；保留用于已有工作流的比较。", "Officially marked Deprecated; retained for comparison with established workflows.")] });
}
for (const [id, slug, label, mode] of [
  ["claude-opus-4-5-20251101", "opus-4-5", "Opus 4.5 · 2025-11-01", "deliberate"],
  ["claude-sonnet-4-5-20250929", "sonnet-4-5", "Sonnet 4.5 · 2025-09-29", "balanced"],
  ["claude-haiku-4-5-20251001", "haiku-4-5", "Haiku 4.5 · 2025-10-01", "focused"],
] as const) add({ id, family: "Claude", generation: label, source: claude(slug, label), context: 200_000, inputs: ["text", "image"], mode, current: false, fit: ["reasoning", "general", "writing"], positioning: t("4.5 代固定快照，使用手动扩展思考配置。", "A pinned 4.5-generation snapshot using manual extended thinking."), dimensions: { reasoning: reasoning(`claude-${slug}`, "支持 extended thinking；不要将后代 adaptive 参数直接套用。", "Supports extended thinking; do not inherit newer adaptive-thinking parameters.") }, notes: [slug === "sonnet-4-5" ? t("官方标为 Deprecated，计划于 2026-11-30 退役；新任务应留意生命周期。", "Marked Deprecated, with retirement scheduled for 2026-11-30; check the lifecycle for new work.") : t("官方列为 Legacy；这里只记录该固定快照，不给 thinking 后缀自动套用评测。", "Listed as Legacy; this record describes the pinned snapshot and does not automatically map thinking-suffixed variants.")] });
for (const [id, generation, mode] of [["gemini-3.1-pro-preview", "3.1 Pro Preview", "deliberate"], ["gemini-3-flash-preview", "3 Flash Preview", "balanced"]] as const) add({ id, family: "Gemini", generation, source: gemini(id), context: 1_048_576, inputs: ["text", "image", "audio", "video"], mode, current: false, fit: ["coding", "reasoning", "general"], positioning: t("Gemini 3 系列预览型号，侧重代码与多步骤工具工作流。", "A Gemini 3-series preview focused on coding and multi-step tool workflows."), dimensions: { coding: coding(id, "官方列出工程、交互生成和代理式代码工作。", "Official uses include engineering, interactive generation and agentic coding."), reasoning: reasoning(id, "支持思考；工具功能仍需具体接口实现。", "Supports thinking; tool features still require route implementation.") }, notes: [t("这是 Preview 标识，接口和生命周期可能变化；未将相似 thinking 名称视为同一版本。", "This is a Preview ID; interface behavior and lifecycle can change. Similar thinking-suffixed names are not assumed to be the same version.")] });

export const modelGuidanceProfiles: readonly ModelGuidance[] = Array.from(profiles.values());
export function getModelGuidance(id: string): ModelGuidance | null { return profiles.get(id) ?? null; }

export const defaultGuidanceAnswers: GuidanceAnswers = { task: "general", priority: "balanced", context: "short", input: "text" };
export function isGuidanceAnswers(value: unknown): value is GuidanceAnswers {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const answer = value as Record<string, unknown>;
  return typeof answer.task === "string" && ["coding", "math", "writing", "creative", "reasoning", "general"].includes(answer.task)
    && typeof answer.priority === "string" && ["economy", "balanced", "quality", "speed"].includes(answer.priority)
    && typeof answer.context === "string" && ["short", "long"].includes(answer.context)
    && typeof answer.input === "string" && ["text", "image"].includes(answer.input);
}

const resultNotice = t("这是基于公开资料和你的偏好的编辑选型建议，不是实测排行榜。只筛选当前目录明确可用的文本对话接口；最终效果、延迟、参数和报价需要用你的样本验证。", "These are editorial selection suggestions based on public documentation and your preferences, not a measured leaderboard. Only explicitly available text-chat routes are considered. Verify output quality, latency, parameters and quotes with your own samples.");
const compareText = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const routeKey = (model: { id: string; service?: string }) => `${model.service ?? ""}\u0000${model.id}`;
export function guidanceCostExample(context: GuidanceAnswers["context"]): { inputTokens: number; outputTokens: number } {
  return { inputTokens: context === "long" ? 128_000 : 2_000, outputTokens: 1_000 };
}
function priceFor(model: GuidanceCatalogModel, prices: GuidancePublicPrice[], context: GuidanceAnswers["context"]): number | null {
  // A quote for another route must never be silently reused. Duplicate/conflicting quotes are unknown.
  const matches = prices.filter(price => price.modelId === model.id && price.service === model.service);
  if (!matches.length || matches.some(price => !Number.isFinite(price.inputUsdPerMillion) || !Number.isFinite(price.outputUsdPerMillion) || price.inputUsdPerMillion < 0 || price.outputUsdPerMillion < 0)) return null;
  const first = matches[0];
  if (matches.some(price => price.inputUsdPerMillion !== first.inputUsdPerMillion || price.outputUsdPerMillion !== first.outputUsdPerMillion)) return null;
  const example = guidanceCostExample(context);
  const sampleCost = (first.inputUsdPerMillion * example.inputTokens + first.outputUsdPerMillion * example.outputTokens) / 1_000_000;
  return Number.isFinite(sampleCost) ? sampleCost : null;
}

/** Pure rules: no AI-generated capability facts, availability assumptions, network calls or charges. */
export function recommendModels(answers: GuidanceAnswers, catalog: GuidanceCatalogModel[], prices: GuidancePublicPrice[] = []): GuidanceRecommendationResult {
  const result: GuidanceRecommendationResult = { recommendations: [], excludedCounts: { unavailable: 0, unsupported: 0, unverified: 0, modality: 0, context: 0, duplicate: 0 }, notice: resultNotice };
  if (!isGuidanceAnswers(answers)) throw new TypeError("Invalid model-selection answers");
  const seen = new Set<string>();
  const eligible: Array<{ model: GuidanceCatalogModel; guidance: ModelGuidance; policy: NonNullable<ReturnType<typeof selection.get>>; cost: number | null; context: number | null }> = [];
  for (const model of catalog) {
    if (model.available !== true) { result.excludedCounts.unavailable++; continue; }
    if (model.category !== "text" || model.requestKind !== "chat") { result.excludedCounts.unsupported++; continue; }
    const guidance = getModelGuidance(model.id);
    const policy = selection.get(model.id);
    if (!guidance || !policy) { result.excludedCounts.unverified++; continue; }
    if (!policy.recommendable) { result.excludedCounts.unavailable++; continue; }
    if (answers.input === "image" && (!guidance.inputModalities.includes("image") || !model.inputModalities?.includes("image"))) { result.excludedCounts.modality++; continue; }
    const specifiedCap = model.contextTokens;
    const context = specifiedCap === undefined ? guidance.contextTokens : Number.isSafeInteger(specifiedCap) && specifiedCap > 0 && guidance.contextTokens !== null ? Math.min(specifiedCap, guidance.contextTokens) : null;
    if (answers.context === "long" && (context === null || context < GUIDANCE_LONG_CONTEXT_TOKENS + guidanceCostExample("long").outputTokens)) { result.excludedCounts.context++; continue; }
    const key = routeKey(model);
    if (seen.has(key)) { result.excludedCounts.duplicate++; continue; }
    seen.add(key);
    eligible.push({ model, guidance, policy, cost: priceFor(model, prices, answers.context), context });
  }
  const taskFit = (row: typeof eligible[number]) => answers.task === "creative" || answers.task === "writing" ? (row.policy.fit.includes(answers.task) ? 0 : 1) : answers.task === "general" || row.policy.fit.includes(answers.task) ? 0 : 1;
  const modes = answers.priority === "speed" || answers.priority === "economy" ? ["focused", "balanced", "deliberate"] : answers.priority === "quality" ? ["deliberate", "balanced", "focused"] : ["balanced", "deliberate", "focused"];
  eligible.sort((a, b) => {
    // Economy compares the disclosed short/long-context example, never a supplier price.
    if (answers.priority === "economy") {
      const known = Number(a.cost === null) - Number(b.cost === null);
      if (known) return known;
      if (a.cost !== null && b.cost !== null && a.cost !== b.cost) return a.cost - b.cost;
    }
    if (answers.priority === "speed") {
      const mode = modes.indexOf(a.policy.mode) - modes.indexOf(b.policy.mode);
      if (mode) return mode;
    }
    return taskFit(a) - taskFit(b)
      || Number(!a.policy.current) - Number(!b.policy.current)
      || modes.indexOf(a.policy.mode) - modes.indexOf(b.policy.mode)
      || compareText(a.model.id, b.model.id) || compareText(a.model.service ?? "", b.model.service ?? "");
  });
  // Start with different families so the shortlist contains alternatives, not three aliases of one model.
  const chosen: typeof eligible = [];
  for (const row of eligible) if (!chosen.some(item => item.guidance.family === row.guidance.family)) { chosen.push(row); if (chosen.length === 3) break; }
  if (chosen.length < 3) for (const row of eligible) if (!chosen.includes(row)) { chosen.push(row); if (chosen.length === 3) break; }
  result.recommendations = chosen.map(row => {
    const { model, guidance, policy, cost } = row;
    const reasons: GuidanceText[] = [guidance.positioning];
    const tradeoffs: GuidanceText[] = [];
    if (answers.task !== "general") {
      const evidence = guidance.dimensions[answers.task];
      if (evidence.basis !== "unknown") reasons.push(evidence.detail);
      else tradeoffs.push(t("该版本缺少这一任务的专门证据，建议先做小样本评估。", "Version-specific evidence for this task is missing; start with a small evaluation."));
    }
    if (answers.priority === "economy") {
      if (cost !== null) reasons.push(answers.context === "long"
        ? t("按当前 tokvilo 零售价，以 128,000 输入 + 1,000 输出 tokens 的统一示例比较费用；实际输入输出比例会改变排序。", "Costs are compared at current tokvilo retail rates for the same example: 128,000 input + 1,000 output tokens. A different token mix can change the ordering.")
        : t("按当前 tokvilo 零售价，以 2,000 输入 + 1,000 输出 tokens 的统一示例比较费用；实际输入输出比例会改变排序。", "Costs are compared at current tokvilo retail rates for the same example: 2,000 input + 1,000 output tokens. A different token mix can change the ordering."));
      else tradeoffs.push(t("缺少可比的当前零售单价，不能确认这是最省钱的选项。", "Comparable current retail rates are missing; this cannot be confirmed as the cheapest option."));
    }
    if (answers.priority === "speed") { reasons.push(t("编辑规则优先选择轻量或响应效率定位的型号。", "The editorial rule prefers focused models or those positioned for response efficiency.")); tradeoffs.push(speedNote); }
    if (answers.priority === "quality") reasons.push(t("编辑规则优先考虑复杂任务与深入推理定位；这不构成跨厂商质量排名。", "The editorial rule favors complex-task and deeper-reasoning positioning; it is not a cross-vendor quality ranking."));
    if (answers.context === "long") reasons.push(t("按至少 128,000 输入 tokens 筛选，并额外预留 1,000 输出 tokens；若提供平台上限，则按它与官方窗口中的更小者筛选。", "The selection allows at least 128,000 input tokens plus 1,000 output tokens. When a platform cap is supplied, the smaller of it and the official window is used."));
    if (answers.input === "image") reasons.push(t("官方型号与该平台路由均明确列出图像输入。", "Both the official model and this platform route explicitly list image input."));
    if (policy.mode === "deliberate") tradeoffs.push(t("深入推理通常会增加生成长度和等待时间；正式任务前先取报价。", "Deeper reasoning can increase generated length and waiting time; obtain a quote before a production task."));
    if (policy.mode === "focused") tradeoffs.push(t("边界不清或需要长期规划的任务，建议同时比较更完整的推理型号。", "For ambiguous tasks or extended planning, compare a more deliberative model as well."));
    if (!policy.current) tradeoffs.push(t("这是较早代际，适合对照已有工作流；请留意版本状态。", "This is an earlier generation, useful for established-workflow comparisons; check its version status."));
    tradeoffs.push(t("推荐依据是公开资料与编辑规则，没有把其他型号的评测移植到此型号。", "Recommendations use public documentation and editorial rules; benchmark results from other model IDs are not inherited."));
    return { model, guidance, reasons, tradeoffs, sameFamilyAlternatives: eligible.filter(other => other.guidance.family === guidance.family && other.model.id !== model.id).filter((other, index, rows) => rows.findIndex(item => item.model.id === other.model.id) === index).slice(0, 3).map(other => ({ modelId: other.model.id, service: other.model.service, name: other.model.name })) };
  });
  return result;
}
