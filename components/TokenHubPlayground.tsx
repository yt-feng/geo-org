"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Icon } from "./Icon";

type Mode = "video" | "image" | "chat";
type Json = Record<string, unknown>;
type Model = { id: string; name?: string; provider: string; category: string[]; sources?: string[]; modelType?: string; accountAccess?: string; integrationStatus?: string; limitations?: string[] };
type Catalog = { complete: boolean; observedAt: string; sources: Array<{ source: string; status: string; modelCount: number }>; warnings: string[] };
type Task = { id: string; model: string; status: string; created_at?: string; updated_at?: string };
type Provider = { configured: boolean; verifiedAt: string | null };
const endpoint: Record<Mode, string> = { video: "/api/tokenhub/v3/contents/generations/tasks", image: "/api/tokenhub/v3/images/generations", chat: "/api/tokenhub/v1/chat/completions" };
const modes: Array<{ id: Mode; name: string; icon: string }> = [{ id: "video", name: "视频", icon: "video" }, { id: "image", name: "图像", icon: "image" }, { id: "chat", name: "对话", icon: "message" }];
const defaults: Record<Mode, string> = { video: "dreamina-seedance-2-0-260128", image: "dola-seedream-5-0-pro-260628", chat: "" };
const examples: Record<Mode, string> = { video: "镜头缓缓掠过清晨的海岸，柔和的金色阳光照亮浪花，海风轻拂，电影摄影质感。", image: "极简产品摄影：银色耳机置于浅灰色石材上，柔和侧光，干净构图，细腻阴影。", chat: "用三句话介绍统一模型 API 如何帮助开发者快速实现创意。" };
const statusNames: Record<string, string> = { submitted: "已提交", queued: "排队中", pending: "等待中", running: "生成中", processing: "生成中", succeeded: "已完成", completed: "已完成", success: "已完成", failed: "失败", cancelled: "已取消", canceled: "已取消", expired: "已过期", deleted: "已删除", cancelled_or_deleted: "已取消或删除" };
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

function TaskBadge({ status }: { status: string }) { return <span className={`tokenhub-task-status status-${status.replace(/[^a-z]/gi, "")}`}><i />{statusNames[status] || status || "状态待查询"}</span>; }

function MediaPreviewError({ kind, hasDirectLink }: { kind: "image" | "video"; hasDirectLink: boolean }) {
  const name = kind === "image" ? "图片" : "视频";
  return <div className="tokenhub-media-error" role="status"><Icon name={kind} size={28} /><strong>{name}预览加载失败</strong><p>当前浏览器未能加载预览。{hasDirectLink ? "可尝试通过下方直链打开原始文件。" : "请展开原始响应查看返回内容。"}</p></div>;
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
  const [mode, setMode] = useState<Mode>("video");
  const [provider, setProvider] = useState<Provider | null>(null);
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

  useEffect(() => {
    const controller = new AbortController();
    const requested = selectionFromSearch(window.location.search), requestedModel = requested.model, requestedMode = requested.mode;
    const hasRequestedModel = !!requestedModel;
    request("/api/tokenhub/v1/models", { signal: controller.signal }).then(value => { if (!controller.signal.aborted) {
      const body = record(value), info = record(body.catalog);
      const discovered = parseModels(body.data); setModels(discovered); setProvider({ configured: true } as Provider);
      if (hasRequestedModel) { setModel(requestedModel); const selected = discovered.find(item => item.id === requestedModel); const selectedMode = requestedMode || (selected ? modes.find(item => modelMatches(selected, item.id))?.id : undefined); if (selectedMode) setMode(selectedMode); }
      else if (requestedMode) { setMode(requestedMode); setModel(discovered.find(item => modelMatches(item, requestedMode))?.id || defaults[requestedMode]); }
      setCatalog({ complete: info.complete === true, observedAt: text(info.observedAt), sources: Array.isArray(info.sources) ? info.sources.map(record).map(item => ({ source: text(item.source), status: text(item.status), modelCount: typeof item.modelCount === "number" ? item.modelCount : 0 })) : [], warnings: Array.isArray(info.warnings) ? info.warnings.filter((warning): warning is string => typeof warning === "string") : [] });
    } }).catch(error => { if (!controller.signal.aborted) { setModelError(error instanceof Error ? error.message : "模型目录读取失败。"); if (hasRequestedModel) setModel(requestedModel); if (requestedMode) setMode(requestedMode); } }).finally(() => { if (!controller.signal.aborted) setModelsLoading(false); });
    return () => controller.abort();
  }, []);

  const options = useMemo(() => models.filter(item => modelMatches(item, mode)), [models, mode]);
  const unknownModels = models.filter(item => !modes.some(mode => modelMatches(item, mode.id)));
  const selectedModel = models.find(item => item.id === model);
  const selectedLimitations = (selectedModel?.limitations || []).map(item => limitationLabels[item]).filter(Boolean);
  const generated = useMemo(() => {
    if (mode === "chat") return { model, messages: [{ role: "user", content: prompt }], stream: false, max_tokens: 1024 };
    if (mode === "image") return { model, prompt, size: imageSize, watermark: false, response_format: "url" };
    return { model, content: [{ type: "text", text: prompt }, ...(reference.trim() ? [{ type: "image_url", image_url: { url: reference.trim() }, role: referenceRole }] : [])], resolution, ratio, duration: Number(duration), generate_audio: generateAudio, watermark: false };
  }, [mode, model, prompt, imageSize, reference, referenceRole, resolution, ratio, duration, generateAudio]);
  const json = advanced ? jsonInput : JSON.stringify(generated, null, 2);
  const currentQuote = quote?.body === json && quote.mode === mode ? quote : null;
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
    try {
      const body: unknown = JSON.parse(json);
      const value = record(await request("/api/pricing/quote", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider: "tokenhub", mode, body }) }));
      if (!Number.isSafeInteger(value.reservedMicrousd) || Number(value.reservedMicrousd) <= 0) throw new Error("暂时无法取得该请求的预留金额。");
      setQuote({ body: json, mode, reservedMicrousd: Number(value.reservedMicrousd) });
    } catch (error) { setError(error instanceof SyntaxError ? "JSON 格式有误，请检查后重新报价。" : error instanceof Error ? error.message : "报价暂不可用。"); }
    finally { setQuoting(false); }
  }

  async function submit() {
    if (inFlight.current || !provider?.configured) return;
    if (!currentQuote) { await estimate(); return; }
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
    finally { inFlight.current = false; setPending(false); }
  }

  async function copy() {
    try { await navigator.clipboard.writeText(format === "json" ? json : curl); setCopied(true); setCopyError(""); setTimeout(() => setCopied(false), 1800); }
    catch { setCopyError("复制未完成，请选中代码手动复制。"); }
  }

  return <div className="playground-layout tokenhub-workbench">
    <section className="playground-controls" aria-label="TokenHub 请求参数">
      <div className="playground-control-header"><span>TOKENHUB</span><Link href={isAdmin ? "/admin" : "/dashboard/wallet"} aria-label={isAdmin ? "管理 TokenHub 连接" : "余额与充值"}><Icon name="settings" size={17} /></Link></div>
      <div className="playground-category-tabs" role="tablist" aria-label="TokenHub 模型类型">{modes.map(item => <button key={item.id} type="button" role="tab" aria-selected={mode === item.id} className={mode === item.id ? "selected" : ""} onClick={() => changeMode(item.id)} disabled={pending}><Icon name={item.icon} size={15} />{item.name}{modelsLoading ? "" : ` ${models.filter(model => modelMatches(model, item.id)).length}`}</button>)}</div>
      <div className="playground-form-fields">
        <p className="tokenhub-parameter-help" role="status">{modelsLoading ? "正在合并模型与价格目录…" : modelError ? "目录读取未完成，仍可填写完整模型 ID。" : `${catalog?.complete ? "当前完整目录" : "当前部分目录"} ${models.length} 个模型 · ${models.filter(item => modelMatches(item, "chat")).length} 个对话 / ${models.filter(item => modelMatches(item, "image")).length} 个图像 / ${models.filter(item => modelMatches(item, "video")).length} 个视频${unknownModels.length ? ` / ${unknownModels.length} 个待分类` : ""}`}</p>
        <label className="playground-field"><span>模型 <span className="field-required">*</span></span><select aria-label="选择 TokenHub 模型" value={options.some(item => item.id === model) ? model : "custom"} onChange={event => chooseModel(event.target.value === "custom" ? "" : event.target.value)} disabled={advanced || pending}><option value="custom">填写完整模型 ID</option>{options.map(item => <option key={item.id} value={item.id}>{modelLabel(item)} · {item.id}</option>)}</select><small>{modelsLoading ? "正在读取当前类型的全部模型…" : `当前类型 ${options.length} 个模型 · 请求通过 tokvilo API 发送`}</small></label>
        <label className="playground-field playground-model-id"><span>MODEL ID</span><input aria-label="TokenHub 模型 ID" value={model} onChange={event => chooseModel(event.target.value)} spellCheck={false} placeholder="填写上游模型 ID" disabled={advanced || pending} /><small>{selectedModel?.accountAccess === "unverified_public_catalog" ? "已接入转发；该模型来自公开价格目录，账户调用权限待实际请求确认。" : selectedModel ? "使用目录中的完整版本 ID，不替换为其他模型。" : "自定义模型 ID；请选择对应接口类型，也可编辑完整 JSON。"}</small></label>
        <label className="playground-field"><span>提示词<button type="button" disabled={advanced || pending} onClick={() => setPrompt(examples[mode])}><Icon name="sparkles" size={13} />试试示例</button></span><textarea aria-label="TokenHub 提示词" rows={5} maxLength={10000} value={prompt} onChange={event => setPrompt(event.target.value)} placeholder={mode === "video" ? "描述场景、主体动作和镜头运动…" : mode === "image" ? "描述画面、构图、光线和风格…" : "输入你的消息…"} disabled={advanced || pending} /><small>{prompt.length.toLocaleString()} / 10,000</small></label>
        {mode === "video" ? <>
          <div className="tokenhub-field-pair"><label className="playground-field"><span>时长</span><select aria-label="视频时长" value={duration} onChange={event => setDuration(event.target.value)} disabled={advanced || pending}><option value="-1">模型自动</option>{Array.from({ length: 12 }, (_, index) => index + 4).map(value => <option key={value} value={value}>{value} 秒</option>)}</select></label><label className="playground-field"><span>分辨率</span><select aria-label="视频分辨率" value={resolution} onChange={event => setResolution(event.target.value)} disabled={advanced || pending}>{["480p", "720p", "1080p"].filter(value => value !== "1080p" || !/seedance.*fast/i.test(model)).map(value => <option key={value} value={value}>{value}</option>)}</select></label></div>
          <label className="playground-field"><span>画面比例</span><select aria-label="视频比例" value={ratio} onChange={event => setRatio(event.target.value)} disabled={advanced || pending}>{["16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "adaptive"].map(value => <option key={value} value={value}>{value === "adaptive" ? "自动适配" : value}</option>)}</select></label>
          <label className="playground-field"><span>参考图片 <small>选填</small></span><input aria-label="TokenHub 参考图片 URL" type="url" value={reference} onChange={event => setReference(event.target.value)} placeholder="https://…" disabled={advanced || pending} />{reference.trim() ? <select aria-label="参考图片用途" value={referenceRole} onChange={event => setReferenceRole(event.target.value)} disabled={advanced || pending}><option value="first_frame">首帧画面</option><option value="reference_image">参考图像</option></select> : null}</label>
          <label className="playground-check"><input type="checkbox" checked={generateAudio} onChange={event => setGenerateAudio(event.target.checked)} disabled={advanced || pending} />同时生成音频</label>
        </> : mode === "image" ? <label className="playground-field"><span>图片尺寸</span><select aria-label="TokenHub 图片尺寸" value={imageSize} onChange={event => setImageSize(event.target.value)} disabled={advanced || pending}>{["1K", "2K", "4K"].map(value => <option key={value} value={value}>{value}</option>)}</select></label> : null}
        <button className={`tokenhub-advanced-toggle${advanced ? " selected" : ""}`} type="button" onClick={toggleAdvanced} aria-pressed={advanced} disabled={pending}><Icon name="code" size={14} />{advanced ? "返回参数表单" : "编辑完整 JSON"}<Icon name="arrow-right" size={14} /></button>
        <p className="tokenhub-parameter-help">各模型支持的尺寸、时长与素材类型不同。多图、参考视频及其他参数可在 JSON 中设置。{selectedLimitations.length ? ` ${selectedLimitations.join("；")}。` : ""}</p>{unknownModels.length ? <details className="tokenhub-parameter-help"><summary>{unknownModels.length} 个模型尚未识别接口类型</summary><p>{unknownModels.map(item => item.id).join("、")}。目录记录已保留，可根据模型文档选择接口并填写完整 ID。</p></details> : null}
      </div>
      <div className="playground-run-area">{currentQuote ? <p className="tokenhub-parameter-help" role="status">本次最多预留 <strong>${(currentQuote.reservedMicrousd / 1_000_000).toFixed(6)}</strong>。源头价格 × 1.20，完成后按实际用量结算并退还差额。<Link href="/dashboard/wallet">查看余额</Link></p> : null}<button className="playground-run" type="button" disabled={pending || quoting || !provider?.configured || (!advanced && (!model.trim() || !prompt.trim()))} onClick={submit}><Icon name={pending || quoting ? "clock" : "bolt"} size={16} />{pending ? "正在提交…" : quoting ? "正在报价…" : currentQuote ? "确认并生成" : "查看预留金额"}<Icon name="arrow-right" size={16} /></button><span><i />从 tokvilo 账户余额结算</span></div>
    </section>
    <section className="playground-workspace" aria-label="TokenHub 工作台">
      <header className="playground-workspace-header"><div><h1>全部模型，一个入口。</h1><span>TIANSHU TOKENHUB · tokvilo API</span></div><Link href="/dashboard/docs?provider=tokenhub"><Icon name="book" size={15} />接口文档<Icon name="arrow-up-right" size={14} /></Link></header>
      <div className="playground-notice"><span className="playground-notice-dot" /><p>{provider === null ? "正在读取服务配置…" : provider.configured ? "选择模型后先查看预留金额，再确认生成。" : "服务尚未就绪，请稍后再试。"}</p><Link href={isAdmin ? "/admin" : "/dashboard/wallet"}>{isAdmin ? "管理连接" : "余额与充值"} <Icon name="arrow-right" size={13} /></Link></div>
      {modelError || catalog?.warnings.length ? <div className="tokenhub-error" role="status"><Icon name="info" size={15} /><span>{modelError || catalog?.warnings.join("；")} 当前展示已成功读取的模型，未用预设补充为已验证目录。</span></div> : null}
      <div className="tokenhub-output-tabs" role="tablist" aria-label="工作台内容"><button type="button" role="tab" aria-selected={tab === "result"} className={tab === "result" ? "selected" : ""} onClick={() => setTab("result")}><Icon name="sparkles" size={14} />生成结果</button><button type="button" role="tab" aria-selected={tab === "request"} className={tab === "request" ? "selected" : ""} onClick={() => setTab("request")}><Icon name="code" size={14} />请求代码</button><button type="button" role="tab" aria-selected={tab === "tasks"} className={tab === "tasks" ? "selected" : ""} onClick={() => { setTab("tasks"); if (!tasksLoaded) void loadTasks(); }}><Icon name="clock" size={14} />视频任务</button></div>
      {error ? <div className="tokenhub-error" role="alert"><Icon name="info" size={15} /><span>{error}</span></div> : null}
      {tab === "request" ? <div className="playground-preview-area">
        <div className="playground-preview-meta"><span className="request-method">POST</span><code>{endpoint[mode]}</code></div>
        <div className="playground-code-panel"><div className="playground-code-toolbar"><div role="tablist" aria-label="TokenHub 代码格式"><button type="button" role="tab" aria-selected={format === "json"} className={format === "json" ? "selected" : ""} onClick={() => setFormat("json")}>JSON</button><button type="button" role="tab" aria-selected={format === "curl"} className={format === "curl" ? "selected" : ""} onClick={() => setFormat("curl")}>cURL</button></div><button type="button" onClick={copy}><Icon name={copied ? "check" : "copy"} size={14} />{copied ? "已复制" : "复制代码"}</button></div>{advanced && format === "json" ? <textarea className="tokenhub-json-editor" aria-label="TokenHub JSON 请求" value={jsonInput} onChange={event => setJsonInput(event.target.value)} spellCheck={false} maxLength={60000} disabled={pending} /> : <pre tabIndex={0}><code>{format === "json" ? json : curl}</code></pre>}</div>
        <p className="playground-code-note" role="status">{copyError || (advanced ? "JSON 编辑器中的内容将作为完整请求发送。请按模型文档填写；对话暂不支持流式输出。" : "此请求使用 tokvilo API 密钥，按源头价格加价 20% 计费。点击运行发起调用。")}</p>
        {mode === "video" ? <p className="tokenhub-parameter-help">每个视频请求使用独立的 Idempotency-Key。网络中断后重试同一请求时，应复用该值；创建新任务时再换一个值。</p> : null}
      </div> : tab === "tasks" ? <div className="tokenhub-task-panel">
        <div className="tokenhub-section-heading"><div><h2>视频任务记录</h2><p>通过 tokvilo 创建的任务</p></div><button className="button button-ghost" type="button" disabled={tasksLoading} onClick={loadTasks}><Icon name="refresh" size={14} />{tasksLoading ? "读取中…" : "刷新"}</button></div>
        <form className="tokenhub-task-query" onSubmit={event => { event.preventDefault(); void selectTask(queryId); }}><input aria-label="查询视频任务 ID" value={queryId} onChange={event => setQueryId(event.target.value)} placeholder="输入 tokvilo 已记录的视频任务 ID" maxLength={200} /><button className="button button-ghost" type="submit" disabled={!queryId.trim() || refreshing || pending}>{refreshing ? "查询中…" : "查询任务"}</button></form>
        {tasksError ? <p className="tokenhub-error" role="alert">{tasksError}</p> : null}
        <div className="tokenhub-task-list">{tasks.map(task => <button key={task.id} type="button" disabled={refreshing || pending} onClick={() => selectTask(task.id)}><span className="tokenhub-task-icon"><Icon name="video" size={18} /></span><span className="tokenhub-task-label"><strong>{task.model || "视频生成"}</strong><code>{task.id}</code>{task.created_at ? <small>{new Date(task.created_at).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })}</small> : null}</span><TaskBadge status={task.status} /><Icon name="arrow-up-right" size={14} /></button>)}</div>
        {tasksLoaded && !tasks.length && !tasksError ? <div className="tokenhub-list-empty"><Icon name="video" size={26} /><h3>还没有视频任务</h3><p>创建首个任务后，记录将出现在这里。</p></div> : null}
      </div> : pending ? <div className="tokenhub-pending"><span className="tokenhub-spinner" /><h2>请求正在发送</h2><p>{mode === "video" ? "创建完成后，会自动跟进生成状态。" : "正在等待模型返回结果。"}</p></div> : result ? <div className="tokenhub-result-area">
        {resultMode === "video" ? <>
          <div className="tokenhub-section-heading"><div><h2>{videoUrl ? "视频已就绪" : terminal.has(taskStatus) ? "任务结果" : "视频生成任务"}</h2><p>{text(taskData.model) || "TokenHub"}</p></div><TaskBadge status={taskStatus} /></div>
          {videoUrl ? <VideoPreview key={videoUrl} src={videoUrl} poster={frameUrl || undefined} /> : <div className="tokenhub-video-wait"><Icon name={terminal.has(taskStatus) ? "info" : "video"} size={32} /><strong>{statusNames[taskStatus] || "等待上游返回任务状态"}</strong><p>{terminal.has(taskStatus) ? text(taskData.message) || text(record(taskData.error).message) || text(taskData.error) || "详情见下方原始响应。" : "生成时间取决于模型与排队情况，页面会自动更新。"}</p></div>}
          {videoUrl ? <div className="tokenhub-result-actions"><a className="button button-primary" href={videoUrl} target="_blank" rel="noopener noreferrer"><Icon name="arrow-up-right" size={14} />打开视频</a>{frameUrl ? <a className="button button-ghost" href={frameUrl} target="_blank" rel="noopener noreferrer">查看末帧</a> : null}<span>上游结果链接通常有效 24 小时，请及时保存。</span></div> : null}
          {taskId ? <div className="tokenhub-current-task"><div><span>任务 ID</span><code>{taskId}</code></div><button type="button" className="button button-ghost" disabled={refreshing} onClick={() => selectTask(taskId)}><Icon name="refresh" size={13} />{refreshing ? "查询中…" : "刷新状态"}</button></div> : null}
          {taskId && !terminal.has(taskStatus) ? <div className="tokenhub-polling"><span><i className={polling ? "active" : ""} />{polling ? "每 5 秒查询一次 · 最长 10 分钟" : pollCount >= 120 ? "自动查询已暂停，可继续手动刷新。" : "自动查询已暂停"}</span><button type="button" onClick={() => setPolling(!polling)}>{polling ? "暂停查询" : "继续查询"}</button></div> : null}
        </> : resultMode === "image" ? <><div className="tokenhub-section-heading"><div><h2>{images.length ? "画面已生成" : "图片请求结果"}</h2><p>TokenHub Image Generation</p></div><span className="record-count">{images.length} 张</span></div><div className="tokenhub-image-grid">{images.map((item, index) => <figure key={index}><ImagePreview key={item.url || item.base64} src={item.url || `data:image/png;base64,${item.base64}`} alt={`生成结果 ${index + 1}`} hasDirectLink={!!item.url} />{item.url ? <figcaption><a href={item.url} target="_blank" rel="noopener noreferrer">打开原图 <Icon name="arrow-up-right" size={13} /></a></figcaption> : null}</figure>)}</div></> : <><div className="tokenhub-section-heading"><div><h2>模型回复</h2><p>{text(record(result).model) || "TokenHub Chat"}</p></div><Icon name="message" size={18} /></div>{answer ? <div className="tokenhub-chat-answer">{answer}</div> : <p className="tokenhub-parameter-help" role="status">{emptyAnswerAtTokenLimit ? "本次响应已达到输出 token 上限，尚未返回回复正文。可在完整 JSON 中提高 max_tokens 后重新请求。" : "请展开原始响应查看模型返回内容。"}</p>}</>}
        <details className="tokenhub-raw-response"><summary>原始响应 <Icon name="code" size={14} /></summary><pre tabIndex={0}><code>{JSON.stringify(result, null, 2)}</code></pre></details>
      </div> : <div className="playground-empty-state tokenhub-empty"><div className="playground-empty-art" aria-hidden="true"><span /><span /><span /><Icon name={modes.find(item => item.id === mode)?.icon || "video"} size={32} /></div><span className="tokenhub-empty-kicker">ONE IDEA. MANY POSSIBILITIES.</span><h2>{mode === "video" ? "让每一个画面流动起来" : mode === "image" ? "把灵感，变成画面" : "让想法继续生长"}</h2><p>选择模型，描述你的想法。<br />由 tokvilo 连接 TokenHub，完成真实生成。</p><button className="tokenhub-prompt-example" type="button" onClick={() => setPrompt(examples[mode])}><Icon name="sparkles" size={16} /><span>{examples[mode]}</span><Icon name="arrow-up-right" size={14} /></button></div>}
      <footer className="playground-workspace-footer"><span>tokvilo × TOKENHUB</span><span>按量计费 · 统一管理与调用</span></footer>
    </section>
  </div>;
}
