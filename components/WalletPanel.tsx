"use client";

import { useEffect, useRef, useState } from "react";
import type { BillingConfig } from "@/lib/redemption";
import type { WalletSnapshot } from "@/lib/wallet";

type Batch = { id: string; amount_cny: number; credit_microusd: number; count: number; issued_count: number; redeemed_count: number; revoked_count: number };
type WalletResponse = { wallet: WalletSnapshot; billing: BillingConfig };
type ErrorResponse = { error?: { message?: string } };
const money = (micros: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 6 }).format(micros / 1_000_000);
const timestamp = (value: string) => new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", dateStyle: "short", timeStyle: "short" }).format(new Date(value.includes("T") ? value : value.replace(" ", "T") + "Z"));
async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, { cache: "no-store", ...(body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) });
  const result = await response.json() as T & ErrorResponse;
  if (!response.ok) throw new Error(result.error?.message || "请求未完成，请稍后重试。");
  return result;
}

export function WalletPanel({ userId, email, isAdmin }: { userId: string; email: string; isAdmin: boolean }) {
  return <WalletAccountPanel key={`${userId}:${isAdmin}`} userId={userId} email={email} isAdmin={isAdmin} />;
}

function WalletAccountPanel({ userId, email, isAdmin }: { userId: string; email: string; isAdmin: boolean }) {
  const [data, setData] = useState<WalletResponse | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");
  const [code, setCode] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [pack, setPack] = useState("30");
  const [count, setCount] = useState(20);
  const [note, setNote] = useState("");
  const [exportCodes, setExportCodes] = useState<string[]>([]);
  const [exportId, setExportId] = useState("");
  const [revokeCode, setRevokeCode] = useState("");
  const [revokeNote, setRevokeNote] = useState("");
  const [revokeConfirmed, setRevokeConfirmed] = useState(false);
  const epoch = useRef(0);
  const issueRequest = useRef<{ fingerprint: string; id: string } | null>(null);

  useEffect(() => {
    const current = ++epoch.current;
    api<WalletResponse>("/api/wallet").then(value => { if (current === epoch.current) setData(value); }).catch(error => { if (current === epoch.current) setMessage(error.message); });
    if (isAdmin) api<{ batches: Batch[] }>("/api/admin/redemption-batches").then(value => { if (current === epoch.current) setBatches(value.batches); }).catch(() => {});
    return () => { epoch.current += 1; };
  }, [userId, isAdmin]);
  function downloadCodes() {
    if (!exportCodes.length) return;
    const url = URL.createObjectURL(new Blob([exportCodes.join("\n") + "\n"], { type: "text/plain;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = `tokvilo-codes-${exportId}.txt`; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function refresh() {
    const current = epoch.current; setBusy("refresh");
    try {
      const updated = await api<WalletResponse>("/api/wallet");
      if (current === epoch.current) setData(updated);
    } catch (error) { if (current === epoch.current) setMessage(error instanceof Error ? error.message : "刷新未完成。"); }
    finally { if (current === epoch.current) setBusy(""); }
  }
  async function redeem(event: React.FormEvent) {
    event.preventDefault();
    if (!confirmed || !code.trim()) return;
    const current = epoch.current; setBusy("redeem"); setMessage("");
    try {
      const updated = await api<{ wallet: WalletSnapshot; alreadyRedeemed: boolean; redemption: { credit_microusd: number } }>("/api/wallet/redeem", { code });
      if (current !== epoch.current) return;
      setData(value => value ? { ...value, wallet: updated.wallet } : value);
      setCode(""); setConfirmed(false);
      setMessage(updated.alreadyRedeemed ? "此码已兑换到本账号，本次没有重复入账。" : `兑换成功，${money(updated.redemption.credit_microusd)} 已加入可用余额。`);
    } catch (error) { if (current === epoch.current) setMessage(error instanceof Error ? error.message : "兑换未完成。"); }
    finally { if (current === epoch.current) setBusy(""); }
  }
  async function issue(event: React.FormEvent) {
    event.preventDefault();
    const current = epoch.current, payload = { packageId: pack, count, note }, fingerprint = JSON.stringify(payload);
    if (issueRequest.current?.fingerprint !== fingerprint) issueRequest.current = { fingerprint, id: crypto.randomUUID() };
    setBusy("issue"); setMessage(""); setExportCodes([]); setExportId("");
    try {
      const result = await api<{ batch: Batch; codes: string[]; codesAvailable: boolean }>("/api/admin/redemption-batches", { ...payload, requestId: issueRequest.current.id });
      if (current !== epoch.current) return;
      setExportCodes(result.codes); setExportId(result.batch.id);
      setMessage(result.codesAvailable ? `已生成 ${result.codes.length} 个 Tokvilo 兑换码。请立即下载，导入 Tokvilo 对应商品的自动发货库存。` : "此批次已发行，明文不会再次返回。请找回首次下载文件，核对库存后再处理。");
      const list = await api<{ batches: Batch[] }>("/api/admin/redemption-batches");
      if (current === epoch.current) setBatches(list.batches);
    } catch (error) { if (current === epoch.current) setMessage(error instanceof Error ? error.message : "发行未完成。"); }
    finally { if (current === epoch.current) setBusy(""); }
  }
  async function revoke(event: React.FormEvent) {
    event.preventDefault(); if (!revokeConfirmed) return;
    const current = epoch.current; setBusy("revoke"); setMessage("");
    try {
      const result = await api<{ creditReversedMicrousd: number; alreadyRevoked: boolean }>("/api/admin/redemption-codes/revoke", { code: revokeCode, note: revokeNote });
      if (current !== epoch.current) return;
      setRevokeCode(""); setRevokeNote(""); setRevokeConfirmed(false);
      setMessage(`${result.alreadyRevoked ? "此码此前已停用，累计撤回" : "兑换码已停用，撤回"} ${money(result.creditReversedMicrousd)}。如需现金退款，请在链动小铺处理对应订单。`);
      const list = await api<{ batches: Batch[] }>("/api/admin/redemption-batches");
      if (current === epoch.current) setBatches(list.batches);
      const updated = await api<WalletResponse>("/api/wallet");
      if (current === epoch.current) setData(updated);
    } catch (error) { if (current === epoch.current) setMessage(error instanceof Error ? error.message : "撤销未完成。"); }
    finally { if (current === epoch.current) setBusy(""); }
  }

  return <div className="wallet-page">
    <header className="console-page-heading"><div><h1>余额与充值</h1><p>按量使用，余额以美元计价。模型价格为上游价格加 20%。</p></div><button className="console-button" type="button" disabled={!!busy} onClick={refresh}>{busy === "refresh" ? "刷新中…" : "刷新余额"}</button></header>
    {message ? <p className="console-notice" role="status">{message}</p> : null}
    <section className="wallet-summary"><div><span>可用余额</span><strong>{data ? money(data.wallet.balanceMicrousd) : "—"}</strong><small>{email}</small></div><div><span>处理中预留</span><strong>{data ? money(data.wallet.reservedMicrousd) : "—"}</strong><small>完成后按用量结算，多余预留退回可用余额。</small></div></section>
    <section className="console-panel wallet-section"><h2>通过链动小铺购买</h2><p>在店铺完成付款后获取一次性兑换码，回到下方兑换到当前账号。</p>
      {!data?.billing.enabled ? <p className="wallet-status">Tokvilo 专属商品正在准备中，当前购买入口暂未开放。已取得的 Tokvilo 兑换码可在兑换服务开启时使用。</p> : null}
      <div className="wallet-packages">{(data?.billing.packages || []).map(item => <article key={item.id}><span>Tokvilo API 余额</span><h3>¥{item.amountCny}</h3><p>{item.creditMicrousd === null ? "充值汇率待配置" : `到账 ${money(item.creditMicrousd)}`}</p>{data?.billing.enabled && item.purchaseUrl ? <a className="console-button console-button-primary" href={item.purchaseUrl} target="_blank" rel="noopener noreferrer">去链动购买 ↗</a> : <button className="console-button" disabled>暂未开放</button>}</article>)}</div>
      <p className="wallet-fineprint">{data?.billing.usdCny ? `当前新发行兑换码按固定充值换算率 1 USD = ¥${data.billing.usdCny} 换算，这不是实时外汇报价。` : ""}每个兑换码的到账额度在发行时固定，以商品页及兑换记录为准。充值面值不加收 20%；模型用量按页面价格扣费。</p>
    </section>
    <section className="console-panel wallet-section"><h2>兑换到账</h2><form className="wallet-form" onSubmit={redeem}><label htmlFor="redeem-code">Tokvilo 兑换码</label><input id="redeem-code" value={code} onChange={event => setCode(event.target.value)} autoComplete="off" spellCheck={false} placeholder="TK-XXXX-XXXX-…" maxLength={128} required /><label className="wallet-checkbox"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />我确认将余额兑换到当前账号 {email}</label><button className="console-button console-button-primary" disabled={!!busy || !confirmed || !data?.billing.redemptionEnabled}>{busy === "redeem" ? "兑换中…" : "确认兑换"}</button><p className="wallet-fineprint">只支持 Tokvilo 的 TK 兑换码。佳农商品和 JN 兑换码用于佳农账号。付款完成或返回本站不会自动增加余额。</p></form></section>
    <section className="console-panel wallet-section"><h2>最近账务记录</h2><div className="console-table-wrap"><table className="console-table"><thead><tr><th>时间（北京时间）</th><th>说明</th><th>余额变动</th></tr></thead><tbody>{data?.wallet.ledger.length ? data.wallet.ledger.map(row => <tr key={row.id}><td>{timestamp(row.created_at)}</td><td>{row.description}</td><td className={row.amount_microusd < 0 ? "wallet-debit" : "wallet-credit"}>{row.amount_microusd > 0 ? "+" : ""}{money(row.amount_microusd)}</td></tr>) : <tr><td colSpan={3}>{data ? "暂无账务记录。" : "正在读取账务记录…"}</td></tr>}</tbody></table></div></section>
    {isAdmin ? <section className="console-panel wallet-section"><h2>兑换码库存管理</h2><p>生成 Tokvilo 专属库存，再下载导入链动小铺对应商品。明文只在首次发行响应中显示。</p><form className="wallet-form" onSubmit={issue}><div className="wallet-fields"><label>充值面值<select value={pack} onChange={event => setPack(event.target.value)}>{[30, 90, 300].map(n => <option key={n} value={String(n)}>¥{n}</option>)}</select></label><label>数量<input type="number" min={1} max={1000} value={count} onChange={event => setCount(Number(event.target.value))} required /></label></div><label>发行备注<input value={note} onChange={event => setNote(event.target.value)} minLength={2} maxLength={500} placeholder="例如：Tokvilo 首批链动商品库存" required /></label><button className="console-button console-button-primary" disabled={!!busy || !data?.billing.issuanceEnabled}>{busy === "issue" ? "生成中…" : "生成库存"}</button></form>
      {exportCodes.length ? <div className="wallet-export"><button className="console-button console-button-primary" type="button" onClick={downloadCodes}>下载 {exportCodes.length} 个兑换码</button><button className="console-button" onClick={() => { setExportCodes([]); setExportId(""); issueRequest.current = null; }} type="button">已保存，清除明文</button><textarea readOnly value={exportCodes.join("\n")} aria-label="新发行的兑换码" rows={6} /></div> : null}
      <div className="console-table-wrap"><table className="console-table"><thead><tr><th>批次</th><th>面值 / 到账</th><th>发行 / 已兑换 / 停用</th></tr></thead><tbody>{batches.map(batch => <tr key={batch.id}><td><code>{batch.id.slice(0, 8)}</code></td><td>¥{batch.amount_cny} / {money(batch.credit_microusd)}</td><td>{batch.issued_count} / {batch.redeemed_count} / {batch.revoked_count}</td></tr>)}</tbody></table></div>
      <details className="wallet-revoke"><summary>停用兑换码并撤回对应余额</summary><form className="wallet-form" onSubmit={revoke}><label>完整兑换码<input value={revokeCode} onChange={event => setRevokeCode(event.target.value)} autoComplete="off" maxLength={128} required /></label><label>撤销备注<input value={revokeNote} onChange={event => setRevokeNote(event.target.value)} minLength={2} maxLength={500} required /></label><label className="wallet-checkbox"><input type="checkbox" checked={revokeConfirmed} onChange={event => setRevokeConfirmed(event.target.checked)} />确认停用此码并撤回已兑换的完整额度；现金退款另在链动处理。</label><button className="console-button" disabled={!!busy || !revokeConfirmed}>{busy === "revoke" ? "处理中…" : "停用此码"}</button></form></details>
    </section> : null}
  </div>;
}
