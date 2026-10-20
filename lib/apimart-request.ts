import { PricingError } from "./pricing";
import { upstreamModelId } from "./model-id";
import { APIMART_IMAGE_MODELS } from "./apimart-image-options";
export { APIMART_IMAGE_MODELS } from "./apimart-image-options";
import { normalizeMidjourneyRequest } from "./apimart-midjourney";
import { normalizeVideoRequest } from "./apimart-video-request";
export { APIMART_VIDEO_MODELS } from "./apimart-video-options";
import { modelRequestKind } from "./model-request-kind";

type Json = Record<string, unknown>;
const object = (value: unknown): value is Json => !!value && typeof value === "object" && !Array.isArray(value);
export const APIMART_PATHS = { chat: "/v1/chat/completions", image: "/v1/images/generations", video: "/v1/videos/generations", audio: "/v1/music/generations" } as const;
export type ApimartKind = keyof typeof APIMART_PATHS;
export function apimartRequestKind(path: string): ApimartKind {
  const kind = (Object.keys(APIMART_PATHS) as ApimartKind[]).find(kind => APIMART_PATHS[kind] === path);
  if (!kind) throw new PricingError("此接口尚未开通。", 404);
  return kind;
}
export const isMusicModel = (model: string) => model === "suno" || model === "flowmusic";
function fail(message: string): never { throw new PricingError(message, 400); }
function keys(body: Json, allowed: string[]) { if (Object.keys(body).some(key => !allowed.includes(key))) fail("请求包含尚未开通计费的参数。"); }
function string(body: Json, key: string, max: number, required = false) {
  if (body[key] === undefined && !required) return;
  if (typeof body[key] !== "string" || String(body[key]).length > max || (required && !String(body[key]).trim())) fail(`${key} 内容无效。`);
}
function integer(body: Json, key: string, min: number, max: number) {
  if (body[key] !== undefined && (!Number.isSafeInteger(body[key]) || Number(body[key]) < min || Number(body[key]) > max)) fail(`${key} 应为 ${min}–${max} 的整数。`);
}
function booleans(body: Json, fields: string[]) {
  for (const key of fields) if (body[key] !== undefined && typeof body[key] !== "boolean") fail(`${key} 应为布尔值。`);
}
function imageUrls(body: Json, max: number) {
  if (body.image_urls === undefined) return;
  if (!Array.isArray(body.image_urls) || body.image_urls.length > max || !body.image_urls.every(value => {
    if (typeof value !== "string" || value.length > 2048) return false;
    try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password; } catch { return false; }
  })) fail(`参考图须使用公开 HTTPS URL，最多 ${max} 张。`);
}

/** The quote and paid submission normalize the same exact body before hashing. */
export function normalizeApimartRequest(input: Json, path: string): Json {
  if (typeof input.model !== "string" || !input.model.trim() || input.model.length > 200) fail("请填写有效模型 ID。");
  const body: Json = { ...input, model: upstreamModelId(input.model) };
  const model = String(body.model), kind = apimartRequestKind(path);
  if (kind === "chat") {
    if (modelRequestKind(model, "llm") !== "chat") fail("此模型需要专用接口，当前不支持对话调用。");
    keys(body, ["model", "messages", "stream", "max_tokens", "max_completion_tokens", "temperature", "top_p"]);
    if (body.stream !== undefined && body.stream !== false) fail("请设置 stream: false。");
    if (!Array.isArray(body.messages) || !body.messages.length || body.messages.length > 100 || !body.messages.every(message => object(message) &&
      Object.keys(message).every(key => ["role", "content"].includes(key)) && ["user", "assistant", "system"].includes(String(message.role)) && typeof message.content === "string")) fail("当前对话接口接受纯文本 messages。");
    if (body.max_tokens !== undefined && body.max_completion_tokens !== undefined) fail("请只指定一种最大输出参数。");
    const max = body.max_completion_tokens ?? body.max_tokens ?? 1024;
    if (!Number.isSafeInteger(max) || Number(max) < 1 || Number(max) > 4096) fail("最大输出 token 应为 1–4096。");
    for (const key of ["temperature", "top_p"]) if (body[key] !== undefined && (typeof body[key] !== "number" || !Number.isFinite(body[key]) || Number(body[key]) < 0 || Number(body[key]) > (key === "temperature" ? 2 : 1))) fail("采样参数无效。");
    body.stream = false; body.max_tokens = max; delete body.max_completion_tokens;
    return body;
  }
  if (kind === "image") {
    if (model === "midjourney") return normalizeMidjourneyRequest(body);
    if (!APIMART_IMAGE_MODELS.has(model)) fail("此图片型号的请求或计费参数尚未开通。");
    if (model === "flux-3-image-klein" || model === "hy-image-v3.5-preview") {
      const klein = model === "flux-3-image-klein";
      keys(body, ["model", "prompt", "n", "size", "resolution", "image_urls", ...(klein ? ["aspect_ratio"] : [])]);
      string(body, "prompt", 10000, true);
      if (body.n !== undefined && body.n !== 1) fail("每次请求仅支持生成 1 张图片。");
      if (body.size !== undefined && body.aspect_ratio !== undefined) fail("请只填写 size 或 aspect_ratio。");
      for (const field of ["size", "aspect_ratio"]) if (body[field] !== undefined && typeof body[field] !== "string") fail("图片比例无效。");
      const suppliedRatio = body.size ?? body.aspect_ratio ?? "auto";
      if (typeof suppliedRatio !== "string") fail("图片比例无效。");
      const ratio = klein ? suppliedRatio.replace(/^(\d{1,2})x(\d{1,2})$/, "$1:$2") : suppliedRatio;
      const ratios = klein
        ? ["auto", "21:9", "2:1", "16:9", "3:2", "7:5", "4:3", "5:4", "1:1", "4:5", "3:4", "5:7", "2:3", "9:16", "1:2", "9:21"]
        : ["auto", "1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"];
      if (!ratios.includes(ratio)) fail("此型号不支持该比例；自定义像素尺寸尚未开通。");
      const suppliedResolution = body.resolution === undefined ? "1k" : body.resolution;
      if (typeof suppliedResolution !== "string") fail("图片分辨率无效。");
      let resolution = suppliedResolution.toLowerCase();
      if (klein && resolution === "768") resolution = "768sq";
      if (!(klein ? ["768sq", "1k", "1.5k", "2k", "4k"] : ["1k", "2k", "4k"]).includes(resolution)) fail("此型号不支持该分辨率。");
      imageUrls(body, klein ? 10 : 5);
      delete body.aspect_ratio;
      return { ...body, n: 1, size: ratio, resolution: klein ? resolution : resolution.toUpperCase() };
    }
    keys(body, ["model", "prompt", "n", "size", "resolution", "image_urls", "quality", "version"]);
    string(body, "prompt", 10000, true);
    if (body.n !== undefined && body.n !== 1) fail("每次请求仅支持生成 1 张图片。");
    if (body.resolution !== undefined && (typeof body.resolution !== "string" || !/^(?:(?:0\.5|1|1\.5|2|4)k|[1-4]mp|768sq)$/i.test(body.resolution))) fail("图片分辨率无效。");
    if (body.size !== undefined && (typeof body.size !== "string" || !/^(auto|[1-9][0-9]?:[1-9][0-9]?|(?:1024|1536|1792)x(?:1024|1536|1792))$/.test(body.size))) fail("图片尺寸或比例无效。");
    if (body.quality !== undefined && !["low", "medium", "high", "auto", "standard", "hd"].includes(String(body.quality))) fail("图片质量无效。");
    if (body.version !== undefined && !["flare", "sunburst"].includes(String(body.version))) fail("图片版本无效。");
    if (typeof body.size === "string" && /^\d+x\d+$/.test(body.size)) fail("请使用图片比例与分辨率；自定义像素尺寸尚未开通报价。");
    const referenceLimit = ["imagen-4.0-apimart", "grok-imagine-2.0-ext", "z-image-turbo"].includes(model) ? 0
      : /^seedream-5-0-(pro|flash)$/.test(model) ? 1 : model.startsWith("qwen-image-3.0") ? 3 : model.startsWith("flux-2-") ? 8 : 10;
    imageUrls(body, referenceLimit);
    if (model === "gpt-image-2") { body.size ??= "1:1"; body.resolution ??= "1k"; }
    if (model === "imagen-4.0-apimart" && body.resolution !== undefined) fail("此型号不接受分辨率参数。");
    if (model === "seedream-5-0-flash" && body.resolution !== undefined && !["1k", "1.5k"].includes(String(body.resolution).toLowerCase())) fail("此型号目前仅开通 1K 与 1.5K 报价。");
    if (model === "seedream-5-0-pro") body.resolution ??= "1k";
    if (model === "z-image-turbo") { delete body.n; return body; }
    return { ...body, n: 1 };
  }
  if (kind === "audio") {
    if (!isMusicModel(model)) fail("此音频模型需要其他专用接口。");
    if (model === "flowmusic") {
      keys(body, ["model", "sound_prompt", "lyrics", "title", "bpm", "length", "seed"]);
      for (const key of ["sound_prompt", "lyrics"]) string(body, key, 10000);
      if (!String(body.sound_prompt || "").trim() && !String(body.lyrics || "").trim()) fail("请填写音乐描述或歌词。");
      string(body, "title", 200); string(body, "seed", 100); integer(body, "length", 1, 240);
      if (body.bpm !== undefined && (typeof body.bpm !== "string" || !/^[1-9]\d{0,3}$/.test(body.bpm))) fail("bpm 应为正整数文本。");
      return body;
    }
    keys(body, ["model", "prompt", "custom", "instrumental", "version", "title", "style", "negative_tags", "auto_lyrics", "vocal_gender", "style_weight", "weirdness_constraint", "audio_weight", "variety", "max_mode", "audio_format", "duration"]);
    booleans(body, ["custom", "instrumental", "auto_lyrics", "max_mode"]);
    body.version ??= "v6"; body.custom ??= false;
    if (!["v6", "v6-wild", "v6-mini"].includes(String(body.version))) fail("请选择已支持的音乐版本。");
    string(body, "prompt", body.custom ? 5000 : 3000, !body.custom || !body.instrumental);
    string(body, "title", 80); string(body, "style", 1000); string(body, "negative_tags", 1000);
    for (const key of ["style_weight", "weirdness_constraint", "audio_weight"]) if (body[key] !== undefined && (typeof body[key] !== "number" || !Number.isFinite(body[key]) || Number(body[key]) < 0 || Number(body[key]) > 1)) fail(`${key} 应为 0–1。`);
    if (body.vocal_gender !== undefined && !["Male", "Female", "m", "f", "male", "female"].includes(String(body.vocal_gender))) fail("人声选项无效。");
    if (body.variety !== undefined && !["off", "normal", "high", "extra", "max"].includes(String(body.variety))) fail("音乐变化选项无效。");
    if (body.audio_format !== undefined && !["mp3", "m4a", "wav"].includes(String(body.audio_format))) fail("音频格式无效。");
    integer(body, "duration", 10, 360);
    if (!body.custom && (body.max_mode || body.duration !== undefined)) fail("时长与 Max 模式需启用自定义音乐。");
    return body;
  }
  return normalizeVideoRequest(body);
}
