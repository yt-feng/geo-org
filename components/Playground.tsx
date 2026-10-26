"use client";

import { useSiteLocale } from "./LocaleProvider";
import { formatCreditsWithUsd } from "@/lib/credits";
import { PlaygroundBillingSummary } from "./PlaygroundBillingSummary";

import { englishPriceText } from "@/lib/price-copy";

import { VIDEO_DEFAULTS } from "@/lib/apimart-video-options";
import { displayServiceText } from "@/lib/brand-display";
import { modelRequestKind } from "@/lib/model-request-kind";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Icon } from "./Icon";
import { modelCatalog, modelCategories, providerInitials, type ModelCategory, type CatalogModel } from "@/lib/model-catalog";

const endpoints: Record<ModelCategory, string> = { image: "/v1/images/generations", video: "/v1/videos/generations", text: "/v1/chat/completions", audio: "/v1/music/generations" };
const prompts: Record<ModelCategory, string> = { image: "描述你想创建的画面、风格、光线和构图...", video: "描述场景、主体动作与镜头运动...", text: "输入消息，构建你的对话请求...", audio: "描述音乐的氛围、乐器与节奏..." };
const examples: Record<ModelCategory, string[]> = { image: ["清晨薄雾中的山间小屋，柔和自然光，电影摄影质感。", "极简风格产品摄影，银色耳机置于浅灰色石材上，细腻阴影。", "蓝白配色的未来城市，等距视角，干净的几何线条。"], video: ["航拍镜头缓缓掠过海岸线，晨光照亮波浪，电影感。", "镜头向前推进，穿过一座安静花园，树叶在微风中摇动。"], text: ["请将以下想法整理成清晰的产品介绍：一个统一管理多种 API 的开发者平台。", "帮我写一个 Python 示例，读取 JSON 文件并汇总每种类别的数量。"], audio: ["轻柔的 lo-fi 钢琴，雨声背景，适合深夜专注工作的氛围。", "温暖明亮的原声吉他旋律，轻快的节奏，没有人声。"] };

function shellQuote(value: string) { return `'${value.replaceAll("'", "'\\''")}'`; }
type PlaygroundStatus = { authenticated: boolean; serviceEnabled?: boolean; configured?: boolean; accountActive?: boolean; balanceMicrousd?: number; code: string };
async function getPlaygroundStatus(signal?: AbortSignal): Promise<PlaygroundStatus> {
  const response = await fetch("/api/playground/status?service=gateway", { cache: "no-store", signal });
  const data = await response.json();
  if (response.status === 401) return { authenticated: false, code: "login_required" };
  if (!response.ok || data.authenticated !== true || typeof data.serviceEnabled !== "boolean" || typeof data.configured !== "boolean" || typeof data.accountActive !== "boolean" || !Number.isSafeInteger(data.balanceMicrousd) || data.balanceMicrousd < 0) throw Error("status_unavailable");
  return data;
}

export function Playground({ initialModel, initialCategory, isAdmin }: { initialModel?: string; initialCategory?: string; isAdmin: boolean }) {
  const { t, isEnglish, href, locale } = useSiteLocale();
  const samples = isEnglish ? { image: ["A mountain cabin in morning mist, soft natural light, cinematic photography.", "Minimal product photography: silver headphones on pale grey stone with delicate shadows.", "A blue-and-white futuristic city, isometric perspective, clean geometric lines."], video: ["An aerial camera slowly follows the coast, morning light illuminating the waves.", "The camera moves through a quiet garden, leaves swaying in a gentle breeze."], text: ["Write a clear product introduction for a platform that manages multiple APIs.", "Write a Python example that reads a JSON file and counts items in each category."], audio: ["Soft lo-fi piano with rain ambience for late-night focus.", "Warm acoustic guitar, a light rhythm, no vocals."] } : examples;
  const promptPlaceholder = isEnglish ? { image: "Describe the scene, style, lighting and composition…", video: "Describe the scene, action and camera movement…", text: "Enter a message to build your chat request…", audio: "Describe the mood, instruments and rhythm…" } : prompts;
  const categoryLabel = (value: ModelCategory) => isEnglish ? ({ image: "Image", video: "Video", text: "Text", audio: "Audio" })[value] : modelCategories.find(item => item.id === value)?.label;
  const messageCopy = (value: string) => {
    if (!isEnglish) return displayServiceText(value);
    if (/余额不足/.test(value)) return "Insufficient wallet balance. Top up before requesting again.";
    if (/JSON 必须/.test(value)) return "JSON must be an object and model must match the selected model.";
    if (/报价|价格/.test(value)) return "Pricing is unavailable or incomplete. Refresh the quote before submitting.";
    if (/连接中断|网络/.test(value)) return "Connection interrupted. Keep the same parameters and check the original request.";
    return /[\u4e00-\u9fff]/.test(value) ? "The request could not be completed. Check the request or task result before retrying." : displayServiceText(value);
  };
  const firstCategory = modelCategories.some(item => item.id === initialCategory) ? initialCategory as ModelCategory : modelCatalog.find(item => item.id === initialModel)?.category || "image";
  const [category, setCategory] = useState<ModelCategory>(firstCategory);
  const [model, setModel] = useState(initialModel || modelCatalog.find(item => item.category === firstCategory)?.id || "gpt-image-2");
  const [directory, setDirectory] = useState<CatalogModel[]>(modelCatalog);
  const [duration, setDuration] = useState(8);
  const [videoResolution, setVideoResolution] = useState("720p");
  const [videoMode, setVideoMode] = useState("std");
  const [quality, setQuality] = useState("medium");
  const [version, setVersion] = useState("flare");
  const [musicVersion, setMusicVersion] = useState("v6");
  const [advanced, setAdvanced] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [resolution, setResolution] = useState("2k");
  const [ratio, setRatio] = useState("1:1");
  const [reference, setReference] = useState("");
  const [instrumental, setInstrumental] = useState(false);
  const [format, setFormat] = useState<"json" | "curl">("json");
  const [showPreview, setShowPreview] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const [promptExample, setPromptExample] = useState(0);
  const [prices, setPrices] = useState<Array<{ provider: string; model: string; kind: string; billingReady?: boolean; rates: Array<{ dimension: string; label?: string; unit: string; retailMicrousd: number }> }>>([]);
  const [priceError, setPriceError] = useState("");
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<"quote" | "generate" | "query" | null>(null);
  const [serviceStatus, setServiceStatus] = useState<PlaygroundStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [statusError, setStatusError] = useState(false);
  const [quote, setQuote] = useState<{ signature: string; reservedMicrousd: number; observedAt: string } | null>(null);
  const [requestError, setRequestError] = useState("");
  const [pendingId, setPendingId] = useState("");
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [tasks, setTasks] = useState<Array<{ id: string; model: string; status: string }>>([]);
  const polls = useRef<Record<string, number>>({});
  const pendingRequest = useRef<{ signature: string; id: string; model: string; taskId?: string } | null>(null);
  const clearPendingRequest = () => { pendingRequest.current = null; setPendingId(""); };
  const inFlight = useRef(false);
  const automaticSelection = useRef({ allowed: !initialModel, category: firstCategory });
  const resultRef = useRef<HTMLDivElement | null>(null);
  const statusRequest = useRef(0);
  const scrollToResult = () => setTimeout(() => resultRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" }), 0);
  async function refreshStatus() {
    const request = ++statusRequest.current;
    setStatusLoading(true); setStatusError(false);
    try { const status = await getPlaygroundStatus(); if (statusRequest.current === request) setServiceStatus(status); }
    catch { if (statusRequest.current === request) { setServiceStatus(null); setStatusError(true); } }
    finally { if (statusRequest.current === request) setStatusLoading(false); }
  }
  useEffect(() => {
    const controller = new AbortController();
    const request = ++statusRequest.current;
    getPlaygroundStatus(controller.signal).then(status => { if (!controller.signal.aborted && statusRequest.current === request) setServiceStatus(status); })
      .catch(() => { if (!controller.signal.aborted && statusRequest.current === request) setStatusError(true); })
      .finally(() => { if (!controller.signal.aborted && statusRequest.current === request) setStatusLoading(false); });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    let active = true;
    let loadedDirectory = modelCatalog;
    let loadedPrices: Array<{ model: string; kind: string; billingReady?: boolean }> = [];
    const selectReadyDefault = () => {
      if (!active || !automaticSelection.current.allowed) return;
      const category = automaticSelection.current.category;
      const ready = loadedDirectory.find(item => item.category === category && loadedPrices.some(price => price.model === item.id && price.billingReady === true && price.kind === (category === "text" ? "chat" : category)));
      if (ready) setModel(ready.id);
    };
    fetch("/api/pricing", { cache: "no-store" }).then(response => response.json()).then(data => {
      if (!active) return;
      const found = Array.isArray(data.models) ? data.models.filter((item: { provider: string }) => item.provider === "apimart") : [];
      setPrices(found); if (!found.length) setPriceError("实时价格暂不可用，请稍后刷新。");
      loadedPrices = found; selectReadyDefault();
    }).catch(() => { if (active) setPriceError("实时价格暂不可用，请稍后刷新。"); });
    fetch("/api/model-catalog", { cache: "no-store" }).then(response => response.json()).then(data => {
      if (active && Array.isArray(data.models)) {
        loadedDirectory = data.models.filter((item: CatalogModel) => item.upstream === "apimart");
        setDirectory(loadedDirectory); selectReadyDefault();
      }
    }).catch(() => undefined);
    fetch("/api/gateway/v1/tasks", { cache: "no-store" }).then(response => response.json()).then(data => { if (active && Array.isArray(data.data)) setTasks(data.data); }).catch(() => undefined);
    return () => { active = false; };
  }, []);
  useEffect(() => {
    const task = tasks.find(item => ["submitted", "pending", "processing"].includes(item.status) && (polls.current[item.id] || 0) < 120);
    if (!task || busy) return;
    let active = true;
    const timer = setTimeout(async () => {
      polls.current[task.id] = (polls.current[task.id] || 0) + 1;
      try {
        const response = await fetch(`/api/gateway/v1/tasks/${encodeURIComponent(task.id)}`, { cache: "no-store" });
        const data = await response.json();
        if (!active) return;
        const taskResult = data.data && typeof data.data === "object" && !Array.isArray(data.data) ? data.data : data;
        if (response.ok && typeof taskResult.status === "string") {
          setTasks(current => current.map(item => item.id === task.id ? { ...item, status: taskResult.status } : item));
          if (["completed", "failed", "cancelled"].includes(taskResult.status)) {
            setResult(data); setShowPreview(true);
            if (pendingRequest.current?.taskId === task.id && ["settled", "refunded"].includes(data.tokvilo_billing?.status)) { clearPendingRequest(); setQuote(null); }
            void refreshStatus();
          }
        } else setTasks(current => [...current]);
      } catch { if (active) setTasks(current => [...current]); }
    }, 5000);
    return () => { active = false; clearTimeout(timer); };
  }, [tasks, busy]);
  const selectedPrice = prices.find(item => item.model === model);
  const requestKind = modelRequestKind(model, category);
  const supportedCapability = requestKind === (category === "text" ? "chat" : category === "audio" ? "music" : category);
  const executable = supportedCapability && selectedPrice?.billingReady === true && selectedPrice.kind === (category === "text" ? "chat" : category);
  const selected = directory.find(item => item.id === model);
  const detailedImage = category === "image";
  const imageDimensions = selectedPrice?.rates.filter(rate => rate.unit === "image" && !rate.dimension.startsWith("input:")).map(rate => rate.dimension.toLowerCase()) || [];
  const imageResolutions = model === "gemini-3-pro-image-preview" ? ["1k", "2k", "4k"] : [...new Set(imageDimensions.map(value => value.includes("@") ? value.startsWith("flare@") || value.startsWith("sunburst@") ? value.split("@")[1] : value.split("@")[0] : value).filter(value => /^(?:(?:0\.5|1|1\.5|2|4)k|[1-4]mp|768sq)$/.test(value)))];
  const chosenResolution = imageResolutions.includes(resolution) ? resolution : imageResolutions[0];
  const versionedImage = imageDimensions.some(value => /^(flare|sunburst)@/.test(value));
  const qualityImage = imageDimensions.some(value => /@(low|medium|high)$/.test(value));
  const imageQualities = [...new Set(imageDimensions.filter(value => /@(low|medium|high)$/.test(value)).map(value => value.split("@")[1]))];
  const chosenQuality = imageQualities.includes(quality) ? quality : imageQualities[0];
  const videoOptions = VIDEO_DEFAULTS[model];
  const klingMode = !!videoOptions?.mode;
  const chosenVideoResolution = videoOptions?.resolutions.find(value => value.toLowerCase() === videoResolution.toLowerCase()) || videoOptions?.resolution || videoResolution;
  const videoDurations = model.startsWith("MiniMax-Hailuo-") && chosenVideoResolution === "1080p" ? [model === "MiniMax-Hailuo-02" ? 5 : 6] : videoOptions?.durations || [8];
  const chosenDuration = videoDurations.includes(duration) ? duration : videoDurations.includes(videoOptions?.duration) ? videoOptions.duration : videoDurations[0];
  const chosenVideoMode = videoOptions?.modes.includes(videoMode) ? videoMode : videoOptions?.mode;
  const needsReference = category === "video" && videoOptions?.referenceRequired && !reference.trim() && advanced === null;
  const displayedRates = selectedPrice?.rates.filter(rate => model === "midjourney" ? rate.dimension === "imagine-v7" : category !== "audio" || rate.dimension === (model === "suno" ? `music-${musicVersion}` : "generate")).slice(0, 8) || [];
  const basePayload = category === "text" ? { model, messages: [{ role: "user", content: prompt }], stream: false, max_tokens: 1024 }
    : category === "audio" ? model === "flowmusic" ? { model, sound_prompt: prompt } : { model, custom: false, version: musicVersion, prompt, instrumental }
    : category === "video" ? { model, prompt, duration: chosenDuration, ...(klingMode ? { mode: chosenVideoMode } : { resolution: chosenVideoResolution }), ...(reference.trim() ? videoOptions?.referenceRole ? { image_with_roles: [{ url: reference.trim(), role: videoOptions.referenceRole }] } : { image_urls: [reference.trim()] } : {}) }
    : { model, prompt, n: 1, size: ratio, ...(chosenResolution ? { resolution: chosenResolution } : {}), ...(versionedImage ? { version } : {}), ...(qualityImage ? { quality: chosenQuality } : {}), ...(reference.trim() ? { image_urls: [reference.trim()] } : {}) };
  let payload: Record<string, unknown> = basePayload, payloadError = "";
  if (advanced !== null) {
    try {
      const parsed = JSON.parse(advanced);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || parsed.model !== model) throw new Error();
      payload = parsed;
    } catch { payloadError = "JSON 必须为对象，model 需与所选模型一致。"; }
  }
  const json = JSON.stringify(payload, null, 2);
  const signature = endpoints[category] + "\n" + json;
  const currentQuote = quote?.signature === signature ? quote : null;
  const serviceReady = serviceStatus?.authenticated === true && serviceStatus.accountActive === true && serviceStatus.serviceEnabled === true && serviceStatus.configured === true && !statusLoading && !statusError;
  const insufficientBalance = !!currentQuote && serviceStatus?.authenticated === true && typeof serviceStatus.balanceMicrousd === "number" && serviceStatus.balanceMicrousd < currentQuote.reservedMicrousd;
  const canGenerate = serviceReady && !insufficientBalance;
  const capabilityNotice = !supportedCapability ? t("此模型需要专用接口，工作台暂未支持该能力。可以查看文档或选择其他模型。", "This model requires a dedicated endpoint that is not available in this playground yet. Check its documentation or choose another model.") : "";
  const statusNotice = statusLoading ? t("正在检查账户与服务状态…", "Checking account and service status…")
    : statusError ? t("账户与服务状态暂时无法确认，请重试检查。", "Account and service status could not be checked. Retry the check.")
    : serviceStatus?.code === "login_required" ? t("登录已失效，请重新登录后生成。", "Your session has expired. Sign in again to generate.")
    : serviceStatus?.accountActive === false ? t("当前账户暂不可用，请联系支持。", "This account is unavailable. Contact support.")
    : serviceStatus?.serviceEnabled === false ? t("生成服务暂时关闭，可以先查看价格。", "Generation is temporarily disabled. You can still check the price.")
    : serviceStatus?.configured === false ? t("生成服务尚未就绪，可以先查看价格。", "The generation service is not ready. You can still check the price.")
    : insufficientBalance ? t("钱包余额不足以支付本次预留金额。充值后刷新余额，再确认生成。", "Your wallet balance is below this reservation. Top up, refresh your balance, then confirm generation.")
    : serviceStatus?.balanceMicrousd === 0 ? t("当前可用余额为 0 积分 ($0)。可以先查看价格，充值后即可确认生成。", "Your available balance is 0 credits ($0). Check the price first, then top up to confirm generation.") : "";
  const curl = `curl --request POST \\\n  --url 'https://tokvilo.com/api/gateway${endpoints[category]}' \\\n  --header 'Authorization: Bearer YOUR_TOKVILO_API_KEY' \\\n  --header 'Idempotency-Key: YOUR_UNIQUE_REQUEST_ID' \\\n  --header 'Content-Type: application/json' \\\n  --data ${shellQuote(json)}`;
  function changeCategory(value: ModelCategory) { automaticSelection.current.allowed = false; setCategory(value); setModel(directory.find(item => item.category === value && prices.some(price => price.model === item.id && price.billingReady))?.id || directory.find(item => item.category === value)?.id || ""); setAdvanced(null); setShowPreview(false); setCopied(false); setPromptExample(0); }
  async function copy() { try { await navigator.clipboard.writeText(format === "json" ? json : curl); setCopied(true); setCopyError(false); setTimeout(() => setCopied(false), 1800); } catch { setCopyError(true); } }

  async function refreshTask(id: string) {
    setBusy(true); setPhase("query"); setRequestError("");
    try {
      const response = await fetch(`/api/gateway/v1/tasks/${encodeURIComponent(id)}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message || "任务查询失败，请稍后刷新。");
      setResult(data); setShowPreview(true); scrollToResult();
      const status = data.data?.status || data.status;
      if (typeof status === "string") setTasks(current => current.map(task => task.id === id ? { ...task, status } : task));
    } catch (cause) { setRequestError(cause instanceof Error ? cause.message : "任务查询失败。"); }
    finally { setBusy(false); setPhase(null); }
  }
  async function prepareQuote() {
    if (inFlight.current || payloadError || !executable) return;
    inFlight.current = true;
    setBusy(true); setPhase("quote"); setRequestError(""); setQuote(null);
    const statusRefresh = refreshStatus();
    try {
      const response = await fetch("/api/pricing/quote", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: "apimart", mode: category === "text" ? "chat" : category, body: payload }) });
      const data = await response.json();
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : data.error?.message || "报价暂不可用，请稍后重试。");
      if (data.provider !== "apimart" || data.model !== model || data.currency !== "USD" || !Number.isSafeInteger(data.reservedMicrousd) || data.reservedMicrousd < 1 || data.reservedMicrousd > 1_000_000_000_000) throw new Error("报价内容不完整，请重新获取。");
      setQuote({ signature, reservedMicrousd: data.reservedMicrousd, observedAt: typeof data.observedAt === "string" ? data.observedAt : "" });
    } catch (cause) { setRequestError(cause instanceof Error ? cause.message : "报价暂不可用，请稍后重试。"); }
    finally { await statusRefresh; setBusy(false); setPhase(null); inFlight.current = false; }
  }
  async function run() {
    if (inFlight.current || pendingRequest.current || !currentQuote || !canGenerate || !executable) return;
    inFlight.current = true;
    setBusy(true); setPhase("generate"); setRequestError(""); setResult(null); setShowPreview(true);
    pendingRequest.current = { signature, id: crypto.randomUUID(), model };
    setPendingId(pendingRequest.current.id);
    try {
      const response = await fetch(`/api/gateway${endpoints[category]}`, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": pendingRequest.current.id, "X-Tokvilo-Max-Reserve-Microusd": String(currentQuote.reservedMicrousd) }, body: json });
      const data = await response.json();
      if (!response.ok) {
        const serviceBalanceUnavailable = data.error?.code === "service_balance_unavailable";
        const confirmedRefund = serviceBalanceUnavailable && data.tokvilo_billing?.status === "refunded" && data.tokvilo_billing.chargedMicrousd === 0;
        if (confirmedRefund) { clearPendingRequest(); setQuote(null); }
        if (data.error?.code === "reservation_limit_exceeded") { clearPendingRequest(); setQuote(null); }
        if (response.status < 500 && response.status !== 409) clearPendingRequest();
        if (serviceBalanceUnavailable) throw new Error(confirmedRefund
          ? t("生成服务暂时不可用，本次未扣费。请稍后重试或联系支持。", "Service temporarily unavailable. You were not charged. Try later or contact support.")
          : t("生成服务暂时不可用，请先查询此请求的状态。", "Service temporarily unavailable. Check this request’s status before trying again."));
        throw new Error(data.error?.message || "请求未完成，请保留当前参数后重试查询。");
      }
      setResult(data); setQuote(null); clearPendingRequest(); scrollToResult();
      if (Array.isArray(data.data) && data.data[0]?.task_id) setTasks(current => [{ id: data.data[0].task_id, model, status: data.data[0].status || "submitted" }, ...current.filter(task => task.id !== data.data[0].task_id)].slice(0, 50));
    } catch (cause) { setRequestError(cause instanceof Error ? cause.message : "连接中断，请保留当前参数重试查询原请求。"); }
    finally { setBusy(false); setPhase(null); inFlight.current = false; void refreshStatus(); }
  }
  async function queryPendingRequest() {
    const original = pendingRequest.current;
    if (inFlight.current || !original) return;
    inFlight.current = true; setBusy(true); setPhase("query"); setRequestError("");
    try {
      const response = await fetch(`/api/gateway/v1/requests/${encodeURIComponent(original.id)}`, { cache: "no-store" });
      const data = await response.json();
      if (response.status === 404 && data.error?.code === "request_not_found") {
        clearPendingRequest(); setQuote(null);
        setRequestError(t("未找到此请求记录，可以重新获取报价后生成。", "No record was found for this request. Get a new quote before generating."));
        return;
      }
      const billing = data.tokvilo_billing;
      const finalized = billing?.status === "refunded" && billing.chargedMicrousd === 0 || billing?.status === "settled" && Number.isSafeInteger(billing.chargedMicrousd) && billing.chargedMicrousd >= 0;
      if (finalized) { clearPendingRequest(); setQuote(null); }
      if (!response.ok) {
        if (data.error?.code === "service_balance_unavailable") throw new Error(finalized && billing.status === "refunded"
          ? t("生成服务暂时不可用，本次未扣费。请稍后重试或联系支持。", "Service temporarily unavailable. You were not charged. Try later or contact support.")
          : t("生成服务暂时不可用，请先查询此请求的状态。", "Service temporarily unavailable. Check this request’s status before trying again."));
        if (data.error?.code === "outcome_pending") throw new Error(t("原请求结果尚未确认，预留金额可能仍在处理中。请稍后查询，不会重复生成。", "The original request is not confirmed yet and funds may still be reserved. Check again later; this does not generate again."));
        throw new Error(data.error?.message || t("原请求暂时无法查询，请稍后再试。", "The original request could not be checked. Try again later."));
      }
      setResult(data); setShowPreview(true); scrollToResult();
      if (Array.isArray(data.data) && data.data[0]?.task_id) {
        const task = data.data[0];
        if (pendingRequest.current?.id === original.id) pendingRequest.current.taskId = task.task_id;
        setTasks(current => [{ id: task.task_id, model: original.model, status: task.status || "submitted" }, ...current.filter(item => item.id !== task.task_id)].slice(0, 50));
      }
    } catch (cause) { setRequestError(cause instanceof Error ? cause.message : t("原请求暂时无法查询，请稍后再试。", "The original request could not be checked. Try again later.")); }
    finally { setBusy(false); setPhase(null); inFlight.current = false; void refreshStatus(); }
  }
  const output = result && typeof result.data === "object" && result.data && !Array.isArray(result.data) ? result.data as Record<string, unknown> : result;
  const media = output?.result && typeof output.result === "object" ? output.result as { images?: Array<{ url?: string | string[] }>; videos?: Array<{ url?: string | string[] }>; music?: Array<{ audio_url?: string; title?: string }> } : null;
  const safeMedia = (value: string) => { try { const url = new URL(value); return url.protocol === "https:" && ["upload.apimart.ai", "cdn.apimart.ai"].includes(url.hostname); } catch { return false; } };
  const videoUrls = (media?.videos || []).flatMap(item => Array.isArray(item.url) ? item.url : item.url ? [item.url] : []).filter(safeMedia);
  const music = (media?.music || []).filter(item => item.audio_url && safeMedia(item.audio_url));
  const imageUrls = (media?.images || []).flatMap(item => Array.isArray(item.url) ? item.url : item.url ? [item.url] : []).filter(safeMedia);
  const choices = output && Array.isArray(output.choices) ? output.choices as Array<{ message?: { content?: string } }> : [];

  return <div className="playground-layout">
    <section className="playground-controls" aria-label={t("请求参数", "Request parameters")}>
      <div className="playground-control-header"><span>PLAYGROUND</span><Link href={href("/models")} aria-label={t("查看模型市场", "Browse models")}><Icon name="store" size={17} /></Link></div>
      <div className="playground-category-tabs" role="tablist" aria-label={t("生成类型", "Generation type")}>{modelCategories.map(item => <button key={item.id} role="tab" type="button" aria-selected={category === item.id} className={category === item.id ? "selected" : ""} onClick={() => changeCategory(item.id)}><Icon name={item.icon} size={15} />{categoryLabel(item.id)}</button>)}</div>
      <div className="playground-form-fields">
        <label className="playground-field"><span>{t("模型 ", "Model ")}<span className="field-required">*</span></span><div className="playground-model-select"><span className="playground-model-mark">{providerInitials(selected?.provider || "M")}</span><select aria-label={t("选择模型", "Choose model")} value={selected?.id || "custom"} onChange={event => { automaticSelection.current.allowed = false; setModel(event.target.value === "custom" ? "" : event.target.value); setAdvanced(null); setShowPreview(false); }}>{directory.filter(item => item.category === category).map(item => <option key={item.id} value={item.id}>{isEnglish ? englishPriceText(item.name) : item.name}{prices.find(price => price.model === item.id)?.billingReady ? "" : t(" · 暂未开通调用", " · Not available yet")}</option>)}<option value="custom">{t("自定义模型", "Custom model")}</option></select></div></label>
        <label className="playground-field playground-model-id"><span>Model ID</span><input value={model} onChange={event => { automaticSelection.current.allowed = false; setModel(event.target.value); setAdvanced(null); }} placeholder={t("填写模型 ID", "Enter model ID")} spellCheck={false} /><small>{t("可按模型目录修改", "Use the exact ID from the model catalogue")}</small></label>
        <label className="playground-field"><span>{t("提示词 ", "Prompt ")}<span className="field-required">*</span><button type="button" aria-label={t("插入提示词示例", "Insert an example prompt")} onClick={() => { setPrompt(samples[category][promptExample % samples[category].length]); setPromptExample(promptExample + 1); }}><Icon name="sparkles" size={13} />{t("试试示例", "Try an example")}</button></span><textarea aria-label={t("提示词", "Prompt")} value={prompt} onChange={event => setPrompt(event.target.value)} placeholder={promptPlaceholder[category]} rows={6} maxLength={10000} /><small className="prompt-character-count">{prompt.length.toLocaleString()} / 10,000</small></label>
        {detailedImage ? <>
          <fieldset className="playground-field"><legend>{t("分辨率", "Resolution")}</legend><div className="playground-option-row">{(imageResolutions.length ? imageResolutions : ["default"]).map(value => <button key={value} type="button" className={chosenResolution === value ? "selected" : ""} aria-pressed={chosenResolution === value} onClick={() => setResolution(value)}>{value.toUpperCase()}</button>)}</div></fieldset>
          {versionedImage ? <label className="playground-field"><span>{t("图片版本", "Image version")}</span><select aria-label={t("图片版本", "Image version")} value={version} onChange={event => setVersion(event.target.value)}>{["flare", "sunburst"].map(value => <option key={value}>{value}</option>)}</select></label> : null}
          {qualityImage ? <label className="playground-field"><span>{t("图片质量", "Image quality")}</span><select aria-label={t("图片质量", "Image quality")} value={chosenQuality} onChange={event => setQuality(event.target.value)}>{imageQualities.map(value => <option key={value}>{value}</option>)}</select></label> : null}
          <label className="playground-field"><span>{t("图片比例", "Aspect ratio")}</span><select value={ratio} onChange={event => setRatio(event.target.value)} aria-label={t("图片比例", "Aspect ratio")}>{["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "21:9", "auto"].map(value => <option key={value} value={value}>{value === "auto" ? t("自动", "Auto") : value}</option>)}</select></label>
          <div className="playground-field"><span>{t("生成数量", "Quantity")}</span><div className="playground-fixed-value">{model === "midjourney" ? t("1 个任务", "1 task") : t("1 张", "1 image")} <span>{model === "midjourney" ? t("四宫格 · 默认 v7 / relax", "4-image grid · Default v7 / relax") : t("单次请求", "Per request")}</span></div></div>
          <label className="playground-field"><span>{t("参考图 ", "Reference image ")}<small>{t("选填", "Optional")}</small></span><div className="playground-reference"><Icon name="image" size={20} /><input type="url" value={reference} onChange={event => setReference(event.target.value)} placeholder={t("粘贴公开图片 URL", "Paste a public image URL")} aria-label={t("参考图片 URL", "Reference image URL")} /></div></label>
        </> : null}
        {category === "video" ? <>
          <label className="playground-field"><span>{t("视频时长（秒）", "Duration (seconds)")}</span><select aria-label={t("视频时长", "Video duration")} value={chosenDuration} onChange={event => setDuration(Number(event.target.value))}>{videoDurations.map(value => <option key={value} value={value}>{value}</option>)}</select></label>
          {klingMode ? <label className="playground-field"><span>{t("视频模式", "Video mode")}</span><select aria-label={t("视频模式", "Video mode")} value={chosenVideoMode} onChange={event => setVideoMode(event.target.value)}>{(videoOptions?.modes || []).map(value => <option key={value}>{value}</option>)}</select></label> : <label className="playground-field"><span>{t("视频分辨率", "Video resolution")}</span><select aria-label={t("视频分辨率", "Video resolution")} value={chosenVideoResolution} onChange={event => setVideoResolution(event.target.value)}>{(videoOptions?.resolutions || []).map(value => <option key={value}>{value}</option>)}</select></label>}
          <label className="playground-field"><span>{t("参考图（", "Reference image (")}{videoOptions?.referenceRequired ? t("必填", "Required") : t("选填", "Optional")}{t("）", ")")}</span><input type="url" aria-label={t("视频参考图片 URL", "Video reference image URL")} value={reference} onChange={event => setReference(event.target.value)} placeholder={t("公开 HTTPS 图片 URL", "Public HTTPS image URL")} /></label>
        </> : null}
        {category === "audio" && model === "suno" ? <label className="playground-field"><span>{t("音乐版本", "Music version")}</span><select aria-label={t("音乐版本", "Music version")} value={musicVersion} onChange={event => setMusicVersion(event.target.value)}>{["v6", "v6-mini", "v6-wild"].map(value => <option key={value}>{value}</option>)}</select></label> : null}
        {category === "audio" && model === "suno" ? <label className="playground-check"><input type="checkbox" checked={instrumental} onChange={event => setInstrumental(event.target.checked)} />{t("纯音乐，无人声", "Instrumental, without vocals")}</label> : null}
        {category === "video" || (category === "image" && !detailedImage) || category === "text" ? <div className="playground-parameter-note"><Icon name="info" size={15} /><p>{t("这里提供基础请求。其他选项请按所选模型的参数文档补充。", "These are basic parameters. Check the selected model’s documentation for additional options.")}</p></div> : null}
        <div className="playground-field"><button type="button" onClick={() => { automaticSelection.current.allowed = false; setAdvanced(advanced === null ? json : null); }}>{advanced === null ? t("编辑完整 JSON 参数", "Edit full JSON parameters") : t("返回基础参数", "Back to basic parameters")}</button>{advanced !== null ? <><textarea aria-label={t("完整 JSON 参数", "Full JSON parameters")} value={advanced} onChange={event => setAdvanced(event.target.value)} rows={12} spellCheck={false} /><small>{t("完整 JSON 为本次报价与生成的唯一请求内容。", "The full JSON is the exact request used for quoting and generation.")}</small></> : null}{payloadError ? <p role="alert">{messageCopy(payloadError)}</p> : null}</div>
      </div>
      <div className="playground-run-area">
        <p className="playground-code-note">{t("$1 = 1,000 积分。积分用于计价，tokens 表示实际模型用量。预留金额不是最终费用。", "$1 = 1,000 credits. Credits express prices; tokens track actual model usage. A reservation is not the final charge.")}</p>
        <p className="playground-generation-steps">{t("1. 查看价格 → 2. 确认生成", "1. Check price → 2. Confirm generation")}</p>
        {serviceStatus?.authenticated && typeof serviceStatus.balanceMicrousd === "number" ? <div className="playground-wallet-status"><span>{t("可用余额", "Available balance")}</span><strong>{formatCreditsWithUsd(serviceStatus.balanceMicrousd, locale)}</strong><a href={href("/dashboard/wallet")}>{t("充值", "Top up")}</a></div> : null}
        {statusNotice ? <p className="playground-action-notice" role="status">{statusNotice}</p> : null}
        {serviceStatus?.code === "login_required" ? <Link href={href("/login?next=%2Fplayground")}>{t("重新登录", "Sign in again")}</Link> : <button className="playground-status-refresh" type="button" disabled={statusLoading || busy} onClick={refreshStatus}>{statusLoading ? t("检查中…", "Checking…") : t("刷新余额与服务状态", "Refresh balance & service status")}</button>}
        {capabilityNotice ? <p className="playground-action-notice" role="status">{capabilityNotice}</p> : null}
        {needsReference ? <p className="playground-action-notice" role="status">{t("此模型需要参考图片，请填写公开 HTTPS 图片地址。", "This model needs a reference image. Enter a public HTTPS image URL.")}</p> : null}
        {priceError || requestError || payloadError ? <p className="playground-action-error" role="alert">{messageCopy(requestError || payloadError || priceError)}</p> : null}
        {pendingId ? <div className="playground-request-recovery" role="status"><p>{t("原请求编号", "Original request ID")}</p><code>{pendingId}</code><p>{t("先查询原请求结果。查询不需要可用余额，也不会再次生成或扣费。", "Check the original request first. No available balance is needed, and checking does not generate or charge again.")}</p><button type="button" disabled={busy} onClick={queryPendingRequest}>{phase === "query" ? t("正在查询原请求…", "Checking original request…") : t("查询原请求", "Check original request")}</button></div> : null}
        {currentQuote ? <div className="playground-quote-summary" role="status"><strong>{t("本次预留 ", "Reservation ")}{formatCreditsWithUsd(currentQuote.reservedMicrousd, locale)}</strong><p>{t("报价已就绪，尚未开始生成。预留金额不是最终费用；确认后预留余额，完成后按实际用量结算并退回差额。", "Your quote is ready; generation has not started. The reservation is not the final charge. Confirm to reserve funds; billing uses actual usage and unused funds are returned.")}</p></div> : null}
        <button className="playground-run" type="button" disabled={busy || !executable || !model.trim() || !!needsReference || !!payloadError || (advanced === null && !prompt.trim()) || (!!currentQuote && (!canGenerate || !!pendingId))} onClick={currentQuote ? run : prepareQuote}><Icon name="sparkles" size={17} />{busy ? phase === "quote" ? t("正在获取报价…", "Getting your quote…") : phase === "generate" ? t("正在提交生成…", "Submitting generation…") : t("正在查询结果…", "Checking result…") : currentQuote ? pendingId ? t("请先查询原请求", "Check the original request first") : insufficientBalance ? t("充值后确认生成", "Top up to generate") : t(`确认预留 ${formatCreditsWithUsd(currentQuote.reservedMicrousd, locale)} 并生成`, `Reserve ${formatCreditsWithUsd(currentQuote.reservedMicrousd, locale)} & generate`) : t("获取准确报价", "Get exact quote")}<Icon name="arrow-right" size={17} /></button>
        {currentQuote ? <button type="button" disabled={busy} onClick={prepareQuote}>{t("刷新报价", "Refresh quote")}</button> : null}<button type="button" onClick={() => { setShowPreview(true); setCopied(false); }}>{t("预览请求", "Preview request")}</button><span><i />{t("按页面价格计费 · 从钱包余额扣费", "Displayed prices · Billed from your wallet")}</span>
      </div>
    </section>
    <section className="playground-workspace" aria-label={t("请求工作台", "Playground")}>
      <header className="playground-workspace-header"><div><h1>{t("请求工作台", "Playground")}</h1><span>{t("从一个想法开始", "Start with an idea")}</span></div><a href={href("/dashboard/docs?provider=gateway")} target="_blank" rel="noreferrer"><Icon name="book" size={15} />{t("模型文档", "Model documentation")}<Icon name="arrow-up-right" size={14} /></a></header>
      <div className="playground-notice"><span className="playground-notice-dot" /><p>{(priceError ? messageCopy(priceError) : "") || capabilityNotice || (executable ? t("此模型支持报价。先查看本次价格，再确认生成；调用状态以实际响应为准。", "Pricing is available for this model. Check the price, then confirm generation. Actual availability is determined by the response.") : t("此模型的计费尚未开通，可以预览参数或选择其他模型。", "Billing for this model is not enabled yet. Preview its parameters or choose another model."))}</p>{isAdmin ? <Link href={href("/admin")}>{t("管理服务 ", "Manage service ")}<Icon name="arrow-right" size={13} /></Link> : <Link href={href("/dashboard/docs")}>{t("查看接口文档 ", "View API documentation ")}<Icon name="arrow-right" size={13} /></Link>}</div>
      {selectedPrice ? <div className="playground-notice"><p>{displayedRates.map(rate => `${isEnglish ? englishPriceText(rate.label || rate.dimension) : rate.label || rate.dimension}: ${formatCreditsWithUsd(rate.retailMicrousd, locale)}/${rate.unit === "image" ? t("张", "images") : rate.unit === "second" ? t("秒", "seconds") : rate.unit === "call" ? t("次", "requests") : t("百万 tokens", "1M tokens")}`).join(" · ")}</p><Link href={href("/pricing")}>{t("完整价格", "Full pricing")}</Link><a href={href("/dashboard/wallet")}>{t("钱包与充值", "Wallet & top up")}</a></div> : null}
      {result ? <div className="playground-preview-area" ref={resultRef}><h2>{t("生成结果", "Results")}</h2><PlaygroundBillingSummary response={result} locale={locale} />{imageUrls.map((url, index) => <figure key={url}>
        {/* Official task results use upload.apimart.ai; preserve their signed URL without optimizing. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={t(`生成图片 ${index + 1}`, `Generated image ${index + 1}`)} style={{ maxWidth: "100%", maxHeight: 560, objectFit: "contain" }} referrerPolicy="no-referrer" />
        <figcaption><a href={url} target="_blank" rel="noopener noreferrer">{t("打开原图", "Open original image")}</a></figcaption>
      </figure>)}{videoUrls.map(url => <video key={url} src={url} controls preload="metadata" style={{ maxWidth: "100%", maxHeight: 560 }} />)}{music.map(item => <figure key={item.audio_url}><figcaption>{item.title || t("生成音乐", "Generated music")}</figcaption><audio src={item.audio_url} controls preload="metadata" /></figure>)}{choices[0]?.message?.content ? <pre style={{ whiteSpace: "pre-wrap" }}>{choices[0].message.content}</pre> : null}<pre style={{ overflowX: "auto", maxHeight: 360 }}><code>{JSON.stringify(result, null, 2)}</code></pre></div> : null}
      {tasks.length ? <div className="playground-preview-area"><h2>{t("最近生成任务", "Recent tasks")}</h2>{tasks.map(task => <div className="playground-request-summary" key={task.id}><div><span>{task.model}</span><code>{task.id}</code></div><div><span>{t("状态", "Status")}</span><strong>{task.status}</strong></div><button type="button" disabled={busy} onClick={() => refreshTask(task.id)}>{t("查询结果", "Check result")}</button></div>)}</div> : null}
      {showPreview ? <div className="playground-preview-area">
        <div className="playground-preview-meta"><span className="request-method">POST</span><code>/api/gateway{endpoints[category]}</code><span>{t("tokvilo 请求示例", "tokvilo request example")}</span></div>
        <div className="playground-code-panel"><div className="playground-code-toolbar"><div role="tablist" aria-label={t("代码格式", "Code format")}><button role="tab" aria-selected={format === "json"} type="button" className={format === "json" ? "selected" : ""} onClick={() => setFormat("json")}>JSON</button><button role="tab" aria-selected={format === "curl"} type="button" className={format === "curl" ? "selected" : ""} onClick={() => setFormat("curl")}>cURL</button></div><button type="button" onClick={copy}><Icon name={copied ? "check" : "copy"} size={14} />{copied ? t("已复制", "Copied") : t("复制代码", "Copy code")}</button></div><pre tabIndex={0}><code>{format === "json" ? json : curl}</code></pre></div>
        <div className="playground-code-note" role="status">{copyError ? t("复制未完成，请选择上方代码后手动复制。", "Copy failed. Select and copy the code above manually.") : t("使用你的 tokvilo API Key；每次新请求使用唯一编号，重试保留同一 Idempotency-Key。", "Use your tokvilo API key and a unique ID for each new request. Keep the same Idempotency-Key when retrying.")}</div>
        <div className="playground-request-summary"><div><span>{t("模型", "Model")}</span><strong>{isEnglish ? englishPriceText(selected?.name || model) : selected?.name || model}</strong></div><div><span>{t("能力", "Capability")}</span><strong>{categoryLabel(category)}</strong></div><div><span>{t("执行状态", "Request status")}</span><strong>{busy ? t("处理中", "Processing") : result ? t("已收到响应", "Response received") : t("尚未发送", "Not sent")}</strong></div></div>
      </div> : <div className="playground-empty-state"><div className="playground-empty-art" aria-hidden="true"><span /><span /><span /><Icon name={modelCategories.find(item => item.id === category)?.icon || "image"} size={32} /></div><h2>{t("让想法有一个起点", "Give your idea a starting point")}</h2><p>{t("选择模型，填写提示词。", "Choose a model and enter a prompt.")}<br />{t("使用钱包余额生成内容，或预览你的 API 请求。", "Generate using your wallet balance, or preview your API request.")}</p><div className="playground-suggestions">{samples[category].slice(0, 2).map((example, i) => <button type="button" key={example} onClick={() => setPrompt(example)}><Icon name={i ? "sparkles" : "image"} size={15} /><span>{example}</span><Icon name="arrow-up-right" size={13} /></button>)}</div></div>}
      <footer className="playground-workspace-footer"><span>tokvilo PLAYGROUND</span><span>{t("提交后由所选模型处理提示词", "The selected model processes your prompt after submission")}</span></footer>
    </section>
  </div>;
}
