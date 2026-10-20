import type { Metadata } from "next";
import { DashboardShell } from "@/components/DashboardShell";
import { WalletPanel } from "@/components/WalletPanel";
import { requirePortalUser } from "@/lib/auth";
import "../../wallet.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "余额与充值" };

export default async function WalletPage() {
  const user = await requirePortalUser();
  return <DashboardShell active="wallet" user={user}><WalletPanel userId={user.id} email={user.email} isAdmin={user.isAdmin} /></DashboardShell>;
}
