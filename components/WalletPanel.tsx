"use client";

import { displayServiceText } from "@/lib/brand-display";
import { useSiteLocale } from "./LocaleProvider";
import { digitalProducts } from "@/lib/public-products";
import { productCopy } from "@/lib/product-copy";

import { useEffect, useRef, useState } from "react";
import type { BillingConfig } from "@/lib/redemption";
import type { WalletSnapshot } from "@/lib/wallet";

type Batch = { id: string; amount_cny: number; credit_microusd: number; count: number; issued_count: number; redeemed_count: number; revoked_count: number };
type WalletResponse = { wallet: WalletSnapshot; billing: BillingConfig };
type ErrorResponse = { error?: { message?: string } };
const money = (micros: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 6 }).format(micros / 1_000_000);
const timestamp = (value: string, english = false) => new Intl.DateTimeFormat(english ? "en-GB" : "zh-CN", { timeZone: "Asia/Shanghai", dateStyle: "short", timeStyle: "short" }).format(new Date(value.includes("T") ? value : value.replace(" ", "T") + "Z"));

const walletEnglish: Record<string, string> = {
  "请填写完整的 Tokvilo 兑换码。": "Enter the full tokvilo redemption code.",
  "请使用以 TK 开头的 Tokvilo 专属兑换码。": "Use a tokvilo redemption code beginning with TK.",
  "兑换服务暂未开启，请保留兑换码。": "Redemption is not available yet. Please keep your code.",
  "此码暂不可兑换，请核对是否已使用、过期或停用。": "This code cannot be redeemed. Check whether it was already used, expired or disabled.",
  "操作较频繁，请稍后再试。": "Too many attempts. Please try again later.",
  "请填写 2–500 字的操作备注。": "Enter an operation note of 2–500 characters.",
  "兑换码发行尚未开启或汇率未配置。": "Code issuance is not enabled or the conversion rate is not configured.",
  "请选择有效的充值面值。": "Select a valid top-up denomination.",
  "每批可生成 1–1,000 个兑换码。": "Each batch can contain 1–1,000 codes.",
  "请使用有效的发行请求编号。": "Use a valid issuance request ID.",
  "请填写有效的未来到期时间。": "Enter a valid future expiry date.",
  "此发行编号已用于不同内容。": "This issuance request ID has already been used for different contents.",
  "没有找到此兑换码。": "This redemption code was not found.",
  "请先登录。": "Please sign in first.",
  "请从 Tokvilo 工作台提交请求。": "Submit this request from the tokvilo workspace.",
  "仅管理员可管理兑换码。": "Only administrators can manage redemption codes.",
  "账户已停用。": "This account is disabled.",
  "账务服务暂不可用，请稍后重试。": "Billing is temporarily unavailable. Please try again later.",
  "此码已兑换到本账号，本次没有重复入账。": "This code was already redeemed into this account. No duplicate credit was added.",
  "此批次已发行，明文不会再次返回。请找回首次下载文件，核对库存后再处理。": "This batch has already been issued. Plaintext codes will not be returned again. Locate the original download and check your inventory before proceeding.",
  "刷新未完成。": "Balance refresh could not be confirmed.",
  "兑换未完成。": "Redemption could not be confirmed. Check your balance and keep the same code for any retry.",
  "发行未完成。": "Issuance could not be confirmed. Retry with unchanged details to retain the request ID.",
  "撤销未完成。": "Revocation could not be confirmed. Refresh the account before retrying.",
  "请求未完成，请稍后重试。": "The request could not be confirmed. Please refresh and try again later.",
  "可用余额不足，请先充值。": "Insufficient available balance. Please top up first."
};
function walletNotice(value: string, english: boolean) {
  const clean = displayServiceText(value);
  if (!english) return clean;
  if (walletEnglish[clean]) return walletEnglish[clean];
  let match = clean.match(/^兑换成功，(.+) 已加入可用余额。$/);
  if (match) return `Redeemed successfully. ${match[1]} was added to your available balance.`;
  match = clean.match(/^已生成 (\d+) 个 Tokvilo 兑换码。/);
  if (match) return `Generated ${match[1]} tokvilo codes. Download them now and import them into the matching tokvilo product inventory.`;
  match = clean.match(/^(此码此前已停用，累计撤回|兑换码已停用，撤回) (.+)。如需现金退款，请在链动小铺处理对应订单。$/);
  if (match) return `${match[1].startsWith("此码此前") ? "This code was already disabled. Total credit reversed:" : "Code disabled. Credit reversed:"} ${match[2]}. Handle any cash refund on the corresponding Liandong Shop order.`;
  return /[\u4e00-\u9fff]/.test(clean) ? "The operation could not be confirmed. Refresh your account and retry with the same details if needed." : clean;
}
function ledgerText(value: string, english: boolean) {
  const clean = displayServiceText(value);
  if (!english) return clean;
  const translatedProducts = digitalProducts.reduce((text, product) => text.replaceAll(`${product.name} · ${product.variant}`, `${product.name} · ${productCopy(product, "en").variant}`), clean);
  return translatedProducts.replaceAll("链动小铺 Tokvilo 兑换码，面值", "Liandong tokvilo code, face value")
    .replaceAll("兑换码撤销（现金退款由店铺处理）：", "Code credit reversed (cash refund handled by the shop): ")
    .replaceAll("API 调用结算，退回预留差额", "API settled; excess reservation released")
    .replaceAll("API 调用预留", "API request reservation")
    .replaceAll("调用未完成，退回预留金额", "Request incomplete; reservation released")
    .replaceAll("上游未生成成功，退还预留金额。", "Generation failed; reservation released.")
    .replaceAll("请求尚未发送，退还预留金额。", "Request not sent; reservation released.")
    .replaceAll("视频未生成成功，退还预留金额。", "Video generation failed; reservation released.")
    .replaceAll("数字商品订单取消，释放预留：", "Product order cancelled; reservation released: ")
    .replaceAll("数字商品已交付：", "Product delivered: ")
    .replaceAll("数字商品订单：", "Product order: ")
    .replaceAll("tokvilo 多模态", "tokvilo Studio").replaceAll("tokvilo 模型服务", "tokvilo Models")
    .replaceAll("tokvilo 数据接口", "tokvilo Data").replaceAll("tokvilo 精选", "tokvilo Select");
}

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
  const { t, isEnglish } = useSiteLocale();
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
    <header className="console-page-heading"><div><h1>{t("余额与充值", "Balance & top up")}</h1><p>{t("按量使用，余额以美元计价，模型用量按页面价格扣费。", "Your balance is in USD. Model usage is charged at the displayed rates.")}</p></div><button className="console-button" type="button" disabled={!!busy} onClick={refresh}>{busy === "refresh" ? t("刷新中…", "Refreshing…") : t("刷新余额", "Refresh balance")}</button></header>
    {message ? <p className="console-notice" role="status">{walletNotice(message, isEnglish)}</p> : null}
    <section className="wallet-summary"><div><span>{t("可用余额", "Available balance")}</span><strong>{data ? money(data.wallet.balanceMicrousd) : "—"}</strong><small>{email}</small></div><div><span>{t("处理中预留", "Reserved for pending requests")}</span><strong>{data ? money(data.wallet.reservedMicrousd) : "—"}</strong><small>{t("完成后按用量结算，多余预留退回可用余额。", "Settled after completion. Any excess reservation returns to your available balance.")}</small></div></section>
    <section className="console-panel wallet-section"><h2>{t("通过链动小铺购买", "Buy through Liandong Shop")}</h2><p>{t("在店铺完成付款后获取一次性兑换码，回到下方兑换到当前账号。", "After paying in the shop, return here with your single-use code and redeem it into this account.")}</p>
      {!data?.billing.enabled ? <p className="wallet-status">{t("Tokvilo 专属商品正在准备中，当前购买入口暂未开放。已取得的 Tokvilo 兑换码可在兑换服务开启时使用。", "tokvilo top-ups are being prepared and purchases are not yet available. Keep any codes you already have until redemption opens.")}</p> : null}
      <div className="wallet-packages">{(data?.billing.packages || []).map(item => <article key={item.id}><span>{t("Tokvilo API 余额", "tokvilo API credit")}</span><h3>¥{item.amountCny}</h3><p>{item.creditMicrousd === null ? t("充值汇率待配置", "Top-up conversion not configured") : t(`到账 ${money(item.creditMicrousd)}`, `${money(item.creditMicrousd)} credit`)}</p>{data?.billing.enabled && item.purchaseUrl ? <a className="console-button console-button-primary" href={item.purchaseUrl} target="_blank" rel="noopener noreferrer">{t("去链动购买 ↗", "Buy on Liandong ↗")}</a> : <button className="console-button" disabled>{t("暂未开放", "Not available yet")}</button>}</article>)}</div>
      <p className="wallet-fineprint">{data?.billing.usdCny ? t(`当前新发行兑换码按固定充值换算率 1 USD = ¥${data.billing.usdCny} 换算，这不是实时外汇报价。`, `New codes use a fixed top-up conversion of USD 1 = ¥${data.billing.usdCny}. This is not a live exchange rate. `) : ""}{t("每个兑换码的到账额度在发行时固定，以商品页及兑换记录为准。模型用量按页面价格扣费。", "Each code’s credit is fixed at issuance; see the product page and redemption record. Model usage is billed at the displayed rates.")}</p>
    </section>
    <section className="console-panel wallet-section"><h2>{t("兑换到账", "Redeem a code")}</h2><form className="wallet-form" onSubmit={redeem}><label htmlFor="redeem-code">{t("Tokvilo 兑换码", "tokvilo redemption code")}</label><input id="redeem-code" value={code} onChange={event => setCode(event.target.value)} autoComplete="off" spellCheck={false} placeholder="TK-XXXX-XXXX-…" maxLength={128} required /><label className="wallet-checkbox"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />{t(`我确认将余额兑换到当前账号 ${email}`, `I confirm that this credit will be added to ${email}`)}</label><button className="console-button console-button-primary" disabled={!!busy || !confirmed || !data?.billing.redemptionEnabled}>{busy === "redeem" ? t("兑换中…", "Redeeming…") : t("确认兑换", "Confirm redemption")}</button><p className="wallet-fineprint">{t("只支持 Tokvilo 的 TK 兑换码。佳农商品和 JN 兑换码用于佳农账号。付款完成或返回本站不会自动增加余额。", "Only tokvilo TK codes are accepted here. JiaNong products and JN codes belong to JiaNong accounts. Payment or returning to this site does not add balance automatically.")}</p></form></section>
    <section className="console-panel wallet-section"><h2>{t("最近账务记录", "Recent transactions")}</h2><div className="console-table-wrap"><table className="console-table"><thead><tr><th>{t("时间（北京时间）", "Time (UTC+8)")}</th><th>{t("说明", "Description")}</th><th>{t("余额变动", "Balance change")}</th></tr></thead><tbody>{data?.wallet.ledger.length ? data.wallet.ledger.map(row => <tr key={row.id}><td>{timestamp(row.created_at, isEnglish)}</td><td>{ledgerText(row.description, isEnglish)}</td><td className={row.amount_microusd < 0 ? "wallet-debit" : "wallet-credit"}>{row.amount_microusd > 0 ? "+" : ""}{money(row.amount_microusd)}</td></tr>) : <tr><td colSpan={3}>{data ? t("暂无账务记录。", "No transactions yet.") : t("正在读取账务记录…", "Loading transactions…")}</td></tr>}</tbody></table></div></section>
    {isAdmin ? <section className="console-panel wallet-section"><h2>{t("兑换码库存管理", "Redemption code inventory")}</h2><p>{t("生成 Tokvilo 专属库存，再下载导入链动小铺对应商品。明文只在首次发行响应中显示。", "Generate tokvilo codes, then download and import them into the matching Liandong Shop product. Plaintext codes are shown only in the first issuance response.")}</p><form className="wallet-form" onSubmit={issue}><div className="wallet-fields"><label>{t("充值面值", "Top-up denomination")}<select value={pack} onChange={event => setPack(event.target.value)}>{[30, 90, 300].map(n => <option key={n} value={String(n)}>¥{n}</option>)}</select></label><label>{t("数量", "Quantity")}<input type="number" min={1} max={1000} value={count} onChange={event => setCount(Number(event.target.value))} required /></label></div><label>{t("发行备注", "Issuance note")}<input value={note} onChange={event => setNote(event.target.value)} minLength={2} maxLength={500} placeholder={t("例如：Tokvilo 首批链动商品库存", "Example: first tokvilo inventory for Liandong")} required /></label><button className="console-button console-button-primary" disabled={!!busy || !data?.billing.issuanceEnabled}>{busy === "issue" ? t("生成中…", "Generating…") : t("生成库存", "Generate codes")}</button></form>
      {exportCodes.length ? <div className="wallet-export"><button className="console-button console-button-primary" type="button" onClick={downloadCodes}>{t(`下载 ${exportCodes.length} 个兑换码`, `Download ${exportCodes.length} codes`)}</button><button className="console-button" onClick={() => { setExportCodes([]); setExportId(""); issueRequest.current = null; }} type="button">{t("已保存，清除明文", "Saved — clear plaintext")}</button><textarea readOnly value={exportCodes.join("\n")} aria-label={t("新发行的兑换码", "Newly issued codes")} rows={6} /></div> : null}
      <div className="console-table-wrap"><table className="console-table"><thead><tr><th>{t("批次", "Batch")}</th><th>{t("面值 / 到账", "Price / Credit")}</th><th>{t("发行 / 已兑换 / 停用", "Issued / Redeemed / Disabled")}</th></tr></thead><tbody>{batches.map(batch => <tr key={batch.id}><td><code>{batch.id.slice(0, 8)}</code></td><td>¥{batch.amount_cny} / {money(batch.credit_microusd)}</td><td>{batch.issued_count} / {batch.redeemed_count} / {batch.revoked_count}</td></tr>)}</tbody></table></div>
      <details className="wallet-revoke"><summary>{t("停用兑换码并撤回对应余额", "Disable a code and reverse its credit")}</summary><form className="wallet-form" onSubmit={revoke}><label>{t("完整兑换码", "Full redemption code")}<input value={revokeCode} onChange={event => setRevokeCode(event.target.value)} autoComplete="off" maxLength={128} required /></label><label>{t("撤销备注", "Revocation note")}<input value={revokeNote} onChange={event => setRevokeNote(event.target.value)} minLength={2} maxLength={500} required /></label><label className="wallet-checkbox"><input type="checkbox" checked={revokeConfirmed} onChange={event => setRevokeConfirmed(event.target.checked)} />{t("确认停用此码并撤回已兑换的完整额度；现金退款另在链动处理。", "I confirm this code will be disabled and its full redeemed credit reversed. Any cash refund must be handled separately in Liandong.")}</label><button className="console-button" disabled={!!busy || !revokeConfirmed}>{busy === "revoke" ? t("处理中…", "Processing…") : t("停用此码", "Disable code")}</button></form></details>
    </section> : null}
  </div>;
}
