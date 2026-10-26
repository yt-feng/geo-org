import type { Metadata } from "next";
import { LocaleProvider } from "@/components/LocaleProvider";
import { ApiKeysPanel } from "@/components/ApiKeysPanel";
import { DashboardShell } from "@/components/DashboardShell";
import { requirePortalUser } from "@/lib/auth";
import { ensureUser, listApiKeys } from "@/lib/store";

export const dynamic = "force-dynamic";
export async function generateMetadata({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> } = {}): Promise<Metadata> {
  return { title: (await searchParams)?.lang === "en" ? "API keys" : "API 密钥" };
}

export default async function KeysPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> } = {}) {
  const params = (await searchParams) || {};
  const locale = params.lang === "en" ? "en" : "zh";
  const user = await requirePortalUser(locale);
  await ensureUser(user);
  const keys = await listApiKeys(user.id);
  return <LocaleProvider locale={locale}><DashboardShell active="keys" user={user}><ApiKeysPanel initialKeys={keys} /></DashboardShell></LocaleProvider>;
}
