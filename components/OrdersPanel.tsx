"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { cny, digitalProducts } from "@/lib/public-products";
import { productCopy } from "@/lib/product-copy";
import { useSiteLocale } from "./LocaleProvider";
import { formatCreditUsd } from "@/lib/credits";
type Order = { id: string; product_name: string; user_id: string; retail_cents: number; charge_microusd: number; status: string; delivery: string; created_at: string };
const states: Record<string, [string, string]> = { pending: ["待人工处理 · 额度已预留", "Awaiting processing · Funds reserved"], processing: ["人工处理中 · 额度已预留", "Processing · Funds reserved"], completed: ["已交付 · 已结算", "Delivered · Settled"], cancelled: ["已取消 · 预留已释放", "Cancelled · Reservation released"] };
const englishErrors: Record<string, string> = {
  "请先登录。": "Please sign in first.", "账户已停用。": "This account is disabled.",
  "仅管理员可处理商品订单。": "Only administrators can process product orders.",
  "请从 tokvilo 提交请求。": "Submit this request from tokvilo.",
  "订单编号无效。": "Invalid order ID.", "不支持此操作。": "This action is not supported.",
  "请填写 5–4,000 字的交付信息。": "Enter delivery details of 5–4,000 characters.",
  "请先认领订单；只有处理该订单的管理员可以交付。": "Claim the order first. Only the administrator processing it can complete delivery.",
  "订单已由其他操作处理或不属于当前账户。": "The order has already been changed or does not belong to this account.",
  "订单服务暂不可用，请稍后重试。": "Orders are temporarily unavailable. Please try again later.",
  "读取未完成。": "Orders could not be loaded. Please try again later.",
  "操作未完成。": "The operation could not be confirmed. Refresh the order before retrying.",
};
function orderMessage(message: string, english: boolean) {
  return english ? englishErrors[message] || (/[\u4e00-\u9fff]/.test(message) ? "The operation could not be confirmed. Refresh the order before retrying." : message) : message;
}
export function OrdersPanel({ admin = false }: { admin?: boolean }) {
  const { t, href, isEnglish, locale } = useSiteLocale();
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
  function productName(name: string) {
    if (!isEnglish) return name;
    const product = digitalProducts.find(item => name === `${item.name} · ${item.variant}`);
    return product ? `${product.name} · ${productCopy(product, locale).variant}` : name;
  }
  return <section>
    <div className="console-page-heading"><div><h1>{admin ? t("历史商品订单管理", "Manage historical product orders") : t("历史商品订单", "Historical product orders")}</h1><p>{t("订单交付、处理状态与余额结算记录。", "Track delivery, processing and balance settlements. ")}{admin ? t("先开始处理，再采购及交付；开始处理后用户不能自行取消。", "Start processing before procurement and delivery. Customers cannot cancel once processing starts.") : t("人工处理开始前，可取消订单并释放预留。", "You can cancel an order and release its reserved funds before processing starts.")}</p></div><Link className="button button-secondary" href={href("/products")}>{t("浏览商品", "Browse products")} ↗</Link></div>
    <p className="price-caption">{t("历史数字商品订单不属于 API 积分。这里分别保留商品人民币售价与美元账务金额；待处理预留不是最终费用，取消后释放预留。", "Historical digital-goods orders are separate from API credits. Original CNY product prices and USD accounting amounts remain visible; pending reservations are not final charges and are released on cancellation.")}</p>
    {message ? <p role="status" className="commerce-message">{orderMessage(message, isEnglish)}</p> : null}
    {!orders.length ? <p className="price-caption">{t("暂无商品订单。", "No product orders yet.")}</p> : orders.map(order => <article className="order-card" key={order.id}>
      <small>{order.created_at} UTC · {order.id}</small><h3>{productName(order.product_name)}</h3><p>{t("商品售价：", "Product price: ")}{cny(order.retail_cents)}</p><p>{order.status === "completed" ? t("已结算：", "Settled: ") : order.status === "cancelled" ? t("已释放预留：", "Released reservation: ") : t("钱包预留：", "Wallet reservation: ")}{formatCreditUsd(order.charge_microusd)} · {states[order.status] ? t(...states[order.status]) : order.status}</p>
      {admin ? <p>{t("账户：", "Account: ")}{order.user_id}</p> : null}
      {order.delivery ? <pre>{order.delivery}</pre> : null}
      {order.status === "pending" || (admin && order.status === "processing") ? <>
        {admin && order.status === "processing" ? <label>{t("交付信息", "Delivery details")}<textarea rows={4} maxLength={4000} value={delivery[order.id] || ""} onChange={event => setDelivery(values => ({ ...values, [order.id]: event.target.value }))} style={{ display: "block", width: "100%", margin: "12px 0" }} /></label> : null}
        <div className="landing-hero-actions">
          {admin && order.status === "pending" ? <button className="button button-primary" disabled={!!busy} onClick={() => update(order.id, "process")}>{t("开始处理", "Start processing")}</button> : null}
          {admin && order.status === "processing" ? <button className="button button-primary" disabled={!!busy || (delivery[order.id]?.trim().length || 0) < 5} onClick={() => update(order.id, "complete")}>{t("确认交付并结算", "Confirm delivery and settle")}</button> : null}
          <button className="button button-secondary" disabled={!!busy} onClick={() => update(order.id, "cancel")}>{t("取消订单并释放预留", "Cancel order and release funds")}</button>
        </div>
      </> : null}
    </article>)}
  </section>;
}
