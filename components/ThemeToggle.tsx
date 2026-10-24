"use client";

import { useSyncExternalStore } from "react";
import { Icon } from "./Icon";
import { useSiteLocale } from "./LocaleProvider";

const subscribe = (callback: () => void) => {
  window.addEventListener("eco-theme", callback);
  return () => window.removeEventListener("eco-theme", callback);
};
const getSnapshot = () => document.documentElement.dataset.theme === "light";

export function ThemeToggle({ className = "" }: { className?: string }) {
  const { t } = useSiteLocale();
  const light = useSyncExternalStore(subscribe, getSnapshot, () => false);
  return (
    <button className={`theme-toggle ${className}`} type="button" title={light ? t("切换深色主题", "Switch to dark theme") : t("切换浅色主题", "Switch to light theme")} aria-label={light ? t("切换深色主题", "Switch to dark theme") : t("切换浅色主题", "Switch to light theme")} onClick={() => {
      const next = light ? "dark" : "light";
      document.documentElement.dataset.theme = next;
      try { localStorage.setItem("tokvilo-theme", next); } catch { /* Theme remains usable without storage. */ }
      window.dispatchEvent(new Event("eco-theme"));
    }}><Icon name={light ? "moon" : "sun"} size={17} /></button>
  );
}
