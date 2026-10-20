"use client";

import Link from "next/link";
import { useState } from "react";
import { Brand } from "@/components/Brand";
import { Icon } from "@/components/Icon";
import { ThemeToggle } from "@/components/ThemeToggle";

export function PublicNav() {
  const [open, setOpen] = useState(false);
  return (
    <header className="public-header">
      <Link href="/" className="public-brand" aria-label="tokvilo 首页"><Brand /></Link>
      <button className="public-menu-toggle" type="button" aria-label={open ? "关闭导航" : "打开导航"} aria-expanded={open} onClick={() => setOpen(!open)}><Icon name={open ? "close" : "menu"} size={20} /></button>
      <nav className={`public-navigation${open ? " is-open" : ""}`} aria-label="主导航">
        <Link href="/models" onClick={() => setOpen(false)}>模型市场 <Icon name="chevron-down" size={12} /></Link>
        <Link href="/products" onClick={() => setOpen(false)}>数字商品</Link>
        <Link href="/pricing" onClick={() => setOpen(false)}>价格</Link>
        <Link href="/dashboard/docs" onClick={() => setOpen(false)}>API 文档</Link>
        <Link href="/#integration" onClick={() => setOpen(false)}>接入指南</Link>
        <Link href="/#faq" onClick={() => setOpen(false)}>支持 <Icon name="chevron-down" size={12} /></Link>
        <ThemeToggle />
        <Link href="/dashboard" className="public-account-link"><span className="public-account-avatar">t</span> 控制台 <Icon name="arrow-up-right" size={13} /></Link>
      </nav>
    </header>
  );
}
