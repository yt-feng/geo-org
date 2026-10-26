"use client";

import { useSiteLocale } from "./LocaleProvider";
import { formatCreditsWithUsd } from "@/lib/credits";
import { PlaygroundBillingSummary } from "./PlaygroundBillingSummary";


import { displayServiceText } from "@/lib/brand-display";
import type { PlaygroundStatus } from "@/lib/playground-status";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Icon } from "./Icon";

type Mode = "video" | "image" | "chat";
type Json = Record<string, unknown>;
type Model = { id: string; name?: string; provider: string; category: string[]; sources?: string[]; modelType?: string; accountAccess?: string; integrationStatus?: string; limitations?: string[] };
type Catalog = { complete: boolean; observedAt: string; sources: Array<{ source: string; status: string; modelCount: number }>; warnings: string[] };
type Task = { id: string; model: string; status: string; created_at?: string; updated_at?: string };
const endpoint: Record<Mode, string> = { video: "/api/studio/v3/contents/generations/tasks", image: "/api/studio/v3/images/generations", chat: "/api/studio/v1/chat/completions" };
const modes: Array<{ id: Mode; name: string; icon: string }> = [{ id: "video", name: "视频", icon: "video" }, { id: "image", name: "图像", icon: "image" }, { id: "chat", name: "对话", icon: "message" }];
const defaults: Record<Mode, string> = { video: "dreamina-seedance-2-0-260128", image: "dola-seedream-5-0-pro-260628", chat: "" };
const examples: Record<Mode, string> = { video: "镜头缓缓掠过清晨的海岸，柔和的金色阳光照亮浪花，海风轻拂，电影摄影质感。", image: "极简产品摄影：银色耳机置于浅灰色石材上，柔和侧光，干净构图，细腻阴影。", chat: "用三句话介绍统一模型 API 如何帮助开发者快速实现创意。" };
const statusNames: Record<string, string> = { submitted: "已提交", queued: "排队中", pending: "等待中", running: "生成中", processing: "生成中", succeeded: "已完成", completed: "已完成", success: "已完成", failed: "失败", cancelled: "已取消", canceled: "已取消", expired: "已过期", deleted: "已删除", cancelled_or_deleted: "已取消或删除" };
const statusEnglish: Record<string, string> = { submitted: "Submitted", queued: "Queued", pending: "Pending", running: "Generating", processing: "Generating", succeeded: "Completed", completed: "Completed", success: "Completed", failed: "Failed", cancelled: "Cancelled", canceled: "Cancelled", expired: "Expired", deleted: "Deleted", cancelled_or_deleted: "Cancelled or deleted" };
const terminal = new Set(["succeeded", "completed", "success", "failed", "cancelled", "canceled", "expired", "deleted", "cancelled_or_deleted"]);
const limitationLabels: Record<string, string> = { non_streaming_json_only: "返回完整 JSON", eco_geo_owned_tasks_only: "仅管理本账户创建的视频任务", idempotency_key_required: "创建视频需唯一请求编号" };

function record(value: unknown): Json { return value && typeof value === "object" && !Array.isArray(value) ? value as Json : {}; }
function payloadOf(value: unknown): Json { const root = record(value); return root.id || root.status || root.content ? root : Object.keys(record(root.data)).length ? record(root.data) : root; }
function text(value: unknown): string { return typeof value === "string" ? value : ""; }
function safeUrl(value: unknown): string { if (typeof value !== "string") return ""; try { const parsed = new URL(value); return parsed.protocol === "https:" ? parsed.href : ""; } catch { return ""; } }
function shellQuote(value: string) { return `'${value.replaceAll("'", "'\\''")}'`; }
function modelMatches(model: Model, mode: Mode) { if (model.modelType && ["chat", "image", "video", "unknown"].includes(model.modelType)) return model.modelType === mode; const value = `${model.id} ${model.category.join(" ")}`.toLowerCase(); return mode === "video" ? /video|seedance|视频/.test(value) : mode === "image" ? /image|seedream|图像|图片/.test(value) : /chat|text|language|llm|对话|文本/.test(value) && !/video|image/.test(value); }
function modelLabel(model: Model) { return model.name && model.name !== model.id ? model.name : model.id.replace(/^(dola|dreamina)-/, "").replace(/-(?:ga-)?\d{6}$/, "").replace(/(\d)-(?=\d)/g, "$1.").replaceAll("-", " ").replace(/\bglm\b/gi, "GLM").replace(/\bdeepseek\b/gi, "DeepSeek").replace(/\b(seedance|seedream|flash|pro|mini|fast|v\d+)\b/gi, word => word[0].toUpperCase() + word.slice(1)); }
function parseModels(value: unknown): Model[] {
  if (!Array.isArray(value)) return [];
  return value.map(record).filter(item => text(item.id)).map(item => ({ id: text(item.id), name: text(item.name), provider: text(item.provider), category: Array.isArray(item.category) ? item.category.filter((category): category is string => typeof category === "string") : [], sources: Array.isArray(item.sources) ? item.sources.filter((source): source is string => typeof source === "string") : [], modelType: text(item.modelType), accountAccess: text(item.accountAccess), integrationStatus: text(item.integrationStatus), limitations: Array.isArray(item.limitations) ? item.limitations.filter((limit): limit is string => typeof limit === "string") : [] }));
}
function selectionFromSearch(search: string): { model: string; mode?: Mode } {
  const params = new URLSearchParams(search), id = params.get("model")?.trim() || "", category = params.get("category") || params.get("mode");
  return { model: id.length <= 200 ? id : "", mode: modes.find(item => item.id === (category === "text" ? "chat" : category))?.id };
}

async function request(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(path, { ...init, credentials: "same-origin", cache: "no-store" });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result) {
    const root = record(result), detail = record(root.error);
    throw new Error(text(root.message) || text(detail.message) || text(root.error) || `请求未完成（${response.status}）。请检查任务列表后再重试。`);
  }
  return result;
}

function TaskBadge({ status }: { status: string }) { const { t, isEnglish } = useSiteLocale(); return <span className={`tokenhub-task-status status-${status.replace(/[^a-z]/gi, "")}`}><i />{(isEnglish ? statusEnglish[status] : statusNames[status]) || status || t("状态待查询", "Status pending")}</span>; }

function MediaPreviewError({ kind, hasDirectLink }: { kind: "image" | "video"; hasDirectLink: boolean }) {
  const { t } = useSiteLocale();
  const name = kind === "image" ? t("图片", "Image") : t("视频", "Video");
  return <div className="tokenhub-media-error" role="status"><Icon name={kind} size={28} /><strong>{t(`${name}预览加载失败`, `${name} preview could not load`)}</strong><p>{t("当前浏览器未能加载预览。", "The browser could not load this preview.")}{hasDirectLink ? t("可尝试通过下方直链打开原始文件。", "Try opening the original file using the link below.") : t("请展开原始响应查看返回内容。", "Expand the raw response to inspect the result.")}</p></div>;
}

// The source URL is used as the component key so a new result starts with a fresh preview state.
function ImagePreview({ src, alt, hasDirectLink }: { src: string; alt: string; hasDirectLink: boolean }) {
  const [failed, setFailed] = useState(false);
  return failed ? <MediaPreviewError kind="image" hasDirectLink={hasDirectLink} /> : <Image unoptimized width={1024} height={1024} style={{ height: "auto" }} src={src} alt={alt} onError={() => setFailed(true)} />;
}

function VideoPreview({ src, poster }: { src: string; poster?: string }) {
  const [failed, setFailed] = useState(false);
  return <div className="tokenhub-video-frame">{failed ? <MediaPreviewError kind="video" hasDirectLink /> : <video src={src} poster={poster} controls playsInline preload="metadata" onError={() => setFailed(true)} />}</div>;
}

export function TokenHubPlayground({ isAdmin = false }: { isAdmin?: boolean }) {
  const { t, isEnglish, href, locale } = useSiteLocale();
  const samples: Record<Mode, string> = isEnglish ? { video: "The camera slowly follows a coastline at dawn, gentle golden light on the waves, cinematic photography.", image: "Minimal product photography: silver headphones on pale grey stone, soft side lighting and delicate shadows.", chat: "In three sentences, explain how a unified model API helps developers turn ideas into products." } : examples;
  const messageCopy = (value: string) => {
    if (!isEnglish) return displayServiceText(value);
    if (/余额不足/.test(value)) return "Insufficient wallet balance. Please top up.";
    if (/报价|价格/.test(value)) return "Pricing is unavailable or incomplete. Get a new quote before submitting.";
    if (/目录/.test(value)) return "The model catalogue is incomplete. You can enter an exact model ID.";
    if (/JSON/.test(value)) return "Check the full JSON request against the model documentation.";
    return /[\u4e00-\u9fff]/.test(value) ? "The request could not be completed. Check the existing task before retrying." : displayServiceText(value);
  };
  const [mode, setMode] = useState<Mode>("video");
  const [readiness, setReadiness] = useState<PlaygroundStatus | null>(null);
  const [statusError, setStatusError] = useState("");
  const [checking, setChecking] = useState(false);
  const [models, setModels] = useState<Model[]>([]);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [model, setModel] = useState(defaults.video);
  const [modelError, setModelError] = useState("");
  const [prompt, setPrompt] = useState("");
  const [reference, setReference] = useState("");
  const [referenceRole, setReferenceRole] = useState("first_frame");
  const [duration, setDuration] = useState("5");
  const [resolution, setResolution] = useState("720p");
  const [ratio, setRatio] = useState("16:9");
  const [generateAudio, setGenerateAudio] = useState(true);
  const [imageSize, setImageSize] = useState("2K");
  const [advanced, setAdvanced] = useState(false);
  const [jsonInput, setJsonInput] = useState("");
  const [format, setFormat] = useState<"json" | "curl">("json");
  const [tab, setTab] = useState<"result" | "request" | "tasks">("result");
  const [pending, setPending] = useState(false);
  const [quoting, setQuoting] = useState(false);
  const [quote, setQuote] = useState<{ body: string; mode: Mode; reservedMicrousd: number } | null>(null);
  const [error, setError] = useState("");
  const [result, setResult] = useState<unknown>(null);
  const [resultMode, setResultMode] = useState<Mode>("video");
  const [taskId, setTaskId] = useState("");
  const [queryId, setQueryId] = useState("");
  const [polling, setPolling] = useState(false);
  const [pollCount, setPollCount] = useState(0);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [tasksLoaded, setTasksLoaded] = useState(false);
  const [tasksError, setTasksError] = useState("");
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const inFlight = useRef(false);
  const submission = useRef<{ body: string; mode: Mode; key: string } | null>(null);
  const selection = useRef(0);

  async function refreshStatus() {
    setChecking(true); setStatusError("");
    try {
      const response = await fetch("/api/playground/status?service=studio", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || data.service !== "studio" || data.authenticated !== true || data.currency !== "USD" || !Number.isSafeInteger(data.balanceMicrousd)) {
        throw Error(response.status === 401 ? t("登录已过期，请重新登录。", "Your session expired. Please sign in again.") : t("无法检查余额和服务状态，请刷新状态。", "Could not check your balance and service. Refresh status to continue."));
      }
      setReadiness(data);
      return data as PlaygroundStatus;
    } catch (cause) { setReadiness(null); setStatusError(cause instanceof Error ? cause.message : t("状态检查失败。", "Status check failed.")); return null; }
    finally { setChecking(false); }
  }

  useEffect(() => {
    let active = true;
    fetch("/api/playground/status?service=studio", { cache: "no-store" }).then(async response => {
      const data = await response.json();
      if (!response.ok || data.service !== "studio" || data.currency !== "USD" || !Number.isSafeInteger(data.balanceMicrousd)) throw Error("status_unavailable");
      if (active) setReadiness(data);
    }).catch(() => { if (active) setStatusError("status_unavailable"); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const requested = selectionFromSearch(window.location.search), requestedModel = requested.model, requestedMode = requested.mode;
    const hasRequestedModel = !!requestedModel;
    request("/api/studio/v1/models", { signal: controller.signal }).then(value => { if (!controller.signal.aborted) {
      const body = record(value), info = record(body.catalog);
      const discovered = parseModels(body.data); setModels(discovered);
      if (hasRequestedModel) { setModel(requestedModel); const selected = discovered.find(item => item.id === requestedModel); const selectedMode = requestedMode || (selected ? modes.find(item => modelMatches(selected, item.id))?.id : undefined); if (selectedMode) setMode(selectedMode); }
      else if (requestedMode) { setMode(requestedMode); setModel(discovered.find(item => modelMatches(item, requestedMode))?.id || defaults[requestedMode]); }
      setCatalog({ complete: info.complete === true, observedAt: text(info.observedAt), sources: Array.isArray(info.sources) ? info.sources.map(record).map(item => ({ source: text(item.source), status: text(item.status), modelCount: typeof item.modelCount === "number" ? item.modelCount : 0 })) : [], warnings: Array.isArray(info.warnings) ? info.warnings.filter((warning): warning is string => typeof warning === "string") : [] });
    } }).catch(error => { if (!controller.signal.aborted) { setModelError(error instanceof Error ? error.message : "模型目录读取失败。"); if (hasRequestedModel) setModel(requestedModel); if (requestedMode) setMode(requestedMode); } }).finally(() => { if (!controller.signal.aborted) setModelsLoading(false); });
    return () => controller.abort();
  }, []);

  const options = useMemo(() => models.filter(item => modelMatches(item, mode)), [models, mode]);
  const unknownModels = models.filter(item => !modes.some(mode => modelMatches(item, mode.id)));
  const selectedModel = models.find(item => item.id === model);
  const selectedLimitations = (selectedModel?.limitations || []).map(item => isEnglish ? ({ non_streaming_json_only: "Complete JSON responses", eco_geo_owned_tasks_only: "Manage only video tasks created by this account", idempotency_key_required: "Video creation requires a unique request ID" } as Record<string, string>)[item] : limitationLabels[item]).filter(Boolean);
  const generated = useMemo(() => {
    if (mode === "chat") return { model, messages: [{ role: "user", content: prompt }], stream: false, max_tokens: 1024 };
    if (mode === "image") return { model, prompt, size: imageSize, watermark: false, response_format: "url" };
    return { model, content: [{ type: "text", text: prompt }, ...(reference.trim() ? [{ type: "image_url", image_url: { url: reference.trim() }, role: referenceRole }] : [])], resolution, ratio, duration: Number(duration), generate_audio: generateAudio, watermark: false };
  }, [mode, model, prompt, imageSize, reference, referenceRole, resolution, ratio, duration, generateAudio]);
  const json = advanced ? jsonInput : JSON.stringify(generated, null, 2);
  const currentQuote = quote?.body === json && quote.mode === mode ? quote : null;
  const configurationReady = !!readiness?.serviceEnabled && readiness.configured && readiness.accountActive;
  const insufficient = !!readiness && readiness.balanceMicrousd < (currentQuote?.reservedMicrousd || 1);
  const blockedMessage = (statusError === "status_unavailable" ? t("无法检查余额和服务状态，请刷新状态。", "Could not check your balance and service. Refresh status to continue.") : statusError) || (!readiness ? t("正在检查余额和服务状态…", "Checking balance and service status…")
    : !readiness.accountActive ? t("此账户已停用，请联系支持。", "This account is inactive. Please contact support.")
      : !readiness.serviceEnabled ? t("生成服务暂未启用，可以查看参数和报价。", "Generation is currently disabled. You can review parameters and pricing.")
        : !readiness.configured ? t("此服务尚未配置完成，可以查看参数和报价。", "This service is awaiting configuration. You can review parameters and pricing.")
          : insufficient ? t("可用余额不足，请充值后生成。查看报价不会扣费。", "Insufficient available balance. Top up before generating. Checking a quote is free.") : "");
  const curl = `TOKVILO_REQUEST_ID="$(uuidgen)"\n\ncurl --request POST \\\n  --url 'https://tokvilo.com${endpoint[mode]}' \\\n  --header 'Authorization: Bearer YOUR_TOKVILO_API_KEY' \\\n  --header 'Content-Type: application/json' \\\n  --header "Idempotency-Key: $TOKVILO_REQUEST_ID" \\\n  --data ${shellQuote(json)}`;
  const taskData = payloadOf(result);
  const taskStatus = text(taskData.status).toLowerCase();
  const content = record(taskData.content);
  const videoUrl = safeUrl(content.video_url || taskData.video_url);
  const frameUrl = safeUrl(content.last_frame_url || taskData.last_frame_url);
  const images = resultMode === "image" && Array.isArray(record(result).data) ? (record(result).data as unknown[]).map(record).map(item => ({ url: safeUrl(item.url), base64: text(item.b64_json) })).filter(item => item.url || item.base64) : [];
  const choices = Array.isArray(record(result).choices) ? record(result).choices as unknown[] : [];
  const answer = choices.map(choice => text(record(record(choice).message).content)).filter(content => content.trim()).join("\n\n");
  const emptyAnswerAtTokenLimit = !answer && choices.some(choice => text(record(choice).finish_reason) === "length");

  useEffect(() => {
    if (!taskId || !polling) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>, count = 0;
    const version = selection.current;
    async function poll() {
      try {
        const next = await request(`${endpoint.video}/${encodeURIComponent(taskId)}`, { signal: controller.signal });
        if (controller.signal.aborted || selection.current !== version) return;
        setResult(next); setResultMode("video"); count++; setPollCount(count);
        if (terminal.has(text(payloadOf(next).status).toLowerCase()) || count >= 120) { setPolling(false); return; }
        timer = setTimeout(poll, 5000);
      } catch (error) {
        if (!controller.signal.aborted && selection.current === version) { setPolling(false); setError(error instanceof Error ? error.message : "任务状态读取失败，可手动刷新。"); }
      }
    }
    timer = setTimeout(poll, 3000);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [taskId, polling]);

  function changeMode(next: Mode) {
    setMode(next); chooseModel(models.find(item => modelMatches(item, next))?.id || defaults[next]); setAdvanced(false); setError(""); setCopied(false);
  }

  function chooseModel(id: string) {
    setModel(id);
    if (/seedance.*fast/i.test(id) && resolution === "1080p") setResolution("720p");
  }

  function toggleAdvanced() {
    if (!advanced) setJsonInput(JSON.stringify(generated, null, 2));
    setAdvanced(!advanced); setTab("request");
  }

  async function loadTasks() {
    setTasksLoading(true); setTasksError("");
    try { const value = record(await request(endpoint.video)); setTasks(Array.isArray(value.data) ? value.data as Task[] : []); setTasksLoaded(true); }
    catch (error) { setTasksError(error instanceof Error ? error.message : "任务记录读取失败。"); }
    finally { setTasksLoading(false); }
  }

  async function selectTask(id: string) {
    if (!id.trim() || refreshing || pending) return;
    setPolling(false); setRefreshing(true); setError(""); setTab("result");
    const version = ++selection.current;
    try {
      const value = await request(`${endpoint.video}/${encodeURIComponent(id.trim())}`);
      if (selection.current !== version) return;
      setTaskId(id.trim()); setQueryId(id.trim()); setResult(value); setResultMode("video"); setPollCount(0);
      setPolling(!terminal.has(text(payloadOf(value).status).toLowerCase()));
    } catch (error) { if (selection.current === version) setError(error instanceof Error ? error.message : "任务查询失败。"); }
    finally { setRefreshing(false); }
  }

  async function estimate() {
    if (quoting || pending) return;
    setQuoting(true); setError(""); setQuote(null);
    void refreshStatus();
    try {
      const body: unknown = JSON.parse(json);
      const value = record(await request("/api/pricing/quote", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider: "tokenhub", mode, body }) }));
      if (!Number.isSafeInteger(value.reservedMicrousd) || Number(value.reservedMicrousd) <= 0) throw new Error("暂时无法取得该请求的预留金额。");
      setQuote({ body: json, mode, reservedMicrousd: Number(value.reservedMicrousd) });
    } catch (error) { setError(error instanceof SyntaxError ? "JSON 格式有误，请检查后重新报价。" : error instanceof Error ? error.message : "报价暂不可用。"); }
    finally { setQuoting(false); }
  }

  async function submit() {
    if (inFlight.current || quoting || pending) return;
    if (!currentQuote) { await estimate(); return; }
    if (!configurationReady || insufficient) { setError(blockedMessage); return; }
    setError("");
    let body: Json;
    try {
      const value: unknown = JSON.parse(json); body = record(value);
      if (!Object.keys(body).length || !text(body.model).trim()) throw new Error("请填写有效的模型 ID 与 JSON 请求对象。");
      if (mode === "chat" && body.stream === true) throw new Error("当前工作台使用完整响应，请将 stream 设为 false。");
      if (!advanced && !prompt.trim()) throw new Error("请输入提示词。");
      if (mode === "video" && !advanced && reference.trim() && !safeUrl(reference.trim())) throw new Error("请填写公开可访问的 HTTPS 参考图片地址。");
      if (new TextEncoder().encode(JSON.stringify(body)).length > 60000) throw new Error("请求内容过长，请缩短提示词或使用公开素材 URL。");
    } catch (error) { setError(error instanceof SyntaxError ? "JSON 格式有误，请检查引号、逗号与括号。" : error instanceof Error ? error.message : "请求格式有误。"); setTab("request"); return; }
    inFlight.current = true; setPending(true); setPolling(false); setTab("result");
    if (mode === "video") setTasksLoaded(false);
    const version = ++selection.current;
    const serialized = JSON.stringify(body);
    if (submission.current?.body !== serialized || submission.current.mode !== mode) submission.current = { body: serialized, mode, key: crypto.randomUUID() };
    try {
      const value = await request(endpoint[mode], { method: "POST", headers: { "content-type": "application/json", "Idempotency-Key": submission.current!.key, "X-Tokvilo-Max-Reserve-Microusd": String(currentQuote.reservedMicrousd) }, body: serialized });
      if (selection.current !== version) return;
      setResult(value); setResultMode(mode); setTaskId(""); setPollCount(0); setQuote(null);
      if (mode !== "video") submission.current = null;
      if (mode === "video") {
        setTasksLoaded(false);
        const id = text(payloadOf(value).id);
        if (id) { setTaskId(id); setQueryId(id); setPolling(!terminal.has(text(payloadOf(value).status).toLowerCase())); submission.current = null; }
        else setError("请求已返回，但未找到任务 ID。请查看原始响应与任务记录，勿重复提交。");
      }
    } catch (error) { setQuote(null); setError(error instanceof Error ? error.message : "请求未完成。请先检查任务记录。"); }
    finally { inFlight.current = false; setPending(false); void refreshStatus(); }
  }

  async function recoverRequest() {
    const saved = submission.current;
    if (!saved || pending || refreshing) return;
    setRefreshing(true); setError("");
    try {
      const response = await fetch(`/api/studio/v1/requests/${encodeURIComponent(saved.key)}`, { cache: "no-store" });
      const value = await response.json();
      if (!response.ok) {
        if (value.error?.code === "request_not_found" || value.tokvilo_billing?.status === "refunded") { submission.current = null; setQuote(null); }
        if (value.tokvilo_billing) { setResult(value); setTab("result"); }
        throw Error(value.error?.message || t("原请求结果尚未确认，请稍后查询。", "The original request is still unconfirmed. Check again later."));
      }
      setResult(value); setResultMode(saved.mode); setTab("result"); setQuote(null);
      const id = text(payloadOf(value).id);
      if (saved.mode === "video" && id) { setTaskId(id); setQueryId(id); setPolling(!terminal.has(text(payloadOf(value).status).toLowerCase())); submission.current = null; }
      else if (["settled", "refunded"].includes(value.tokvilo_billing?.status)) submission.current = null;
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("查询失败，请稍后重试查询。", "Could not retrieve the request. Check again later.")); }
    finally { setRefreshing(false); void refreshStatus(); }
  }

  async function copy() {
    try { await navigator.clipboard.writeText(format === "json" ? json : curl); setCopied(true); setCopyError(""); setTimeout(() => setCopied(false), 1800); }
    catch { setCopyError("复制未完成，请选中代码手动复制。"); }
  }

  return <div className="playground-layout tokenhub-workbench">
    <section className="playground-controls" aria-label={t("tokvilo 多模态 请求参数", "tokvilo Multimodal request parameters")}>
      <div className="playground-control-header"><span>{t("tokvilo 多模态", "tokvilo Multimodal")}</span><a href={href(isAdmin ? "/admin" : "/dashboard/wallet")} aria-label={isAdmin ? t("管理 tokvilo 多模态 连接", "Manage tokvilo Multimodal connection") : t("余额与充值", "Wallet & top up")}><Icon name="settings" size={17} /></a></div>
      <div className="playground-category-tabs" role="tablist" aria-label={t("tokvilo 多模态 模型类型", "tokvilo Multimodal model type")}>{modes.map(item => <button key={item.id} type="button" role="tab" aria-selected={mode === item.id} className={mode === item.id ? "selected" : ""} onClick={() => changeMode(item.id)} disabled={pending}><Icon name={item.icon} size={15} />{isEnglish ? ({ video: "Video", image: "Image", chat: "Chat" })[item.id] : item.name}{modelsLoading ? "" : ` ${models.filter(model => modelMatches(model, item.id)).length}`}</button>)}</div>
      <div className="playground-form-fields">
        <p className="tokenhub-parameter-help" role="status">{modelsLoading ? t("正在合并模型与价格目录…", "Loading model and price catalogues…") : modelError ? t("目录读取未完成，仍可填写完整模型 ID。", "Catalogue loading is incomplete. You can still enter an exact model ID.") : `${catalog?.complete ? t("当前完整目录", "Complete catalogue") : t("当前部分目录", "Partial catalogue")} ${models.length} ${t("个模型", "models")} · ${models.filter(item => modelMatches(item, "chat")).length} ${t("个对话", "chat")} / ${models.filter(item => modelMatches(item, "image")).length} ${t("个图像", "image")} / ${models.filter(item => modelMatches(item, "video")).length} ${t("个视频", "video")}${unknownModels.length ? ` / ${unknownModels.length} ${t("个待分类", "unclassified")}` : ""}`}</p>
        <label className="playground-field"><span>{t("模型 ", "Model ")}<span className="field-required">*</span></span><select aria-label={t("选择 tokvilo 多模态 模型", "Choose tokvilo Multimodal model")} value={options.some(item => item.id === model) ? model : "custom"} onChange={event => chooseModel(event.target.value === "custom" ? "" : event.target.value)} disabled={advanced || pending}><option value="custom">{t("填写完整模型 ID", "Enter full model ID")}</option>{options.map(item => <option key={item.id} value={item.id}>{modelLabel(item)} · {item.id}</option>)}</select><small>{modelsLoading ? t("正在读取当前类型的全部模型…", "Loading all models of this type…") : t(`当前类型 ${options.length} 个模型 · 请求通过 tokvilo API 发送`, `${options.length} models of this type · Requests use the tokvilo API`)}</small></label>
        <label className="playground-field playground-model-id"><span>MODEL ID</span><input aria-label={t("tokvilo 多模态 模型 ID", "tokvilo Multimodal model ID")} value={model} onChange={event => chooseModel(event.target.value)} spellCheck={false} placeholder={t("填写上游模型 ID", "Enter exact model ID")} disabled={advanced || pending} /><small>{selectedModel?.accountAccess === "unverified_public_catalog" ? t("已接入转发；账户调用权限待实际请求确认。", "Routing is configured; account access is confirmed by an actual request.") : selectedModel ? t("使用目录中的完整版本 ID，不替换为其他模型。", "Use the exact version ID listed in the catalogue.") : t("自定义模型 ID；请选择对应接口类型，也可编辑完整 JSON。", "Custom model ID: choose the matching endpoint type or edit the full JSON.")}</small></label>
        <label className="playground-field"><span>{t("提示词", "Prompt")}<button type="button" disabled={advanced || pending} onClick={() => setPrompt(samples[mode])}><Icon name="sparkles" size={13} />{t("试试示例", "Try an example")}</button></span><textarea aria-label={t("tokvilo 多模态 提示词", "tokvilo Multimodal prompt")} rows={5} maxLength={10000} value={prompt} onChange={event => setPrompt(event.target.value)} placeholder={mode === "video" ? t("描述场景、主体动作和镜头运动…", "Describe the scene, action and camera movement…") : mode === "image" ? t("描述画面、构图、光线和风格…", "Describe the scene, composition, lighting and style…") : t("输入你的消息…", "Enter your message…")} disabled={advanced || pending} /><small>{prompt.length.toLocaleString()} / 10,000</small></label>
        {mode === "video" ? <>
          <div className="tokenhub-field-pair"><label className="playground-field"><span>{t("时长", "Duration")}</span><select aria-label={t("视频时长", "Video duration")} value={duration} onChange={event => setDuration(event.target.value)} disabled={advanced || pending}><option value="-1">{t("模型自动", "Model default")}</option>{Array.from({ length: 12 }, (_, index) => index + 4).map(value => <option key={value} value={value}>{value}{t(" 秒", " seconds")}</option>)}</select></label><label className="playground-field"><span>{t("分辨率", "Resolution")}</span><select aria-label={t("视频分辨率", "Video resolution")} value={resolution} onChange={event => setResolution(event.target.value)} disabled={advanced || pending}>{["480p", "720p", "1080p"].filter(value => value !== "1080p" || !/seedance.*fast/i.test(model)).map(value => <option key={value} value={value}>{value}</option>)}</select></label></div>
          <label className="playground-field"><span>{t("画面比例", "Aspect ratio")}</span><select aria-label={t("视频比例", "Video aspect ratio")} value={ratio} onChange={event => setRatio(event.target.value)} disabled={advanced || pending}>{["16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "adaptive"].map(value => <option key={value} value={value}>{value === "adaptive" ? t("自动适配", "Adaptive") : value}</option>)}</select></label>
          <label className="playground-field"><span>{t("参考图片 ", "Reference image ")}<small>{t("选填", "Optional")}</small></span><input aria-label={t("tokvilo 多模态 参考图片 URL", "tokvilo Multimodal reference image URL")} type="url" value={reference} onChange={event => setReference(event.target.value)} placeholder="https://…" disabled={advanced || pending} />{reference.trim() ? <select aria-label={t("参考图片用途", "Reference image role")} value={referenceRole} onChange={event => setReferenceRole(event.target.value)} disabled={advanced || pending}><option value="first_frame">{t("首帧画面", "First frame")}</option><option value="reference_image">{t("参考图像", "Reference image")}</option></select> : null}</label>
          <label className="playground-check"><input type="checkbox" checked={generateAudio} onChange={event => setGenerateAudio(event.target.checked)} disabled={advanced || pending} />{t("同时生成音频", "Generate audio with video")}</label>
        </> : mode === "image" ? <label className="playground-field"><span>{t("图片尺寸", "Image size")}</span><select aria-label={t("tokvilo 多模态 图片尺寸", "tokvilo Multimodal image size")} value={imageSize} onChange={event => setImageSize(event.target.value)} disabled={advanced || pending}>{["1K", "2K", "4K"].map(value => <option key={value} value={value}>{value}</option>)}</select></label> : null}
        <button className={`tokenhub-advanced-toggle${advanced ? " selected" : ""}`} type="button" onClick={toggleAdvanced} aria-pressed={advanced} disabled={pending}><Icon name="code" size={14} />{advanced ? t("返回参数表单", "Back to form") : t("编辑完整 JSON", "Edit full JSON")}<Icon name="arrow-right" size={14} /></button>
        <p className="tokenhub-parameter-help">{t("各模型支持的尺寸、时长与素材类型不同。多图、参考视频及其他参数可在 JSON 中设置。", "Models support different sizes, durations and media types. Set multiple images, reference videos and other parameters in JSON.")}{selectedLimitations.length ? ` ${selectedLimitations.join(isEnglish ? "; " : "；")}。` : ""}</p>{unknownModels.length ? <details className="tokenhub-parameter-help"><summary>{unknownModels.length}{t(" 个模型尚未识别接口类型", " models have an unclassified endpoint type")}</summary><p>{unknownModels.map(item => item.id).join("、")}{t("。目录记录已保留，可根据模型文档选择接口并填写完整 ID。", ". Catalogue entries are retained. Select the endpoint and exact ID according to the model documentation.")}</p></details> : null}
      </div>
      <div className="playground-run-area">
        {submission.current ? <div className="playground-action-notice"><p>{t("原请求编号：", "Original request ID: ")}<code>{submission.current.key}</code></p><button type="button" disabled={pending || refreshing} onClick={recoverRequest}>{refreshing ? t("查询中…", "Checking…") : t("查询原请求（不重新生成）", "Check original request (no new generation)")}</button></div> : null}
        <p className="playground-code-note">{t("$1 = 1,000 积分。积分用于计价，tokens 表示实际模型用量。预留金额不是最终费用。", "$1 = 1,000 credits. Credits express prices; tokens track actual model usage. A reservation is not the final charge.")}</p>
        <p className="playground-flow-steps">{t("1. 查看报价（不扣费） → 2. 确认生成", "1. Check quote (free) → 2. Confirm generation")}</p>
        <div className="playground-account-state"><span>{t("可用余额", "Available balance")}</span><strong>{readiness ? formatCreditsWithUsd(readiness.balanceMicrousd, locale) : "—"}</strong><a href={href("/dashboard/wallet")}>{t("充值", "Top up")}</a></div>
        {blockedMessage ? <p className="playground-action-notice" role="status">{blockedMessage}</p> : null}
        {error ? <p className="playground-inline-error" role="alert">{messageCopy(error)}</p> : null}
        {modelError ? <p className="playground-action-notice">{messageCopy(modelError)}</p> : null}
        <button className="playground-status-refresh" type="button" disabled={checking || pending} onClick={() => void refreshStatus()}>{checking ? t("检查中…", "Checking…") : t("刷新余额与服务状态", "Refresh balance & service")}</button>
        {currentQuote ? <p className="tokenhub-parameter-help" role="status">{t("本次最多预留 ", "Maximum reservation ")}<strong>{formatCreditsWithUsd(currentQuote.reservedMicrousd, locale)}</strong>{t("。预留不是最终费用；完成后按实际用量结算并退还差额。", ". This is not the final charge. Final billing uses actual usage; unused funds are returned.")}<a href={href("/dashboard/wallet")}>{t("查看余额", "View balance")}</a></p> : null}<button className="playground-run" type="button" disabled={pending || quoting || (!!currentQuote && (!configurationReady || insufficient)) || (!advanced && (!model.trim() || !prompt.trim()))} onClick={submit}><Icon name={pending || quoting ? "clock" : "bolt"} size={16} />{pending ? t("正在提交…", "Submitting…") : quoting ? t("正在报价…", "Getting quote…") : currentQuote ? t("确认并生成", "Confirm & generate") : t("查看预留金额", "Get reservation quote")}<Icon name="arrow-right" size={16} /></button><span><i />{t("从 tokvilo 账户余额结算", "Billed from your tokvilo wallet")}</span></div>
    </section>
    <section className="playground-workspace" aria-label={t("tokvilo 多模态 工作台", "tokvilo Multimodal playground")}>
      <header className="playground-workspace-header"><div><h1>{t("全部模型，一个入口。", "All models. One workspace.")}</h1><span>TOKVILO · MULTIMODAL API</span></div><Link href={href("/dashboard/docs?provider=studio")}><Icon name="book" size={15} />{t("接口文档", "API documentation")}<Icon name="arrow-up-right" size={14} /></Link></header>
      <div className="playground-notice"><span className="playground-notice-dot" /><p>{blockedMessage || t("选择模型后先查看预留金额，再确认生成。", "Choose a model, review the reservation amount, then confirm generation.")}</p><a href={href(isAdmin ? "/admin" : "/dashboard/wallet")}>{isAdmin ? t("管理连接", "Manage connection") : t("余额与充值", "Wallet & top up")} <Icon name="arrow-right" size={13} /></a></div>
      {modelError || catalog?.warnings.length ? <div className="tokenhub-error" role="status"><Icon name="info" size={15} /><span>{messageCopy(modelError || catalog?.warnings.join("; ") || "")}{t(" 当前展示已成功读取的模型，未用预设补充为已验证目录。", " Only successfully loaded models are shown. Reference entries do not count as verified models.")}</span></div> : null}
      <div className="tokenhub-output-tabs" role="tablist" aria-label={t("工作台内容", "Playground content")}><button type="button" role="tab" aria-selected={tab === "result"} className={tab === "result" ? "selected" : ""} onClick={() => setTab("result")}><Icon name="sparkles" size={14} />{t("生成结果", "Results")}</button><button type="button" role="tab" aria-selected={tab === "request"} className={tab === "request" ? "selected" : ""} onClick={() => setTab("request")}><Icon name="code" size={14} />{t("请求代码", "Request code")}</button><button type="button" role="tab" aria-selected={tab === "tasks"} className={tab === "tasks" ? "selected" : ""} onClick={() => { setTab("tasks"); if (!tasksLoaded) void loadTasks(); }}><Icon name="clock" size={14} />{t("视频任务", "Video tasks")}</button></div>
      {error ? <div className="tokenhub-error" role="alert"><Icon name="info" size={15} /><span>{messageCopy(error)}</span></div> : null}
      {tab === "request" ? <div className="playground-preview-area">
        <div className="playground-preview-meta"><span className="request-method">POST</span><code>{endpoint[mode]}</code></div>
        <div className="playground-code-panel"><div className="playground-code-toolbar"><div role="tablist" aria-label={t("tokvilo 多模态 代码格式", "tokvilo Multimodal code format")}><button type="button" role="tab" aria-selected={format === "json"} className={format === "json" ? "selected" : ""} onClick={() => setFormat("json")}>JSON</button><button type="button" role="tab" aria-selected={format === "curl"} className={format === "curl" ? "selected" : ""} onClick={() => setFormat("curl")}>cURL</button></div><button type="button" onClick={copy}><Icon name={copied ? "check" : "copy"} size={14} />{copied ? t("已复制", "Copied") : t("复制代码", "Copy code")}</button></div>{advanced && format === "json" ? <textarea className="tokenhub-json-editor" aria-label={t("tokvilo 多模态 JSON 请求", "tokvilo Multimodal JSON request")} value={jsonInput} onChange={event => setJsonInput(event.target.value)} spellCheck={false} maxLength={60000} disabled={pending} /> : <pre tabIndex={0}><code>{format === "json" ? json : curl}</code></pre>}</div>
        <p className="playground-code-note" role="status">{(copyError ? messageCopy(copyError) : "") || (advanced ? t("JSON 编辑器中的内容将作为完整请求发送。请按模型文档填写；对话暂不支持流式输出。", "The JSON editor contains the complete request. Follow the model documentation; streaming chat is not supported.") : t("此请求使用 tokvilo API 密钥，按页面价格计费。确认预留金额后发起调用。", "Use a tokvilo API key. Requests use the displayed prices and are sent after you confirm the reservation."))}</p>
        {mode === "video" ? <p className="tokenhub-parameter-help">{t("每个视频请求使用独立的 Idempotency-Key。网络中断后重试同一请求时，应复用该值；创建新任务时再换一个值。", "Use a unique Idempotency-Key for each new video request. Reuse it when retrying the same request after a connection interruption.")}</p> : null}
      </div> : tab === "tasks" ? <div className="tokenhub-task-panel">
        <div className="tokenhub-section-heading"><div><h2>{t("视频任务记录", "Video task history")}</h2><p>{t("通过 tokvilo 创建的任务", "Tasks created through tokvilo")}</p></div><button className="button button-ghost" type="button" disabled={tasksLoading} onClick={loadTasks}><Icon name="refresh" size={14} />{tasksLoading ? t("读取中…", "Loading…") : t("刷新", "Refresh")}</button></div>
        <form className="tokenhub-task-query" onSubmit={event => { event.preventDefault(); void selectTask(queryId); }}><input aria-label={t("查询视频任务 ID", "Look up video task ID")} value={queryId} onChange={event => setQueryId(event.target.value)} placeholder={t("输入 tokvilo 已记录的视频任务 ID", "Enter a video task ID recorded by tokvilo")} maxLength={200} /><button className="button button-ghost" type="submit" disabled={!queryId.trim() || refreshing || pending}>{refreshing ? t("查询中…", "Checking…") : t("查询任务", "Check task")}</button></form>
        {tasksError ? <p className="tokenhub-error" role="alert">{messageCopy(tasksError)}</p> : null}
        <div className="tokenhub-task-list">{tasks.map(task => <button key={task.id} type="button" disabled={refreshing || pending} onClick={() => selectTask(task.id)}><span className="tokenhub-task-icon"><Icon name="video" size={18} /></span><span className="tokenhub-task-label"><strong>{task.model || t("视频生成", "Video generation")}</strong><code>{task.id}</code>{task.created_at ? <small>{new Date(task.created_at).toLocaleString(isEnglish ? "en-US" : "zh-CN", { timeZone: "Asia/Shanghai", hour12: false })}</small> : null}</span><TaskBadge status={task.status} /><Icon name="arrow-up-right" size={14} /></button>)}</div>
        {tasksLoaded && !tasks.length && !tasksError ? <div className="tokenhub-list-empty"><Icon name="video" size={26} /><h3>{t("还没有视频任务", "No video tasks yet")}</h3><p>{t("创建首个任务后，记录将出现在这里。", "Your first task will appear here after creation.")}</p></div> : null}
      </div> : pending ? <div className="tokenhub-pending"><span className="tokenhub-spinner" /><h2>{t("请求正在发送", "Sending request")}</h2><p>{mode === "video" ? t("创建完成后，会自动跟进生成状态。", "Generation status will update automatically after task creation.") : t("正在等待模型返回结果。", "Waiting for the model response.")}</p></div> : result ? <div className="tokenhub-result-area">
        {resultMode === "video" ? <>
          <div className="tokenhub-section-heading"><div><h2>{videoUrl ? t("视频已就绪", "Video ready") : terminal.has(taskStatus) ? t("任务结果", "Task result") : t("视频生成任务", "Video generation task")}</h2><p>{text(taskData.model) || t("tokvilo 多模态", "tokvilo Multimodal")}</p></div><TaskBadge status={taskStatus} /></div>
          {videoUrl ? <VideoPreview key={videoUrl} src={videoUrl} poster={frameUrl || undefined} /> : <div className="tokenhub-video-wait"><Icon name={terminal.has(taskStatus) ? "info" : "video"} size={32} /><strong>{(isEnglish ? statusEnglish[taskStatus] : statusNames[taskStatus]) || t("等待上游返回任务状态", "Waiting for task status")}</strong><p>{terminal.has(taskStatus) ? text(taskData.message) || text(record(taskData.error).message) || text(taskData.error) || t("详情见下方原始响应。", "See the raw response below for details.") : t("生成时间取决于模型与排队情况，页面会自动更新。", "Generation time depends on the model and queue. This page updates automatically.")}</p></div>}
          {videoUrl ? <div className="tokenhub-result-actions"><a className="button button-primary" href={videoUrl} target="_blank" rel="noopener noreferrer"><Icon name="arrow-up-right" size={14} />{t("打开视频", "Open video")}</a>{frameUrl ? <a className="button button-ghost" href={frameUrl} target="_blank" rel="noopener noreferrer">{t("查看末帧", "View final frame")}</a> : null}<span>{t("上游结果链接通常有效 24 小时，请及时保存。", "Result links typically expire after 24 hours. Save your files promptly.")}</span></div> : null}
          {taskId ? <div className="tokenhub-current-task"><div><span>{t("任务 ID", "Task ID")}</span><code>{taskId}</code></div><button type="button" className="button button-ghost" disabled={refreshing} onClick={() => selectTask(taskId)}><Icon name="refresh" size={13} />{refreshing ? t("查询中…", "Checking…") : t("刷新状态", "Refresh status")}</button></div> : null}
          {taskId && !terminal.has(taskStatus) ? <div className="tokenhub-polling"><span><i className={polling ? "active" : ""} />{polling ? t("每 5 秒查询一次 · 最长 10 分钟", "Checks every 5 seconds · Up to 10 minutes") : pollCount >= 120 ? t("自动查询已暂停，可继续手动刷新。", "Automatic checks are paused. You can refresh manually.") : t("自动查询已暂停", "Automatic checks paused")}</span><button type="button" onClick={() => setPolling(!polling)}>{polling ? t("暂停查询", "Pause checks") : t("继续查询", "Resume checks")}</button></div> : null}
        </> : resultMode === "image" ? <><div className="tokenhub-section-heading"><div><h2>{images.length ? t("画面已生成", "Image ready") : t("图片请求结果", "Image response")}</h2><p>{t("tokvilo 多模态 Image Generation", "tokvilo Multimodal Image Generation")}</p></div><span className="record-count">{images.length}{t(" 张", " images")}</span></div><div className="tokenhub-image-grid">{images.map((item, index) => <figure key={index}><ImagePreview key={item.url || item.base64} src={item.url || `data:image/png;base64,${item.base64}`} alt={t(`生成结果 ${index + 1}`, `Generated result ${index + 1}`)} hasDirectLink={!!item.url} />{item.url ? <figcaption><a href={item.url} target="_blank" rel="noopener noreferrer">{t("打开原图 ", "Open original image ")}<Icon name="arrow-up-right" size={13} /></a></figcaption> : null}</figure>)}</div></> : <><div className="tokenhub-section-heading"><div><h2>{t("模型回复", "Model response")}</h2><p>{text(record(result).model) || t("tokvilo 多模态 Chat", "tokvilo Multimodal Chat")}</p></div><Icon name="message" size={18} /></div>{answer ? <div className="tokenhub-chat-answer">{answer}</div> : <p className="tokenhub-parameter-help" role="status">{emptyAnswerAtTokenLimit ? t("本次响应已达到输出 token 上限，尚未返回回复正文。可在完整 JSON 中提高 max_tokens 后重新请求。", "The output token limit was reached before a reply was returned. Increase max_tokens in the full JSON for a new request.") : t("请展开原始响应查看模型返回内容。", "Expand the raw response to inspect the model output.")}</p>}</>}
        <PlaygroundBillingSummary response={result} locale={locale} />
        <details className="tokenhub-raw-response"><summary>{t("原始响应 ", "Raw response ")}<Icon name="code" size={14} /></summary><pre tabIndex={0}><code>{JSON.stringify(result, null, 2)}</code></pre></details>
      </div> : <div className="playground-empty-state tokenhub-empty"><div className="playground-empty-art" aria-hidden="true"><span /><span /><span /><Icon name={modes.find(item => item.id === mode)?.icon || "video"} size={32} /></div><span className="tokenhub-empty-kicker">ONE IDEA. MANY POSSIBILITIES.</span><h2>{mode === "video" ? t("让每一个画面流动起来", "Bring every scene to life") : mode === "image" ? t("把灵感，变成画面", "Turn inspiration into images") : t("让想法继续生长", "Keep your ideas growing")}</h2><p>{t("选择模型，描述你的想法。", "Choose a model and describe your idea.")}<br />{t("通过 tokvilo 完成生成。", "Create with tokvilo.")}</p><button className="tokenhub-prompt-example" type="button" onClick={() => setPrompt(samples[mode])}><Icon name="sparkles" size={16} /><span>{samples[mode]}</span><Icon name="arrow-up-right" size={14} /></button></div>}
      <footer className="playground-workspace-footer"><span>TOKVILO API WORKSPACE</span><span>{t("按量计费 · 统一管理与调用", "Usage-based billing · One API workspace")}</span></footer>
    </section>
  </div>;
}
