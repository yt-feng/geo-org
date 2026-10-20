import type { Metadata } from "next";
import { DashboardShell } from "@/components/DashboardShell";
import { TokenHubPlayground } from "@/components/TokenHubPlayground";
import { requirePortalUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "tokvilo 多模态工作台" };

export default async function StudioPage() {
  const user = await requirePortalUser();
  return <DashboardShell active="tokenhub" user={user}><TokenHubPlayground isAdmin={user.isAdmin} /></DashboardShell>;
}
