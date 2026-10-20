import { authBaseUrl, authRequestHeaders } from "@/lib/auth";

export const dynamic = "force-dynamic";
type AuthStatus = {
  configured: boolean; available: boolean;
  signupEnabled: boolean | null; emailEnabled: boolean | null; emailAutoConfirm: boolean | null;
  registrationSendsEmail: boolean | null;
  providerFamily: "supabase" | "custom" | "invalid";
  errorCode: string | null; upstreamStatus: number | null;
  fetchErrorName: string | null;
  failureStage: "fetch" | "response_json" | null;
};
type StatusResult = { body: AuthStatus; status: number };
let cached: { result: StatusResult; expiresAt: number } | undefined;
let pending: Promise<StatusResult> | undefined;

async function inspectAuth(): Promise<StatusResult> {
  const body: AuthStatus = {
    configured: false, available: false, signupEnabled: null, emailEnabled: null, emailAutoConfirm: null,
    registrationSendsEmail: null, providerFamily: "invalid", errorCode: null, upstreamStatus: null,
    fetchErrorName: null, failureStage: null,
  };
  let base: string, headers: Headers;
  try { base = authBaseUrl(); headers = authRequestHeaders(); }
  catch { return { body: { ...body, errorCode: "auth_not_configured" }, status: 503 }; }
  try {
    const url = new URL(base), host = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash ||
      host === "localhost" || host === "[::1]" || host === "0.0.0.0" || host.startsWith("127.") ||
      /\.(localhost|local|invalid|example|test)$/.test(host) ||
      /^(your-project|project-id|your-supabase-project)\./.test(host) || !headers.get("apikey")?.trim()) throw new Error();
    body.providerFamily = host.endsWith(".supabase.co") ? "supabase" : "custom";
  } catch { return { body: { ...body, errorCode: "auth_config_invalid" }, status: 503 }; }
  body.configured = true;
  const signal = AbortSignal.timeout(10_000);
  let stage: "fetch" | "response_json" = "fetch";
  try {
    const response = await fetch(`${base.replace(/\/+$/, "")}/auth/v1/settings`, {
      headers, signal, redirect: "manual", cache: "no-store",
    });
    body.upstreamStatus = response.status;
    if (!response.ok) {
      body.errorCode = response.status === 401 || response.status === 403 ? "auth_credentials_rejected"
        : response.status === 429 ? "auth_rate_limited" : "auth_upstream_unavailable";
      return { body, status: 503 };
    }
    stage = "response_json";
    const settings = await response.json() as {
      disable_signup?: unknown; mailer_autoconfirm?: unknown; external?: { email?: unknown };
    } | null;
    if (!settings || (settings.disable_signup !== undefined && typeof settings.disable_signup !== "boolean") ||
      typeof settings.mailer_autoconfirm !== "boolean" || typeof settings.external?.email !== "boolean") {
      return { body: { ...body, errorCode: "auth_invalid_response" }, status: 503 };
    }
    body.available = true;
    body.signupEnabled = typeof settings.disable_signup === "boolean" ? !settings.disable_signup : null;
    body.emailEnabled = settings.external.email;
    body.emailAutoConfirm = settings.mailer_autoconfirm;
    body.registrationSendsEmail = body.emailEnabled && !body.emailAutoConfirm;
    body.errorCode = body.signupEnabled === false ? "signup_disabled" : !body.emailEnabled ? "email_provider_disabled" : null;
    return { body, status: 200 };
  } catch (cause) {
    const name = cause && typeof cause === "object" && "name" in cause ? cause.name : "";
    const safeName = typeof name === "string" && ["TypeError", "SyntaxError", "TimeoutError", "AbortError", "Error"].includes(name)
      ? name : "UnknownError";
    return { body: {
      ...body, errorCode: signal.aborted ? "auth_timeout" : "auth_upstream_unavailable",
      fetchErrorName: safeName, failureStage: stage,
    }, status: 503 };
  }
}

export async function GET(): Promise<Response> {
  if (!cached || cached.expiresAt <= Date.now()) {
    pending ??= inspectAuth().then(result => {
      cached = { result, expiresAt: Date.now() + 60_000 }; return result;
    }).finally(() => { pending = undefined; });
    await pending;
  }
  const result = cached!.result;
  return Response.json(result.body, { status: result.status, headers: { "cache-control": "public, max-age=60, s-maxage=60" } });
}
