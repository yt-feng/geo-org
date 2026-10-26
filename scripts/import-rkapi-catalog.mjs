import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

// Input is a fresh, complete DOM capture of the signed-in model catalogue. This
// script never reads browser credentials or assumes the billing API is public.
const [detailsFile, statusFile, observedAt] = process.argv.slice(2);
if (!detailsFile || !statusFile || !observedAt) throw Error("Usage: node scripts/import-rkapi-catalog.mjs DETAILS_JSON PUBLIC_STATUS_JSON OBSERVED_AT_ISO");
const observed = Date.parse(observedAt);
if (!Number.isFinite(observed) || observed > Date.now() || Date.now() - observed > 60 * 60_000) throw Error("Capture must have a real observation time within the last hour.");
const details = JSON.parse(await readFile(resolve(detailsFile), "utf8"));
const status = JSON.parse(await readFile(resolve(statusFile), "utf8"));
const file = new URL("../lib/rkapi-catalog-snapshot.json", import.meta.url);
const old = JSON.parse(await readFile(file, "utf8"));
if (!Array.isArray(details) || !details.length || details.length > 1000 || details.some(row => !row || typeof row.model !== "string" || typeof row.detail !== "string") || new Set(details.map(row => row.model)).size !== details.length) throw Error("Expected one visible detail capture per unique catalogue model.");
if (!status.success || status.data?.quota_per_unit !== 500000 || !(status.data.price > 0) || !(status.data.usd_exchange_rate > 0)) throw Error("Public status currency fields are incomplete.");
const labels = { 输入: "input", 输出: "output", 缓存读取: "cached_input", 缓存输入: "cached_input", 缓存写入: "cache_write", 每次请求: "request" };
const groupRatios = {};
const models = details.map(row => {
  const parts = row.detail.split("基础价格\n");
  if (parts.length !== 2 || !row.detail.startsWith(row.model + "\n")) throw Error(`Unrecognized model detail: ${row.model}`);
  const ratesSection = parts[1].split("按分组定价")[0], base = ratesSection.split("动态计费")[0];
  const rates = Object.fromEntries([...base.matchAll(/(输入|输出|缓存读取|缓存输入|缓存写入|每次请求)\n\$([\d.]+)/g)].map(match => [labels[match[1]], match[2]]));
  if (!rates.request && (!rates.input || !rates.output) || Object.values(rates).some(rate => !/^\d+(?:\.\d+)?$/.test(rate))) throw Error(`Incomplete public rates: ${row.model}`);
  const metadata = row.detail.split("\n模型\n").at(-1);
  const groups = metadata.split("分组\n")[1]?.split("端点\n")[0].trim().split(/\r?\n/);
  if (!groups?.length || groups.some(group => !Object.hasOwn(old.groupRatios, group))) throw Error(`New group needs an explicit billing review: ${row.model}`);
  for (const group of groups) {
    const escaped = group.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const value = row.detail.match(new RegExp("(?:^|\\n)" + escaped + "\\n\\s*([\\d.]+)x"))?.[1];
    if (!value || Number(value) <= 0 || groupRatios[group] && groupRatios[group] !== value) throw Error(`Group multiplier missing or inconsistent: ${group}`);
    groupRatios[group] = value;
  }
  const tiers = [{ id: "standard", ratesCnyPerMillion: rates }];
  if (ratesSection.includes("long_context")) {
    const threshold = ratesSection.match(/(?:完整输入长度|输入) ≤ (\d+)K/)?.[1];
    const high = [...ratesSection.split("long_context")[1].split("条件乘数")[0].matchAll(/\$([\d.]+)/g)].map(match => match[1]);
    if (!threshold || high.length !== Object.keys(rates).length) throw Error(`Unrecognized context tiers: ${row.model}`);
    tiers[0].maxInputTokens = Number(threshold) * 1000;
    tiers.push({ id: "long_context", ratesCnyPerMillion: Object.fromEntries(Object.keys(rates).map((key, i) => [key, high[i]])) });
  } else if (ratesSection.includes("分档价格表") && !ratesSection.includes("按量计费")) throw Error(`Unrecognized dynamic pricing: ${row.model}`);
  const prior = old.models.find(model => model.id === row.model);
  // New rows are discoverable, but never inherit a paid request adapter merely
  // from a name prefix. An engineer must verify the advertised protocol first.
  const category = prior?.category || (row.detail.includes("image-generation") ? "image" : "text");
  return { id: row.model, name: row.model, manufacturer: prior?.manufacturer || "其他", category, kind: category === "image" ? "image" : "chat", groups, adapter: prior?.adapter || null, tiers };
});
const removed = old.models.filter(row => !models.some(model => model.id === row.id)).map(row => row.id);
if (removed.length) throw Error(`Catalogue contains ${removed.length} removals. Verify the full page capture and explicitly review removals before importing: ${removed.join(", ")}`);
const result = { observedAt: new Date(observed).toISOString(), expiresAt: new Date(observed + 7 * 86_400_000).toISOString(), source: old.source,
  referenceCnyPerQuota: String(status.data.price), referenceCnyPerUsd: String(status.data.usd_exchange_rate), groupRatios, models };
await writeFile(file, JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify({ models: models.length, added: models.filter(row => !old.models.some(model => model.id === row.id)).map(row => row.id), observedAt: result.observedAt, expiresAt: result.expiresAt }));
