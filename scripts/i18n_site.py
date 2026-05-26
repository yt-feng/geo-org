#!/usr/bin/env python3
"""Generate and maintain the multilingual static site shell."""
from __future__ import annotations

import argparse
import hashlib
import html
import json
import os
import re
from datetime import datetime
from pathlib import Path
from string import Template
from typing import Dict, Iterable, List, Mapping, Optional

EMAIL = "yt.feng@foxmail.com"
SITE_URL = os.environ.get("SITE_URL", "https://yt-feng.github.io/geo-org").rstrip("/")

GLOBE_SVG = (
    '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" '
    'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
    '<circle cx="12" cy="12" r="10"/><path d="M2 12h20"/>'
    '<path d="M12 2a15.3 15.3 0 0 1 0 20"/>'
    '<path d="M12 2a15.3 15.3 0 0 0 0 20"/></svg>'
)
SEARCH_SVG = (
    '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" '
    'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
    '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>'
)

LANG_SWITCHER_CSS = (
    ".lang-switcher{display:inline-flex;align-items:center;gap:7px;border:1px solid "
    "var(--line,rgba(255,255,255,.15));border-radius:999px;background:rgba(255,255,255,.075);"
    "padding:7px 9px;color:var(--text,#f5f8f4);font-size:12px;font-weight:900;white-space:nowrap}"
    ".lang-switcher svg{width:15px;height:15px;flex:0 0 auto}"
    ".lang-switcher a{text-decoration:none;color:inherit;opacity:.68}"
    ".lang-switcher a.active{opacity:1;color:var(--green,#8ce99a)}"
    "@media(max-width:900px){.lang-switcher a{display:none}.lang-switcher a.active{display:inline}}"
)

IMAGE_POOL = [
    "https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=1200&q=80",
    "https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=1200&q=80",
    "https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&w=1200&q=80",
    "https://images.unsplash.com/photo-1551434678-e076c223a692?auto=format&fit=crop&w=1200&q=80",
    "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1200&q=80",
    "https://images.unsplash.com/photo-1521737711867-e3b97375f902?auto=format&fit=crop&w=1200&q=80",
    "https://images.unsplash.com/photo-1485827404703-89b55fcc595e?auto=format&fit=crop&w=1200&q=80",
    "https://images.unsplash.com/photo-1497215728101-856f4ea42174?auto=format&fit=crop&w=1200&q=80",
    "https://images.unsplash.com/photo-1520607162513-77705c0f0d4a?auto=format&fit=crop&w=1200&q=80",
    "https://images.unsplash.com/photo-1552664730-d307ca884978?auto=format&fit=crop&w=1200&q=80",
    "https://images.unsplash.com/photo-1557804506-669a67965ba0?auto=format&fit=crop&w=1200&q=80",
    "https://images.unsplash.com/photo-1553877522-43269d4ea984?auto=format&fit=crop&w=1200&q=80",
]

LANGS = {
    "en": {
        "html_lang": "en",
        "dir": "ltr",
        "label": "EN",
        "nav_why": "Why",
        "nav_method": "Method",
        "nav_audit": "Brand audit",
        "nav_brands": "Credentials",
        "nav_blog": "Insights",
        "nav_contact": "Contact",
        "footer_home": "Home",
        "footer_blog": "Insights",
        "cta_title": "AIBE quick check",
        "cta_body": "Check your brand visibility and citation risks in AI answers",
        "cta_link": "Email us",
        "home_title": "Make your brand understandable, citable, and recommendable in AI answers.",
        "home_lead": "Eco GEO is brand-first GEO consulting for teams that need AI search, generative answers, and multilingual discovery to describe the brand correctly.",
        "home_primary": "Open brand audit demo",
        "home_secondary": "Email consultation",
        "home_why_title": "AI search changes the battleground from ranking to interpretation.",
        "home_why_body": "Users increasingly ask AI systems for recommendations. Your brand needs consistent facts, credible evidence, and a clear knowledge network that models can understand and cite.",
        "home_method_title": "AIBE diagnosis, GEO strategy, and trusted knowledge networks.",
        "home_method_body": "We start from high-value user questions, measure visibility and citation quality, then turn brand facts, cases, FAQs, and viewpoints into reusable AI-readable assets.",
        "home_credentials": "Selected credentials",
        "home_cases": "Best-fit use cases",
        "home_case_1": "B2B and SaaS teams that need complex products explained clearly.",
        "home_case_2": "Service and consulting teams that need credible expert narratives.",
        "home_case_3": "Global brands that need consistent Chinese, English, and Arabic AI visibility.",
        "audit_title": "AI brand visibility audit",
        "audit_lead": "Run a lightweight front-end demo to see the dimensions a formal AIBE diagnosis would inspect.",
        "audit_start": "Start audit",
        "audit_name": "Brand / product / organization",
        "audit_site": "Website or key page",
        "audit_market": "Target market",
        "audit_button": "Generate sample audit",
        "audit_direct": "Email consultation",
        "audit_empty": "Generate a sample audit to see visibility score, risk signals, and recommended actions.",
        "audit_result": "sample audit",
        "audit_next": "Next step: send the brand name, website, and target market for a formal AIBE diagnosis.",
        "blog_title": "Eco GEO Insights",
        "blog_lead": "Daily localized notes on Brand GEO, AIBE, trusted knowledge networks, and AI search optimization.",
        "blog_empty": "Localized daily articles will appear here after the automated publisher runs.",
        "blog_archive": "Open the Chinese archive",
        "blog_loading": "Loading insights...",
        "blog_failed": "Article data failed to load: ",
        "blog_count_suffix": "articles",
        "article_eyebrow": "Eco GEO Insights",
        "article_suffix": "Eco GEO Insights",
        "article_meta": "Brand-first GEO",
    },
    "ar": {
        "html_lang": "ar",
        "dir": "rtl",
        "label": "ع",
        "nav_why": "لماذا",
        "nav_method": "المنهج",
        "nav_audit": "تقييم العلامة",
        "nav_brands": "الخبرات",
        "nav_blog": "الرؤى",
        "nav_contact": "تواصل",
        "footer_home": "الرئيسية",
        "footer_blog": "الرؤى",
        "cta_title": "فحص AIBE أولي",
        "cta_body": "افحص ظهور علامتك ومخاطر الاقتباس داخل إجابات الذكاء الاصطناعي",
        "cta_link": "راسلنا",
        "home_title": "اجعل علامتك مفهومة وموثوقة وقابلة للاقتباس داخل إجابات الذكاء الاصطناعي.",
        "home_lead": "Eco GEO هي خدمة GEO تركز على العلامة للفرق التي تريد أن يصفها بحث الذكاء الاصطناعي والإجابات التوليدية بدقة عبر اللغات.",
        "home_primary": "افتح تجربة تقييم العلامة",
        "home_secondary": "استشارة عبر البريد",
        "home_why_title": "بحث الذكاء الاصطناعي ينقل المنافسة من الترتيب إلى طريقة تفسير العلامة.",
        "home_why_body": "يسأل المستخدمون أنظمة الذكاء الاصطناعي عن التوصيات مباشرة. لذلك تحتاج العلامة إلى حقائق متسقة وأدلة موثوقة وشبكة معرفة واضحة يمكن للنماذج فهمها واقتباسها.",
        "home_method_title": "تشخيص AIBE، استراتيجية GEO، وشبكات معرفة موثوقة.",
        "home_method_body": "نبدأ من أسئلة المستخدم عالية القيمة، نقيس الظهور وجودة الاقتباس، ثم نحول حقائق العلامة والحالات والأسئلة الشائعة والرؤى إلى أصول يمكن للذكاء الاصطناعي قراءتها.",
        "home_credentials": "خبرات مختارة",
        "home_cases": "حالات الاستخدام المناسبة",
        "home_case_1": "فرق B2B وSaaS التي تحتاج إلى شرح منتجات معقدة بوضوح.",
        "home_case_2": "فرق الخدمات والاستشارات التي تحتاج إلى سرد خبير موثوق.",
        "home_case_3": "علامات عالمية تحتاج إلى ظهور متسق بالصينية والإنجليزية والعربية.",
        "audit_title": "تقييم ظهور العلامة في الذكاء الاصطناعي",
        "audit_lead": "جرّب أداة أمامية خفيفة لرؤية الأبعاد التي يفحصها تشخيص AIBE الرسمي.",
        "audit_start": "ابدأ التقييم",
        "audit_name": "اسم العلامة / المنتج / المؤسسة",
        "audit_site": "الموقع أو الصفحة الرئيسية",
        "audit_market": "السوق المستهدف",
        "audit_button": "إنشاء تقييم تجريبي",
        "audit_direct": "استشارة عبر البريد",
        "audit_empty": "أنشئ تقييما تجريبيا لعرض درجة الظهور ومؤشرات المخاطر والإجراءات المقترحة.",
        "audit_result": "تقييم تجريبي",
        "audit_next": "الخطوة التالية: أرسل اسم العلامة والموقع والسوق المستهدف للحصول على تشخيص AIBE رسمي.",
        "blog_title": "رؤى Eco GEO",
        "blog_lead": "مقالات يومية مترجمة حول Brand GEO وAIBE وشبكات المعرفة الموثوقة وتحسين بحث الذكاء الاصطناعي.",
        "blog_empty": "ستظهر المقالات اليومية المترجمة هنا بعد تشغيل الناشر الآلي.",
        "blog_archive": "افتح الأرشيف الصيني",
        "blog_loading": "جار تحميل الرؤى...",
        "blog_failed": "تعذر تحميل بيانات المقالات: ",
        "blog_count_suffix": "مقال",
        "article_eyebrow": "رؤى Eco GEO",
        "article_suffix": "رؤى Eco GEO",
        "article_meta": "Brand-first GEO",
    },
}


def esc(value: object) -> str:
    return html.escape(str(value or ""), quote=True)


def read_json(path: Path, default: object) -> object:
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def render(template: str, **values: object) -> str:
    return Template(template).safe_substitute({k: str(v) for k, v in values.items()})


def section_suffix(section: str) -> str:
    if section == "blog":
        return "blog/"
    if section == "brand-audit":
        return "brand-audit/"
    return ""


def current_base(root_prefix: str, active: str) -> str:
    return root_prefix if active == "zh" else f"{root_prefix}{active}/"


def language_switcher(root_prefix: str, active: str, section: str = "home") -> str:
    suffix = section_suffix(section)
    zh_href = f"{root_prefix}{suffix}" if suffix else f"{root_prefix}index.html"
    en_href = f"{root_prefix}en/{suffix}"
    ar_href = f"{root_prefix}ar/{suffix}"
    return (
        '<div class="lang-switcher" aria-label="Language selector">'
        f"{GLOBE_SVG}"
        f'<a class="{"active" if active == "zh" else ""}" href="{esc(zh_href)}">中</a>'
        f'<a class="{"active" if active == "en" else ""}" href="{esc(en_href)}">EN</a>'
        f'<a class="{"active" if active == "ar" else ""}" href="{esc(ar_href)}" dir="rtl">ع</a>'
        "</div>"
    )


def header(root_prefix: str, active: str, section: str = "home") -> str:
    cfg = LANGS[active]
    base = current_base(root_prefix, active)
    audit_active = ' class="active"' if section == "brand-audit" else ""
    blog_class = "nav-cta nav-insights active" if section == "blog" else "nav-cta nav-insights"
    return (
        '<header class="top site-header"><nav class="wrap site-nav">'
        f'<a class="brand site-brand" href="{base}index.html#top"><img src="{root_prefix}logo.svg" alt="Eco GEO logo"/>'
        '<span>ECO GEO<small>Brand-first GEO</small></span></a>'
        '<div class="links navlinks site-links">'
        f'<a href="{base}index.html#why">{cfg["nav_why"]}</a>'
        f'<a href="{base}index.html#method">{cfg["nav_method"]}</a>'
        f'<a{audit_active} href="{base}brand-audit/">{cfg["nav_audit"]}</a>'
        f'<a href="{base}index.html#credentials">{cfg["nav_brands"]}</a>'
        f'<a class="{blog_class}" href="{base}blog/">{cfg["nav_blog"]}</a>'
        f'<a class="nav-cta" href="mailto:{EMAIL}?subject=Eco%20GEO%20AIBE%20Consultation">{cfg["nav_contact"]}</a>'
        "</div>"
        f"{language_switcher(root_prefix, active, section)}</nav></header>"
    )


def footer(root_prefix: str, active: str) -> str:
    cfg = LANGS[active]
    base = current_base(root_prefix, active)
    return (
        '<footer class="footer site-footer"><div class="wrap">'
        f'© 2026 Eco GEO · Brand-first GEO · <a href="{base}index.html">{cfg["footer_home"]}</a> · '
        f'<a href="{base}blog/">{cfg["footer_blog"]}</a> · <a href="mailto:{EMAIL}">{EMAIL}</a>'
        "</div></footer>"
    )


def bottom_cta(active: str) -> str:
    cfg = LANGS[active]
    return (
        '<div class="bottom-cta" role="region" aria-label="Eco GEO contact">'
        '<div class="wrap bottom-cta-inner"><div class="bottom-cta-text">'
        f'<strong>{cfg["cta_title"]}</strong><span>{cfg["cta_body"]}</span></div>'
        f'<a href="mailto:{EMAIL}?subject=Eco%20GEO%20AIBE%20Consultation">{cfg["cta_link"]}</a>'
        "</div></div>"
    )


def base_css() -> str:
    return (
        ":root{--bg:#07110d;--panel:rgba(255,255,255,.075);--panel2:rgba(255,255,255,.12);"
        "--text:#f5f8f4;--muted:#b8c7bc;--line:rgba(255,255,255,.15);--green:#8ce99a;"
        "--green2:#30c775;--blue:#80c7ff;--gold:#ffd166;--shadow:0 26px 80px rgba(0,0,0,.32)}"
        "*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;padding-bottom:78px;"
        "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:var(--text);"
        "background:radial-gradient(circle at 10% 0%,rgba(34,150,123,.30),transparent 34rem),"
        "radial-gradient(circle at 90% 10%,rgba(128,199,255,.12),transparent 28rem),"
        "linear-gradient(135deg,#050806,var(--bg),#101a13);line-height:1.7}a{color:inherit}"
        ".wrap{width:min(1160px,calc(100% - 42px));margin:auto}.site-header{position:sticky;top:0;"
        "z-index:40;background:rgba(7,17,13,.86);backdrop-filter:blur(18px);border-bottom:1px solid var(--line)}"
        ".site-nav{display:flex;align-items:center;justify-content:space-between;gap:18px;padding:14px 0}"
        ".brand{display:flex;align-items:center;gap:12px;text-decoration:none;font-weight:900;letter-spacing:.08em}"
        ".brand img{width:46px;height:34px;object-fit:contain;border-radius:10px;background:rgba(255,255,255,.94);padding:3px}"
        ".brand small{display:block;letter-spacing:0;color:var(--muted);font-weight:700;font-size:11px;margin-top:-4px}"
        ".site-links{display:flex;align-items:center;gap:16px;color:var(--muted);font-size:14px}"
        ".site-links a{text-decoration:none;white-space:nowrap}.site-links a:hover,.site-links .active{color:var(--text)}"
        ".site-links .nav-cta{border:1px solid var(--line);border-radius:999px;padding:8px 12px;color:var(--text);"
        "background:rgba(255,255,255,.08);font-weight:900}"
        f"{LANG_SWITCHER_CSS}"
        ".hero{padding:70px 0 34px}.eyebrow{color:var(--green);font-weight:900;font-size:13px;"
        "letter-spacing:.14em;text-transform:uppercase}h1{font-size:clamp(38px,6vw,76px);line-height:1.04;"
        "letter-spacing:0;margin:14px 0 18px}.lead{font-size:clamp(18px,2vw,23px);color:var(--muted);max-width:880px;margin:0 0 28px}"
        ".actions{display:flex;gap:12px;flex-wrap:wrap}.btn{display:inline-flex;align-items:center;justify-content:center;"
        "border:1px solid var(--line);border-radius:999px;padding:12px 16px;background:var(--panel2);"
        "text-decoration:none;font-weight:900;cursor:pointer;color:var(--text)}.btn.primary{background:var(--text);color:#07110d;border-color:var(--text)}"
        ".section{padding:68px 0;border-top:1px solid var(--line)}.section h2{font-size:clamp(28px,4vw,50px);line-height:1.1;letter-spacing:0;margin:10px 0 16px}"
        ".section-intro{max-width:820px;color:var(--muted);font-size:18px;margin:0 0 24px}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}"
        ".card,.panel{border:1px solid var(--line);border-radius:28px;background:var(--panel);box-shadow:var(--shadow);padding:24px}"
        ".card h3,.panel h2,.panel h3{margin:0 0 10px}.card p,.panel p{color:var(--muted);margin:0}.logo-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}"
        ".logo-tile{height:142px;border:1px solid var(--line);border-radius:24px;background:#fff;display:flex;align-items:center;justify-content:center;padding:24px;box-shadow:var(--shadow)}"
        ".logo-tile img{max-width:100%;max-height:100%;object-fit:contain}.bottom-cta{position:fixed;left:0;right:0;bottom:0;z-index:45;"
        "background:rgba(7,17,13,.91);backdrop-filter:blur(18px);border-top:1px solid var(--line)}"
        ".bottom-cta-inner{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:10px 0}"
        ".bottom-cta-text{display:flex;align-items:baseline;gap:10px;color:var(--muted);min-width:0}.bottom-cta-text strong{color:var(--text)}"
        ".bottom-cta-text span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.bottom-cta a{flex:0 0 auto;text-decoration:none;border-radius:999px;padding:9px 13px;background:var(--text);color:#07110d;font-weight:900}"
        ".site-footer{border-top:1px solid var(--line);padding:28px 0 42px;color:var(--muted)}"
        "@media(max-width:920px){.grid,.logo-grid{grid-template-columns:1fr}.site-links{display:flex}.site-links a:not(.nav-cta){display:none}.bottom-cta-text span{display:none}.wrap{width:min(100% - 28px,1160px)}}"
    )


def home_page(lang: str) -> str:
    cfg = LANGS[lang]
    prefix = "../"
    return render(
        """<!doctype html>
<html lang="$html_lang" dir="$dir"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<meta name="description" content="Eco GEO multilingual Brand GEO consulting for AI search and generative answers."/>
<link rel="icon" href="${prefix}logo.svg" type="image/svg+xml"/><title>Eco GEO｜Brand-first GEO</title><style>$css</style></head>
<body>$header<main id="top"><section class="hero wrap"><div class="eyebrow">Brand-first GEO</div><h1>$home_title</h1><p class="lead">$home_lead</p><div class="actions"><a class="btn primary" href="brand-audit/">$home_primary</a><a class="btn" href="mailto:$email?subject=Eco%20GEO%20AIBE%20Consultation">$home_secondary</a></div></section>
<section class="section" id="why"><div class="wrap"><div class="eyebrow">Why</div><h2>$home_why_title</h2><p class="section-intro">$home_why_body</p></div></section>
<section class="section" id="credentials"><div class="wrap"><div class="eyebrow">Selected Credentials</div><h2>$home_credentials</h2><div class="logo-grid">$logos</div></div></section>
<section class="section" id="method"><div class="wrap"><div class="eyebrow">Method</div><h2>$home_method_title</h2><p class="section-intro">$home_method_body</p><div class="grid"><article class="card"><h3>AIBE</h3><p>AI brand perception diagnosis.</p></article><article class="card"><h3>KNIT</h3><p>Trusted knowledge network for citable facts.</p></article><article class="card"><h3>Prompt Matrix</h3><p>High-intent questions mapped to answer quality.</p></article></div></div></section>
<section class="section"><div class="wrap"><div class="eyebrow">Use Cases</div><h2>$home_cases</h2><div class="grid"><article class="card"><p>$home_case_1</p></article><article class="card"><p>$home_case_2</p></article><article class="card"><p>$home_case_3</p></article></div></div></section>
</main>$bottom$footer</body></html>""",
        prefix=prefix,
        css=base_css(),
        header=header(prefix, lang, "home"),
        bottom=bottom_cta(lang),
        footer=footer(prefix, lang),
        email=EMAIL,
        logos=logo_grid(prefix),
        **cfg,
    )


def logo_grid(prefix: str) -> str:
    logos = [
        ("mcdonalds.svg", "McDonald's"),
        ("jnj.svg", "J&J"),
        ("pfizer.svg", "Pfizer"),
        ("novartis.svg", "Novartis"),
        ("msd.svg", "MSD"),
        ("mercedes.svg", "Mercedes-Benz"),
        ("audi.svg", "Audi"),
        ("martell.svg", "Martell"),
        ("nio.svg", "NIO"),
    ]
    return "".join(
        f'<div class="logo-tile"><img src="{prefix}assets/logos/{name}" alt="{esc(alt)}" loading="lazy"/></div>'
        for name, alt in logos
    )


def audit_page(lang: str) -> str:
    cfg = LANGS[lang]
    prefix = "../../"
    dimensions = {
        "en": ["AI visibility", "Fact consistency", "Citation assets", "Competitive distinction", "Content citability"],
        "ar": ["الظهور في الذكاء الاصطناعي", "اتساق الحقائق", "أصول الاقتباس", "التميّز التنافسي", "قابلية المحتوى للاقتباس"],
    }[lang]
    extra_css = (
        ".tool-shell{display:grid;grid-template-columns:.9fr 1.1fr;gap:18px;align-items:start;padding:22px 0 76px}"
        ".form{display:grid;gap:14px}.field label{display:block;font-weight:900;margin:0 0 7px}.field input{width:100%;border:1px solid var(--line);background:rgba(0,0,0,.24);color:var(--text);border-radius:16px;padding:13px 14px;font-size:16px;outline:none}"
        ".score{display:grid;grid-template-columns:132px 1fr;gap:18px;align-items:center;margin-bottom:18px}.ring{width:132px;aspect-ratio:1;border-radius:999px;display:grid;place-items:center;background:conic-gradient(var(--green) calc(var(--score)*1%),rgba(255,255,255,.12) 0);position:relative}.ring:before{content:'';position:absolute;inset:11px;border-radius:999px;background:#07110d;border:1px solid var(--line)}.ring strong{position:relative;font-size:38px}.bars{display:grid;gap:12px}.barrow{display:grid;grid-template-columns:150px 1fr 42px;gap:12px;align-items:center;color:var(--muted)}.bar{height:12px;border-radius:999px;background:rgba(255,255,255,.10);overflow:hidden}.fill{height:100%;border-radius:999px;background:linear-gradient(90deg,var(--green2),var(--blue))}.empty{border:1px dashed var(--line);border-radius:22px;padding:20px;color:var(--muted);background:rgba(255,255,255,.045)}@media(max-width:920px){.tool-shell,.score{grid-template-columns:1fr}.barrow{grid-template-columns:1fr 1fr 42px}}"
    )
    return render(
        """<!doctype html>
<html lang="$html_lang" dir="$dir"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<meta name="description" content="Eco GEO AI brand visibility audit demo."/><link rel="icon" href="${prefix}logo.svg" type="image/svg+xml"/>
<title>$audit_title｜Eco GEO</title><style>$css$extra_css</style></head><body>$header
<main><section class="hero wrap"><div class="eyebrow">Brand Audit Demo</div><h1>$audit_title</h1><p class="lead">$audit_lead</p></section>
<section class="tool-shell wrap"><form class="panel form" id="auditForm"><h2>$audit_start</h2><div class="field"><label for="brandName">$audit_name</label><input id="brandName" name="brandName" value="Eco GEO"/></div><div class="field"><label for="website">$audit_site</label><input id="website" name="website" value="https://eco-geo.org"/></div><div class="field"><label for="market">$audit_market</label><input id="market" name="market" value="Global AI search"/></div><div class="actions"><button class="btn primary" type="submit">$audit_button</button><a class="btn" href="mailto:$email?subject=Eco%20GEO%20AIBE%20Consultation">$audit_direct</a></div></form>
<section class="panel" aria-live="polite"><div id="emptyState" class="empty">$audit_empty</div><div id="result" hidden><div class="score"><div class="ring" id="ring" style="--score:72"><strong id="scoreValue">72</strong></div><div><h3 id="resultTitle">Eco GEO $audit_result</h3><p id="summary"></p></div></div><div class="bars" id="bars"></div><p class="section-intro">$audit_next</p></div></section></section></main>$bottom$footer
<script>
const dimensions=$dimensions;
const form=document.getElementById('auditForm'),result=document.getElementById('result'),emptyState=document.getElementById('emptyState');
function clean(v){return (v||'').toString().trim()}function seed(text){let n=19;for(const ch of text)n=(n*31+ch.charCodeAt(0))%9973;return n}function scoreFor(base,i){return 50+((base+i*17)%39)}
function render(){const data=Object.fromEntries(new FormData(form).entries());const brand=clean(data.brandName)||'Eco GEO';const base=seed(brand+'|'+clean(data.website)+'|'+clean(data.market));const scores=dimensions.map((name,i)=>({name,value:scoreFor(base,i)}));const overall=Math.round(scores.reduce((s,x)=>s+x.value,0)/scores.length);document.getElementById('ring').style.setProperty('--score',overall);document.getElementById('scoreValue').textContent=overall;document.getElementById('resultTitle').textContent=brand+' $audit_result';document.getElementById('summary').textContent='AIBE score: '+overall+'. Focus on consistent facts, stronger citations, and question-led content assets.';document.getElementById('bars').innerHTML=scores.map(item=>'<div class="barrow"><span>'+item.name+'</span><div class="bar"><div class="fill" style="width:'+item.value+'%"></div></div><b>'+item.value+'</b></div>').join('');emptyState.hidden=true;result.hidden=false}
form.addEventListener('submit',event=>{event.preventDefault();render()});render();
</script></body></html>""",
        prefix=prefix,
        css=base_css(),
        extra_css=extra_css,
        header=header(prefix, lang, "brand-audit"),
        bottom=bottom_cta(lang),
        footer=footer(prefix, lang),
        dimensions=json.dumps(dimensions, ensure_ascii=False),
        email=EMAIL,
        **cfg,
    )


def blog_index_page(lang: str) -> str:
    cfg = LANGS[lang]
    prefix = "../../"
    extra_css = (
        ".tools{display:grid;grid-template-columns:1fr .55fr;gap:14px;margin:30px 0 18px}.searchbox{border:1px solid var(--line);border-radius:22px;background:rgba(255,255,255,.08);display:flex;align-items:center;gap:10px;padding:12px 14px}.searchbox svg{width:16px;height:16px;flex:0 0 auto}.searchbox input{width:100%;border:0;background:transparent;color:var(--text);outline:none;font-size:16px}.summary{display:flex;gap:10px;color:var(--muted);font-size:14px;margin-bottom:18px}.pill{border:1px solid var(--line);border-radius:999px;padding:7px 10px;background:rgba(255,255,255,.055)}.post-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;padding:14px 0 70px}.post-card{border:1px solid var(--line);border-radius:28px;background:var(--panel);box-shadow:var(--shadow);overflow:hidden;text-decoration:none;display:flex;flex-direction:column}.thumb{aspect-ratio:16/9;background:#13221b;overflow:hidden}.thumb img{width:100%;height:100%;object-fit:cover;display:block}.post-card-body{padding:20px}.meta{display:flex;gap:10px;flex-wrap:wrap;color:var(--green);font-size:13px;font-weight:900;margin-bottom:12px}.post-card h2{font-size:22px;line-height:1.3;letter-spacing:0;margin:0 0 10px}.post-card p{color:var(--muted);margin:0}.empty{border:1px solid var(--line);border-radius:28px;background:var(--panel);padding:28px;color:var(--muted);margin:24px 0}.archive-link{margin-top:14px}@media(max-width:980px){.post-grid{grid-template-columns:1fr}.tools{grid-template-columns:1fr}}"
    )
    return render(
        """<!doctype html>
<html lang="$html_lang" dir="$dir"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<meta name="description" content="Eco GEO multilingual Brand GEO and AI search insights."/><link rel="icon" href="${prefix}logo.svg" type="image/svg+xml"/>
<title>$blog_title｜Eco GEO</title><style>$css$extra_css</style></head><body>$header
<main class="wrap"><section class="hero"><div class="eyebrow">Insights Library</div><h1>$blog_title</h1><p class="lead">$blog_lead</p><div class="tools"><label class="searchbox"><span>$search_icon</span><input id="searchInput" type="search" placeholder="Search" autocomplete="off"/></label><div class="summary"><span class="pill" id="countText">$blog_loading</span></div></div></section><div class="empty" id="emptyState" hidden>$blog_empty<div class="archive-link"><a class="btn" href="${prefix}blog/">$blog_archive</a></div></div><section class="post-grid" id="postGrid" aria-live="polite"></section></main>$bottom$footer
<script>
const IMAGE_POOL=$images;const state={posts:[],query:''};const el=id=>document.getElementById(id);
function safe(v){return (v||'').toString()}function hash(s){let h=0;for(const ch of safe(s))h=((h<<5)-h+ch.charCodeAt(0))|0;return Math.abs(h)}function imgFor(post,i){return post.image||IMAGE_POOL[hash(post.slug||post.title||i)%IMAGE_POOL.length]}function esc(s){return safe(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function render(){const q=state.query.trim().toLowerCase();const posts=state.posts.filter(p=>(safe(p.title)+' '+safe(p.excerpt)+' '+safe(p.tags)+' '+safe(p.category)).toLowerCase().includes(q));el('countText').textContent=posts.length+' $blog_count_suffix';el('emptyState').hidden=posts.length!==0;el('postGrid').innerHTML=posts.map((p,i)=>'<a class="post-card" href="articles/'+encodeURIComponent(p.slug)+'/"><div class="thumb"><img src="'+imgFor(p,i)+'" alt="'+esc(p.title)+'" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display=\\'none\\'"></div><div class="post-card-body"><div class="meta"><span>'+esc(p.category||'Brand GEO')+'</span><span>'+esc(p.date||'')+'</span><span>'+esc(p.author||'Eco GEO Editorial')+'</span></div><h2>'+esc(p.title)+'</h2><p>'+esc(p.excerpt)+'</p></div></a>').join('')}
el('searchInput').addEventListener('input',e=>{state.query=e.target.value;render()});
fetch('posts.json',{cache:'no-store'}).then(r=>{if(!r.ok)throw new Error('posts.json');return r.json()}).then(data=>{state.posts=Array.isArray(data)?data:[];render()}).catch(err=>{el('countText').textContent='$blog_failed'+err.message;state.posts=[];render()});
</script></body></html>""",
        prefix=prefix,
        css=base_css(),
        extra_css=extra_css,
        header=header(prefix, lang, "blog"),
        bottom=bottom_cta(lang),
        footer=footer(prefix, lang),
        search_icon=SEARCH_SVG,
        images=json.dumps(IMAGE_POOL),
        **cfg,
    )


def date_label(value: str, lang: str) -> str:
    try:
        parsed = datetime.strptime(value, "%Y-%m-%d")
    except (TypeError, ValueError):
        return value or ""
    if lang == "en":
        return parsed.strftime("%b %-d, %Y") if os.name != "nt" else parsed.strftime("%b %#d, %Y")
    return value


def avatar_svg(initials: str, seed_text: str) -> str:
    seed = int(hashlib.sha1(seed_text.encode("utf-8")).hexdigest()[:8], 16)
    colors = ["#8ce99a", "#80c7ff", "#ffd166", "#b197fc", "#63e6be", "#ffa8a8"]
    c1 = colors[seed % len(colors)]
    c2 = colors[(seed // 7) % len(colors)]
    safe_initials = esc(initials[:3].upper())
    return (
        '<svg class="author-avatar" viewBox="0 0 160 160" aria-hidden="true">'
        f'<defs><linearGradient id="lg{seed}" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="{c1}"/><stop offset="1" stop-color="{c2}"/></linearGradient></defs>'
        '<rect width="160" height="160" rx="42" fill="#07110d"/>'
        f'<circle cx="80" cy="80" r="52" fill="url(#lg{seed})"/>'
        f'<text x="80" y="94" text-anchor="middle" font-family="Arial" font-size="42" font-weight="900" fill="#07110d">{safe_initials}</text>'
        "</svg>"
    )


def localized_article_html(
    *,
    lang: str,
    post: Mapping[str, str],
    body_html: str,
    initials: str,
) -> str:
    cfg = LANGS[lang]
    prefix = "../../../../"
    title = esc(post.get("title"))
    excerpt = esc(post.get("excerpt"))
    image = esc(post.get("image") or IMAGE_POOL[0])
    author = esc(post.get("author") or "Eco GEO Editorial")
    category = esc(post.get("category") or "Brand GEO")
    published = esc(post.get("date") or "")
    tag_html = "".join(
        f"<span class='tag'>{esc(tag)}</span>"
        for tag in re.split(r"[,،，/、]", post.get("tags", ""))[:6]
        if tag.strip()
    )
    article_css = (
        base_css()
        + ".article{max-width:860px;margin:auto;padding:56px 0 84px}.cover{width:100%;border-radius:30px;aspect-ratio:16/9;object-fit:cover;box-shadow:var(--shadow);background:#13221b}.article-meta{display:flex;align-items:center;gap:14px;color:var(--muted);margin:22px 0}.author-avatar{width:54px;height:54px;border-radius:18px;flex:0 0 auto}.content{font-size:18px;color:#e8efe9}.content h2{font-size:30px;line-height:1.2;letter-spacing:0;margin:40px 0 12px;color:var(--text)}.content p{margin:0 0 18px}.content li{margin:8px 0}.tags{display:flex;gap:8px;flex-wrap:wrap;margin-top:32px}.tag{border:1px solid rgba(140,233,154,.35);border-radius:999px;padding:6px 10px;color:var(--green);font-size:13px}"
    )
    return render(
        """<!doctype html>
<html lang="$html_lang" dir="$dir"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<meta name="description" content="$excerpt"/><link rel="icon" href="${prefix}logo.svg" type="image/svg+xml"/>
<title>$title｜$article_suffix</title><style>$css</style></head><body>$header<main class="wrap"><article class="article"><div class="eyebrow">$article_eyebrow</div><h1>$title</h1><p class="lead">$excerpt</p><img class="cover" src="$image" alt="$title" loading="lazy" referrerpolicy="no-referrer"/><div class="article-meta">$avatar<div><strong>$author</strong><br/><span>$category · <time datetime="$published">$date_label</time> · $article_meta</span></div></div><div class="content">$body_html</div><div class="tags">$tags</div></article></main>$bottom$footer</body></html>""",
        prefix=prefix,
        excerpt=excerpt,
        title=title,
        css=article_css,
        header=header(prefix, lang, "blog"),
        avatar=avatar_svg(initials, post.get("title", "")),
        image=image,
        author=author,
        category=category,
        published=published,
        date_label=esc(date_label(post.get("date", ""), lang)),
        body_html=body_html,
        tags=tag_html,
        bottom=bottom_cta(lang),
        footer=footer(prefix, lang),
        **cfg,
    )


def ensure_language_scaffold(root: Path = Path(".")) -> None:
    for lang in ("en", "ar"):
        write_text(root / lang / "index.html", home_page(lang))
        write_text(root / lang / "brand-audit" / "index.html", audit_page(lang))
        write_text(root / lang / "blog" / "index.html", blog_index_page(lang))
        posts_path = root / lang / "blog" / "posts.json"
        if not posts_path.exists():
            write_text(posts_path, "[]\n")


def sync_language_switchers(root: Path = Path(".")) -> None:
    targets: List[tuple[Path, str, str]] = [
        (root / "index.html", "", "home"),
        (root / "404.html", "", "home"),
        (root / "brand-audit" / "index.html", "../", "brand-audit"),
        (root / "blog" / "index.html", "../", "blog"),
    ]
    targets.extend((path, "../../../", "blog") for path in sorted((root / "blog" / "articles").glob("*/index.html")))
    targets.extend((path, "../../../", "blog") for path in sorted((root / "blog" / "page").glob("*/index.html")))
    for path, prefix, section in targets:
        if not path.exists():
            continue
        text = path.read_text(encoding="utf-8")
        if ".lang-switcher" not in text:
            text = text.replace("</style>", f"{LANG_SWITCHER_CSS}\n</style>", 1)
        if 'class="lang-switcher"' not in text:
            text = text.replace("</div></nav></header>", f"</div>{language_switcher(prefix, 'zh', section)}</nav></header>", 1)
        text = re.sub(
            r'(<img class="cover" [^>]* loading="lazy")(?!\s+referrerpolicy)(\s*/?>)',
            r'\1 referrerpolicy="no-referrer"\2',
            text,
        )
        path.write_text(text, encoding="utf-8")


def write_sitemap(posts_by_lang: Optional[Mapping[str, Iterable[Mapping[str, str]]]] = None, root: Path = Path(".")) -> None:
    if posts_by_lang is None:
        posts_by_lang = {
            "zh": read_json(root / "blog" / "posts.json", []),
            "en": read_json(root / "en" / "blog" / "posts.json", []),
            "ar": read_json(root / "ar" / "blog" / "posts.json", []),
        }
    static_paths = ["", "brand-audit/", "blog/", "en/", "en/brand-audit/", "en/blog/", "ar/", "ar/brand-audit/", "ar/blog/"]
    items = [f"  <url><loc>{SITE_URL}/{path}</loc></url>" for path in static_paths]
    for lang, posts in posts_by_lang.items():
        for post in posts:
            slug = post.get("slug")
            if not slug:
                continue
            if post.get("url"):
                url = post["url"]
            elif lang == "zh":
                url = f"{SITE_URL}/blog/articles/{slug}/"
            else:
                url = f"{SITE_URL}/{lang}/blog/articles/{slug}/"
            lastmod = post.get("date", "")
            items.append(f"  <url><loc>{esc(url)}</loc><lastmod>{esc(lastmod)}</lastmod></url>")
    write_text(
        root / "sitemap.xml",
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        + "\n".join(items)
        + "\n</urlset>\n",
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--no-scaffold", action="store_true")
    parser.add_argument("--no-sync-chrome", action="store_true")
    parser.add_argument("--no-sitemap", action="store_true")
    args = parser.parse_args()
    if not args.no_scaffold:
        ensure_language_scaffold()
    if not args.no_sync_chrome:
        sync_language_switchers()
    if not args.no_sitemap:
        write_sitemap()


if __name__ == "__main__":
    main()
