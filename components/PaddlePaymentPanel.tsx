"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CREDIT_EXCHANGE_LABEL, formatCreditsWithUsd } from "@/lib/credits";
import { openPaddleCheckout, subscribeToPaddle } from "./paddle-checkout-client";

type UsagePackage = { id: string; amountUsd: number; creditMicrousd: number };
type PaddleConfig = { enabled: boolean; environment: "sandbox" | "production"; clientToken: string | null; packages: UsagePackage[]; reason: string | null };
type PaymentOrder = { id: string; environment: "sandbox" | "production"; status: "creating" | "checkout_ready" | "outcome_unknown" | "paid" | "adjusted" | "canceled"; transactionId: string | null; amountUsd: number; creditMicrousd: number; creditedMicrousd: number; credited: boolean };
type PendingPayment = { requestId?: string; packageId?: string; orderId?: string };
type PaymentResponse = { order: PaymentOrder };
const proposedPackages = [20, 50, 100].map(amountUsd => ({ id: String(amountUsd), amountUsd, creditMicrousd: amountUsd * 1_000_000 }));
const dollars = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value);
const terminal = (order: PaymentOrder) => order.status === "canceled" || order.status === "adjusted" || order.status === "paid" && (order.credited || order.environment === "sandbox");

function paymentError(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  // Processor-specific diagnostics belong in server logs, not customer notices.
  if (/\bpaddle\b/i.test(error.message)) return "Online payment could not be confirmed. Your request is saved; check its status or continue the same payment.";
  return error.message;
}

async function request<T>(url: string, body?: unknown): Promise<T> {
  const controller = new AbortController();
  const deadline = body === undefined ? 20_000 : 35_000;
  let timer: number;
  const timeout = new Promise<never>((_, reject) => {
    timer = window.setTimeout(() => {
      // Aborting the browser request does not cancel a server-side payment.
      reject(new Error(body === undefined ? "Payment status took too long to respond. Your saved order is unchanged. Check it again or resume the same checkout." : "Checkout confirmation took too long. Your payment request is saved. Resume this same checkout to continue."));
      controller.abort();
    }, deadline);
  });
  try {
    return await Promise.race([timeout, (async () => {
      const response = await fetch(url, { cache: "no-store", signal: controller.signal, ...(body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) });
      const data = await response.json() as T & { error?: { message?: string } };
      if (!response.ok) throw new Error(data.error?.message || "We could not confirm this payment. Check the existing order before trying again.");
      return data;
    })()]);
  } finally { window.clearTimeout(timer!); }
}

export function PaddlePaymentPanel({ userId, email, onCreditConfirmed }: { userId: string; email: string; onCreditConfirmed: () => void }) {
  const [config, setConfig] = useState<PaddleConfig | null>(null);
  const [configError, setConfigError] = useState(false);
  const [pending, setPending] = useState<PendingPayment | null>(null);
  const [order, setOrder] = useState<PaymentOrder | null>(null);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [pollCycle, setPollCycle] = useState(0);
  const [message, setMessage] = useState("");
  const [company, setCompany] = useState("");
  const [amount, setAmount] = useState("100");
  const epoch = useRef(0);
  const currentPending = useRef<PendingPayment | null>(null);
  const currentOrder = useRef<PaymentOrder | null>(null);
  const inFlight = useRef(false);
  const paymentRead = useRef(false);
  const confirmedCallback = useRef(onCreditConfirmed);
  const lastConfirmed = useRef("");
  const storageKey = `tokvilo:paddle:pending:${userId}`;

  useEffect(() => { confirmedCallback.current = onCreditConfirmed; }, [onCreditConfirmed]);

  const remember = useCallback((value: PendingPayment | null) => {
    currentPending.current = value; setPending(value);
    try {
      if (value) localStorage.setItem(storageKey, JSON.stringify(value));
      else localStorage.removeItem(storageKey);
    } catch { /* A retained in-memory request still prevents duplicate retries in this tab. */ }
  }, [storageKey]);

  const acceptOrder = useCallback((value: PaymentOrder) => {
    currentOrder.current = value; setOrder(value);
    if (terminal(value)) remember(null);
    if (value.credited && (value.status === "paid" || value.status === "adjusted")) {
      const fingerprint = `${value.id}:${value.creditedMicrousd}:${value.status}`;
      if (lastConfirmed.current !== fingerprint) { lastConfirmed.current = fingerprint; confirmedCallback.current(); }
      setMessage(value.status === "adjusted" ? "This payment has an adjustment. Your current API usage balance is shown above." : `Payment confirmed. ${formatCreditsWithUsd(value.creditedMicrousd, "en")} has been added to your API usage balance.`);
    } else if (value.status === "paid" && value.environment === "sandbox") setMessage("Sandbox payment completed. No real payment was collected and no spendable API balance was added.");
    else if (value.status === "canceled") setMessage("This order was canceled. No payment credit was added.");
    else if (value.status === "adjusted") { confirmedCallback.current(); setMessage("This payment has been refunded or adjusted. Your current balance is shown above."); }
    else if (value.status === "outcome_unknown" || value.status === "creating") setMessage("We are confirming this order. Keep this page or return later; do not create another payment for the same purchase.");
  }, [remember]);

  const checkOrder = useCallback(async (orderId: string, manual = false) => {
    if (paymentRead.current) return;
    paymentRead.current = true;
    if (manual) setChecking(true);
    const current = epoch.current;
    try {
      const result = await request<PaymentResponse>(`/api/billing/paddle/orders/${encodeURIComponent(orderId)}`);
      if (current === epoch.current && currentPending.current?.orderId === orderId) acceptOrder(result.order);
    } catch (error) {
      if (current === epoch.current && currentPending.current?.orderId === orderId) setMessage(paymentError(error, "Order status is unavailable. Keep your order reference and check again."));
    } finally {
      paymentRead.current = false;
      if (manual && current === epoch.current) setChecking(false);
    }
  }, [acceptOrder]);

  useEffect(() => {
    const current = ++epoch.current;
    request<PaddleConfig>("/api/billing/paddle/config").then(value => { if (current === epoch.current) setConfig(value); }).catch(() => { if (current === epoch.current) setConfigError(true); });
    Promise.resolve().then(() => {
      if (current !== epoch.current) return;
      try {
        const stored = JSON.parse(localStorage.getItem(storageKey) || "null") as PendingPayment | null;
        const validId = (id: unknown) => typeof id === "string" && /^[a-zA-Z0-9_-]{1,160}$/.test(id);
        const saved = stored && (validId(stored.orderId) || typeof stored.requestId === "string" && /^[a-zA-Z0-9_-]{16,100}$/.test(stored.requestId) && proposedPackages.some(item => item.id === stored.packageId)) ? stored : null;
        const orderFromUrl = new URL(window.location.href).searchParams.get("paddle_order");
        const restored = saved || (validId(orderFromUrl) ? { orderId: orderFromUrl! } : null);
        if (restored) { currentPending.current = restored; setPending(restored); }
      } catch { /* Storage can be disabled by browser policy. */ }
    });
    return () => { epoch.current = current + 1; };
  }, [storageKey]);

  useEffect(() => {
    if (!pending?.orderId) return;
    const orderId = pending.orderId;
    let attempts = 0, disposed = false;
    Promise.resolve().then(() => { if (!disposed) void checkOrder(orderId); });
    const timer = window.setInterval(() => {
      attempts++;
      if (attempts >= 30) {
        window.clearInterval(timer);
        if (currentPending.current?.orderId === orderId) setMessage("Payment is not yet confirmed. Your order is saved; check its status again or resume the same checkout.");
      }
      if (document.visibilityState === "visible") void checkOrder(orderId);
    }, 3_000);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [pending?.orderId, checkOrder, pollCycle]);

  useEffect(() => subscribeToPaddle(event => {
    const active = currentOrder.current;
    if (!active || !currentPending.current?.orderId) return;
    if (event.data?.transaction_id && event.data.transaction_id !== active.transactionId) return;
    if (event.name === "checkout.completed") {
      setMessage("Checkout completed. Waiting for payment confirmation before adding API usage balance.");
      setPollCycle(value => value + 1);
    } else if (event.name === "checkout.closed") {
      setMessage("Checkout closed. We will check the order before you continue. You can resume this same checkout below.");
      setPollCycle(value => value + 1);
    } else if (event.name === "checkout.error") {
      setMessage("Checkout could not finish. Check the order status, then resume the same checkout if needed.");
      setPollCycle(value => value + 1);
    }
  }), [checkOrder]);

  async function checkout(packageId: string) {
    if (inFlight.current || !config?.enabled || !config.clientToken) return;
    inFlight.current = true; setBusy(true); setMessage("");
    const current = epoch.current;
    const existing = currentPending.current;
    const attempt = existing || { requestId: crypto.randomUUID(), packageId };
    if (!existing) { currentOrder.current = null; setOrder(null); }
    // Save before the POST: an uncertain response must retry this exact request.
    try {
      // Without durable storage a refresh could lose the idempotency key.
      localStorage.setItem(storageKey, JSON.stringify(attempt));
      if (localStorage.getItem(storageKey) !== JSON.stringify(attempt)) throw new Error("storage_unavailable");
    } catch {
      setMessage("Browser storage is unavailable. Enable storage for tokvilo to continue checkout, or request an enterprise transfer below.");
      inFlight.current = false; setBusy(false); return;
    }
    remember(attempt);
    try {
      const result = attempt.orderId
        ? await request<PaymentResponse>(`/api/billing/paddle/orders/${encodeURIComponent(attempt.orderId)}`)
        : await request<PaymentResponse>("/api/billing/paddle/checkout", { requestId: attempt.requestId, packageId: attempt.packageId });
      if (current !== epoch.current) return;
      if (attempt.orderId && currentPending.current?.orderId !== attempt.orderId) return;
      remember({ ...attempt, orderId: result.order.id }); acceptOrder(result.order);
      if (result.order.status === "checkout_ready" && result.order.transactionId) {
        setMessage("Complete your payment in the secure checkout. Your API usage balance updates after payment confirmation.");
        await openPaddleCheckout({ environment: config.environment, clientToken: config.clientToken, transactionId: result.order.transactionId, isCurrent: () => current === epoch.current && currentPending.current?.orderId === result.order.id });
      }
    } catch (error) {
      // A late SDK failure must not replace an already verified receipt.
      if (current === epoch.current && currentPending.current) setMessage(paymentError(error, "Checkout could not be confirmed. Continue the same order below."));
    } finally { inFlight.current = false; if (current === epoch.current) setBusy(false); }
  }

  const packages = config?.packages.length ? config.packages : proposedPackages;
  const canPay = !!config?.enabled && !!config.clientToken;
  const pendingPackageId = pending ? pending.packageId || (order ? String(order.amountUsd) : null) : null;
  const pendingAmount = packages.find(item => item.id === pendingPackageId)?.amountUsd;
  const validTransfer = !!company.trim() && /^\d+(?:\.\d{1,2})?$/.test(amount) && Number(amount) > 0 && Number(amount) <= 1_000_000;
  const transferMail = `mailto:yt.feng@foxmail.com?${new URLSearchParams({ subject: "tokvilo enterprise transfer request", body: `Hello tokvilo,\n\nPlease send enterprise payment instructions.\n\nAccount email: ${email}\nCompany: ${company.trim()}\nRequested API service amount: USD ${amount}\n\nPlease confirm the invoice, payment reference and beneficiary details before I transfer funds.\n` }).toString()}`;

  return <>
    <section className="console-panel wallet-section paddle-payment" aria-labelledby="paddle-payment-title">
      <div className="wallet-section-heading"><div><span className="wallet-eyebrow">ONLINE PAYMENT</span><h2 id="paddle-payment-title">tokvilo API credit packs</h2></div><span className="wallet-method-badge">Secure checkout</span></div>
      <p>One-time packages for API requests and Playground generation on tokvilo. A fixed {CREDIT_EXCHANGE_LABEL.en}. Credits are a unit of service usage, with their dollar value always shown, and are deducted at the <a href="/en/pricing">published rates</a>.</p>
      {!config ? <p className="wallet-status" role="status">{configError ? "Online payment is unavailable right now. You can request enterprise transfer instructions below." : "Checking online payment availability…"}</p> : !canPay ? <p className="wallet-status" role="status">Online payments are not available yet. Enterprise transfers are available by arrangement below.</p> : config.environment === "sandbox" ? <p className="wallet-status" role="status">Test checkout: no real payment is collected and no spendable API balance is added.</p> : null}
      {message ? <p className="wallet-status" role="status" aria-live="polite">{message}</p> : null}
      {pending ? <p className="wallet-status"><strong>{pendingAmount ? `Your ${dollars(pendingAmount)} checkout is saved.` : "You have a saved checkout."}</strong>{" "}Continue that payment below. Other packages are unavailable until this payment is completed or resolved. <a href="#paddle-current-payment">View payment status</a></p> : null}
      <div className="wallet-packages paddle-packages">{packages.map(item => {
        const currentPackage = !!pending && pendingPackageId === item.id;
        const otherPackage = !!pending && !currentPackage;
        const awaitingOrder = currentPackage && (order?.status === "creating" || order?.status === "outcome_unknown");
        return <article key={item.id}><span>{currentPackage ? "Your saved checkout" : "One-time payment (USD, before tax)"}</span><h3>{dollars(item.amountUsd)}</h3><p>Receive <strong>{formatCreditsWithUsd(item.creditMicrousd, "en")}</strong></p><small>One-time purchase · no subscription. Applicable taxes are added in checkout; taxes do not add credits.</small><button className="console-button console-button-primary" type="button" onClick={() => void checkout(item.id)} disabled={!canPay || busy || otherPackage} aria-busy={busy && currentPackage}>{!canPay ? "Not available yet" : otherPackage ? "Finish existing checkout first" : busy ? "Preparing checkout…" : awaitingOrder ? "Check existing payment" : currentPackage ? "Continue payment" : "Pay securely"}</button></article>;
      })}</div>
      <p className="wallet-fineprint">For tokvilo API services only. Packages cannot be transferred, withdrawn as cash, or used to buy third-party subscriptions or digital goods. Applicable taxes and the final total are shown in checkout.</p>
      <div className="wallet-payment-links"><a href="/en/billing">How billing works</a><a href="/en/terms">Terms</a><a href="/en/refunds">Refund policy</a><a href="/en/privacy">Privacy</a></div>
      {pending ? <div className="wallet-payment-order" id="paddle-current-payment"><h3>Continue your payment</h3><p>{order ? `Order ${order.id}` : `Request ${pending.requestId}`}</p><p>{order?.status === "checkout_ready" ? "Resume this checkout or check whether payment has already been confirmed." : "This purchase is still being confirmed. Your request is saved so returning here will continue the same order."}</p><div className="wallet-payment-actions">{!order || order.status === "checkout_ready" ? <button className="console-button console-button-primary" type="button" disabled={busy || !canPay} aria-busy={busy} onClick={() => void checkout(pending.packageId || "")}>{busy ? "Preparing checkout…" : "Continue payment"}</button> : null}{pending.orderId ? <button className="console-button" type="button" disabled={checking || busy} aria-busy={checking} onClick={() => { setPollCycle(value => value + 1); void checkOrder(pending.orderId!, true); }}>{checking ? "Checking payment…" : "Check payment status"}</button> : null}</div><p className="wallet-fineprint">Closing checkout or returning to this page does not confirm payment. Your balance updates only after payment is verified.</p></div> : null}
    </section>
    <section className="console-panel wallet-section" aria-labelledby="enterprise-payment-title">
      <div className="wallet-section-heading"><div><span className="wallet-eyebrow">ENTERPRISE PAYMENT</span><h2 id="enterprise-payment-title">Pay by bank transfer</h2></div><span className="wallet-method-badge">By arrangement</span></div>
      <p>Request an invoice and bank transfer instructions for your company. We reply within 24 hours and add the agreed API service amount after the transfer has been received and verified. The confirmed USD usage value is displayed at {CREDIT_EXCHANGE_LABEL.en}.</p>
      <div className="wallet-form"><label>Account email<input type="email" value={email} readOnly /></label><div className="wallet-fields"><label htmlFor="enterprise-company">Company name<input id="enterprise-company" value={company} onChange={event => setCompany(event.target.value)} autoComplete="organization" maxLength={200} required /></label><label htmlFor="enterprise-amount">Requested amount (USD)<input id="enterprise-amount" type="number" min="0.01" max="1000000" step="0.01" value={amount} onChange={event => setAmount(event.target.value)} required /></label></div>{/^\d+(?:\.\d{1,2})?$/.test(amount) && Number(amount) > 0 && Number(amount) <= 1_000_000 ? <p className="wallet-transfer-preview">Requested usage: {formatCreditsWithUsd(Math.round(Number(amount) * 1_000_000), "en")}. This is a request, not credited balance; payment and any taxes are confirmed by email.</p> : null}{validTransfer ? <a className="console-button console-button-primary" href={transferMail}>Request transfer instructions</a> : <button className="console-button" disabled>Enter your company and amount</button>}<p className="wallet-fineprint">This opens your email app. Send the message to <a href="mailto:yt.feng@foxmail.com">yt.feng@foxmail.com</a> to request instructions. Creating an email does not place an order or change your balance.</p></div>
    </section>
  </>;
}
