import { PricingError } from "./pricing";

type Json = Record<string, unknown>;
const versions = ["5.1", "5.2", "6.1", "7", "8.1", "8.2"];
function fail(message: string): never { throw new PricingError(message, 400); }
function text(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length <= maximum && !!value.trim();
}

/**
 * Official /images/midjourney/imagine contract: action + version + speed.
 * Native prompt flags, permutations, repeats and follow-up actions are excluded,
 * so a quoted request can only create one new Imagine task.
 */
export function normalizeMidjourneyRequest(input: Json): Json {
  if (input.model !== "midjourney") fail("此请求需要选择 Midjourney。");
  const allowed = ["model", "prompt", "n", "size", "version", "speed", "niji", "image_urls",
    "seed", "stylize", "chaos", "weird", "tile", "raw", "negative_prompt"];
  if (Object.keys(input).some(key => !allowed.includes(key))) fail("此图片操作或参数尚未开放。");
  if (!text(input.prompt, 10000) || /--|[{}]/.test(input.prompt)) fail("请使用普通提示词，通过 JSON 字段选择参数；暂不支持原生参数或批量组合。");
  if (input.n !== undefined && input.n !== 1) fail("每次请求仅支持一个生成任务。");
  const body: Json = { ...input, version: input.version ?? "7", speed: input.speed ?? "relax", size: input.size ?? "1:1" };
  delete body.n;
  for (const field of ["niji", "tile", "raw"]) if (body[field] !== undefined && typeof body[field] !== "boolean") fail(`${field} 应为布尔值。`);
  if (!(body.niji ? ["6", "7"] : versions).includes(String(body.version)) || typeof body.version !== "string") fail("请选择支持的图片版本。");
  if (typeof body.speed !== "string" || !["relax", "fast", "turbo"].includes(body.speed)) fail("请选择 relax、fast 或 turbo 速度。");
  if (typeof body.size !== "string" || !["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "21:9"].includes(body.size)) fail("请选择支持的图片比例。");
  for (const [field, maximum] of [["seed", 4294967295], ["stylize", 1000], ["chaos", 100], ["weird", 3000]] as const) {
    if (body[field] !== undefined && (!Number.isSafeInteger(body[field]) || Number(body[field]) < 0 || Number(body[field]) > maximum)) fail(`${field} 应为 0–${maximum} 的整数。`);
  }
  if (body.negative_prompt !== undefined && (!text(body.negative_prompt, 2000) || /--|[{}]/.test(body.negative_prompt))) fail("负面提示词无效，不能包含原生参数或批量组合。");
  if (body.image_urls !== undefined) {
    if (!Array.isArray(body.image_urls) || !body.image_urls.length || body.image_urls.length > 4) fail("当前支持 1–4 张参考图片。");
    for (const value of body.image_urls) {
      if (!text(value, 2048) || /\s|--|[{}]/.test(value)) fail("参考图片须为公开 HTTPS URL，不能包含原生参数或批量组合。");
      try {
        if (/\s|--|[{}]/.test(decodeURIComponent(value))) fail("参考图片不能包含原生参数或批量组合。");
        const url = new URL(value);
        if (url.protocol !== "https:" || url.username || url.password) fail("参考图片须为公开 HTTPS URL。");
      } catch { fail("参考图片须为公开 HTTPS URL。"); }
    }
  }
  return body;
}

export function midjourneyPriceDimension(input: Json): string {
  const body = normalizeMidjourneyRequest(input);
  return `imagine-${body.niji ? "niji" : "v"}${body.version}${body.speed === "relax" ? "" : `-${body.speed}`}`;
}
