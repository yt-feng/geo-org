"use client";

import { useState, type FormEvent } from "react";
import type { ManualCreditEntry, ManualCreditReason } from "@/lib/admin-wallet";
import type { WalletSnapshot } from "@/lib/wallet";
import { useSiteLocale } from "./LocaleProvider";

type Snapshot = { customer: { id: string; email: string; displayName: string }; wallet: WalletSnapshot; entries: ManualCreditEntry[] };
type CreditPayload = { customerId: string; email: string; amountUSD: string; paymentReference: string; note: string; reason: ManualCreditReason; confirmed: true; receiptConfirmed: boolean; requestId: string };
const dollars = (value: number) => `$${(value / 1_000_000).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 })}`;
const reasons: Record<ManualCreditReason, [string, string]> = {
  bank_transfer: ["企业银行转账", "Enterprise bank transfer"],
  test_credit: ["测试额度", "Test service credit"],
  correction: ["补记服务额度", "Additional service credit correction"],
};
const errors: Record<string, string> = {
  login_required: "Sign in as an administrator first.", admin_required: "Administrator access is required.",
  origin_invalid: "Submit this request from the tokvilo admin page.", account_disabled: "This administrator account is disabled.",
  customer_missing: "No account was found. Ask the customer to register and sign in first.", customer_disabled: "The customer account is disabled.",
  customer_ambiguous: "More than one account matches this email. Resolve the account details first.",
  customer_changed: "The customer details changed. Search for the account again before confirming.",
  manual_credit_conflict: "This payment reference or request ID was already used for a different credit. Check the history.",
  receipt_confirmation_required: "Verify the actual bank receipt before recording this credit.",
};

export function AdminWalletPanel() {
  const { t, isEnglish } = useSiteLocale();
  const [email, setEmail] = useState("");
  const [data, setData] = useState<Snapshot | null>(null);
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [reason, setReason] = useState<ManualCreditReason>("bank_transfer");
  const [confirmed, setConfirmed] = useState(false);
  const [receiptConfirmed, setReceiptConfirmed] = useState(false);
  const [pending, setPending] = useState<CreditPayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  function errorMessage(error: { code?: string; message?: string } | undefined) {
    return isEnglish ? errors[error?.code || ""] || "The operation was not confirmed. Check the entered details or retry the same request below." : error?.message || "操作结果尚未确认，请核对资料或使用同一请求重试。";
  }
  async function lookup(event: FormEvent) {
    event.preventDefault(); if (busy || pending) return;
    setBusy(true); setMessage(""); setData(null); setConfirmed(false); setReceiptConfirmed(false);
    try {
      const response = await fetch(`/api/admin/wallet?${new URLSearchParams({ email: email.trim() })}`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) { setMessage(errorMessage(result.error)); return; }
      setData(result);
    } catch { setMessage(t("暂时无法读取账户，请重新查询。", "The account could not be loaded. Search again.")); }
    finally { setBusy(false); }
  }
  async function credit(payload: CreditPayload) {
    if (busy) return;
    setBusy(true); setPending(payload); setMessage("");
    try {
      const response = await fetch("/api/admin/wallet", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const result = await response.json();
      if (!response.ok) {
        setMessage(errorMessage(result.error));
        // Explicit rejection means nothing was granted. Ambiguous server/network
        // outcomes retain the exact payload and request ID for safe recovery.
        if (response.status < 500) setPending(null);
        return;
      }
      setData(result); setPending(null); setAmount(""); setReference(""); setNote(""); setConfirmed(false); setReceiptConfirmed(false);
      setMessage(result.reused
        ? t("已核对原入账记录，此次没有重复增加额度。", "The original credit was confirmed. No additional credit was added.")
        : t(`已为 ${result.customer.email} 入账 ${dollars(result.entry.amount_microusd)}，审计记录已保存。`, `${dollars(result.entry.amount_microusd)} was credited to ${result.customer.email}. The audit record is saved.`));
    } catch { setMessage(t("连接中断，入账结果尚未确认。请使用下方按钮重试同一请求，系统会核对原记录。", "The connection was interrupted and the result is unknown. Retry the same request below to recover the original result.")); }
    finally { setBusy(false); }
  }
  function submit(event: FormEvent) {
    event.preventDefault(); if (!data || pending || !confirmed) return;
    void credit({ customerId: data.customer.id, email: data.customer.email, amountUSD: amount, paymentReference: reference, note, reason, confirmed: true, receiptConfirmed, requestId: crypto.randomUUID() });
  }
  const locked = busy || !!pending;
  return <section>
    <div className="console-page-heading"><div><h1>{t("企业转账与人工入账", "Enterprise transfers & manual credits")}</h1><p>{t("核实实际到账后，按注册邮箱为客户增加 tokvilo 服务额度。每笔操作保留管理员、流水编号和备注。", "After verifying the bank receipt, add tokvilo service credit to the customer's registered account. Every entry records its administrator, payment reference and note.")}</p></div></div>
    {message ? <p className="commerce-message" role="status">{message}</p> : null}
    {pending ? <div className="console-panel wallet-section" role="status"><h2>{t("等待确认入账结果", "Credit confirmation pending")}</h2><p>{pending.email} · ${pending.amountUSD} · {pending.paymentReference}</p><p className="wallet-fineprint">{t("请保留此页面并核对原请求，暂勿创建另一笔入账。", "Keep this page open and recover this request before creating another credit.")}</p><button type="button" className="console-button console-button-primary" disabled={busy} onClick={() => void credit(pending)}>{busy ? t("核对中…", "Checking…") : t("核对并重试同一请求", "Recover the same request")}</button></div> : null}
    <section className="console-panel wallet-section"><h2>{t("1. 查询客户账户", "1. Find the customer account")}</h2>
      <form className="wallet-form" onSubmit={lookup}><label htmlFor="manual-credit-email">{t("客户注册邮箱", "Customer's registered email")}</label><input id="manual-credit-email" type="email" autoComplete="off" value={email} maxLength={254} required disabled={locked} onChange={event => { setEmail(event.target.value); setData(null); setConfirmed(false); }} /><button className="console-button" disabled={locked}>{busy ? t("查询中…", "Loading…") : t("查询账户与入账记录", "Find account & credit history")}</button></form>
    </section>
    {data ? <>
      <section className="console-panel wallet-section"><h2>{data.customer.email}</h2><p>{data.customer.displayName} · <code>{data.customer.id}</code></p><div className="wallet-fields"><p>{t("可用额度", "Available credit")}<br /><strong>{dollars(data.wallet.balanceMicrousd)}</strong></p><p>{t("任务预留", "Reserved for requests")}<br /><strong>{dollars(data.wallet.reservedMicrousd)}</strong></p></div></section>
      <section className="console-panel wallet-section"><h2>{t("2. 核对并增加服务额度", "2. Verify & add service credit")}</h2><form className="wallet-form" onSubmit={submit}>
        <fieldset disabled={locked} style={{ border: 0, padding: 0, margin: 0, minWidth: 0, display: "grid", gap: 18 }}>
          <div className="wallet-fields"><label>{t("入账类型", "Credit type")}<select value={reason} onChange={event => { setReason(event.target.value as ManualCreditReason); setConfirmed(false); setReceiptConfirmed(false); }}>{Object.entries(reasons).map(([key, names]) => <option value={key} key={key}>{t(...names)}</option>)}</select></label><label>{t("增加金额（USD）", "Credit amount (USD)")}<input type="text" inputMode="decimal" pattern="(?:0|[1-9][0-9]{0,5})(?:\.[0-9]{1,2})?" placeholder="100.00" required value={amount} onChange={event => { setAmount(event.target.value); setConfirmed(false); }} /></label></div>
          <label>{t("唯一流水／调整编号", "Unique payment / adjustment reference")}<input value={reference} minLength={6} maxLength={160} autoComplete="off" required onChange={event => setReference(event.target.value)} placeholder={t("银行名称 + 银行流水号", "Bank name + bank transaction ID")} /></label>
          <p className="wallet-fineprint">{t("银行转账请填写银行名称和实际流水号；测试与补记使用独立编号。同一编号只能入账一次。", "Use the bank name and actual transaction ID for transfers, or a distinct reference for test and correction credits. Each reference can be credited only once.")}</p>
          <label>{t("入账备注", "Credit note")}<textarea value={note} minLength={2} maxLength={1000} rows={3} required onChange={event => setNote(event.target.value)} placeholder={t("付款企业、核实日期、入账说明；无需填写完整银行账号。", "Company, date verified and credit details. Do not enter a full bank account number.")} /></label>
          {reason === "bank_transfer" ? <label className="wallet-checkbox"><input type="checkbox" checked={receiptConfirmed} onChange={event => setReceiptConfirmed(event.target.checked)} />{t("我已核实银行实际收到此笔款项，并确认 USD 入账金额。", "I verified that the bank received this payment and confirmed the USD service credit amount.")}</label> : null}
          <label className="wallet-checkbox"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />{t(`确认向 ${data.customer.email} 增加 $${amount || "0.00"} 服务额度。`, `Confirm $${amount || "0.00"} of service credit for ${data.customer.email}.`)}</label>
          <button className="console-button console-button-primary" disabled={!confirmed || (reason === "bank_transfer" && !receiptConfirmed)}>{busy ? t("核对入账中…", "Recording credit…") : t("确认入账并保存记录", "Confirm credit & save record")}</button>
        </fieldset>
      </form></section>
      <section className="console-panel wallet-section"><h2>{t("人工入账记录", "Manual credit history")}</h2><p className="wallet-fineprint">{t("最近 100 笔；记录提交后不可改写。此处记录服务额度，不代替银行回单。", "Latest 100 entries. Submitted audit records cannot be rewritten. These entries record service credit and do not replace bank receipts.")}</p>
        {data.entries.length ? data.entries.map(entry => <article className="order-card" key={entry.id}><h3>+{dollars(entry.amount_microusd)} · {t(...reasons[entry.reason])}</h3><p>{entry.payment_reference}</p><p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{entry.note}</p><small>{entry.created_at} UTC · {entry.actor_email}</small><p className="wallet-fineprint">{entry.id}</p></article>) : <p>{t("暂无人工入账记录。", "No manual credits yet.")}</p>}
      </section>
    </> : null}
  </section>;
}
