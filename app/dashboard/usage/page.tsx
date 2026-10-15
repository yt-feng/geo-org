import type { Metadata } from "next";
import { DashboardShell } from "@/components/DashboardShell";
import { Icon } from "@/components/Icon";
import { requirePortalUser } from "@/lib/auth";
import { displayTimestamp, getUsageEvents } from "@/lib/console-data";
import { getUserSummary } from "@/lib/store";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "调用日志" };

export default async function UsagePage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string }> }) {
  const user = await requirePortalUser();
  const params = await searchParams;
  const query = typeof params.q === "string" ? params.q.slice(0, 100) : "";
  const status = params.status === "4xx" || params.status === "5xx" ? params.status : "";
  const [events, summary] = await Promise.all([getUsageEvents(user.id, { query, status, limit: 100 }), getUserSummary(user)]);
  return (
    <DashboardShell active="usage" user={user}>
      <header className="console-page-heading"><div><h1>调用日志</h1><p>查看 API 用量与请求明细。</p></div><span className="console-date-label">北京时间 · UTC+8</span></header>
      <section className="console-metrics console-metrics-three"><article><div><span>今日总调用</span><Icon name="activity" size={16} /></div><strong>{summary.callsToday.toLocaleString()}</strong><small>UTC 自然日</small></article><article><div><span>成功请求</span><Icon name="check" size={16} /></div><strong>{summary.successesToday.toLocaleString()}</strong><small>今日成功完成</small></article><article><div><span>异常请求</span><Icon name="clock" size={16} /></div><strong>{summary.errorsToday.toLocaleString()}</strong><small>今日失败请求</small></article></section>
      <section className="console-panel">
        <header className="console-panel-heading"><div><h2>异常请求明细</h2><p>当前保存异常请求明细；成功调用计入用量统计。</p></div><span className="console-subtle">最新 {events.length} 条</span></header>
        <form action="/dashboard/usage" method="get" className="console-filter-bar"><label className="console-search"><Icon name="search" size={16} /><input name="q" defaultValue={query} placeholder="搜索接口路径或请求 ID" aria-label="搜索接口路径或请求 ID" /></label><select name="status" defaultValue={status} aria-label="HTTP 状态"><option value="">所有状态</option><option value="4xx">4xx · 请求异常</option><option value="5xx">5xx · 服务异常</option></select><button className="console-button" type="submit">筛选</button></form>
        <div className="console-table-wrap"><table className="console-table console-logs-table"><thead><tr><th>请求时间</th><th>请求 ID / 接口</th><th>方法</th><th>状态码</th><th>耗时</th></tr></thead><tbody>{events.length ? events.map((event) => <tr key={event.request_id}><td>{displayTimestamp(event.created_at)}</td><td><code title={event.path}>{event.path}</code><small>{event.request_id}</small></td><td><span className="console-method">{event.method}</span></td><td><span className="console-status console-status-error">{event.status}</span></td><td>{event.latency_ms} ms</td></tr>) : <tr><td colSpan={5}><div className="console-empty"><Icon name="activity" size={30} /><strong>{query || status ? "没有匹配的请求" : "暂无异常请求"}</strong><span>{query || status ? "尝试调整搜索条件。" : "您最近的异常请求将显示在这里。"}</span></div></td></tr>}</tbody></table></div>
      </section>
    </DashboardShell>
  );
}
