import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  authBaseUrl,
  authRequestHeaders,
} from "@/lib/auth";

export const dynamic = "force-dynamic";

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
};

function cookieHeader(
  name: string,
  value: string,
  maxAge: number,
  secure: boolean,
): string {
  return [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    secure ? "Secure" : "",
    `Max-Age=${Math.max(0, Math.floor(maxAge))}`,
  ]
    .filter(Boolean)
    .join("; ");
}

export async function POST(request: Request): Promise<Response> {
  let payload: { email?: string; password?: string };
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  const email = payload.email?.trim().toLowerCase() || "";
  const password = payload.password || "";
  if (!email || !password) {
    return Response.json({ error: "Email and password are required." }, { status: 400 });
  }

  let authResponse: Response;
  try {
    authResponse = await fetch(`${authBaseUrl()}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: authRequestHeaders(),
      body: JSON.stringify({ email, password }),
    });
  } catch {
    return Response.json(
      { error: "Sign-in is temporarily unavailable." },
      { status: 503 },
    );
  }
  if (!authResponse.ok) {
    return Response.json(
      { error: "Email or password is incorrect, or the email is not verified." },
      { status: 401 },
    );
  }

  const tokens = (await authResponse.json()) as TokenResponse;
  if (!tokens.access_token || !tokens.refresh_token) {
    return Response.json({ error: "Sign-in failed." }, { status: 502 });
  }

  const headers = new Headers({ "content-type": "application/json" });
  const secure = new URL(request.url).protocol === "https:";
  headers.append(
    "set-cookie",
    cookieHeader(
      ACCESS_COOKIE,
      tokens.access_token,
      Math.max(60, Number(tokens.expires_in || 3600)),
      secure,
    ),
  );
  headers.append(
    "set-cookie",
    cookieHeader(REFRESH_COOKIE, tokens.refresh_token, 60 * 60 * 24 * 30, secure),
  );
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
}
