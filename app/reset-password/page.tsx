import type { Metadata } from "next";
import { LocaleProvider } from "@/components/LocaleProvider";
import { AuthCopy } from "@/components/AuthForm";
import { Brand } from "@/components/Brand";
import { PasswordRecoveryForm } from "@/components/PasswordRecoveryForm";
import { PublicNav } from "@/components/PublicNav";

type PageProps = { searchParams?: Promise<Record<string, string | string[] | undefined>> };
export async function generateMetadata({ searchParams }: PageProps = {}): Promise<Metadata> {
  return { title: (await searchParams)?.lang === "en" ? "Reset password" : "重置密码", referrer: "no-referrer" };
}

export default async function ResetPasswordPage({ searchParams }: PageProps = {}) {
  const locale = (await searchParams)?.lang === "en" ? "en" : "zh";
  return <LocaleProvider locale={locale}><main className="auth-page"><PublicNav /><div className="auth-layout">
    <aside className="auth-story"><span className="landing-eyebrow">TOKVILO / ACCOUNT</span><h2><AuthCopy zh={<>设置新密码，<br />回到工作空间。</>} en={<>Set a new password.<br />Get back to work.</>} /></h2><p><AuthCopy zh={<>完成验证后，为你的账户设置新密码。</>} en={<>Verify your recovery link, then choose a new password.</>} /></p><div className="auth-story-orbit" aria-hidden="true"><div><Brand compact /></div></div><div className="auth-story-footer"><span>tokvilo API WORKSPACE</span><span>↗</span></div></aside>
    <div className="auth-form-column"><section className="auth-card"><span className="auth-eyebrow">SET A NEW PASSWORD</span><h1><AuthCopy zh={<>重置 tokvilo 密码</>} en={<>Reset your password</>} /></h1><p className="auth-intro"><AuthCopy zh={<>新密码至少 10 位。保存成功后，请重新登录。</>} en={<>Use at least 10 characters. Log in again after saving your new password.</>} /></p><PasswordRecoveryForm mode="reset" /></section></div>
  </div></main></LocaleProvider>;
}
