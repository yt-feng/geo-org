import { ACCESS_COOKIE, REFRESH_COOKIE } from "@/lib/auth";

export const dynamic = "force-dynamic";

function clearCookie(name: string, secure: boolean): string {
  return [
    `${name}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    secure ? "Secure" : "",
    "Max-Age=0",
  ]
    .filter(Boolean)
    .join("; ");
}

export async function POST(request: Request): Promise<Response> {
  const secure = new URL(request.url).protocol === "https:";
  const headers = new Headers({ "content-type": "application/json" });
  headers.append("set-cookie", clearCookie(ACCESS_COOKIE, secure));
  headers.append("set-cookie", clearCookie(REFRESH_COOKIE, secure));
  return new Response(JSON.stringify({ ok: true }), { headers });
}
