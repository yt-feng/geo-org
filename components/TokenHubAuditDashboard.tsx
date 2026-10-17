"use client";

import { useCallback, useEffect, useState, type CSSProperties, type FormEvent } from "react";
import Link from "next/link";
import { Icon } from "./Icon";

const API = "/api/admin/tokenhub-audit";
const MODEL_PRESETS = [
  { id: "glm-5-3-flash-260828", name: "GLM 5.3 Flash", family: "GLM", accent: "#eac170" },
  { id: "glm-5-2-260617", name: "GLM 5.2", family: "GLM", accent: "#e89669" },
  { id: "deepseek-v4-pro-ga-260813", name: "DeepSeek V4 Pro", family: "DEEPSEEK", accent: "#9eaef0" },
  { id: "deepseek-v4-flash-ga-260731", name: "DeepSeek V4 Flash", family: "DEEPSEEK", accent: "#89bdb1" },
];
type DayResult = { day: number; date?: string; model: string; requests: number; scored: number; passed: number; score: number | null; latencyMs: number | null; estimatedMicros: number | null; errors: number; empty: number; truncated: number; nonceMismatch: number; missed: number; pending: number; status: string };
type Campaign = { id: string; status: string; startedAt: string; endsAt: string; budgetMicros: number; reservedMicros: number; estimatedMicros: number | null; completedRequests: number; totalRequests: number; tokenVerification: string; billingRecorded: number; pauseReason: string; plannedReservationMicros: number };
type MediaResult = { id: string; kind: string; model: string; status: string; createdAt?: string; estimatedMicros?: number | null; taskId?: string };
type AuditStatus = { campaign: Campaign | null; days: DayResult[]; media: MediaResult[]; flags: string[]; updatedAt?: string };
type Json = Record<string, unknown>;
const object = (value: unknown): Json => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
const number = (value: unknown, fallback = 0) => typeof value === "number" && Number.isFinite(value) ? value : fallback;
const string = (value: unknown, fallback = "") => typeof value === "string" ? value : fallback;
const money = (micros: number, digits = 2) => `$${(micros / 1_000_000).toFixed(digits)}`;
const time = (value: string) => { const date = new Date(value); return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }); };
const dayDate = (start: string | undefined, day: number) => { if (!start) return "启动后排期"; const date = new Date(new Date(start).getTime() + day * 86400000); return Number.isNaN(date.getTime()) ? "待排期" : date.toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit" }); };
const statusName: Record<string, string> = { active: "核验进行中", running: "核验进行中", planned: "计划待测", missed: "错过时段", window_expired: "时段结束未发送", reserved: "执行中", inflight: "执行中", submitting: "执行中", provider_error: "上游返回错误", outcome_unknown: "结果待确认", price_blocked: "价格校验未通过", pending_video: "视频生成中", poll_limit_reached: "视频结果待复核", paused: "已停止后续调用", completed: "七天观察期结束", complete: "七天观察期结束", budget_exhausted: "已达预算边界", pending: "待执行", succeeded: "已返回", passed: "已返回", failed: "调用失败", submitted: "已提交", queued: "排队中", unknown: "结果待确认", skipped: "已跳过", expired: "已过期", cancelled: "已取消" };

// Keep missing values visibly missing; no request failure is converted to a score.
function parseStatus(value: unknown): AuditStatus {
  const source = object(value), campaign = object(source.campaign);
  const cases = Array.isArray(source.cases) ? source.cases.map(object) : [];
  const requested = cases.filter(item => typeof item.submittedAt === "string" && item.submittedAt);
  const days: DayResult[] = [];
  for (const day of Array.isArray(source.days) ? source.days.map(object) : []) {
    for (const model of Array.isArray(day.models) ? day.models.map(object) : []) {
      const records = cases.filter(item => number(item.slot, -1) >= (number(day.day) - 1) * 2 && number(item.slot, -1) < number(day.day) * 2 && item.requestedModel === model.model);
      days.push({ day: number(day.day) - 1, date: string(day.date), model: string(model.model), requests: number(model.requests), scored: number(model.items), passed: number(model.correct),
        score: typeof model.score === "number" && Number.isFinite(model.score) ? model.score : null,
        latencyMs: typeof model.latencyMs === "number" && Number.isFinite(model.latencyMs) ? model.latencyMs : null,
        estimatedMicros: typeof model.derivedExpectedCostMicros === "number" ? model.derivedExpectedCostMicros : null,
        errors: records.filter(item => ["failed", "error", "unknown", "provider_error", "outcome_unknown"].includes(string(item.state))).length,
        empty: records.filter(item => object(item.grading).status === "empty").length,
        truncated: records.filter(item => object(item.grading).status === "truncated").length,
        nonceMismatch: records.filter(item => object(item.grading).status === "stale_or_mismatched_nonce").length,
        missed: number(model.missed), pending: number(model.pending), status: string(model.status),
      });
    }
  }
  return {
    campaign: typeof campaign.id === "string" ? {
      id: campaign.id, status: string(campaign.state), startedAt: string(campaign.startedAt), endsAt: string(campaign.endsAt),
      budgetMicros: number(campaign.budgetMicros, 5_000_000), reservedMicros: number(campaign.reservedMicros),
      estimatedMicros: cases.some(item => typeof item.derivedExpectedCostMicros === "number") ? cases.reduce((total, item) => total + number(item.derivedExpectedCostMicros), 0) : null,
      completedRequests: requested.length, totalRequests: number(campaign.plannedCalls, 116), tokenVerification: string(campaign.tokenVerification), billingRecorded: cases.filter(item => item.billingVerification === "recorded").length, pauseReason: string(campaign.pauseReason), plannedReservationMicros: number(campaign.plannedReservationMicros, 4_520_000),
    } : null,
    days,
    media: requested.filter(item => item.kind === "image" || item.kind === "video").map(item => ({
      id: `${number(item.slot)}:${string(item.caseId)}`, kind: string(item.kind), model: string(item.requestedModel), status: string(item.state),
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

function ScoreCard({ result, baseline, future, day, stopped }: { result?: DayResult; baseline?: DayResult; future: boolean; day: number; stopped: boolean }) {
  const hasScore = !!result && result.scored > 0 && result.score !== null;
  const delta = hasScore && baseline && baseline.scored > 0 && baseline.score !== null && day > 0 ? result.score! - baseline.score : null;
  const score = hasScore ? Math.max(0, Math.min(100, result.score!)) : null;
  const label = result?.requests ? (hasScore ? `${result.scored} 题项 · ${result.requests}/4 请求` : `${result.requests}/4 请求 · 无可评分答案`) : (result?.missed ? `错过时段 · ${result.missed} 请求` : future ? "未来待测" : stopped ? "后续测试已停止" : "等待测试");
  return <div className={`audit-score-card${hasScore ? " has-score" : " is-empty"}${future && !result?.requests ? " is-future" : ""}`}>
    <div className="audit-card-top"><span>{hasScore ? "标准答案正确率" : future ? "SCHEDULED" : "AWAITING DATA"}</span><small>{result?.requests ? `${result.requests}/4` : "—"}</small></div>
    <div className="audit-score-line"><strong>{score === null ? "—" : score.toFixed(0)}</strong>{score !== null ? <span>/ 100</span> : null}</div>
    <div className="audit-score-track" aria-hidden="true"><i style={{ width: `${score || 0}%` }} /></div>
    <p className="audit-card-count">{label}</p>
    {result?.requests ? <>
      <div className="audit-card-meta"><span>{result.latencyMs === null ? "耗时待记录" : `${(result.latencyMs / 1000).toFixed(1)}s 均值`}</span><span>{result.estimatedMicros === null ? "估价待算" : `估 ${money(result.estimatedMicros, 3)}`}</span></div>
      <div className="audit-card-foot"><span className={delta !== null && delta < 0 ? "audit-delta-negative" : ""}>{delta === null ? day === 0 && hasScore ? "首日基线" : "基线待形成" : `${delta > 0 ? "+" : ""}${delta.toFixed(0)} 分 vs D1`}</span><span>样本少</span></div>
      {result.errors + result.empty + result.truncated + result.nonceMismatch + result.missed > 0 ? <div className="audit-card-exceptions">{[result.errors ? `${result.errors} 请求异常` : "", result.empty ? `${result.empty} 无答案` : "", result.truncated ? `${result.truncated} 截断` : "", result.nonceMismatch ? `${result.nonceMismatch} 响应校验码不符` : "", result.missed ? `${result.missed} 错过时段` : ""].filter(Boolean).join(" · ")}</div> : null}
    </> : <p className="audit-card-note">每天两轮 · 长短输入配对</p>}
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
  async function action(name: "start" | "tick" | "pause") {
    if (busy) return;
    setBusy(name); setError(""); setNotice("");
    try {
      await request(API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: name, ...(name === "start" ? { apiKey } : {}) }) });
      if (name === "start") setApiKey("");
      await refresh();
      setNotice(name === "start" ? "核验已启动。每天两轮，运行结果会持续记录在下方。" : name === "pause" ? "后续付费测试已停止；已发出的请求仍可能返回结果。" : "本次推进已结束，已刷新保存的核验记录。");
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
  return <div className="tokenhub-audit">
    <header className="audit-heading"><div><div className="audit-eyebrow"><i /> TOKENHUB / DAILY EVALUATION</div><h1>每日模型能力核验<span>7 DAYS</span></h1><p>固定题型、每日新题、标准答案评分。把能力波动、Token 计量和费用证据放在一起。</p></div><Link className="console-button" href="/tokenhub"><Icon name="arrow-up-right" size={14} />返回工作台</Link></header>
    <div className="audit-toolbar"><div className={`audit-status${active ? " is-active" : ""}`}><i /><span>{loading ? "正在读取核验状态" : campaign ? statusName[campaign.status] || campaign.status : "等待启动"}</span>{campaign ? <small>{time(campaign.startedAt)} — {time(campaign.endsAt)} · 北京时间</small> : null}</div><div className="audit-actions"><button className="console-button" onClick={handleRefresh} disabled={!!busy || loading}><Icon name="refresh" size={13} />{busy === "refresh" ? "刷新中" : "刷新"}</button>{campaign ? <a className="console-button" href={`${API}?evidence=1`} download="eco-geo-tokenhub-audit-evidence.json"><Icon name="code" size={13} />导出证据</a> : null}{active ? <><button className="console-button" onClick={() => void action("tick")} disabled={!!busy}>{busy === "tick" ? "正在执行一项…" : "推进当期一次"}</button><button className="console-button audit-stop" onClick={() => void action("pause")} disabled={!!busy}>{busy === "pause" ? "停止中…" : "停止后续付费测试"}</button></> : null}</div></div>
    {campaign?.pauseReason ? <div className="audit-notice" role="status"><Icon name="info" size={15} /><span>暂停原因：{campaign.pauseReason}</span></div> : null}
    {error ? <div className="audit-notice audit-notice-error" role="alert"><Icon name="info" size={15} /><span>{error}</span></div> : null}
    {notice || busy === "tick" ? <div className="audit-notice" role="status"><Icon name="info" size={15} /><span>{busy === "tick" ? "正在执行一个测试请求，最多约 110 秒。完成后会自动刷新；请勿重复提交。" : notice}</span></div> : null}
    <section className="audit-summary" aria-label="预算与核验进度"><div><span>七天总预算上限</span><strong>$5<small>.00</small></strong><p>专用密钥独立额度 · 不追加预算</p></div><div><span>已记录估算费用</span><strong>{campaign?.estimatedMicros === null || !campaign ? "—" : money(campaign.estimatedMicros, 3)}</strong><p>按返回用量估算 · 实际账单待核对</p></div><div><span>预算预留</span><strong>{money(campaign?.reservedMicros || 0, 2)}</strong><p>全计划预留上限 {money(campaign?.plannedReservationMicros || 4_520_000)} · 非扣费</p></div><div><span>核验进度</span><strong>{campaign?.completedRequests || 0}<small> / {campaign?.totalRequests || 116} 请求</small></strong><div className="audit-progress"><i style={{ width: `${progress}%` }} /></div><p>{scored} 个可评分题项 · 少量样本谨慎解读</p></div></section>
    {!loading && data && !campaign ? <section className="audit-start"><div><span className="audit-eyebrow">START YOUR AUDIT</span><h2>启用本次七天核验</h2><p>填写在 TokenHub 设置总额度不超过 $5 的审计专用密钥，与日常工作台调用分开。四个对话模型每天各 4 次请求，另取两张图片、两段视频作首尾抽样。</p></div><form onSubmit={start}><label htmlFor="audit-key">审计专用 TokenHub API Key</label><div><input id="audit-key" type="password" name="apiKey" value={apiKey} onChange={event => setApiKey(event.target.value)} placeholder="填写专用 API Key" autoComplete="off" spellCheck={false} maxLength={1024} disabled={!!busy} required /><button className="console-button console-button-primary" disabled={!!busy || !apiKey.trim()} type="submit">{busy === "start" ? "正在启动…" : "启动 7 天核验"}<Icon name="arrow-right" size={14} /></button></div><small>密钥加密保存。启动后固定本轮计划，不重复创建测试。</small></form></section> : null}
    <section className="audit-matrix-section" aria-labelledby="audit-matrix-heading"><div className="audit-section-heading"><div><span className="audit-eyebrow">CAPABILITY MATRIX</span><h2 id="audit-matrix-heading">四个模型，七天连续观察</h2></div><span>分数 = 已评分题项正确率 × 100</span></div><div className="audit-matrix-scroll" role="region" aria-label="模型每日核验矩阵，可横向滚动" tabIndex={0}><table className="audit-matrix"><thead><tr><th scope="col"><span>模型 / 日期</span><small>同题型 · 同输出上限</small></th>{days.map(day => <th scope="col" key={day} className={day === currentDay ? "is-current" : ""}><span>DAY {String(day + 1).padStart(2, "0")}</span><small>{dayDate(campaign?.startedAt, day)}{day === currentDay && active ? " · 进行中" : ""}</small></th>)}</tr></thead><tbody>{MODEL_PRESETS.map(model => { const results = data?.days.filter(day => day.model === model.id) || []; const baseline = results.find(day => day.day === 0); return <tr key={model.id} style={{ "--audit-accent": model.accent } as CSSProperties}><th scope="row"><div className="audit-model-name"><i /><strong>{model.name}</strong></div><span>{model.family}</span><code title={model.id}>{model.id}</code></th>{days.map(day => <td key={day}><ScoreCard result={results.find(item => item.day === day)} baseline={baseline} future={currentDay < day} day={day} stopped={!!campaign && !active} /></td>)}</tr>; })}</tbody></table></div><div className="audit-matrix-caption"><span><Icon name="info" size={13} />这是本题集能力分，不是 IQ，也不构成模型身份认证。</span><span>每日 4 请求 / 模型 · 首轮截断保留，不计能力分</span></div></section>
    {data?.flags.length ? <details className="audit-flags"><summary><Icon name="activity" size={14} />已记录 {data.flags.length} 项核验提示<span>展开查看</span></summary><ul>{data.flags.map((flag, index) => <li key={`${index}:${flag}`}>{flag}</li>)}</ul></details> : null}
    <section className="audit-evidence-grid" aria-label="证据核验边界"><article><span className="audit-evidence-number">01</span><div><h3>能力稳定性</h3><span className="audit-evidence-tag">标准答案可核验</span><p>随机化计算、约束优化与信息提取；长短输入配对。同模型与首日比较，下降记录为异常线索。</p></div></article><article><span className="audit-evidence-number">02</span><div><h3>模型身份</h3><span className="audit-evidence-tag is-pending">未证实 · 缺少官方对照</span><p>模型名称、自报身份和高分都不能证明实际路由。本轮没有官方 API 同版本盲测对照。</p></div></article><article><span className="audit-evidence-number">03</span><div><h3>Token 与账单</h3><span className="audit-evidence-tag is-pending">{campaign?.tokenVerification === "needs_review" ? "离线核验有提示" : campaign?.tokenVerification === "provisional" ? "离线初核 · 身份未证实" : "待官方分词复核"} · {campaign?.billingRecorded ? `已录 ${campaign.billingRecorded} 笔账单` : "待对账"}</span><p>DeepSeek 使用固定版本官方分词器；GLM 暂无精确版本分词器。隐藏推理和实际扣费另核对。</p></div></article></section>
    <section className="audit-media-section"><div className="audit-section-heading"><div><span className="audit-eyebrow">MULTIMODAL SPOT CHECK</span><h2>图片与视频，首尾抽样</h2></div><span>2 张图片 + 2 段视频 · 独立于能力矩阵评分</span></div><div className="audit-media-grid">{["image", "video"].map(kind => { const records = data?.media.filter(item => item.kind === kind) || []; return <article className="audit-media-card" key={kind}><div className="audit-media-title"><Icon name={kind} size={20} /><div><h3>{kind === "image" ? "Seedream 5.0 Pro" : "Seedance 2.0"}</h3><span>{kind === "image" ? "物体数量、颜色与空间关系" : "时长、分辨率、音轨与连续运动"}</span></div><small>{records.length} / 2 抽样</small></div>{records.length ? <div className="audit-media-records">{records.map(item => <div key={item.id}><span>{item.id.startsWith("0:") ? "首轮" : "末轮"}<small>{item.createdAt ? time(item.createdAt) : "时间待记录"}</small></span><span>{statusName[item.status] || item.status}<small>{item.estimatedMicros === null || item.estimatedMicros === undefined ? "估价待算" : `估 ${money(item.estimatedMicros, 3)}`} · 内容待人工核验</small></span></div>)}</div> : <div className="audit-media-empty">{campaign ? "等待计划内抽样" : "启动后按计划执行"}<span>保存实际返回文件证据，不用模型自评替代验收。</span></div>}</article>; })}</div></section>
    <footer className="audit-footer"><span><Icon name="lock" size={12} />ECO-GEO · 管理员核验记录</span><span>{refreshedAt ? `最后刷新 ${time(refreshedAt)} · 北京时间` : "正在读取"}</span></footer>
  </div>;
}
