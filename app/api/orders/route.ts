import { handleOrders } from "@/lib/orders";
export const GET = (request: Request) => handleOrders(request);
export const POST = () => Response.json(
  { error: "商品购买已改为需求表单，请在商品页提交需求，我们将在 24 小时内邮件回复。", inquiryUrl: "/products" },
  { status: 410, headers: { "cache-control": "private, no-store" } },
);
export const PATCH = GET;
