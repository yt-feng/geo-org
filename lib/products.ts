// Public retail catalogue observed at the source on 2026-10-20 (Asia/Shanghai).
// Stock is the source's observation, not Tokvilo-owned inventory.
export const PRODUCT_SOURCE = "https://xiaoxincodex.codes/products";
export const PRODUCTS_OBSERVED_AT = "2026-10-20";
export type DigitalProduct = { id: string; name: string; category: string; variant: string; upstreamCents: number; retailCents: number; sourceDelivery: "code" | "manual"; soldOut: boolean; description: string };
const rows: Array<Omit<DigitalProduct, "retailCents" | "category">> = [
  { id: "pro-20x-ph", name: "ChatGPT Pro 20x", variant: "菲律宾区 · 直充", upstreamCents: 125000, sourceDelivery: "code", soldOut: false, description: "对应源头 Pro 20x 菲律宾区直充商品。区域与充值条件在处理订单时确认。" },
  { id: "pro-5x-ios", name: "ChatGPT Pro 5x", variant: "iOS 渠道", upstreamCents: 74000, sourceDelivery: "code", soldOut: false, description: "对应源头 iOS 渠道 Pro 5x 充值商品，交付充值兑换信息。" },
  { id: "pro-5x-ph", name: "ChatGPT Pro 5x", variant: "菲律宾区", upstreamCents: 74000, sourceDelivery: "code", soldOut: false, description: "对应源头菲律宾区 Pro 5x 充值商品。适用账户条件在交付前确认。" },
  { id: "plus-year", name: "ChatGPT Plus", variant: "一年会员 · 人工交付", upstreamCents: 160000, sourceDelivery: "manual", soldOut: false, description: "对应源头一年会员商品，由人工处理。具体生效时间以交付和订阅记录为准。" },
  { id: "pro-20x-ios", name: "ChatGPT Pro 20x", variant: "iOS 代充", upstreamCents: 155000, sourceDelivery: "code", soldOut: true, description: "源头目录当前显示售罄，暂不接受订单。" },
  { id: "plus-ios", name: "ChatGPT Plus", variant: "iOS 渠道", upstreamCents: 14500, sourceDelivery: "code", soldOut: false, description: "对应源头 iOS 渠道 Plus 充值商品，交付后按兑换说明操作。" },
  { id: "pro-5x-cl", name: "ChatGPT Pro 5x", variant: "智利区", upstreamCents: 74000, sourceDelivery: "code", soldOut: false, description: "对应源头智利区 Pro 5x 充值商品，交付充值兑换信息。" },
  { id: "plus-ph", name: "ChatGPT Plus", variant: "菲律宾区", upstreamCents: 13500, sourceDelivery: "code", soldOut: false, description: "对应源头菲律宾区 Plus 充值商品。请按订单内提供的兑换说明使用。" },
];
export const digitalProducts: DigitalProduct[] = rows.map(row => ({ ...row, category: "ChatGPT", retailCents: Math.ceil(row.upstreamCents * 6 / 5) }));
export const cny = (cents: number) => `¥${(cents / 100).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
