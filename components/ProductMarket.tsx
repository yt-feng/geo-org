"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { ProviderLogo } from "./ProviderLogo";
import { useSiteLocale } from "./LocaleProvider";
import { productCopy } from "@/lib/product-copy";
import { cny, digitalProducts, type DigitalProduct } from "@/lib/public-products";

type Receipt = { inquiryId: string; emailStatus: "sent" | "pending"; email: string };

export function ProductMarket() {
  const { t, locale, isEnglish } = useSiteLocale();
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
      setMessage(t("请填写有效的联系邮箱和需求说明。", "Please enter a valid contact email and describe your requirements.")); return;
    }
    const body = JSON.stringify({ productId: selected.id, email: contactEmail, ...(buyerName ? { name: buyerName } : {}), message: requestMessage });
    if (requestKey.current?.body !== body) requestKey.current = { body, key: crypto.randomUUID() };
    inFlight.current = true; setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/product-inquiries", {
        method: "POST", headers: { "content-type": "application/json", "Idempotency-Key": requestKey.current.key }, body,
      });
      const value = await response.json().catch(() => null);
      if (!response.ok || value?.ok !== true) throw new Error(typeof value?.error === "string" ? value.error : value?.error?.message || t("需求提交未完成，请稍后重试。", "Your inquiry could not be confirmed. Please try again later."));
      if (typeof value.inquiryId !== "string" || !value.inquiryId || !["sent", "pending"].includes(value.emailStatus)) throw new Error(t("暂时无法确认受理状态，请使用相同内容重试。", "We could not confirm receipt. Please retry with the same details."));
      setReceipt({ inquiryId: value.inquiryId, emailStatus: value.emailStatus, email: contactEmail });
    } catch (cause) { setMessage(!isEnglish && cause instanceof Error ? cause.message : t("需求提交未完成，请稍后重试。", "Your inquiry could not be confirmed. Please try again later.")); }
    finally { inFlight.current = false; setBusy(false); }
  }

  return <>
    <p className="price-caption">tokvilo · {t("数字商品", "Digital products")}</p>
    <div className="product-families">{["ChatGPT Plus", "ChatGPT Pro 5x", "ChatGPT Pro 20x"].map(plan => <section key={plan} className="product-family"><header className="product-family-heading"><ProviderLogo provider="OPENAI" size={32} /><div><small>OpenAI / ChatGPT</small><h2>{plan}</h2></div><span>{digitalProducts.filter(product => product.name === plan).length} {t("种方案", "options")}</span></header><div className="product-grid">{digitalProducts.filter(product => product.name === plan).map(product => <article className="product-card" key={product.id}>
      <div className="product-plan-top"><span>{product.delivery === "code" ? t("兑换信息", "Redemption details") : t("人工服务", "Manual service")}</span><span>{product.soldOut ? t("咨询到货", "Ask about restocking") : t("需求咨询", "Product inquiry")}</span></div>
      <div className="product-copy"><h3>{productCopy(product, locale).variant}</h3><p>{productCopy(product, locale).description}</p><dl><dt>{t("需求咨询", "Product inquiry")}</dt><dd>{t("提交表单，24 小时内邮件回复", "Submit a form; email reply within 24 hours")}</dd><dt>{t("交付形式", "Delivery method")}</dt><dd>{product.delivery === "code" ? t("充值码 / 兑换信息", "Top-up code / Redemption details") : t("人工充值", "Manual top-up")}</dd></dl>
        <div className="product-price"><strong>{cny(product.retailCents)}</strong><span className="product-status">{t("参考售价", "Indicative price")}</span></div>
        <button className="button button-primary" onClick={() => choose(product)}>{product.soldOut ? t("咨询到货与需求", "Ask about availability") : t("提交购买需求", "Send an inquiry")}</button>
      </div>
    </article>)}</div></section>)}</div>
    {selected ? <dialog className="model-detail-dialog" ref={dialog} onCancel={event => { if (busy) event.preventDefault(); else setSelected(null); }} aria-labelledby="product-title"><div className="model-detail-inner">
      <button type="button" className="model-detail-close" disabled={busy} onClick={() => setSelected(null)} aria-label={t("关闭", "Close")}>×</button>
      <span className="landing-eyebrow">TOKVILO / INQUIRY</span><h2 id="product-title">{selected.name}</h2><p>{productCopy(selected, locale).variant}</p>
      <div className="product-inquiry-price"><span>{t("参考售价", "Indicative price")}</span><strong>{cny(selected.retailCents)}</strong></div>
      <p>{t("提交你的需求，我们将在 24 小时内通过邮件回复，确认适用条件、库存与交付安排。", "Tell us what you need. We will reply by email within 24 hours to confirm eligibility, availability and delivery.")}</p>
      {receipt ? <div className="commerce-message" role="status"><strong>{t("需求已收到", "Inquiry received")}</strong><p>{t("受理编号：", "Reference: ")}{receipt.inquiryId}</p><p>{t(`我们将在 24 小时内通过 ${receipt.email} 回复。`, `We will reply to ${receipt.email} within 24 hours.`)}</p>{receipt.emailStatus === "pending" ? <p>{t("需求已保存，通知邮件正在排队发送，请勿重复提交。", "Your inquiry is saved and the notification is queued. Please do not submit it again.")}</p> : <p>{t("通知邮件已发送。", "Notification email sent.")}</p>}</div> : <form className="product-inquiry-form" onSubmit={submit}>
        <label htmlFor="inquiry-email"><span>{t("联系邮箱", "Contact email")} <span aria-hidden="true">*</span></span><input id="inquiry-email" name="email" type="email" autoComplete="email" required maxLength={254} value={email} onChange={event => setEmail(event.target.value)} disabled={busy} placeholder="name@example.com" /></label>
        <label htmlFor="inquiry-name"><span>{t("称呼", "Name")} <small>{t("选填", "Optional")}</small></span><input id="inquiry-name" name="name" type="text" autoComplete="name" maxLength={100} value={name} onChange={event => setName(event.target.value)} disabled={busy} placeholder={t("你的称呼", "Your name")} /></label>
        <label htmlFor="inquiry-message"><span>{t("需求说明", "Requirements")} <span aria-hidden="true">*</span></span><textarea id="inquiry-message" name="message" required maxLength={4000} rows={5} value={requirements} onChange={event => setRequirements(event.target.value)} disabled={busy} placeholder={t("请说明需要的数量、使用地区、期望时间及其他要求。", "Tell us the quantity, region of use, preferred timing and any other requirements.")} /></label>
        <p className="price-caption">{t("无需登录即可咨询。请勿填写账户密码或其他登录凭证。", "No sign-in required. Do not include account passwords or other login credentials.")}</p>
        <button className="button button-primary" type="submit" disabled={busy || !email.trim() || !requirements.trim()}>{busy ? t("正在提交…", "Submitting…") : t("提交需求，等待邮件回复", "Submit inquiry for an email reply")}</button>
        {message ? <p className="commerce-message" role="alert">{message}</p> : null}
      </form>}
    </div></dialog> : null}
  </>;
}
