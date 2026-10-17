export const AUDIT_PLAN_VERSION = "tokenhub-audit-v2";
export const AUDIT_SLOT_MS = 12 * 60 * 60 * 1000;
export const AUDIT_SLOTS = 14;
export const AUDIT_BUDGET_MICROS = 5_000_000;
export const AUDIT_CHAT_MODELS = ["glm-5-3-flash-260828", "glm-5-2-260617", "deepseek-v4-pro-ga-260813", "deepseek-v4-flash-ga-260731"] as const;
export const AUDIT_CHAT_POLICIES: Record<string, { inputMicros: number; outputMicros: number; cacheReadMicros: number; reservedMicros: number; maxOutputTokens: number }> = {
  "glm-5-3-flash-260828": { inputMicros: 200_000, outputMicros: 600_000, cacheReadMicros: 200_000, reservedMicros: 10_000, maxOutputTokens: 8192 },
  "glm-5-2-260617": { inputMicros: 1_500_000, outputMicros: 4_500_000, cacheReadMicros: 1_500_000, reservedMicros: 50_000, maxOutputTokens: 8192 },
  "deepseek-v4-pro-ga-260813": { inputMicros: 1_800_000, outputMicros: 3_600_000, cacheReadMicros: 1_800_000, reservedMicros: 40_000, maxOutputTokens: 8192 },
  "deepseek-v4-flash-ga-260731": { inputMicros: 200_000, outputMicros: 400_000, cacheReadMicros: 200_000, reservedMicros: 10_000, maxOutputTokens: 8192 },
};
export type AuditKind = "chat" | "image" | "video";
export type AuditCase = { id: string; kind: AuditKind; model: string; reservedMicros: number; body: Record<string, unknown>; expected: Record<string, unknown> };

// Deterministic per campaign/slot; short/long variants have exactly the same task and answer.
function random(seed: string) {
  let state = 2166136261;
  for (const char of seed) state = Math.imul(state ^ char.charCodeAt(0), 16777619) >>> 0;
  return () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return state >>> 0; };
}
function task(campaign: string, slot: number) {
  const next = random(slot % 2 === 0 ? `${campaign}/anchor` : `${campaign}/fresh/${slot}`);
  const nonceNext = random(`${campaign}/nonce/${slot}`), nonce = `${nonceNext().toString(16)}-${nonceNext().toString(16)}`;
  const initial = next() % 97, operations = Array.from({ length: 12 }, () => [next() % 9 + 2, next() % 83]);
  let trace = initial;
  for (const [a, b] of operations) trace = (trace * a + b) % 997;
  const capacity = 20;
  const items = Array.from({ length: 10 }, () => [next() % 9 + 1, next() % 25 + 1]);
  const scores = new Array<number>(capacity + 1).fill(0);
  for (const [weight, value] of items) for (let c = capacity; c >= weight; c--) scores[c] = Math.max(scores[c], scores[c - weight] + value);
  const nodeCount = 7, edges: number[][] = [];
  for (let from = 0; from < nodeCount - 1; from++) for (let to = from + 1; to < Math.min(nodeCount, from + 4); to++) edges.push([from, to, next() % 20 + 1]);
  const distances = new Array<number>(nodeCount).fill(Infinity); distances[0] = 0;
  for (const [from, to, weight] of edges) distances[to] = Math.min(distances[to], distances[from] + weight);
  const rows = Array.from({ length: 10 }, (_, i) => ({ key: `r${i}-${next().toString(16)}`, value: next() % 100000 }));
  const chosen = rows[next() % rows.length];
  const prompt = `Solve four independent tasks. Return ONLY JSON {"answers":[A,B,C,D],"nonce":"${nonce}"} using integer answers.\nA: Start x=${initial}. For each [a,b] in order set x=(x*a+b)%997. Pairs=${JSON.stringify(operations)}. A is final x.\nB: 0/1 knapsack capacity=${capacity}, items [weight,value]=${JSON.stringify(items)}; each item at most once. B is maximum value within capacity.\nC: Directed graph nodes 0..${nodeCount - 1}, edges [from,to,weight]=${JSON.stringify(edges)}. C is shortest distance from 0 to ${nodeCount - 1}.\nD: Records=${JSON.stringify(rows)}. D is value of key ${chosen.key}.`;
  const filler = Array.from({ length: 25 }, (_, i) => `Ignored reference ${i}: ${nonceNext().toString(16)} ${nonceNext().toString(16)} ${nonceNext().toString(16)}.`).join("\n");
  return { short: prompt, long: `The reference block is irrelevant; do not change the task.\n<reference>\n${filler}\n</reference>\n${prompt}`, expected: { answers: [trace, scores[capacity], distances[nodeCount - 1], chosen.value], nonce, suite: slot % 2 === 0 ? "anchor" : "fresh", difficultyVersion: "trace12-knapsack10-cap20-dag7-records10-v1" } };
}
export function auditCases(campaign: string, slot: number): AuditCase[] {
  if (!Number.isInteger(slot) || slot < 0 || slot >= AUDIT_SLOTS) return [];
  const fixture = task(campaign, slot), cases: AuditCase[] = [];
  for (const model of AUDIT_CHAT_MODELS) for (const variant of ["short", "long"] as const) {
    const messages = [{ role: "user", content: fixture[variant] }], policy = AUDIT_CHAT_POLICIES[model];
    if (new TextEncoder().encode(JSON.stringify(messages)).length > 4096) throw new Error("Audit prompt exceeds the reserved input bound");
    cases.push({ id: `${model}:${variant}`, kind: "chat", model, reservedMicros: policy.reservedMicros,
      body: { model, messages, max_tokens: policy.maxOutputTokens, stream: false, temperature: 0, routing_options: { fallback_enabled: false, cache_enabled: false } }, expected: { ...fixture.expected, protocolVersion: AUDIT_PLAN_VERSION } });
  }
  if (slot === 0 || slot === 13) {
    const image = "dola-seedream-5-0-pro-260628", video = "dreamina-seedance-2-0-260128";
    cases.push({ id: "seedream-image", kind: "image", model: image, reservedMicros: 120_000,
      body: { model: image, prompt: "A red wooden cube to the left of a blue ceramic sphere on a white table, soft studio lighting, exactly two objects, no text.", size: "2K", response_format: "url", watermark: false }, expected: { protocolVersion: AUDIT_PLAN_VERSION, manualReview: "Two objects: red cube left, blue sphere right; verify delivered dimensions and image metadata." } });
    cases.push({ id: "seedance-video", kind: "video", model: video, reservedMicros: 600_000,
      body: { model: video, content: [{ type: "text", text: "A red wooden cube sits on the left and a blue ceramic sphere rolls slowly to the right on a white table. One continuous static camera shot, exactly two objects, no text." }], duration: 4, resolution: "480p", ratio: "16:9", generate_audio: false, watermark: false, return_last_frame: true }, expected: { protocolVersion: AUDIT_PLAN_VERSION, manualReview: "Verify 4 seconds, 480p, 16:9, no audio and continuous motion using delivered media, not response claims." } });
  }
  return cases;
}
export function gradeAuditAnswer(content: unknown, expected: Record<string, unknown>, finishReason: unknown) {
  if (finishReason === "length") return { status: "truncated", passed: null, correct: 0, total: 0, score: null, reason: "Output limit reached; excluded from capability score." };
  if (typeof content !== "string" || !content.trim()) return { status: "empty", passed: false, correct: 0, total: 0, score: null };
  let parsed: unknown;
  try { parsed = JSON.parse(content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")); } catch { return { status: "invalid_json", passed: false, correct: 0, total: 4, score: 0 }; }
  const actual = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  const answers = Array.isArray(actual.answers) ? actual.answers : [];
  const wanted = Array.isArray(expected.answers) ? expected.answers : [];
  const checks = wanted.map((value, index) => answers[index] === value);
  const correct = checks.filter(Boolean).length, total = wanted.length, nonceMatches = actual.nonce === expected.nonce;
  if (!nonceMatches) return { status: "stale_or_mismatched_nonce", passed: null, correct: 0, total: 0, score: null, subitems: checks, nonceMatches: false, reason: "Response freshness is unverified; excluded from capability score." };
  return { status: correct === total ? "passed" : "incorrect", passed: correct === total, correct, total, score: total ? correct / total * 100 : null, subitems: checks, nonceMatches };
}
