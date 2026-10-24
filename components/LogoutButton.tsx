"use client";

import { useSiteLocale } from "./LocaleProvider";

import { useState } from "react";
import { Icon } from "./Icon";

export function LogoutButton() {
  const { t, href } = useSiteLocale();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function logout() {
    setPending(true);
    setError("");
    window.dispatchEvent(new Event("tokvilo:logout"));
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error();
      window.location.assign(href("/login"));
    } catch {
      setError(t("退出未完成，请重试", "Logout failed. Please try again."));
      setPending(false);
    }
  }
  return <button className="console-logout" disabled={pending} onClick={logout} type="button" aria-label={error || (pending ? t("正在退出…", "Logging out…") : t("退出登录", "Log out"))} title={error || t("退出登录", "Log out")}><Icon name="logout" size={16} /></button>;
}
