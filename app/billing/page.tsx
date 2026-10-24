import { BillingInformation } from "@/components/BillingInformation";
import { getPaddleConfig } from "@/lib/paddle";
export const dynamic = "force-dynamic";
export const metadata = { title: "支付方式", description: "tokvilo API 服务用量包与企业银行转账。查看价格、付款安排和服务政策。" };
export default function BillingPage() {
  const config = getPaddleConfig();
  return <BillingInformation checkoutAvailable={config.enabled && config.environment === "production"} />;
}
