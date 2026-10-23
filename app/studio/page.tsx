import type { Metadata } from "next";
import { LocaleProvider } from "@/components/LocaleProvider";
import { DashboardShell } from "@/components/DashboardShell";
import { TokenHubPlayground } from "@/components/TokenHubPlayground";
import { requirePortalUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export async function generateMetadata({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> } = {}): Promise<Metadata> {
  return { title: (await searchParams)?.lang === "en" ? "tokvilo Multimodal workspace" : "tokvilo 多模态工作台" };
}

export default async function StudioPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> } = {}) {
  const params = (await searchParams) || {};
  const locale = params.lang === "en" ? "en" : "zh";
  const user = await requirePortalUser(locale);
  return <LocaleProvider locale={locale}><DashboardShell active="tokenhub" user={user}><TokenHubPlayground isAdmin={user.isAdmin} /></DashboardShell></LocaleProvider>;
}
