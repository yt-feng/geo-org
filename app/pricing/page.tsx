import { PublicNav } from "@/components/PublicNav";
import { PriceTable } from "@/components/PriceTable";
import Link from "next/link";
export const metadata = { title: "价格" };
export default function PricingPage() {
  return <div className="market-page"><PublicNav /><main className="market-main"><header className="market-intro"><span className="landing-eyebrow">SIMPLE, TRANSPARENT PRICING</span><h1>找到适合你的模型与价格。</h1><p>按厂商与系列比较各版本售价。API 调用前预留余额，结果确认后按实际用量结算，多余预留自动退回。</p><div className="landing-hero-actions"><Link className="button button-primary" href="/dashboard/wallet">余额与充值 ↗</Link><Link className="button button-secondary" href="/products">查看数字商品</Link></div></header><PriceTable /></main></div>;
}
