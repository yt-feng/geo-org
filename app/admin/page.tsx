import type { Metadata } from "next";
import { DashboardShell } from "@/components/DashboardShell";
import { ProviderSettingsPanel } from "@/components/ProviderSettingsPanel";
import { Icon } from "@/components/Icon";
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
          <span className="section-kicker">WORKSPACE / SETTINGS</span>
          <h1>上游服务</h1>
          <p>连接你的 API 服务，在一个工作空间完成管理。</p>
        </div>
        <span className="private-badge"><Icon name="shield" size={12} /> 管理员工作空间</span>
      </header>
      <nav className="admin-tabs" aria-label="管理分区"><a href="#provider-settings-title">服务连接</a><a href="#platform-usage">平台用量</a><a href="#members">成员账户</a><a href="/dashboard/wallet">充值码管理</a><a href="/admin/orders">商品订单</a></nav>
      <ProviderSettingsPanel />
      <div className="admin-quotas" id="platform-usage">
      <section className="panel admin-quota">
        <div>
          <span className="section-kicker">DAILY REQUESTS</span>
          <h2>今日平台调用</h2>
        </div>
        <div className="quota-number">
          <strong>{overview.callsToday.toLocaleString()}</strong>
          <span>/ {overview.globalLimit.toLocaleString()}</span>
        </div>
        <div className="progress-track large" aria-label={`已使用 ${percent}%`}>
          <span style={{ width: `${percent}%` }} />
        </div>
        <p>已使用今日平台额度的 {percent}%</p>
      </section>

      <section className="panel admin-quota">
        <div>
          <span className="section-kicker">UPSTREAM USAGE</span>
          <h2>中转累计预留成本</h2>
        </div>
        <div className="quota-number">
          <strong>${overview.reservedSpendUsd.toFixed(4)}</strong>
          <span> / ${overview.spendLimitUsd.toFixed(2)}</span>
        </div>
        <div className="progress-track large" aria-label="上游成本额度">
          <span
            style={{
              width: `${Math.min(
                100,
                Math.round(
                  (overview.reservedSpendUsd / Math.max(0.000001, overview.spendLimitUsd)) *
                    100,
                ),
              )}%`,
            }}
          />
        </div>
        <p>按现有数据接口的请求预留成本累计。</p>
      </section>
      </div>
      <section className="panel" id="members">
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
