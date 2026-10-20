// Client-safe request options; contains no credentials or billing rates.
type Spec = {
  source: string; resolutions?: string[]; resolution?: string;
  duration: [number, number]; durations?: number[]; defaultDuration?: number;
  ratios?: string[]; ratioField?: "size" | "aspect_ratio"; ratio?: string;
  audio?: "audio" | "generate_audio"; audioDefault?: boolean; audioOnly?: true;
  images?: number; requiredImages?: boolean; frames?: "first" | "pair" | "end";
  lastAlone?: boolean; roles?: boolean; promptMax?: number; negativeMax?: number;
  booleans?: string[]; seed?: [number, number]; modes?: string[]; extra?: string[];
  noImageRatio?: boolean;
};
const landscape = ["16:9", "9:16"];
const square = [...landscape, "1:1"];
const five = [...square, "4:3", "3:4"];
const wide = [...five, "21:9"];
const uint32: [number, number] = [-1, 4294967295];
const seed32: [number, number] = [0, 2147483647];
export const VIDEO_SPECS: Record<string, Spec> = {};
const specs = VIDEO_SPECS;
function add(models: string[], spec: Spec) { for (const model of models) specs[model] = spec; }

// Each source is under https://docs.apimart.ai/en/api-reference/videos/.
// Only bounded generation is accepted. Editing, continuation, provider task IDs,
// external audio/video and paid tools need separate ownership and quote contracts.
add(["veo3.1-fast", "veo3.1-quality", "veo3.1-lite"], {
  source: "veo3/generation", resolutions: ["720p", "1080p", "4k"], resolution: "720p",
  duration: [8, 8], defaultDuration: 8, ratios: landscape, images: 3, extra: ["generation_type"],
});
add(["veo3.1-fast-official", "veo3.1-quality-official"], {
  source: "veo3/generation-official", resolutions: ["720p", "1080p", "4K"], resolution: "720p",
  duration: [4, 8], durations: [4, 6, 8], defaultDuration: 8, ratios: landscape,
  audio: "generate_audio", audioDefault: false, frames: "pair", negativeMax: 2000,
  seed: [0, 4294967295], booleans: ["enhance_prompt"], extra: ["sample_count", "person_generation", "resize_mode"],
});
add(["seedance-1-0-pro-fast", "seedance-1-0-pro-quality"], {
  source: "doubao/generation", resolutions: ["480p", "720p", "1080p"], resolution: "1080p",
  duration: [2, 12], ratios: wide, roles: true, seed: uint32,
});
add(["seedance-1-5-pro"], {
  source: "seedance-1-5-pro/generation", resolutions: ["480p", "720p", "1080p"], resolution: "720p",
  duration: [4, 12], ratios: wide, images: 2, roles: true, seed: uint32,
  audio: "audio", audioDefault: true, booleans: ["camerafixed"],
});
add(["seedance-2.0", "seedance-2.0-fast", "seedance-2.0-mini"], {
  source: "seedance-2-0/generation", resolutions: ["480p", "720p", "1080p", "4k"], resolution: "720p",
  duration: [4, 15], ratios: [...wide, "adaptive"], ratioField: "size",
  images: 9, roles: true, seed: seed32, audio: "generate_audio", audioDefault: true,
  promptMax: 4000, booleans: ["return_last_frame"],
});
add(["MiniMax-Hailuo-02"], {
  source: "minimax-hailuo/generation", resolutions: ["512p", "768p", "1080p"], resolution: "768p",
  duration: [5, 10], durations: [5, 10], frames: "pair",
  booleans: ["prompt_optimizer", "fast_pretreatment", "watermark"],
});
add(["MiniMax-Hailuo-2.3", "MiniMax-Hailuo-2.3-Fast"], {
  source: "minimax-hailuo-2.3/generation", resolutions: ["768p", "1080p"], resolution: "768p",
  duration: [6, 10], durations: [6, 10], defaultDuration: 6, frames: "first", promptMax: 2000,
  booleans: ["prompt_optimizer", "fast_pretreatment", "watermark"],
});
add(["MiniMax-H3"], {
  source: "minimax-h3/generation", resolutions: ["2K", "768P"], resolution: "2K",
  duration: [4, 15], ratios: [...wide, "adaptive"], images: 9, frames: "pair", lastAlone: true,
  promptMax: 7000, booleans: ["watermark"],
});
add(["MiniMax-H3-Max"], {
  source: "minimax-h3/max", resolutions: ["480P", "768P", "1080P"], resolution: "768P",
  duration: [5, 15], ratios: [...wide, "adaptive"], images: 9, frames: "pair", lastAlone: true,
  promptMax: 7000, booleans: ["watermark"],
});
add(["kling-v2-6", "kling-video-o1"], {
  source: "kling-v2-6/generation; kling-video-o1/generation", duration: [5, 10], durations: [5, 10],
  modes: ["std", "pro"], ratios: square, images: 2, promptMax: 2500,
});
// Kling O1 does not document an audio or watermark toggle.
specs["kling-v2-6"] = { ...specs["kling-v2-6"], audio: "audio", audioDefault: false, negativeMax: 2000, booleans: ["watermark"] };
add(["kling-v3", "kling-v3-omni"], {
  source: "kling-v3/generation; kling-v3-omni/generation", duration: [3, 15],
  modes: ["std", "pro", "4k"], ratios: square, images: 2,
  audio: "audio", audioDefault: false, negativeMax: 2500, booleans: ["watermark"],
});
add(["kling-3.0-turbo"], {
  source: "kling-3.0-turbo/generation", resolutions: ["720p", "1080p"], resolution: "720p",
  duration: [3, 15], ratios: square, frames: "first", promptMax: 3072, booleans: ["watermark"],
});
add(["wan2.5-preview"], {
  source: "wan2.5/generation", resolutions: ["480p", "720p", "1080p"], resolution: "720p",
  duration: [5, 10], durations: [5, 10], ratios: five, ratioField: "size", images: 1, noImageRatio: true,
  audio: "audio", audioDefault: true, audioOnly: true, negativeMax: 500,
  seed: seed32, booleans: ["prompt_extend", "watermark"],
});
add(["wan2.6"], {
  source: "wan2.6/generation", resolutions: ["720p", "1080p"], resolution: "720p",
  duration: [5, 15], durations: [5, 10, 15], ratios: five, images: 1, noImageRatio: true,
  // Explicitly choose silent output because this version does not state a default.
  audio: "audio", audioDefault: false, negativeMax: 500, seed: seed32,
  booleans: ["prompt_extend", "watermark"], extra: ["shot_type"],
});
add(["wan2.6-i2v-flash"], {
  source: "wan2.6/i2v-flash-generation", resolutions: ["720p", "1080p"], resolution: "1080p",
  duration: [2, 15], images: 1, requiredImages: true, audio: "audio", audioDefault: true,
  negativeMax: 500, seed: seed32, booleans: ["prompt_extend", "watermark"], extra: ["shot_type"],
});
add(["wan2.7"], {
  source: "wan2.7/generation", resolutions: ["720P", "1080P"], resolution: "1080P",
  duration: [2, 15], ratios: five, ratioField: "size", images: 2,
  promptMax: 5000, negativeMax: 500, seed: seed32, booleans: ["prompt_extend", "watermark"],
});
add(["wan3.0-video", "wan3.0-video-prime"], {
  source: "wan3.0-video/generation", resolutions: ["480P", "720P", "1080P"], resolution: "1080P",
  duration: [2, 30], ratios: [...five, "adaptive"], ratioField: "size", ratio: "adaptive",
  images: 10, audio: "audio", audioDefault: true, promptMax: 20000,
  seed: seed32, booleans: ["watermark"], extra: ["generation_type"],
});
add(["flux-3-video"], {
  source: "flux-3-video/generation", resolutions: ["hd", "fhd"], resolution: "hd",
  duration: [5, 20], ratios: [...wide, "2:1", "auto"], ratio: "auto", images: 10,
  audio: "audio", audioDefault: true,
});
add(["happyhorse-1.0", "happyhorse-1.1"], {
  source: "happyhorse-1.0/generation; happyhorse-1.1/generation",
  resolutions: ["720P", "1080P"], resolution: "1080P", duration: [3, 15],
  ratios: five, ratioField: "size", images: 9, frames: "first", promptMax: 2500,
  seed: seed32, booleans: ["watermark"],
});
add(["skyreels-v4-fast", "skyreels-v4-std"], {
  source: "skyreels-v4/generation", resolutions: ["480p", "720p", "1080p"], resolution: "1080p",
  duration: [3, 15], ratios: five, frames: "end", promptMax: 1280, booleans: ["prompt_optimizer"],
});
add(["viduq3-pro", "viduq3-turbo"], {
  source: "vidu-q3-pro/generation", resolutions: ["540p", "720p", "1080p"], resolution: "720p",
  duration: [1, 16], ratios: five, images: 2, noImageRatio: true,
  audio: "audio", audioDefault: true, promptMax: 2000, seed: uint32,
});
add(["viduq3", "viduq3-mix"], {
  source: "vidu-q3/generation", resolutions: ["540p", "720p", "1080p"], resolution: "720p",
  duration: [3, 16], ratios: five, images: 7, requiredImages: true, promptMax: 5000, seed: seed32,
});
specs["viduq3-mix"] = { ...specs["viduq3-mix"], duration: [1, 16], resolutions: ["720p", "1080p"] };
add(["viduq4-preview"], {
  source: "vidu-q4-preview/generation", resolutions: ["540p", "720p", "1080p", "2K", "4K"], resolution: "720p",
  duration: [3, 16], ratios: five, images: 15, requiredImages: true, frames: "first",
  audio: "audio", audioDefault: true, promptMax: 20000, seed: seed32,
});
add(["pixverse-v6"], {
  source: "pixverse-v6/generation", resolutions: ["360p", "540p", "720p", "1080p"], resolution: "540p",
  duration: [1, 15], ratios: [...wide, "2:3", "3:2"], ratioField: "size", images: 1, frames: "pair",
  audio: "audio", audioDefault: false, promptMax: 5000, negativeMax: 2048,
  seed: seed32, booleans: ["watermark"], extra: ["img_references", "motion_mode"],
});
add(["grok-imagine-video", "grok-imagine-video-1.5"], {
  source: "grok-imagine/official", resolutions: ["480p", "720p", "1080p"], resolution: "480p",
  duration: [1, 15], defaultDuration: 8, ratios: [...five, "2:3", "3:2", "auto"], ratio: "auto",
  images: 10, promptMax: 8000,
});
specs["grok-imagine-video"] = { ...specs["grok-imagine-video"], resolutions: ["480p", "720p"] };

// Gemini Omni has no duration field and only a typical, not guaranteed, 3–10s
// output range. Legacy -apimart/face/i2v IDs lack an explicit matching contract.
export const APIMART_VIDEO_MODELS = new Set(Object.keys(specs));
export const APIMART_VIDEO_SOURCES = Object.fromEntries(Object.entries(specs).map(([id, spec]) => [id, spec.source]));
export const VIDEO_DEFAULTS = Object.fromEntries(Object.entries(specs).map(([id, spec]) => [id, {
  duration: spec.defaultDuration ?? 5,
  durations: spec.durations || Array.from({ length: spec.duration[1] - spec.duration[0] + 1 }, (_, index) => spec.duration[0] + index),
  resolutions: spec.resolutions || [], modes: spec.modes || [],
  ...(spec.resolution ? { resolution: spec.resolution } : {}),
  ...(spec.modes ? { mode: "std" } : {}),
  referenceRequired: !!spec.requiredImages || id === "MiniMax-Hailuo-2.3-Fast",
  supportsRatio: !!spec.ratios, ratioField: spec.ratioField ?? "aspect_ratio",
  ratio: spec.ratio ?? "16:9", noImageRatio: !!spec.noImageRatio,
  audioField: spec.audio ?? null, audioDefault: spec.audioDefault ?? null,
  audioOnly: !!spec.audioOnly,
}]));
export const VIDEO_UNAVAILABLE_REASONS: Record<string, string> = {
  "gemini-omni-1.1-flash": "官方接口没有 duration 参数，典型 3–10 秒不是确定计费上限。",
  "gemini-omni-flash-preview": "官方接口没有 duration 参数，尚无可验证的计费时长上限。",
  "grok-imagine-1.5-video-apimart": "公开价格使用旧 -apimart ID，当前接口文档使用 -ext，缺少等价别名合同。",
  "seedance-2.0-face": "主生成参数文档未完整定义此 ID 的生成与分辨率合同。",
  "seedance-2.0-fast-face": "主生成参数文档未完整定义此 ID 的生成与分辨率合同。",
  "wan2.6-i2v": "当前独立图生视频文档以 -flash 为固定模型，未完整定义旧 ID 的合同。",
};
