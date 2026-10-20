import { handleWalletRequest } from "@/lib/redemption";

export const dynamic = "force-dynamic";
export function GET(request: Request) { return handleWalletRequest(request, "wallet"); }
