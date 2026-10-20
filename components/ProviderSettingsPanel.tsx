"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { TokenHubSettingsCard } from "./TokenHubSettingsCard";

type ApimartStatus = {
  configured: boolean;
  source: "saved" | "environment" | "none";
  keyHint: string | null;
  updatedAt: string | null;
  verifiedAt: string | null;
};

type ProviderStatus = {
  upstream: { configured: boolean };
  apimart: ApimartStatus;
};

type Quota = { remaining: number | null; unlimited: boolean };
type Model = { id: string; provider: string; category: string[] };
type Notice = { kind: "success" | "warning" | "error"; text: string } | null;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    cache: "no-store",
  });
  const result = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!response.ok || !result) {
    throw new Error(result?.error || "暂时无法完成请求，请稍后重试。");
  }
  return result;
}

function displayTime(value: string | null) {
  if (!value) return "尚无记录";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "尚无记录";
  return date.toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function StatusBadge({ configured, verifiedAt, verificationRequired = false, saved = false }: { configured?: boolean; verifiedAt?: string | null; verificationRequired?: boolean; saved?: boolean }) {
  return (
    <span className={`provider-status ${configured && (!verificationRequired || verifiedAt) ? "is-configured" : ""}`}>
      <span aria-hidden="true" />
      {configured === undefined ? "读取中…" : !configured ? "未配置" : !verificationRequired ? "已配置" : verifiedAt ? "已验证" : saved ? "已保存·待验证" : "已配置·待验证"}
    </span>
  );
}

export function ProviderSettingsPanel() {
  const [providers, setProviders] = useState<ProviderStatus | null>(null);
  const [loadError, setLoadError] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [apiKey, setApiKey] = useState("");
  const [pending, setPending] = useState<"save" | "test" | "models" | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [quota, setQuota] = useState<Quota | null>(null);
  const [models, setModels] = useState<Model[] | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");

  useEffect(() => {
    const controller = new AbortController();
    request<ProviderStatus>("/api/admin/providers", { signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted) setProviders(result);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setLoadError(error instanceof Error ? error.message : "配置状态读取失败。");
        }
      });
    return () => controller.abort();
  }, [loadAttempt]);

  const categories = useMemo(
    () => [...new Set((models || []).flatMap((model) => model.category))].sort(),
    [models],
  );
  const filteredModels = useMemo(() => {
    const search = query.trim().toLowerCase();
    return (models || []).filter(
      (model) =>
        (category === "all" || model.category.includes(category)) &&
        (!search || `${model.id} ${model.provider} ${model.category.join(" ")}`.toLowerCase().includes(search)),
    );
  }, [models, query, category]);

  async function saveKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || !apiKey.trim()) return;
    setPending("save");
    setNotice(null);
    try {
      const result = await request<{ ok: true; apimart: ApimartStatus; quota: Quota | null; warning?: string | null }>(
        "/api/admin/providers/apimart",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ apiKey: apiKey.trim() }),
        },
      );
      setProviders((current) => current ? { ...current, apimart: result.apimart } : current);
      setApiKey("");
      setQuota(result.quota);
      setModels(null);
      setQuery("");
      setCategory("all");
      setNotice(result.apimart.verifiedAt
        ? { kind: "success", text: "APIMart API Key 已验证并保存。你可以继续测试连接或读取模型目录。" }
        : { kind: "warning", text: result.warning || "密钥已加密保存，尚未完成验证。请稍后测试已保存连接。" });
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "API Key 保存失败。" });
    } finally {
      setPending(null);
    }
  }

  async function testConnection() {
    if (pending) return;
    setPending("test");
    setNotice(null);
    try {
      const result = await request<{ ok: true; quota: Quota; verifiedAt: string }>(
        "/api/admin/providers/apimart/test",
        { method: "POST" },
      );
      setQuota(result.quota);
      setProviders((current) => current ? {
        ...current,
        apimart: { ...current.apimart, verifiedAt: result.verifiedAt },
      } : current);
      setNotice({ kind: "success", text: "连接正常，已使用保存的 API Key 读取剩余额度。" });
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "连接测试失败。" });
    } finally {
      setPending(null);
    }
  }

  async function loadModels() {
    if (pending) return;
    setPending("models");
    setNotice(null);
    try {
      const result = await request<{ ok: true; models: Model[] }>("/api/admin/providers/apimart/models");
      setModels(result.models);
      setCategory("all");
      setNotice({ kind: "success", text: `模型目录已更新，共 ${result.models.length.toLocaleString()} 个模型。` });
    } catch (error) {
      setNotice({ kind: "error", text: error instanceof Error ? error.message : "模型目录读取失败。" });
    } finally {
      setPending(null);
    }
  }

  const apimart = providers?.apimart;
  const disabled = !!pending || !providers;

  return (
    <section className="panel provider-settings" aria-labelledby="provider-settings-title">
      <div className="panel-header">
        <div>
          <h2 id="provider-settings-title">服务连接</h2>
          <p className="provider-intro">你的社交数据与 AI 模型服务，都在这里。</p>
        </div>
        <span className="record-count">3 个服务</span>
      </div>

      {loadError ? (
        <div className="provider-load-error" role="alert">
          <span>{loadError}</span>
          <button className="button button-ghost" onClick={() => {
            setLoadError("");
            setLoadAttempt((value) => value + 1);
          }} type="button">重新读取</button>
        </div>
      ) : null}

      <div className="provider-grid">
        <article className="provider-card provider-existing">
          <div className="provider-card-heading">
            <span className="provider-monogram" aria-hidden="true">T</span>
            <div><h3>TikHub</h3><p>社交平台数据</p></div>
            <StatusBadge configured={providers?.upstream.configured} />
          </div>
          <p className="provider-description">已有的社交数据 API 上游，供 Eco-GEO 数据接口使用。</p>
          <div className="provider-existing-note">
            <span className="section-kicker">CURRENT PROVIDER</span>
            <strong>由部署环境管理</strong>
            <p>此处展示配置状态；现有接口与平台调用统计继续使用该服务。</p>
          </div>
          <div className="provider-endpoint"><span>tokvilo 数据接口</span><code>/api/v1/*</code><span>调用凭证与接口文档可在左侧导航中管理。</span></div>
        </article>

        <article className="provider-card provider-apimart">
          <div className="provider-card-heading">
            <span className="provider-monogram apimart" aria-hidden="true">A</span>
            <div><h3>APIMart</h3><p>AI 模型服务</p></div>
            <StatusBadge configured={apimart?.configured} verifiedAt={apimart?.verifiedAt} verificationRequired saved={apimart?.source === "saved"} />
          </div>
          <p className="provider-description">填写 API Key，验证连接并浏览可用模型目录。</p>

          {apimart?.configured ? (
            <div className="provider-saved-key">
              <div><span>当前密钥</span><code>{apimart.keyHint || "••••••••"}</code></div>
              <span>{apimart.source === "saved" ? "后台保存" : "环境配置"}</span>
            </div>
          ) : null}

          <form className="provider-key-form" onSubmit={saveKey}>
            <label htmlFor="apimart-api-key">{apimart?.configured ? "更换 API Key" : "APIMart API Key"}</label>
            <input
              aria-describedby="apimart-key-help"
              autoCapitalize="none"
              autoComplete="off"
              disabled={disabled}
              id="apimart-api-key"
              maxLength={512}
              name="apimart-api-key"
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={apimart?.configured ? "填写新的 API Key" : "粘贴你的 APIMart API Key"}
              spellCheck={false}
              type="password"
              value={apiKey}
            />
            <p id="apimart-key-help" className="provider-field-help">保存时尝试验证；余额不足时加密保存并标记待验证。已保存的密钥仅显示掩码，留空不会修改当前配置。</p>
            <div className="provider-actions">
              <button className="button button-primary" disabled={disabled || !apiKey.trim()} type="submit">
                {pending === "save" ? "保存并尝试验证中…" : "保存并尝试验证"}
              </button>
              <a className="provider-key-link" href="https://apimart.ai/keys" rel="noopener noreferrer" target="_blank">
                获取 API Key <span aria-hidden="true">↗</span>
              </a>
            </div>
          </form>

          <div className="provider-connection">
            <div className="provider-actions">
              <button className="button button-ghost" disabled={disabled || !apimart?.configured} onClick={testConnection} type="button">
                {pending === "test" ? "测试中…" : "测试已保存连接"}
              </button>
              <button className="button button-ghost" disabled={disabled || !apimart?.configured} onClick={loadModels} type="button">
                {pending === "models" ? "读取中…" : models ? "刷新模型目录" : "读取模型目录"}
              </button>
            </div>
            {apimart?.configured ? (
              <p className="provider-field-help">{apimart.verifiedAt ? `最近验证：${displayTime(apimart.verifiedAt)}（北京时间）` : "当前密钥尚未通过验证。若 APIMart 返回余额不足，请补充余额后测试已保存连接。"}</p>
            ) : null}
            {quota ? (
              <div className="provider-quota"><span>当前 API Key 剩余额度</span><strong>{quota.unlimited ? "未设置额度上限" : quota.remaining === null ? "暂无额度信息" : quota.remaining.toLocaleString("zh-CN", { maximumFractionDigits: 6 })}</strong></div>
            ) : null}
          </div>
        </article>
        <TokenHubSettingsCard />
      </div>

      {notice ? <p className={`provider-notice ${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"}>{notice.text}</p> : null}

      {models ? (
        <div className="provider-models">
          <div className="panel-header">
            <div><span className="section-kicker">APIMART MODEL CATALOG</span><h3>模型目录</h3></div>
            <span className="record-count">{filteredModels.length.toLocaleString()} / {models.length.toLocaleString()} 个模型</span>
          </div>
          <div className="provider-model-controls">
            <input aria-label="搜索模型" onChange={(event) => setQuery(event.target.value)} placeholder="搜索模型名称、提供方或类型" type="search" value={query} />
            <select aria-label="筛选模型类型" onChange={(event) => setCategory(event.target.value)} value={category}>
              <option value="all">全部类型</option>
              {categories.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </div>
          {filteredModels.length ? (
            <ul className="provider-model-list">
              {filteredModels.map((model, index) => (
                <li key={`${model.provider}:${model.id}:${index}`}>
                  <div><code>{model.id}</code><span>{model.provider || "未标注提供方"}</span></div>
                  <div className="provider-model-tags">{model.category.map((item) => <span key={item}>{item}</span>)}</div>
                </li>
              ))}
            </ul>
          ) : <p className="empty-state">{models.length ? "没有符合筛选条件的模型。" : "APIMart 暂未返回可用模型。"}</p>}
        </div>
      ) : null}

      <p className="provider-scope-note">TokenHub 已提供模型调用工作台。APIMart 支持密钥配置、连接验证、模型目录查询与请求预览。</p>
    </section>
  );
}
