import type { Metadata } from "next";
import Link from "next/link";
import { DashboardShell } from "@/components/DashboardShell";
import { Icon } from "@/components/Icon";
import { requirePortalUser } from "@/lib/auth";
import { publicBaseUrl } from "@/lib/config";
import { displayTimestamp, getUsageEvents, getUsageTrend } from "@/lib/console-data";
import { getUserSummary } from "@/lib/store";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "控制台" };

export default async function DashboardPage() {
  const user = await requirePortalUser();
  const [summary, trend, events] = await Promise.all([getUserSummary(user), getUsageTrend(user.id), getUsageEvents(user.id, { limit: 5 })]);
  const percent = summary.dailyLimit ? Math.min(100, Math.round((summary.callsToday / summary.dailyLimit) * 100)) : 0;
  const total = trend.reduce((sum, item) => sum + item.calls, 0);
  const max = Math.max(5, ...trend.map((item) => item.calls));
  const points = trend.map((item, index) => `${(index / 29) * 960},${160 - (item.calls / max) * 150}`).join(" ");
  return (
    <DashboardShell active="overview" user={user}>
      <section className="console-account-grid">
        <article className="console-account-card">
          <h1>您的账户</h1>
          <div className="console-profile">
            <div className="console-avatar console-avatar-large">{user.displayName.slice(0, 2).toUpperCase()}</div>
            <div><h2>{user.displayName}</h2><p>{user.email}</p><span className="console-plan"><Icon name="shield" size={13} />{user.isAdmin ? "管理员 Admin" : "个人账户 Personal"}</span></div>
          </div>
          <div className="console-balance-row"><div><span>今日剩余额度</span><p><strong>{Math.max(0, summary.dailyLimit - summary.callsToday).toLocaleString()}</strong><small>requests</small></p></div><Link className="console-button console-button-primary" href="/dashboard/keys">管理密钥</Link></div>
          <div className="console-quota"><div><span>今日已使用 {summary.callsToday.toLocaleString()} 次</span><span>{summary.dailyLimit.toLocaleString()} 次 / 日</span></div><div className="console-progress"><span style={{ width: `${percent}%` }} /></div></div>
          <div className="console-profile-link"><span className="console-square-icon"><Icon name="key" size={17} /></span><div><strong>API 密钥</strong><small>管理您的 API 访问凭证</small></div><Link className="console-button console-button-small" href="/dashboard/keys">{summary.activeKeys} 个有效密钥 <Icon name="arrow-right" size={13} /></Link></div>
          <div className="console-profile-link"><span className="console-square-icon"><Icon name="activity" size={17} /></span><div><strong>调用日志</strong><small>用量统计与异常请求记录</small></div><Link className="console-button console-button-small" href="/dashboard/usage">查看 <Icon name="arrow-right" size={13} /></Link></div>
        </article>
        <article className="console-resources-card">
          <h2>开始构建</h2>
          <Link className="console-resource" href="/models"><span className="console-square-icon"><Icon name="store" size={18} /></span><div><strong>模型广场</strong><small>探索多模态 AI 模型</small></div><span className="console-button console-button-small">浏览 <Icon name="arrow-right" size={13} /></span></Link>
          <Link className="console-resource" href="/dashboard/docs"><span className="console-square-icon"><Icon name="book" size={18} /></span><div><strong>API 文档</strong><small>接入指南与接口参考</small></div><span className="console-button console-button-small">查看 <Icon name="arrow-right" size={13} /></span></Link>
          <Link className="console-resource" href="/playground"><span className="console-square-icon"><Icon name="terminal" size={18} /></span><div><strong>Playground</strong><small>探索模型与接入示例</small></div><span className="console-button console-button-small">前往 <Icon name="arrow-right" size={13} /></span></Link>
          {user.isAdmin ? <Link className="console-resource" href="/tokenhub"><span className="console-square-icon"><Icon name="video" size={18} /></span><div><strong>TokenHub 工作台</strong><small>创建视频、生成图像与发起对话</small></div><span className="console-button console-button-small">创作 <Icon name="arrow-right" size={13} /></span></Link> : null}
          {user.isAdmin ? <Link className="console-resource" href="/admin"><span className="console-square-icon"><Icon name="settings" size={18} /></span><div><strong>上游管理</strong><small>配置 TikHub、APIMart 与 TokenHub</small></div><span className="console-button console-button-small">管理 <Icon name="arrow-right" size={13} /></span></Link> : null}
          <div className="console-base-url"><span>API BASE URL</span><code>{publicBaseUrl()}/api/v1</code><small>使用您的 ECO-GEO API 密钥进行身份验证。</small></div>
        </article>
      </section>
      <section className="console-metrics" aria-label="账户使用情况">
        {[{ label: "今日调用", value: summary.callsToday, icon: "activity", note: "UTC 自然日" }, { label: "成功请求", value: summary.successesToday, icon: "check", note: "今日成功完成" }, { label: "异常请求", value: summary.errorsToday, icon: "clock", note: "今日失败请求" }, { label: "近 30 天调用", value: total, icon: "chart", note: "累计请求数量" }].map((stat) => <article key={stat.label}><div><span>{stat.label}</span><Icon name={stat.icon} size={16} /></div><strong>{stat.value.toLocaleString()}</strong><small>{stat.note}</small></article>)}
      </section>
      <section className="console-panel console-chart-panel">
        <header className="console-panel-heading"><div><h2>调用趋势</h2><p>您的 API 请求用量</p></div><span className="console-date-label"><Icon name="calendar" size={14} />最近 30 天 · UTC</span></header>
        <div className="console-chart"><div className="console-chart-y"><span>{max}</span><span>{Math.round(max / 2)}</span><span>0</span></div><div className="console-chart-plot"><svg viewBox="0 0 960 170" preserveAspectRatio="none" role="img" aria-label={`最近 30 天累计调用 ${total} 次`}><path className="console-chart-grid" d="M0 10H960M0 85H960M0 160H960" /><polygon points={`0,160 ${points} 960,160`} className="console-chart-area" /><polyline points={points} className="console-chart-line" /></svg><div className="console-chart-x">{[0, 7, 14, 21, 29].map((index) => <span key={index}>{trend[index].day.slice(5).replace("-", "/")}</span>)}</div></div></div>
      </section>
      <section className="console-panel">
        <header className="console-panel-heading"><div><h2>最近异常请求</h2><p>按请求时间展示最近记录</p></div><Link className="console-text-link" href="/dashboard/usage">查看全部 <Icon name="arrow-right" size={14} /></Link></header>
        <div className="console-table-wrap"><table className="console-table"><thead><tr><th>请求时间</th><th>接口</th><th>状态</th><th>耗时</th></tr></thead><tbody>{events.length ? events.map((event) => <tr key={event.request_id}><td>{displayTimestamp(event.created_at)}</td><td><code>{event.method} {event.path}</code></td><td><span className="console-status console-status-error">{event.status}</span></td><td>{event.latency_ms} ms</td></tr>) : <tr><td colSpan={4}><div className="console-empty"><Icon name="activity" size={27} /><strong>暂无异常请求</strong><span>开始调用 API 后，异常请求记录将显示在这里。</span></div></td></tr>}</tbody></table></div>
      </section>
    </DashboardShell>
  );
}
