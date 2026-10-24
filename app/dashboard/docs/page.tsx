import type { Metadata } from "next";
import { LocaleProvider } from "@/components/LocaleProvider";
import { DashboardShell } from "@/components/DashboardShell";
import { DocsExplorer } from "@/components/DocsExplorer";
import { requirePortalUser } from "@/lib/auth";
import { publicBaseUrl } from "@/lib/config";

export const dynamic = "force-dynamic";
export async function generateMetadata({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> } = {}): Promise<Metadata> {
  return { title: (await searchParams)?.lang === "en" ? "API documentation" : "API 文档" };
}

export default async function DocsPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> } = {}) {
  const params = (await searchParams) || {};
  const locale = params.lang === "en" ? "en" : "zh";
  const t = (zh: string, en: string) => locale === "en" ? en : zh;
  const user = await requirePortalUser(locale);
  return (
    <LocaleProvider locale={locale}><DashboardShell active="docs" user={user}>
      <header className="dashboard-header docs-page-header">
        <div>
          <span className="section-kicker">PRIVATE REFERENCE</span>
          <h1>{t("API 文档", "API documentation")}</h1>
          <p>{t("统一查看数据接口、tokvilo 多模态、模型服务与精选 API；各服务独立加载，使用你的 tokvilo 密钥与账户余额调用。", "Browse Data, Multimodal, Models and Select APIs. Each service loads independently and uses your tokvilo key and account balance.")}</p>
        </div>
        <div className="private-badge">{t("登录后可见", "Members only")}</div>
      </header>
      <DocsExplorer baseUrl={publicBaseUrl()} />
    </DashboardShell></LocaleProvider>
  );
}
