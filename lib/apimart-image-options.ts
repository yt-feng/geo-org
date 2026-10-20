// Each entry has an official unified async generation + task contract.
// A price-table row alone must not enable a previously unknown image adapter.
export const IMAGE_GENERATION_SOURCES: Record<string, string> = {};
function group(ids: string[], page: string) { for (const id of ids) IMAGE_GENERATION_SOURCES[id] = page; }
group(["gemini-2.5-flash-image-preview"], "gemini-2.5-flash/generation");
group(["gemini-3.1-flash-image-preview"], "gemini-3.1-flash/generation");
group(["gemini-3.1-flash-lite-image-ext"], "gemini-3.1-flash/generation-lite");
group(["gemini-3-pro-image-preview"], "gemini-3-pro/generation");
group(["gemini-nano-banana-2.1-ext"], "gemini-nano-banana-2.1/generation");
group(["imagen-4.0-apimart"], "imagen-4.0-apimart/generation");
group(["gpt-image-2"], "gpt-image-2/generation");
group(["gpt-image-2.5-ext"], "gpt-image-2.5-ext/generation");
group(["seedream-4-0"], "seedream-4/generation");
group(["seedream-4-5"], "seedream-4.5/generation");
group(["seedream-5-0-lite"], "seedream-5-lite/generation");
group(["seedream-5-0-pro"], "seedream-5-0-pro/generation");
group(["seedream-5-0-flash"], "seedream-5-0-flash/generation");
group(["flux-kontext-pro", "flux-kontext-max"], "flux-kontext/generation");
group(["flux-2-pro", "flux-2-max", "flux-2-flex"], "flux-2/generation");
group(["flux-3-image"], "flux-3-image/generation");
group(["flux-3-image-klein"], "flux-3-image-klein/generation");
// Confirmed in https://docs.apimart.ai/cn/api-reference/images/hy-image-v3.5-preview/generation
group(["hy-image-v3.5-preview"], "hy-image-v3.5-preview/generation");
group(["qwen-image-2.0", "qwen-image-2.0-pro"], "qwen-image/generation");
group(["qwen-image-3.0", "qwen-image-3.0-pro"], "qwen-image-3.0/generation");
group(["z-image-turbo"], "z-image-turbo/generation");
group(["grok-imagine-1.5-apimart", "grok-imagine-image", "grok-imagine-image-quality"], "grok-imagine/generation");
group(["grok-imagine-2.0-ext"], "grok-imagine-2.0-ext/generation");
group(["grok-imagine-image-2.0"], "grok-imagine-2.0-ext/official");
group(["wan2.7-image", "wan2.7-image-pro"], "wan2.7-image/generation");
export const APIMART_IMAGE_MODELS = new Set(Object.keys(IMAGE_GENERATION_SOURCES));
