import { getPaddleConfig } from "@/lib/paddle";
export const dynamic = "force-dynamic";
export function GET() { return Response.json(getPaddleConfig(), { headers: { "cache-control": "no-store" } }); }
