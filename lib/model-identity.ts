/** Public identity and navigation metadata only; never import pricing or credentials here. */
export type ModelIdentity = { id: string; name?: string; provider?: string; category?: string };
export type ProviderIdentity = { id: string; name: string; nameEn?: string; logo?: string; color: string };
export type ModelFamily = { id: string; name: string; nameEn?: string };

const providers: Array<ProviderIdentity & { aliases: string[] }> = [
  { id: "openai", name: "OpenAI", logo: "openai", color: "#10a37f", aliases: ["OPENAI", "CHATGPT", "GPT"] },
  { id: "anthropic", name: "Anthropic", logo: "anthropic", color: "#c97d60", aliases: ["ANTHROPIC", "CLAUDE"] },
  { id: "google", name: "Google", logo: "google", color: "#4285f4", aliases: ["GOOGLE", "GEMINI", "GOOGLE DEEPMIND", "DEEPMIND"] },
  { id: "deepseek", name: "DeepSeek", logo: "deepseek", color: "#536dfe", aliases: ["DEEPSEEK", "深度求索"] },
  { id: "alibaba", name: "阿里巴巴", logo: "alibaba", color: "#ff6a00", aliases: ["ALIBABA", "QWEN", "阿里巴巴", "通义千问"] },
  { id: "zhipu", name: "智谱", logo: "zhipu", color: "#5275eb", aliases: ["ZHIPU", "ZHIPUAI", "Z.AI", "GLM", "智谱"] },
  { id: "bytedance", name: "字节跳动", logo: "bytedance", color: "#3c8cff", aliases: ["BYTEDANCE", "字节跳动", "DOUBAO"] },
  { id: "xai", name: "xAI", logo: "xai", color: "#909090", aliases: ["XAI", "X.AI", "GROK"] },
  { id: "black-forest-labs", name: "Black Forest Labs", logo: "bfl", color: "#959595", aliases: ["BLACK FOREST LABS", "BFL", "FLUX"] },
  { id: "kuaishou", name: "快手", logo: "kling", color: "#ff5b31", aliases: ["KUAISHOU", "KLING", "快手", "可灵"] },
  { id: "minimax", name: "MiniMax", logo: "minimax", color: "#ee4576", aliases: ["MINIMAX", "HAILUO"] },
  { id: "moonshot", name: "月之暗面", logo: "moonshot", color: "#6697ee", aliases: ["MOONSHOT", "KIMI", "月之暗面"] },
  { id: "xiaomi", name: "小米", logo: "xiaomimimo", color: "#ff6900", aliases: ["XIAOMI", "MIMO", "小米"] },
  { id: "microsoft", name: "Microsoft", logo: "microsoft", color: "#00a4ef", aliases: ["MICROSOFT", "微软"] },
  { id: "tencent", name: "腾讯", logo: "tencent", color: "#1479ef", aliases: ["TENCENT", "HUNYUAN", "腾讯", "混元"] },
  { id: "shengshu", name: "生数科技", logo: "vidu", color: "#3475ff", aliases: ["SHENGSHU", "VIDU", "生数科技"] },
  { id: "pixverse", name: "PixVerse", logo: "pixverse", color: "#9d65e8", aliases: ["PIXVERSE"] },
  { id: "skyreels", name: "SkyReels", color: "#6782ec", aliases: ["SKYREELS"] },
  { id: "stepfun", name: "阶跃星辰", logo: "stepfun", color: "#3e6eff", aliases: ["STEPFUN", "阶跃星辰"] },
  { id: "suno", name: "Suno", logo: "suno", color: "#ed9566", aliases: ["SUNO"] },
  { id: "midjourney", name: "Midjourney", logo: "midjourney", color: "#7392b7", aliases: ["MIDJOURNEY"] },
];
const aliasKey = (value: string) => value.trim().toUpperCase().replace(/[ _-]+/g, "");
const providerAliases = new Map(providers.flatMap(provider => [provider.id, provider.name, ...provider.aliases].map(alias => [aliasKey(alias), provider] as const)));
const providerEnglishNames: Record<string, string> = { alibaba: "Alibaba", zhipu: "Zhipu", bytedance: "ByteDance", kuaishou: "Kuaishou", moonshot: "Moonshot AI", xiaomi: "Xiaomi", tencent: "Tencent", shengshu: "Shengshu", stepfun: "StepFun" };

export function providerIdentity(provider: string): ProviderIdentity {
  const known = providerAliases.get(aliasKey(provider));
  if (known) return { id: known.id, name: known.name, nameEn: providerEnglishNames[known.id] || known.name, logo: known.logo ? `/provider-logos/${known.logo}.svg` : undefined, color: known.color };
  const name = provider.trim() || "其他";
  return { id: name === "其他" ? "other" : name.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-").replace(/^-|-$/g, "") || "other", name, nameEn: name === "其他" ? "Other" : name, color: "#8f8e89" };
}

/** Manufacturer identification is independent of the tokvilo service carrying a model. */
export function modelProvider(id: string): string {
  const value = id.toLowerCase();
  if (/^(gpt-|chatgpt-|dall-e|o[1-9](?:-|$)|babbage|davinci|text-|omni-moderation|sora|whisper|tts-|codex(?:-|$))/.test(value)) return "OPENAI";
  if (/^(gemini-|imagen-|veo|omni-flash)/.test(value)) return "GOOGLE";
  if (/^claude(?:-|$)/.test(value)) return "ANTHROPIC";
  if (/^(seedream|seedance|dreamina|doubao|seed-)/.test(value)) return "BYTEDANCE";
  if (/^deepseek(?:-|$)/.test(value)) return "DEEPSEEK";
  if (/^glm(?:-|$)/.test(value)) return "ZHIPU";
  if (/^(qwen|wan[0-9-]|z-image|happyhorse)/.test(value)) return "ALIBABA";
  if (/^flux(?:-|$)/.test(value)) return "BLACK FOREST LABS";
  if (/^kling(?:-|$)/.test(value)) return "KUAISHOU";
  if (/^grok(?:-|$)/.test(value)) return "XAI";
  if (/^(minimax|hailuo)(?:-|$)/.test(value)) return "MINIMAX";
  if (/^(kimi|moonshot)(?:-|$)/.test(value)) return "MOONSHOT";
  if (/^mimo(?:-|$)/.test(value)) return "XIAOMI";
  if (/^mai(?:-|$)/.test(value)) return "MICROSOFT";
  if (/^(hy-image|hunyuan)/.test(value)) return "TENCENT";
  if (/^vidu/.test(value)) return "SHENGSHU";
  if (/^pixverse(?:-|$)/.test(value)) return "PIXVERSE";
  if (/^skyreels(?:-|$)/.test(value)) return "SKYREELS";
  if (/^step(?:-|$)/.test(value)) return "STEPFUN";
  if (/^suno(?:-|$)/.test(value)) return "SUNO";
  if (/^midjourney(?:-|$)/.test(value)) return "MIDJOURNEY";
  return "其他";
}

export function modelFamily(model: ModelIdentity): ModelFamily {
  const value = model.id.toLowerCase();
  const englishNames: Record<string, string> = { "gpt-realtime": "GPT Realtime", "gpt-transcribe": "GPT Transcription", "openai-o": "OpenAI o Series", "gemini-image": "Gemini Image", "grok-video": "Grok Imagine Video", "grok-image": "Grok Imagine Image", hailuo: "Hailuo", kling: "Kling", wan: "Wan", hunyuan: "Hunyuan Image", embedding: "Text Embedding", moderation: "Content Moderation", "legacy-completion": "Legacy Completion" };
  const family = (id: string, name: string): ModelFamily => ({ id, name, nameEn: englishNames[id] || name });
  if (/^gpt-image/.test(value)) return family("gpt-image", "GPT Image");
  if (/^(gpt-|chatgpt-|codex)/.test(value)) {
    if (/realtime/.test(value)) return family("gpt-realtime", "GPT 实时音频");
    if (/transcribe/.test(value)) return family("gpt-transcribe", "GPT 语音转写");
    return family("gpt", "GPT");
  }
  if (/^o[1-9](?:-|$)/.test(value)) return family("openai-o", "OpenAI o 系列");
  if (/^claude/.test(value)) return family("claude", "Claude");
  if (/^(gemini-|omni-flash)/.test(value)) return /image|banana/.test(value) ? family("gemini-image", "Gemini 图像") : /omni/.test(value) ? family("gemini-omni", "Gemini Omni") : family("gemini", "Gemini");
  if (/^deepseek/.test(value)) return /ocr/.test(value) ? family("deepseek-ocr", "DeepSeek OCR") : family("deepseek", "DeepSeek");
  if (/^qwen/.test(value)) return /image/.test(value) ? family("qwen-image", "Qwen Image") : family("qwen", "Qwen");
  if (/^glm/.test(value)) return family("glm", "GLM");
  if (/^flux/.test(value)) return /video/.test(value) ? family("flux-video", "FLUX Video") : family("flux", "FLUX");
  if (/^grok/.test(value)) return /imagine/.test(value) ? (model.category === "video" || /video/.test(value) ? family("grok-video", "Grok Imagine 视频") : family("grok-image", "Grok Imagine 图像")) : family("grok", "Grok");
  if (/^(minimax|hailuo)/.test(value)) return /hailuo|^minimax-h/.test(value) ? family("hailuo", "海螺 Hailuo") : family("minimax", "MiniMax");
  if (/^(kimi|moonshot)/.test(value)) return family("kimi", "Kimi");
  const rules: Array<[RegExp, string, string]> = [
    [/^veo/, "veo", "Veo"], [/^kling/, "kling", "可灵 Kling"], [/^wan/, "wan", "万相 Wan"],
    [/^seedance/, "seedance", "Seedance"], [/^(seedream|dreamina)/, "seedream", "Seedream"],
    [/^imagen/, "imagen", "Imagen"], [/^dall-e/, "dall-e", "DALL·E"], [/^sora/, "sora", "Sora"],
    [/^z-image/, "z-image", "Z-Image"], [/^happyhorse/, "happyhorse", "HappyHorse"],
    [/^mimo/, "mimo", "MiMo"], [/^mai/, "mai", "MAI Image"], [/^(hy-image|hunyuan)/, "hunyuan", "混元图像"],
    [/^vidu/, "vidu", "Vidu"], [/^pixverse/, "pixverse", "PixVerse"], [/^skyreels/, "skyreels", "SkyReels"],
    [/^step/, "step", "Step"], [/^suno/, "suno", "Suno"], [/^midjourney/, "midjourney", "Midjourney"],
    [/^flowmusic/, "flowmusic", "FlowMusic"], [/^whisper/, "whisper", "Whisper"], [/^tts-/, "tts", "TTS"],
    [/^text-embedding/, "embedding", "文本向量"], [/^(omni-|text-)moderation/, "moderation", "内容审核"],
    [/^(babbage|davinci)/, "legacy-completion", "经典文本补全"],
  ];
  const match = rules.find(([pattern]) => pattern.test(value));
  if (match) return family(match[1], match[2]);
  // Unrecognised products stay distinct instead of being hidden inside a fabricated brand.
  return family(value, model.name || model.id);
}

function versionParts(id: string) {
  const match = id.toLowerCase().match(/\d+(?:[.-]\d{1,3}(?!\d|[a-z]))*/);
  return match ? match[0].split(/[.-]/).map(Number) : [];
}
const natural = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
function dateVariant(id: string): number {
  const full = id.match(/(?:^|-)(20\d{2})-?(\d{2})-?(\d{2})(?:-|$)/);
  if (full) return Number(`${full[1]}${full[2]}${full[3]}`);
  const short = id.match(/(?:^|-)(\d{4}|\d{6})(?:-|$)/);
  return short ? Number(short[1]) : 0;
}

/** Sort identifier versions, not claimed release dates or measured model quality. */
export function compareModelVersions(a: ModelIdentity & { upstream?: string }, b: ModelIdentity & { upstream?: string }): number {
  const av = versionParts(a.id), bv = versionParts(b.id);
  for (let index = 0; index < Math.max(av.length, bv.length); index++) {
    const difference = (bv[index] || 0) - (av[index] || 0);
    if (difference) return difference;
  }
  return dateVariant(b.id) - dateVariant(a.id) || natural.compare(a.id, b.id) || natural.compare(a.upstream || "", b.upstream || "") || natural.compare(a.name || "", b.name || "");
}

export function groupModels<T extends ModelIdentity & { provider: string; upstream?: string }>(models: T[]): Array<{ provider: string; family: ModelFamily; models: T[] }> {
  const groups = new Map<string, { provider: string; family: ModelFamily; models: T[] }>();
  for (const model of models) {
    const provider = providerIdentity(model.provider), family = modelFamily(model), key = `${provider.id}:${family.id}`;
    const group = groups.get(key);
    if (group) group.models.push(model);
    else groups.set(key, { provider: model.provider, family, models: [model] });
  }
  const rank = (provider: string) => { const index = providers.findIndex(item => item.id === providerIdentity(provider).id); return index < 0 ? providers.length : index; };
  return [...groups.values()].sort((a, b) => rank(a.provider) - rank(b.provider) || natural.compare(providerIdentity(a.provider).name, providerIdentity(b.provider).name) || natural.compare(a.family.name, b.family.name))
    .map(group => ({ ...group, models: [...group.models].sort(compareModelVersions) }));
}
