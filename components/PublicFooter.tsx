"use client";

import Link from "next/link";
import { Brand } from "./Brand";
import { LegalLinks } from "./LegalLinks";
import { useSiteLocale } from "./LocaleProvider";

export function PublicFooter() {
  const { t, href } = useSiteLocale();
  return <footer className="public-footer">
    <div className="public-footer-top">
      <div className="public-footer-brand"><Link href={href("/")} aria-label={t("tokvilo 首页", "tokvilo home")}><Brand /></Link><p>{t("发现模型，连接创造。", "Discover models. Build ideas.")}<br />{t("你的 AI 模型工作空间。", "Your AI model workspace.")}</p></div>
      <div><h3>{t("探索 tokvilo", "Explore tokvilo")}</h3><Link href={href("/models")}>{t("模型市场", "Models")}</Link><Link href={href("/compare")}>{t("模型比较", "Compare models")}</Link><Link href={href("/pricing")}>{t("模型价格", "Pricing")}</Link><Link href={href("/products")}>{t("数字商品", "Digital goods")}</Link></div>
      <div><h3>{t("学习与构建", "Learn & build")}</h3><Link href={href("/blog")}>{t("tokvilo 博客", "tokvilo Blog")}</Link><Link href={href("/dashboard/docs")}>{t("API 文档", "API docs")}</Link><Link href={href("/#integration")}>{t("接入指南", "Get started")}</Link></div>
      <div><h3>{t("工作空间", "Workspace")}</h3><Link href={href("/dashboard")}>{t("控制台", "Dashboard")}</Link><Link href={href("/playground")}>Playground</Link><a href={href("/dashboard/wallet")}>{t("余额与充值", "Balance & top up")}</a></div>
      <div><h3>{t("tokvilo 支持", "tokvilo support")}</h3><Link href={href("/advisor")}>{t("模型选型助手", "Model advisor")}</Link><Link href={href("/#faq")}>{t("常见问题", "FAQs")}</Link><Link href={href("/forgot-password")}>{t("找回密码", "Reset password")}</Link><a href="mailto:yt.feng@foxmail.com">{t("联系我们", "Contact us")}</a><span>{t("邮件咨询 · 24 小时内回复", "Email support · Reply within 24 hours")}</span></div>
    </div>
    <LegalLinks />
    <div className="public-footer-bottom"><span>© {new Date().getFullYear()} tokvilo</span><span>{t("模型标识用于识别产品；tokvilo 为独立服务商。", "Model logos identify their products. tokvilo is an independent service.")}</span><span>{t("简体中文", "English")}</span></div>
  </footer>;
}
