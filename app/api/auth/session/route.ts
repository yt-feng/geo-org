import { getPortalUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const user = await getPortalUser();
  return user
    ? Response.json({ user })
    : Response.json({ error: "Unauthorized" }, { status: 401 });
}
