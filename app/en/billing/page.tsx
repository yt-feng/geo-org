import { BillingInformation } from "@/components/BillingInformation";
import { getPaddleConfig } from "@/lib/paddle";
export const dynamic = "force-dynamic";
export const metadata = { title: "Payments", description: "tokvilo API usage packs and enterprise bank transfers. Review pricing, payment arrangements and service policies." };
export default function BillingPage() {
  const config = getPaddleConfig();
  return <BillingInformation checkoutAvailable={config.enabled && config.environment === "production"} />;
}
