import type { Metadata } from "next";
import { AuthForm } from "@/components/AuthForm";
import { Brand } from "@/components/Brand";
import { Icon } from "@/components/Icon";
import { PublicNav } from "@/components/PublicNav";

export const metadata: Metadata = { title: "注册" };

export default function RegisterPage() {
  return (
    <main className="auth-page">
      <PublicNav />
      <div className="auth-layout">
        <aside className="auth-story">
          <span className="landing-eyebrow">BUILD SOMETHING NEW</span>
          <h2>让你的想法，<br />拥有更多<br />可能性。</h2>
          <p>从一个账户开始，<br />集中管理模型、数据与 API 工作流。</p>
          <div className="auth-story-orbit" aria-hidden="true"><div><Brand compact /></div></div>
          <div className="auth-story-footer"><span>tokvilo API WORKSPACE</span><span>↗</span></div>
        </aside>
        <div className="auth-form-column"><section className="auth-card">
          <span className="auth-eyebrow">CREATE YOUR WORKSPACE</span>
          <h1>开始使用 tokvilo</h1>
          <p className="auth-intro">创建成员账户，开启你的 API 工作空间。</p>
          <AuthForm mode="register" />
          <p className="auth-privacy"><Icon name="shield" size={12} />按注册结果完成邮箱验证，再登录控制台</p>
        </section></div>
      </div>
    </main>
  );
}
