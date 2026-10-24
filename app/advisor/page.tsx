import { PublicNav } from "@/components/PublicNav";
import { PublicFooter } from "@/components/PublicFooter";
import { ModelAdvisor } from "@/components/ModelAdvisor";
import { getModelDirectory } from "@/lib/model-directory";
export const metadata = { title: "模型选型助手" };
export const dynamic = "force-dynamic";
export default async function AdvisorPage() {
  const directory = await getModelDirectory();
  return <div className="market-page"><PublicNav /><main className="selection-main"><header className="selection-hero"><span className="landing-eyebrow">TOKVILO / MODEL ADVISOR</span><h1>不用记住每一个型号。</h1><p>告诉 tokvilo 你想完成什么，得到有理由、可比较、能试用的候选。先选任务，再选模型。</p></header><ModelAdvisor catalog={directory.models} /></main><PublicFooter /></div>;
}
