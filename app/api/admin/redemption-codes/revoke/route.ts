import { handleWalletRequest } from "@/lib/redemption";

export function POST(request: Request) { return handleWalletRequest(request, "revoke"); }
