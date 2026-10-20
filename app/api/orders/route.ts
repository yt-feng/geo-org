import { handleOrders } from "@/lib/orders";
export const GET = (request: Request) => handleOrders(request);
export const POST = GET;
export const PATCH = GET;
