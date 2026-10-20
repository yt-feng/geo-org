"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { cny, digitalProducts, type DigitalProduct } from "@/lib/public-products";

type Receipt = { inquiryId: string; emailStatus: "sent" | "pending"; email: string };

export function ProductMarket() {
  const [selected, setSelected] = useState<DigitalProduct | null>(null);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [requirements, setRequirements] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const inFlight = useRef(false);
  const requestKey = useRef<{ body: string; key: string } | null>(null);

  useEffect(() => { if (selected && dialog.current && !dialog.current.open) dialog.current.showModal(); }, [selected]);
  function choose(product: DigitalProduct) {
    setSelected(product); setRequirements(""); setMessage(""); setReceipt(null); requestKey.current = null;
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || inFlight.current || receipt) return;
    const contactEmail = email.trim().toLowerCase(), buyerName = name.trim(), requestMessage = requirements.trim();
    if (!/^\S+@\S+\.\S+$/.test(contactEmail) || contactEmail.length > 254 || !requestMessage || requestMessage.length > 4000 || buyerName.length > 100) {
      setMessage("请填写有效的联系邮箱和需求说明。"); return;
    }
    const body = JSON.stringify({ productId: selected.id, email: contactEmail, ...(buyerName ? { name: buyerName } : {}), message: requestMessage });
    if (requestKey.current?.body !== body) requestKey.current = { body, key: crypto.randomUUID() };
    inFlight.current = true; setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/product-inquiries", {
        method: "POST", headers: { "content-type": "application/json", "Idempotency-Key": requestKey.current.key }, body,
      });
      const value = await response.json().catch(() => null);
      if (!response.ok || value?.ok !== true) throw new Error(typeof value?.error === "string" ? value.error : value?.error?.message || "需求提交未完成，请稍后重试。");
      if (typeof value.inquiryId !== "string" || !value.inquiryId || !["sent", "pending"].includes(value.emailStatus)) throw new Error("暂时无法确认受理状态，请使用相同内容重试。");
      setReceipt({ inquiryId: value.inquiryId, emailStatus: value.emailStatus, email: contactEmail });
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "需求提交未完成，请稍后重试。"); }
    finally { inFlight.current = false; setBusy(false); }
  }

  return <>
    <div className="product-grid">{digitalProducts.map(product => <article className="product-card" key={product.id}>
      <div className="product-art" aria-hidden="true"><strong>{product.name.includes("Pro") ? "Pro" : "Plus"}</strong><span>TOKVILO / DIGITAL</span></div>
      <div className="product-copy"><h2>{product.name}</h2><p>{product.variant}</p><p>{product.description.replaceAll("处理订单", "确认需求").replaceAll("订单内", "邮件内").replaceAll("暂不接受订单", "可提交需求咨询到货时间")}</p><dl><dt>需求咨询</dt><dd>提交表单，24 小时内邮件回复</dd><dt>交付形式</dt><dd>{product.delivery === "code" ? "充值码 / 兑换信息" : "人工充值"}</dd></dl>
        <div className="product-price"><strong>{cny(product.retailCents)}</strong><span className="product-status">参考售价</span></div>
        <button className="button button-primary" onClick={() => choose(product)}>{product.soldOut ? "咨询到货与需求" : "提交购买需求"}</button>
      </div>
    </article>)}</div>
    {selected ? <dialog className="model-detail-dialog" ref={dialog} onCancel={event => { if (busy) event.preventDefault(); else setSelected(null); }} aria-labelledby="product-title"><div className="model-detail-inner">
      <button type="button" className="model-detail-close" disabled={busy} onClick={() => setSelected(null)} aria-label="关闭">×</button>
      <span className="landing-eyebrow">TOKVILO / INQUIRY</span><h2 id="product-title">{selected.name}</h2><p>{selected.variant}</p>
      <div className="product-inquiry-price"><span>参考售价</span><strong>{cny(selected.retailCents)}</strong></div>
      <p>提交你的需求，我们将在 24 小时内通过邮件回复，确认适用条件、库存与交付安排。</p>
      {receipt ? <div className="commerce-message" role="status"><strong>需求已收到</strong><p>受理编号：{receipt.inquiryId}</p><p>我们将在 24 小时内通过 {receipt.email} 回复。</p>{receipt.emailStatus === "pending" ? <p>需求已保存，通知邮件正在排队发送，请勿重复提交。</p> : <p>通知邮件已发送。</p>}</div> : <form className="product-inquiry-form" onSubmit={submit}>
        <label htmlFor="inquiry-email"><span>联系邮箱 <span aria-hidden="true">*</span></span><input id="inquiry-email" name="email" type="email" autoComplete="email" required maxLength={254} value={email} onChange={event => setEmail(event.target.value)} disabled={busy} placeholder="name@example.com" /></label>
        <label htmlFor="inquiry-name"><span>称呼 <small>选填</small></span><input id="inquiry-name" name="name" type="text" autoComplete="name" maxLength={100} value={name} onChange={event => setName(event.target.value)} disabled={busy} placeholder="你的称呼" /></label>
        <label htmlFor="inquiry-message"><span>需求说明 <span aria-hidden="true">*</span></span><textarea id="inquiry-message" name="message" required maxLength={4000} rows={5} value={requirements} onChange={event => setRequirements(event.target.value)} disabled={busy} placeholder="请说明需要的数量、使用地区、期望时间及其他要求。" /></label>
        <p className="price-caption">无需登录即可咨询。请勿填写账户密码或其他登录凭证。</p>
        <button className="button button-primary" type="submit" disabled={busy || !email.trim() || !requirements.trim()}>{busy ? "正在提交…" : "提交需求，等待邮件回复"}</button>
        {message ? <p className="commerce-message" role="alert">{message}</p> : null}
      </form>}
    </div></dialog> : null}
  </>;
}
