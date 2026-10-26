import { PublicFooter } from "@/components/PublicFooter";
import { ModelMarket } from "@/components/ModelMarket";
import { PublicNav } from "@/components/PublicNav";
import { getModelDirectory } from "@/lib/model-directory";
export const metadata = { title: "AI model library" };
export const dynamic = "force-dynamic";
export default async function ModelsPage() {
  const directory = await getModelDirectory();
  return <div className="market-page"><PublicNav /><main className="market-main"><header className="market-intro"><span className="landing-eyebrow">TOKVILO / MODEL LIBRARY</span><h1>Model library</h1><p>Explore providers and model families. Compare versions, check pricing and interface status, then open a playground.</p></header><ModelMarket catalog={directory.models} live={directory.live} observedAt={directory.observedAt} sources={directory.sources} /></main><PublicFooter /></div>;
}
