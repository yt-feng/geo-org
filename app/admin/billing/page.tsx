import { AdminWalletPanel } from "@/components/AdminWalletPanel";
import { DashboardShell } from "@/components/DashboardShell";
import { requireAdminUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "企业转账与人工入账" };
export default async function AdminBillingPage() {
  const user = await requireAdminUser();
  return <DashboardShell user={user} active="billing-admin"><AdminWalletPanel /></DashboardShell>;
}
