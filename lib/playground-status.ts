import { getPortalUser } from "./auth";
import { runtimeEnv, type RuntimeEnv } from "./config";
import { createProviderSettings, ProviderError } from "./provider-settings";
import { createTokenHubSettings } from "./tokenhub-settings";
import { parseRkapiRoutes } from "./rkapi-settings";

export type PlaygroundService = "gateway" | "studio" | "selected";
export type PlaygroundStatusCode = "configuration_available" | "service_disabled" | "service_not_configured"
  | "service_configuration_unavailable" | "account_disabled" | "balance_empty";
export type PlaygroundStatus = {
  service: PlaygroundService;
  authenticated: true;
  serviceEnabled: boolean;
  configured: boolean;
  accountActive: boolean;
  balanceMicrousd: number;
  currency: "USD";
  code: PlaygroundStatusCode;
  checks: "configuration_only";
};

const headers = { "cache-control": "private, no-store", "x-content-type-options": "nosniff" };
function failure(code: string, message: string, status: number) {
  return Response.json({ code, error: { code, message }, ...(status === 401 ? { authenticated: false } : {}) }, { status, headers });
}

/** Only inspect local configuration. Do not validate keys or invoke models here. */
async function configuration(service: PlaygroundService, env: RuntimeEnv): Promise<"configured" | "missing" | "unavailable"> {
  try {
    if (service === "selected") return parseRkapiRoutes(env.RKAPI_ROUTES_JSON).length ? "configured" : "missing";
    const settings = service === "gateway" ? createProviderSettings(env) : createTokenHubSettings(env);
    return (await settings.credential()).trim() ? "configured" : "missing";
  } catch (cause) {
    return cause instanceof ProviderError && cause.status === 409 ? "missing" : "unavailable";
  }
}

export async function handlePlaygroundStatus(request: Request): Promise<Response> {
  try {
    const user = await getPortalUser();
    if (!user) return failure("login_required", "请先登录。", 401);
    const query = new URL(request.url).searchParams;
    const service = query.get("service") || "gateway";
    if (query.getAll("service").length > 1 || !["gateway", "studio", "selected"].includes(service)) {
      return failure("unsupported_service", "请选择有效的工作台服务。", 400);
    }
    const env = runtimeEnv();
    if (!env.DB) return failure("status_unavailable", "暂时无法读取工作台状态，请稍后刷新。", 503);
    const [account, config] = await Promise.all([
      env.DB.prepare(`SELECT u.status,COALESCE(w.balance_microusd,0) AS balance_microusd
        FROM users u LEFT JOIN wallet_accounts w ON w.user_id=u.id WHERE u.id=?`).bind(user.id)
        .first<{ status: string; balance_microusd: number }>(),
      configuration(service as PlaygroundService, env),
    ]);
    const balanceMicrousd = account?.balance_microusd ?? 0;
    if (!Number.isSafeInteger(balanceMicrousd)) return failure("status_unavailable", "暂时无法读取工作台状态，请稍后刷新。", 503);
    // The relay creates a new authenticated account on first use. This read-only
    // check must not create it, and its absence must not imply a suspension.
    const accountActive = !account || account.status === "active";
    const serviceEnabled = env.SERVICE_ENABLED?.toLowerCase() === "true";
    const configured = config === "configured";
    const code: PlaygroundStatusCode = !accountActive ? "account_disabled"
      : !serviceEnabled ? "service_disabled"
        : config === "missing" ? "service_not_configured"
          : config === "unavailable" ? "service_configuration_unavailable"
            : balanceMicrousd <= 0 ? "balance_empty" : "configuration_available";
    const status: PlaygroundStatus = {
      service: service as PlaygroundService, authenticated: true, serviceEnabled, configured, accountActive,
      balanceMicrousd, currency: "USD", code, checks: "configuration_only",
    };
    return Response.json(status, { headers });
  } catch {
    return failure("status_unavailable", "暂时无法读取工作台状态，请稍后刷新。", 503);
  }
}
