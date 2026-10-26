import type { Metadata } from "next";
import { DashboardShell } from "@/components/DashboardShell";
import { WalletPanel } from "@/components/WalletPanel";
import { LocaleProvider } from "@/components/LocaleProvider";
import { requirePortalUser } from "@/lib/auth";
import { safeAuthReturnPath } from "@/lib/auth-return-path";
import "../../wallet.css";

type PageProps = { searchParams?: Promise<Record<string, string | string[] | undefined>> };
export const dynamic = "force-dynamic";
export async function generateMetadata({ searchParams }: PageProps = {}): Promise<Metadata> {
  return { title: (await searchParams)?.lang === "en" ? "API usage & billing" : "余额与充值" };
}
export default async function WalletPage({ searchParams }: PageProps = {}) {
  const locale = (await searchParams)?.lang === "en" ? "en" : "zh";
  const params = await searchParams;
  const nextParams = new URLSearchParams();
  if (locale === "en") nextParams.set("lang", "en");
  if (typeof params?.paddle_order === "string") nextParams.set("paddle_order", params.paddle_order);
  const next = safeAuthReturnPath(`/dashboard/wallet?${nextParams}`) || "/dashboard/wallet";
  const user = await requirePortalUser(locale, next);
  return <LocaleProvider locale={locale}><DashboardShell active="wallet" user={user}><WalletPanel userId={user.id} email={user.email} isAdmin={user.isAdmin} /></DashboardShell></LocaleProvider>;
}
