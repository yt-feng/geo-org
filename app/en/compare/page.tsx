import { PublicNav } from "@/components/PublicNav";
import { PublicFooter } from "@/components/PublicFooter";
import { ModelComparison } from "@/components/ModelComparison";
import { getModelDirectory } from "@/lib/model-directory";
export const metadata = { title: "Compare models · Capabilities and official prices" };
export const dynamic = "force-dynamic";
export default async function ComparePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const selection = typeof params.models === "string" ? params.models.slice(0, 1200) : "";
  const provider = typeof params.provider === "string" ? params.provider.slice(0, 80) : "";
  const directory = await getModelDirectory();
  return <div className="market-page"><PublicNav /><main className="selection-main"><header className="selection-hero"><span className="landing-eyebrow">TOKVILO / COMPARE</span><h1>See the differences.<br />Choose with clarity.</h1><p>Compare generations across coding, math, writing, creativity, reasoning and speed, with source-backed context and real prices.</p></header><ModelComparison key={selection + provider} catalog={directory.models} initialModels={selection.split(",")} initialProvider={provider} /></main><PublicFooter /></div>;
}
