import Link from "next/link";
import { ModelMarket } from "@/components/ModelMarket";
import { PublicNav } from "@/components/PublicNav";
import { getModelDirectory } from "@/lib/model-directory";
export const metadata = { title: "AI model library" };
export const dynamic = "force-dynamic";
export default async function ModelsPage() {
  const directory = await getModelDirectory();
  return <div className="market-page"><PublicNav /><main className="market-main"><header className="market-intro"><span className="landing-eyebrow">TOKVILO / MODEL LIBRARY</span><h1>Model library</h1><p>Explore providers and model families. Compare versions, check pricing and interface status, then open a playground.</p></header><ModelMarket catalog={directory.models} live={directory.live} observedAt={directory.observedAt} sources={directory.sources} /></main><footer className="market-footer"><span>tokvilo</span><p>AI models · One account and balance</p><Link href="/dashboard/docs?provider=studio&lang=en">Multimodal API docs ↗</Link><Link href="/dashboard/docs?provider=gateway&lang=en">Models API docs ↗</Link><Link href="/dashboard/docs?provider=selected&lang=en">Select API docs ↗</Link></footer></div>;
}
