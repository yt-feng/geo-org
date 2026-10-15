"use client";

import { useSyncExternalStore } from "react";
import { Icon } from "./Icon";

const subscribe = (callback: () => void) => {
  window.addEventListener("eco-theme", callback);
  return () => window.removeEventListener("eco-theme", callback);
};
const getSnapshot = () => document.documentElement.dataset.theme === "light";

export function ThemeToggle({ className = "" }: { className?: string }) {
  const light = useSyncExternalStore(subscribe, getSnapshot, () => false);
  return (
    <button className={`theme-toggle ${className}`} type="button" title={light ? "切换深色主题" : "切换浅色主题"} aria-label={light ? "切换深色主题" : "切换浅色主题"} onClick={() => {
      const next = light ? "dark" : "light";
      document.documentElement.dataset.theme = next;
      try { localStorage.setItem("eco-geo-theme", next); } catch { /* Theme remains usable without storage. */ }
      window.dispatchEvent(new Event("eco-theme"));
    }}><Icon name={light ? "moon" : "sun"} size={17} /></button>
  );
}
