import { handlePaddleRequest } from "@/lib/paddle";
export const dynamic = "force-dynamic";
export function POST(request: Request) { return handlePaddleRequest(request, "checkout"); }
