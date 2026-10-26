import type { Metadata } from "next";
import { LocaleProvider } from "@/components/LocaleProvider";
import { localizedHref } from "@/lib/site-locale";
import Link from "next/link";
import { DashboardShell } from "@/components/DashboardShell";
import { Icon } from "@/components/Icon";
import { requirePortalUser } from "@/lib/auth";
import { publicBaseUrl } from "@/lib/config";
import { displayTimestamp, getUsageEvents, getUsageTrend } from "@/lib/console-data";
import { getUserSummary } from "@/lib/store";

export const dynamic = "force-dynamic";
export async function generateMetadata({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> } = {}): Promise<Metadata> {
  return { title: (await searchParams)?.lang === "en" ? "Dashboard" : "控制台" };
}

export default async function DashboardPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> } = {}) {
  const params = (await searchParams) || {};
  const locale = params.lang === "en" ? "en" : "zh";
  const t = (zh: string, en: string) => locale === "en" ? en : zh;
  const href = (path: string) => localizedHref(path, locale);
  const user = await requirePortalUser(locale);
  const [summary, trend, events] = await Promise.all([getUserSummary(user), getUsageTrend(user.id), getUsageEvents(user.id, { limit: 5 })]);
  const percent = summary.dailyLimit ? Math.min(100, Math.round((summary.callsToday / summary.dailyLimit) * 100)) : 0;
  const total = trend.reduce((sum, item) => sum + item.calls, 0);
  const max = Math.max(5, ...trend.map((item) => item.calls));
  const points = trend.map((item, index) => `${(index / 29) * 960},${160 - (item.calls / max) * 150}`).join(" ");
  return (
    <LocaleProvider locale={locale}><DashboardShell active="overview" user={user}>
      <section className="console-account-grid">
        <article className="console-account-card">
          <h1>{t("您的账户", "Your account")}</h1>
          <div className="console-profile">
            <div className="console-avatar console-avatar-large">{user.displayName.slice(0, 2).toUpperCase()}</div>
            <div><h2>{user.displayName}</h2><p>{user.email}</p><span className="console-plan"><Icon name="shield" size={13} />{user.isAdmin ? t("管理员 Admin", "Administrator") : t("个人账户 Personal", "Personal account")}</span></div>
          </div>
          <div className="console-balance-row"><div><span>{t("今日剩余请求次数", "Requests remaining today")}</span><p><strong>{Math.max(0, summary.dailyLimit - summary.callsToday).toLocaleString()}</strong><small>{t("次", "requests")}</small></p></div><Link className="console-button console-button-primary" href={href("/dashboard/keys")}>{t("管理密钥", "Manage keys")}</Link></div>
          <div className="console-quota"><div><span>{t(`今日已使用 ${summary.callsToday.toLocaleString()} 次`, `${summary.callsToday.toLocaleString()} requests used today`)}</span><span>{summary.dailyLimit.toLocaleString()} {t("次 / 日", "requests / day")}</span></div><div className="console-progress"><span style={{ width: `${percent}%` }} /></div></div>
          <div className="console-profile-link"><span className="console-square-icon"><Icon name="key" size={17} /></span><div><strong>{t("API 密钥", "API keys")}</strong><small>{t("管理您的 API 访问凭证", "Manage API access credentials")}</small></div><Link className="console-button console-button-small" href={href("/dashboard/keys")}>{summary.activeKeys} {t("个有效密钥", "active keys")} <Icon name="arrow-right" size={13} /></Link></div>
          <div className="console-profile-link"><span className="console-square-icon"><Icon name="activity" size={17} /></span><div><strong>{t("调用日志", "Request logs")}</strong><small>{t("用量统计与异常请求记录", "Usage and failed request records")}</small></div><Link className="console-button console-button-small" href={href("/dashboard/usage")}>{t("查看", "View")} <Icon name="arrow-right" size={13} /></Link></div>
        </article>
        <article className="console-resources-card">
          <h2>{t("开始构建", "Start building")}</h2>
          <Link className="console-resource" href={href("/models")}><span className="console-square-icon"><Icon name="store" size={18} /></span><div><strong>{t("模型广场", "Model catalog")}</strong><small>{t("探索多模态 AI 模型", "Explore multimodal AI models")}</small></div><span className="console-button console-button-small">{t("浏览", "Browse")} <Icon name="arrow-right" size={13} /></span></Link>
          <Link className="console-resource" href={href("/dashboard/docs")}><span className="console-square-icon"><Icon name="book" size={18} /></span><div><strong>{t("API 文档", "API documentation")}</strong><small>{t("接入指南与接口参考", "Integration guides and API reference")}</small></div><span className="console-button console-button-small">{t("查看", "View")} <Icon name="arrow-right" size={13} /></span></Link>
          <Link className="console-resource" href={href("/playground")}><span className="console-square-icon"><Icon name="terminal" size={18} /></span><div><strong>Playground</strong><small>{t("探索模型与接入示例", "Explore models and integration examples")}</small></div><span className="console-button console-button-small">{t("前往", "Open")} <Icon name="arrow-right" size={13} /></span></Link>
          {user.isAdmin ? <Link className="console-resource" href={href("/studio")}><span className="console-square-icon"><Icon name="video" size={18} /></span><div><strong>{t("tokvilo 多模态 工作台", "tokvilo Multimodal workspace")}</strong><small>{t("创建视频、生成图像与发起对话", "Create videos, images and conversations")}</small></div><span className="console-button console-button-small">{t("创作", "Create")} <Icon name="arrow-right" size={13} /></span></Link> : null}
          {user.isAdmin ? <Link className="console-resource" href={href("/admin")}><span className="console-square-icon"><Icon name="settings" size={18} /></span><div><strong>{t("上游管理", "Service administration")}</strong><small>{t("配置数据、文本、图像与视频服务", "Configure data, text, image and video services")}</small></div><span className="console-button console-button-small">{t("管理", "Manage")} <Icon name="arrow-right" size={13} /></span></Link> : null}
          <div className="console-base-url"><span>API BASE URL</span><code>{publicBaseUrl()}/api/v1</code><small>{t("使用您的 tokvilo API 密钥进行身份验证。", "Authenticate with your tokvilo API key.")}</small></div>
        </article>
      </section>
      <section className="console-metrics" aria-label={t("账户使用情况", "Account usage")}>
        {[{ label: t("今日调用", "Requests today"), value: summary.callsToday, icon: "activity", note: t("UTC 自然日", "UTC calendar day") }, { label: t("成功请求", "Successful requests"), value: summary.successesToday, icon: "check", note: t("今日成功完成", "Completed today") }, { label: t("异常请求", "Failed requests"), value: summary.errorsToday, icon: "clock", note: t("今日失败请求", "Failed today") }, { label: t("近 30 天调用", "Last 30 days"), value: total, icon: "chart", note: t("累计请求数量", "Total requests") }].map((stat) => <article key={stat.label}><div><span>{stat.label}</span><Icon name={stat.icon} size={16} /></div><strong>{stat.value.toLocaleString()}</strong><small>{stat.note}</small></article>)}
      </section>
      <section className="console-panel console-chart-panel">
        <header className="console-panel-heading"><div><h2>{t("调用趋势", "Request trend")}</h2><p>{t("您的 API 请求用量", "Your API request usage")}</p></div><span className="console-date-label"><Icon name="calendar" size={14} />{t("最近 30 天 · UTC", "Last 30 days · UTC")}</span></header>
        <div className="console-chart"><div className="console-chart-y"><span>{max}</span><span>{Math.round(max / 2)}</span><span>0</span></div><div className="console-chart-plot"><svg viewBox="0 0 960 170" preserveAspectRatio="none" role="img" aria-label={t(`最近 30 天累计调用 ${total} 次`, `${total} requests in the last 30 days`)}><path className="console-chart-grid" d="M0 10H960M0 85H960M0 160H960" /><polygon points={`0,160 ${points} 960,160`} className="console-chart-area" /><polyline points={points} className="console-chart-line" /></svg><div className="console-chart-x">{[0, 7, 14, 21, 29].map((index) => <span key={index}>{trend[index].day.slice(5).replace("-", "/")}</span>)}</div></div></div>
      </section>
      <section className="console-panel">
        <header className="console-panel-heading"><div><h2>{t("最近异常请求", "Recent failed requests")}</h2><p>{t("按请求时间展示最近记录", "Recent records ordered by request time")}</p></div><Link className="console-text-link" href={href("/dashboard/usage")}>{t("查看全部", "View all")} <Icon name="arrow-right" size={14} /></Link></header>
        <div className="console-table-wrap"><table className="console-table"><thead><tr><th>{t("请求时间", "Request time")}</th><th>{t("接口", "Endpoint")}</th><th>{t("状态", "Status")}</th><th>{t("耗时", "Latency")}</th></tr></thead><tbody>{events.length ? events.map((event) => <tr key={event.request_id}><td>{displayTimestamp(event.created_at)}</td><td><code>{event.method} {event.path}</code></td><td><span className="console-status console-status-error">{event.status}</span></td><td>{event.latency_ms} ms</td></tr>) : <tr><td colSpan={4}><div className="console-empty"><Icon name="activity" size={27} /><strong>{t("暂无异常请求", "No failed requests")}</strong><span>{t("开始调用 API 后，异常请求记录将显示在这里。", "Failed requests will appear here after you start using the API.")}</span></div></td></tr>}</tbody></table></div>
      </section>
    </DashboardShell></LocaleProvider>
  );
}
