import type { Metadata } from "next";
import { LocaleProvider } from "@/components/LocaleProvider";
import { DashboardShell } from "@/components/DashboardShell";
import { SelectedPlayground } from "@/components/SelectedPlayground";
import { requirePortalUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export async function generateMetadata({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> } = {}): Promise<Metadata> {
  return { title: (await searchParams)?.lang === "en" ? "tokvilo Select workspace" : "tokvilo 精选工作台" };
}

export default async function SelectedPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> } = {}) {
  const params = (await searchParams) || {};
  const locale = params.lang === "en" ? "en" : "zh";
  const user = await requirePortalUser(locale);
  return <LocaleProvider locale={locale}><DashboardShell active="selected" user={user}><SelectedPlayground initialModel={typeof params.model === "string" && params.model.length <= 200 ? params.model : undefined} /></DashboardShell></LocaleProvider>;
}
