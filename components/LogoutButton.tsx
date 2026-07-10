"use client";

import { useState } from "react";

export function LogoutButton() {
  const [pending, setPending] = useState(false);
  async function logout() {
    setPending(true);
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    window.location.assign("/login");
  }
  return (
    <button className="sidebar-link sidebar-button" disabled={pending} onClick={logout} type="button">
      {pending ? "正在退出…" : "退出登录"}
    </button>
  );
}
