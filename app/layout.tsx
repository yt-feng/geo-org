import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";
import "./console.css";
import "./public-design.css";
import "./catalog.css";
import "./admin-design.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const forwardedHost = requestHeaders.get("x-forwarded-host")?.split(",")[0]?.trim();
  const rawHost = forwardedHost || requestHeaders.get("host") || "api.eco-geo.org";
  const host = /^[a-z0-9.-]+(?::\d+)?$/i.test(rawHost)
    ? rawHost
    : "api.eco-geo.org";
  const forwardedProto = requestHeaders.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const protocol = forwardedProto === "http" || host.startsWith("localhost") ? "http" : "https";
  const metadataBase = new URL(`${protocol}://${host}`);
  const description = "ECO-GEO · 统一管理 AI 模型与社交数据 API，连接你的每一个应用。";

  return {
    metadataBase,
    title: { default: "Eco Geo API", template: "%s · Eco Geo API" },
    description,
    icons: { icon: "/icon.svg" },
    robots: { index: false, follow: false, nocache: true },
    openGraph: {
      type: "website",
      title: "Eco Geo API",
      description,
      images: [{ url: new URL("/og.png", metadataBase), width: 1200, height: 630 }],
    },
    twitter: {
      card: "summary_large_image",
      title: "Eco Geo API",
      description,
      images: [new URL("/og.png", metadataBase)],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: "try{document.documentElement.dataset.theme=localStorage.getItem('eco-geo-theme')==='light'?'light':'dark'}catch(e){}" }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
