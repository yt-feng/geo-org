import type { Metadata } from "next";
import { LocaleProvider } from "@/components/LocaleProvider";
import { DashboardShell } from "@/components/DashboardShell";
import { Icon } from "@/components/Icon";
import { requirePortalUser } from "@/lib/auth";
import { displayTimestamp, getUsageEvents } from "@/lib/console-data";
import { getUserSummary } from "@/lib/store";

export const dynamic = "force-dynamic";
export async function generateMetadata({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> } = {}): Promise<Metadata> {
  return { title: (await searchParams)?.lang === "en" ? "Request logs" : "调用日志" };
}

export default async function UsagePage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> } = {}) {
  const params = (await searchParams) || {};
  const locale = params.lang === "en" ? "en" : "zh";
  const t = (zh: string, en: string) => locale === "en" ? en : zh;
  const user = await requirePortalUser(locale);
  const query = typeof params.q === "string" ? params.q.slice(0, 100) : "";
  const status = params.status === "4xx" || params.status === "5xx" ? params.status : "";
  const [events, summary] = await Promise.all([getUsageEvents(user.id, { query, status, limit: 100 }), getUserSummary(user)]);
  return (
    <LocaleProvider locale={locale}><DashboardShell active="usage" user={user}>
      <header className="console-page-heading"><div><h1>{t("调用日志", "Request logs")}</h1><p>{t("查看 API 用量与请求明细。", "View API usage and request details.")}</p></div><span className="console-date-label">{t("北京时间 · UTC+8", "China Standard Time · UTC+8")}</span></header>
      <section className="console-metrics console-metrics-three"><article><div><span>{t("今日总调用", "Total requests today")}</span><Icon name="activity" size={16} /></div><strong>{summary.callsToday.toLocaleString()}</strong><small>{t("UTC 自然日", "UTC calendar day")}</small></article><article><div><span>{t("成功请求", "Successful requests")}</span><Icon name="check" size={16} /></div><strong>{summary.successesToday.toLocaleString()}</strong><small>{t("今日成功完成", "Completed today")}</small></article><article><div><span>{t("异常请求", "Failed requests")}</span><Icon name="clock" size={16} /></div><strong>{summary.errorsToday.toLocaleString()}</strong><small>{t("今日失败请求", "Failed today")}</small></article></section>
      <section className="console-panel">
        <header className="console-panel-heading"><div><h2>{t("异常请求明细", "Failed request details")}</h2><p>{t("当前保存异常请求明细；成功调用计入用量统计。", "Failed requests are listed here. Successful requests are included in usage totals.")}</p></div><span className="console-subtle">{t(`最新 ${events.length} 条`, `${events.length} latest records`)}</span></header>
        <form action="/dashboard/usage" method="get" className="console-filter-bar">{locale === "en" ? <input type="hidden" name="lang" value="en" /> : null}<label className="console-search"><Icon name="search" size={16} /><input name="q" defaultValue={query} placeholder={t("搜索接口路径或请求 ID", "Search endpoint paths or request IDs")} aria-label={t("搜索接口路径或请求 ID", "Search endpoint paths or request IDs")} /></label><select name="status" defaultValue={status} aria-label={t("HTTP 状态", "HTTP status")}><option value="">{t("所有状态", "All statuses")}</option><option value="4xx">{t("4xx · 请求异常", "4xx · Request error")}</option><option value="5xx">{t("5xx · 服务异常", "5xx · Service error")}</option></select><button className="console-button" type="submit">{t("筛选", "Filter")}</button></form>
        <div className="console-table-wrap"><table className="console-table console-logs-table"><thead><tr><th>{t("请求时间", "Request time")}</th><th>{t("请求 ID / 接口", "Request ID / endpoint")}</th><th>{t("方法", "Method")}</th><th>{t("状态码", "Status code")}</th><th>{t("耗时", "Latency")}</th></tr></thead><tbody>{events.length ? events.map((event) => <tr key={event.request_id}><td>{displayTimestamp(event.created_at)}</td><td><code title={event.path}>{event.path}</code><small>{event.request_id}</small></td><td><span className="console-method">{event.method}</span></td><td><span className="console-status console-status-error">{event.status}</span></td><td>{event.latency_ms} ms</td></tr>) : <tr><td colSpan={5}><div className="console-empty"><Icon name="activity" size={30} /><strong>{query || status ? t("没有匹配的请求", "No matching requests") : t("暂无异常请求", "No failed requests")}</strong><span>{query || status ? t("尝试调整搜索条件。", "Try adjusting your filters.") : t("您最近的异常请求将显示在这里。", "Your recent failed requests will appear here.")}</span></div></td></tr>}</tbody></table></div>
      </section>
    </DashboardShell></LocaleProvider>
  );
}
