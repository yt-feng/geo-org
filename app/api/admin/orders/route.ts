import { handleOrders } from "@/lib/orders";
export const GET = (request: Request) => handleOrders(request, true);
export const PATCH = GET;
