import type { Metadata } from "next";
import Link from "next/link";
import { ModelMarket } from "@/components/ModelMarket";
import { PublicNav } from "@/components/PublicNav";
import { getModelDirectory } from "@/lib/model-directory";

export const metadata: Metadata = { title: "AI 模型市场" };
export const dynamic = "force-dynamic";

export default async function ModelsPage() {
  const directory = await getModelDirectory();
  return <div className="market-page"><PublicNav /><main className="market-main"><header className="market-intro"><span className="landing-eyebrow">TOKVILO / MODEL LIBRARY</span><h1>模型市场</h1><p>按厂商与系列发现模型，并排比较各代版本。查看价格和接口状态，再进入工作台。</p></header><ModelMarket catalog={directory.models} live={directory.live} observedAt={directory.observedAt} sources={directory.sources} /></main><footer className="market-footer"><span>tokvilo</span><p>模型与能力目录 · 统一接口与账户余额</p><Link href="/dashboard/docs?provider=studio">tokvilo 多模态 接口文档 ↗</Link><a href="/dashboard/docs?provider=gateway" target="_blank" rel="noreferrer">tokvilo 模型服务 文档 ↗</a><Link href="/dashboard/docs?provider=selected">tokvilo 精选文档 ↗</Link></footer></div>;
}
