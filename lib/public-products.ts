// This module is safe to bundle in the storefront. Keep supplier records in products.ts.
export type DigitalProduct = {
  id: string; name: string; category: string; variant: string; retailCents: number;
  delivery: "code" | "manual"; soldOut: boolean; description: string;
};
export const digitalProducts: DigitalProduct[] = [
  { id: "pro-20x-ph", name: "ChatGPT Pro 20x", category: "ChatGPT", variant: "菲律宾区 · 直充", retailCents: 150000, delivery: "manual", soldOut: false, description: "菲律宾区 Pro 20x 直充，需要已有个人账号。具体适用条件与人工处理安排通过邮件确认。" },
  { id: "pro-5x-ios", name: "ChatGPT Pro 5x", category: "ChatGPT", variant: "iOS 渠道", retailCents: 88800, delivery: "code", soldOut: false, description: "iOS 渠道 Pro 5x 充值商品，交付充值兑换信息。" },
  { id: "pro-5x-ph", name: "ChatGPT Pro 5x", category: "ChatGPT", variant: "菲律宾区 · 30 天", retailCents: 88800, delivery: "code", soldOut: false, description: "菲律宾区 Pro 5x 订阅，不能覆盖 iOS 订阅；Plus 升级条件通过邮件确认。" },
  { id: "plus-year", name: "ChatGPT Plus", category: "ChatGPT", variant: "一年会员 · 人工交付", retailCents: 192000, delivery: "manual", soldOut: false, description: "一年会员订阅，由人工处理。具体生效时间以交付和订阅记录为准。" },
  { id: "pro-20x-ios", name: "ChatGPT Pro 20x", category: "ChatGPT", variant: "iOS 代充 · 一个月", retailCents: 186000, delivery: "code", soldOut: true, description: "当前售罄，可提交需求咨询到货时间。覆盖原订阅、不叠加，具体条件通过邮件确认。" },
  { id: "plus-ios", name: "ChatGPT Plus", category: "ChatGPT", variant: "iOS 渠道 · 一个月", retailCents: 17400, delivery: "code", soldOut: false, description: "面向个人版账号，原 Plus 覆盖不叠加，不可覆盖 Pro。适用条件通过邮件确认。" },
  { id: "pro-5x-cl", name: "ChatGPT Pro 5x", category: "ChatGPT", variant: "智利区", retailCents: 88800, delivery: "code", soldOut: false, description: "智利区 Pro 5x 充值商品，交付充值兑换信息。" },
  { id: "plus-ph", name: "ChatGPT Plus", category: "ChatGPT", variant: "菲律宾区", retailCents: 16200, delivery: "code", soldOut: false, description: "菲律宾区 Plus 订阅，需要已有个人账号。兑换方式与适用条件通过邮件确认。" },
];
export const cny = (cents: number) => `¥${(cents / 100).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
