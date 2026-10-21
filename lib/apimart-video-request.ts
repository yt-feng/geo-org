import { PricingError } from "./pricing";

type Json = Record<string, unknown>;
import { VIDEO_SPECS as specs } from "./apimart-video-options";
export { APIMART_VIDEO_MODELS, APIMART_VIDEO_SOURCES, VIDEO_DEFAULTS, VIDEO_UNAVAILABLE_REASONS } from "./apimart-video-options";

function fail(message: string): never { throw new PricingError(message, 400); }
function object(value: unknown): value is Json { return !!value && typeof value === "object" && !Array.isArray(value); }
function alias(body: Json, from: string, to: string) {
  if (body[from] === undefined || from === to) return;
  if (body[to] !== undefined && body[to] !== body[from]) fail(`${from} 与 ${to} 不能冲突。`);
  body[to] = body[from]; delete body[from];
}
function text(body: Json, name: string, max: number, required = false) {
  const value = body[name];
  if (value === undefined && !required) return;
  if (typeof value !== "string" || value.length > max || (required && !value.trim())) fail(`${name} 内容无效或过长。`);
}
function integer(value: unknown, name: string, min: number, max: number) {
  if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max) fail(`${name} 应为 ${min}–${max} 的整数。`);
}
function choice(value: unknown, name: string, options: (string | number)[]) {
  if (!options.includes(value as string)) fail(`${name} 不适用于此型号。`);
}
function url(value: unknown) {
  if (typeof value !== "string" || value.length > 2048) fail("参考图须为公开 HTTPS URL。");
  try { const u = new URL(value as string); if (u.protocol !== "https:" || u.username || u.password) fail("参考图须为公开 HTTPS URL。"); }
  catch { fail("参考图须为公开 HTTPS URL。"); }
}
function images(body: Json, key: string, maximum: number): string[] {
  if (body[key] === undefined) return [];
  const values = body[key];
  if (!Array.isArray(values) || values.length < 1 || values.length > maximum) fail(`${key} 应包含 1–${maximum} 张参考图。`);
  for (const item of values as unknown[]) url(item);
  return values as string[];
}

/** Returns provider field names and explicit billing defaults; never mutates input. */
export function normalizeVideoRequest(input: Json): Json {
  const body: Json = { ...input }, model = typeof body.model === "string" ? body.model : "";
  const spec = specs[model];
  if (!spec) fail("此视频模型的请求或计费参数尚未开通。");
  if (Object.values(body).some(value => value === null)) fail("参数不能为 null，请省略未使用的参数。");
  const ratioField = spec.ratioField ?? "aspect_ratio";
  if (spec.ratios) alias(body, ratioField === "size" ? "aspect_ratio" : "size", ratioField);
  if (spec.audio) alias(body, spec.audio === "audio" ? "generate_audio" : "audio", spec.audio);

  // The simple image_urls UI maps only where the provider's frame semantics are
  // equivalent. H3/HappyHorse image_urls are references and must stay references.
  if (spec.frames && !spec.images && body.image_urls !== undefined) {
    const urls = images(body, "image_urls", spec.frames === "first" ? 1 : 2);
    if (body.first_frame_image !== undefined || body.last_frame_image !== undefined || body.end_frame_image !== undefined) fail("请只使用一种首尾帧输入格式。");
    body.first_frame_image = urls[0];
    if (urls[1]) body[spec.frames === "end" ? "end_frame_image" : "last_frame_image"] = urls[1];
    delete body.image_urls;
  }
  if (model.startsWith("seedance-1-0-") && body.image_urls !== undefined) {
    const urls = images(body, "image_urls", model.endsWith("-fast") ? 1 : 2);
    if (body.image_with_roles !== undefined) fail("请只使用一种参考图输入格式。");
    body.image_with_roles = urls.map((value, i) => ({ url: value, role: i === 0 ? "first_frame" : "last_frame" }));
    delete body.image_urls;
  }
  if (spec.referenceRoles && body.image_urls !== undefined) {
    const urls = images(body, "image_urls", 5);
    if (body.image_with_roles !== undefined) fail("请只使用一种参考图输入格式。");
    body.image_with_roles = urls.map(value => ({ url: value, role: "reference_image" }));
    delete body.image_urls;
  }
  const allowed = ["model", "prompt", "duration", ...(spec.resolutions ? ["resolution"] : []),
    ...(spec.ratios ? [ratioField] : []), ...(spec.audio ? [spec.audio] : []),
    ...(spec.images ? ["image_urls"] : []), ...(spec.roles ? ["image_with_roles"] : []),
    ...(spec.frames ? ["first_frame_image", ...(spec.frames === "pair" ? ["last_frame_image"] : spec.frames === "end" ? ["end_frame_image"] : [])] : []),
    ...(spec.modes ? ["mode"] : []), ...(spec.seed ? ["seed"] : []),
    ...(spec.negativeMax ? ["negative_prompt"] : []), ...(spec.booleans ?? []), ...(spec.extra ?? [])];
  if (Object.keys(body).some(key => !allowed.includes(key))) fail("请求包含此型号尚未开通的参数。");
  const refs = images(body, "image_urls", spec.images ?? 0);
  const frameKeys = ["first_frame_image", "last_frame_image", "end_frame_image"].filter(key => body[key] !== undefined);
  for (const key of frameKeys) url(body[key]);
  if (refs.length && frameKeys.length) fail("参考图与首尾帧不能混用。");
  if (!spec.lastAlone && (body.last_frame_image || body.end_frame_image) && !body.first_frame_image) fail("尾帧必须与首帧同时提供。");
  let roleCount = 0;
  if (spec.referenceRoles && body.image_with_roles !== undefined) {
    if (!Array.isArray(body.image_with_roles) || !body.image_with_roles.length || body.image_with_roles.length > 5) fail("此型号需提供 1–5 张参考图。");
    let firstFrames = 0;
    body.image_with_roles = body.image_with_roles.map(entry => {
      if (!object(entry) || Object.keys(entry).some(key => !["url", "role"].includes(key))) fail("参考图角色参数无效。");
      const role = entry.role === undefined ? "reference_image" : entry.role;
      if (role !== "reference_image" && role !== "first_frame") fail("此型号仅支持参考图或首帧角色。");
      if (role === "first_frame" && ++firstFrames > 1) fail("此型号最多指定一张首帧。");
      url(entry.url);
      return { url: entry.url, role };
    });
    roleCount = (body.image_with_roles as unknown[]).length;
  } else if (body.image_with_roles !== undefined) {
    if (refs.length || frameKeys.length || !Array.isArray(body.image_with_roles) || !body.image_with_roles.length || body.image_with_roles.length > 2) fail("首尾帧角色参数无效。");
    const roles = new Set<string>();
    for (const entry of body.image_with_roles) {
      if (!object(entry) || Object.keys(entry).some(key => !["url", "role"].includes(key)) ||
        !["first_frame", "last_frame"].includes(String(entry.role)) || roles.has(String(entry.role))) fail("首尾帧角色参数无效。");
      url(entry.url); roles.add(String(entry.role));
    }
    if (!roles.has("first_frame") || (model === "seedance-1-0-pro-fast" && roles.has("last_frame"))) fail("此型号不支持所选首尾帧。");
    roleCount = roles.size;
  }
  const hasImage = !!(refs.length || frameKeys.length || roleCount);
  if (spec.requiredImages && !hasImage) fail("此型号需要参考图。");
  // A prompt is required by this gateway for all modes, including provider modes
  // where it is optional; this keeps intent explicit without inventing defaults.
  text(body, "prompt", spec.promptMax ?? 10000, true);
  if (spec.negativeMax) text(body, "negative_prompt", spec.negativeMax);
  if (model.startsWith("skyreels-") && new TextEncoder().encode(String(body.prompt)).length > 1280) fail("此型号提示词请控制在 1280 个 UTF-8 字节以内。");
  body.duration ??= spec.defaultDuration ?? 5;
  integer(body.duration, "duration", ...spec.duration);
  if (spec.durations) choice(body.duration, "duration", spec.durations);
  if (spec.resolutions) {
    body.resolution ??= spec.resolution;
    if (model === "flux-3-video") {
      if (body.resolution === "720p") body.resolution = "hd";
      if (body.resolution === "1080p") body.resolution = "fhd";
    }
    const resolution = typeof body.resolution === "string" && spec.resolutions.find(value => value.toLowerCase() === String(body.resolution).toLowerCase());
    if (!resolution) fail("resolution 不适用于此型号。");
    body.resolution = resolution;
  }
  if (spec.modes) { body.mode ??= "std"; choice(body.mode, "mode", spec.modes); }
  if (spec.ratios) {
    if (hasImage && spec.noImageRatio && body[ratioField] !== undefined) fail("此型号图片生成模式不接受画面比例参数。");
    if (!hasImage || !spec.noImageRatio) {
      body[ratioField] ??= spec.ratio ?? "16:9";
      choice(body[ratioField], ratioField, spec.ratios);
    }
  }
  if (spec.audio) body[spec.audio] ??= spec.audioDefault;
  for (const key of [...(spec.booleans ?? []), ...(spec.audio ? [spec.audio] : [])]) {
    if (body[key] !== undefined && typeof body[key] !== "boolean") fail(`${key} 应为布尔值。`);
  }
  if (spec.audioOnly && body[spec.audio!] !== true) fail("此型号只支持有声视频。");
  if (spec.seed && body.seed !== undefined) integer(body.seed, "seed", ...spec.seed);

  if (/^veo3\.1-(fast|quality|lite)$/.test(model)) {
    if (model.endsWith("-lite") && (refs.length || body.generation_type !== undefined)) fail("此型号只支持文本生成。");
    if (body.generation_type !== undefined) choice(body.generation_type, "generation_type", ["frame", "reference"]);
    if (body.generation_type !== undefined && !refs.length) fail("指定生成方式时需要参考图。");
    if ((body.generation_type === "frame" && refs.length > 2) ||
      (model.endsWith("-quality") && (body.generation_type === "reference" || refs.length > 2))) fail("此型号不支持所选参考图模式。");
  }
  if (model.endsWith("-official")) {
    if (body.sample_count !== undefined && body.sample_count !== 1) fail("每次请求仅支持生成 1 个视频。");
    body.sample_count = 1;
    if (body.person_generation !== undefined) choice(body.person_generation, "person_generation", ["allow_adult", "disallow"]);
    if (body.resize_mode !== undefined) choice(body.resize_mode, "resize_mode", ["pad", "crop"]);
    if (body.enhance_prompt !== undefined && body.enhance_prompt !== true) fail("此型号 enhance_prompt 只能为 true。");
  }
  if (model.startsWith("seedance-2.0") && model !== "seedance-2.0" && !["480p", "720p"].includes(String(body.resolution))) fail("此型号最高支持 720p。");
  if (model.startsWith("MiniMax-Hailuo-") && body.resolution === "1080p" &&
    body.duration !== (model === "MiniMax-Hailuo-02" ? 5 : 6)) fail("此型号 1080p 档位不支持所选时长。");
  if (model === "MiniMax-Hailuo-2.3-Fast" && !body.first_frame_image) fail("此型号必须提供首帧。");
  if (model === "MiniMax-H3-Max" && body.resolution === "1080P" && body.watermark !== undefined) fail("此型号 1080P 档位不能传 watermark。");
  if (model === "kling-v2-6" && ((body.audio === true && body.mode !== "pro") || (refs.length === 2 && (body.mode !== "pro" || body.audio === true)))) fail("此型号尾帧需要 pro 模式，且不能同时生成音频。");
  if (model === "wan2.5-preview" && body.resolution === "480p" && body.size !== undefined && !["16:9", "9:16", "1:1"].includes(String(body.size))) fail("480p 仅支持 16:9、9:16 或 1:1。");
  if (body.shot_type !== undefined) {
    choice(body.shot_type, "shot_type", ["single", "multi"]);
    if (model === "wan2.6-i2v-flash") {
      if (body.prompt_extend === false) fail("shot_type 需要开启 prompt_extend。");
      body.prompt_extend = true;
    }
  }
  if (model.startsWith("wan3.0-video")) {
    if (body.generation_type !== undefined) choice(body.generation_type, "generation_type", ["frame", "reference"]);
    if (refs.length > 2 && body.generation_type !== "reference") fail("超过两张图需明确使用 reference 模式。");
    if (body.generation_type !== undefined && !refs.length) fail("指定生成方式时需要参考图。");
  }
  if (model === "pixverse-v6") {
    const fusion = images(body, "img_references", 7);
    if (fusion.length && hasImage) fail("融合参考图与首尾帧不能混用。");
    if (frameKeys.length && (!body.first_frame_image || !body.last_frame_image || ![5, 8].includes(Number(body.duration)))) fail("转场需同时提供首尾帧，时长为 5 或 8 秒。");
    if (body.motion_mode !== undefined) choice(body.motion_mode, "motion_mode", ["normal"]);
  }
  return body;
}
