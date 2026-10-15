"use client";

import { useState } from "react";
import { Icon } from "./Icon";

export function LogoutButton() {
  const [pending, setPending] = useState(false);
  async function logout() {
    setPending(true);
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    window.location.assign("/login");
  }
  return <button className="console-logout" disabled={pending} onClick={logout} type="button" aria-label={pending ? "正在退出…" : "退出登录"} title="退出登录"><Icon name="logout" size={16} /></button>;
}
