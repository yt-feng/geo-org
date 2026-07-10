import type { Metadata } from "next";
import Link from "next/link";
import { AuthForm } from "@/components/AuthForm";

export const metadata: Metadata = { title: "登录" };

export default function LoginPage() {
  return (
    <main className="auth-shell">
      <Link className="wordmark auth-wordmark" href="/">
        <span className="wordmark-dot" aria-hidden="true" />
        Eco Geo
      </Link>
      <section className="auth-card">
        <div className="eyebrow">WELCOME BACK</div>
        <h1>登录控制台</h1>
        <p className="auth-intro">查看私有文档、管理 API 密钥与调用额度。</p>
        <AuthForm mode="login" />
      </section>
    </main>
  );
}
