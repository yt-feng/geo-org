import { TOKENHUB_REFERENCE_MODELS } from "./tokenhub-model-reference";

export type ModelCategory = "image" | "video" | "text" | "audio";
export type CatalogModel = {
  id: string;
  name: string;
  provider: string;
  category: ModelCategory;
  description: string;
  capabilities: string[];
  docs: string;
  upstream?: "apimart" | "tokenhub";
};

export const modelCategories: Array<{ id: ModelCategory; label: string; icon: string }> = [
  { id: "image", label: "图像", icon: "image" },
  { id: "video", label: "视频", icon: "video" },
  { id: "text", label: "LLM", icon: "message" },
  { id: "audio", label: "音频", icon: "audio" },
];

const docs = "https://docs.apimart.ai/en/api-reference/";

// Public capability references, not a declaration of enabled gateway routes.
// Availability and exact model identifiers come from the configured provider.
export const modelCatalog: CatalogModel[] = [
  { id: "gpt-image-2", name: "GPT Image 2", provider: "OPENAI", category: "image", description: "从文字到图像，将创意、视觉细节与画面编辑融入同一工作流。", capabilities: ["文生图", "图生图"], docs: docs + "images/gpt-image-2/generation" },
  { id: "gemini-3.1-flash-image-preview", name: "Nano Banana 2", provider: "GOOGLE", category: "image", description: "Google 图像模型，支持文字生成与参考图编辑。", capabilities: ["文生图", "图生图"], docs: docs + "images/gemini-3.1-flash/generation" },
  { id: "seedream-5-0-lite", name: "Seedream 5.0 Lite", provider: "BYTEDANCE", category: "image", description: "将文本、参考图片与连续图像创作整合到一个图像模型。", capabilities: ["文生图", "图生图"], docs: docs + "images/seedream-5-lite/generation" },
  { id: "gpt-image-1.5", name: "GPT Image 1.5", provider: "OPENAI", category: "image", description: "支持图像生成、参考图编辑与局部重绘的图像模型。", capabilities: ["文生图", "图生图"], docs: docs + "images/gpt-image-1/generation" },
  { id: "seedream-4-5", name: "Seedream 4.5", provider: "BYTEDANCE", category: "image", description: "面向多种视觉创作场景的文字生成与图像编辑模型。", capabilities: ["文生图", "图生图"], docs: docs + "images/seedream-4.5/generation" },
  { id: "gemini-2.5-flash-image", name: "Nano Banana", provider: "GOOGLE", category: "image", description: "用自然语言描述画面，或从已有图像继续创作。", capabilities: ["文生图", "图生图"], docs: docs + "images/gemini-2.5-flash/generation" },
  { id: "gpt-image-1", name: "GPT Image 1", provider: "OPENAI", category: "image", description: "OpenAI 图像生成系列，支持文字到图像与基于图像的编辑。", capabilities: ["文生图", "图生图"], docs: docs + "images/gpt-image-1/generation" },
  { id: "seedream-4", name: "Seedream 4.0", provider: "BYTEDANCE", category: "image", description: "通过统一的提示词和参考图片完成图像生成任务。", capabilities: ["文生图", "图生图"], docs: docs + "images/seedream-4/generation" },
  { id: "flux-kontext-pro", name: "FLUX Kontext", provider: "BLACK FOREST LABS", category: "image", description: "围绕上下文理解展开的图像生成与编辑模型。", capabilities: ["文生图", "图生图"], docs: docs + "images/flux-kontext/generation" },
  { id: "veo3.1", name: "Veo 3.1", provider: "GOOGLE", category: "video", description: "通过文字或首帧图片构建视频，探索镜头与动态表达。", capabilities: ["文生视频", "图生视频"], docs: docs + "videos/veo3/generation" },
  { id: "kling-v2-6", name: "Kling 2.6", provider: "KUAISHOU", category: "video", description: "支持文字到视频、首帧和首尾帧控制的视频创作模型。", capabilities: ["文生视频", "图生视频"], docs: docs + "videos/kling-v2-6/generation" },
  { id: "wan2.6", name: "Wan 2.6", provider: "ALIBABA", category: "video", description: "通义万相视频模型，以文本或图像作为视频创作起点。", capabilities: ["文生视频", "图生视频"], docs: docs + "videos/wan2.6/generation" },
  { id: "gpt-5", name: "GPT", provider: "OPENAI", category: "text", description: "面向对话、内容创作和开发工作流的语言模型系列。", capabilities: ["文本生成", "对话"], docs: docs + "texts/general/chat-completions-nostream" },
  { id: "claude-sonnet-4-5", name: "Claude", provider: "ANTHROPIC", category: "text", description: "支持对话与工具使用的 Claude 模型系列。", capabilities: ["文本生成", "对话"], docs: docs + "texts/general/claude-messages" },
  { id: "gemini-2.5-pro", name: "Gemini", provider: "GOOGLE", category: "text", description: "Google 多模态模型系列，适用于理解与内容生成。", capabilities: ["文本生成", "对话"], docs: docs + "texts/gemini/quickstart" },
  { id: "suno", name: "Suno", provider: "SUNO", category: "audio", description: "从灵感描述开始生成音乐，也可以围绕歌词设计一首歌。", capabilities: ["音乐生成", "歌词生成"], docs: docs + "audios/suno/generation" },
];

// This dated public reference supplements, rather than replaces, the authenticated live catalog.
// Keep APIMart's preview catalog separate so TokenHub models cannot use its request builder.
export const tokenhubModelCatalog: CatalogModel[] = TOKENHUB_REFERENCE_MODELS.map(model => ({
  id: model.id,
  name: model.name,
  upstream: "tokenhub",
  provider: model.id.startsWith("glm-") ? "ZHIPU" : model.id.startsWith("deepseek-") ? "DEEPSEEK" : "BYTEDANCE",
  category: model.kind === "chat" ? "text" : model.kind,
  description: model.kind === "chat" ? "通过 ECO-GEO 统一接口调用此完整版本，使用对话与文本生成能力。" : model.kind === "image" ? "在 ECO-GEO 发起图像生成请求，统一记录上游响应和用量。" : "通过 ECO-GEO 创建视频任务，使用同一接口查询生成状态和结果。",
  capabilities: model.kind === "chat" ? ["文本生成", "对话"] : model.kind === "image" ? ["文生图"] : ["文生视频", "任务查询"],
  docs: "/dashboard/docs?provider=tokenhub",
}));
export const allModelCatalog: CatalogModel[] = [...tokenhubModelCatalog, ...modelCatalog];
export function modelWorkbenchUrl(model: CatalogModel) {
  return `${model.upstream === "tokenhub" ? "/tokenhub" : "/playground"}?model=${encodeURIComponent(model.id)}&category=${model.category}`;
}

export function providerInitials(provider: string) {
  return ({ OPENAI: "◎", GOOGLE: "G", BYTEDANCE: "|||", "BLACK FOREST LABS": "F.", KUAISHOU: "K", ALIBABA: "Q", ANTHROPIC: "A", SUNO: "S", ZHIPU: "Z", DEEPSEEK: "D" } as Record<string, string>)[provider] || provider.slice(0, 1);
}
