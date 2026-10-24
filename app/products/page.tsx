import { PublicFooter } from "@/components/PublicFooter";
import { PublicNav } from "@/components/PublicNav";
import { ProductMarket } from "@/components/ProductMarket";
export const metadata = { title: "数字商品" };
export default function ProductsPage() {
  return <div className="market-page"><PublicNav /><main className="market-main"><header className="market-intro"><span className="landing-eyebrow">TOKVILO / DIGITAL GOODS</span><h1>你的 AI 工具，<br />在这里备齐。</h1><p>订阅与充值商品，售价一目了然。提交购买需求后，我们将在 24 小时内通过邮件回复。</p></header><p className="price-caption">参考价格核对日期为 2026 年 10 月 20 日。当前 8 个商品；库存、适用条件与交付安排通过邮件确认。tokvilo 为独立服务商，与产品原厂无隶属关系。</p><ProductMarket /></main><PublicFooter /></div>;
}
