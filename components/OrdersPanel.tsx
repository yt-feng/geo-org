"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { cny } from "@/lib/public-products";
type Order = { id: string; product_name: string; user_id: string; retail_cents: number; charge_microusd: number; status: string; delivery: string; created_at: string };
const states: Record<string, string> = { pending: "待人工处理 · 额度已预留", processing: "人工处理中 · 额度已预留", completed: "已交付 · 已结算", cancelled: "已取消 · 预留已释放" };
export function OrdersPanel({ admin = false }: { admin?: boolean }) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");
  const [delivery, setDelivery] = useState<Record<string, string>>({});
  const endpoint = admin ? "/api/admin/orders" : "/api/orders";
  const load = useCallback(async () => { const response = await fetch(endpoint, { cache: "no-store" }); const data = await response.json(); if (!response.ok) throw new Error(data.error?.message || "读取未完成。"); return data.orders as Order[]; }, [endpoint]);
  useEffect(() => { let active = true; load().then(values => { if (active) setOrders(values); }).catch(cause => { if (active) setMessage(cause.message); }); return () => { active = false; }; }, [load]);
  async function update(id: string, action: string) {
    setBusy(id); setMessage("");
    try {
      const response = await fetch(endpoint, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, action, delivery: delivery[id] }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error?.message || "操作未完成。");
      setDelivery(values => ({ ...values, [id]: "" })); setOrders(await load());
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "操作未完成。"); } finally { setBusy(""); }
  }
  return <section><div className="console-page-heading"><div><h1>{admin ? "商品订单管理" : "商品订单"}</h1><p>订单交付、处理状态与余额结算记录。{admin ? "先开始处理，再采购及交付；开始处理后用户不能自行取消。" : "人工处理开始前，可取消订单并释放预留。"}</p></div><Link className="button button-secondary" href="/products">浏览商品 ↗</Link></div>{message ? <p role="status" className="commerce-message">{message}</p> : null}{!orders.length ? <p className="price-caption">暂无商品订单。</p> : orders.map(order => <article className="order-card" key={order.id}><small>{order.created_at} UTC · {order.id}</small><h3>{order.product_name}</h3><p>{cny(order.retail_cents)} / ${(order.charge_microusd / 1_000_000).toFixed(6)} · {states[order.status]}</p>{admin ? <p>账户：{order.user_id}</p> : null}{order.delivery ? <pre>{order.delivery}</pre> : null}{order.status === "pending" || (admin && order.status === "processing") ? <>{admin && order.status === "processing" ? <label>交付信息<textarea rows={4} maxLength={4000} value={delivery[order.id] || ""} onChange={event => setDelivery(values => ({ ...values, [order.id]: event.target.value }))} style={{ display: "block", width: "100%", margin: "12px 0" }} /></label> : null}<div className="landing-hero-actions">{admin && order.status === "pending" ? <button className="button button-primary" disabled={!!busy} onClick={() => update(order.id, "process")}>开始处理</button> : null}{admin && order.status === "processing" ? <button className="button button-primary" disabled={!!busy || (delivery[order.id]?.trim().length || 0) < 5} onClick={() => update(order.id, "complete")}>确认交付并结算</button> : null}<button className="button button-secondary" disabled={!!busy} onClick={() => update(order.id, "cancel")}>取消订单并释放预留</button></div></> : null}</article>)}</section>;
}
