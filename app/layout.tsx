import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const forwardedHost = requestHeaders.get("x-forwarded-host")?.split(",")[0]?.trim();
  const rawHost = forwardedHost || requestHeaders.get("host") || "api.eco-geo.com";
  const host = /^[a-z0-9.-]+(?::\d+)?$/i.test(rawHost)
    ? rawHost
    : "api.eco-geo.com";
  const forwardedProto = requestHeaders.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const protocol = forwardedProto === "http" || host.startsWith("localhost") ? "http" : "https";
  const metadataBase = new URL(`${protocol}://${host}`);
  const description = "Private API access and account management for Eco Geo members.";

  return {
    metadataBase,
    title: { default: "Eco Geo API", template: "%s · Eco Geo API" },
    description,
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
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
