import type { Metadata } from "next";
import { DashboardShell } from "@/components/DashboardShell";
import { TokenHubPlayground } from "@/components/TokenHubPlayground";
import { requireAdminUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "TokenHub 工作台" };

export default async function TokenHubPage() {
  const user = await requireAdminUser();
  return <DashboardShell active="tokenhub" user={user}><TokenHubPlayground /></DashboardShell>;
}
