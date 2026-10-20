"use client";

import Link from "next/link";
import Image from "next/image";
import { useState } from "react";
import { Brand } from "@/components/Brand";
import { Icon } from "@/components/Icon";
import { PublicNav } from "@/components/PublicNav";

const categories = ["全部模型", "文本", "图像", "视频", "数据"];
const models = [
  { name: "GPT Image", vendor: "OPENAI", mark: "◎", category: "图像", description: "从文字描述到视觉创作，探索图像生成与编辑。", color: "mint" },
  { name: "Nano Banana", vendor: "GOOGLE", mark: "✦", category: "图像", description: "多模态理解与图像创作，连接想法与表达。", color: "blue" },
  { name: "Claude", vendor: "ANTHROPIC", mark: "✳", category: "文本", description: "语言、推理与代码，构建你的智能工作流。", color: "orange" },
  { name: "Kling 2.6", vendor: "KLING AI", mark: "◉", category: "视频", description: "将创意转化为动态影像，探索视频生成。", color: "white" },
  { name: "Veo 3.1", vendor: "GOOGLE", mark: "▷", category: "视频", description: "面向场景与叙事的生成式视频能力。", color: "blue" },
  { name: "TikHub", vendor: "DATA API", mark: "↗", category: "数据", description: "统一访问已配置的数据接口与平台能力。", color: "pink" },
];

function DashboardPreview() {
  return (
    <div className="landing-console-preview" aria-label="tokvilo 控制台界面预览，图表为示意">
      <aside className="landing-preview-sidebar">
        <Brand />
        <div className="landing-preview-switch"><span>控制台</span><span>PLAYGROUND</span></div>
        {[["grid", "控制台"], ["key", "API 密钥"], ["activity", "调用记录"], ["chart", "用量统计"], ["book", "API 文档"], ["settings", "服务设置"]].map(([icon, label], index) => <div className={`landing-preview-link${index === 0 ? " active" : ""}`} key={label}><Icon name={icon} size={15} />{label}</div>)}
        <span className="landing-preview-caption">INTERFACE PREVIEW</span>
      </aside>
      <div className="landing-preview-content">
        <div className="landing-preview-welcome"><div><h3>服务与支持</h3><p>模型、数据、API 文档与调用管理集中在同一个控制台。</p></div><span>API 文档</span></div>
        <div className="landing-preview-period"><span className="active">今天</span><span>昨天</span><span>近 7 天</span><span>近 30 天</span><small>界面预览</small></div>
        <div className="landing-preview-metrics">{["今日调用", "调用成功率", "剩余额度", "累计请求", "请求延迟", "已创建密钥"].map((label, i) => <div key={label}><span>{label}</span><strong>—</strong><svg viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true"><path d={i % 2 ? "M0 35 L12 32 L24 32 L36 25 L48 28 L60 20 L72 11 L84 15 L100 2" : "M0 35 L14 24 L28 28 L42 15 L56 20 L70 7 L84 12 L100 1"} /></svg></div>)}</div>
        <div className="landing-preview-charts"><div className="landing-preview-chart"><h3>调用趋势</h3><p>统一查看你的 API 用量</p><div className="landing-preview-bars">{[18, 38, 26, 74, 53, 86, 64, 33].map((height, i) => <i style={{ height: `${height}%` }} key={i} />)}</div></div><div className="landing-preview-chart"><h3>服务分布</h3><p>多种能力，一个入口</p><div className="landing-preview-donut-row"><div className="landing-preview-donut"><span>API</span></div><div className="landing-preview-legend"><span>图像生成</span><span>语言模型</span><span>数据接口</span></div></div></div></div>
        <div className="landing-preview-table"><h3>服务目录</h3><div><span>服务</span><span>协议</span><span>管理</span></div><div><span>APIMart</span><span>REST API</span><span>统一配置</span></div><div><span>TikHub</span><span>REST API</span><span>统一配置</span></div></div>
      </div>
    </div>
  );
}

const codeSamples = {
  cURL: `curl "https://tokvilo.com/api/v1/ENDPOINT" \\
  -H "Authorization: Bearer $TOKVILO_API_KEY"`,
  Python: `import os\nimport requests\n\nresponse = requests.get(\n    "https://tokvilo.com/api/v1/ENDPOINT",\n    headers={\n        "Authorization": f"Bearer {os.environ['TOKVILO_API_KEY']}"\n    },\n)\nprint(response.json())`,
  JavaScript: `const response = await fetch(\n  "https://tokvilo.com/api/v1/ENDPOINT",\n  {\n    headers: {\n      Authorization: \`Bearer \${process.env.TOKVILO_API_KEY}\`,\n    },\n  },\n);\nconst data = await response.json();`,
};

export function PublicLanding() {
  const [category, setCategory] = useState("全部模型");
  const [language, setLanguage] = useState<keyof typeof codeSamples>("cURL");
  const [copied, setCopied] = useState(false);
  const visibleModels = category === "全部模型" ? models : models.filter((model) => model.category === category);

  async function copyCode() {
    try { await navigator.clipboard.writeText(codeSamples[language]); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { setCopied(false); }
  }

  return (
    <main className="public-site">
      <PublicNav />
      <div className="landing-hero-stage">
        <section className="landing-hero">
          <div className="landing-hero-copy">
            <h1>让 AI 更近一步。<br />模型、工具与订阅，<br />一个 tokvilo。</h1>
            <p>从模型 API 到数字订阅，在一个工作空间发现、购买和使用。按上游公开价格加价 20%，每次消费都有记录。</p>
            <div className="landing-hero-actions"><Link href="/dashboard" className="button button-primary">开始使用 <Icon name="arrow-right" size={16} /></Link><Link href="/dashboard/docs" className="button button-secondary">查看文档</Link><Link href="/playground" className="button button-secondary landing-tools-link">PLAYGROUND <span>NEW</span></Link></div>
            <span className="landing-private-note"><Icon name="lock" size={12} />文档与调用凭证不对外公开</span>
          </div>
          <DashboardPreview />
        </section>
      </div>

      <section className="landing-providers" aria-label="模型与数据生态"><span className="landing-provider-openai">◎ OpenAI</span><span className="landing-provider-anthropic">ANTHROPIC</span><span className="landing-provider-google">Google <b>✦</b></span><span className="landing-provider-deepseek">deepseek</span><span className="landing-provider-xai">𝕏 AI</span><span className="landing-provider-tikhub">TikHub <sup>↗</sup></span></section>

      <section className="landing-section landing-platform">
        <div className="landing-section-title"><span className="landing-eyebrow">ONE API. MORE POSSIBILITIES.</span><h2>定义你的 AI API 聚合层</h2><p>从模型探索到服务配置，在同一个工作空间里完成。</p></div>
        <div className="landing-feature-grid">
          <article className="landing-feature-card"><div className="landing-feature-visual landing-network"><div className="landing-network-center"><Brand compact /></div>{["GPT", "Claude", "Gemini", "Veo", "Sora", "TikHub"].map((name, i) => <span className={`landing-network-node node-${i}`} key={name}>{name}</span>)}</div><div className="landing-feature-copy"><span>01 / CONNECT</span><h3>一个入口，连接多种能力</h3><p>将 APIMart 与已有数据服务集中管理。模型探索、数据访问与文档，从这里开始。</p></div></article>
          <article className="landing-feature-card"><div className="landing-feature-visual landing-key-visual"><span><Icon name="key" size={15} /> Production key <i /></span><div>tk_••••••••••••••••••••</div><small><Icon name="lock" size={12} /> 服务端加密存储上游凭证</small></div><div className="landing-feature-copy"><span>02 / CONTROL</span><h3>让每一次接入清晰可控</h3><p>在控制台管理 API 密钥与上游配置。权限与凭证各司其职，协作更简单。</p></div></article>
          <article className="landing-feature-card"><div className="landing-feature-visual landing-observe-visual"><div><span>API USAGE</span><b>↗</b></div><svg viewBox="0 0 300 100" aria-hidden="true"><defs><linearGradient id="landingChartFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="currentColor" stopOpacity=".14" /><stop offset="100%" stopColor="currentColor" stopOpacity="0" /></linearGradient></defs><path d="M0 90 L30 75 L60 80 L90 52 L120 60 L150 32 L180 43 L210 17 L240 28 L270 5 L300 14 L300 100 L0 100Z" fill="url(#landingChartFill)" /><path d="M0 90 L30 75 L60 80 L90 52 L120 60 L150 32 L180 43 L210 17 L240 28 L270 5 L300 14" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg><small>请求 · 成功率 · 额度</small></div><div className="landing-feature-copy"><span>03 / OBSERVE</span><h3>调用发生什么，一目了然</h3><p>查看真实请求记录和用量趋势，掌握调用状态，让日常管理更直接。</p></div></article>
        </div>
      </section>

      <section className="landing-section landing-models" id="models">
        <div className="landing-section-title"><span className="landing-eyebrow">EXPLORE THE POSSIBILITIES</span><h2>为下一个想法，找到合适的模型</h2><p>探索 APIMart 模型生态与已有数据服务。</p></div>
        <div className="landing-model-toolbar"><div className="landing-tabs" aria-label="模型类型">{categories.map((item) => <button type="button" className={category === item ? "active" : ""} onClick={() => setCategory(item)} aria-pressed={category === item} key={item}>{item}</button>)}</div><Link href="/models">查看全部模型 <Icon name="arrow-up-right" size={15} /></Link></div>
        <div className="landing-model-grid">{visibleModels.map((model) => <Link href="/models" className="landing-model-card" key={model.name}><div className="landing-model-art"><Image src={`/model-art/model-${String(models.indexOf(model) + 1).padStart(2, "0")}.webp`} alt="" width={828} height={828} unoptimized /><span>{model.category}</span></div><div className="landing-model-card-content"><div className="landing-model-top"><span className={`landing-model-mark ${model.color}`}>{model.mark}</span><span className="landing-model-vendor">{model.vendor}</span></div><h3>{model.name}</h3><p>{model.description}</p><span className="landing-model-directory">模型能力目录</span></div><div className="landing-model-bottom"><Icon name="arrow-right" size={14} /> 查看详情</div></Link>)}</div>
        <p className="landing-catalog-note">以上为能力目录，具体可用模型以已配置上游为准。</p>
      </section>

      <section className="landing-section landing-integration" id="integration">
        <div className="landing-integration-copy"><span className="landing-eyebrow">BUILT FOR DEVELOPERS</span><h2>从第一行代码，<br />到第一次调用。</h2><p>熟悉的 HTTP 接口，清晰的接入路径。</p><ol><li><span>01</span><div><h3>创建账户</h3><p>登录你的 tokvilo 工作空间。</p></div></li><li><span>02</span><div><h3>生成 API 密钥</h3><p>进入控制台，创建并妥善保存调用凭证。</p></div></li><li><span>03</span><div><h3>查阅文档，发起请求</h3><p>将 ENDPOINT 替换为文档中已开通的接口路径。</p></div></li></ol><Link href="/dashboard/docs">阅读接入文档 <Icon name="arrow-right" size={16} /></Link></div>
        <div className="landing-code-window"><div className="landing-code-title"><span><i /><i /><i /></span><small>your-first-request</small></div><div className="landing-code-toolbar"><div className="landing-code-tabs">{(Object.keys(codeSamples) as (keyof typeof codeSamples)[]).map((item) => <button key={item} type="button" className={language === item ? "active" : ""} onClick={() => setLanguage(item)}>{item}</button>)}</div><button type="button" onClick={copyCode} aria-label="复制代码"><Icon name={copied ? "check" : "copy"} size={15} />{copied ? "已复制" : "复制"}</button></div><pre><code>{codeSamples[language]}</code></pre><div className="landing-code-footer"><span><Icon name="terminal" size={13} /> HTTP / REST</span><span>使用你自己的 API Key</span></div></div>
      </section>

      <section className="landing-section landing-benefits"><div className="landing-section-title"><span className="landing-eyebrow">YOUR WORKSPACE, SIMPLIFIED</span><h2>把复杂留给平台，<br />把时间留给创造。</h2></div><div className="landing-benefit-grid">{[
        ["layers", "统一工作空间", "AI 模型与数据服务，在同一套 tokvilo 品牌与导航下管理。"],
        ["key", "独立密钥管理", "为不同应用创建调用密钥，按需停用，清晰管理访问。"],
        ["activity", "可追溯的调用", "查看请求路径、状态与响应耗时，快速了解调用情况。"],
        ["sliders", "可配置的上游", "在后台填写 APIMart API Key，验证连接并读取模型目录。"],
        ["chart", "透明的用量", "实际调用数据与每日额度集中展示，使用情况始终可见。"],
        ["book", "专属接口文档", "登录后查看已开通的接口目录和参数，按文档直接接入。"],
      ].map(([icon, title, body]) => <article key={title}><Icon name={icon} size={22} /><h3>{title}</h3><p>{body}</p></article>)}</div></section>

      <section className="landing-section landing-faq" id="faq"><div className="landing-section-title"><span className="landing-eyebrow">QUESTIONS, ANSWERED</span><h2>常见问题</h2></div><div className="landing-faq-list">{[
        ["tokvilo 是什么？", "tokvilo 提供模型 API、数字商品与订阅服务。你可以浏览模型与商品、购买充值码、管理余额与订单。"],
        ["如何定价？", "模型 API 与数字商品均按对应上游价格加价 20%。API 按实际用量结算，数字商品按页面标注的规格和人民币售价购买。"],
        ["如何充值？", "在余额与充值页面通过链动小铺购买 tokvilo 充值码，支付后回到本站兑换。兑换额度和汇率在购买前展示。"],
        ["如何接入 APIMart？", "管理员登录后，在服务设置中填写 APIMart API Key。保存时会验证凭证，随后可测试连接和获取模型目录。实际模型执行以控制台展示的接入状态为准。"],
        ["原来的 TikHub 数据接口还可以使用吗？", "可以。已有数据接口继续通过 tokvilo 的统一入口访问，具体路径、参数与可用权限请查看登录后的 API 文档。"],
        ["如何开始使用 API？", "注册并登录账户，在 API 密钥页创建调用凭证，再按照接口文档提交请求。管理员可在后台查看上游配置和成员使用情况。"],
        ["上游 API Key 会展示给其他成员吗？", "不会。上游凭证由管理员配置，在服务端加密保存；控制台只显示配置状态及部分掩码。成员使用各自的 tokvilo 调用密钥。"],
      ].map(([question, answer], index) => <details key={question} open={index === 0}><summary>{question}<span><Icon name="plus" size={18} /></span></summary><p>{answer}</p></details>)}</div></section>

      <section className="landing-cta"><span className="landing-eyebrow">START BUILDING</span><h2>下一个想法，从这里开始。</h2><p>一个入口，连接你的模型、数据与工作流。</p><div><Link href="/dashboard" className="button button-primary">进入控制台 <Icon name="arrow-right" size={16} /></Link><Link href="/dashboard/docs" className="button button-secondary">查看 API 文档</Link></div></section>

      <footer className="public-footer"><div className="public-footer-top"><div className="public-footer-brand"><Link href="/"><Brand /></Link><p>One API. More possibilities.<br />连接模型、数据与创造力。</p></div><div><h3>产品</h3><Link href="/models">模型市场</Link><Link href="/playground">Playground</Link><Link href="/dashboard">控制台</Link></div><div><h3>开发者</h3><Link href="/dashboard/docs">API 文档</Link><Link href="/#integration">快速开始</Link><Link href="/dashboard/keys">API 密钥</Link></div><div><h3>工作空间</h3><Link href="/dashboard/usage">调用记录</Link><Link href="/admin">服务设置</Link><Link href="/#faq">帮助与支持</Link></div><div><h3>账户</h3><Link href="/login">登录</Link><Link href="/register">创建账户</Link><a href="https://tokvilo.com">tokvilo <Icon name="arrow-up-right" size={12} /></a></div></div><div className="public-footer-bottom"><span>© {new Date().getFullYear()} tokvilo. All rights reserved.</span><span><i /> tokvilo API WORKSPACE</span><span>简体中文</span></div></footer>
    </main>
  );
}
