import { handlePaddleRequest } from "@/lib/paddle";
export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{id: string}> }) { return handlePaddleRequest(request, "order", (await context.params).id); }
