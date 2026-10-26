import type { Metadata } from "next";
import { DashboardShell } from "@/components/DashboardShell";
import { OrdersPanel } from "@/components/OrdersPanel";
import { LocaleProvider } from "@/components/LocaleProvider";
import { requirePortalUser } from "@/lib/auth";
type PageProps = { searchParams?: Promise<Record<string, string | string[] | undefined>> };
export const dynamic = "force-dynamic";
export async function generateMetadata({ searchParams }: PageProps = {}): Promise<Metadata> {
  return { title: (await searchParams)?.lang === "en" ? "Product orders" : "商品订单" };
}
export default async function OrdersPage({ searchParams }: PageProps = {}) {
  const locale = (await searchParams)?.lang === "en" ? "en" : "zh";
  const user = await requirePortalUser(locale);
  return <LocaleProvider locale={locale}><DashboardShell user={user} active="orders"><OrdersPanel key={user.id} /></DashboardShell></LocaleProvider>;
}
