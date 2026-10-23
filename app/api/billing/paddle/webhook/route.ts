import { handlePaddleWebhook } from "@/lib/paddle";
export const dynamic = "force-dynamic";
export function POST(request: Request) { return handlePaddleWebhook(request); }
