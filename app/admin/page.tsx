import type { Metadata } from "next";
import { DashboardShell } from "@/components/DashboardShell";
import { requireAdminUser } from "@/lib/auth";
import { getAdminOverview } from "@/lib/store";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "管理员" };

export default async function AdminPage() {
  const user = await requireAdminUser();
  const overview = await getAdminOverview();
  const percent = Math.min(
    100,
    Math.round((overview.callsToday / Math.max(1, overview.globalLimit)) * 100),
  );
  return (
    <DashboardShell active="admin" user={user}>
      <header className="dashboard-header">
        <div>
          <span className="section-kicker">ADMINISTRATION</span>
          <h1>管理员控制台</h1>
          <p>查看成员、密钥数量与平台级免费额度。</p>
        </div>
      </header>

      <section className="panel admin-quota">
        <div>
          <span className="section-kicker">PLATFORM GUARDRAIL</span>
          <h2>今日平台调用</h2>
        </div>
        <div className="quota-number">
          <strong>{overview.callsToday.toLocaleString()}</strong>
          <span>/ {overview.globalLimit.toLocaleString()}</span>
        </div>
        <div className="progress-track large" aria-label={`已使用 ${percent}%`}>
          <span style={{ width: `${percent}%` }} />
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <span className="section-kicker">MEMBERS</span>
            <h2>成员账户</h2>
          </div>
          <span className="record-count">{overview.users.length} 个账户</span>
        </div>
        <div className="admin-table" role="table" aria-label="成员账户">
          <div className="admin-row admin-head" role="row">
            <span>成员</span>
            <span>状态</span>
            <span>今日调用</span>
            <span>日额度</span>
            <span>有效密钥</span>
          </div>
          {overview.users.map((record) => (
            <div className="admin-row" key={String(record.id)} role="row">
              <span>
                <strong>{String(record.display_name || "—")}</strong>
                <small>{String(record.email || "")}</small>
              </span>
              <span><i className="status-dot" />{String(record.status || "active")}</span>
              <span>{Number(record.calls_today || 0).toLocaleString()}</span>
              <span>{Number(record.daily_limit || 0).toLocaleString()}</span>
              <span>{Number(record.active_keys || 0)}</span>
            </div>
          ))}
        </div>
      </section>
    </DashboardShell>
  );
}
