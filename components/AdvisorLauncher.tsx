"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSiteLocale } from "./LocaleProvider";
import { Icon } from "./Icon";
export function AdvisorLauncher() {
  const { href, t } = useSiteLocale();
  const path = (usePathname() || "/").replace(/^\/en(?=\/|$)/, "") || "/";
  if (!["/", "/models", "/pricing", "/compare"].includes(path)) return null;
  return <Link className="advisor-launcher" href={href("/advisor")}><Icon name="message" size={22} /><span><strong>{t("帮我选模型", "Help me choose")}</strong><small>tokvilo advisor</small></span><span aria-hidden="true">↗</span></Link>;
}
