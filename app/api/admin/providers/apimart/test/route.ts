import { handleProviderRequest } from "@/lib/provider-api";
export const dynamic = "force-dynamic";
export function POST(request: Request) { return handleProviderRequest(request, "test"); }
