import type { Metadata } from "next";
import { AuthForm } from "@/components/AuthForm";
import { Brand } from "@/components/Brand";
import { Icon } from "@/components/Icon";
import { PublicNav } from "@/components/PublicNav";

export const metadata: Metadata = { title: "登录" };

export default function LoginPage() {
  return (
    <main className="auth-page">
      <PublicNav />
      <div className="auth-layout">
        <aside className="auth-story">
          <span className="landing-eyebrow">ONE API. MORE POSSIBILITIES.</span>
          <h2>连接模型。<br />连接数据。<br />连接下一个想法。</h2>
          <p>统一的 API 工作空间。<br />从第一行代码，到你的下一个产品。</p>
          <div className="auth-story-orbit" aria-hidden="true"><div><Brand compact /></div></div>
          <div className="auth-story-footer"><span>ECO-GEO API WORKSPACE</span><span>↗</span></div>
        </aside>
        <div className="auth-form-column"><section className="auth-card">
          <span className="auth-eyebrow">WELCOME BACK</span>
          <h1>登录 ECO-GEO</h1>
          <p className="auth-intro">欢迎回来。进入你的 API 工作空间。</p>
          <AuthForm mode="login" />
          <p className="auth-privacy"><Icon name="shield" size={12} />文档与调用凭证仅向登录成员开放</p>
        </section></div>
      </div>
    </main>
  );
}
