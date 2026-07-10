import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { runtimeEnv } from "./config";
import { safeEqual } from "./crypto";

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

function base64UrlEncode(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(value: string): string {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(
    Math.ceil(value.length / 4) * 4,
    "=",
  );
  const binary = atob(padded);
  return new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
}

async function adminSignature(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)),
  );
  let binary = "";
  for (const byte of signature) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export async function createAdminSession(
  username: string,
  password: string,
): Promise<string | null> {
  const current = runtimeEnv();
  const configuredUsername = current.ADMIN_USERNAME?.trim() || "admin";
  const configuredPassword = current.ADMIN_PASSWORD || "";
  const secret = current.ADMIN_SESSION_SECRET || "";
  if (
    !configuredPassword ||
    secret.length < 32 ||
    !safeEqual(username, configuredUsername) ||
    !safeEqual(password, configuredPassword)
  ) {
    return null;
  }
  const payload = base64UrlEncode(
    JSON.stringify({
      sub: "admin",
      username: configuredUsername,
      exp: Math.floor(Date.now() / 1000) + 60 * 60 * 12,
    }),
  );
  return `eco_admin.${payload}.${await adminSignature(payload, secret)}`;
}

async function verifyAdminSession(token: string): Promise<PortalUser | null> {
  if (!token.startsWith("eco_admin.")) return null;
  const current = runtimeEnv();
  const secret = current.ADMIN_SESSION_SECRET || "";
  if (secret.length < 32) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [, payload, signature] = parts;
  if (!safeEqual(signature, await adminSignature(payload, secret))) return null;
  try {
    const decoded = JSON.parse(base64UrlDecode(payload)) as {
      sub?: string;
      username?: string;
      exp?: number;
    };
    if (
      decoded.sub !== "admin" ||
      !decoded.username ||
      !decoded.exp ||
      decoded.exp <= Math.floor(Date.now() / 1000)
    ) {
      return null;
    }
    return {
      id: "admin",
      email: "admin@eco-geo.local",
      displayName: decoded.username,
      isAdmin: true,
    };
  } catch {
    return null;
  }
}

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
  const admin = await verifyAdminSession(token);
  if (admin) return admin;
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
