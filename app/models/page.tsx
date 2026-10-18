import type { Metadata } from "next";
import Link from "next/link";
import { ModelMarket } from "@/components/ModelMarket";
import { PublicNav } from "@/components/PublicNav";

export const metadata: Metadata = { title: "AI 模型市场" };

export default function ModelsPage() {
  return <div className="market-page"><PublicNav /><main className="market-main"><header className="market-intro"><h1>AI 模型市场<br />多模态模型 API</h1><p>从 TokenHub 与 APIMart 发现图像、视频、语言和音频模型，进入对应的 ECO-GEO 工作台。</p></header><ModelMarket /></main><footer className="market-footer"><span>ECO-GEO</span><p>多上游模型目录 · 转发接入与生成验收分别标注</p><Link href="/dashboard/docs?provider=tokenhub">TokenHub 接口文档 ↗</Link><a href="https://docs.apimart.ai" target="_blank" rel="noreferrer">APIMart 文档 ↗</a></footer></div>;
}
