"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { cny, digitalProducts, type DigitalProduct } from "@/lib/products";

export function ProductMarket() {
  const [selected, setSelected] = useState<DigitalProduct | null>(null);
  const [fx, setFx] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [orderId, setOrderId] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const requestKey = useRef("");
  useEffect(() => { fetch("/api/billing/config").then(r => r.json()).then(data => setFx(data.usdCny ?? data.billing?.usdCny ?? null)).catch(() => undefined); }, []);
  useEffect(() => { if (selected && dialog.current && !dialog.current.open) dialog.current.showModal(); }, [selected]);
  function choose(product: DigitalProduct) { setSelected(product); setConfirmed(false); setMessage(""); setOrderId(""); requestKey.current = crypto.randomUUID(); }
  async function submit() {
    if (!selected || busy || !confirmed || !fx) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/orders", { method: "POST", headers: { "content-type": "application/json", "Idempotency-Key": requestKey.current }, body: JSON.stringify({ productId: selected.id, confirmed: true, expectedRetailCents: selected.retailCents, expectedChargeMicrousd: Math.ceil(selected.retailCents * 10000 / fx) }) });
      const value = await response.json();
      if (response.status === 401) { window.location.href = "/login"; return; }
      if (!response.ok) throw new Error(value.error?.message || "提交未完成。");
      setOrderId(value.order.id); setMessage("订单已提交，额度已预留。交付信息会出现在“商品订单”中。");
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "提交未完成，请重试。"); }
    finally { setBusy(false); }
  }
  return <>
    <div className="product-grid">{digitalProducts.map(product => <article className="product-card" key={product.id}>
      <div className="product-art" aria-hidden="true"><strong>{product.name.includes("Pro") ? "Pro" : "Plus"}</strong><span>TOKVILO / DIGITAL</span></div>
      <div className="product-copy"><h2>{product.name}</h2><p>{product.variant}</p><p>{product.description}</p><dl><dt>订单交付</dt><dd>人工处理，交付后结算</dd><dt>源头形式</dt><dd>{product.sourceDelivery === "code" ? "充值码 / 兑换信息" : "人工充值"}</dd></dl>
        <div className="product-price"><strong>{cny(product.retailCents)}</strong><span className="product-status">源价 {cny(product.upstreamCents)} × 1.20</span></div>
        <button className="button button-primary" disabled={product.soldOut} onClick={() => choose(product)}>{product.soldOut ? "源头售罄" : "查看并订购"}</button>
      </div>
    </article>)}</div>
    {selected ? <dialog className="model-detail-dialog" ref={dialog} onCancel={() => !busy && setSelected(null)} aria-labelledby="product-title"><div className="model-detail-inner"><button type="button" className="model-detail-close" disabled={busy} onClick={() => setSelected(null)} aria-label="关闭">×</button><span className="landing-eyebrow">TOKVILO / ORDER</span><h2 id="product-title">{selected.name}</h2><p>{selected.variant}</p><h3>{cny(selected.retailCents)}</h3><p>按账户余额支付，{fx ? `充值换算为 1 USD = ¥${fx}，本单预留 $${(Math.ceil(selected.retailCents * 10000 / fx) / 1_000_000).toFixed(6)}。` : "正在读取充值换算…"}交付完成后结算；处理前可取消订单并释放全部预留。</p><p>此商品由人工处理，源头库存以接单时为准。交付内容与操作说明保存在你的订单内。请勿在订单或备注中提供账户密码。</p>{!orderId ? <><label className="price-caption"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /> 我已确认规格、售价和人工交付方式</label><div className="landing-hero-actions"><button className="button button-primary" onClick={submit} disabled={!confirmed || !fx || busy}>{busy ? "正在提交…" : "确认订购并预留额度"}</button><Link className="button button-secondary" href="/dashboard/wallet">余额与充值</Link></div></> : <Link className="button button-primary" href="/dashboard/orders">查看我的订单 ↗</Link>}{message ? <p className="commerce-message" role="status">{message}</p> : null}</div></dialog> : null}
  </>;
}
