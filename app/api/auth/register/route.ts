import { authBaseUrl, authRequestHeaders } from "@/lib/auth";
import { publicBaseUrl } from "@/lib/config";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  let payload: { email?: string; password?: string; displayName?: string };
  try {
    payload = (await request.json()) as typeof payload;
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  const email = payload.email?.trim().toLowerCase() || "";
  const password = payload.password || "";
  const displayName = payload.displayName?.trim() || "";
  if (!/^\S+@\S+\.\S+$/.test(email)) {
    return Response.json({ error: "Please enter a valid email." }, { status: 400 });
  }
  if (password.length < 10) {
    return Response.json(
      { error: "Password must be at least 10 characters." },
      { status: 400 },
    );
  }

  let response: Response;
  try {
    const redirectTo = encodeURIComponent(`${publicBaseUrl()}/login?verified=1`);
    response = await fetch(`${authBaseUrl()}/auth/v1/signup?redirect_to=${redirectTo}`, {
      method: "POST",
      headers: authRequestHeaders(),
      body: JSON.stringify({
        email,
        password,
        data: { display_name: displayName || email.split("@")[0] },
      }),
    });
  } catch {
    return Response.json(
      { error: "Registration is temporarily unavailable." },
      { status: 503 },
    );
  }

  if (!response.ok) {
    return Response.json(
      { error: "Unable to create this account." },
      { status: response.status === 429 ? 429 : 400 },
    );
  }
  const result = (await response.json()) as { session?: unknown };
  return Response.json({
    ok: true,
    requiresEmailVerification: !result.session,
  });
}
