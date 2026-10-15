import { handleProviderRequest } from "@/lib/provider-api";
export const dynamic = "force-dynamic";
export function GET(request: Request) { return handleProviderRequest(request, "status"); }
