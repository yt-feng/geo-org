import { PricingError } from "./pricing";
import snapshot from "./rkapi-catalog-snapshot.json";

export const RKAPI_PATHS = { chat: "/v1/chat/completions", image: "/v1/images/generations" } as const;
export type RkapiRequest = { model: string; messages?: Array<{ role: string; content: string }>; max_tokens?: number; max_completion_tokens?: number; stream?: false;
  temperature?: number; top_p?: number; prompt?: string; size?: "1024x1024"; n?: 1; response_format?: "url" };
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

export function normalizeRkapiRequest(value: unknown, path?: string): RkapiRequest {
  if (!object(value) || typeof value.model !== "string") throw new PricingError("请选择 tokvilo 精选模型。", 400);
  const model = snapshot.models.find(model => model.id === value.model);
  if (!model || !model.adapter) throw new PricingError("此精选模型尚未开放调用，请选择已开通模型。", 422);
  if (path && path !== RKAPI_PATHS[model.adapter as keyof typeof RKAPI_PATHS]) throw new PricingError("模型与请求接口不匹配。", 400);
  const allowed = model.adapter === "chat" ? ["model", "messages", "max_tokens", "max_completion_tokens", "stream", "temperature", "top_p", "n"] : ["model", "prompt", "size", "n", "response_format"];
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new PricingError("当前精选接口只接受工作台列出的参数。", 400);
  if (value.n !== undefined && value.n !== 1) throw new PricingError("每次请求仅支持一个结果。", 400);
  if (model.adapter === "image") {
    if (typeof value.prompt !== "string" || !value.prompt.trim() || value.prompt.length > 4_000 || value.size !== undefined && value.size !== "1024x1024"
      || value.response_format !== undefined && value.response_format !== "url") throw new PricingError("图像请求需填写描述，尺寸为 1024x1024，结果格式仅支持 url。", 400);
    return { model: model.id, prompt: value.prompt, size: "1024x1024", n: 1, response_format: "url" };
  }
  if (value.stream !== undefined && value.stream !== false) throw new PricingError("精选接口当前支持完整响应，请设置 stream=false。", 400);
  if (!Array.isArray(value.messages) || !value.messages.length || value.messages.length > 100) throw new PricingError("messages 需包含 1–100 条文本消息。", 400);
  const messages = value.messages.map(message => {
    if (!object(message) || Object.keys(message).some(key => !["role", "content"].includes(key)) || !["system", "user", "assistant"].includes(String(message.role))
      || typeof message.content !== "string" || !message.content.trim()) throw new PricingError("当前精选接口仅支持纯文本消息。", 400);
    return { role: String(message.role), content: message.content };
  });
  if (new TextEncoder().encode(JSON.stringify(messages)).byteLength > 32_000) throw new PricingError("消息内容不能超过 32 KB。", 400);
  if (value.max_tokens !== undefined && value.max_completion_tokens !== undefined) throw new PricingError("只需设置一个输出 token 上限。", 400);
  const limit = value.max_completion_tokens ?? value.max_tokens;
  if (!Number.isSafeInteger(limit) || Number(limit) < 1 || Number(limit) > 4_096) throw new PricingError("请将输出 token 上限设置为 1–4096。", 400);
  for (const [key, max] of [["temperature", 2], ["top_p", 1]] as const) if (value[key] !== undefined && (typeof value[key] !== "number" || !Number.isFinite(value[key]) || value[key] < 0 || value[key] > max)) throw new PricingError(`${key} 超出支持范围。`, 400);
  return { model: model.id, messages, ...(value.max_completion_tokens !== undefined ? { max_completion_tokens: Number(limit) } : { max_tokens: Number(limit) }), stream: false, n: 1,
    ...(value.temperature !== undefined ? { temperature: Number(value.temperature) } : {}), ...(value.top_p !== undefined ? { top_p: Number(value.top_p) } : {}) };
}
