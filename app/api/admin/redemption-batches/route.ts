import { handleWalletRequest } from "@/lib/redemption";

export const dynamic = "force-dynamic";
export function GET(request: Request) { return handleWalletRequest(request, "batches"); }
export function POST(request: Request) { return handleWalletRequest(request, "batches"); }
