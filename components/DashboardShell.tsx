"use client";

import { useSiteLocale, LanguageSwitcher } from "./LocaleProvider";

import { useState } from "react";
import Link from "next/link";
import type { PortalUser } from "@/lib/auth";
import { Brand } from "./Brand";
import { Icon } from "./Icon";
import { ThemeToggle } from "./ThemeToggle";
import { LogoutButton } from "./LogoutButton";

type ConsoleSection = "overview" | "keys" | "usage" | "docs" | "admin" | "billing-admin" | "models" | "playground" | "tokenhub" | "selected" | "tokenhub-audit" | "wallet" | "orders";
const navigation: Array<{ key: ConsoleSection; href: string; icon: string; label: string; labelEn: string }> = [
  { key: "overview", href: "/dashboard", icon: "grid", label: "控制台", labelEn: "Dashboard" },
  { key: "wallet", href: "/dashboard/wallet", icon: "chart", label: "余额与充值", labelEn: "Balance & top up" },
  { key: "orders", href: "/dashboard/orders", icon: "store", label: "商品订单", labelEn: "Orders" },
  { key: "keys", href: "/dashboard/keys", icon: "key", label: "API 密钥", labelEn: "API keys" },
  { key: "usage", href: "/dashboard/usage", icon: "activity", label: "调用日志", labelEn: "Request logs" },
  { key: "docs", href: "/dashboard/docs", icon: "book", label: "API 文档", labelEn: "API documentation" },
];

export function DashboardShell({ user, active, children }: {
  user: PortalUser;
  active: ConsoleSection;
  children: React.ReactNode;
}) {
  const { t, href } = useSiteLocale();
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div className={`dashboard-shell${collapsed ? " console-collapsed" : ""}`}>
      <aside className="console-sidebar">
        <div className="console-brand-row">
          <Link className="console-brand" href={href("/")} aria-label={t("tokvilo 首页", "tokvilo home")}><Brand /></Link>
          <button className="console-collapse" onClick={() => setCollapsed(!collapsed)} type="button" aria-label={collapsed ? t("展开导航", "Expand navigation") : t("收起导航", "Collapse navigation")} aria-expanded={!collapsed}><Icon name="panel" size={16} /></button>
        </div>
        <div className="console-switcher" aria-label={t("工作区", "Workspace")}>
          <Link href={href("/dashboard")} className={active !== "playground" ? "selected" : ""}>{t("控制台", "Dashboard")}</Link>
          <Link href={href("/playground")} className={active === "playground" ? "selected" : ""}>PLAYGROUND</Link>
        </div>
        <nav className="console-navigation" aria-label={t("控制台导航", "Dashboard navigation")}>
          {navigation.map((item) => item.key === "wallet" ? <a key={item.key} className={`console-nav-link${active === item.key ? " active" : ""}`} href={href(item.href)} aria-current={active === item.key ? "page" : undefined} title={t(item.label, item.labelEn)}><Icon name={item.icon} size={17} /><span>{t(item.label, item.labelEn)}</span></a> : <Link key={item.key} className={`console-nav-link${active === item.key ? " active" : ""}`} href={href(item.href)} aria-current={active === item.key ? "page" : undefined} title={t(item.label, item.labelEn)}><Icon name={item.icon} size={17} /><span>{t(item.label, item.labelEn)}</span></Link>)}
          {<Link className={`console-nav-link${active === "tokenhub" ? " active" : ""}`} href={href("/studio")} aria-current={active === "tokenhub" ? "page" : undefined} title={t("tokvilo 多模态 工作台", "tokvilo Multimodal workspace")}><Icon name="video" size={17} /><span>{t("tokvilo 多模态 工作台", "tokvilo Multimodal workspace")}</span></Link>}
          <Link className={`console-nav-link${active === "selected" ? " active" : ""}`} href={href("/selected")} aria-current={active === "selected" ? "page" : undefined} title={t("tokvilo 精选工作台", "tokvilo Select workspace")}><Icon name="sparkles" size={17} /><span>{t("tokvilo 精选工作台", "tokvilo Select workspace")}</span></Link>
          {user.isAdmin ? <Link className={`console-nav-link${active === "tokenhub-audit" ? " active" : ""}`} href={href("/admin/audit")} aria-current={active === "tokenhub-audit" ? "page" : undefined} title={t("每日模型核验", "Daily model checks")}><Icon name="chart" size={17} /><span>{t("每日模型核验", "Daily model checks")}</span></Link> : null}
          {user.isAdmin ? <Link className={`console-nav-link${active === "admin" ? " active" : ""}`} href={href("/admin")} aria-current={active === "admin" ? "page" : undefined} title={t("上游管理", "Service administration")}><Icon name="settings" size={17} /><span>{t("上游管理", "Service administration")}</span></Link> : null}
          {user.isAdmin ? <Link className={`console-nav-link${active === "billing-admin" ? " active" : ""}`} href={href("/admin/billing")} aria-current={active === "billing-admin" ? "page" : undefined} title={t("企业到账与余额", "Enterprise payments")}><Icon name="chart" size={17} /><span>{t("企业到账与余额", "Enterprise payments")}</span></Link> : null}
        </nav>
        <div className="console-sidebar-bottom">
          <Link className={`console-nav-link${active === "models" ? " active" : ""}`} href={href("/models")} title={t("模型广场", "Model catalog")}><Icon name="store" size={17} /><span>{t("模型广场", "Model catalog")}</span></Link>
          <div className="console-account">
            <span className="console-avatar" aria-hidden="true">{user.displayName.slice(0, 2).toUpperCase()}</span>
            <div className="console-account-info"><strong>{user.displayName}</strong><small>{user.isAdmin ? t("管理员", "Administrator") : t("个人账户", "Personal account")}</small></div>
            <LogoutButton />
          </div>
          <div className="console-sidebar-footer"><span>tokvilo API</span><LanguageSwitcher /><ThemeToggle /></div>
        </div>
      </aside>
      <main className="dashboard-main"><div className="console-page">{children}</div></main>
    </div>
  );
}
