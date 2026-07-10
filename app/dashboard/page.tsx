import type { Metadata } from "next";
import Link from "next/link";
import { ApiKeysPanel } from "@/components/ApiKeysPanel";
import { DashboardShell } from "@/components/DashboardShell";
import { requirePortalUser } from "@/lib/auth";
import { publicBaseUrl } from "@/lib/config";
import { getUserSummary, listApiKeys } from "@/lib/store";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "控制台" };

export default async function DashboardPage() {
  const user = await requirePortalUser();
  const [summary, keys] = await Promise.all([
    getUserSummary(user),
    listApiKeys(user.id),
  ]);
  const percent = summary.dailyLimit
    ? Math.min(100, Math.round((summary.callsToday / summary.dailyLimit) * 100))
    : 0;

  return (
    <DashboardShell active="overview" user={user}>
      <header className="dashboard-header">
        <div>
          <span className="section-kicker">OVERVIEW</span>
          <h1>你好，{user.displayName}</h1>
          <p>管理你的访问凭证，并查看今日调用情况。</p>
        </div>
        <Link className="button button-dark" href="/dashboard/docs">
          查看 API 文档
        </Link>
      </header>

      <section className="stat-grid">
        <article className="stat-card stat-primary">
          <span>今日调用</span>
          <strong>{summary.callsToday.toLocaleString()}</strong>
          <small>每日额度 {summary.dailyLimit.toLocaleString()}</small>
          <div className="progress-track" aria-label={`已使用 ${percent}%`}>
            <span style={{ width: `${percent}%` }} />
          </div>
        </article>
        <article className="stat-card">
          <span>成功请求</span>
          <strong>{summary.successesToday.toLocaleString()}</strong>
          <small>实时统计</small>
        </article>
        <article className="stat-card">
          <span>失败请求</span>
          <strong>{summary.errorsToday.toLocaleString()}</strong>
          <small>不自动重试</small>
        </article>
        <article className="stat-card">
          <span>有效密钥</span>
          <strong>{summary.activeKeys}</strong>
          <small>按账户隔离</small>
        </article>
      </section>

      <section className="panel quickstart-card">
        <div>
          <span className="section-kicker">BASE URL</span>
          <h2>调用入口</h2>
          <p>所有已开通路径都使用同一基础地址，详细参数请在私有文档中查看。</p>
        </div>
        <code>{publicBaseUrl()}/api/v1</code>
      </section>

      <ApiKeysPanel initialKeys={keys} />
    </DashboardShell>
  );
}
