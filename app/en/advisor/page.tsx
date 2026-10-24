import { PublicNav } from "@/components/PublicNav";
import { PublicFooter } from "@/components/PublicFooter";
import { ModelAdvisor } from "@/components/ModelAdvisor";
import { getModelDirectory } from "@/lib/model-directory";
export const metadata = { title: "AI model selection advisor" };
export const dynamic = "force-dynamic";
export default async function AdvisorPage() {
  const directory = await getModelDirectory();
  return <div className="market-page"><PublicNav /><main className="selection-main"><header className="selection-hero"><span className="landing-eyebrow">TOKVILO / MODEL ADVISOR</span><h1>You don’t need to know<br />every model name.</h1><p>Tell tokvilo what you want to accomplish. Get a shortlist with clear reasons, compare it, and try a real task.</p></header><ModelAdvisor catalog={directory.models} /></main><PublicFooter /></div>;
}
