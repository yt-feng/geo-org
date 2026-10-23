"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

export function SessionKeepAlive() {
  const pathname = usePathname();
  useEffect(() => {
    // A normal session refresh must not race the recovery flow's cookie clearing.
    if (pathname === "/reset-password") return;
    const controller = new AbortController();
    let stopped = false, timer: ReturnType<typeof setTimeout> | undefined;
    async function refresh() {
      if (stopped) return;
      try {
        const response = await fetch("/api/auth/refresh", {
          method: "POST", headers: { "content-type": "application/json" }, body: "{}",
          cache: "no-store", signal: controller.signal,
        });
        if (stopped || response.status === 401) return;
        if (response.ok && window.location.pathname === "/login") {
          const isEnglish = new URLSearchParams(window.location.search).get("lang") === "en";
          window.location.assign(isEnglish ? "/dashboard?lang=en" : "/dashboard");
          return;
        }
      } catch { if (stopped) return; }
      timer = setTimeout(refresh, 5 * 60 * 1000);
    }
    function stop() {
      stopped = true; controller.abort();
      if (timer) clearTimeout(timer);
    }
    window.addEventListener("tokvilo:logout", stop);
    void refresh();
    return () => { stop(); window.removeEventListener("tokvilo:logout", stop); };
  }, [pathname]);
  return null;
}
