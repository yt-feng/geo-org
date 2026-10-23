import type { Metadata } from "next";
import { LocaleProvider } from "@/components/LocaleProvider";
import { AuthForm, AuthCopy } from "@/components/AuthForm";
import { Brand } from "@/components/Brand";
import { Icon } from "@/components/Icon";
import { PublicNav } from "@/components/PublicNav";

type PageProps = { searchParams?: Promise<Record<string, string | string[] | undefined>> };
export async function generateMetadata({ searchParams }: PageProps = {}): Promise<Metadata> {
  return { title: (await searchParams)?.lang === "en" ? "Create account" : "注册", referrer: "no-referrer" };
}

export default async function RegisterPage({ searchParams }: PageProps = {}) {
  const locale = (await searchParams)?.lang === "en" ? "en" : "zh";
  return (
    <LocaleProvider locale={locale}><main className="auth-page">
      <PublicNav />
      <div className="auth-layout">
        <aside className="auth-story">
          <span className="landing-eyebrow">BUILD SOMETHING NEW</span>
          <h2><AuthCopy zh={<>让你的想法，<br />拥有更多<br />可能性。</>} en={<>Give your ideas<br />more room<br />to grow.</>} /></h2>
          <p><AuthCopy zh={<>从一个账户开始，<br />集中管理模型、数据与 API 工作流。</>} en={<>Start with one account.<br />Manage your models, data and API workflows.</>} /></p>
          <div className="auth-story-orbit" aria-hidden="true"><div><Brand compact /></div></div>
          <div className="auth-story-footer"><span>tokvilo API WORKSPACE</span><span>↗</span></div>
        </aside>
        <div className="auth-form-column"><section className="auth-card">
          <span className="auth-eyebrow">CREATE YOUR WORKSPACE</span>
          <h1><AuthCopy zh={<>开始使用 tokvilo</>} en={<>Get started with tokvilo</>} /></h1>
          <p className="auth-intro"><AuthCopy zh={<>创建成员账户，开启你的 API 工作空间。</>} en={<>Create your account and open your API workspace.</>} /></p>
          <AuthForm mode="register" />
          <p className="auth-privacy"><Icon name="shield" size={12} /><AuthCopy zh={<>按注册结果完成邮箱验证，再登录控制台</>} en={<>Follow the email verification instructions, then log in.</>} /></p>
        </section></div>
      </div>
    </main></LocaleProvider>
  );
}
