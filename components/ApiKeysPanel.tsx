"use client";

import { useRef, useState } from "react";
import { Icon } from "./Icon";

type ApiKeyRecord = { id: string; label: string; key_prefix: string; created_at: string; last_used_at: string | null; revoked_at: string | null };

function timestamp(value: string | null) {
  if (!value) return "尚未使用";
  const date = new Date(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
}

export function ApiKeysPanel({ initialKeys }: { initialKeys: ApiKeyRecord[] }) {
  const [keys, setKeys] = useState(initialKeys);
  const [createdKey, setCreatedKey] = useState("");
  const [label, setLabel] = useState("");
  const [pending, setPending] = useState(false);
  const [revoking, setRevoking] = useState("");
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const dialog = useRef<HTMLDialogElement>(null);
  const visibleKeys = keys.filter((key) => `${key.label} ${key.key_prefix}`.toLowerCase().includes(query.toLowerCase()) && (status === "all" || (status === "active" ? !key.revoked_at : Boolean(key.revoked_at))));

  async function createKey(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage("");
    try {
      const response = await fetch("/api/keys", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ label }) });
      const result = (await response.json()) as { error?: string; key?: string; record?: ApiKeyRecord };
      if (!response.ok || !result.key || !result.record) throw new Error(result.error === "Active key limit reached." ? "有效密钥数量已达上限，请先停用不再使用的密钥。" : result.error || "密钥创建失败。");
      setCreatedKey(result.key);
      setKeys((current) => [{ ...result.record!, created_at: new Date().toISOString(), last_used_at: null, revoked_at: null }, ...current]);
      setLabel("");
      dialog.current?.close();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "密钥创建失败。");
    } finally {
      setPending(false);
    }
  }

  async function revokeKey(id: string) {
    if (!window.confirm("停用后无法恢复，确认继续？")) return;
    setRevoking(id);
    setMessage("");
    try {
      const response = await fetch(`/api/keys?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!response.ok) throw new Error("密钥停用失败，请重试。");
      setKeys((current) => current.map((item) => item.id === id ? { ...item, revoked_at: new Date().toISOString() } : item));
      setMessage("密钥已停用。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "密钥停用失败，请重试。");
    } finally {
      setRevoking("");
    }
  }

  async function copyKey() {
    try {
      await navigator.clipboard.writeText(createdKey);
      setMessage("密钥已复制。");
    } catch {
      setMessage("无法访问剪贴板，请选中密钥手动复制。");
    }
  }

  return (
    <>
      <header className="console-page-heading"><div><h1>API 密钥</h1><p>创建和管理 API 访问凭证。</p></div><button className="console-button console-button-primary" type="button" onClick={() => { setMessage(""); dialog.current?.showModal(); }}><Icon name="plus" size={16} />创建 API 密钥</button></header>
      {createdKey ? <section className="console-created-key" role="status"><div className="console-created-key-heading"><span className="console-square-icon"><Icon name="key" size={18} /></span><div><strong>您的新 API 密钥</strong><p>完整密钥仅在本次显示，请复制并保存。</p></div><button className="console-icon-button" aria-label="关闭密钥提示" onClick={() => setCreatedKey("")} type="button"><Icon name="close" size={17} /></button></div><div className="console-key-copy"><code>{createdKey}</code><button className="console-button" onClick={copyKey} type="button"><Icon name="copy" size={14} />复制密钥</button></div></section> : null}
      {message ? <p className="console-notice" role="status">{message}</p> : null}
      <section className="console-panel console-keys-panel">
        <div className="console-filter-bar"><label className="console-search"><Icon name="search" size={16} /><input placeholder="搜索密钥名称" aria-label="搜索密钥名称" value={query} onChange={(event) => setQuery(event.target.value)} /></label><select aria-label="密钥状态" value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">所有状态</option><option value="active">使用中</option><option value="revoked">已停用</option></select><span className="console-filter-count">{keys.filter((key) => !key.revoked_at).length} 个有效密钥</span></div>
        <div className="console-table-wrap"><table className="console-table console-keys-table"><thead><tr><th>名称</th><th>API 密钥</th><th>状态</th><th>创建时间</th><th>最后使用</th><th>操作</th></tr></thead><tbody>{visibleKeys.length ? visibleKeys.map((item) => <tr className={item.revoked_at ? "console-revoked" : ""} key={item.id}><td><span className="console-key-name"><Icon name="key" size={15} /><strong>{item.label}</strong></span></td><td><code>{item.key_prefix}••••••••••••</code></td><td><span className={`console-status${item.revoked_at ? " console-status-muted" : ""}`}><i />{item.revoked_at ? "已停用" : "使用中"}</span></td><td>{timestamp(item.created_at)}</td><td>{timestamp(item.last_used_at)}</td><td>{!item.revoked_at ? <button className="console-row-action" onClick={() => revokeKey(item.id)} disabled={revoking === item.id} type="button">{revoking === item.id ? "停用中…" : "停用"}</button> : <span className="console-subtle">—</span>}</td></tr>) : <tr><td colSpan={6}><div className="console-empty"><Icon name="key" size={30} /><strong>{keys.length ? "没有匹配的密钥" : "创建您的第一枚 API 密钥"}</strong><span>{keys.length ? "尝试其他搜索条件。" : "使用密钥将 ECO-GEO 接入您的应用。"}</span>{!keys.length ? <button className="console-button console-button-primary" type="button" onClick={() => dialog.current?.showModal()}><Icon name="plus" size={15} />创建 API 密钥</button> : null}</div></td></tr>}</tbody></table></div>
        <footer className="console-table-footer"><span>显示 {visibleKeys.length} 条 · 全部有效密钥与最近 20 条停用记录</span><span>时间以北京时间显示</span></footer>
      </section>
      <div className="console-info-note"><Icon name="shield" size={16} /><p>密钥用于验证 API 请求。请将密钥保存在服务端环境变量中，并为不同应用创建独立密钥。</p></div>
      <dialog className="console-dialog" ref={dialog} aria-labelledby="create-key-title"><form onSubmit={createKey}><header><h2 id="create-key-title">创建 API 密钥</h2><button className="console-icon-button" type="button" onClick={() => dialog.current?.close()} aria-label="关闭"><Icon name="close" size={17} /></button></header><p>为您的应用创建独立的访问凭证。</p><label htmlFor="console-key-label">密钥名称</label><input id="console-key-label" autoFocus maxLength={60} value={label} onChange={(event) => setLabel(event.target.value)} placeholder="例如：My application" required />{message ? <p className="console-dialog-message" role="alert">{message}</p> : null}<footer><button className="console-button" onClick={() => dialog.current?.close()} type="button">取消</button><button className="console-button console-button-primary" disabled={pending} type="submit">{pending ? "创建中…" : "创建密钥"}</button></footer></form></dialog>
    </>
  );
}
