"use client";

/* eslint-disable @next/next/no-img-element -- Audit images must preserve the saved source or authenticated archive URL. */

import { useEffect, useState } from "react";
import { Icon } from "./Icon";

type Json = Record<string, unknown>;
export type AuditEvidenceRecord = { slot: number; caseId: string; model: string; kind: string; state: string; submittedAt: string; updatedAt: string; gradingStatus: string };
export type AuditEvidenceFilter = { day?: number; model?: string; caseId?: string; slot?: number };
type Model = { id: string; name: string };
type Media = { kind: "image" | "video"; url: string; sourcePath: string; label: string; storage?: "embedded" | "archived" | "source"; sourceUrl?: string; sourceExpiresAt?: string | null; archive?: { state: string; archivedAt?: string | null; sizeBytes?: number | null; sha256?: string | null; error?: string | null } | null };
type Evidence = { campaign: { id: string; startedAt: string; endsAt: string; planVersion: string }; case: Json; media: Media[] };
const obj = (value: unknown): Json => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
const str = (value: unknown) => typeof value === "string" ? value : "";
const items = (value: unknown) => Array.isArray(value) ? value : [];
const printable = (value: unknown) => typeof value === "string" ? value : value === undefined ? "未返回" : JSON.stringify(value, null, 2);
const timestamp = (value: unknown) => { const date = new Date(str(value)); return Number.isNaN(date.getTime()) ? "未记录" : date.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false }); };
const money = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? `$${(value / 1_000_000).toFixed(8).replace(/0+$/, "").replace(/\.$/, "")}` : "待核对";
const stateLabels: Record<string, string> = { succeeded: "已返回", pending_video: "视频生成中", provider_error: "上游错误", outcome_unknown: "结果待确认", reserved: "未发出 · 已预留", price_blocked: "未发出 · 价格未通过", window_expired: "未发出 · 时段结束", poll_limit_reached: "视频结果待复核", expired: "任务已过期", cancelled: "任务已取消", submitting: "提交中", failed: "调用失败" };
const gradeLabels: Record<string, string> = { passed: "答案正确", incorrect: "部分答案错误", truncated: "输出截断 · 不计分", empty: "无最终答案", invalid_json: "答案格式不符", stale_or_mismatched_nonce: "响应校验码不符 · 不计分", manual_review_pending: "内容待人工核验" };
const recordKey = (record: Pick<AuditEvidenceRecord, "slot" | "caseId">) => `${record.slot}:${record.caseId}`;
const evidenceUrl = (campaign: string, record: Pick<AuditEvidenceRecord, "slot" | "caseId">) => `/api/admin/tokenhub-audit/evidence?${new URLSearchParams({ campaign, slot: String(record.slot), caseId: record.caseId })}`;

function JsonBlock({ title, value, open = false }: { title: string; value: unknown; open?: boolean }) {
  return <details className="audit-paper-json" open={open}><summary>{title}<span>完整内容</span></summary><pre tabIndex={0}>{printable(value)}</pre></details>;
}
function TextBlock({ label, content }: { label: string; content: unknown }) {
  return <div className="audit-paper-text"><div>{label}<small>{typeof content === "string" ? `${content.length.toLocaleString()} 字符` : "完整记录"}</small></div><pre tabIndex={0}>{printable(content)}</pre></div>;
}
function MediaPreview({ media }: { media: Media }) {
  const [failed, setFailed] = useState(false);
  const [openedAt] = useState(() => Date.now());
  const safe = /^https:\/\//i.test(media.url) || /^\/api\/admin\/tokenhub-audit\/media\?asset=[a-f0-9]{64}$/.test(media.url) || media.kind === "image" && /^data:image\/(?:png|jpeg|webp);base64,/i.test(media.url);
  const archived = media.storage === "archived" || media.archive?.state === "archived";
  const embedded = media.storage === "embedded" || media.url.startsWith("data:image/");
  const sourceExpired = !!media.sourceExpiresAt && new Date(media.sourceExpiresAt).getTime() < openedAt;
  if (!safe) return <p className="audit-paper-empty">该媒体地址不支持内嵌预览；原始返回仍完整保存在 JSON 底稿中。</p>;
  return <figure className="audit-paper-media"><figcaption>{media.label || (media.kind === "video" ? "上游返回的视频" : "上游返回的图片")}<small>{media.sourcePath}</small></figcaption>{failed ? <div className="audit-paper-empty" role="status">{archived ? "已归档媒体暂时无法加载，请重新读取底稿后再试。" : "媒体暂时无法加载，源链接可能已失效。"}请求、返回和原始链接仍保留在底稿中。</div> : media.kind === "video" ? <video controls preload="metadata" playsInline onError={() => setFailed(true)} src={media.url} aria-label={media.label || "检测返回的视频"} /> : <img src={media.url} alt={media.label || "检测模型实际返回的图片"} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />}<p className="audit-paper-media-status">{embedded ? "图片内容已随底稿保存，可直接查看。" : archived ? `已归档到 ECO-GEO · ${timestamp(media.archive?.archivedAt)} · 不依赖上游临时链接` : sourceExpired ? "上游临时链接已到期，当前没有可用归档；原始响应仍保留。" : `当前显示上游临时文件${media.sourceExpiresAt ? ` · 链接到期 ${timestamp(media.sourceExpiresAt)}` : " · 到期时间未提供"}。${media.archive?.state === "failed" ? "文件归档暂未完成。" : media.archive?.state === "unsupported" ? "该来源暂不支持归档。" : "归档完成后，重新读取可查看后台文件。"}`}</p><a href={media.url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">{embedded ? "打开已保存" : archived ? "打开已归档" : "打开原始"}{media.kind === "video" ? "视频" : "图片"}<Icon name="arrow-up-right" size={12} /></a></figure>;
}

export function AuditEvidenceDetail({ evidence, downloadUrl, onReload, initialTab = "conversation" }: { evidence: Evidence; downloadUrl: string; onReload?: () => void; initialTab?: "conversation" | "grading" | "usage" | "raw" }) {
  const [tab, setTab] = useState<string>(initialTab);
  const record = evidence.case, request = obj(record.request), rawResponse = obj(record.response), response = rawResponse.data !== null && typeof rawResponse.data === "object" && !Array.isArray(rawResponse.data) ? obj(rawResponse.data) : rawResponse, grading = obj(record.grading), expected = obj(record.expected);
  const choices = items(response.choices).map(obj);
  const submitted = typeof record.wasSubmitted === "boolean" ? record.wasSubmitted : !!str(record.submittedAt);
  const messages = items(request.messages).map(obj);
  const content = items(request.content).map(obj);
  const expectedAnswers = items(expected.answers), subitems = items(grading.subitems);
  let answer: Json = {};
  try { answer = obj(JSON.parse(str(obj(choices[0]?.message).content).trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""))); } catch { /* Unparseable and truncated responses remain available verbatim. */ }
  const actualAnswers = items(answer.answers);
  const gradeStatus = str(grading.status);
  const supportsItems = ["passed", "incorrect"].includes(gradeStatus);
  const media = Array.isArray(evidence.media) ? evidence.media : [];
  const responseExists = record.response !== null && record.response !== undefined;
  const tabs = [{ id: "conversation", name: "问题与返回" }, { id: "grading", name: "标准答案与评分依据" }, { id: "usage", name: "Token 与账单" }, { id: "raw", name: "完整原始记录" }];
  return <article className="audit-paper-detail">
    <header className="audit-paper-detail-header"><div><span className="audit-eyebrow">DAY {String(Math.floor(Number(record.slot) / 2) + 1).padStart(2, "0")} / {str(record.kind) === "chat" ? "文本检测" : str(record.kind) === "image" ? "图片检测" : "视频检测"}</span><h3>{str(record.requestedModel)}</h3><p>{submitted ? `请求发出于 ${timestamp(record.submittedAt)}` : "这条请求未发出，保留执行记录供复核"} · 北京时间</p></div><div className="audit-paper-detail-actions">{onReload ? <button className="console-button" type="button" onClick={onReload}><Icon name="refresh" size={12} />刷新底稿</button> : null}<a className="console-button" href={downloadUrl} download><Icon name="code" size={13} />下载本条底稿</a></div></header>
    <div className="audit-paper-badges"><span>{stateLabels[str(record.state)] || str(record.state)}</span>{gradeStatus ? <span className={gradeStatus === "passed" ? "is-passed" : ""}>{gradeLabels[gradeStatus] || gradeStatus}</span> : null}{record.httpStatus ? <span>HTTP {String(record.httpStatus)}</span> : null}{typeof record.latencyMs === "number" ? <span>{(record.latencyMs / 1000).toFixed(1)} 秒</span> : null}</div>
    <div className="audit-paper-tabs" role="tablist" aria-label="底稿内容">{tabs.map(item => <button key={item.id} type="button" role="tab" id={`paper-tab-${item.id}`} aria-controls={`paper-panel-${item.id}`} aria-selected={tab === item.id} className={tab === item.id ? "is-selected" : ""} onClick={() => setTab(item.id)}>{item.name}</button>)}</div>
    <div className="audit-paper-panel" role="tabpanel" id={`paper-panel-${tab}`} aria-labelledby={`paper-tab-${tab}`}>
      {tab === "conversation" ? <>
        <section className="audit-paper-section"><h4><span>01</span>{submitted ? "实际发给 AI 的问题" : "留存请求参数 · 未发送"}</h4><p className="audit-paper-note">逐字显示保存的请求内容，长输入可在框内滚动查看；完整参数也可展开或下载。</p>{messages.length ? messages.map((message, index) => <TextBlock key={index} label={`消息 ${index + 1} · ${str(message.role) || "未标记角色"}`} content={message.content} />) : <>{request.prompt !== undefined ? <TextBlock label="生成提示词" content={request.prompt} /> : null}{content.map((part, index) => <TextBlock key={index} label={`输入 ${index + 1} · ${str(part.type) || "内容"}`} content={part.type === "text" ? part.text : part} />)}{!content.length && request.prompt === undefined ? <p className="audit-paper-empty">请求未包含可直接展示的文本；完整请求参数见下方。</p> : null}</>}<JsonBlock title="完整请求参数" value={record.request} /></section>
        <section className="audit-paper-section"><h4><span>02</span>{submitted ? "AI 实际返回的内容" : "响应记录"}</h4>{!submitted ? <p className="audit-paper-empty">请求未发出，没有 AI 返回内容。</p> : <>{choices.map((choice, index) => { const message = obj(choice.message); return <div className="audit-paper-choice" key={index}><div className="audit-paper-choice-heading">返回 {index + 1}<span>finish_reason: {str(choice.finish_reason) || "未返回"}</span></div>{message.content !== undefined && message.content !== null && message.content !== "" ? <TextBlock label="最终回答 · 原文" content={message.content} /> : <p className="audit-paper-empty">上游没有返回最终回答。{gradeStatus === "truncated" ? "本次输出达到长度上限，已标记截断。" : ""}</p>}{message.reasoning_content !== undefined && message.reasoning_content !== null && message.reasoning_content !== "" ? <JsonBlock title="上游返回的推理内容" value={message.reasoning_content} /> : null}{["reasoning", "reasoning_details"].map(field => message[field] !== undefined && message[field] !== null && message[field] !== "" ? <JsonBlock key={field} title={`上游返回的推理内容 · ${field}`} value={message[field]} /> : null)}{message.tool_calls !== undefined ? <JsonBlock title="上游返回的工具调用" value={message.tool_calls} /> : null}</div>; })}{media.map((item, index) => <MediaPreview key={`${item.url}:${index}`} media={item} />)}{!media.length && str(record.kind) !== "chat" ? <p className="audit-paper-empty">{str(record.state) === "pending_video" ? "视频任务已提交，尚未保存生成文件。这里仅展示已有底稿。" : response.error ? "本次上游返回错误，没有生成文件。错误原文见下方。" : "该条保存的响应中没有可预览的生成文件。"}</p> : null}{response.error !== undefined ? <TextBlock label="上游错误原文" content={response.error} /> : null}{!choices.length && str(record.kind) === "chat" && !response.error ? <p className="audit-paper-empty">{responseExists ? "没有标准格式的最终回答，请查看完整上游响应。" : "未收到可保存的上游响应，不能还原或推测 AI 回答。"}</p> : null}<JsonBlock title="完整上游响应" value={record.response} />{record.creationResponse ? <JsonBlock title="视频任务创建时的响应" value={record.creationResponse} /> : null}</>}{items(record.flags).length ? <JsonBlock title="本次检测记录的提示" value={record.flags} /> : null}</section>
      </> : null}
      {tab === "grading" ? <section className="audit-paper-section"><h4>标准答案与评分依据</h4><p className="audit-paper-note">以下依据来自本次检测保存的标准答案和判分记录。截断、超时与校验码异常均保留原文，不冒充有效能力分数。</p>{expectedAnswers.length ? <div className="audit-paper-table-scroll"><table className="audit-paper-table"><thead><tr><th>题项</th><th>标准答案</th><th>返回答案</th><th>已记录判分</th></tr></thead><tbody>{expectedAnswers.map((value, index) => <tr key={index}><th>{["A · 状态运算", "B · 背包优化", "C · 最短路径", "D · 信息提取"][index] || `题 ${index + 1}`}</th><td><code>{printable(value)}</code></td><td><code>{printable(actualAnswers[index])}</code></td><td>{supportsItems && typeof subitems[index] === "boolean" ? subitems[index] ? "正确" : "错误" : gradeStatus === "invalid_json" ? "答案格式错误" : "未计分"}</td></tr>)}</tbody></table></div> : <p className="audit-paper-empty">该项为媒体生成抽样，按画面与生成要求人工核验，不套用文字题正确率。</p>}{expected.manualReview ? <TextBlock label="本次媒体核验标准" content={expected.manualReview} /> : null}<JsonBlock title="完整标准答案与测试规则" value={record.expected} /><JsonBlock title="保存的评分记录" value={record.grading} open /><JsonBlock title="独立离线核验结果" value={record.independentAnalysis} /></section> : null}
      {tab === "usage" ? <section className="audit-paper-section"><h4>Token、费用与账单依据</h4><div className="audit-paper-facts"><div><span>按返回用量估算</span><strong>{money(record.derivedExpectedCostMicros)}</strong></div><div><span>实际账单记录</span><strong>{money(record.billingActualMicros)}</strong></div><div><span>账单对照</span><strong>{record.billingVerification === "recorded" ? "已留存账单" : "待对账"}</strong></div></div><p className="audit-paper-note">用量为上游返回值；预留额度不是实际扣费。官方分词复核、价格快照与账单证据分别保留，缺失值显示为待核对。</p><JsonBlock title="上游返回的 Token 用量" value={record.usage} open /><JsonBlock title="官方分词器与独立分析" value={record.independentAnalysis} /><JsonBlock title="实际扣费凭据" value={record.billingEvidence} /><JsonBlock title="请求时的价格快照" value={record.priceSnapshot} /></section> : null}
      {tab === "raw" ? <section className="audit-paper-section"><h4>完整原始记录</h4><p className="audit-paper-note">含完整请求与响应、时间、模型 ID、校验哈希、评分依据和账单记录。这里读取已保存的数据，不重新调用模型。</p><div className="audit-paper-identifiers"><span>检测记录</span><code>{str(record.caseId)}</code><span>请求 SHA-256</span><code>{str(record.requestHash) || "未记录"}</code><span>响应 SHA-256</span><code>{str(record.responseHash) || "未记录"}</code><span>返回模型 ID</span><code>{str(record.returnedModel) || "上游未返回"}</code><span>视频任务 ID</span><code>{str(record.taskId) || "不适用 / 未返回"}</code><span>最近保存</span><code>{timestamp(record.updatedAt)}</code></div><JsonBlock title="完整检测底稿 JSON" value={evidence} open /></section> : null}
    </div>
  </article>;
}

export function filterEvidenceRecords(records: AuditEvidenceRecord[], filter: { day: string; model: string; status: string }) {
  return records.filter(record => {
    if (filter.day !== "all" && Math.floor(record.slot / 2) !== Number(filter.day)) return false;
    if (filter.model !== "all" && record.model !== filter.model) return false;
    if (filter.status === "submitted") return !!record.submittedAt;
    if (filter.status === "unsent") return !record.submittedAt;
    if (filter.status === "success") return record.state === "succeeded";
    if (filter.status === "issues") return record.state !== "succeeded" || !["passed", "manual_review_pending"].includes(record.gradingStatus);
    return true;
  }).sort((a, b) => a.slot - b.slot || a.caseId.localeCompare(b.caseId));
}

export function TokenHubAuditEvidence({ campaignId, startedAt, records, models, initialFilter = {} }: { campaignId: string; startedAt: string; records: AuditEvidenceRecord[]; models: Model[]; initialFilter?: AuditEvidenceFilter }) {
  const [day, setDay] = useState(initialFilter.day === undefined ? "all" : String(initialFilter.day));
  const [model, setModel] = useState(initialFilter.model || "all");
  const [status, setStatus] = useState("submitted");
  const [chosen, setChosen] = useState(initialFilter.caseId && initialFilter.slot !== undefined ? `${initialFilter.slot}:${initialFilter.caseId}` : "");
  const [retry, setRetry] = useState(0);
  const [loaded, setLoaded] = useState<{ key: string; data?: Evidence; error?: string } | null>(null);
  const filtered = filterEvidenceRecords(records, { day, model, status });
  const selected = filtered.find(record => recordKey(record) === chosen) || filtered[0];
  const selectedKey = selected ? `${campaignId}/${recordKey(selected)}` : "";
  const path = selected ? evidenceUrl(campaignId, selected) : "";
  const loadKey = `${selectedKey}/${selected?.updatedAt || ""}`;
  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    fetch(path, { credentials: "same-origin", cache: "no-store", signal: controller.signal }).then(async response => {
      const data: unknown = await response.json();
      if (!response.ok) throw new Error(response.status === 404 ? "这条检测尚无已保存底稿；可能还未执行。请刷新列表查看。" : str(obj(data).error) || "底稿读取失败，请稍后重试。");
      const parsed = data as Evidence;
      if (parsed.campaign?.id !== campaignId || `${campaignId}/${String(parsed.case?.slot)}:${str(parsed.case?.caseId)}` !== selectedKey) throw new Error("底稿记录与所选请求不一致，请重新读取。");
      if (!controller.signal.aborted) setLoaded({ key: loadKey, data: parsed });
    }).catch(error => { if (!controller.signal.aborted) setLoaded({ key: loadKey, error: error instanceof Error ? error.message : "底稿读取失败。" }); });
    return () => controller.abort();
  }, [campaignId, path, retry, selectedKey, loadKey]);
  const current = loaded?.key === loadKey ? loaded : null;
  function changeFilter(update: () => void) { setChosen(""); update(); }
  return <section className="audit-workpapers" id="audit-workpapers" aria-labelledby="audit-workpapers-heading">
    <div className="audit-section-heading"><div><span className="audit-eyebrow">DAILY TEST WORKPAPERS</span><h2 id="audit-workpapers-heading">检测底稿 · 每次问了什么，返回了什么</h2></div><span>{records.filter(record => record.submittedAt).length} 条已发出请求 · 只读已保存记录</span></div>
    <p className="audit-paper-intro">逐条查看真实问题、完整回答、图片或视频，以及标准答案、Token 和账单依据。点击上方每日卡片，也可直接定位对应模型的底稿。</p>
    <div className="audit-paper-filters"><label>检测日<select aria-label="底稿检测日" value={day} onChange={event => changeFilter(() => setDay(event.target.value))}><option value="all">全部 7 天</option>{Array.from({ length: 7 }, (_, index) => { const date = new Date(new Date(startedAt).getTime() + index * 86400000); return <option key={index} value={String(index)}>DAY {index + 1} · {date.toLocaleDateString("zh-CN", { timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit" })}</option>; })}</select></label><label>模型<select aria-label="底稿模型" value={model} onChange={event => changeFilter(() => setModel(event.target.value))}><option value="all">全部模型</option>{models.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>记录状态<select aria-label="底稿记录状态" value={status} onChange={event => changeFilter(() => setStatus(event.target.value))}><option value="submitted">已发出请求</option><option value="success">上游已返回</option><option value="issues">异常或待复核</option><option value="unsent">未发出的执行记录</option><option value="all">全部已留存记录</option></select></label><span>{filtered.length} 条</span>{day !== "all" || model !== "all" || status !== "submitted" ? <button type="button" className="console-button" onClick={() => { setDay("all"); setModel("all"); setStatus("submitted"); setChosen(""); }}>清除筛选</button> : null}</div>
    {!filtered.length ? <div className="audit-paper-empty audit-paper-no-records"><Icon name="book" size={25} /><h3>该筛选下暂无已保存底稿</h3><p>当日尚未实际调用，或该模型仅做目录观察时，不会生成问答或媒体底稿。未来计划不会显示成已完成检测。</p>{records.some(record => !record.submittedAt && (day === "all" || Math.floor(record.slot / 2) === Number(day)) && (model === "all" || record.model === model)) ? <button className="console-button" type="button" onClick={() => setStatus("unsent")}>查看未发出的执行记录</button> : null}</div> : <div className="audit-paper-layout"><nav className="audit-paper-list" aria-label="检测底稿列表">{filtered.map(record => <button key={recordKey(record)} type="button" className={selected && recordKey(selected) === recordKey(record) ? "is-selected" : ""} aria-current={selected && recordKey(selected) === recordKey(record) ? "true" : undefined} onClick={() => setChosen(recordKey(record))}><span>DAY {Math.floor(record.slot / 2) + 1}<small>{record.kind === "chat" ? record.caseId.endsWith("long") ? "长输入" : "短输入" : record.kind === "image" ? "图片" : "视频"}</small></span><strong>{models.find(item => item.id === record.model)?.name || record.model}</strong><small>{stateLabels[record.state] || record.state}{record.gradingStatus === "truncated" ? " · 截断" : ""}</small><time>{timestamp(record.submittedAt || record.updatedAt)}</time></button>)}</nav><div className="audit-paper-reader" aria-live="polite">{!current ? <div className="audit-paper-empty" role="status">正在读取这条检测的原始底稿…</div> : current.error ? <div className="audit-paper-empty" role="alert"><p>{current.error}</p><button type="button" className="console-button" onClick={() => { setLoaded(null); setRetry(value => value + 1); }}>重新读取底稿</button></div> : current.data ? <AuditEvidenceDetail key={selectedKey} evidence={current.data} downloadUrl={`${path}&download=1`} onReload={() => { setLoaded(null); setRetry(value => value + 1); }} /> : null}</div></div>}
  </section>;
}
