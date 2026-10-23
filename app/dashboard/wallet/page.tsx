import type { Metadata } from "next";
import { DashboardShell } from "@/components/DashboardShell";
import { WalletPanel } from "@/components/WalletPanel";
import { LocaleProvider } from "@/components/LocaleProvider";
import { requirePortalUser } from "@/lib/auth";
import "../../wallet.css";

type PageProps = { searchParams?: Promise<Record<string, string | string[] | undefined>> };
export const dynamic = "force-dynamic";
export async function generateMetadata({ searchParams }: PageProps = {}): Promise<Metadata> {
  return { title: (await searchParams)?.lang === "en" ? "Balance & top up" : "余额与充值" };
}
export default async function WalletPage({ searchParams }: PageProps = {}) {
  const locale = (await searchParams)?.lang === "en" ? "en" : "zh";
  const user = await requirePortalUser(locale);
  return <LocaleProvider locale={locale}><DashboardShell active="wallet" user={user}><WalletPanel userId={user.id} email={user.email} isAdmin={user.isAdmin} /></DashboardShell></LocaleProvider>;
}
