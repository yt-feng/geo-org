"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Brand } from "@/components/Brand";
import { Icon } from "@/components/Icon";
import { LanguageSwitcher, useSiteLocale } from "./LocaleProvider";
import { ThemeToggle } from "@/components/ThemeToggle";

export function PublicNav() {
  const { t, href } = useSiteLocale();
  const pathname = (usePathname() || "/").replace(/^\/en(?=\/|$)/, "") || "/";
  const [open, setOpen] = useState(false);
  return (
    <header className="public-header">
      <Link href={href("/")} className="public-brand" aria-label={t("tokvilo 首页", "tokvilo home")}><Brand /></Link>
      <button className="public-menu-toggle" type="button" aria-label={open ? t("关闭导航", "Close navigation") : t("打开导航", "Open navigation")} aria-expanded={open} onClick={() => setOpen(!open)}><Icon name={open ? "close" : "menu"} size={20} /></button>
      <nav className={`public-navigation${open ? " is-open" : ""}`} aria-label={t("主导航", "Main navigation")}>
        <Link href={href("/models")} aria-current={pathname === "/models" ? "page" : undefined} onClick={() => setOpen(false)}>{t("模型市场", "Models")}</Link>
        <Link href={href("/products")} aria-current={pathname === "/products" ? "page" : undefined} onClick={() => setOpen(false)}>{t("数字商品", "Digital goods")}</Link>
        <Link href={href("/pricing")} aria-current={pathname === "/pricing" ? "page" : undefined} onClick={() => setOpen(false)}>{t("价格", "Pricing")}</Link>
        <Link href={href("/dashboard/docs")} onClick={() => setOpen(false)}>{t("API 文档", "API docs")}</Link>
        <Link href={href("/#integration")} onClick={() => setOpen(false)}>{t("接入指南", "Get started")}</Link>
        <Link href={href("/#faq")} onClick={() => setOpen(false)}>{t("帮助", "Help")}</Link>
        <LanguageSwitcher /><ThemeToggle />
        <Link href={href("/dashboard")} className="public-account-link"><span className="public-account-avatar">t</span> {t("控制台", "Console")} <Icon name="arrow-up-right" size={13} /></Link>
      </nav>
    </header>
  );
}
