"use client";

import Link from "next/link";
import { useState } from "react";
import { Brand } from "@/components/Brand";
import { Icon } from "@/components/Icon";
import { PublicNav } from "@/components/PublicNav";
import { ProviderLogo } from "@/components/ProviderLogo";
import { useSiteLocale } from "@/components/LocaleProvider";
import { LegalLinks } from "@/components/LegalLinks";

const families = [
  { name: "GPT", provider: "OPENAI", vendor: "OpenAI", family: "gpt", category: "text", description: "从日常对话到推理与代码，在同一系列中比较不同代际。", tags: ["对话", "推理", "编程"] },
  { name: "Claude", provider: "ANTHROPIC", vendor: "Anthropic", family: "claude", category: "text", description: "写作、分析与开发，按任务选择适合的模型规格。", tags: ["写作", "分析", "编程"] },
  { name: "Gemini", provider: "GOOGLE", vendor: "Google", family: "gemini", category: "text", description: "从文本到多模态理解，集中浏览 Gemini 系列。", tags: ["多模态", "理解", "推理"] },
  { name: "DeepSeek", provider: "DEEPSEEK", vendor: "DeepSeek", family: "deepseek", category: "text", description: "对话与推理模型，比较不同版本的能力和价格。", tags: ["对话", "推理", "代码"] },
  { name: "Qwen", provider: "ALIBABA", vendor: "Alibaba", family: "qwen", category: "text", description: "通用对话、代码与多模态，探索通义千问模型家族。", tags: ["中文", "代码", "多模态"] },
  { name: "GLM", provider: "ZHIPU", vendor: "Zhipu AI", family: "glm", category: "text", description: "中文表达与通用推理，在 GLM 系列中找到合适的选择。", tags: ["中文", "对话", "推理"] },
  { name: "GPT Image", provider: "OPENAI", vendor: "OpenAI", family: "gpt-image", category: "image", description: "将文字描述转化为图像，探索生成与编辑能力。", tags: ["图像生成", "图像编辑"] },
  { name: "Gemini Image", provider: "GOOGLE", vendor: "Google", family: "gemini-image", category: "image", description: "结合文字与参考图，寻找适合视觉创作的模型。", tags: ["图像生成", "多模态"] },
  { name: "FLUX", provider: "BLACK FOREST LABS", vendor: "Black Forest Labs", family: "flux", category: "image", description: "集中比较 FLUX 系列的图像生成与编辑规格。", tags: ["图像生成", "图像编辑"] },
  { name: "Sora", provider: "OPENAI", vendor: "OpenAI", family: "sora", category: "video", description: "从提示词与参考素材开始，探索动态画面的创作。", tags: ["视频生成", "视觉叙事"] },
  { name: "Veo", provider: "GOOGLE", vendor: "Google", family: "veo", category: "video", description: "围绕场景与镜头表达，比较 Veo 系列的生成规格。", tags: ["视频生成", "场景创作"] },
  { name: "Kling", provider: "KUAISHOU", vendor: "Kuaishou", family: "kling", category: "video", description: "从静态灵感到动态影像，浏览可灵的视频模型。", tags: ["视频生成", "图生视频"] },
  { name: "Wan", provider: "ALIBABA", vendor: "Alibaba", family: "wan", category: "video", description: "将文字与图像转换为视频，查看万相系列各代产品。", tags: ["视频生成", "图生视频"] },
] as const;

const descriptionEnglish: Record<typeof families[number]["name"], string> = {
  "GPT": "Compare generations for everyday conversation, reasoning and code.",
  "Claude": "Find the right model size for writing, analysis and development.",
  "Gemini": "Explore the Gemini family, from text to multimodal understanding.",
  "DeepSeek": "Compare versions for conversation and reasoning, with clear pricing.",
  "Qwen": "Discover Qwen models for conversation, code and multimodal tasks.",
  "GLM": "Explore GLM models for Chinese-language tasks and general reasoning.",
  "GPT Image": "Turn descriptions into images and explore generation and editing.",
  "Gemini Image": "Create with text and reference images using the Gemini image family.",
  "FLUX": "Compare image generation and editing options across the FLUX family.",
  "Sora": "Explore moving-image creation with prompts and reference material.",
  "Veo": "Compare Veo models for scenes, shots and visual storytelling.",
  "Kling": "Bring still ideas into motion with the Kling video family.",
  "Wan": "Explore Wan generations for text-to-video and image-to-video creation."
};
const tagEnglish: Record<string, string> = {
  "对话": "Chat",
  "推理": "Reasoning",
  "编程": "Coding",
  "写作": "Writing",
  "分析": "Analysis",
  "多模态": "Multimodal",
  "理解": "Understanding",
  "代码": "Code",
  "中文": "Chinese",
  "图像生成": "Generation",
  "图像编辑": "Editing",
  "视频生成": "Video",
  "视觉叙事": "Storytelling",
  "场景创作": "Scenes",
  "图生视频": "Image to video"
};
const categoryEnglish = { text: "Chat & reasoning", image: "Image creation", video: "Video generation" };
const categories = [{ id: "text", name: "对话与推理", icon: "message" }, { id: "image", name: "图像创作", icon: "image" }, { id: "video", name: "视频生成", icon: "video" }] as const;
const familyLogos: Record<string, string> = { claude: "claude", gemini: "gemini", "gemini-image": "gemini", qwen: "qwen", flux: "flux" };
const featuredProviders = families.slice(0, 6);
const familyHref = (family: typeof families[number]) => `/models?provider=${encodeURIComponent(family.provider)}&family=${family.family}&category=${family.category}`;
const codeSamples = {
  cURL: `curl "https://tokvilo.com/api/model-catalog"`,
  Python: `import requests\n\nresponse = requests.get(\n    "https://tokvilo.com/api/model-catalog",\n    timeout=30,\n)\nresponse.raise_for_status()\nmodels = response.json()["models"]`,
  JavaScript: `const response = await fetch(\n  "https://tokvilo.com/api/model-catalog"\n);\nif (!response.ok) throw new Error("Model catalogue unavailable");\nconst { models } = await response.json();`,
};

function ModelExplorer() {
  const { t, href } = useSiteLocale();
  return <div className="landing-explorer" aria-label={t("按模型系列探索", "Explore model families")}>
    <div className="landing-explorer-head"><span><Icon name="layers" size={16} /> {t('模型系列', 'Model families')}</span><span>DISCOVER</span></div>
    {families.slice(0, 3).map(family => <Link href={href(familyHref(family))} className="landing-explorer-row" key={family.family}>
      <span className="landing-logo-tile"><ProviderLogo provider={familyLogos[family.family] || family.provider} size={30} /></span>
      <div><span className="landing-explorer-vendor">{family.vendor}</span><h2>{family.name}</h2><p>{family.tags.map(tag => t(tag, tagEnglish[tag])).join(" · ")}</p></div>
      <span className="landing-explorer-arrow"><Icon name="arrow-up-right" size={20} /></span>
    </Link>)}
    <Link href={href("/models")} className="landing-explorer-foot"><span>{t('按系列比较代际、规格与价格', 'Compare generations, specifications and prices')}</span><Icon name="arrow-right" size={15} /></Link>
  </div>;
}

export function PublicLanding() {
  const { t, href, locale } = useSiteLocale();
  const [category, setCategory] = useState<typeof categories[number]["id"]>("text");
  const [language, setLanguage] = useState<keyof typeof codeSamples>("cURL");
  const [copied, setCopied] = useState(false);
  const visibleFamilies = families.filter(family => family.category === category);

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(codeSamples[language]);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { setCopied(false); }
  }

  return <main className="public-site" lang={locale}>
    <PublicNav />
    <div className="landing-hero-stage">
      <section className="landing-hero">
        <div className="landing-hero-copy">
          <span className="landing-eyebrow"><span className="landing-brand-dot" /> TOKVILO / AI MODEL WORKSPACE</span>
          <h1>{t('选对模型，', 'Find your model.')}<br /><span>{t('让想法成形。', 'Create what’s next.')}</span></h1>
          <p>{t('按厂商和系列探索 AI 模型，比较不同代际、能力与价格。选好后进入工作台试用，或接入你的应用。', 'Explore AI models by creator and family. Compare generations, capabilities and prices, then try a model in the workspace or connect it to your app.')}</p>
          <div className="landing-hero-actions"><Link href={href("/models")} className="button button-primary">{t('探索模型', 'Explore models')} <Icon name="arrow-right" size={16} /></Link><Link href={href("/dashboard")} className="button button-secondary">{t('进入控制台', 'Open dashboard')} <Icon name="arrow-up-right" size={15} /></Link></div>
          <div className="landing-hero-note"><span>{t('公开浏览价格', 'Public pricing')}</span><i /><span>{t('按量使用 API', 'Usage-based APIs')}</span><i /><span>{t('统一账户管理', 'One workspace')}</span></div>
        </div>
        <ModelExplorer />
      </section>
    </div>

    <section className="landing-providers" aria-label={t("按模型厂商浏览", "Browse model creators")}>
      <p>{t('熟悉的模型家族，一个探索入口', 'The model families you know. One place to explore.')}</p>
      <div>{featuredProviders.map(family => <Link key={family.provider} href={href(`/models?provider=${family.provider}`)}><ProviderLogo provider={familyLogos[family.family] || family.provider} size={27} /><span>{family.name === "GPT" ? "OpenAI" : family.name}</span></Link>)}</div>
    </section>

    <section className="landing-section landing-families" id="models">
      <div className="landing-section-heading"><div><span className="landing-eyebrow">FIND YOUR MODEL</span><h2>{t('从熟悉的系列开始。', 'Start with a familiar family.')}</h2><p>{t('同一家族集中展示，不同代际并排比较。', 'Explore each family and compare its generations side by side.')}</p></div><Link className="landing-text-link" href={href("/models")}>{t('浏览全部模型', 'Browse all models')} <Icon name="arrow-up-right" size={16} /></Link></div>
      <div className="landing-tabs" aria-label={t("模型用途", "Model capabilities")}>{categories.map(item => <button type="button" key={item.id} aria-pressed={category === item.id} className={category === item.id ? "active" : ""} onClick={() => setCategory(item.id)}><Icon name={item.icon} size={15} />{t(item.name, categoryEnglish[item.id])}</button>)}</div>
      <div className="landing-family-grid">{visibleFamilies.map(family => <Link className="landing-family-card" href={href(familyHref(family))} key={`${family.provider}:${family.family}`}>
        <div className="landing-family-top"><span className="landing-logo-tile"><ProviderLogo provider={familyLogos[family.family] || family.provider} size={30} /></span><span>{family.vendor}</span><Icon name="arrow-up-right" size={18} /></div>
        <h3>{family.name}</h3><p>{t(family.description, descriptionEnglish[family.name])}</p>
        <div className="landing-family-tags">{family.tags.map(tag => <span key={tag}>{t(tag, tagEnglish[tag])}</span>)}</div>
        <div className="landing-family-bottom">{t('查看系列与各代模型', 'Explore this family')} <Icon name="arrow-right" size={15} /></div>
      </Link>)}</div>
      <p className="landing-catalog-note">{t('每个系列的模型、规格与可用状态，以模型市场展示为准。', 'See the model market for each family’s models, specifications and current availability.')}<Link href={href("/models?category=audio")}>{t('寻找音频模型', 'Explore audio models')} <Icon name="arrow-right" size={12} /></Link></p>
    </section>

    <section className="landing-section landing-journey">
      <div className="landing-section-heading"><div><span className="landing-eyebrow">FROM EXPLORATION TO CREATION</span><h2>{t('从发现，到真正用起来。', 'From discovery to your first request.')}</h2><p>{t('先选适合任务的模型，再决定如何使用。', 'Choose a model for your task, then make it part of your workflow.')}</p></div></div>
      <div className="landing-journey-grid">{[
        { step: "01", icon: "layers", title: t("找到合适的模型", "Find your model"), text: t("按厂商、系列和用途浏览，在同一视图比较不同代际。", "Browse by creator, family and task. Compare generations in one view."), href: "/models", action: t("浏览模型", "Browse models") },
        { step: "02", icon: "sliders", title: t("看价格，再试用", "Check prices, then try it"), text: t("查看模型售价与计费单位，进入对应工作台，确认金额后发起生成。", "Review the price and billing unit, open the model’s workspace, and confirm the quote before generating."), href: "/pricing", action: t("查看价格", "See pricing") },
        { step: "03", icon: "code", title: t("接入自己的应用", "Connect your application"), text: t("创建 tokvilo API 密钥，按模型文档接入，在控制台查看调用与用量。", "Create a tokvilo API key, follow the model’s documentation and track requests in your dashboard."), href: "/dashboard/docs", action: t("阅读 API 文档", "Read API docs") },
      ].map(item => <article key={item.step}><div className="landing-journey-top"><Icon name={item.icon} size={23} /><span>{item.step}</span></div><h3>{item.title}</h3><p>{item.text}</p><Link className="landing-text-link" href={href(item.href)}>{item.action}<Icon name="arrow-right" size={14} /></Link></article>)}</div>
    </section>

    <section className="landing-section landing-integration" id="integration">
      <div className="landing-integration-copy"><span className="landing-eyebrow">BUILT FOR DEVELOPERS</span><h2>{t('从一份模型目录，', 'Start with the catalogue.')}<br />{t('开始你的接入。', 'Build from there.')}</h2><p>{t('无需登录即可读取公开目录。找到需要的模型后，查看对应接口的参数、协议与调用示例。', 'Read the public catalogue without signing in. Once you find a model, check its API documentation for parameters, supported protocols and examples.')}</p><div className="landing-integration-links"><Link href={href("/dashboard/docs")} className="button button-primary">{t('查看 API 文档', 'Read API docs')} <Icon name="arrow-up-right" size={15} /></Link><Link href={href("/dashboard/keys")} className="landing-text-link">{t('管理 API 密钥', 'Manage API keys')} <Icon name="arrow-right" size={14} /></Link></div></div>
      <div className="landing-code-window"><div className="landing-code-title"><span><Icon name="terminal" size={15} /> {t('读取公开模型目录', 'Read the public catalogue')}</span><small>{t('GET · 无需 API Key', 'GET · No API key needed')}</small></div><div className="landing-code-toolbar"><div className="landing-code-tabs" aria-label={t("示例语言", "Example language")}>{(Object.keys(codeSamples) as (keyof typeof codeSamples)[]).map(item => <button type="button" key={item} className={language === item ? "active" : ""} aria-pressed={language === item} onClick={() => { setLanguage(item); setCopied(false); }}>{item}</button>)}</div><button type="button" onClick={copyCode} aria-label={copied ? t("代码已复制", "Code copied") : t("复制代码", "Copy code")}><Icon name={copied ? "check" : "copy"} size={14} /><span aria-live="polite">{copied ? t("已复制", "Copied") : t("复制", "Copy")}</span></button></div><pre><code>{codeSamples[language]}</code></pre><div className="landing-code-footer"><Icon name="info" size={13} /> {t('目录查询不产生模型调用费用；生成请求需要登录并使用相应接口。', 'Catalogue requests are free. Generation requires an account and the appropriate model endpoint.')}</div></div>
    </section>

    <section className="landing-section landing-goods"><div className="landing-goods-panel"><span className="landing-goods-icon"><Icon name="store" size={30} /></span><div><span className="landing-eyebrow">BEYOND THE API</span><h2>{t('也在寻找 AI 工具与订阅？', 'Need AI tools or subscriptions, too?')}</h2><p>{t('数字商品单独选购。填写需求表单，我们将在 24 小时内通过邮件回复，确认适用条件与交付安排。', 'Looking for subscriptions or digital products? Send an inquiry and we will reply by email within 24 hours to confirm eligibility and delivery.')}</p></div><Link className="button button-secondary" href={href("/products")}>{t('浏览数字商品', 'Browse digital products')} <Icon name="arrow-up-right" size={15} /></Link></div></section>

    <section className="landing-section landing-faq" id="faq"><div><span className="landing-eyebrow">GOOD TO KNOW</span><h2>{t('开始之前，', 'Before you begin,')}<br />{t('你可能想了解。', 'a few things to know.')}</h2><a className="landing-text-link" href="mailto:yt.feng@foxmail.com">{t('联系支持', 'Contact support')} <Icon name="arrow-up-right" size={14} /></a></div><div className="landing-faq-list">{[
      [t("怎么选择适合的模型？", "How do I choose a model?"), t("先选择对话、图像、视频或音频用途，再按厂商和模型系列浏览。同系列的不同代际集中展示，可继续查看模型规格、价格与可用状态。", "Choose chat, image, video or audio, then browse by creator and model family. Generations within a family are grouped together so you can compare specifications, prices and availability.")],
      [t("模型 API 如何收费？", "How are model API calls billed?"), t("价格页展示 tokvilo 最终售价与计费单位。调用前会预留额度，结果确认后结算，多余额度自动释放。具体金额以该次请求的报价和结算记录为准。", "The pricing page shows tokvilo’s final rates and billing units. Funds are reserved before a request and settled once the result is confirmed, with any excess released. Check each request’s quote and settlement for the exact amount.")],
      [t("如何充值并开始使用？", "How do I pay and get started?"), t("注册登录后，在余额与充值页查看可用支付方式。英文版提供 Paddle 服务用量包（开放后可购买）或企业银行转账。选择已开放的模型，在工作台确认报价后发起请求。", "Create an account and sign in to see payment availability. The English site offers Paddle usage packs when checkout is available, or enterprise bank transfers. Choose an available model and confirm the quote before submitting a request.")],
      [t("所有模型都使用相同的接口吗？", "Do all models use the same endpoint?"), t("不同模型的接口和参数可能不同。进入模型对应的工作台，或在 API 文档中查看支持的协议与请求示例后接入。", "Endpoints and parameters can vary between models. Use the model’s workspace, or check its API documentation for supported protocols and request examples.")],
      [t("数字商品如何购买？", "How do I buy a digital product?"), t("在数字商品页查看参考售价并填写需求表单。我们会在 24 小时内通过邮件回复，确认库存、适用条件与交付安排。", "Review the indicative price on the Digital Products page and submit an inquiry. We will reply by email within 24 hours to confirm availability, eligibility and delivery.")],
    ].map(([question, answer]) => <details key={question}><summary>{question}<Icon name="plus" size={17} /></summary><p>{answer}</p></details>)}</div></section>

    <section className="landing-cta"><span className="landing-eyebrow">YOUR NEXT IDEA STARTS HERE</span><h2>{t('下一次创作，从选对模型开始。', 'Your next idea starts with the right model.')}</h2><p>{t('浏览模型家族，找到适合你的那一个。', 'Explore model families and find your fit.')}</p><div><Link className="button button-primary" href={href("/models")}>{t('探索模型', 'Explore models')} <Icon name="arrow-right" size={16} /></Link><Link className="button button-secondary" href={href("/register")}>{t('创建账户', 'Create an account')}</Link></div></section>

    <footer className="public-footer"><div className="public-footer-top"><div className="public-footer-brand"><Link href={href("/")} aria-label={t("tokvilo 首页", "tokvilo home")}><Brand /></Link><p>{t('发现模型，连接创造。', 'Discover models. Build ideas.')}<br />{t('你的 AI 模型工作空间。', 'Your AI model workspace.')}</p></div><div><h3>{t('探索', 'Explore')}</h3><Link href={href("/models")}>{t('模型市场', 'Model market')}</Link><Link href={href("/pricing")}>{t('价格', 'Pricing')}</Link><Link href={href("/products")}>{t('数字商品', 'Digital products')}</Link></div><div><h3>{t('开发者', 'Developers')}</h3><Link href={href("/dashboard/docs")}>{t('API 文档', 'API docs')}</Link><Link href={href("/#integration")}>{t('接入指南', 'Quick start')}</Link><Link href={href("/dashboard/keys")}>{t('API 密钥', 'API keys')}</Link></div><div><h3>{t('工作空间', 'Workspace')}</h3><Link href={href("/dashboard")}>{t('控制台', 'Dashboard')}</Link><a href={href("/dashboard/wallet")}>{t('余额与充值', 'Balance & top up')}</a><Link href={href("/dashboard/usage")}>{t('调用记录', 'Request history')}</Link></div><div><h3>{t('帮助', 'Help')}</h3><Link href={href("/#faq")}>{t('常见问题', 'FAQs')}</Link><Link href={href("/forgot-password")}>{t('找回密码', 'Reset password')}</Link><a href="mailto:yt.feng@foxmail.com">{t('联系支持', 'Contact support')}</a></div></div><LegalLinks /><div className="public-footer-bottom"><span>© {new Date().getFullYear()} tokvilo</span><span>{t('模型标识用于识别产品；tokvilo 为独立服务商。', 'Model logos identify their products. tokvilo is an independent service.')}</span><span>{t('简体中文', 'English')}</span></div></footer>
  </main>;
}
