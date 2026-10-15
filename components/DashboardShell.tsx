"use client";

import { useState } from "react";
import Link from "next/link";
import type { PortalUser } from "@/lib/auth";
import { Brand } from "./Brand";
import { Icon } from "./Icon";
import { ThemeToggle } from "./ThemeToggle";
import { LogoutButton } from "./LogoutButton";

type ConsoleSection = "overview" | "keys" | "usage" | "docs" | "admin" | "models" | "playground";
const navigation: Array<{ key: ConsoleSection; href: string; icon: string; label: string }> = [
  { key: "overview", href: "/dashboard", icon: "grid", label: "控制台" },
  { key: "keys", href: "/dashboard/keys", icon: "key", label: "API 密钥" },
  { key: "usage", href: "/dashboard/usage", icon: "activity", label: "调用日志" },
  { key: "docs", href: "/dashboard/docs", icon: "book", label: "API 文档" },
];

export function DashboardShell({ user, active, children }: {
  user: PortalUser;
  active: ConsoleSection;
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div className={`dashboard-shell${collapsed ? " console-collapsed" : ""}`}>
      <aside className="console-sidebar">
        <div className="console-brand-row">
          <Link className="console-brand" href="/" aria-label="ECO-GEO 首页"><Brand /></Link>
          <button className="console-collapse" onClick={() => setCollapsed(!collapsed)} type="button" aria-label={collapsed ? "展开导航" : "收起导航"} aria-expanded={!collapsed}><Icon name="panel" size={16} /></button>
        </div>
        <div className="console-switcher" aria-label="工作区">
          <Link href="/dashboard" className={active !== "playground" ? "selected" : ""}>控制台</Link>
          <Link href="/playground" className={active === "playground" ? "selected" : ""}>PLAYGROUND</Link>
        </div>
        <nav className="console-navigation" aria-label="控制台导航">
          {navigation.map((item) => <Link key={item.key} className={`console-nav-link${active === item.key ? " active" : ""}`} href={item.href} aria-current={active === item.key ? "page" : undefined} title={item.label}><Icon name={item.icon} size={17} /><span>{item.label}</span></Link>)}
          {user.isAdmin ? <Link className={`console-nav-link${active === "admin" ? " active" : ""}`} href="/admin" aria-current={active === "admin" ? "page" : undefined} title="上游管理"><Icon name="settings" size={17} /><span>上游管理</span></Link> : null}
        </nav>
        <div className="console-sidebar-bottom">
          <Link className={`console-nav-link${active === "models" ? " active" : ""}`} href="/models" title="模型广场"><Icon name="store" size={17} /><span>模型广场</span></Link>
          <div className="console-account">
            <span className="console-avatar" aria-hidden="true">{user.displayName.slice(0, 2).toUpperCase()}</span>
            <div className="console-account-info"><strong>{user.displayName}</strong><small>{user.isAdmin ? "管理员" : "个人账户"}</small></div>
            <LogoutButton />
          </div>
          <div className="console-sidebar-footer"><span>ECO-GEO API</span><ThemeToggle /></div>
        </div>
      </aside>
      <main className="dashboard-main"><div className="console-page">{children}</div></main>
    </div>
  );
}
