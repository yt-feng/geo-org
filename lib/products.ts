// Public retail catalogue observed at the source on 2026-10-20 (Asia/Shanghai).
// Stock is the source's observation, not Tokvilo-owned inventory.
export const PRODUCT_SOURCE = "https://xiaoxincodex.codes/products";
export const PRODUCTS_OBSERVED_AT = "2026-10-20";
export type DigitalProduct = { id: string; name: string; category: string; variant: string; upstreamCents: number; retailCents: number; sourceDelivery: "code" | "manual"; soldOut: boolean; description: string };
// Internal audit evidence. Do not render source branding or stock counts in the storefront.
// Detail-page statements are supplier claims, not verified tokvilo guarantees.
export const productSourceAudit: Record<string, { sourceUrl: string; sourceSpecification: string; observedStock: number; details: string[] }> = {
  "pro-20x-ph": { sourceUrl: `${PRODUCT_SOURCE}/11123`, sourceSpecification: "pro20X菲区", observedStock: 1, details: ["卡面标自动交付，详情要求联系客服发货。", "需要已有个人 GPT 账号。", "源头声明未激活可申请退款，激活后不退。"] },
  "pro-5x-ios": { sourceUrl: `${PRODUCT_SOURCE}/222`, sourceSpecification: "Pro5X", observedStock: 8, details: ["自动卡密兑换或联系人工处理。", "源头质保描述为订阅保障，不包含封号保障。"] },
  "pro-5x-ph": { sourceUrl: `${PRODUCT_SOURCE}/1568`, sourceSpecification: "PRO 5X", observedStock: 3, details: ["详情描述为 30 天订阅。", "不能覆盖 iOS 订阅，可由菲律宾区 Plus 升级。"] },
  "plus-year": { sourceUrl: `${PRODUCT_SOURCE}/132434`, sourceSpecification: "年puls", observedStock: 100, details: ["人工交付。", "源头描述可覆盖 Plus，订阅有效期一年。"] },
  "pro-20x-ios": { sourceUrl: `${PRODUCT_SOURCE}/2132324`, sourceSpecification: "20X(IOS)", observedStock: 0, details: ["核对时显示售罄。", "详情描述为一个月订阅，覆盖原订阅、不叠加，不刷新额度。"] },
  "plus-ios": { sourceUrl: `${PRODUCT_SOURCE}/11111`, sourceSpecification: "Puls（ios）", observedStock: 2, details: ["详情描述为一个月订阅。", "原 Plus 覆盖不叠加，不可覆盖 Pro，需要个人版账号。"] },
  "pro-5x-cl": { sourceUrl: `${PRODUCT_SOURCE}/111`, sourceSpecification: "pro5x", observedStock: 5, details: ["自动卡密兑换或联系人工处理。"] },
  "plus-ph": { sourceUrl: `${PRODUCT_SOURCE}/123`, sourceSpecification: "puls", observedStock: 19, details: ["需要已有个人账号。", "源头声明未激活可申请退款，激活后不退。", "源头质保描述为订阅保障，不包含封号保障。"] },
};
const rows: Array<Omit<DigitalProduct, "retailCents" | "category">> = [
  { id: "pro-20x-ph", name: "ChatGPT Pro 20x", variant: "菲律宾区 · 直充", upstreamCents: 125000, sourceDelivery: "manual", soldOut: false, description: "菲律宾区 Pro 20x 直充参考商品，需要已有个人账号。具体适用条件与人工处理安排通过邮件确认。" },
  { id: "pro-5x-ios", name: "ChatGPT Pro 5x", variant: "iOS 渠道", upstreamCents: 74000, sourceDelivery: "code", soldOut: false, description: "对应源头 iOS 渠道 Pro 5x 充值商品，交付充值兑换信息。" },
  { id: "pro-5x-ph", name: "ChatGPT Pro 5x", variant: "菲律宾区 · 30 天", upstreamCents: 74000, sourceDelivery: "code", soldOut: false, description: "菲律宾区 Pro 5x 参考商品，不能覆盖 iOS 订阅；Plus 升级条件通过邮件确认。" },
  { id: "plus-year", name: "ChatGPT Plus", variant: "一年会员 · 人工交付", upstreamCents: 160000, sourceDelivery: "manual", soldOut: false, description: "对应源头一年会员商品，由人工处理。具体生效时间以交付和订阅记录为准。" },
  { id: "pro-20x-ios", name: "ChatGPT Pro 20x", variant: "iOS 代充 · 一个月", upstreamCents: 155000, sourceDelivery: "code", soldOut: true, description: "核对时显示售罄，可提交需求咨询到货时间。覆盖原订阅、不叠加，具体条件通过邮件确认。" },
  { id: "plus-ios", name: "ChatGPT Plus", variant: "iOS 渠道 · 一个月", upstreamCents: 14500, sourceDelivery: "code", soldOut: false, description: "面向个人版账号，原 Plus 覆盖不叠加，不可覆盖 Pro。适用条件通过邮件确认。" },
  { id: "pro-5x-cl", name: "ChatGPT Pro 5x", variant: "智利区", upstreamCents: 74000, sourceDelivery: "code", soldOut: false, description: "对应源头智利区 Pro 5x 充值商品，交付充值兑换信息。" },
  { id: "plus-ph", name: "ChatGPT Plus", variant: "菲律宾区", upstreamCents: 13500, sourceDelivery: "code", soldOut: false, description: "菲律宾区 Plus 参考商品，需要已有个人账号。兑换方式与适用条件通过邮件确认。" },
];
export const digitalProducts: DigitalProduct[] = rows.map(row => ({ ...row, category: "ChatGPT", retailCents: Math.ceil(row.upstreamCents * 6 / 5) }));
export const cny = (cents: number) => `¥${(cents / 100).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
