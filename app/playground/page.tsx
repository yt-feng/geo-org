import type { Metadata } from "next";
import { LocaleProvider } from "@/components/LocaleProvider";
import { DashboardShell } from "@/components/DashboardShell";
import { Playground } from "@/components/Playground";
import { requirePortalUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export async function generateMetadata({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> } = {}): Promise<Metadata> {
  return { title: (await searchParams)?.lang === "en" ? "Playground" : "Playground" };
}

export default async function PlaygroundPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> } = {}) {
  const params = (await searchParams) || {};
  const locale = params.lang === "en" ? "en" : "zh";
  const user = await requirePortalUser(locale);
  return <LocaleProvider locale={locale}><DashboardShell active="playground" user={user}><Playground initialModel={typeof params.model === "string" ? params.model : undefined} initialCategory={typeof params.category === "string" ? params.category : undefined} isAdmin={user.isAdmin} /></DashboardShell></LocaleProvider>;
}
