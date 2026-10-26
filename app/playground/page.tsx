import type { Metadata } from "next";
import { LocaleProvider } from "@/components/LocaleProvider";
import { DashboardShell } from "@/components/DashboardShell";
import { Playground } from "@/components/Playground";
import { TokenHubPlayground } from "@/components/TokenHubPlayground";
import { SelectedPlayground } from "@/components/SelectedPlayground";
import { requirePortalUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export async function generateMetadata({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> } = {}): Promise<Metadata> {
  return { title: (await searchParams)?.lang === "en" ? "Playground" : "Playground" };
}

export default async function PlaygroundPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> } = {}) {
  const params = (await searchParams) || {};
  const locale = params.lang === "en" ? "en" : "zh";
  const service = params.service === "studio" || params.service === "selected" ? params.service : "gateway";
  const initialModel = typeof params.model === "string" && params.model.length <= 200 ? params.model : undefined;
  const initialCategory = typeof params.category === "string" ? params.category : undefined;
  const returnParams = new URLSearchParams({ service });
  if (initialModel) returnParams.set("model", initialModel);
  if (initialCategory) returnParams.set("category", initialCategory);
  if (locale === "en") returnParams.set("lang", "en");
  const user = await requirePortalUser(locale, `/playground?${returnParams}`);
  const key = `${service}:${initialModel || ""}:${initialCategory || ""}`;
  const workspace = service === "studio" ? <TokenHubPlayground key={key} isAdmin={user.isAdmin} />
    : service === "selected" ? <SelectedPlayground key={key} initialModel={initialModel} />
    : <Playground key={key} initialModel={initialModel} initialCategory={initialCategory} isAdmin={user.isAdmin} />;
  return <LocaleProvider locale={locale}><DashboardShell active="playground" user={user}>{workspace}</DashboardShell></LocaleProvider>;
}
