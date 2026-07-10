import { getPortalUser } from "@/lib/auth";
import { getD1, numericEnv } from "@/lib/config";
import { createApiKey } from "@/lib/crypto";
import { ensureUser, listApiKeys } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const user = await getPortalUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  await ensureUser(user);
  return Response.json({ keys: await listApiKeys(user.id) });
}

export async function POST(request: Request): Promise<Response> {
  const user = await getPortalUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  await ensureUser(user);
  const maxKeys = numericEnv("MAX_ACTIVE_KEYS_PER_USER", 5);
  const row = await getD1()
    .prepare(
      "SELECT COUNT(*) AS count FROM api_keys WHERE user_id = ? AND revoked_at IS NULL",
    )
    .bind(user.id)
    .first<{ count: number }>();
  if (Number(row?.count || 0) >= maxKeys) {
    return Response.json({ error: "Active key limit reached." }, { status: 409 });
  }

  let label = "Default key";
  try {
    const payload = (await request.json()) as { label?: string };
    label = payload.label?.trim().slice(0, 60) || label;
  } catch {
    // Empty JSON is accepted for the default label.
  }
  const generated = await createApiKey();
  await getD1()
    .prepare(
      `INSERT INTO api_keys (id, user_id, label, key_prefix, key_hash)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(generated.id, user.id, label, generated.prefix, generated.hash)
    .run();
  return Response.json(
    {
      key: generated.key,
      record: {
        id: generated.id,
        label,
        key_prefix: generated.prefix,
      },
    },
    { status: 201 },
  );
}

export async function DELETE(request: Request): Promise<Response> {
  const user = await getPortalUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const id = new URL(request.url).searchParams.get("id")?.trim() || "";
  if (!id) return Response.json({ error: "Key id is required." }, { status: 400 });
  await getD1()
    .prepare(
      `UPDATE api_keys SET revoked_at = CURRENT_TIMESTAMP
       WHERE id = ? AND user_id = ? AND revoked_at IS NULL`,
    )
    .bind(id, user.id)
    .run();
  return Response.json({ ok: true });
}
