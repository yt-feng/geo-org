import type { Metadata } from "next";
import { DashboardShell } from "@/components/DashboardShell";
import { DocsExplorer } from "@/components/DocsExplorer";
import { requirePortalUser } from "@/lib/auth";
import { publicBaseUrl } from "@/lib/config";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "API 文档" };

export default async function DocsPage() {
  const user = await requirePortalUser();
  return (
    <DashboardShell active="docs" user={user}>
      <header className="dashboard-header docs-page-header">
        <div>
          <span className="section-kicker">PRIVATE REFERENCE</span>
          <h1>API 文档</h1>
          <p>统一查看数据接口、tokvilo 多模态、模型服务与精选 API；各服务独立加载，使用你的 tokvilo 密钥与账户余额调用。</p>
        </div>
        <div className="private-badge">登录后可见</div>
      </header>
      <DocsExplorer baseUrl={publicBaseUrl()} />
    </DashboardShell>
  );
}
