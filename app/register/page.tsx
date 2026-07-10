import type { Metadata } from "next";
import Link from "next/link";
import { AuthForm } from "@/components/AuthForm";

export const metadata: Metadata = { title: "注册" };

export default function RegisterPage() {
  return (
    <main className="auth-shell">
      <Link className="wordmark auth-wordmark" href="/">
        <span className="wordmark-dot" aria-hidden="true" />
        Eco Geo
      </Link>
      <section className="auth-card">
        <div className="eyebrow">CREATE ACCOUNT</div>
        <h1>创建成员账户</h1>
        <p className="auth-intro">注册并验证邮箱后，即可进入私有控制台。</p>
        <AuthForm mode="register" />
      </section>
    </main>
  );
}
