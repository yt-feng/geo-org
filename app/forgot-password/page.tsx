import type { Metadata } from "next";
import { Brand } from "@/components/Brand";
import { PasswordRecoveryForm } from "@/components/PasswordRecoveryForm";
import { PublicNav } from "@/components/PublicNav";

export const metadata: Metadata = { title: "找回密码", referrer: "no-referrer" };

export default function ForgotPasswordPage() {
  return <main className="auth-page"><PublicNav /><div className="auth-layout">
    <aside className="auth-story"><span className="landing-eyebrow">TOKVILO / ACCOUNT</span><h2>找回访问，<br />继续创造。</h2><p>使用注册邮箱找回你的 tokvilo 账户。</p><div className="auth-story-orbit" aria-hidden="true"><div><Brand compact /></div></div><div className="auth-story-footer"><span>tokvilo API WORKSPACE</span><span>↗</span></div></aside>
    <div className="auth-form-column"><section className="auth-card"><span className="auth-eyebrow">RESET YOUR PASSWORD</span><h1>找回 tokvilo 密码</h1><p className="auth-intro">填写注册时使用的邮箱，我们会向该邮箱发送密码重置链接。</p><PasswordRecoveryForm mode="forgot" /></section></div>
  </div></main>;
}
