import Link from "next/link";
import type { PortalUser } from "@/lib/auth";
import { LogoutButton } from "./LogoutButton";

export function DashboardShell({
  user,
  active,
  children,
}: {
  user: PortalUser;
  active: "overview" | "docs" | "admin";
  children: React.ReactNode;
}) {
  return (
    <main className="dashboard-shell">
      <aside className="sidebar">
        <Link className="wordmark sidebar-wordmark" href="/dashboard">
          <span className="wordmark-dot" aria-hidden="true" />
          Eco Geo
        </Link>
        <nav className="sidebar-nav" aria-label="控制台导航">
          <Link className={`sidebar-link ${active === "overview" ? "active" : ""}`} href="/dashboard">
            <span>总览</span>
            <small>01</small>
          </Link>
          <Link className={`sidebar-link ${active === "docs" ? "active" : ""}`} href="/dashboard/docs">
            <span>API 文档</span>
            <small>02</small>
          </Link>
          {user.isAdmin ? (
            <Link className={`sidebar-link ${active === "admin" ? "active" : ""}`} href="/admin">
              <span>管理员</span>
              <small>03</small>
            </Link>
          ) : null}
        </nav>
        <div className="sidebar-account">
          <div className="avatar" aria-hidden="true">
            {user.displayName.slice(0, 1).toUpperCase()}
          </div>
          <div>
            <strong>{user.displayName}</strong>
            <span>{user.email}</span>
          </div>
        </div>
        <LogoutButton />
      </aside>
      <section className="dashboard-main">{children}</section>
    </main>
  );
}
