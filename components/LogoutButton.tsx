"use client";

import { useState } from "react";
import { Icon } from "./Icon";

export function LogoutButton() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function logout() {
    setPending(true);
    setError("");
    window.dispatchEvent(new Event("tokvilo:logout"));
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error();
      window.location.assign("/login");
    } catch {
      setError("退出未完成，请重试");
      setPending(false);
    }
  }
  return <button className="console-logout" disabled={pending} onClick={logout} type="button" aria-label={error || (pending ? "正在退出…" : "退出登录")} title={error || "退出登录"}><Icon name="logout" size={16} /></button>;
}
