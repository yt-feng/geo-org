"use client";

import { useCallback, useEffect, useState, type CSSProperties, type FormEvent } from "react";
import Link from "next/link";
import { Icon } from "./Icon";

const API = "/api/admin/tokenhub-audit";
type ModelKind = "chat" | "image" | "video" | "unknown";
type AuditModel = { id: string; name: string; kind: ModelKind; accent: string; sources: string[]; catalogState: string; lastSeenAt: string; adapterSupported: boolean; plannedCalls: number; observedDays: number };
type DayResult = { day: number; date?: string; model: string; kind: ModelKind; planned: number; requests: number; scored: number; passed: number; score: number | null; latencyMs: number | null; estimatedMicros: number | null; errors: number; empty: number; truncated: number; nonceMismatch: number; missed: number; pending: number; succeeded: number; generating: number; catalogObserved: boolean; catalogState: string; inferenceState: string; states: string[]; status: string };
type Campaign = { id: string; status: string; startedAt: string; endsAt: string; budgetMicros: number; reservedMicros: number; estimatedMicros: number | null; completedRequests: number; totalRequests: number; tokenVerification: string; billingRecorded: number; pauseReason: string; plannedReservationMicros: number };
type MediaResult = { id: string; day: number; kind: string; model: string; status: string; createdAt?: string; estimatedMicros?: number | null; taskId?: string };
type CatalogObservation = { day: number; observedAt: string; status: string; modelCount: number; errors: string[] };
type AuditStatus = { campaign: Campaign | null; models: AuditModel[]; observations: CatalogObservation[]; days: DayResult[]; media: MediaResult[]; flags: string[]; updatedAt?: string };
type Json = Record<string, unknown>;
const object = (value: unknown): Json => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
const number = (value: unknown, fallback = 0) => typeof value === "number" && Number.isFinite(value) ? value : fallback;
const string = (value: unknown, fallback = "") => typeof value === "string" ? value : fallback;
const strings = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
const kindOf = (value: unknown): ModelKind => ["chat", "image", "video"].includes(string(value)) ? value as ModelKind : "unknown";
const kindName: Record<ModelKind, string> = { chat: "文本", image: "图片", video: "视频", unknown: "待分类" };
const accentFor = (kind: ModelKind, id: string) => kind === "image" ? "#d49bb9" : kind === "video" ? "#89bdb1" : /deepseek/.test(id) ? "#9eaef0" : kind === "chat" ? "#eac170" : "#a8b2c2";
const modelLabel = (label: unknown, id: string) => typeof label === "string" && label && label !== id ? label : id.replace(/^(dola|dreamina)-/, "").replace(/-(?:ga-)?\d{6}$/, "").replace(/(\d)-(?=\d)/g, "$1.").replaceAll("-", " ").replace(/\bglm\b/gi, "GLM").replace(/\bdeepseek\b/gi, "DeepSeek").replace(/\b(seedance|seedream|flash|pro|mini|fast|v\d+)\b/gi, word => word[0].toUpperCase() + word.slice(1));
const money = (micros: number, digits = 2) => `$${(micros / 1_000_000).toFixed(digits)}`;
const time = (value: string) => { const date = new Date(value); return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }); };
const dayDate = (start: string | undefined, day: number) => { if (!start) return "启动后排期"; const date = new Date(new Date(start).getTime() + day * 86400000); return Number.isNaN(date.getTime()) ? "待排期" : date.toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit" }); };
const statusName: Record<string, string> = { active: "核验进行中", running: "核验进行中", planned: "计划待测", missed: "错过时段", window_expired: "时段结束未发送", reserved: "执行中", inflight: "执行中", submitting: "执行中", provider_error: "上游返回错误", outcome_unknown: "结果待确认", price_blocked: "价格校验未通过", pending_video: "视频生成中", poll_limit_reached: "视频结果待复核", paused: "已停止后续调用", completed: "七天观察期结束", complete: "七天观察期结束", budget_exhausted: "已达预算边界", pending: "待执行", succeeded: "已返回", passed: "已返回", failed: "调用失败", submitted: "已提交", queued: "排队中", unknown: "结果待确认", skipped: "已跳过", expired: "已过期", cancelled: "已取消" };

// Keep missing values visibly missing; no request failure is converted to a score.
function parseStatus(value: unknown): AuditStatus {
  const source = object(value), campaign = object(source.campaign);
  const cases = Array.isArray(source.cases) ? source.cases.map(object) : [];
  const requested = cases.filter(item => typeof item.submittedAt === "string" && item.submittedAt);
  // The server owns discovery and scheduling. A new catalog model must not need a UI release.
  const catalogModels = Array.isArray(source.catalogModels) ? source.catalogModels.map(object) : [];
  const discovered = new Map<string, Json>();
  const oldCatalog = object(campaign.catalog);
  for (const item of Array.isArray(oldCatalog.data) ? oldCatalog.data.map(object) : []) {
    const id = string(item.id); if (id) discovered.set(id, { model: id, label: item.name, kind: "unknown", catalogState: "unobserved" });
  }
  for (const item of cases) {
    const id = string(item.requestedModel); if (id) discovered.set(id, { ...discovered.get(id), model: id, kind: item.kind, paidAdapterSupported: true });
  }
  for (const item of catalogModels) { const id = string(item.model); if (id) discovered.set(id, item); }
  const models: AuditModel[] = Array.from(discovered, ([id, item]) => {
    const kind = kindOf(item.kind);
    return { id, name: modelLabel(item.label, id), kind, accent: accentFor(kind, id), sources: strings(item.sources), catalogState: string(item.catalogState, "unobserved"), lastSeenAt: string(item.lastSeenAt), adapterSupported: item.paidAdapterSupported === true, plannedCalls: number(item.plannedCalls, cases.filter(record => record.requestedModel === id).length), observedDays: number(item.observedDays) };
  });
  const days: DayResult[] = [];
  for (const day of Array.isArray(source.days) ? source.days.map(object) : []) {
    for (const model of Array.isArray(day.models) ? day.models.map(object) : []) {
      const records = cases.filter(item => number(item.slot, -1) >= (number(day.day) - 1) * 2 && number(item.slot, -1) < number(day.day) * 2 && item.requestedModel === model.model);
      days.push({ day: number(day.day) - 1, date: string(day.date), model: string(model.model), kind: kindOf(model.kind || models.find(item => item.id === model.model)?.kind), planned: number(model.planned, records.length), requests: number(model.requests), scored: number(model.items), passed: number(model.correct),
        score: typeof model.score === "number" && Number.isFinite(model.score) ? model.score : null,
        latencyMs: typeof model.latencyMs === "number" && Number.isFinite(model.latencyMs) ? model.latencyMs : null,
        estimatedMicros: typeof model.derivedExpectedCostMicros === "number" ? model.derivedExpectedCostMicros : null,
        errors: records.filter(item => ["failed", "error", "unknown", "provider_error", "outcome_unknown"].includes(string(item.state))).length,
        empty: records.filter(item => object(item.grading).status === "empty").length,
        truncated: records.filter(item => object(item.grading).status === "truncated").length,
        nonceMismatch: records.filter(item => object(item.grading).status === "stale_or_mismatched_nonce").length,
        missed: number(model.missed), pending: number(model.pending), status: string(model.status),
        succeeded: records.filter(item => ["succeeded", "passed"].includes(string(item.state))).length,
        generating: records.filter(item => ["pending_video", "submitted", "queued", "submitting", "reserved"].includes(string(item.state))).length,
        catalogObserved: model.catalogObserved === true, catalogState: string(model.catalogState, "unverified"), inferenceState: string(model.inferenceState), states: records.map(item => string(item.state)),
      });
    }
  }
  return {
    campaign: typeof campaign.id === "string" ? {
      id: campaign.id, status: string(campaign.state), startedAt: string(campaign.startedAt), endsAt: string(campaign.endsAt),
      budgetMicros: number(campaign.budgetMicros, 5_000_000), reservedMicros: number(campaign.reservedMicros),
      estimatedMicros: cases.some(item => typeof item.derivedExpectedCostMicros === "number") ? cases.reduce((total, item) => total + number(item.derivedExpectedCostMicros), 0) : null,
      completedRequests: requested.length, totalRequests: number(campaign.plannedCalls, cases.length), tokenVerification: string(campaign.tokenVerification), billingRecorded: cases.filter(item => item.billingVerification === "recorded").length, pauseReason: string(campaign.pauseReason), plannedReservationMicros: number(campaign.plannedReservationMicros),
    } : null,
    models,
    observations: (Array.isArray(source.catalogObservations) ? source.catalogObservations.map(object) : []).map(item => ({ day: number(item.day) - 1, observedAt: string(item.observedAt), status: string(item.status), modelCount: number(item.modelCount), errors: strings(item.errors) })),
    days,
    media: requested.filter(item => item.kind === "image" || item.kind === "video").map(item => ({
      id: `${number(item.slot)}:${string(item.caseId)}`, day: Math.floor(number(item.slot) / 2), kind: string(item.kind), model: string(item.requestedModel), status: string(item.state),
      createdAt: string(item.submittedAt), estimatedMicros: typeof item.derivedExpectedCostMicros === "number" ? item.derivedExpectedCostMicros : null, taskId: string(item.taskId),
    })),
    flags: Array.isArray(source.flags) ? source.flags.filter((value): value is string => typeof value === "string") : [],
    updatedAt: string(source.updatedAt),
  };
}

async function request(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(path, { cache: "no-store", credentials: "same-origin", ...init });
  let data: unknown;
  try { data = await response.json(); } catch { throw new Error("服务响应暂不可读，请刷新查看已保存的核验进度。"); }
  if (!response.ok) throw new Error(string(object(data).error, "请求未完成，请刷新查看核验进度。"));
  return data;
}

function CatalogIndicator({ result, future }: { result?: DayResult; future: boolean }) {
  const present = result?.catalogObserved && result.catalogState === "present";
  const label = present ? "目录在列" : result?.catalogState === "absent" ? "当日目录未见" : future ? "目录待观测" : "目录未核验";
  return <div className={`audit-catalog-indicator${present ? " is-observed" : ""}`}><i /><span>{label}</span><small>免费观测</small></div>;
}

function ScoreCard({ result, baseline, model, future, day, stopped }: { result?: DayResult; baseline?: DayResult; model: AuditModel; future: boolean; day: number; stopped: boolean }) {
  const hasScore = !!result && result.scored > 0 && result.score !== null;
  const delta = hasScore && baseline && baseline.scored > 0 && baseline.score !== null && day > 0 ? result.score! - baseline.score : null;
  const score = hasScore ? Math.max(0, Math.min(100, result.score!)) : null;
  const planned = result?.planned || 0;
  const label = result?.requests ? (hasScore ? `${result.scored} 题项 · ${result.requests}/${planned} 请求` : `${result.requests}/${planned} 请求 · 无可评分答案`) : result?.missed ? `错过时段 · ${result.missed} 请求` : result?.states.includes("price_blocked") ? "价格校验未通过 · 未调用" : !planned ? "当日无付费抽样" : stopped ? "后续付费测试已停止" : future ? "未来待测" : "等待测试";
  const note = !model.adapterSupported ? "调用适配待补齐 · 保留目录观测" : !model.plannedCalls ? "$5 内未安排付费测试" : planned ? `当日计划 ${planned} 请求 · 长短输入配对` : "目录继续观测 · 付费按计划抽样";
  return <div className={`audit-score-card${hasScore ? " has-score" : " is-empty"}${future && !result?.requests ? " is-future" : ""}`}>
    <div className="audit-card-top"><span>{hasScore ? "标准答案正确率" : planned ? "付费能力检测" : "目录与价格观测"}</span><small>{result?.requests || 0}/{planned}</small></div>
    <div className="audit-score-line"><strong>{score === null ? "—" : score.toFixed(0)}</strong>{score !== null ? <span>/ 100</span> : null}</div>
    <div className="audit-score-track" aria-hidden="true"><i style={{ width: `${score || 0}%` }} /></div>
    <p className="audit-card-count">{label}</p>
    {result?.requests ? <>
      <div className="audit-card-meta"><span>{result.latencyMs === null ? "耗时待记录" : `${(result.latencyMs / 1000).toFixed(1)}s 均值`}</span><span>{result.estimatedMicros === null ? "估价待算" : `估 ${money(result.estimatedMicros, 3)}`}</span></div>
      <div className="audit-card-foot"><span className={delta !== null && delta < 0 ? "audit-delta-negative" : ""}>{delta === null ? day === 0 && hasScore ? "首日基线" : "基线待形成" : `${delta > 0 ? "+" : ""}${delta.toFixed(0)} 分 vs D1`}</span><span>样本少</span></div>
      {result.errors + result.empty + result.truncated + result.nonceMismatch + result.missed > 0 ? <div className="audit-card-exceptions">{[result.errors ? `${result.errors} 请求异常` : "", result.empty ? `${result.empty} 无答案` : "", result.truncated ? `${result.truncated} 截断` : "", result.nonceMismatch ? `${result.nonceMismatch} 响应校验码不符` : "", result.missed ? `${result.missed} 错过时段` : ""].filter(Boolean).join(" · ")}</div> : null}
    </> : <p className="audit-card-note">{note}</p>}
    <CatalogIndicator result={result} future={future} />
  </div>;
}

function ObservationCard({ result, model, future, stopped }: { result?: DayResult; model: AuditModel; future: boolean; stopped: boolean }) {
  const planned = result?.planned || 0;
  const submitted = !!result?.requests;
  const unsupported = !model.adapterSupported;
  const state = result?.succeeded ? "已返回" : result?.generating ? "生成中" : result?.errors ? "请求异常" : result?.missed ? "错过时段" : result?.states.includes("price_blocked") ? "价格未通过" : unsupported ? "待适配" : !planned ? "目录观测" : stopped ? "已停止" : "待抽样";
  const note = result?.succeeded ? "已保存响应 · 内容质量待核验" : submitted ? [...new Set(result?.states.filter(item => item !== "planned"))].map(item => statusName[item] || item).join(" · ") : unsupported ? "暂无调用适配 · 每日目录仍观测" : !model.plannedCalls ? "$5 内未安排付费测试" : planned ? `当日计划 ${planned} 次付费抽样` : "当日不生成 · 持续观测目录与价格";
  return <div className={`audit-score-card audit-observation-card${result?.succeeded ? " has-result" : " is-empty"}${future && !submitted ? " is-future" : ""}`}>
    <div className="audit-card-top"><span>{planned ? `${kindName[model.kind]}生成抽样` : "目录与价格观测"}</span><small>{result?.requests || 0}/{planned}</small></div>
    <div className="audit-observation-state"><Icon name={model.kind === "image" ? "image" : model.kind === "video" ? "video" : "activity"} size={17} /><strong>{state}</strong></div>
    <p className="audit-card-count">{note}</p>
    {submitted ? <div className="audit-card-meta"><span>{result?.latencyMs === null ? "耗时待记录" : `${((result?.latencyMs || 0) / 1000).toFixed(1)}s`}</span><span>{result?.estimatedMicros === null ? "估价待算" : `估 ${money(result?.estimatedMicros || 0, 3)}`}</span></div> : null}
    <p className="audit-card-note">{model.kind === "image" ? "核验物体、颜色与空间关系" : model.kind === "video" ? "核验时长、画面、音轨与动作" : "保留完整模型 ID 与发现记录"}</p>
    <CatalogIndicator result={result} future={future} />
  </div>;
}

export function TokenHubAuditDashboard() {
  const [data, setData] = useState<AuditStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [refreshedAt, setRefreshedAt] = useState("");
  const [modelFilter, setModelFilter] = useState<ModelKind | "all">("all");
  const [modelQuery, setModelQuery] = useState("");
  const refresh = useCallback(async (signal?: AbortSignal) => {
    const result = await request(API, { signal });
    if (!signal?.aborted) { setData(parseStatus(result)); setRefreshedAt(new Date().toISOString()); }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    request(API, { signal: controller.signal }).then(result => { if (!controller.signal.aborted) { setData(parseStatus(result)); setRefreshedAt(new Date().toISOString()); } }).catch(error => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "读取核验进度失败。"); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);
  const campaign = data?.campaign;
  const active = campaign?.status === "active" || campaign?.status === "running";
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    const timer = setInterval(() => { refresh(controller.signal).catch(() => {}); }, 45_000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [active, refresh]);
  async function action(name: "start" | "tick" | "pause" | "observe") {
    if (busy) return;
    setBusy(name); setError(""); setNotice("");
    try {
      await request(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: name, ...(name === "start" ? { apiKey } : {}) }) });
      if (name === "start") setApiKey("");
      await refresh();
      setNotice(name === "start" ? "核验已启动。全部目录模型纳入每日观察，付费测试按预算内计划执行。" : name === "pause" ? "后续付费测试已停止；已发出的请求仍可能返回结果。" : name === "observe" ? "已同步本轮全量目录观测；未新增付费模型请求。" : "本次推进已结束，已刷新保存的核验记录。");
    } catch (error) {
      setError(error instanceof Error ? error.message : "操作未完成，请刷新查看进度。");
      await refresh().catch(() => {});
    } finally { setBusy(""); }
  }
  async function handleRefresh() {
    if (busy) return; setBusy("refresh"); setError("");
    try { await refresh(); } catch (error) { setError(error instanceof Error ? error.message : "刷新失败。"); } finally { setBusy(""); }
  }
  function start(event: FormEvent<HTMLFormElement>) { event.preventDefault(); void action("start"); }
  const started = campaign ? new Date(campaign.startedAt).getTime() : null;
  const currentDay = started !== null && Number.isFinite(started) ? Math.max(0, Math.min(6, Math.floor((new Date(refreshedAt).getTime() - started) / 86400000))) : -1;
  const days = Array.from({ length: 7 }, (_, index) => index);
  const scored = data?.days.reduce((total, day) => total + day.scored, 0) || 0;
  const progress = campaign?.totalRequests ? Math.min(100, campaign.completedRequests / campaign.totalRequests * 100) : 0;
  const models = data?.models || [];
  const query = modelQuery.trim().toLowerCase();
  const visibleModels = models.filter(model => (modelFilter === "all" || model.kind === modelFilter) && `${model.id} ${model.name} ${kindName[model.kind]}`.toLowerCase().includes(query));
  const paidModels = models.filter(model => model.plannedCalls > 0).length;
  const testedModels = new Set(data?.days.filter(day => day.requests > 0).map(day => day.model)).size;
  const observedModels = models.filter(model => model.observedDays > 0).length;
  const observedDays = data?.observations.filter(item => item.status === "succeeded").length || 0;
  const mediaModels = models.filter(model => model.kind === "image" || model.kind === "video");
  return <div className="tokenhub-audit">
    <header className="audit-heading"><div><div className="audit-eyebrow"><i /> TOKENHUB / ALL-MODEL OBSERVATION</div><h1>全模型每日观测<span>7 DAYS</span></h1><p>文本、图片、视频全部入表。每日观测目录与价格，在 $5 总预算内轮换能力测试和生成抽样。</p></div><Link className="console-button" href="/tokenhub"><Icon name="arrow-up-right" size={14} />返回工作台</Link></header>
    <div className="audit-toolbar"><div className={`audit-status${active ? " is-active" : ""}`}><i /><span>{loading ? "正在读取核验状态" : campaign ? statusName[campaign.status] || campaign.status : "等待启动"}</span>{campaign ? <small>{time(campaign.startedAt)} — {time(campaign.endsAt)} · 北京时间</small> : null}</div><div className="audit-actions"><button className="console-button" onClick={handleRefresh} disabled={!!busy || loading}><Icon name="refresh" size={13} />{busy === "refresh" ? "刷新中" : "刷新"}</button>{campaign ? <button className="console-button" onClick={() => void action("observe")} disabled={!!busy}>{busy === "observe" ? "正在同步目录…" : "同步全量目录"}</button> : null}{campaign ? <a className="console-button" href={`${API}?evidence=1`} download="eco-geo-tokenhub-audit-evidence.json"><Icon name="code" size={13} />导出证据</a> : null}{active ? <><button className="console-button" onClick={() => void action("tick")} disabled={!!busy}>{busy === "tick" ? "正在执行一项…" : "推进当期一次"}</button><button className="console-button audit-stop" onClick={() => void action("pause")} disabled={!!busy}>{busy === "pause" ? "停止中…" : "停止后续付费测试"}</button></> : null}</div></div>
    {campaign?.pauseReason ? <div className="audit-notice" role="status"><Icon name="info" size={15} /><span>暂停原因：{campaign.pauseReason}</span></div> : null}
    {error ? <div className="audit-notice audit-notice-error" role="alert"><Icon name="info" size={15} /><span>{error}</span></div> : null}
    {notice || busy === "tick" ? <div className="audit-notice" role="status"><Icon name="info" size={15} /><span>{busy === "tick" ? "正在执行一个测试请求，最多约 5 分钟。完成后会自动刷新；请勿重复提交。" : notice}</span></div> : null}
    <section className="audit-summary" aria-label="预算与核验进度">
      <div><span>七天总预算上限</span><strong>$5<small>.00</small></strong><p>专用密钥独立额度 · 不追加预算</p></div>
      <div><span>已记录估算费用</span><strong>{campaign?.estimatedMicros === null || !campaign ? "—" : money(campaign.estimatedMicros, 3)}</strong><p>按返回用量估算 · 实际账单另核对</p></div>
      <div><span>预算预留</span><strong>{money(campaign?.reservedMicros || 0, 2)}</strong><p>全计划预留上限 {campaign ? money(campaign.plannedReservationMicros) : "—"} · 非扣费</p></div>
      <div><span>付费测试进度</span><strong>{campaign?.completedRequests || 0}<small> / {campaign?.totalRequests || 0} 请求</small></strong><div className="audit-progress"><i style={{ width: `${progress}%` }} /></div><p>{scored} 个可评分题项 · 截断与异常单独记录</p></div>
    </section>
    {!loading && data && !campaign ? <section className="audit-start"><div><span className="audit-eyebrow">START YOUR AUDIT</span><h2>启用本次七天核验</h2><p>填写在 TokenHub 设置总额度不超过 $5 的审计专用密钥。全部发现的模型纳入目录与价格观测；文本每日长短输入配对，多模态轮换抽样，未安排付费测试的模型也保留在表内。</p></div><form onSubmit={start}><label htmlFor="audit-key">审计专用 TokenHub API Key</label><div><input id="audit-key" type="password" name="apiKey" value={apiKey} onChange={event => setApiKey(event.target.value)} placeholder="填写专用 API Key" autoComplete="off" spellCheck={false} maxLength={1024} disabled={!!busy} required /><button className="console-button console-button-primary" disabled={!!busy || !apiKey.trim()} type="submit">{busy === "start" ? "正在启动…" : "启动 7 天核验"}<Icon name="arrow-right" size={14} /></button></div><small>密钥加密保存。启动后执行预算内计划，不重复创建测试。</small></form></section> : null}
    <section className="audit-catalog-section" aria-labelledby="audit-catalog-heading">
      <div className="audit-section-heading"><div><span className="audit-eyebrow">DAILY CATALOG WATCH / NO INFERENCE CALLS</span><h2 id="audit-catalog-heading">全目录覆盖，付费检测单独计数</h2></div><span>读取目录与价格，不发起付费推理 · 目录在列不代表调用成功</span></div>
      <div className="audit-coverage"><div><strong>{models.length}</strong><span>模型已纳入观察</span></div><div><strong>{observedModels}<small> / {models.length}</small></strong><span>本轮已有目录观测</span></div><div><strong>{testedModels}<small> / {paidModels}</small></strong><span>已调用 / 计划付费检测模型</span></div><div><strong>{observedDays}<small> / 7 天</small></strong><span>目录及价格完整读取</span></div></div>
      <div className="audit-catalog-days">{days.map(day => { const observation = data?.observations.find(item => item.day === day); const state = observation?.status; return <div key={day} className={state === "succeeded" ? "is-observed" : state === "failed" || state === "partial" ? "is-incomplete" : ""}><span>DAY {String(day + 1).padStart(2, "0")}<small>{dayDate(campaign?.startedAt, day)}</small></span><strong>{state === "succeeded" ? "已观测" : state === "partial" ? "部分来源已读" : state === "failed" ? "读取未完成" : state === "fetching" ? "正在读取" : "待观测"}</strong><small>{observation?.observedAt ? `${observation.modelCount} 个目录模型 · ${time(observation.observedAt)}` : "目录与价格每日留档"}</small>{observation?.errors.length ? <details><summary>查看读取提示</summary><p>{observation.errors.join("；")}</p></details> : null}</div>; })}</div>
    </section>
    <section className="audit-matrix-section" aria-labelledby="audit-matrix-heading">
      <div className="audit-section-heading"><div><span className="audit-eyebrow">ALL-MODEL MATRIX</span><h2 id="audit-matrix-heading">{models.length ? `${models.length} 个模型，七天连续观察` : "全模型七天观察矩阵"}</h2></div><span>文本显示正确率 · 图片与视频显示实际抽样状态</span></div>
      <div className="audit-model-controls"><div className="audit-model-filters" role="group" aria-label="按模型类型筛选">{(["all", "chat", "image", "video", ...(models.some(model => model.kind === "unknown") ? ["unknown"] : [])] as const).map(filter => <button type="button" className={modelFilter === filter ? "is-selected" : ""} aria-pressed={modelFilter === filter} key={filter} onClick={() => setModelFilter(filter as ModelKind | "all")}>{filter === "all" ? "全部" : kindName[filter as ModelKind]}<span>{filter === "all" ? models.length : models.filter(model => model.kind === filter).length}</span></button>)}</div><label className="audit-model-search"><Icon name="search" size={14} /><input type="search" aria-label="搜索模型名称或完整模型 ID" placeholder="搜索模型名称或完整 ID" value={modelQuery} onChange={event => setModelQuery(event.target.value)} /><span>{visibleModels.length} / {models.length}</span></label></div>
      <div className="audit-matrix-scroll" role="region" aria-label="全模型每日观测矩阵，可横向滚动" tabIndex={0}>
        <table className="audit-matrix"><thead><tr><th scope="col"><span>模型 / 日期</span><small>目录观察 + 付费抽样</small></th>{days.map(day => <th scope="col" key={day} className={day === currentDay ? "is-current" : ""}><span>DAY {String(day + 1).padStart(2, "0")}</span><small>{dayDate(campaign?.startedAt, day)}{day === currentDay && active ? " · 进行中" : ""}</small></th>)}</tr></thead><tbody>{visibleModels.map(model => {
          const results = data?.days.filter(day => day.model === model.id) || [], baseline = results.find(day => day.day === 0);
          return <tr key={model.id} style={{ "--audit-accent": model.accent } as CSSProperties}><th scope="row"><div className="audit-model-name"><i /><strong>{model.name}</strong></div><span>{kindName[model.kind]} · {model.plannedCalls ? `计划 ${model.plannedCalls} 次付费抽样` : "仅目录观测"}</span><code title={model.id}>{model.id}</code><small className="audit-model-coverage">{model.catalogState === "disappeared" ? "最新目录未见 · 历史保留" : !model.adapterSupported ? "调用适配待补齐" : model.plannedCalls ? "已纳入预算内检测" : "$5 内暂无付费安排"}</small></th>{days.map(day => <td key={day}>{model.kind === "chat" ? <ScoreCard result={results.find(item => item.day === day)} baseline={baseline} model={model} future={currentDay < day} day={day} stopped={!!campaign && !active} /> : <ObservationCard result={results.find(item => item.day === day)} model={model} future={currentDay < day} stopped={!!campaign && !active} />}</td>)}</tr>;
        })}</tbody></table>
        {!visibleModels.length ? <p className="audit-model-empty">{loading ? "正在读取完整模型目录…" : models.length ? "没有匹配的模型，清空搜索或切换类型查看。" : "目录尚未返回；读取完成后自动展示全部发现的模型。"}</p> : null}
      </div>
      <div className="audit-matrix-caption"><span><Icon name="info" size={13} />分数 = 已评分题项正确率 × 100；不是 IQ，也不构成模型身份认证。</span><span>目录每日观察 · 付费次数按当日计划显示 · 未测与异常不计零分</span></div>
    </section>
    {data?.flags.length ? <details className="audit-flags"><summary><Icon name="activity" size={14} />已记录 {data.flags.length} 项核验提示<span>展开查看</span></summary><ul>{data.flags.map((flag, index) => <li key={`${index}:${flag}`}>{flag}</li>)}</ul></details> : null}
    <section className="audit-evidence-grid" aria-label="证据核验边界"><article><span className="audit-evidence-number">01</span><div><h3>能力稳定性</h3><span className="audit-evidence-tag">标准答案可核验</span><p>随机化计算、约束优化与信息提取；长短输入配对。同模型与首日比较，下降记录为异常线索。</p></div></article><article><span className="audit-evidence-number">02</span><div><h3>模型身份</h3><span className="audit-evidence-tag is-pending">未证实 · 缺少官方对照</span><p>模型名称、自报身份和高分都不能证明实际路由。本轮没有官方 API 同版本盲测对照。</p></div></article><article><span className="audit-evidence-number">03</span><div><h3>Token 与账单</h3><span className="audit-evidence-tag is-pending">{campaign?.tokenVerification === "needs_review" ? "离线核验有提示" : campaign?.tokenVerification === "provisional" ? "离线初核 · 身份未证实" : "待官方分词复核"} · {campaign?.billingRecorded ? `已录 ${campaign.billingRecorded} 笔账单` : "待对账"}</span><p>DeepSeek 使用固定版本官方分词器；GLM 暂无精确版本分词器。隐藏推理和实际扣费另核对。</p></div></article></section>
    <section className="audit-media-section"><div className="audit-section-heading"><div><span className="audit-eyebrow">MULTIMODAL EVIDENCE</span><h2>全部图片与视频模型的抽样记录</h2></div><span>共 {mediaModels.length} 个模型 · 计划 {mediaModels.reduce((total, model) => total + model.plannedCalls, 0)} 次付费抽样 · 生成成功不等于质量通过</span></div><div className="audit-media-grid">{mediaModels.map(model => { const records = data?.media.filter(item => item.model === model.id) || []; return <article className="audit-media-card" key={model.id}><div className="audit-media-title"><Icon name={model.kind} size={20} /><div><h3>{model.name}</h3><code>{model.id}</code></div><small>{records.length} / {model.plannedCalls} 抽样</small></div>{records.length ? <div className="audit-media-records">{records.map(item => <div key={item.id}><span>DAY {String(item.day + 1).padStart(2, "0")}<small>{item.createdAt ? time(item.createdAt) : "时间待记录"}</small></span><span>{statusName[item.status] || item.status}<small>{item.estimatedMicros === null || item.estimatedMicros === undefined ? "估价待算" : `估 ${money(item.estimatedMicros, 3)}`}{item.status === "succeeded" ? " · 内容待人工核验" : " · 尚无已验收内容"}</small></span></div>)}</div> : <div className="audit-media-empty">{!model.adapterSupported ? "调用适配待补齐" : model.plannedCalls ? "等待计划内抽样" : "$5 内未安排付费抽样"}<span>每日目录观测保留。实际文件返回后，再核验画面与生成参数。</span></div>}</article>; })}</div></section>
    <footer className="audit-footer"><span><Icon name="lock" size={12} />ECO-GEO · 管理员核验记录</span><span>{refreshedAt ? `最后刷新 ${time(refreshedAt)} · 北京时间` : "正在读取"}</span></footer>
  </div>;
}
