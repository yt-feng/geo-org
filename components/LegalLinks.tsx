"use client";

import Link from "next/link";
import { useSiteLocale } from "./LocaleProvider";

export function LegalLinks() {
  const { t, href } = useSiteLocale();
  return <nav className="billing-legal-links" aria-label={t("支付与服务政策", "Payment and service policies")}>
    <Link href={href("/billing")}>{t("支付方式", "Payments")}</Link>
    <Link href={href("/terms")}>{t("服务条款", "Terms")}</Link>
    <Link href={href("/refunds")}>{t("退款政策", "Refund policy")}</Link>
    <Link href={href("/privacy")}>{t("隐私政策", "Privacy")}</Link>
  </nav>;
}
