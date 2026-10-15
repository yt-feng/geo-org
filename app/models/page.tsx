import type { Metadata } from "next";
import { ModelMarket } from "@/components/ModelMarket";
import { PublicNav } from "@/components/PublicNav";

export const metadata: Metadata = { title: "AI 模型市场" };

export default function ModelsPage() {
  return <div className="market-page"><PublicNav /><main className="market-main"><header className="market-intro"><h1>AI 模型市场<br />多模态模型 API</h1><p>探索图像、视频、语言与音频模型，为下一次创作找到合适的起点。</p></header><ModelMarket /></main><footer className="market-footer"><span>ECO-GEO</span><p>示例能力目录 · 实际可用模型以已配置上游为准</p><a href="https://docs.apimart.ai" target="_blank" rel="noreferrer">上游模型文档 ↗</a></footer></div>;
}
