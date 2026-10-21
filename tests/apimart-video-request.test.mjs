import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

class PricingError extends Error { constructor(message, status = 503) { super(message); this.status = status; } }
async function load(path, dependencies = {}) {
  const file = new URL(path, import.meta.url).pathname, mod = { exports: {} };
  const code = ts.transpileModule(await readFile(file, "utf8"), { fileName: file, compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText;
  vm.runInNewContext(code, { module: mod, exports: mod.exports, URL, TextEncoder,
    require(name) { assert.ok(name in dependencies, name); return dependencies[name]; } }, { filename: file });
  return mod;
}
const videoOptions = (await load("../lib/apimart-video-options.ts")).exports;
const mod = await load("../lib/apimart-video-request.ts", { "./pricing": { PricingError }, "./apimart-video-options": videoOptions });
const { normalizeVideoRequest: normalize, APIMART_VIDEO_MODELS: models, VIDEO_UNAVAILABLE_REASONS: unavailable } = mod.exports;
const image = "https://example.com/frame.jpg", other = "https://example.com/end.jpg";
const make = (model, extras = {}) => ({ model, prompt: "A cat walking in the park", ...extras });
const rejects = (model, extras) => assert.throws(() => normalize(make(model, extras)), error => error instanceof PricingError && error.status === 400);
const plain = value => JSON.parse(JSON.stringify(value));

test("every supported video model has a valid normalized request and normalization is idempotent", () => {
  assert.equal(models.size, 41);
  for (const model of models) {
    const needsImage = ["MiniMax-Hailuo-2.3-Fast", "wan2.6-i2v-flash", "wan2.7-r2v", "viduq3", "viduq3-mix", "viduq4-preview"].includes(model);
    const input = make(model, needsImage ? { image_urls: [image] } : {});
    const original = structuredClone(input), output = normalize(input);
    assert.deepEqual(input, original, "input unchanged: " + model);
    assert.deepEqual(plain(normalize(output)), plain(output), "idempotent: " + model);
    assert.ok(Number.isInteger(output.duration) && output.duration > 0, model);
    assert.ok(output.resolution || output.mode, model);
    rejects(model, { video_urls: ["https://example.com/source.mp4"] });
    rejects(model, { callback_url: "https://example.com/receiver" });
  }
});

test("unsupported legacy IDs and unbounded model-chosen durations are explicit", () => {
  for (const model of Object.keys(unavailable)) {
    assert.equal(models.has(model), false);
    rejects(model, {});
  }
  for (const model of ["seedance-2.5", "Omni-Flash-Ext", "wan2.7-videoedit", "kling-v3-motion-control"]) rejects(model, {});
});

test("Seedance field aliases normalize to actual provider keys with documented audio defaults", () => {
  const request = normalize(make("seedance-2.0", { aspect_ratio: "9:16", audio: false, duration: 15, resolution: "4K" }));
  assert.equal(request.size, "9:16"); assert.equal(request.generate_audio, false);
  assert.equal(request.resolution, "4k");
  assert.equal(request.aspect_ratio, undefined); assert.equal(request.audio, undefined);
  assert.equal(normalize(make("seedance-2.0")).generate_audio, true);
  assert.equal(normalize(make("seedance-1-5-pro")).audio, true);
  rejects("seedance-2.0", { audio: true, generate_audio: false });
  rejects("seedance-2.0", { aspect_ratio: "9:16", size: "16:9" });
  rejects("seedance-2.0-fast", { resolution: "1080p" });
  rejects("seedance-2.0-mini", { duration: 3 });
  rejects("seedance-2.0", { image_urls: Array(10).fill(image) });
  rejects("seedance-2.0", { tools: [{ type: "web_search" }] });
  const firstLast = normalize(make("seedance-1-0-pro-quality", { image_urls: [image, other] }));
  assert.deepEqual(plain(firstLast.image_with_roles), [{ url: image, role: "first_frame" }, { url: other, role: "last_frame" }]);
  assert.deepEqual(plain(normalize(firstLast)), plain(firstLast));
  rejects("seedance-1-0-pro-fast", { image_urls: [image, other] });
  rejects("seedance-1-5-pro", { image_urls: [image], image_with_roles: [{ url: image, role: "first_frame" }] });
});

test("VEO variants enforce sample counts, frame routing, lite and quality restrictions", () => {
  const official = normalize(make("veo3.1-fast-official", { image_urls: [image, other], audio: true, resolution: "4k", duration: 6 }));
  assert.equal(official.first_frame_image, image); assert.equal(official.last_frame_image, other);
  assert.equal(official.image_urls, undefined); assert.equal(official.generate_audio, true);
  assert.equal(official.sample_count, 1); assert.equal(official.resolution, "4K");
  assert.equal(normalize(make("veo3.1-quality-official")).generate_audio, false);
  rejects("veo3.1-fast-official", { sample_count: 2 });
  rejects("veo3.1-fast-official", { enhance_prompt: false });
  rejects("veo3.1-fast-official", { duration: 5 });
  rejects("veo3.1-fast", { duration: 6 });
  rejects("veo3.1-quality", { image_urls: [image, other, image] });
  rejects("veo3.1-quality", { image_urls: [image], generation_type: "reference" });
  rejects("veo3.1-fast", { image_urls: [image, other, image], generation_type: "frame" });
  rejects("veo3.1-lite", { image_urls: [image] });
  rejects("veo3.1-fast", { audio: false });
});

test("MiniMax duration/resolution combinations, required first frames, and explicit reference semantics", () => {
  assert.equal(normalize(make("MiniMax-Hailuo-02")).duration, 5);
  assert.equal(normalize(make("MiniMax-Hailuo-2.3")).duration, 6);
  rejects("MiniMax-Hailuo-02", { duration: 6 });
  rejects("MiniMax-Hailuo-02", { duration: 10, resolution: "1080p" });
  rejects("MiniMax-Hailuo-2.3", { duration: 10, resolution: "1080p" });
  rejects("MiniMax-Hailuo-2.3-Fast", {});
  assert.equal(normalize(make("MiniMax-Hailuo-2.3-Fast", { image_urls: [image] })).first_frame_image, image);
  const references = normalize(make("MiniMax-H3", { image_urls: [image, other] }));
  assert.deepEqual(plain(references.image_urls), [image, other]);
  assert.equal(references.first_frame_image, undefined, "H3 references cannot be silently converted to frames");
  rejects("MiniMax-H3", { image_urls: [image], first_frame_image: other });
  rejects("MiniMax-H3-Max", { resolution: "1080P", watermark: false });
  rejects("MiniMax-H3-Max", { duration: 4 });
  assert.equal(normalize(make("MiniMax-H3-Max", { last_frame_image: image })).last_frame_image, image);
});

test("Kling modes and audio/frame combinations prevent unsupported requests", () => {
  assert.equal(normalize(make("kling-v3")).audio, false);
  rejects("kling-v2-6", { audio: true, mode: "std" });
  rejects("kling-v2-6", { image_urls: [image, other], mode: "std" });
  rejects("kling-v2-6", { image_urls: [image, other], mode: "pro", audio: true });
  assert.equal(normalize(make("kling-v2-6", { image_urls: [image, other], mode: "pro" })).audio, false);
  rejects("kling-video-o1", { audio: true });
  rejects("kling-video-o1", { mode: "4k" });
  rejects("kling-v3", { resolution: "720p" });
  assert.equal(normalize(make("kling-3.0-turbo", { image_urls: [image] })).first_frame_image, image);
});

test("Wan generation uses explicit correct ratio/audio defaults and finite durations", () => {
  assert.equal(normalize(make("wan2.5-preview")).audio, true);
  rejects("wan2.5-preview", { audio: false });
  rejects("wan2.5-preview", { resolution: "480p", aspect_ratio: "4:3" });
  rejects("wan2.5-preview", { image_urls: [image], aspect_ratio: "16:9" });
  const imageOnly = normalize(make("wan2.5-preview", { image_urls: [image] }));
  assert.equal(imageOnly.size, undefined);
  assert.deepEqual(plain(normalize(imageOnly)), plain(imageOnly));
  rejects("wan2.6", { duration: 6 });
  rejects("wan2.6", { resolution: "480p" });
  assert.equal(normalize(make("wan2.6-i2v-flash", { image_urls: [image] })).audio, true);
  rejects("wan2.6-i2v-flash", { image_urls: [image], shot_type: "multi", prompt_extend: false });
  assert.equal(normalize(make("wan2.7")).resolution, "1080P");
  assert.equal(normalize(make("wan3.0-video")).audio, true);
  rejects("wan3.0-video", { duration: -1 });
  rejects("wan3.0-video", { image_urls: [image, image, image] });
  assert.equal(normalize(make("wan3.0-video", { image_urls: [image, image, image], generation_type: "reference" })).generation_type, "reference");
});

test("Wan 2.7 reference generation keeps reference roles distinct and bounds image-only requests", () => {
  const original = make("wan2.7-r2v", { image_urls: [image, other], duration: 15, resolution: "720p", aspect_ratio: "3:4" });
  const unchanged = structuredClone(original), output = normalize(original);
  assert.deepEqual(original, unchanged);
  assert.deepEqual(plain(output.image_with_roles), [{ url: image, role: "reference_image" }, { url: other, role: "reference_image" }]);
  assert.equal(output.image_urls, undefined); assert.equal(output.resolution, "720P"); assert.equal(output.size, "3:4");
  assert.deepEqual(plain(normalize(output)), plain(output));
  const frames = normalize(make("wan2.7-r2v", { image_with_roles: [{ url: image, role: "first_frame" }, { url: other }], duration: 2 }));
  assert.deepEqual(plain(frames.image_with_roles), [{ url: image, role: "first_frame" }, { url: other, role: "reference_image" }]);
  assert.equal(frames.resolution, "1080P");
  assert.equal(normalize(make("wan2.7-r2v", { image_urls: Array(5).fill(image) })).image_with_roles.length, 5);
  for (const extras of [
    {}, { image_urls: [] }, { image_urls: Array(6).fill(image) }, { image_with_roles: [] },
    { image_with_roles: Array(6).fill({ url: image }) },
    { image_with_roles: [{ url: image, role: "last_frame" }] },
    { image_with_roles: [{ url: image, role: "first_frame" }, { url: other, role: "first_frame" }] },
    { image_with_roles: [{ url: image, reference_voice: "https://example.com/voice.mp3" }] },
    { image_with_roles: [{ url: "data:image/png;base64,AA" }] },
    { image_urls: [image], image_with_roles: [{ url: other }] },
    ...[{ duration: 0 }, { duration: 16 }, { resolution: "4K" }, { size: "adaptive" },
      { video_urls: ["https://example.com/video.mp4"] }, { audio_urls: ["https://example.com/audio.mp3"] },
      { nsfw_check: true }, { first_frame_image: other }, { seed: -1 }, { prompt: "x".repeat(5001) },
      { negative_prompt: "x".repeat(501) }].map(extra => ({ image_urls: [image], ...extra })),
  ]) rejects("wan2.7-r2v", extras);
});

test("Vidu required references and model-specific duration/resolution rules are distinct", () => {
  rejects("viduq3", {});
  rejects("viduq3", { image_urls: [image], duration: 2 });
  rejects("viduq3-mix", { image_urls: [image], resolution: "540p" });
  assert.equal(normalize(make("viduq3-mix", { image_urls: [image], duration: 1 })).duration, 1);
  rejects("viduq3-pro", { image_urls: [image], aspect_ratio: "16:9" });
  const pro = normalize(make("viduq3-pro", { image_urls: [image] }));
  assert.equal(pro.aspect_ratio, undefined); assert.equal(pro.audio, true);
  rejects("viduq4-preview", {});
  rejects("viduq4-preview", { image_urls: [image], duration: 2 });
  assert.equal(normalize(make("viduq4-preview", { first_frame_image: image, resolution: "4k" })).resolution, "4K");
});

test("other generation families retain their actual image semantics and do not accept editing extras", () => {
  assert.equal(normalize(make("flux-3-video", { resolution: "1080p" })).resolution, "fhd");
  assert.equal(normalize(make("flux-3-video")).audio, true);
  rejects("flux-3-video", { draft: true });
  const happy = normalize(make("happyhorse-1.0", { image_urls: [image] }));
  assert.deepEqual(plain(happy.image_urls), [image]); assert.equal(happy.first_frame_image, undefined);
  rejects("happyhorse-1.1", { image_urls: [image], first_frame_image: image });
  const sky = normalize(make("skyreels-v4-fast", { image_urls: [image, other] }));
  assert.equal(sky.first_frame_image, image); assert.equal(sky.end_frame_image, other);
  rejects("skyreels-v4-fast", { audio: true });
  rejects("grok-imagine-video", { resolution: "1080p" });
  assert.equal(normalize(make("grok-imagine-video-1.5", { resolution: "1080p" })).resolution, "1080p");
  rejects("pixverse-v6", { first_frame_image: image });
  rejects("pixverse-v6", { first_frame_image: image, last_frame_image: other, duration: 6 });
  assert.equal(normalize(make("pixverse-v6", { first_frame_image: image, last_frame_image: other, duration: 8 })).duration, 8);
  rejects("pixverse-v6", { image_urls: [image, other] });
  rejects("pixverse-v6", { image_urls: [image], img_references: [other] });
});

test("invalid public media, scalar types and additional charging features fail before submission", () => {
  for (const value of ["http://example.com/a.jpg", "data:image/png;base64,AA", "https://user:secret@example.com/a", null, 12]) {
    rejects("seedance-2.0", { image_urls: [value] });
  }
  for (const extra of [{ image_urls: [] }, { duration: "5" }, { duration: 5.1 }, { audio: "true" }, { seed: -1 }, { resolution: null }, { n: 2 }, { nsfw_check: true }]) rejects("seedance-2.0", extra);
});
