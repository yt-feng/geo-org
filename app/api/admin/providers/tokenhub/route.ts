import { handleTokenHubProviderRequest } from "@/lib/tokenhub-api";

export function GET(request: Request) { return handleTokenHubProviderRequest(request, "status"); }
export function POST(request: Request) { return handleTokenHubProviderRequest(request, "save"); }
