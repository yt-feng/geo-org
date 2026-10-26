import { getBillingConfig } from "@/lib/redemption";

export const dynamic = "force-dynamic";
export function GET() { return Response.json(getBillingConfig(), { headers: { "cache-control": "no-store" } }); }
