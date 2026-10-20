import type { Metadata } from "next";
import Link from "next/link";
import { ModelMarket } from "@/components/ModelMarket";
import { PublicNav } from "@/components/PublicNav";
import { getModelDirectory } from "@/lib/model-directory";

export const metadata: Metadata = { title: "AI 模型市场" };
export const dynamic = "force-dynamic";

export default async function ModelsPage() {
  const directory = await getModelDirectory();
  return <div className="market-page"><PublicNav /><main className="market-main"><header className="market-intro"><h1>AI 模型市场<br />多模态模型 API</h1><p>在 tokvilo 发现图像、视频、语言和音频模型，进入工作台开始创作。</p></header><ModelMarket catalog={directory.models} live={directory.live} observedAt={directory.observedAt} /></main><footer className="market-footer"><span>tokvilo</span><p>模型与能力目录 · 统一接口与账户余额</p><Link href="/dashboard/docs?provider=studio">tokvilo 多模态 接口文档 ↗</Link><a href="/dashboard/docs?provider=gateway" target="_blank" rel="noreferrer">tokvilo 模型服务 文档 ↗</a></footer></div>;
}
