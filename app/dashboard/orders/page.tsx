import { DashboardShell } from "@/components/DashboardShell";
import { OrdersPanel } from "@/components/OrdersPanel";
import { requirePortalUser } from "@/lib/auth";
export const dynamic = "force-dynamic";
export const metadata = { title: "商品订单" };
export default async function OrdersPage() { const user = await requirePortalUser(); return <DashboardShell user={user} active="orders"><OrdersPanel key={user.id} /></DashboardShell>; }
