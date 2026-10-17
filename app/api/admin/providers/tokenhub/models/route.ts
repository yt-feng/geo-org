import { handleTokenHubProviderRequest } from "@/lib/tokenhub-api";

export function GET(request: Request) { return handleTokenHubProviderRequest(request, "models"); }
