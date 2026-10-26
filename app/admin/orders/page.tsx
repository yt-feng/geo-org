import { DashboardShell } from "@/components/DashboardShell";
import { OrdersPanel } from "@/components/OrdersPanel";
import { requireAdminUser } from "@/lib/auth";
export const dynamic = "force-dynamic";
export const metadata = { title: "商品订单管理" };
export default async function AdminOrdersPage() { const user = await requireAdminUser(); return <DashboardShell user={user} active="admin"><OrdersPanel key={user.id} admin /></DashboardShell>; }
