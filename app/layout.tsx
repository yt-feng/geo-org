import type { Metadata } from "next";
import { headers } from "next/headers";
import { SessionKeepAlive } from "@/components/SessionKeepAlive";
import { LocaleProvider } from "@/components/LocaleProvider";
import "./globals.css";
import "./console.css";
import "./public-design.css";
import "./catalog.css";
import "./admin-design.css";
import "./tokenhub.css";
import "./tokenhub-audit.css";
import "./commerce.css";
import "./billing.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const forwardedHost = requestHeaders.get("x-forwarded-host")?.split(",")[0]?.trim();
  const rawHost = forwardedHost || requestHeaders.get("host") || "tokvilo.com";
  const host = /^[a-z0-9.-]+(?::\d+)?$/i.test(rawHost)
    ? rawHost
    : "tokvilo.com";
  const forwardedProto = requestHeaders.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const protocol = forwardedProto === "http" || host.startsWith("localhost") ? "http" : "https";
  const metadataBase = new URL(`${protocol}://${host}`);
  const description = "tokvilo · 统一管理 AI 模型与社交数据 API，连接你的每一个应用。";

  return {
    metadataBase,
    title: { default: "tokvilo", template: "%s · tokvilo" },
    description,
    icons: { icon: "/icon.svg" },
    robots: { index: false, follow: false, nocache: true },
    openGraph: {
      type: "website",
      title: "tokvilo",
      description,
    },
    twitter: {
      card: "summary",
      title: "tokvilo",
      description,
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: "try{document.documentElement.dataset.theme=localStorage.getItem('tokvilo-theme')==='light'?'light':'dark'}catch(e){}" }} />
      </head>
      <body><LocaleProvider><SessionKeepAlive />{children}</LocaleProvider></body>
    </html>
  );
}
