"use client";

import { useSiteLocale } from "./LocaleProvider";
import { formatCreditsWithUsd } from "@/lib/credits";
import { PlaygroundBillingSummary } from "./PlaygroundBillingSummary";


import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { PriceTable } from "./PriceTable";
import type { PlaygroundStatus } from "@/lib/playground-status";

type SelectedModel = { provider: string; model: string; name: string; kind: "chat" | "image"; billingReady: boolean };
type Quote = { signature: string; reservedMicrousd: number };
type RecentRequest = { id: string; model: string; state: string; created_at: string };
const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
const requestState = (state: string) => ({ completed: "已完成", failed: "未完成", pending: "处理中", unknown: "等待核对" })[state] || "等待核对";
async function fetchAccountStatus(): Promise<PlaygroundStatus> {
  const response = await fetch("/api/playground/status?service=selected", { cache: "no-store" });
  if (response.status === 401) throw Error("login_required");
  const data = await response.json();
  if (!response.ok || data.service !== "selected" || data.authenticated !== true || data.currency !== "USD"
    || !Number.isSafeInteger(data.balanceMicrousd) || typeof data.serviceEnabled !== "boolean"
    || typeof data.configured !== "boolean" || typeof data.accountActive !== "boolean") throw Error("status_unavailable");
  return data;
}
async function fetchRecentRequests(): Promise<RecentRequest[]> {
  const response = await fetch("/api/selected/v1/requests", { method: "GET", cache: "no-store" });
  const data = await response.json();
  if (!response.ok || !Array.isArray(data.data)) throw Error("最近请求暂时无法加载，请刷新记录。");
  return data.data.filter((item: RecentRequest) => item && typeof item.id === "string" && /^[A-Za-z0-9_-]{8,128}$/.test(item.id) && typeof item.model === "string")
    .slice(0, 50).map((item: RecentRequest) => ({ id: item.id, model: item.model.slice(0, 200), state: item.state, created_at: typeof item.created_at === "string" ? item.created_at : "" }));
}

export function SelectedPlayground({ initialModel }: { initialModel?: string }) {
  const { t, isEnglish, href, locale } = useSiteLocale();
  const money = (amount: number) => formatCreditsWithUsd(amount, locale);
  const messageCopy = (value: string) => {
    if (!isEnglish) return value;
    if (/请先登录|登录已过期/.test(value)) return "Your session has expired. Sign in to continue.";
    if (/余额不足/.test(value)) return "Insufficient wallet balance. Please top up.";
    if (/报价|价格/.test(value)) return "Pricing is unavailable or incomplete. Get a new quote before submitting.";
    if (/最近请求/.test(value)) return "Request history could not load. Refresh the history list.";
    if (/连接中断|原请求编号/.test(value)) return "The request ID has been retained. Check the existing request before trying again.";
    return /[\u4e00-\u9fff]/.test(value) ? "The request is not confirmed. Check its result before retrying." : value;
  };
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
  const [accountStatus, setAccountStatus] = useState<PlaygroundStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [statusError, setStatusError] = useState("");
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
    fetchAccountStatus().then(status => { if (active) setAccountStatus(status); })
      .catch(cause => { if (active) setStatusError(cause instanceof Error && cause.message === "login_required" ? "login_required" : "status_unavailable"); })
      .finally(() => { if (active) setStatusLoading(false); });
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
  const insufficientBalance = !!currentQuote && !!accountStatus && accountStatus.balanceMicrousd < currentQuote.reservedMicrousd;
  const generationBlocked = statusLoading || !!statusError || !accountStatus?.serviceEnabled || !accountStatus.configured
    || !accountStatus.accountActive || insufficientBalance;
  const statusMessage = statusLoading ? t("正在检查余额与服务配置…", "Checking wallet and service configuration…")
    : statusError === "login_required" ? t("登录已过期，请重新登录后继续。", "Your session has expired. Sign in to continue.")
      : statusError || !accountStatus ? t("暂时无法读取账户状态，请刷新后再生成。", "Account status could not load. Refresh it before generating.")
        : !accountStatus.accountActive ? t("账户当前已停用，请联系支持。", "This account is disabled. Contact support.")
          : !accountStatus.serviceEnabled ? t("生成服务当前未启用，请稍后刷新状态。", "Generation is currently disabled. Refresh the status later.")
            : !accountStatus.configured ? t("此服务暂未开通生成，当前可查看模型参数与价格。", "Generation for this service is not available yet. You can view model parameters and prices.")
              : insufficientBalance ? t(`余额不足，还需充值 ${money(currentQuote!.reservedMicrousd - accountStatus.balanceMicrousd)} 才能确认生成。`, `Insufficient balance. Add ${money(currentQuote!.reservedMicrousd - accountStatus.balanceMicrousd)} to confirm generation.`)
                : accountStatus.balanceMicrousd <= 0 ? t("可先获取报价，充值后再确认生成。", "Get a quote first, then top up to confirm generation.") : "";
  const curl = `curl --request POST \\\n  --url 'https://tokvilo.com${endpoint}' \\\n  --header 'Authorization: Bearer YOUR_TOKVILO_API_KEY' \\\n  --header 'Idempotency-Key: YOUR_UNIQUE_REQUEST_ID' \\\n  --header 'Content-Type: application/json' \\\n  --data ${shellQuote(json)}`;

  async function prepareQuote() {
    if (inFlight.current || !executable || statusError === "login_required") return;
    inFlight.current = true; setBusy(true); setError(""); setQuote(null);
    try {
      const response = await fetch("/api/pricing/quote", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: "selected", mode: kind, body }) });
      const data = await response.json();
      if (response.status === 401) setStatusError("login_required");
      if (!response.ok) throw Error(typeof data.error === "string" ? data.error : data.error?.message || "报价暂不可用。");
      if (data.provider !== "selected" || data.model !== model || data.mode !== kind || data.currency !== "USD" || !Number.isSafeInteger(data.reservedMicrousd) || data.reservedMicrousd < 1 || data.reservedMicrousd > 1_000_000_000_000) throw Error("报价内容不完整，请重新获取。");
      setQuote({ signature, reservedMicrousd: data.reservedMicrousd });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "报价暂不可用。"); }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function generate() {
    if (inFlight.current || !currentQuote || !executable || generationBlocked) return;
    inFlight.current = true; setBusy(true); setError(""); setResult(null);
    if (pending.current?.signature !== signature) pending.current = { signature, id: crypto.randomUUID() };
    setRequestId(pending.current.id);
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": pending.current.id, "X-Tokvilo-Max-Reserve-Microusd": String(currentQuote.reservedMicrousd) }, body: json });
      const data = await response.json();
      if (response.status === 401) setStatusError("login_required");
      setResult(data);
      if (!response.ok) {
        if (data.error?.code === "reservation_limit_exceeded") setQuote(null);
        throw Error(typeof data.error === "string" ? data.error : data.error?.message || "请求尚未完成，请保留原参数重试。");
      }
      setQuote(null);
      if (["settled", "refunded"].includes(data.tokvilo_billing?.status)) pending.current = null;
    } catch (cause) { setError(cause instanceof Error ? cause.message : "连接中断，原请求编号已保留，请查询此请求。"); }
    finally { inFlight.current = false; setBusy(false); await refreshAccountStatus(); }
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
  async function refreshAccountStatus() {
    setStatusLoading(true); setStatusError("");
    try { setAccountStatus(await fetchAccountStatus()); }
    catch (cause) { setAccountStatus(null); setStatusError(cause instanceof Error && cause.message === "login_required" ? "login_required" : "status_unavailable"); }
    finally { setStatusLoading(false); }
  }
  const output = result && result.data && !Array.isArray(result.data) && typeof result.data === "object" ? result.data as Record<string, unknown> : result;
  const choices = Array.isArray(output?.choices) ? output.choices as Array<{ message?: { content?: string } }> : [];
  const pictures = (Array.isArray(result?.data) ? result.data : Array.isArray(output?.data) ? output.data : []) as Array<{ url?: string; b64_json?: string }>;
  const imageSources = pictures.flatMap(item => {
    if (typeof item.url === "string") { try { const url = new URL(item.url); if (url.protocol === "https:") return [url.href]; } catch {} }
    return typeof item.b64_json === "string" && /^[A-Za-z0-9+/=]+$/.test(item.b64_json) ? [`data:image/png;base64,${item.b64_json}`] : [];
  });
  return <>
    <header className="dashboard-header"><div><span className="section-kicker">PLAYGROUND</span><h1>{t("tokvilo 精选", "tokvilo Select")}</h1><p>{t("选择模型、查看报价，再确认从账户余额预留。完成后按实际用量结算。", "Choose a model, get a quote and confirm the reservation from your wallet. Final billing uses actual usage.")}</p></div><Link href={href("/dashboard/docs?provider=selected")}>{t("接口文档 ↗", "API documentation ↗")}</Link></header>
    <div className="playground-layout">
      <section className="playground-controls" aria-label={t("精选请求参数", "Select request parameters")}>
        <div className="playground-form-fields">
          <label className="playground-field"><span>{t("模型", "Model")}</span><select aria-label={t("精选模型", "Select model")} value={model} onChange={event => { setModel(event.target.value); setResult(null); }} disabled={loading || busy}>{!models.some(item => item.model === model) ? <option value={model}>{model || t("正在加载模型…", "Loading models…")}</option> : null}{models.map(item => <option key={`selected:${item.model}`} value={item.model}>{item.name || item.model}{item.billingReady ? "" : t(" · 服务待开通", " · Activation pending")}</option>)}</select></label>
          <label className="playground-field"><span>{kind === "image" ? t("图片描述", "Image description") : t("提示词", "Prompt")}</span><textarea aria-label={t("精选提示词", "Select prompt")} value={prompt} onChange={event => setPrompt(event.target.value)} rows={8} maxLength={kind === "image" ? 4000 : 10000} placeholder={kind === "image" ? t("描述你想生成的图片…", "Describe the image you want to create…") : t("输入你的问题或任务…", "Enter your question or task…")} /></label>
          {kind === "chat" ? <label className="playground-field"><span>{t("最大输出 tokens", "Maximum output tokens")}</span><select aria-label={t("精选最大输出", "Select maximum output")} value={maximum} onChange={event => setMaximum(Number(event.target.value))}>{[256, 512, 1024, 2048, 4096].map(value => <option value={value} key={value}>{value}</option>)}</select></label> : <p>{t("当前图片模式：每次 1 张，1024 × 1024。", "Image mode: one 1024 × 1024 image per request.")}</p>}
          <p>{selected?.billingReady ? t("此模型支持报价。确认生成前会检查服务配置与可用余额。", "Quotes are supported for this model. Service configuration and available funds are checked before generation.") : t("价格已列示，服务待开通；可查看参数，当前不能提交生成请求。", "Pricing is listed; activation is pending. You can view parameters, but generation is not available yet.")}</p>
        </div>
        <div className="playground-run-area">
          <p className="playground-code-note">{t("$1 = 1,000 积分。积分用于计价，tokens 表示实际模型用量。预留金额不是最终费用。", "$1 = 1,000 credits. Credits express prices; tokens track actual model usage. A reservation is not the final charge.")}</p>
          <p className="playground-flow-steps">{t("1 获取准确报价 → 2 确认金额并生成", "1 Get exact quote → 2 Confirm & generate")}</p>
          <div className="playground-account-state" role="status">
            {accountStatus ? <strong>{t("可用余额 ", "Available balance ")}{money(accountStatus.balanceMicrousd)}</strong> : null}
            {statusMessage ? <p>{statusMessage}</p> : null}
            {statusError === "login_required" ? <Link href={href("/login")}>{t("重新登录", "Sign in again")}</Link> : <button type="button" disabled={statusLoading || busy} onClick={refreshAccountStatus}>{t("刷新余额与状态", "Refresh balance & status")}</button>}
          </div>
          {currentQuote ? <div role="status"><strong>{t("本次预留 ", "Reservation ")}{money(currentQuote.reservedMicrousd)}</strong><p>{t("预留金额不是最终费用。修改参数后需重新报价，完成后按实际用量结算并退回差额。", "The reservation is not the final charge. Get a new quote after changing parameters. Final billing uses actual usage and unused funds are returned.")}</p></div> : null}
          {error ? <div className="playground-inline-error" role="alert"><p>{messageCopy(error)}</p></div> : null}
          <button className="playground-run" type="button" disabled={loading || busy || !executable || statusError === "login_required" || (!!currentQuote && generationBlocked)} onClick={currentQuote ? generate : prepareQuote}>{busy ? t("处理中…", "Processing…") : currentQuote ? t(`确认预留 ${money(currentQuote.reservedMicrousd)} 并生成`, `Reserve ${money(currentQuote.reservedMicrousd)} & generate`) : t("获取准确报价", "Get exact quote")}</button>
          {currentQuote ? <button type="button" disabled={busy} onClick={prepareQuote}>{t("刷新报价", "Refresh quote")}</button> : null}
          <a href={href("/dashboard/wallet")}>{t("查看余额与充值", "View wallet & top up")}</a>
        </div>
      </section>
      <section className="playground-workspace" aria-label={t("精选请求结果", "Select request results")}>
        <header className="playground-workspace-header"><h2>{t("请求与结果", "Requests & results")}</h2><Link href={href("/models")}>{t("返回模型市场", "Back to models")}</Link></header>
        {requestId ? <div role="status"><p>{t("请求编号：", "Request ID: ")}<code>{requestId}</code></p><button type="button" disabled={busy} onClick={() => queryRequest(requestId)}>{t("查询此请求", "Check this request")}</button><p>{t("查询只读取已有结果，不会重新生成。", "Checking retrieves the existing result without generating again.")}</p></div> : null}
        {choices[0]?.message?.content ? <pre style={{ whiteSpace: "pre-wrap" }}>{choices[0].message.content}</pre> : null}
        {imageSources.map((source, index) => <figure key={index}>
          {/* Generated URLs and data URIs are displayed without an image proxy. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={source} alt={t(`生成图片 ${index + 1}`, `Generated image ${index + 1}`)} style={{ maxWidth: "100%" }} />
        </figure>)}
        {result ? <PlaygroundBillingSummary response={result} locale={locale} /> : null}
        {result ? <details open><summary>{t("请求结果与结算", "Response & billing")}</summary><pre style={{ overflowX: "auto", maxHeight: 420 }}><code>{JSON.stringify(result, null, 2)}</code></pre></details> : <p>{t("生成结果会显示在这里。", "Generated results will appear here.")}</p>}
        <section aria-label={t("最近精选请求", "Recent Select requests")}><h3>{t("最近请求", "Recent requests")}</h3><p>{t("刷新页面后，可在这里查询本账户的原请求结果。", "After refreshing, use this list to retrieve your account’s existing results.")}</p><button type="button" disabled={historyLoading} onClick={refreshRecentRequests}>{historyLoading ? t("正在加载记录…", "Loading history…") : t("刷新记录", "Refresh history")}</button>{historyError ? <p role="alert">{messageCopy(historyError)}</p> : null}{recentRequests.length ? <ul>{recentRequests.map(item => <li key={item.id}><p>{item.model} · {isEnglish ? ({ completed: "Completed", failed: "Failed", pending: "Processing", unknown: "Awaiting review" }[item.state] || "Awaiting review") : requestState(item.state)}{item.created_at ? ` · ${item.created_at}` : ""}</p><code>{item.id}</code> <button type="button" aria-label={t(`查询请求 ${item.id}`, `Check request ${item.id}`)} disabled={busy} onClick={() => queryRequest(item.id)}>{t("查看结果", "View result")}</button></li>)}</ul> : !historyLoading && !historyError ? <p>{t("暂无请求记录。", "No requests yet.")}</p> : null}</section>
        <details><summary>{t("查看 JSON 请求参数", "View JSON request parameters")}</summary><pre><code>{json}</code></pre></details>
        <details><summary>{t("查看 API 调用示例", "View API example")}</summary><pre style={{ overflowX: "auto" }}><code>{curl}</code></pre></details>
        {model ? <PriceTable provider="selected" model={model} /> : null}
      </section>
    </div>
  </>;
}
