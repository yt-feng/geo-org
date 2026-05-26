#!/usr/bin/env python3
"""Apply authority-site standards to the static Eco GEO site."""
from __future__ import annotations

import html
import json
import os
import re
from datetime import date
from pathlib import Path
from typing import Dict, Iterable, List, Mapping

import i18n_site

SITE_URL = os.environ.get("SITE_URL", "https://eco-geo.org").rstrip("/")
EMAIL = "yt.feng@foxmail.com"
AUTHOR_NAME = "Eco GEO Editorial Team"
AUTHOR_INITIALS = "EGE"
REVIEWER_NAME = "Eco GEO Research Desk"
TITLE_PREFIX = "Eco-GEO："
TODAY = date.today().isoformat()

LANG = {
    "zh": {
        "html_lang": "zh-CN",
        "dir": "ltr",
        "why": "为什么",
        "method": "方法",
        "audit": "品牌评测",
        "credentials": "服务品牌",
        "blog": "前沿观点",
        "contact": "联系",
        "home": "首页",
        "about": "关于",
        "editorial": "编辑政策",
        "privacy": "隐私",
        "terms": "条款",
        "trust": "可信标准",
        "cta_title": "AIBE 初诊",
        "cta_body": "检查你的品牌在 AI 答案里的可见度与引用风险",
        "cta_link": "邮件咨询",
    },
    "en": {
        "html_lang": "en",
        "dir": "ltr",
        "why": "Why",
        "method": "Method",
        "audit": "Brand audit",
        "credentials": "Credentials",
        "blog": "Insights",
        "contact": "Contact",
        "home": "Home",
        "about": "About",
        "editorial": "Editorial policy",
        "privacy": "Privacy",
        "terms": "Terms",
        "trust": "Trust standard",
        "cta_title": "AIBE quick check",
        "cta_body": "Check your brand visibility and citation risks in AI answers",
        "cta_link": "Email us",
    },
    "ar": {
        "html_lang": "ar",
        "dir": "rtl",
        "why": "لماذا",
        "method": "المنهج",
        "audit": "تقييم العلامة",
        "credentials": "الخبرات",
        "blog": "الرؤى",
        "contact": "تواصل",
        "home": "الرئيسية",
        "about": "حول Eco GEO",
        "editorial": "سياسة التحرير",
        "privacy": "الخصوصية",
        "terms": "الشروط",
        "trust": "معيار الثقة",
        "cta_title": "فحص AIBE أولي",
        "cta_body": "افحص ظهور علامتك ومخاطر الاقتباس داخل إجابات الذكاء الاصطناعي",
        "cta_link": "راسلنا",
    },
}

TRUST_PAGES = {
    "about": {
        "zh": {
            "title": "关于 Eco GEO",
            "lead": "Eco GEO 是面向品牌负责人、增长负责人和内容团队的品牌化 GEO 咨询与研究站点，帮助品牌在 AI 搜索与生成式答案中被正确理解、可信引用、稳定推荐。",
            "sections": [
                ("我们做什么", ["我们围绕 AIBE、品牌化 GEO、可信知识网络、AI 搜索可见性和多语言品牌表达建立内容与诊断工具。", "网站内容服务于一个清晰边界：品牌如何成为 AI 和搜索系统愿意引用的可信信息源。"]),
                ("为什么可信", ["Eco GEO 的文章会标注作者角色、审核角色、发布日期、更新日期和可验证来源。涉及时事、政策、价格、法律、版本信息时，优先引用公开来源。", "我们不购买链接、不采集伪原创、不发布隐藏指令，也不把 AI 辅助内容伪装成亲身经验。"]),
                ("联系方式", [f"正式咨询、纠错或来源补充请联系 {EMAIL}。"]),
            ],
        },
        "en": {
            "title": "About Eco GEO",
            "lead": "Eco GEO helps brand, growth, and content teams become understandable, citable, and recommendable in AI search and generative answers.",
            "sections": [
                ("What We Do", ["We focus on AIBE, Brand GEO, trusted knowledge networks, AI search visibility, and multilingual brand expression.", "The site has one content boundary: how brands become trustworthy information sources for AI and search systems."]),
                ("Why Trust Us", ["Articles show editorial responsibility, publication dates, review roles, and source policies. Current events and factual claims are tied to public sources whenever possible.", "We do not buy links, scrape and spin content, publish hidden prompts, or disguise AI-assisted content as personal experience."]),
                ("Contact", [f"For consultation, corrections, or source updates, email {EMAIL}."]),
            ],
        },
        "ar": {
            "title": "حول Eco GEO",
            "lead": "تساعد Eco GEO فرق العلامة والنمو والمحتوى على أن تصبح مفهومة وقابلة للاقتباس والتوصية داخل بحث الذكاء الاصطناعي والإجابات التوليدية.",
            "sections": [
                ("ما الذي نفعله", ["نركز على AIBE وBrand GEO وشبكات المعرفة الموثوقة وظهور العلامة في بحث الذكاء الاصطناعي والتعبير متعدد اللغات.", "حدود المحتوى واضحة: كيف تصبح العلامة مصدرا موثوقا يمكن للذكاء الاصطناعي والبحث الاستناد إليه."]),
                ("لماذا يمكن الوثوق بنا", ["توضح المقالات مسؤولية التحرير وتاريخ النشر ودور المراجعة وسياسة المصادر. عند تناول أخبار أو حقائق متغيرة نعتمد على مصادر عامة قابلة للتحقق.", "لا نشتري الروابط، ولا نعيد صياغة محتوى مجمعا، ولا ننشر تعليمات مخفية للنماذج، ولا نقدم المحتوى المساعد بالذكاء الاصطناعي كتجربة شخصية."]),
                ("التواصل", [f"للاستشارة أو التصحيح أو تحديث المصادر: {EMAIL}."]),
            ],
        },
    },
    "editorial-policy": {
        "zh": {
            "title": "Eco GEO 编辑政策",
            "lead": "这份政策说明 Eco GEO 如何选题、写作、审核、引用来源和更新内容。",
            "sections": [
                ("选题边界", ["只发布与品牌化 GEO、AI 搜索、AIBE、可信知识网络、内容资产和品牌可引用性相关的内容。", "每日文章必须指向明确读者和搜索意图，不能只为日更而发布通用复述。"]),
                ("来源与事实核查", ["重要事实、数据、政策、价格、版本、新闻事件会优先引用公开来源，并在正文或来源区标注。", "没有可靠来源时，文章只能表达方法判断或评论，不会伪装成事实报道。"]),
                ("AI 辅助披露", ["Eco GEO 可以使用 AI 辅助起草、翻译、整理结构或生成多语言版本，但最终内容需要由 Eco GEO Editorial Team 负责审核。", "AI 不会被用于伪造第一手经验、客户案例、数据或不存在的来源。"]),
                ("更新与纠错", ["发现事实错误、过时表述或来源失效时，会优先更新重要页面。重大更新会体现在页面日期、sitemap lastmod 或正文说明中。", f"纠错请发送邮件至 {EMAIL}。"]),
            ],
        },
        "en": {
            "title": "Eco GEO Editorial Policy",
            "lead": "How Eco GEO selects topics, writes, reviews, cites sources, and updates content.",
            "sections": [
                ("Topic Boundary", ["We publish within Brand GEO, AI search, AIBE, trusted knowledge networks, content assets, and brand citability.", "Daily articles must serve a clear reader and search intent; generic updates are not enough."]),
                ("Sources and Review", ["Important facts, data, policies, prices, versions, and news events should cite public sources in the article or source section.", "When reliable sources are unavailable, the article is framed as method analysis or commentary, not factual reporting."]),
                ("AI Assistance", ["AI may assist drafting, translation, structure, and multilingual versions. Eco GEO Editorial Team remains responsible for final review.", "AI is not used to fabricate personal experience, customer cases, data, or nonexistent sources."]),
                ("Corrections", [f"Corrections and source updates can be sent to {EMAIL}. Significant updates are reflected in page dates, sitemap lastmod, or article notes."]),
            ],
        },
        "ar": {
            "title": "سياسة تحرير Eco GEO",
            "lead": "كيف تختار Eco GEO الموضوعات وتكتب وتراجع وتوثق المصادر وتحدث المحتوى.",
            "sections": [
                ("حدود الموضوع", ["ننشر ضمن Brand GEO وبحث الذكاء الاصطناعي وAIBE وشبكات المعرفة الموثوقة وأصول المحتوى وقابلية العلامة للاقتباس.", "يجب أن تخدم المقالات اليومية قارئا ونية بحث واضحة، ولا يكفي إنتاج محتوى عام لمجرد التحديث."]),
                ("المصادر والمراجعة", ["الحقائق المهمة والبيانات والسياسات والأسعار والإصدارات والأخبار يجب أن ترتبط بمصادر عامة داخل المقال أو قسم المصادر.", "عند غياب مصدر موثوق، يعرض المقال تحليلا أو رأيا منهجيا ولا يقدمه كخبر مؤكد."]),
                ("استخدام الذكاء الاصطناعي", ["قد يساعد الذكاء الاصطناعي في المسودة والترجمة والتنظيم والنسخ متعددة اللغات، لكن Eco GEO Editorial Team مسؤولة عن المراجعة النهائية.", "لا نستخدم الذكاء الاصطناعي لاختلاق تجربة شخصية أو حالات عملاء أو بيانات أو مصادر غير موجودة."]),
                ("التصحيح", [f"يمكن إرسال التصحيحات أو تحديثات المصادر إلى {EMAIL}."]),
            ],
        },
    },
    "privacy": {
        "zh": {"title": "隐私政策", "lead": "Eco GEO 当前是静态展示站点，不主动收集表单数据。", "sections": [("数据收集", ["品牌评测 Demo 在浏览器端运行，不上传输入内容。邮件咨询会通过你的邮件客户端发送给我们。"]), ("第三方资源", ["站点可能加载 Unsplash 图片和 GitHub Pages 托管资源；这些第三方可能依据自身政策处理访问日志。"]), ("联系", [f"隐私相关问题请联系 {EMAIL}。"])]},
        "en": {"title": "Privacy Policy", "lead": "Eco GEO is currently a static site and does not submit audit-demo inputs to a server.", "sections": [("Data Collection", ["The brand audit demo runs in the browser. Email consultation is sent through your email client."]), ("Third Parties", ["The site may load Unsplash images and GitHub Pages assets; those services may process access logs under their own policies."]), ("Contact", [f"Privacy questions: {EMAIL}."])]},
        "ar": {"title": "سياسة الخصوصية", "lead": "Eco GEO موقع ثابت حاليا ولا يرسل مدخلات تجربة التقييم إلى خادم.", "sections": [("جمع البيانات", ["تعمل تجربة تقييم العلامة داخل المتصفح. يتم إرسال الاستشارة عبر عميل البريد الخاص بك."]), ("أطراف ثالثة", ["قد يحمل الموقع صور Unsplash وموارد GitHub Pages، وقد تعالج تلك الخدمات سجلات الوصول وفق سياساتها."]), ("التواصل", [f"أسئلة الخصوصية: {EMAIL}."])]},
    },
    "terms": {
        "zh": {"title": "使用条款与免责声明", "lead": "Eco GEO 内容用于品牌化 GEO、AI 搜索和内容策略参考，不构成法律、财务、医疗或投资建议。", "sections": [("内容边界", ["文章和工具输出是研究与咨询视角下的建议，正式决策应结合你的行业、法务和业务上下文。"]), ("商业关系披露", ["如未来出现赞助、联盟或付费推荐内容，Eco GEO 会在相关页面清楚披露。"]), ("责任限制", ["我们会努力维护内容准确性，但不保证所有第三方信息永远最新。"])]},
        "en": {"title": "Terms and Disclaimer", "lead": "Eco GEO content is for Brand GEO, AI search, and content strategy reference. It is not legal, financial, medical, or investment advice.", "sections": [("Scope", ["Articles and tool outputs are research and consulting references. Decisions should consider your legal, industry, and business context."]), ("Commercial Disclosure", ["Sponsored, affiliate, or paid recommendation content will be disclosed clearly if introduced."]), ("Limitations", ["We work to keep content accurate but cannot guarantee that third-party information remains current forever."])]},
        "ar": {"title": "الشروط وإخلاء المسؤولية", "lead": "محتوى Eco GEO مرجع لاستراتيجية Brand GEO وبحث الذكاء الاصطناعي والمحتوى، وليس نصيحة قانونية أو مالية أو طبية أو استثمارية.", "sections": [("النطاق", ["المقالات ومخرجات الأدوات مراجع بحثية واستشارية. يجب اتخاذ القرارات وفق سياقك القانوني والصناعي والتجاري."]), ("الإفصاح التجاري", ["إذا ظهر محتوى ممول أو روابط عمولة أو توصيات مدفوعة فسيتم الإفصاح عنها بوضوح."]), ("الحدود", ["نسعى إلى دقة المحتوى لكن لا نضمن بقاء معلومات الطرف الثالث محدثة دائما."])]},
    },
    "contact": {
        "zh": {"title": "联系 Eco GEO", "lead": "如果你希望做 AIBE 初诊、品牌化 GEO 路线图、AI 搜索可见性复盘或内容资产审计，可以通过邮件联系。", "sections": [("邮件", [EMAIL]), ("适合发送的信息", ["品牌名、官网、目标市场、你关心的 AI 搜索问题、希望优化的语言版本。"]), ("纠错与来源补充", ["如果你发现文章事实错误、来源失效或需要更新，也请通过邮件说明具体 URL 和证据。"])]},
        "en": {"title": "Contact Eco GEO", "lead": "For AIBE diagnosis, Brand GEO roadmaps, AI search visibility reviews, or content audits, email us.", "sections": [("Email", [EMAIL]), ("Useful Context", ["Brand name, website, target market, AI search questions, and target languages."]), ("Corrections", ["For factual corrections or source updates, include the URL and evidence."])]},
        "ar": {"title": "تواصل مع Eco GEO", "lead": "للتشخيص الأولي AIBE أو خارطة Brand GEO أو مراجعة الظهور في بحث الذكاء الاصطناعي أو تدقيق أصول المحتوى، راسلنا.", "sections": [("البريد", [EMAIL]), ("معلومات مفيدة", ["اسم العلامة، الموقع، السوق المستهدف، أسئلة بحث الذكاء الاصطناعي، واللغات المطلوبة."]), ("التصحيحات", ["للتصحيح أو تحديث المصادر، أرسل الرابط والدليل."])]},
    },
}

HUBS = {
    "brand-geo": {
        "terms": ["品牌化GEO", "Brand GEO", "GEO服务", "白帽GEO"],
        "zh": ("品牌化 GEO 主题中心", "从定位、事实链、引用资产到 AI 推荐语境，系统理解品牌化 GEO。"),
        "en": ("Brand GEO Hub", "A practical hub for Brand GEO, trusted facts, citation assets, and AI search visibility."),
        "ar": ("مركز Brand GEO", "مركز عملي لفهم Brand GEO والحقائق الموثوقة وأصول الاقتباس وظهور العلامة في بحث الذكاء الاصطناعي."),
    },
    "aibe": {
        "terms": ["AIBE", "AI 品牌认知", "品牌认知资产", "可见度"],
        "zh": ("AIBE 诊断主题中心", "理解 AI 品牌认知资产如何诊断、度量、修复和复盘。"),
        "en": ("AIBE Diagnosis Hub", "How to diagnose, measure, repair, and review AI brand perception assets."),
        "ar": ("مركز تشخيص AIBE", "كيفية تشخيص وقياس وإصلاح ومراجعة أصول إدراك العلامة داخل الذكاء الاصطناعي."),
    },
    "ai-search-visibility": {
        "terms": ["AI搜索", "AI 搜索", "ChatGPT", "Google AI", "Perplexity", "可引用"],
        "zh": ("AI 搜索可见性主题中心", "围绕 ChatGPT、Google AI、Perplexity 等答案场景，提升品牌可见度与可引用性。"),
        "en": ("AI Search Visibility Hub", "Improve brand visibility and citability across ChatGPT, Google AI, Perplexity, and answer engines."),
        "ar": ("مركز الظهور في بحث الذكاء الاصطناعي", "تحسين ظهور العلامة وقابليتها للاقتباس داخل ChatGPT وGoogle AI وPerplexity ومحركات الإجابة."),
    },
}


def esc(value: object) -> str:
    return html.escape(str(value or ""), quote=True)


def read_json(path: Path, default: object) -> object:
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def ensure_title_prefix(title: object) -> str:
    text = str(title or "").strip()
    if text.startswith(TITLE_PREFIX):
        return text
    text = re.sub(r"^Eco[- ]GEO[：:]\s*", "", text, flags=re.IGNORECASE)
    return f"{TITLE_PREFIX}{text}" if text else TITLE_PREFIX.rstrip("：")


def write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def lang_base(prefix: str, lang: str) -> str:
    return prefix if lang == "zh" else f"{prefix}{lang}/"


def language_switcher(prefix: str, active: str, suffix: str) -> str:
    zh_href = f"{prefix}{suffix}"
    en_href = f"{prefix}en/{suffix}"
    ar_href = f"{prefix}ar/{suffix}"
    return (
        '<div class="lang-switcher" aria-label="Language selector">'
        f"{i18n_site.GLOBE_SVG}"
        f'<a class="{"active" if active == "zh" else ""}" href="{esc(zh_href)}">中</a>'
        f'<a class="{"active" if active == "en" else ""}" href="{esc(en_href)}">EN</a>'
        f'<a class="{"active" if active == "ar" else ""}" href="{esc(ar_href)}" dir="rtl">ع</a>'
        "</div>"
    )


def header(prefix: str, lang: str, suffix: str) -> str:
    cfg = LANG[lang]
    base = lang_base(prefix, lang)
    return (
        '<header class="top site-header"><nav class="wrap site-nav">'
        f'<a class="brand site-brand" href="{base}index.html#top"><img src="{prefix}logo.svg" alt="Eco GEO logo"/>'
        '<span>ECO GEO<small>Brand-first GEO</small></span></a>'
        '<div class="links navlinks site-links">'
        f'<a href="{base}index.html#why">{cfg["why"]}</a>'
        f'<a href="{base}index.html#method">{cfg["method"]}</a>'
        f'<a href="{base}brand-audit/">{cfg["audit"]}</a>'
        f'<a href="{base}index.html#credentials">{cfg["credentials"]}</a>'
        f'<a class="nav-cta nav-insights" href="{base}blog/">{cfg["blog"]}</a>'
        f'<a class="nav-cta" href="{base}contact/">{cfg["contact"]}</a>'
        "</div>"
        f"{language_switcher(prefix, lang, suffix)}</nav></header>"
    )


def footer(prefix: str, lang: str) -> str:
    cfg = LANG[lang]
    base = lang_base(prefix, lang)
    return (
        '<footer class="footer site-footer"><div class="wrap">'
        f'© 2026 Eco GEO · Brand-first GEO · <a href="{base}index.html">{cfg["home"]}</a> · '
        f'<a href="{base}blog/">{cfg["blog"]}</a> · <a href="{base}about/">{cfg["about"]}</a> · '
        f'<a href="{base}editorial-policy/">{cfg["editorial"]}</a> · <a href="{base}privacy/">{cfg["privacy"]}</a> · '
        f'<a href="{base}terms/">{cfg["terms"]}</a> · <a href="{base}contact/">{cfg["contact"]}</a>'
        "</div></footer>"
    )


def bottom_cta(lang: str) -> str:
    cfg = LANG[lang]
    return (
        '<div class="bottom-cta" role="region" aria-label="Eco GEO contact">'
        '<div class="wrap bottom-cta-inner"><div class="bottom-cta-text">'
        f'<strong>{cfg["cta_title"]}</strong><span>{cfg["cta_body"]}</span></div>'
        f'<a href="mailto:{EMAIL}?subject=Eco%20GEO%20AIBE%20Consultation">{cfg["cta_link"]}</a>'
        "</div></div>"
    )


def page_prefix(lang: str, suffix: str) -> str:
    depth = len(Path(suffix).parts)
    if lang != "zh":
        depth += 1
    return "../" * depth


def page_path(lang: str, suffix: str) -> Path:
    return Path(suffix) / "index.html" if lang == "zh" else Path(lang) / suffix / "index.html"


def canonical_for(lang: str, suffix: str) -> str:
    return f"{SITE_URL}/{suffix}" if lang == "zh" else f"{SITE_URL}/{lang}/{suffix}"


def page_schema(url: str, title: str, description: str, lang: str, page_type: str = "WebPage") -> str:
    graph = [
        {
            "@type": "Organization",
            "@id": f"{SITE_URL}/#organization",
            "name": "Eco GEO",
            "url": f"{SITE_URL}/",
            "logo": f"{SITE_URL}/logo.svg",
            "email": EMAIL,
        },
        {
            "@type": page_type,
            "@id": f"{url}#webpage",
            "url": url,
            "name": title,
            "description": description,
            "inLanguage": LANG[lang]["html_lang"],
            "isPartOf": {"@id": f"{SITE_URL}/#website"},
            "publisher": {"@id": f"{SITE_URL}/#organization"},
        },
    ]
    return json.dumps({"@context": "https://schema.org", "@graph": graph}, ensure_ascii=False, separators=(",", ":"))


def css() -> str:
    return (
        i18n_site.base_css()
        + ".prose{max-width:880px;padding:58px 0 86px}.prose h1{font-size:clamp(36px,5vw,66px)}"
        ".prose h2{font-size:28px;line-height:1.2;margin:34px 0 10px}.prose p,.prose li{color:var(--muted);font-size:18px}"
        ".prose ul{padding-inline-start:24px}.facts{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin:28px 0}"
        ".fact{border:1px solid var(--line);border-radius:24px;background:var(--panel);padding:18px}.fact strong{display:block;color:var(--text)}"
        ".hub-list{display:grid;grid-template-columns:repeat(2,1fr);gap:16px;margin-top:24px}.hub-card{border:1px solid var(--line);border-radius:24px;background:var(--panel);padding:18px;text-decoration:none}"
        ".hub-card small{color:var(--green);font-weight:900}.hub-card h3{margin:8px 0 8px;line-height:1.25}.hub-card p{font-size:15px;margin:0}"
        "@media(max-width:800px){.facts,.hub-list{grid-template-columns:1fr}}"
    )


def render_static_page(lang: str, slug: str, data: Mapping[str, object]) -> str:
    prefix = page_prefix(lang, f"{slug}/")
    title = str(data["title"])
    lead = str(data["lead"])
    sections = data["sections"]
    section_html = "".join(
        "<section><h2>{}</h2>{}</section>".format(
            esc(heading),
            "".join(f"<p>{esc(paragraph)}</p>" for paragraph in paragraphs),
        )
        for heading, paragraphs in sections
    )
    canonical = canonical_for(lang, f"{slug}/")
    return f"""<!doctype html>
<html lang="{LANG[lang]['html_lang']}" dir="{LANG[lang]['dir']}"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<meta name="description" content="{esc(lead)}"/><link rel="icon" href="{prefix}logo.svg" type="image/svg+xml"/><link rel="canonical" href="{canonical}"/>
<title>{esc(title)}｜Eco GEO</title><style>{css()}</style><script id="schema-page" type="application/ld+json">{page_schema(canonical, title, lead, lang)}</script></head>
<body>{header(prefix, lang, f"{slug}/")}<main class="wrap prose"><div class="eyebrow">{esc(LANG[lang]['trust'])}</div><h1>{esc(title)}</h1><p class="lead">{esc(lead)}</p><div class="facts"><div class="fact"><strong>Eco GEO</strong><span>Brand-first GEO</span></div><div class="fact"><strong>{esc(AUTHOR_NAME)}</strong><span>Editorial owner</span></div><div class="fact"><strong>{esc(REVIEWER_NAME)}</strong><span>Review desk</span></div></div>{section_html}</main>{bottom_cta(lang)}{footer(prefix, lang)}</body></html>"""


def select_posts(posts: Iterable[Mapping[str, str]], terms: Iterable[str], limit: int = 12) -> List[Mapping[str, str]]:
    needle = [term.lower() for term in terms]
    selected = []
    for post in posts:
        hay = " ".join(str(post.get(k, "")) for k in ("title", "excerpt", "tags", "category")).lower()
        if any(term.lower() in hay for term in needle):
            selected.append(post)
        if len(selected) >= limit:
            break
    return selected


def render_hub_page(lang: str, slug: str, posts: List[Mapping[str, str]]) -> str:
    title, lead = HUBS[slug][lang]
    suffix = f"resources/{slug}/"
    prefix = page_prefix(lang, suffix)
    canonical = canonical_for(lang, suffix)
    if posts:
        cards = "".join(
            f'<a class="hub-card" href="{prefix}blog/articles/{esc(post.get("slug"))}/"><small>{esc(post.get("category"))}</small><h3>{esc(post.get("title"))}</h3><p>{esc(post.get("excerpt"))}</p></a>'
            for post in posts
        )
    else:
        cards = f'<a class="hub-card" href="{lang_base(prefix, lang)}blog/"><small>Eco GEO</small><h3>{esc(LANG[lang]["blog"])}</h3><p>{esc(lead)}</p></a>'
    return f"""<!doctype html>
<html lang="{LANG[lang]['html_lang']}" dir="{LANG[lang]['dir']}"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<meta name="description" content="{esc(lead)}"/><link rel="icon" href="{prefix}logo.svg" type="image/svg+xml"/><link rel="canonical" href="{canonical}"/>
<title>{esc(title)}｜Eco GEO</title><style>{css()}</style><script id="schema-page" type="application/ld+json">{page_schema(canonical, title, lead, lang, "CollectionPage")}</script></head>
<body>{header(prefix, lang, suffix)}<main class="wrap prose"><div class="eyebrow">Topical Hub</div><h1>{esc(title)}</h1><p class="lead">{esc(lead)}</p>
<section><h2>Eco GEO framework</h2><ul><li>Define the entity, audience, and answer scenarios.</li><li>Build consistent facts, source chains, and internal links.</li><li>Refresh articles with current evidence and clear editorial responsibility.</li></ul></section>
<section><h2>{esc(LANG[lang]["blog"])}</h2><div class="hub-list">{cards}</div></section></main>{bottom_cta(lang)}{footer(prefix, lang)}</body></html>"""


def generate_authority_pages(root: Path = Path(".")) -> None:
    zh_posts = read_json(root / "blog" / "posts.json", [])
    for slug, copies in TRUST_PAGES.items():
        for lang in ("zh", "en", "ar"):
            write_text(root / page_path(lang, f"{slug}/"), render_static_page(lang, slug, copies[lang]))

    for slug, hub in HUBS.items():
        selected = select_posts(zh_posts, hub["terms"])
        for lang in ("zh", "en", "ar"):
            write_text(root / page_path(lang, f"resources/{slug}/"), render_hub_page(lang, slug, selected if lang == "zh" else []))


def root_prefix_for_html(path: Path) -> str:
    parts = path.parent.parts
    return "../" * len(parts)


def lang_for_path(path: Path) -> str:
    first = path.parts[0] if path.parts else ""
    return first if first in ("en", "ar") else "zh"


def suffix_for_path(path: Path) -> str:
    if path.name != "index.html":
        return path.as_posix()
    parent = path.parent.as_posix()
    if parent == ".":
        return ""
    if parent in ("en", "ar"):
        return f"{parent}/"
    return f"{parent}/"


def canonical_for_path(path: Path) -> str:
    return f"{SITE_URL}/{suffix_for_path(path)}"


def content_suffix_for_path(path: Path) -> str:
    suffix = suffix_for_path(path)
    if suffix.startswith("en/") or suffix.startswith("ar/"):
        return suffix.split("/", 1)[1]
    return suffix


def path_for_lang_suffix(lang: str, suffix: str) -> Path:
    if suffix == "":
        return Path("index.html") if lang == "zh" else Path(lang) / "index.html"
    return Path(suffix) / "index.html" if lang == "zh" else Path(lang) / suffix / "index.html"


def alternate_links(root: Path, path: Path) -> str:
    if path.name == "404.html":
        return ""
    suffix = content_suffix_for_path(path)
    links = []
    for code, hreflang in (("zh", "zh-CN"), ("en", "en"), ("ar", "ar")):
        target = root / path_for_lang_suffix(code, suffix)
        if not target.exists():
            continue
        href = f"{SITE_URL}/{suffix}" if code == "zh" else f"{SITE_URL}/{code}/{suffix}"
        links.append(f'<link rel="alternate" hreflang="{hreflang}" href="{href}"/>')
    zh_target = root / path_for_lang_suffix("zh", suffix)
    if zh_target.exists():
        links.append(f'<link rel="alternate" hreflang="x-default" href="{SITE_URL}/{suffix}"/>')
    return "".join(links)


def fallback_suffix(suffix: str) -> str:
    if suffix.startswith("blog/"):
        return "blog/"
    if suffix.startswith("brand-audit/"):
        return "brand-audit/"
    return ""


def relative_lang_href(root: Path, path: Path, target_lang: str) -> str:
    prefix = root_prefix_for_html(path)
    suffix = content_suffix_for_path(path)
    target_suffix = suffix if (root / path_for_lang_suffix(target_lang, suffix)).exists() else fallback_suffix(suffix)
    if target_lang == "zh":
        return f"{prefix}{target_suffix}" if target_suffix else f"{prefix}index.html"
    return f"{prefix}{target_lang}/{target_suffix}"


def language_switcher_for_path(root: Path, path: Path) -> str:
    active = lang_for_path(path)
    return (
        '<div class="lang-switcher" aria-label="Language selector">'
        f"{i18n_site.GLOBE_SVG}"
        f'<a class="{"active" if active == "zh" else ""}" href="{esc(relative_lang_href(root, path, "zh"))}">中</a>'
        f'<a class="{"active" if active == "en" else ""}" href="{esc(relative_lang_href(root, path, "en"))}">EN</a>'
        f'<a class="{"active" if active == "ar" else ""}" href="{esc(relative_lang_href(root, path, "ar"))}" dir="rtl">ع</a>'
        "</div>"
    )


def clean_ld_json(text: str) -> str:
    text = re.sub(r'\s*<script[^>]*type="application/ld\+json"[^>]*>.*?</script>', "", text, flags=re.S)
    text = re.sub(r'\s*<link rel="canonical" href="[^"]*"\s*/?>', "", text)
    text = re.sub(r'\s*<link rel="alternate" hreflang="[^"]+" href="[^"]*"\s*/?>', "", text)
    text = re.sub(r'\s*<meta name="author" content="[^"]*"\s*/?>', "", text)
    return text


def add_head_authority(
    text: str,
    path: Path,
    root: Path,
    posts_by_lang: Mapping[str, Mapping[str, Mapping[str, str]]],
) -> str:
    text = clean_ld_json(text)
    canonical = canonical_for_path(path)
    canonical_tag = f'<link rel="canonical" href="{canonical}"/>'
    alternates = alternate_links(root, path)
    author_tag = f'<meta name="author" content="{esc(AUTHOR_NAME)}"/>'
    slug = path.parent.name if "articles" in path.parts else ""
    lang = lang_for_path(path)
    posts_by_slug = posts_by_lang.get(lang, {})
    if slug and slug in posts_by_slug:
        post = posts_by_slug[slug]
        schema = article_schema(canonical, post, lang)
        insert = f'{canonical_tag}{alternates}{author_tag}<script id="schema-article" type="application/ld+json">{schema}</script>'
    else:
        title = find_between(text, "<title>", "</title>").replace("｜Eco GEO", "").strip() or "Eco GEO"
        description = find_meta_description(text) or "Eco GEO Brand-first GEO site."
        schema = page_schema(canonical, title, description, lang)
        insert = f'{canonical_tag}{alternates}<script id="schema-page" type="application/ld+json">{schema}</script>'
    return text.replace("</head>", f"{insert}</head>", 1)


def find_between(text: str, start: str, end: str) -> str:
    s = text.find(start)
    if s < 0:
        return ""
    s += len(start)
    e = text.find(end, s)
    return text[s:e] if e >= 0 else ""


def find_meta_description(text: str) -> str:
    m = re.search(r'<meta name="description" content="([^"]*)"', text)
    return html.unescape(m.group(1)) if m else ""


def article_schema(url: str, post: Mapping[str, str], lang: str) -> str:
    date_published = post.get("date") or TODAY
    obj = {
        "@context": "https://schema.org",
        "@type": "BlogPosting",
        "mainEntityOfPage": {"@type": "WebPage", "@id": url},
        "headline": post.get("title", "Eco GEO insight"),
        "description": post.get("excerpt", ""),
        "image": post.get("image") or f"{SITE_URL}/logo.svg",
        "datePublished": date_published,
        "dateModified": post.get("dateModified") or date_published,
        "inLanguage": LANG[lang]["html_lang"],
        "author": {"@type": "Organization", "name": AUTHOR_NAME, "url": f"{SITE_URL}/about/"},
        "editor": {"@type": "Organization", "name": REVIEWER_NAME, "url": f"{SITE_URL}/editorial-policy/"},
        "publisher": {"@type": "Organization", "name": "Eco GEO", "logo": {"@type": "ImageObject", "url": f"{SITE_URL}/logo.svg"}},
        "keywords": post.get("tags", ""),
    }
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":"))


def trust_link_html(path: Path) -> str:
    prefix = root_prefix_for_html(path)
    lang = lang_for_path(path)
    base = lang_base(prefix, lang)
    cfg = LANG[lang]
    return (
        f' · <a href="{base}about/">{cfg["about"]}</a>'
        f' · <a href="{base}editorial-policy/">{cfg["editorial"]}</a>'
        f' · <a href="{base}privacy/">{cfg["privacy"]}</a>'
        f' · <a href="{base}terms/">{cfg["terms"]}</a>'
        f' · <a href="{base}contact/">{cfg["contact"]}</a>'
    )


def patch_footer(text: str, path: Path) -> str:
    if "editorial-policy/" in text[text.rfind("<footer") :]:
        return text
    m = re.search(r'(<footer class="footer site-footer"><div class="wrap">)(.*?)(</div></footer>)', text, flags=re.S)
    if not m:
        return text
    content = m.group(2)
    if "editorial-policy/" not in content:
        content += trust_link_html(path)
    return text[: m.start(2)] + content + text[m.end(2) :]


def patch_contact_nav(text: str, path: Path) -> str:
    prefix = root_prefix_for_html(path)
    lang = lang_for_path(path)
    contact_url = f"{lang_base(prefix, lang)}contact/"
    label = re.escape(LANG[lang]["contact"])
    return re.sub(
        rf'(<a class="nav-cta" href=")mailto:[^"]*(">{label}</a>)',
        rf"\1{contact_url}\2",
        text,
    )


def patch_language_switcher(text: str, root: Path, path: Path) -> str:
    switcher = language_switcher_for_path(root, path)
    if 'class="lang-switcher"' in text:
        return re.sub(
            r'<div class="lang-switcher" aria-label="Language selector">.*?</div>',
            switcher,
            text,
            count=1,
            flags=re.S,
        )
    return text


def patch_article_authority(text: str, path: Path) -> str:
    if "articles" not in path.parts:
        return text
    text = re.sub(r"<strong>[^<]+</strong><br/><span>", f"<strong>{AUTHOR_NAME}</strong><br/><span>", text, count=1)
    text = re.sub(
        r'(<svg class="author-avatar".*?<text [^>]*>)(.*?)(</text>\s*</svg>)',
        rf"\1{AUTHOR_INITIALS}\3",
        text,
        count=1,
        flags=re.S,
    )
    prefix = root_prefix_for_html(path)
    note = (
        '<div class="authority-note"><strong>编辑与事实核查：</strong>'
        f'{REVIEWER_NAME} · 本文遵循 <a href="{prefix}editorial-policy/">Eco GEO 编辑政策</a>，'
        '涉及事实、数据和时事信息时优先引用可验证来源。</div>'
    )
    if "authority-note" not in text and '<div class="content">' in text:
        text = text.replace('<div class="content">', note + '<div class="content">', 1)
    if ".authority-note" not in text and "</style>" in text:
        text = text.replace(
            "</style>",
            ".authority-note{border:1px solid var(--line);border-radius:20px;background:rgba(255,255,255,.06);padding:14px 16px;color:var(--muted);margin:18px 0}.authority-note a{color:var(--green);text-decoration:none}</style>",
            1,
        )
    return text


def patch_html(root: Path = Path(".")) -> None:
    posts_by_lang = {
        "zh": {post.get("slug", ""): post for post in read_json(root / "blog" / "posts.json", []) if post.get("slug")},
        "en": {post.get("slug", ""): post for post in read_json(root / "en" / "blog" / "posts.json", []) if post.get("slug")},
        "ar": {post.get("slug", ""): post for post in read_json(root / "ar" / "blog" / "posts.json", []) if post.get("slug")},
    }
    for path in sorted(root.rglob("*.html")):
        if ".git" in path.parts:
            continue
        rel = path.relative_to(root)
        text = path.read_text(encoding="utf-8")
        original = text
        text = add_head_authority(text, rel, root, posts_by_lang)
        text = patch_language_switcher(text, root, rel)
        text = patch_contact_nav(text, rel)
        text = patch_footer(text, rel)
        text = patch_article_authority(text, rel)
        if text != original:
            path.write_text(text, encoding="utf-8")


def normalize_authors(root: Path = Path(".")) -> None:
    paths = [
        (root / "blog" / "posts.json", "zh"),
        (root / "en" / "blog" / "posts.json", "en"),
        (root / "ar" / "blog" / "posts.json", "ar"),
    ]
    for posts_path, lang in paths:
        posts = read_json(posts_path, [])
        if not isinstance(posts, list):
            continue
        changed = False
        for post in posts:
            expected_url = ""
            slug = post.get("slug")
            if slug:
                expected_url = f"{SITE_URL}/blog/articles/{slug}/" if lang == "zh" else f"{SITE_URL}/{lang}/blog/articles/{slug}/"
            title = ensure_title_prefix(post.get("title", ""))
            if post.get("title") != title:
                post["title"] = title
                changed = True
            if expected_url and post.get("url") != expected_url:
                post["url"] = expected_url
                changed = True
            if post.get("author") != AUTHOR_NAME:
                post["author"] = AUTHOR_NAME
                changed = True
            if post.get("reviewed_by") != REVIEWER_NAME:
                post["reviewed_by"] = REVIEWER_NAME
                changed = True
        if changed:
            posts_path.write_text(json.dumps(posts, ensure_ascii=False, indent=2), encoding="utf-8")


def write_robots(root: Path = Path(".")) -> None:
    write_text(
        root / "robots.txt",
        "\n".join(
            [
                "User-agent: *",
                "Allow: /",
                "",
                "User-agent: Googlebot",
                "Allow: /",
                "",
                "User-agent: OAI-SearchBot",
                "Allow: /",
                "",
                "User-agent: ChatGPT-User",
                "Allow: /",
                "",
                "User-agent: GPTBot",
                "Allow: /",
                "",
                "User-agent: Google-Extended",
                "Allow: /",
                "",
                f"Sitemap: {SITE_URL}/sitemap.xml",
                "# Eco GEO allows search and AI answer crawlers for public content.",
                "# Training/grounding crawler policy should be reviewed quarterly.",
                "",
            ]
        ),
    )


def write_llms(root: Path = Path(".")) -> None:
    write_text(
        root / "llms.txt",
        "\n".join(
            [
                "# Eco GEO",
                "",
                "Eco GEO is a Brand-first GEO consulting and research site about AI search visibility, AIBE diagnosis, trusted knowledge networks, and brand citability.",
                "",
                "Key pages:",
                f"- Home: {SITE_URL}/",
                f"- About: {SITE_URL}/about/",
                f"- Editorial policy: {SITE_URL}/editorial-policy/",
                f"- Brand audit demo: {SITE_URL}/brand-audit/",
                f"- Insights: {SITE_URL}/blog/",
                f"- Brand GEO hub: {SITE_URL}/resources/brand-geo/",
                f"- AIBE hub: {SITE_URL}/resources/aibe/",
                f"- AI search visibility hub: {SITE_URL}/resources/ai-search-visibility/",
                "",
                "Editorial standards:",
                "- AI-assisted content is reviewed by Eco GEO Editorial Team.",
                "- Current events, data, policies, prices, and version-specific claims should cite public sources.",
                "- Hidden prompts, scraping, link buying, doorway pages, and fabricated first-hand experience are not part of the site strategy.",
                "",
            ]
        ),
    )


def main() -> None:
    root = Path(".")
    normalize_authors(root)
    generate_authority_pages(root)
    i18n_site.write_sitemap(root=root)
    patch_html(root)
    write_robots(root)
    write_llms(root)


if __name__ == "__main__":
    main()
