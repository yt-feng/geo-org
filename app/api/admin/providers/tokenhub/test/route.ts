import { handleTokenHubProviderRequest } from "@/lib/tokenhub-api";

export function POST(request: Request) { return handleTokenHubProviderRequest(request, "test"); }
