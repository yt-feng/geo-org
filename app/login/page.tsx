import type { Metadata } from "next";
import { LocaleProvider } from "@/components/LocaleProvider";
import { AuthForm, AuthCopy } from "@/components/AuthForm";
import { Brand } from "@/components/Brand";
import { Icon } from "@/components/Icon";
import { PublicNav } from "@/components/PublicNav";

type PageProps = { searchParams?: Promise<Record<string, string | string[] | undefined>> };
export async function generateMetadata({ searchParams }: PageProps = {}): Promise<Metadata> {
  return { title: (await searchParams)?.lang === "en" ? "Log in" : "登录", referrer: "no-referrer" };
}

export default async function LoginPage({ searchParams }: PageProps = {}) {
  const locale = (await searchParams)?.lang === "en" ? "en" : "zh";
  return (
    <LocaleProvider locale={locale}><main className="auth-page">
      <PublicNav />
      <div className="auth-layout">
        <aside className="auth-story">
          <span className="landing-eyebrow">ONE API. MORE POSSIBILITIES.</span>
          <h2><AuthCopy zh={<>连接模型。<br />连接数据。<br />连接下一个想法。</>} en={<>Connect models.<br />Connect data.<br />Build your next idea.</>} /></h2>
          <p><AuthCopy zh={<>统一的 API 工作空间。<br />从第一行代码，到你的下一个产品。</>} en={<>One API workspace.<br />From your first line of code to your next product.</>} /></p>
          <div className="auth-story-orbit" aria-hidden="true"><div><Brand compact /></div></div>
          <div className="auth-story-footer"><span>tokvilo API WORKSPACE</span><span>↗</span></div>
        </aside>
        <div className="auth-form-column"><section className="auth-card">
          <span className="auth-eyebrow">WELCOME BACK</span>
          <h1><AuthCopy zh={<>登录 tokvilo</>} en={<>Log in to tokvilo</>} /></h1>
          <p className="auth-intro"><AuthCopy zh={<>欢迎回来。进入你的 API 工作空间。</>} en={<>Welcome back to your API workspace.</>} /></p>
          <AuthForm mode="login" />
          <p className="auth-privacy"><Icon name="shield" size={12} /><AuthCopy zh={<>文档与调用凭证仅向登录成员开放</>} en={<>API credentials and private documentation are available after login</>} /></p>
        </section></div>
      </div>
    </main></LocaleProvider>
  );
}
