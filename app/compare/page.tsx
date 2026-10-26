import { PublicNav } from "@/components/PublicNav";
import { PublicFooter } from "@/components/PublicFooter";
import { ModelComparison } from "@/components/ModelComparison";
import { getModelDirectory } from "@/lib/model-directory";
export const metadata = { title: "模型比较 · 能力与官方价格" };
export const dynamic = "force-dynamic";
export default async function ComparePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const selection = typeof params.models === "string" ? params.models.slice(0, 1200) : "";
  const provider = typeof params.provider === "string" ? params.provider.slice(0, 80) : "";
  const directory = await getModelDirectory();
  return <div className="market-page"><PublicNav /><main className="selection-main"><header className="selection-hero"><span className="landing-eyebrow">TOKVILO / COMPARE</span><h1>看清差异，再选模型。</h1><p>代码、数学、写作、创意、推理与速度；把不同代际放在一起，看能力、看取舍，也看真实价格。</p></header><ModelComparison key={selection + provider} catalog={directory.models} initialModels={selection.split(",")} initialProvider={provider} /></main><PublicFooter /></div>;
}
