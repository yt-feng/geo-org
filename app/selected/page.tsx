import type { Metadata } from "next";
import { DashboardShell } from "@/components/DashboardShell";
import { SelectedPlayground } from "@/components/SelectedPlayground";
import { requirePortalUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "tokvilo 精选工作台" };

export default async function SelectedPage({ searchParams }: { searchParams: Promise<{ model?: string }> }) {
  const [user, params] = await Promise.all([requirePortalUser(), searchParams]);
  return <DashboardShell active="selected" user={user}><SelectedPlayground initialModel={typeof params.model === "string" && params.model.length <= 200 ? params.model : undefined} /></DashboardShell>;
}
