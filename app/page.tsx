import Link from "next/link";

export default function Home() {
  return (
    <main className="public-shell">
      <nav className="public-nav" aria-label="主导航">
        <Link className="wordmark" href="/">
          <span className="wordmark-dot" aria-hidden="true" />
          Eco Geo
        </Link>
        <div className="nav-actions">
          <Link className="button button-ghost" href="/login">
            登录
          </Link>
          <Link className="button button-primary" href="/register">
            注册
          </Link>
        </div>
      </nav>

      <section className="public-hero">
        <div className="eyebrow">MEMBER ACCESS</div>
        <h1>
          一个入口，
          <span>连接你的数据工作流。</span>
        </h1>
        <p>
          Eco Geo API 为已授权成员提供稳定、统一的接口访问。接口说明、密钥与用量均在登录后可见。
        </p>
        <div className="hero-actions">
          <Link className="button button-primary button-large" href="/login">
            进入控制台
          </Link>
          <Link className="button button-ghost button-large" href="/register">
            创建账户
          </Link>
        </div>
        <div className="privacy-note">
          <span aria-hidden="true">●</span>
          文档与调用凭证不对外公开
        </div>
      </section>

      <section className="public-grid" aria-label="服务特点">
        <article>
          <span className="feature-index">01</span>
          <h2>统一入口</h2>
          <p>使用一个域名和一套凭证接入已开通的服务能力。</p>
        </article>
        <article>
          <span className="feature-index">02</span>
          <h2>私有文档</h2>
          <p>完整接口目录与请求参数仅向登录成员展示。</p>
        </article>
        <article>
          <span className="feature-index">03</span>
          <h2>用量可见</h2>
          <p>在控制台查看每日调用、成功率和账户额度。</p>
        </article>
      </section>
    </main>
  );
}
