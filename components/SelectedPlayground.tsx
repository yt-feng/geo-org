"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { PriceTable } from "./PriceTable";

type SelectedModel = { provider: string; model: string; name: string; kind: "chat" | "image"; billingReady: boolean };
type Quote = { signature: string; reservedMicrousd: number };
type RecentRequest = { id: string; model: string; state: string; created_at: string };
const money = (amount: number) => `$${(amount / 1_000_000).toFixed(6)}`;
const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
const requestState = (state: string) => ({ completed: "已完成", failed: "未完成", pending: "处理中", unknown: "等待核对" })[state] || "等待核对";
async function fetchRecentRequests(): Promise<RecentRequest[]> {
  const response = await fetch("/api/selected/v1/requests", { method: "GET", cache: "no-store" });
  const data = await response.json();
  if (!response.ok || !Array.isArray(data.data)) throw Error("最近请求暂时无法加载，请刷新记录。");
  return data.data.filter((item: RecentRequest) => item && typeof item.id === "string" && /^[A-Za-z0-9_-]{8,128}$/.test(item.id) && typeof item.model === "string")
    .slice(0, 50).map((item: RecentRequest) => ({ id: item.id, model: item.model.slice(0, 200), state: item.state, created_at: typeof item.created_at === "string" ? item.created_at : "" }));
}

export function SelectedPlayground({ initialModel }: { initialModel?: string }) {
  const [models, setModels] = useState<SelectedModel[]>([]);
  const [model, setModel] = useState(initialModel || "");
  const [prompt, setPrompt] = useState("");
  const [maximum, setMaximum] = useState(1024);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [requestId, setRequestId] = useState("");
  const [recentRequests, setRecentRequests] = useState<RecentRequest[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState("");
  const pending = useRef<{ signature: string; id: string } | null>(null);
  const inFlight = useRef(false);
  useEffect(() => {
    let active = true;
    fetch("/api/pricing", { cache: "no-store" }).then(async response => {
      const data = await response.json();
      if (!response.ok || !Array.isArray(data.models)) throw Error();
      const entries = data.models.filter((item: SelectedModel) => item.provider === "selected");
      if (!active) return;
      setModels(entries);
      setModel(current => current || entries.find((item: SelectedModel) => item.billingReady)?.model || entries[0]?.model || "");
      if (!entries.length) setError("tokvilo 精选价格暂不可用，请稍后刷新。");
    }).catch(() => { if (active) setError("tokvilo 精选价格暂不可用，请稍后刷新。"); })
      .finally(() => { if (active) setLoading(false); });
    fetchRecentRequests().then(rows => { if (active) setRecentRequests(rows); })
      .catch(cause => { if (active) setHistoryError(cause instanceof Error ? cause.message : "最近请求暂时无法加载。"); })
      .finally(() => { if (active) setHistoryLoading(false); });
    return () => { active = false; };
  }, []);
  const selected = models.find(item => item.model === model);
  const kind = selected?.kind || "chat";
  const endpoint = kind === "image" ? "/api/selected/v1/images/generations" : "/api/selected/v1/chat/completions";
  const body = kind === "image" ? { model, prompt, size: "1024x1024", n: 1 }
    : { model, messages: [{ role: "user", content: prompt }], stream: false, max_tokens: maximum };
  const json = JSON.stringify(body, null, 2), signature = endpoint + "\n" + json;
  const currentQuote = quote?.signature === signature ? quote : null;
  const executable = selected?.billingReady === true && !!prompt.trim();
  const curl = `curl --request POST \\\n  --url 'https://tokvilo.com${endpoint}' \\\n  --header 'Authorization: Bearer YOUR_TOKVILO_API_KEY' \\\n  --header 'Idempotency-Key: YOUR_UNIQUE_REQUEST_ID' \\\n  --header 'Content-Type: application/json' \\\n  --data ${shellQuote(json)}`;

  async function prepareQuote() {
    if (inFlight.current || !executable) return;
    inFlight.current = true; setBusy(true); setError(""); setQuote(null);
    try {
      const response = await fetch("/api/pricing/quote", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: "selected", mode: kind, body }) });
      const data = await response.json();
      if (!response.ok) throw Error(typeof data.error === "string" ? data.error : data.error?.message || "报价暂不可用。");
      if (data.provider !== "selected" || data.model !== model || data.mode !== kind || data.currency !== "USD" || !Number.isSafeInteger(data.reservedMicrousd) || data.reservedMicrousd < 1 || data.reservedMicrousd > 1_000_000_000_000) throw Error("报价内容不完整，请重新获取。");
      setQuote({ signature, reservedMicrousd: data.reservedMicrousd });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "报价暂不可用。"); }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function generate() {
    if (inFlight.current || !currentQuote || !executable) return;
    inFlight.current = true; setBusy(true); setError(""); setResult(null);
    if (pending.current?.signature !== signature) pending.current = { signature, id: crypto.randomUUID() };
    setRequestId(pending.current.id);
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": pending.current.id, "X-Tokvilo-Max-Reserve-Microusd": String(currentQuote.reservedMicrousd) }, body: json });
      const data = await response.json();
      setResult(data);
      if (!response.ok) {
        if (data.error?.code === "reservation_limit_exceeded") setQuote(null);
        throw Error(typeof data.error === "string" ? data.error : data.error?.message || "请求尚未完成，请保留原参数重试。");
      }
      setQuote(null);
      if (["settled", "refunded"].includes(data.tokvilo_billing?.status)) pending.current = null;
    } catch (cause) { setError(cause instanceof Error ? cause.message : "连接中断，原请求编号已保留，请查询此请求。"); }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function queryRequest(id: string) {
    if (inFlight.current || !/^[A-Za-z0-9_-]{8,128}$/.test(id)) return;
    inFlight.current = true; setBusy(true); setError(""); setRequestId(id); setResult(null);
    try {
      const response = await fetch(`/api/selected/v1/requests/${encodeURIComponent(id)}`, { method: "GET", cache: "no-store" });
      const data = await response.json();
      setResult(data);
      if (pending.current?.id === id && ["settled", "refunded"].includes(data.tokvilo_billing?.status)) { pending.current = null; setQuote(null); }
      if (!response.ok) throw Error(typeof data.error === "string" ? data.error : data.error?.message || "此请求结果尚未确认，请稍后查询。");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "查询暂时失败，原请求编号已保留，请稍后再查。"); }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function refreshRecentRequests() {
    setHistoryLoading(true); setHistoryError("");
    try { setRecentRequests(await fetchRecentRequests()); }
    catch (cause) { setHistoryError(cause instanceof Error ? cause.message : "最近请求暂时无法加载。"); }
    finally { setHistoryLoading(false); }
  }
  const output = result && result.data && !Array.isArray(result.data) && typeof result.data === "object" ? result.data as Record<string, unknown> : result;
  const choices = Array.isArray(output?.choices) ? output.choices as Array<{ message?: { content?: string } }> : [];
  const pictures = (Array.isArray(result?.data) ? result.data : Array.isArray(output?.data) ? output.data : []) as Array<{ url?: string; b64_json?: string }>;
  const imageSources = pictures.flatMap(item => {
    if (typeof item.url === "string") { try { const url = new URL(item.url); if (url.protocol === "https:") return [url.href]; } catch {} }
    return typeof item.b64_json === "string" && /^[A-Za-z0-9+/=]+$/.test(item.b64_json) ? [`data:image/png;base64,${item.b64_json}`] : [];
  });
  return <>
    <header className="dashboard-header"><div><span className="section-kicker">PLAYGROUND</span><h1>tokvilo 精选</h1><p>选择模型、查看报价，再确认从账户余额预留。完成后按实际用量结算。</p></div><Link href="/dashboard/docs?provider=selected">接口文档 ↗</Link></header>
    <div className="playground-layout">
      <section className="playground-controls" aria-label="精选请求参数">
        <div className="playground-form-fields">
          <label className="playground-field"><span>模型</span><select aria-label="精选模型" value={model} onChange={event => { setModel(event.target.value); setResult(null); }} disabled={loading || busy}>{!models.some(item => item.model === model) ? <option value={model}>{model || "正在加载模型…"}</option> : null}{models.map(item => <option key={`selected:${item.model}`} value={item.model}>{item.name || item.model}{item.billingReady ? "" : " · 服务待开通"}</option>)}</select></label>
          <label className="playground-field"><span>{kind === "image" ? "图片描述" : "提示词"}</span><textarea aria-label="精选提示词" value={prompt} onChange={event => setPrompt(event.target.value)} rows={8} maxLength={kind === "image" ? 4000 : 10000} placeholder={kind === "image" ? "描述你想生成的图片…" : "输入你的问题或任务…"} /></label>
          {kind === "chat" ? <label className="playground-field"><span>最大输出 tokens</span><select aria-label="精选最大输出" value={maximum} onChange={event => setMaximum(Number(event.target.value))}>{[256, 512, 1024, 2048, 4096].map(value => <option value={value} key={value}>{value}</option>)}</select></label> : <p>当前图片模式：每次 1 张，1024 × 1024。</p>}
          <p>{selected?.billingReady ? "当前模型已开通此接口，实际结果以请求返回为准。" : "价格已列示，服务待开通；当前不能提交生成请求。"}</p>
        </div>
        <div className="playground-run-area">{currentQuote ? <div role="status"><strong>本次预留 {money(currentQuote.reservedMicrousd)}</strong><p>修改参数后需重新报价，完成后退回预留差额。</p></div> : null}<button className="playground-run" type="button" disabled={loading || busy || !executable} onClick={currentQuote ? generate : prepareQuote}>{busy ? "处理中…" : currentQuote ? `确认预留 ${money(currentQuote.reservedMicrousd)} 并生成` : "获取准确报价"}</button>{currentQuote ? <button type="button" disabled={busy} onClick={prepareQuote}>刷新报价</button> : null}<Link href="/dashboard/wallet">查看余额与充值</Link></div>
      </section>
      <section className="playground-workspace" aria-label="精选请求结果">
        <header className="playground-workspace-header"><h2>请求与结果</h2><Link href="/models">返回模型市场</Link></header>
        {requestId ? <div role="status"><p>请求编号：<code>{requestId}</code></p><button type="button" disabled={busy} onClick={() => queryRequest(requestId)}>查询此请求</button><p>查询只读取已有结果，不会重新生成。</p></div> : null}
        {error ? <p role="alert">{error}</p> : null}
        {choices[0]?.message?.content ? <pre style={{ whiteSpace: "pre-wrap" }}>{choices[0].message.content}</pre> : null}
        {imageSources.map((source, index) => <figure key={index}>
          {/* Generated URLs and data URIs are displayed without an image proxy. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={source} alt={`生成图片 ${index + 1}`} style={{ maxWidth: "100%" }} />
        </figure>)}
        {result ? <details open><summary>请求结果与结算</summary><pre style={{ overflowX: "auto", maxHeight: 420 }}><code>{JSON.stringify(result, null, 2)}</code></pre></details> : <p>生成结果会显示在这里。</p>}
        <section aria-label="最近精选请求"><h3>最近请求</h3><p>刷新页面后，可在这里查询本账户的原请求结果。</p><button type="button" disabled={historyLoading} onClick={refreshRecentRequests}>{historyLoading ? "正在加载记录…" : "刷新记录"}</button>{historyError ? <p role="alert">{historyError}</p> : null}{recentRequests.length ? <ul>{recentRequests.map(item => <li key={item.id}><p>{item.model} · {requestState(item.state)}{item.created_at ? ` · ${item.created_at}` : ""}</p><code>{item.id}</code> <button type="button" aria-label={`查询请求 ${item.id}`} disabled={busy} onClick={() => queryRequest(item.id)}>查看结果</button></li>)}</ul> : !historyLoading && !historyError ? <p>暂无请求记录。</p> : null}</section>
        <details><summary>查看 JSON 请求参数</summary><pre><code>{json}</code></pre></details>
        <details><summary>查看 API 调用示例</summary><pre style={{ overflowX: "auto" }}><code>{curl}</code></pre></details>
        {model ? <PriceTable provider="selected" model={model} /> : null}
      </section>
    </div>
  </>;
}
