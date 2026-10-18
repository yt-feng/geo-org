import "@/app/tokenhub-evidence.css";
import type { Metadata } from "next";
import { DashboardShell } from "@/components/DashboardShell";
import { TokenHubAuditDashboard } from "@/components/TokenHubAuditDashboard";
import { requireAdminUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "TokenHub 每日核验" };

export default async function TokenHubAuditPage() {
  const user = await requireAdminUser();
  return <DashboardShell active="tokenhub-audit" user={user}><TokenHubAuditDashboard /></DashboardShell>;
}
