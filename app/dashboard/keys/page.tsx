import type { Metadata } from "next";
import { ApiKeysPanel } from "@/components/ApiKeysPanel";
import { DashboardShell } from "@/components/DashboardShell";
import { requirePortalUser } from "@/lib/auth";
import { ensureUser, listApiKeys } from "@/lib/store";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "API 密钥" };

export default async function KeysPage() {
  const user = await requirePortalUser();
  await ensureUser(user);
  const keys = await listApiKeys(user.id);
  return <DashboardShell active="keys" user={user}><ApiKeysPanel initialKeys={keys} /></DashboardShell>;
}
