import { TOKENHUB_REFERENCE_MODELS } from "./tokenhub-model-reference";
import snapshot from "./model-directory-snapshot.json";
import { publicModelId } from "./model-id";
import { modelRequestKind, type ModelRequestKind } from "./model-request-kind";

export { modelRequestKind } from "./model-request-kind";

export type ModelCategory = "image" | "video" | "text" | "audio";
export type ModelDirectorySource = { service: "gateway" | "studio" | "selected"; observedAt: string | null; live: boolean };
export type CatalogModel = {
  id: string;
  name: string;
  provider: string;
  category: ModelCategory;
  description: string;
  capabilities: string[];
  docs: string;
  upstream?: "apimart" | "tokenhub" | "selected";
  available?: boolean;
  requestKind?: ModelRequestKind;
};

export const modelCategories: Array<{ id: ModelCategory; label: string; icon: string }> = [
  { id: "image", label: "图像", icon: "image" },
  { id: "video", label: "视频", icon: "video" },
  { id: "text", label: "文本", icon: "message" },
  { id: "audio", label: "音频", icon: "audio" },
];

// Complete dated inventory; server-rendered pages refresh it from the live catalogue.
// Only public model metadata is bundled here. Prices stay in the server pricing parser.
export function modelManufacturer(id: string): string {
  const value = id.toLowerCase();
  if (/^(gpt-|chatgpt-|dall-e|o[1-4](?:-|$)|babbage|davinci|text-|omni-moderation)/.test(value)) return "OPENAI";
  if (/^(gemini-|imagen-|veo|omni-flash)/.test(value)) return "GOOGLE";
  if (value.startsWith("claude-")) return "ANTHROPIC";
  if (/^(seedream|seedance)/.test(value)) return "BYTEDANCE";
  if (value.startsWith("deepseek-")) return "DEEPSEEK";
  if (value.startsWith("glm-")) return "ZHIPU";
  if (/^(qwen|wan[0-9]|z-image|happyhorse)/.test(value)) return "ALIBABA";
  if (value.startsWith("flux-")) return "BLACK FOREST LABS";
  if (value.startsWith("kling-")) return "KUAISHOU";
  if (value.startsWith("grok-")) return "XAI";
  if (value.startsWith("minimax-")) return "MINIMAX";
  if (value.startsWith("kimi-")) return "MOONSHOT";
  if (value.startsWith("mimo-")) return "XIAOMI";
  if (value.startsWith("mai-")) return "MICROSOFT";
  if (value.startsWith("vidu")) return "SHENGSHU";
  if (value.startsWith("pixverse-")) return "PIXVERSE";
  if (value.startsWith("skyreels-")) return "SKYREELS";
  if (value.startsWith("step-")) return "STEPFUN";
  if (value === "suno") return "SUNO";
  if (value === "midjourney") return "MIDJOURNEY";
  return "其他";
}
export function catalogEntry(id: string, name: string, category: ModelCategory, available?: boolean): CatalogModel {
  const requestKind = modelRequestKind(id, category);
  const labels: Record<ModelRequestKind, string> = { chat: "文本生成", image: "图像生成", video: "视频生成", music: "音乐生成",
    audio: "音频处理", embedding: "向量嵌入", moderation: "内容审核", transcription: "语音转写", speech: "语音合成",
    realtime: "实时音频", completion: "文本补全" };
  const capabilities = [labels[requestKind]];
  if (["transcription", "speech", "realtime", "audio"].includes(requestKind)) category = "audio";
  if (!["chat", "image", "video", "music"].includes(requestKind)) available = false;
  return { id: publicModelId(id), name: name.replace(/api[\s-]*mart/gi, "tokvilo").replace(/token[\s-]*hub/gi, "tokvilo"), provider: modelManufacturer(id), category, capabilities, requestKind,
    description: category === "text" ? "在 tokvilo 查看此版本的能力、售价与接口状态。" : "在 tokvilo 查看此模型的生成选项、售价与接口状态。",
    docs: "/dashboard/docs?provider=gateway", upstream: "apimart", available };
}
export const modelCatalog: CatalogModel[] = snapshot.models.map(row => catalogEntry(row.id, row.name, row.category as ModelCategory));

// This dated public reference supplements, rather than replaces, the authenticated live catalog.
// Keep APIMart's preview catalog separate so TokenHub models cannot use its request builder.
export const tokenhubModelCatalog: CatalogModel[] = TOKENHUB_REFERENCE_MODELS.map(model => ({
  id: model.id,
  name: model.name,
  upstream: "tokenhub",
  provider: model.id.startsWith("glm-") ? "ZHIPU" : model.id.startsWith("deepseek-") ? "DEEPSEEK" : "BYTEDANCE",
  category: model.kind === "chat" ? "text" : model.kind,
  description: model.kind === "chat" ? "通过 tokvilo 统一接口调用此完整版本，使用对话与文本生成能力。" : model.kind === "image" ? "在 tokvilo 发起图像生成请求，统一记录上游响应和用量。" : "通过 tokvilo 创建视频任务，使用同一接口查询生成状态和结果。",
  capabilities: model.kind === "chat" ? ["文本生成", "对话"] : model.kind === "image" ? ["文生图"] : ["文生视频", "任务查询"],
  docs: "/dashboard/docs?provider=studio",
}));
export const allModelCatalog: CatalogModel[] = [...tokenhubModelCatalog, ...modelCatalog];
export function modelWorkbenchUrl(model: CatalogModel) {
  return `${model.upstream === "tokenhub" ? "/studio" : model.upstream === "selected" ? "/selected" : "/playground"}?model=${encodeURIComponent(model.id)}&category=${model.category}`;
}

export function providerInitials(provider: string) {
  return ({ OPENAI: "◎", GOOGLE: "G", BYTEDANCE: "|||", "BLACK FOREST LABS": "F.", KUAISHOU: "K", ALIBABA: "Q", ANTHROPIC: "A", SUNO: "S", ZHIPU: "Z", DEEPSEEK: "D" } as Record<string, string>)[provider] || provider.slice(0, 1);
}
