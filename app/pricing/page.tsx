import { PublicNav } from "@/components/PublicNav";
import { PriceTable } from "@/components/PriceTable";
import Link from "next/link";
export const metadata = { title: "价格" };
export default function PricingPage() {
  return <div className="market-page"><PublicNav /><main className="market-main"><header className="market-intro"><span className="landing-eyebrow">SIMPLE, TRANSPARENT PRICING</span><h1>价格清晰，按量使用。<br />每一笔，都清楚。</h1><p>模型 API 按实际使用量结算。调用前预留额度，结果确认后结算，多余额度自动释放。</p><div className="landing-hero-actions"><Link className="button button-primary" href="/dashboard/wallet">余额与充值 ↗</Link><Link className="button button-secondary" href="/products">查看数字商品</Link></div></header><PriceTable /></main></div>;
}
