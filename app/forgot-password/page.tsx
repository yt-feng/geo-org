import type { Metadata } from "next";
import { LocaleProvider } from "@/components/LocaleProvider";
import { AuthCopy } from "@/components/AuthForm";
import { Brand } from "@/components/Brand";
import { PasswordRecoveryForm } from "@/components/PasswordRecoveryForm";
import { PublicNav } from "@/components/PublicNav";

type PageProps = { searchParams?: Promise<Record<string, string | string[] | undefined>> };
export async function generateMetadata({ searchParams }: PageProps = {}): Promise<Metadata> {
  return { title: (await searchParams)?.lang === "en" ? "Forgot password" : "找回密码", referrer: "no-referrer" };
}

export default async function ForgotPasswordPage({ searchParams }: PageProps = {}) {
  const locale = (await searchParams)?.lang === "en" ? "en" : "zh";
  return <LocaleProvider locale={locale}><main className="auth-page"><PublicNav /><div className="auth-layout">
    <aside className="auth-story"><span className="landing-eyebrow">TOKVILO / ACCOUNT</span><h2><AuthCopy zh={<>找回访问，<br />继续创造。</>} en={<>Recover access.<br />Keep creating.</>} /></h2><p><AuthCopy zh={<>使用注册邮箱找回你的 tokvilo 账户。</>} en={<>Use your account email to recover access to tokvilo.</>} /></p><div className="auth-story-orbit" aria-hidden="true"><div><Brand compact /></div></div><div className="auth-story-footer"><span>tokvilo API WORKSPACE</span><span>↗</span></div></aside>
    <div className="auth-form-column"><section className="auth-card"><span className="auth-eyebrow">RESET YOUR PASSWORD</span><h1><AuthCopy zh={<>找回 tokvilo 密码</>} en={<>Forgot your password?</>} /></h1><p className="auth-intro"><AuthCopy zh={<>填写注册时使用的邮箱，我们会向该邮箱发送密码重置链接。</>} en={<>Enter your account email to request a password reset link.</>} /></p><PasswordRecoveryForm mode="forgot" /></section></div>
  </div></main></LocaleProvider>;
}
