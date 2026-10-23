import type { DigitalProduct } from "./public-products";
import type { SiteLocale } from "./site-locale";

/** Customer-facing translations only. Product identities, prices and fulfilment stay in public-products. */
const english: Record<string, { variant: string; description: string }> = {
  "pro-20x-ph": { variant: "Philippines · Direct top-up", description: "Pro 20x top-up for the Philippines region. An existing personal account is required. Eligibility and manual processing arrangements are confirmed by email." },
  "pro-5x-ios": { variant: "iOS channel", description: "Pro 5x top-up through the iOS channel, delivered as redemption information." },
  "pro-5x-ph": { variant: "Philippines · 30 days", description: "Pro 5x subscription for the Philippines region. Cannot replace an iOS subscription. Plus upgrade conditions are confirmed by email." },
  "plus-year": { variant: "One year · Manual fulfilment", description: "One-year membership with manual processing. The start date is determined by the delivery and subscription records." },
  "pro-20x-ios": { variant: "iOS top-up · One month", description: "Currently sold out; inquire about restocking. Replaces an existing subscription rather than extending it. Specific conditions are confirmed by email." },
  "plus-ios": { variant: "iOS channel · One month", description: "For personal accounts. Replaces an existing Plus subscription rather than extending it; cannot replace Pro. Eligibility is confirmed by email." },
  "pro-5x-cl": { variant: "Chile region", description: "Pro 5x top-up for the Chile region, delivered as redemption information." },
  "plus-ph": { variant: "Philippines region", description: "Plus subscription for the Philippines region. An existing personal account is required. Redemption and eligibility are confirmed by email." },
};

export function productCopy(product: DigitalProduct, locale: SiteLocale) {
  if (locale === "en") return english[product.id] || { variant: product.variant, description: "Send an inquiry to confirm product details and availability." };
  return { variant: product.variant, description: product.description.replaceAll("处理订单", "确认需求").replaceAll("订单内", "邮件内").replaceAll("暂不接受订单", "可提交需求咨询到货时间") };
}
