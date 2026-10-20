"use client";

import { displayServiceText } from "@/lib/brand-display";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Icon } from "./Icon";
import { modelCatalog, modelCategories, providerInitials, type ModelCategory } from "@/lib/model-catalog";

const endpoints: Record<ModelCategory, string> = { image: "/v1/images/generations", video: "/v1/videos/generations", text: "/v1/chat/completions", audio: "/v1/music/generations" };
const prompts: Record<ModelCategory, string> = { image: "描述你想创建的画面、风格、光线和构图...", video: "描述场景、主体动作与镜头运动...", text: "输入消息，构建你的对话请求...", audio: "描述音乐的氛围、乐器与节奏..." };
const examples: Record<ModelCategory, string[]> = { image: ["清晨薄雾中的山间小屋，柔和自然光，电影摄影质感。", "极简风格产品摄影，银色耳机置于浅灰色石材上，细腻阴影。", "蓝白配色的未来城市，等距视角，干净的几何线条。"], video: ["航拍镜头缓缓掠过海岸线，晨光照亮波浪，电影感。", "镜头向前推进，穿过一座安静花园，树叶在微风中摇动。"], text: ["请将以下想法整理成清晰的产品介绍：一个统一管理多种 API 的开发者平台。", "帮我写一个 Python 示例，读取 JSON 文件并汇总每种类别的数量。"], audio: ["轻柔的 lo-fi 钢琴，雨声背景，适合深夜专注工作的氛围。", "温暖明亮的原声吉他旋律，轻快的节奏，没有人声。"] };

function shellQuote(value: string) { return `'${value.replaceAll("'", "'\\''")}'`; }

export function Playground({ initialModel, initialCategory, isAdmin }: { initialModel?: string; initialCategory?: string; isAdmin: boolean }) {
  const firstCategory = modelCategories.some(item => item.id === initialCategory) ? initialCategory as ModelCategory : modelCatalog.find(item => item.id === initialModel)?.category || "image";
  const [category, setCategory] = useState<ModelCategory>(firstCategory);
  const [model, setModel] = useState(initialModel || modelCatalog.find(item => item.category === firstCategory)?.id || "gpt-image-2");
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
  const [prices, setPrices] = useState<Array<{ provider: string; model: string; rates: Array<{ dimension: string; unit: string; retailMicrousd: number }> }>>([]);
  const [priceError, setPriceError] = useState("");
  const [busy, setBusy] = useState(false);
  const [quote, setQuote] = useState<{ signature: string; reservedMicrousd: number; observedAt: string } | null>(null);
  const [requestError, setRequestError] = useState("");
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [tasks, setTasks] = useState<Array<{ id: string; model: string; status: string }>>([]);
  const polls = useRef<Record<string, number>>({});
  const pendingRequest = useRef<{ signature: string; id: string } | null>(null);
  const inFlight = useRef(false);
  useEffect(() => {
    let active = true;
    fetch("/api/pricing", { cache: "no-store" }).then(response => response.json()).then(data => {
      if (!active) return;
      const found = Array.isArray(data.models) ? data.models.filter((item: { provider: string }) => item.provider === "apimart") : [];
      setPrices(found); if (!found.length) setPriceError("实时价格暂不可用，请稍后刷新。");
    }).catch(() => { if (active) setPriceError("实时价格暂不可用，请稍后刷新。"); });
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
        if (response.ok && typeof data.data?.status === "string") {
          setTasks(current => current.map(item => item.id === task.id ? { ...item, status: data.data.status } : item));
          if (["completed", "failed", "cancelled"].includes(data.data.status)) { setResult(data); setShowPreview(true); }
        } else setTasks(current => [...current]);
      } catch { if (active) setTasks(current => [...current]); }
    }, 5000);
    return () => { active = false; clearTimeout(timer); };
  }, [tasks, busy]);
  const selectedPrice = prices.find(item => item.model === model);
  const executable = (category === "image" || category === "text") && !!selectedPrice;
  const selected = modelCatalog.find(item => item.id === model);
  const detailedImage = category === "image" && model === "gpt-image-2";
  const payload = category === "text" ? { model, messages: [{ role: "user", content: prompt }], stream: false, max_tokens: 1024 } : category === "audio" ? { model, custom: false, version: "v6", prompt, instrumental } : detailedImage ? { model, prompt, n: 1, size: ratio, resolution, ...(reference.trim() ? { image_urls: [reference.trim()] } : {}) } : { model, prompt };
  const json = JSON.stringify(payload, null, 2);
  const signature = endpoints[category] + "\n" + json;
  const currentQuote = quote?.signature === signature ? quote : null;
  const curl = `curl --request POST \\\n  --url 'https://tokvilo.com/api/gateway${endpoints[category]}' \\\n  --header 'Authorization: Bearer YOUR_TOKVILO_API_KEY' \\\n  --header 'Idempotency-Key: YOUR_UNIQUE_REQUEST_ID' \\\n  --header 'Content-Type: application/json' \\\n  --data ${shellQuote(json)}`;
  function changeCategory(value: ModelCategory) { setCategory(value); setModel(modelCatalog.find(item => item.category === value)?.id || ""); setShowPreview(false); setCopied(false); setPromptExample(0); }
  async function copy() { try { await navigator.clipboard.writeText(format === "json" ? json : curl); setCopied(true); setCopyError(false); setTimeout(() => setCopied(false), 1800); } catch { setCopyError(true); } }

  async function refreshTask(id: string) {
    setBusy(true); setRequestError("");
    try {
      const response = await fetch(`/api/gateway/v1/tasks/${encodeURIComponent(id)}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message || "任务查询失败，请稍后刷新。");
      setResult(data); setShowPreview(true);
      const status = data.data?.status || data.status;
      if (typeof status === "string") setTasks(current => current.map(task => task.id === id ? { ...task, status } : task));
    } catch (cause) { setRequestError(cause instanceof Error ? cause.message : "任务查询失败。"); }
    finally { setBusy(false); }
  }
  async function prepareQuote() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true); setRequestError(""); setQuote(null);
    try {
      const response = await fetch("/api/pricing/quote", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: "apimart", mode: category === "text" ? "chat" : "image", body: payload }) });
      const data = await response.json();
      if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : data.error?.message || "报价暂不可用，请稍后重试。");
      if (data.provider !== "apimart" || data.model !== model || data.currency !== "USD" || !Number.isSafeInteger(data.reservedMicrousd) || data.reservedMicrousd < 1 || data.reservedMicrousd > 1_000_000_000_000) throw new Error("报价内容不完整，请重新获取。");
      setQuote({ signature, reservedMicrousd: data.reservedMicrousd, observedAt: typeof data.observedAt === "string" ? data.observedAt : "" });
    } catch (cause) { setRequestError(cause instanceof Error ? cause.message : "报价暂不可用，请稍后重试。"); }
    finally { setBusy(false); inFlight.current = false; }
  }
  async function run() {
    if (inFlight.current || !currentQuote) return;
    inFlight.current = true;
    setBusy(true); setRequestError(""); setResult(null); setShowPreview(true);
    if (pendingRequest.current?.signature !== signature) pendingRequest.current = { signature, id: crypto.randomUUID() };
    try {
      const response = await fetch(`/api/gateway${endpoints[category]}`, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": pendingRequest.current.id, "X-Tokvilo-Max-Reserve-Microusd": String(currentQuote.reservedMicrousd) }, body: json });
      const data = await response.json();
      if (!response.ok) {
        if (data.error?.code === "reservation_limit_exceeded") setQuote(null);
        if (response.status < 500 && response.status !== 409) pendingRequest.current = null;
        throw new Error(data.error?.message || "请求未完成，请保留当前参数后重试查询。");
      }
      setResult(data); setQuote(null); pendingRequest.current = null;
      if (Array.isArray(data.data) && data.data[0]?.task_id) setTasks(current => [{ id: data.data[0].task_id, model, status: data.data[0].status || "submitted" }, ...current.filter(task => task.id !== data.data[0].task_id)].slice(0, 50));
    } catch (cause) { setRequestError(cause instanceof Error ? cause.message : "连接中断，请保留当前参数重试查询原请求。"); }
    finally { setBusy(false); inFlight.current = false; }
  }
  const output = result && typeof result.data === "object" && result.data && !Array.isArray(result.data) ? result.data as Record<string, unknown> : result;
  const media = output?.result && typeof output.result === "object" ? output.result as { images?: Array<{ url?: string | string[] }> } : null;
  const imageUrls = (media?.images || []).flatMap(item => Array.isArray(item.url) ? item.url : item.url ? [item.url] : []).filter(value => {
    try { const url = new URL(value); return url.protocol === "https:" && url.hostname === "upload.apimart.ai"; } catch { return false; }
  });
  const choices = output && Array.isArray(output.choices) ? output.choices as Array<{ message?: { content?: string } }> : [];

  return <div className="playground-layout">
    <section className="playground-controls" aria-label="请求参数">
      <div className="playground-control-header"><span>PLAYGROUND</span><Link href="/models" aria-label="查看模型市场"><Icon name="store" size={17} /></Link></div>
      <div className="playground-category-tabs" role="tablist" aria-label="生成类型">{modelCategories.map(item => <button key={item.id} role="tab" type="button" aria-selected={category === item.id} className={category === item.id ? "selected" : ""} onClick={() => changeCategory(item.id)}><Icon name={item.icon} size={15} />{item.label}</button>)}</div>
      <div className="playground-form-fields">
        <label className="playground-field"><span>模型 <span className="field-required">*</span></span><div className="playground-model-select"><span className="playground-model-mark">{providerInitials(selected?.provider || "M")}</span><select aria-label="选择模型" value={selected?.id || "custom"} onChange={event => { setModel(event.target.value === "custom" ? "" : event.target.value); setShowPreview(false); }}>{modelCatalog.filter(item => item.category === category).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}<option value="custom">自定义模型</option></select></div></label>
        <label className="playground-field playground-model-id"><span>Model ID</span><input value={model} onChange={event => setModel(event.target.value)} placeholder="填写上游提供的模型 ID" spellCheck={false} /><small>可按上游模型列表修改</small></label>
        <label className="playground-field"><span>提示词 <span className="field-required">*</span><button type="button" aria-label="插入提示词示例" onClick={() => { setPrompt(examples[category][promptExample % examples[category].length]); setPromptExample(promptExample + 1); }}><Icon name="sparkles" size={13} />试试示例</button></span><textarea aria-label="提示词" value={prompt} onChange={event => setPrompt(event.target.value)} placeholder={prompts[category]} rows={6} maxLength={10000} /><small className="prompt-character-count">{prompt.length.toLocaleString()} / 10,000</small></label>
        {detailedImage ? <>
          <fieldset className="playground-field"><legend>分辨率</legend><div className="playground-option-row">{["1k", "2k", "4k"].map(value => <button key={value} type="button" className={resolution === value ? "selected" : ""} aria-pressed={resolution === value} onClick={() => setResolution(value)}>{value.toUpperCase()}</button>)}</div></fieldset>
          <label className="playground-field"><span>图片比例</span><select value={ratio} onChange={event => setRatio(event.target.value)} aria-label="图片比例">{["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "21:9", "auto"].map(value => <option key={value} value={value}>{value === "auto" ? "自动" : value}</option>)}</select></label>
          <div className="playground-field"><span>生成数量</span><div className="playground-fixed-value">1 张 <span>单次请求</span></div></div>
          <label className="playground-field"><span>参考图 <small>选填</small></span><div className="playground-reference"><Icon name="image" size={20} /><input type="url" value={reference} onChange={event => setReference(event.target.value)} placeholder="粘贴公开图片 URL" aria-label="参考图片 URL" /></div></label>
        </> : null}
        {category === "audio" ? <label className="playground-check"><input type="checkbox" checked={instrumental} onChange={event => setInstrumental(event.target.checked)} />纯音乐，无人声</label> : null}
        {category === "video" || (category === "image" && !detailedImage) || category === "text" ? <div className="playground-parameter-note"><Icon name="info" size={15} /><p>这里提供基础请求。其他选项请按所选模型的参数文档补充。</p></div> : null}
      </div>
      <div className="playground-run-area">{currentQuote ? <div role="status"><strong>本次预留 ${(currentQuote.reservedMicrousd / 1_000_000).toFixed(6)}</strong><p>完成后按实际用量结算，退回预留差额。修改参数后需重新报价。</p></div> : null}<button className="playground-run" type="button" disabled={busy || !executable || !model.trim() || !prompt.trim()} onClick={currentQuote ? run : prepareQuote}><Icon name="sparkles" size={17} />{busy ? "处理中…" : currentQuote ? `确认预留 $${(currentQuote.reservedMicrousd / 1_000_000).toFixed(6)} 并生成` : "获取准确报价"}<Icon name="arrow-right" size={17} /></button>{currentQuote ? <button type="button" disabled={busy} onClick={prepareQuote}>刷新报价</button> : null}<button type="button" onClick={() => { setShowPreview(true); setCopied(false); }}>预览请求</button><span><i />上游价格 × 1.20 · 从钱包余额扣费</span></div>
    </section>
    <section className="playground-workspace" aria-label="请求工作台">
      <header className="playground-workspace-header"><div><h1>请求工作台</h1><span>从一个想法开始</span></div><a href="/dashboard/docs?provider=gateway" target="_blank" rel="noreferrer"><Icon name="book" size={15} />模型文档<Icon name="arrow-up-right" size={14} /></a></header>
      <div className="playground-notice"><span className="playground-notice-dot" /><p>{priceError || (executable ? "已开通会员生成。提交时预留余额，完成后按实际用量结算。" : "此模型的计费尚未开通，可以预览参数或选择其他模型。")}</p>{isAdmin ? <Link href="/admin">管理上游 <Icon name="arrow-right" size={13} /></Link> : <Link href="/dashboard/docs">查看已开通 API <Icon name="arrow-right" size={13} /></Link>}</div>
      {selectedPrice ? <div className="playground-notice"><p>{selectedPrice.rates.map(rate => `${rate.dimension}: $${(rate.retailMicrousd / 1_000_000).toLocaleString("en-US", { maximumFractionDigits: 6 })}/${rate.unit === "image" ? "张" : "百万 tokens"}`).join(" · ")}</p><Link href="/dashboard/wallet">钱包与充值</Link></div> : null}
      {requestError ? <div className="playground-notice" role="alert"><p>{displayServiceText(requestError)}</p></div> : null}
      {result ? <div className="playground-preview-area"><h2>生成结果</h2>{imageUrls.map((url, index) => <figure key={url}>
        {/* Official task results use upload.apimart.ai; preserve their signed URL without optimizing. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={url} alt={`生成图片 ${index + 1}`} style={{ maxWidth: "100%", maxHeight: 560, objectFit: "contain" }} referrerPolicy="no-referrer" />
        <figcaption><a href={url} target="_blank" rel="noopener noreferrer">打开原图</a></figcaption>
      </figure>)}{choices[0]?.message?.content ? <pre style={{ whiteSpace: "pre-wrap" }}>{choices[0].message.content}</pre> : null}<pre style={{ overflowX: "auto", maxHeight: 360 }}><code>{JSON.stringify(result, null, 2)}</code></pre></div> : null}
      {tasks.length ? <div className="playground-preview-area"><h2>最近图片任务</h2>{tasks.map(task => <div className="playground-request-summary" key={task.id}><div><span>{task.model}</span><code>{task.id}</code></div><div><span>状态</span><strong>{task.status}</strong></div><button type="button" disabled={busy} onClick={() => refreshTask(task.id)}>查询结果</button></div>)}</div> : null}
      {showPreview ? <div className="playground-preview-area">
        <div className="playground-preview-meta"><span className="request-method">POST</span><code>/api/gateway{endpoints[category]}</code><span>tokvilo 请求示例</span></div>
        <div className="playground-code-panel"><div className="playground-code-toolbar"><div role="tablist" aria-label="代码格式"><button role="tab" aria-selected={format === "json"} type="button" className={format === "json" ? "selected" : ""} onClick={() => setFormat("json")}>JSON</button><button role="tab" aria-selected={format === "curl"} type="button" className={format === "curl" ? "selected" : ""} onClick={() => setFormat("curl")}>cURL</button></div><button type="button" onClick={copy}><Icon name={copied ? "check" : "copy"} size={14} />{copied ? "已复制" : "复制代码"}</button></div><pre tabIndex={0}><code>{format === "json" ? json : curl}</code></pre></div>
        <div className="playground-code-note" role="status">{copyError ? "复制未完成，请选择上方代码后手动复制。" : "使用你的 tokvilo API Key；每次新请求使用唯一编号，重试保留同一 Idempotency-Key。"}</div>
        <div className="playground-request-summary"><div><span>模型</span><strong>{selected?.name || model}</strong></div><div><span>能力</span><strong>{modelCategories.find(item => item.id === category)?.label}</strong></div><div><span>执行状态</span><strong>{busy ? "处理中" : result ? "已收到响应" : "尚未发送"}</strong></div></div>
      </div> : <div className="playground-empty-state"><div className="playground-empty-art" aria-hidden="true"><span /><span /><span /><Icon name={modelCategories.find(item => item.id === category)?.icon || "image"} size={32} /></div><h2>让想法有一个起点</h2><p>选择模型，填写提示词。<br />使用钱包余额生成内容，或预览你的 API 请求。</p><div className="playground-suggestions">{examples[category].slice(0, 2).map((example, i) => <button type="button" key={example} onClick={() => setPrompt(example)}><Icon name={i ? "sparkles" : "image"} size={15} /><span>{example}</span><Icon name="arrow-up-right" size={13} /></button>)}</div></div>}
      <footer className="playground-workspace-footer"><span>tokvilo PLAYGROUND</span><span>提交后由所选模型处理提示词</span></footer>
    </section>
  </div>;
}
