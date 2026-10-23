"use client";

import { useSiteLocale } from "./LocaleProvider";

import { useRef, useState } from "react";
import { Icon } from "./Icon";

type ApiKeyRecord = { id: string; label: string; key_prefix: string; created_at: string; last_used_at: string | null; revoked_at: string | null };

function timestamp(value: string | null, english = false) {
  if (!value) return english ? "Never used" : "尚未使用";
  const date = new Date(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(english ? "en-GB" : "zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
}

export function ApiKeysPanel({ initialKeys }: { initialKeys: ApiKeyRecord[] }) {
  const { t, isEnglish } = useSiteLocale();
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
      if (!response.ok || !result.key || !result.record) throw new Error(result.error === "Active key limit reached." ? t("有效密钥数量已达上限，请先停用不再使用的密钥。", "You have reached the active key limit. Revoke an unused key first.") : (isEnglish ? "Could not create the key. Please try again." : result.error) || t("密钥创建失败。", "Could not create the key. Please try again."));
      setCreatedKey(result.key);
      setKeys((current) => [{ ...result.record!, created_at: new Date().toISOString(), last_used_at: null, revoked_at: null }, ...current]);
      setLabel("");
      dialog.current?.close();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("密钥创建失败。", "Could not create the key. Please try again."));
    } finally {
      setPending(false);
    }
  }

  async function revokeKey(id: string) {
    if (!window.confirm(t("停用后无法恢复，确认继续？", "Revoking this key cannot be undone. Continue?"))) return;
    setRevoking(id);
    setMessage("");
    try {
      const response = await fetch(`/api/keys?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!response.ok) throw new Error(t("密钥停用失败，请重试。", "Could not revoke the key. Please try again."));
      setKeys((current) => current.map((item) => item.id === id ? { ...item, revoked_at: new Date().toISOString() } : item));
      setMessage(t("密钥已停用。", "The key has been revoked."));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("密钥停用失败，请重试。", "Could not revoke the key. Please try again."));
    } finally {
      setRevoking("");
    }
  }

  async function copyKey() {
    try {
      await navigator.clipboard.writeText(createdKey);
      setMessage(t("密钥已复制。", "Key copied."));
    } catch {
      setMessage(t("无法访问剪贴板，请选中密钥手动复制。", "Clipboard access is unavailable. Select and copy the key manually."));
    }
  }

  return (
    <>
      <header className="console-page-heading"><div><h1>{t("API 密钥", "API keys")}</h1><p>{t("创建和管理 API 访问凭证。", "Create and manage API access credentials.")}</p></div><button className="console-button console-button-primary" type="button" onClick={() => { setMessage(""); dialog.current?.showModal(); }}><Icon name="plus" size={16} />{t("创建 API 密钥", "Create API key")}</button></header>
      {createdKey ? <section className="console-created-key" role="status"><div className="console-created-key-heading"><span className="console-square-icon"><Icon name="key" size={18} /></span><div><strong>{t("您的新 API 密钥", "Your new API key")}</strong><p>{t("完整密钥仅在本次显示，请复制并保存。", "The complete key is shown only once. Copy and save it now.")}</p></div><button className="console-icon-button" aria-label={t("关闭密钥提示", "Dismiss key notice")} onClick={() => setCreatedKey("")} type="button"><Icon name="close" size={17} /></button></div><div className="console-key-copy"><code>{createdKey}</code><button className="console-button" onClick={copyKey} type="button"><Icon name="copy" size={14} />{t("复制密钥", "Copy key")}</button></div></section> : null}
      {message ? <p className="console-notice" role="status">{message}</p> : null}
      <section className="console-panel console-keys-panel">
        <div className="console-filter-bar"><label className="console-search"><Icon name="search" size={16} /><input placeholder={t("搜索密钥名称", "Search key names")} aria-label={t("搜索密钥名称", "Search key names")} value={query} onChange={(event) => setQuery(event.target.value)} /></label><select aria-label={t("密钥状态", "Key status")} value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">{t("所有状态", "All statuses")}</option><option value="active">{t("使用中", "Active")}</option><option value="revoked">{t("已停用", "Revoked")}</option></select><span className="console-filter-count">{keys.filter((key) => !key.revoked_at).length} {t("个有效密钥", "active keys")}</span></div>
        <div className="console-table-wrap"><table className="console-table console-keys-table"><thead><tr><th>{t("名称", "Name")}</th><th>{t("API 密钥", "API keys")}</th><th>{t("状态", "Status")}</th><th>{t("创建时间", "Created")}</th><th>{t("最后使用", "Last used")}</th><th>{t("操作", "Actions")}</th></tr></thead><tbody>{visibleKeys.length ? visibleKeys.map((item) => <tr className={item.revoked_at ? "console-revoked" : ""} key={item.id}><td><span className="console-key-name"><Icon name="key" size={15} /><strong>{item.label}</strong></span></td><td><code>{item.key_prefix}••••••••••••</code></td><td><span className={`console-status${item.revoked_at ? " console-status-muted" : ""}`}><i />{item.revoked_at ? t("已停用", "Revoked") : t("使用中", "Active")}</span></td><td>{timestamp(item.created_at, isEnglish)}</td><td>{timestamp(item.last_used_at, isEnglish)}</td><td>{!item.revoked_at ? <button className="console-row-action" onClick={() => revokeKey(item.id)} disabled={revoking === item.id} type="button">{revoking === item.id ? t("停用中…", "Revoking…") : t("停用", "Revoke")}</button> : <span className="console-subtle">—</span>}</td></tr>) : <tr><td colSpan={6}><div className="console-empty"><Icon name="key" size={30} /><strong>{keys.length ? t("没有匹配的密钥", "No matching keys") : t("创建您的第一枚 API 密钥", "Create your first API key")}</strong><span>{keys.length ? t("尝试其他搜索条件。", "Try a different search.") : t("使用密钥将 tokvilo 接入您的应用。", "Connect your application to tokvilo with an API key.")}</span>{!keys.length ? <button className="console-button console-button-primary" type="button" onClick={() => dialog.current?.showModal()}><Icon name="plus" size={15} />{t("创建 API 密钥", "Create API key")}</button> : null}</div></td></tr>}</tbody></table></div>
        <footer className="console-table-footer"><span>{t(`显示 ${visibleKeys.length} 条 · 全部有效密钥与最近 20 条停用记录`, `${visibleKeys.length} records · All active keys and the latest 20 revoked keys`)}</span><span>{t("时间以北京时间显示", "Times shown in China Standard Time (UTC+8)")}</span></footer>
      </section>
      <div className="console-info-note"><Icon name="shield" size={16} /><p>{t("密钥用于验证 API 请求。请将密钥保存在服务端环境变量中，并为不同应用创建独立密钥。", "API keys authenticate your requests. Store keys in server environment variables and create a separate key for each application.")}</p></div>
      <dialog className="console-dialog" ref={dialog} aria-labelledby="create-key-title"><form onSubmit={createKey}><header><h2 id="create-key-title">{t("创建 API 密钥", "Create API key")}</h2><button className="console-icon-button" type="button" onClick={() => dialog.current?.close()} aria-label={t("关闭", "Close")}><Icon name="close" size={17} /></button></header><p>{t("为您的应用创建独立的访问凭证。", "Create a dedicated credential for your application.")}</p><label htmlFor="console-key-label">{t("密钥名称", "Key name")}</label><input id="console-key-label" autoFocus maxLength={60} value={label} onChange={(event) => setLabel(event.target.value)} placeholder={t("例如：My application", "For example: My application")} required />{message ? <p className="console-dialog-message" role="alert">{message}</p> : null}<footer><button className="console-button" onClick={() => dialog.current?.close()} type="button">{t("取消", "Cancel")}</button><button className="console-button console-button-primary" disabled={pending} type="submit">{pending ? t("创建中…", "Creating…") : t("创建密钥", "Create key")}</button></footer></form></dialog>
    </>
  );
}
