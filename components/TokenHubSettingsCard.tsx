"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { Icon } from "./Icon";

type Status = { configured: boolean; source: "saved" | "environment" | "none"; keyHint: string | null; updatedAt: string | null; verifiedAt: string | null };
type Model = { id: string; name?: string; provider: string; category: string[]; accountAccess?: string; integrationStatus?: string };
type Catalog = { complete: boolean; observedAt: string; warnings: string[] };
type Notice = { error?: boolean; text: string } | null;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, credentials: "same-origin", cache: "no-store" });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result) throw new Error(typeof result?.error === "string" ? result.error : "暂时无法完成请求，请稍后重试。");
  return result as T;
}

export function TokenHubSettingsCard() {
  const [status, setStatus] = useState<Status | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [pending, setPending] = useState<"save" | "test" | "models" | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [models, setModels] = useState<Model[] | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [query, setQuery] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    request<{ tokenhub: Status }>("/api/admin/providers/tokenhub", { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) { setStatus(result.tokenhub); setLoadError(""); } })
      .catch(error => { if (!controller.signal.aborted) setLoadError(error instanceof Error ? error.message : "配置状态读取失败。"); });
    return () => controller.abort();
  }, [attempt]);

  const filtered = useMemo(() => (models || []).filter(model => `${model.id} ${model.provider} ${model.category.join(" ")}`.toLowerCase().includes(query.trim().toLowerCase())), [models, query]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || !apiKey.trim()) return;
    setPending("save"); setNotice(null);
    try {
      const result = await request<{ tokenhub: Status; modelCount: number; catalog?: Catalog }>("/api/admin/providers/tokenhub", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ apiKey: apiKey.trim() }) });
      setStatus(result.tokenhub); setApiKey(""); setModels(null); setQuery(""); setCatalog(result.catalog || null);
      setNotice({ text: `TokenHub 密钥已验证并加密保存。${result.catalog?.complete ? "完整目录" : "当前部分目录"} ${result.modelCount} 个模型，已接入统一工作台。${result.catalog?.warnings?.length ? ` ${result.catalog.warnings.join("；")}` : ""}` });
    } catch (error) { setNotice({ error: true, text: error instanceof Error ? error.message : "密钥保存失败。" }); }
    finally { setPending(null); }
  }

  async function load(action: "test" | "models") {
    if (pending) return;
    setPending(action); setNotice(null);
    try {
      const result = await request<{ models?: Model[]; verifiedAt?: string; modelCount?: number; catalog?: Catalog }>(`/api/admin/providers/tokenhub/${action}`, action === "test" ? { method: "POST" } : undefined);
      if (result.models) setModels(result.models);
      setCatalog(result.catalog || null);
      if (result.verifiedAt) setStatus(current => current ? { ...current, verifiedAt: result.verifiedAt! } : current);
      setNotice({ text: `${action === "test" ? "已验证保存的凭证。" : "已汇总模型接口与公开价格目录。"}${result.catalog?.complete ? "完整目录" : "当前部分目录"} ${result.models?.length ?? result.modelCount ?? 0} 个模型；目录可见与实际调用成功分别核验。${result.catalog?.warnings?.length ? ` ${result.catalog.warnings.join("；")}` : ""}` });
    } catch (error) { setNotice({ error: true, text: error instanceof Error ? error.message : "连接请求失败。" }); }
    finally { setPending(null); }
  }

  return <article className="provider-card provider-tokenhub">
    <div className="provider-card-heading"><span className="provider-monogram tokenhub" aria-hidden="true"><Icon name="layers" size={22} /></span><div><h3>Tianshu TokenHub</h3><p>视频、图像与语言模型</p></div><span className={`provider-status ${status?.configured ? "is-configured" : ""}`}><span aria-hidden="true" />{status === null ? "读取中…" : status.configured ? status.verifiedAt ? "已验证" : "已配置" : "未配置"}</span></div>
    <p className="provider-description">统一接入 TokenHub 的对话、图像与视频模型。模型与价格目录合并展示，新增已识别类型自动进入工作台。</p>
    {loadError ? <div className="provider-load-error" role="alert"><span>{loadError}</span><button className="button button-ghost" type="button" onClick={() => setAttempt(value => value + 1)}>重新读取</button></div> : null}
    <div className="tokenhub-settings-columns">
      <div>
        {status?.configured ? <div className="provider-saved-key"><div><span>当前密钥</span><code>{status.keyHint || "••••••••"}</code></div><span>{status.source === "saved" ? "后台保存" : "环境配置"}</span></div> : null}
        <form className="provider-key-form" onSubmit={save}>
          <label htmlFor="tokenhub-api-key">{status?.configured ? "更换 TokenHub API Key" : "TokenHub API Key"}</label>
          <input id="tokenhub-api-key" type="password" name="tokenhub-api-key" autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={512} disabled={!!pending || !status} value={apiKey} onChange={event => setApiKey(event.target.value)} placeholder="粘贴 TokenHub 的 API Key" aria-describedby="tokenhub-key-help" />
          <p className="provider-field-help" id="tokenhub-key-help">验证后加密保存，仅显示末尾掩码。留空不会修改当前配置。</p>
          <div className="provider-actions"><button className="button button-primary" disabled={!!pending || !status || !apiKey.trim()} type="submit">{pending === "save" ? "验证并保存中…" : "验证并保存"}</button><a className="provider-key-link" href="https://ai-tokenhub.ai/en/cubex" target="_blank" rel="noopener noreferrer">TokenHub 控制台 ↗</a></div>
        </form>
      </div>
      <div className="tokenhub-provider-detail">
        <div className="provider-endpoint"><span>ECO-GEO 统一接口</span><code>/api/tokenhub/*</code><span>管理员工作台与管理员名下的 ECO-GEO API 密钥可调用。</span></div>
        <div className="provider-actions"><button className="button button-ghost" disabled={!!pending || !status?.configured} onClick={() => load("test")} type="button">{pending === "test" ? "测试中…" : "测试已保存连接"}</button><button className="button button-ghost" disabled={!!pending || !status?.configured} onClick={() => load("models")} type="button">{pending === "models" ? "读取中…" : "读取全量目录"}</button><Link className="button button-primary" href="/tokenhub">打开工作台 <Icon name="arrow-up-right" size={13} /></Link></div>
        <p className="provider-field-help">{status?.verifiedAt ? `最近验证：${new Date(status.verifiedAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })}（北京时间）。` : "保存密钥后可测试连接。"}实际调用按 TokenHub 账户余额与模型价格计费。</p>
      </div>
    </div>
    {notice ? <p className={`provider-notice ${notice.error ? "error" : "success"}`} role={notice.error ? "alert" : "status"}>{notice.text}</p> : null}
    {models ? <div className="tokenhub-provider-models"><div className="panel-header"><h3>TokenHub {catalog?.complete ? "完整" : "当前部分"}模型目录</h3><span className="record-count">{filtered.length} / {models.length}</span></div><input aria-label="搜索 TokenHub 模型" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索 Seedance、模型 ID 或提供方" /><ul className="provider-model-list">{filtered.map((model, index) => <li key={`${model.id}:${index}`}><div><code>{model.id}</code><span>{model.name && model.name !== model.id ? `${model.name} · ` : ""}{model.provider || "TokenHub"}{model.accountAccess === "unverified_public_catalog" ? " · 公开目录，账户权限待确认" : ""}</span></div><div className="provider-model-tags">{model.category.map(item => <span key={item}>{item}</span>)}</div></li>)}</ul>{!filtered.length ? <p className="empty-state">没有匹配的模型。</p> : null}</div> : null}
  </article>;
}
