import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { runtimeEnv } from "./config";

export const ACCESS_COOKIE = "eco_geo_access";
export const REFRESH_COOKIE = "eco_geo_refresh";

export type PortalUser = {
  id: string;
  email: string;
  displayName: string;
  isAdmin: boolean;
};

type AuthUserPayload = {
  id?: string;
  email?: string;
  user_metadata?: {
    display_name?: string;
    full_name?: string;
    name?: string;
  };
};

function authConfig(): { baseUrl: string; anonKey: string } | null {
  const current = runtimeEnv();
  const baseUrl = current.AUTH_BASE_URL?.replace(/\/+$/, "");
  const anonKey = current.AUTH_ANON_KEY?.trim();
  return baseUrl && anonKey ? { baseUrl, anonKey } : null;
}

export function isAdminEmail(email: string): boolean {
  const allowlist = (runtimeEnv().ADMIN_EMAIL || "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  return allowlist.includes(email.trim().toLowerCase());
}

export async function verifyAccessToken(
  token: string,
): Promise<PortalUser | null> {
  const config = authConfig();
  if (!config || !token) return null;

  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}/auth/v1/user`, {
      headers: {
        apikey: config.anonKey,
        authorization: `Bearer ${token}`,
      },
      cache: "no-store",
    });
  } catch {
    return null;
  }
  if (!response.ok) return null;

  const payload = (await response.json()) as AuthUserPayload;
  const id = payload.id?.trim();
  const email = payload.email?.trim().toLowerCase();
  if (!id || !email) return null;
  const metadata = payload.user_metadata || {};
  const displayName =
    metadata.display_name?.trim() ||
    metadata.full_name?.trim() ||
    metadata.name?.trim() ||
    email.split("@")[0];

  return { id, email, displayName, isAdmin: isAdminEmail(email) };
}

export async function getPortalUser(): Promise<PortalUser | null> {
  const cookieStore = await cookies();
  return verifyAccessToken(cookieStore.get(ACCESS_COOKIE)?.value || "");
}

export async function requirePortalUser(): Promise<PortalUser> {
  const user = await getPortalUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireAdminUser(): Promise<PortalUser> {
  const user = await requirePortalUser();
  if (!user.isAdmin) redirect("/dashboard");
  return user;
}

export function authRequestHeaders(): Headers {
  const config = authConfig();
  if (!config) throw new Error("Authentication is not configured");
  return new Headers({
    apikey: config.anonKey,
    authorization: `Bearer ${config.anonKey}`,
    "content-type": "application/json",
  });
}

export function authBaseUrl(): string {
  const config = authConfig();
  if (!config) throw new Error("Authentication is not configured");
  return config.baseUrl;
}
