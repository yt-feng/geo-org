import type { Metadata } from "next";
import { DashboardShell } from "@/components/DashboardShell";
import { Playground } from "@/components/Playground";
import { requirePortalUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Playground" };

export default async function PlaygroundPage({ searchParams }: { searchParams: Promise<{ model?: string; category?: string }> }) {
  const [user, params] = await Promise.all([requirePortalUser(), searchParams]);
  return <DashboardShell active="playground" user={user}><Playground initialModel={typeof params.model === "string" ? params.model : undefined} initialCategory={typeof params.category === "string" ? params.category : undefined} isAdmin={user.isAdmin} /></DashboardShell>;
}
