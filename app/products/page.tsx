import { PublicNav } from "@/components/PublicNav";
import { ProductMarket } from "@/components/ProductMarket";
import { PRODUCT_SOURCE } from "@/lib/products";
export const metadata = { title: "数字商品" };
export default function ProductsPage() {
  return <div className="market-page"><PublicNav /><main className="market-main"><header className="market-intro"><span className="landing-eyebrow">TOKVILO / DIGITAL GOODS</span><h1>你的 AI 工具，<br />在这里备齐。</h1><p>订阅与充值商品，统一在 tokvilo 管理。按公开源价加价 20%，规格、价格与交付方式清楚列示。</p></header><p className="price-caption">价格参考 <a href={PRODUCT_SOURCE} target="_blank" rel="noreferrer">小鑫公开商品目录 ↗</a>，核对日期为 2026 年 10 月 20 日。当前 8 个商品；源头库存与 tokvilo 交付分别确认。tokvilo 为独立服务商，与产品原厂无隶属关系。</p><ProductMarket /></main></div>;
}
