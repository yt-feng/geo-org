import type { Metadata } from "next";
import { Brand } from "@/components/Brand";
import { PasswordRecoveryForm } from "@/components/PasswordRecoveryForm";
import { PublicNav } from "@/components/PublicNav";

export const metadata: Metadata = { title: "重置密码", referrer: "no-referrer" };

export default function ResetPasswordPage() {
  return <main className="auth-page"><PublicNav /><div className="auth-layout">
    <aside className="auth-story"><span className="landing-eyebrow">TOKVILO / ACCOUNT</span><h2>设置新密码，<br />回到工作空间。</h2><p>完成验证后，为你的账户设置新密码。</p><div className="auth-story-orbit" aria-hidden="true"><div><Brand compact /></div></div><div className="auth-story-footer"><span>tokvilo API WORKSPACE</span><span>↗</span></div></aside>
    <div className="auth-form-column"><section className="auth-card"><span className="auth-eyebrow">SET A NEW PASSWORD</span><h1>重置 tokvilo 密码</h1><p className="auth-intro">新密码至少 10 位。保存成功后，请重新登录。</p><PasswordRecoveryForm mode="reset" /></section></div>
  </div></main>;
}
