import type { Metadata } from "next";
import { headers } from "next/headers";
import { SessionKeepAlive } from "@/components/SessionKeepAlive";
import { LocaleProvider } from "@/components/LocaleProvider";
import { SITE_PATH_HEADER, siteLocaleForPath, siteMetadata } from "@/lib/site-seo";
import "./globals.css";
import "./console.css";
import "./public-design.css";
import "./catalog.css";
import "./admin-design.css";
import "./tokenhub.css";
import "./tokenhub-audit.css";
import "./commerce.css";
import "./billing.css";
import "./blog.css";
import "./selection.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  return siteMetadata(requestHeaders.get(SITE_PATH_HEADER) || "");
}

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const requestHeaders = await headers();
  const locale = siteLocaleForPath(requestHeaders.get(SITE_PATH_HEADER) || "");
  return (
    <html lang={locale === "en" ? "en" : "zh-CN"} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: "try{document.documentElement.dataset.theme=localStorage.getItem('tokvilo-theme')==='light'?'light':'dark'}catch(e){}" }} />
      </head>
      <body><LocaleProvider locale={locale}><SessionKeepAlive />{children}</LocaleProvider></body>
    </html>
  );
}
