"""Fetch bounded, auditable source bodies for the daily insight pipeline.

Research text stays in memory. Never publish or commit this pack: publish source
metadata and the article's own analysis only. RSS text is never evidence.

RESEARCH_SOURCE_FILE: optional JSON list, or {"sources": [...]}, replacing the
curated catalogue. Each source has url, title, tags (topic-matching strings), and
optionally published and text_file (UTF-8 plain text/HTML fixture, relative to the
JSON file). Optional industries are exact industry names or supported aliases;
scope_notes explains the geography, population and claim boundaries. Optional
excerpt_anchor selects a verified passage in a long report. A fixture is
explicitly labelled local_fixture in the result.
RESEARCH_MIN_SOURCES / RESEARCH_MIN_DOMAINS: defaults 3 / 2, hard floors 3 / 2.
RESEARCH_MAX_SOURCES: default 5 (at most 5 for a fresh research pack).
RESEARCH_MIN_BODY_CHARS: default 900 (at least 300).
RESEARCH_MAX_SOURCE_CHARS: default 10000 (at most 10000).
RESEARCH_FETCH_TIMEOUT: seconds per request, default 20 (maximum 45).
RESEARCH_MAX_RESPONSE_BYTES: default 2500000 (maximum 4000000).
Industry topics require at least one matching industry source body. General AI
search/marketing sources cannot satisfy this additional evidence requirement.
"""
from __future__ import annotations

import hashlib
import ipaddress
import json
import os
import re
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from typing import Any, Mapping, Sequence


# Exact hosts, not arbitrary subdomains. No DNS, proxy or host-state inspection.
TRUSTED_HOSTS = {
    "developers.google.com": ("google.com", "Google Search Central", "platform_documentation"),
    "support.google.com": ("google.com", "Google", "platform_documentation"),
    "blog.google": ("google.com", "Google", "platform_announcement"),
    "blogs.bing.com": ("bing.com", "Microsoft Bing", "platform_announcement"),
    "www.bing.com": ("bing.com", "Microsoft Bing", "platform_documentation"),
    "www.bcg.com": ("bcg.com", "BCG", "consulting_analysis"),
    "arxiv.org": ("arxiv.org", "arXiv authors", "research_paper"),
    "www.fao.org": ("fao.org", "Food and Agriculture Organization of the United Nations", "institutional_analysis"),
    "openknowledge.fao.org": ("fao.org", "Food and Agriculture Organization of the United Nations", "institutional_research"),
    "www.oecd.org": ("oecd.org", "OECD", "institutional_analysis"),
    "ers.usda.gov": ("usda.gov", "USDA Economic Research Service", "government_research"),
    "www.ers.usda.gov": ("usda.gov", "USDA Economic Research Service", "government_research"),
    "www.samr.gov.cn": ("samr.gov.cn", "State Administration for Market Regulation", "regulatory_documentation"),
    "www.gov.cn": ("gov.cn", "State Council of the People's Republic of China", "government_documentation"),
    "www.stats.gov.cn": ("stats.gov.cn", "National Bureau of Statistics of China", "government_research"),
    "www.mofcom.gov.cn": ("mofcom.gov.cn", "Ministry of Commerce of China", "government_documentation"),
    "www.trade.gov": ("trade.gov", "International Trade Administration", "government_documentation"),
    "www.fda.gov": ("fda.gov", "US Food and Drug Administration", "regulatory_documentation"),
    "www.iais.org": ("iais.org", "International Association of Insurance Supervisors", "institutional_analysis"),
    "www.mca.org.uk": ("mca.org.uk", "Management Consultancies Association", "industry_association_research"),
    "www.wipo.int": ("wipo.int", "World Intellectual Property Organization", "institutional_research"),
    "www.nist.gov": ("nist.gov", "National Institute of Standards and Technology", "government_research"),
    "ai-challenges.nist.gov": ("nist.gov", "National Institute of Standards and Technology", "government_research"),
    "single-market-economy.ec.europa.eu": ("europa.eu", "European Commission", "regulatory_documentation"),
    "www.ilo.org": ("ilo.org", "International Labour Organization", "institutional_research"),
    "www.unesco.org": ("unesco.org", "UNESCO", "institutional_research"),
    "www.iea.org": ("iea.org", "International Energy Agency", "institutional_research"),
    "www.unep.org": ("unep.org", "United Nations Environment Programme", "institutional_research"),
    "www.who.int": ("who.int", "World Health Organization", "institutional_research"),
}

GOOGLE_BASELINE_URL = "https://developers.google.com/search/docs/appearance/ai-features"
RESEARCH_PAPER_SCOPE = (
    "可见度指标不等于事实准确性/行业效果/收入；实验设定须在已读取窗口核对；不得制造引用/引语/数据。"
    " Only the exact read excerpt is evidence; do not attribute unread appendices, code, "
    "or repository details to this source. Controlled visibility results do not establish "
    "the selected industry's results or current production-platform behaviour."
)

DEFAULT_SOURCES = [
    {
        "url": GOOGLE_BASELINE_URL,
        "title": "AI features and your website",
        "tags": ["geo", "AI搜索", "AI search", "seo", "引用", "索引", "可见度", "监测", "技术", "结构化"],
    },
    {
        "url": "https://arxiv.org/html/2605.25517v1",
        "title": "What Gets Cited: Competitive GEO in AI Answer Engines",
        "tags": ["geo", "AI搜索", "AI search", "引用", "citation", "可见度", "visibility", "内容", "content", "证据", "机制", "实验", "结构化"],
        "excerpt_anchor": "Identifying which content attributes drive LLM citations",
        "scope_notes": (
            "Controlled comparisons of supplied source variants, not a live search-index experiment. "
            "Use exact per-model table values in the read excerpt; reported odds ratios are odds "
            "multipliers, not citation probabilities or percentage-point gains. Model-specific "
            "results and estimation warnings must not be merged into a universal effect."
        ),
    },
    {
        "url": "https://arxiv.org/html/2311.09735v3",
        "title": "GEO: Generative Engine Optimization",
        "tags": ["geo", "AI搜索", "AI search", "引用", "citation", "可见度", "visibility", "内容", "content", "证据", "机制", "实验", "结构化"],
        "excerpt_anchor": "In accordance with previous works",
        "scope_notes": (
            "The selected experimental passage includes visibility definitions and Table 1 comparisons. "
            "Keep the model, dataset, baseline and metric attached to each finding; a visibility-score "
            "change is not a citation-probability change or proof of real-world retrieval performance."
        ),
    },
    {
        "url": "https://developers.google.com/search/docs/fundamentals/creating-helpful-content",
        "title": "Creating helpful, reliable, people-first content",
        "tags": ["geo", "内容", "content", "证据", "信任", "权威", "质量", "原创", "品牌"],
    },
    {
        "url": "https://blogs.bing.com/search/April-2025/Introducing-Copilot-Search-in-Bing",
        "title": "Introducing Copilot Search in Bing",
        "tags": ["geo", "AI搜索", "AI search", "引用", "citation", "推荐", "品牌", "搜索"],
    },
    {
        "url": "https://www.bcg.com/x/the-multiplier/how-generative-engines-bring-web-to-you",
        "title": "Reimagining Discoverability: How Generative Engines Bring the Web to You",
        "tags": ["geo", "AI搜索", "AI search", "品牌", "营销", "战略", "增长", "预算", "转化", "衡量"],
    },
    {
        "url": "https://www.bing.com/webmasters/help/bing-webmaster-guidelines-30fba23a",
        "title": "Bing Webmaster Guidelines",
        "tags": ["geo", "seo", "技术", "抓取", "索引", "引用", "内容", "质量"],
    },
    {
        "url": "https://www.bcg.com/publications/2025/how-cmos-scaling-gen-ai-in-turbulent-times",
        "title": "How CMOs Are Scaling GenAI in Turbulent Times",
        "tags": ["营销", "cmo", "roi", "组织", "团队", "预算", "投资", "运营", "衡量", "规模"],
    },
    {
        "url": "https://www.bcg.com/publications/2026/making-the-agentic-marketing-transformation-a-reality",
        "title": "Making the Agentic Marketing Transformation a Reality",
        "tags": ["营销", "marketing", "cmo", "组织", "团队", "运营", "转型", "增长", "品牌", "agentic", "智能体"],
    },
    {
        "url": "https://www.bcg.com/publications/2026/agentic-scenarios-every-marketer-must-prepare-for",
        "title": "Agentic Scenarios Every Marketer Must Prepare For",
        "tags": ["营销", "marketing", "品牌", "战略", "情景", "规划", "预算", "投资", "转化", "agentic", "智能体"],
    },
    {
        "url": "https://www.oecd.org/en/topics/innovation-and-digital-in-agriculture.html",
        "title": "Innovation and digital in agriculture",
        "tags": ["信任", "证据", "投入", "成本", "预算", "采用", "数字化"],
        "industries": ["agriculture_technology"],
        "excerpt_anchor": "Innovation and digitalisation are transformative forces",
        "scope_notes": "OECD policy synthesis about agricultural digitalisation: adoption barriers and trust. It does not measure a brand's GEO conversion, prove procurement-cycle length, or establish that its market is currently more competitive.",
    },
    {
        "url": "https://www.fao.org/newsroom/detail/fao-state-of-food-and-agriculture--sofa-2022-automation-agrifood-systems/en",
        "title": "The State of Food and Agriculture 2022: Leveraging automation to transform agrifood systems",
        "tags": ["采用", "成本", "投入", "预算", "证据", "基础设施", "自动化"],
        "industries": ["agriculture_technology"],
        "published": "2022-11-02",
        "scope_notes": "FAO's own 2022 report announcement discussing 27 global case studies, adoption and local enabling conditions. This is the complete announcement body, not the full report or evidence of current Chinese agricultural technology purchasing behaviour.",
    },
    {
        "url": "https://ers.usda.gov/data-products/charts-of-note/110550",
        "title": "Precision agriculture use increases with farm size and varies widely by technology",
        "tags": ["分层", "采用", "规模", "投入", "成本", "预算", "证据"],
        "industries": ["agriculture_technology"],
        "published": "2024-12-10",
        "scope_notes": "USDA analysis of US farms in 2023, stratified by farm size and technology. Adoption percentages describe those US populations and technologies only; they are not Chinese market estimates, GEO metrics or a causal estimate of marketing effectiveness.",
    },
    {
        "url": "https://www.oecd.org/en/publications/progress-in-implementing-the-european-union-coordinated-plan-on-artificial-intelligence-volume-2_3ac96d41-en/full-report/ai-in-agriculture_c9ac6d24.html",
        "title": "AI in agriculture — Progress in Implementing the European Union Coordinated Plan on Artificial Intelligence (Volume 2)",
        "tags": ["采用", "证据", "信任", "成本", "预算", "采购", "投资"],
        "industries": ["agriculture_technology"],
        "excerpt_anchor": "Scepticism among European farmers",
        "scope_notes": "OECD chapter on EU agriculture; the selected passage includes interview-based adoption observations. Attribute interview anecdotes and geography explicitly; do not generalise them into universal procurement timelines, Chinese market statistics or GEO outcomes.",
    },
]

INDUSTRY_ALIASES = {
    "agriculture_technology": ("农业科技", "农科", "农业技术", "智慧农业", "数字农业", "精准农业", "农业", "agriculture technology", "agricultural technology", "agriculture", "agricultural", "agritech", "agri-tech", "agtech", "digital farming", "precision farming"),
    "livestream_commerce": ("直播电商", "直播带货", "直播营销", "live commerce", "livestream commerce", "live-streaming commerce", "live shopping", "livestream shopping", "live-streaming e-commerce"),
    "local_services": ("本地生活", "本地服务", "local services", "local businesses", "local business", "local ranking", "service-area business", "service-area businesses"),
    "medical_aesthetics": ("医美", "医疗美容", "medical aesthetics", "cosmetic procedures", "cosmetic surgery", "cosmetic surgeons", "dermal fillers", "aesthetic medicine", "aesthetic procedures", "plastic surgery"),
    "insurance": ("保险", "insurance", "insurers", "insurance companies"),
    "management_consulting": ("管理咨询", "管理顾问", "management consulting", "management consultancy", "management consultancies", "consulting services", "consultancy services", "consulting firms", "consultancies"),
    "cosmetics_personal_care": ("美妆个护", "化妆品", "美容个护", "cosmetics", "cosmetic products", "personal care products", "beauty products"),
    "b2b_export": ("b2b外贸", "b2b外贸出口", "b2b exports", "b2b export", "b2b ecommerce", "b2b e-commerce", "b2b trade", "business-to-business", "b2b"),
    "physical_retail": ("线下门店", "实体门店", "实体零售", "实体店", "physical retail", "physical stores", "brick-and-mortar", "retail store", "retail stores", "in-store products"),
    "intellectual_property": ("知识产权", "intellectual property", "patents", "trademarks", "ip offices"),
    "ai_tools": ("ai工具", "人工智能工具", "ai tools", "artificial intelligence tools", "generative ai", "ai systems", "generative artificial intelligence", "ai agents", "agentic ai", "ai models"),
}

INDUSTRY_SEARCH_PROFILES = {
    "agriculture_technology": {"zh": ["农业科技", "数字农业"], "en": ["agricultural technology", "precision agriculture"],
        "domains": ["www.fao.org", "www.oecd.org", "ers.usda.gov", "www.ers.usda.gov"], "focus": "adoption costs farmer evidence trust"},
    "livestream_commerce": {"zh": ["直播电商", "直播营销"], "en": ["livestream commerce", "live shopping"],
        "domains": ["www.samr.gov.cn", "www.mofcom.gov.cn", "www.gov.cn", "www.bcg.com"], "focus": "consumer trust advertising claims disclosure research"},
    "local_services": {"zh": ["本地生活", "本地服务"], "en": ["local business", "local services"],
        "domains": ["support.google.com", "developers.google.com", "www.samr.gov.cn", "www.bcg.com"], "focus": "customer discovery reviews business information measurement"},
    "medical_aesthetics": {"zh": ["医疗美容", "医美"], "en": ["medical aesthetics", "cosmetic procedures"],
        "domains": ["www.fda.gov", "www.samr.gov.cn", "www.gov.cn", "www.bcg.com"], "focus": "patient information advertising claims evidence outcomes"},
    "insurance": {"zh": ["保险"], "en": ["insurance", "insurers"],
        "domains": ["www.iais.org", "www.oecd.org", "www.bcg.com"], "focus": "consumer distribution digitalisation evidence survey"},
    "management_consulting": {"zh": ["管理咨询"], "en": ["management consulting", "consultancy services"],
        "domains": ["www.mca.org.uk", "www.bcg.com", "www.oecd.org"], "focus": "client survey procurement value outcomes evidence"},
    "cosmetics_personal_care": {"zh": ["化妆品", "美妆个护"], "en": ["cosmetics", "personal care products"],
        "domains": ["www.fda.gov", "single-market-economy.ec.europa.eu", "www.samr.gov.cn", "www.bcg.com"], "focus": "product claims consumer trust evidence research"},
    "b2b_export": {"zh": ["B2B外贸", "B2B出口"], "en": ["B2B exports", "B2B cross-border ecommerce"],
        "domains": ["www.trade.gov", "www.mofcom.gov.cn", "www.oecd.org", "www.bcg.com"], "focus": "international buyer supplier digital strategy trust research"},
    "physical_retail": {"zh": ["线下门店", "实体零售"], "en": ["physical retail", "brick-and-mortar stores"],
        "domains": ["support.google.com", "www.bcg.com", "www.stats.gov.cn", "www.mofcom.gov.cn"], "focus": "customer discovery reviews store information survey"},
    "intellectual_property": {"zh": ["知识产权"], "en": ["intellectual property", "patents trademarks"],
        "domains": ["www.wipo.int", "www.gov.cn", "www.bcg.com"], "focus": "business evidence international markets statistics"},
    "ai_tools": {"zh": ["AI工具", "生成式人工智能"], "en": ["AI tools", "generative artificial intelligence"],
        "domains": ["www.nist.gov", "ai-challenges.nist.gov", "www.oecd.org", "www.bcg.com", "developers.google.com"], "focus": "evaluation measurement reliability adoption evidence"},
}

# Every actual industry label in assets/blog_articles.xlsx has its own canonical
# identity, English discovery terms and scope. Domains below were verified as
# official publishers with relevant sector research; a domain alone never proves
# that a result belongs to a sector. Source bodies still need exact term matches.
INDUSTRY_DOMAIN_GROUPS = {
    "digital": ["www.nist.gov", "www.oecd.org", "www.bcg.com", "www.gov.cn"],
    "commercial_services": ["www.oecd.org", "www.mca.org.uk", "www.bcg.com", "www.mofcom.gov.cn"],
    "workforce": ["www.ilo.org", "www.oecd.org", "www.bcg.com", "www.gov.cn"],
    "education": ["www.unesco.org", "www.ilo.org", "www.oecd.org", "www.gov.cn"],
    "creative": ["www.unesco.org", "www.wipo.int", "www.oecd.org", "www.bcg.com"],
    "consumer": ["www.samr.gov.cn", "www.mofcom.gov.cn", "www.stats.gov.cn", "www.bcg.com"],
    "health": ["www.who.int", "www.fda.gov", "www.oecd.org", "www.gov.cn"],
    "industrial": ["www.nist.gov", "www.oecd.org", "www.trade.gov", "www.bcg.com"],
    "energy": ["www.iea.org", "www.unep.org", "www.oecd.org", "www.bcg.com"],
    "built_environment": ["www.unep.org", "www.iea.org", "www.oecd.org", "www.stats.gov.cn"],
    "trade": ["www.trade.gov", "www.mofcom.gov.cn", "www.oecd.org", "www.bcg.com"],
    "professional": ["www.oecd.org", "www.gov.cn", "www.mca.org.uk", "www.bcg.com"],
    "financial": ["www.oecd.org", "www.iais.org", "www.bcg.com", "www.gov.cn"],
    "travel": ["www.oecd.org", "www.trade.gov", "www.mofcom.gov.cn", "www.bcg.com"],
}

ADDITIONAL_INDUSTRY_PROFILES = [
    ("direct_to_consumer", "DTC品牌", ("direct-to-consumer brands", "DTC brands", "direct-to-consumer businesses"), "consumer", "customer acquisition retention direct sales evidence"),
    ("software_as_a_service", "SaaS", ("software as a service", "SaaS", "software-as-a-service"), "digital", "enterprise buying subscription retention evaluation evidence"),
    ("cloud_computing", "云计算", ("cloud computing", "cloud services", "cloud service providers"), "digital", "service procurement cost reliability adoption evidence"),
    ("human_resources", "人力资源", ("human resources", "human resource management", "HR services"), "workforce", "workforce skills service procurement evidence"),
    ("enterprise_services", "企业服务", ("enterprise services", "business support services", "B2B services"), "commercial_services", "business customer procurement service quality evidence"),
    ("exhibition_services", "会展服务", ("exhibition services", "trade show services", "business event services"), "trade", "exhibitor buyer lead qualification expenditure evidence"),
    ("low_code", "低代码", ("low-code development", "low-code platforms", "low-code application platforms"), "digital", "software evaluation adoption development cost evidence"),
    ("supply_chain", "供应链", ("supply chains", "supply chain management", "supply chain services"), "trade", "supplier selection visibility resilience costs evidence"),
    ("public_relations", "公关传播", ("public relations", "strategic communications", "corporate communications"), "creative", "reputation media credibility measurement evidence"),
    ("elderly_care", "养老服务", ("elderly care services", "long-term care", "aged care services"), "health", "service quality needs care providers evidence"),
    ("content_platforms", "内容平台", ("digital content platforms", "content publishing platforms", "creator platforms"), "creative", "creators distribution discovery monetisation evidence"),
    ("manufacturing", "制造业", ("manufacturing", "manufacturing industry", "manufacturers"), "industrial", "supplier purchasing quality productivity evidence"),
    ("healthcare", "医疗健康", ("healthcare", "health care services", "medical services"), "health", "patient information service quality trust evidence"),
    ("brand_consulting", "品牌咨询", ("brand consulting", "brand consultancy", "brand strategy consulting"), "commercial_services", "client selection positioning brand architecture evidence"),
    ("laboratory_equipment", "实验室设备", ("laboratory equipment", "laboratory instruments", "analytical instruments"), "industrial", "instrument procurement validation specifications evidence"),
    ("pet_products_services", "宠物", ("pet products", "pet care", "pet food"), "consumer", "product claims consumer purchasing veterinary evidence"),
    ("home_improvement", "家居家装", ("home improvement", "home furnishings", "home renovation"), "consumer", "customer selection installation service quality evidence"),
    ("industrial_products", "工业品", ("industrial products", "industrial supplies", "MRO supplies"), "industrial", "technical procurement supplier specifications evidence"),
    ("construction_engineering", "工程建筑", ("construction industry", "building construction", "construction engineering"), "built_environment", "procurement building performance project costs evidence"),
    ("advertising_marketing", "广告营销", ("advertising industry", "marketing services", "advertising agencies"), "commercial_services", "advertiser agency selection attribution effectiveness evidence"),
    ("film_entertainment", "影视文娱", ("film industry", "audiovisual industry", "entertainment industry"), "creative", "audience discovery distribution production evidence"),
    ("real_estate", "房地产", ("real estate", "property market", "housing market"), "built_environment", "buyer search property information transaction evidence"),
    ("recruitment_platforms", "招聘平台", ("online recruitment platforms", "job boards", "recruitment marketplaces"), "workforce", "job matching employer applicant trust evidence"),
    ("education_training", "教育培训", ("education and training", "education providers", "training providers"), "education", "learner choice learning outcomes quality evidence"),
    ("data_services", "数据服务", ("data services", "data-as-a-service", "data analytics services"), "digital", "data provider quality provenance licensing evidence"),
    ("clean_energy", "新能源", ("clean energy", "renewable energy", "new energy technologies"), "energy", "technology investment adoption lifetime costs evidence"),
    ("smart_hardware", "智能硬件", ("smart hardware", "connected devices", "smart devices"), "digital", "device evaluation interoperability reliability evidence"),
    ("apparel_footwear_accessories", "服装鞋包", ("apparel and footwear", "fashion industry", "clothing and accessories"), "consumer", "consumer product discovery fit sourcing evidence"),
    ("maternal_infant", "母婴", ("maternal and infant products", "baby care products", "mother and baby products"), "consumer", "product information infant care consumer trust evidence"),
    ("automotive", "汽车", ("automotive industry", "car buyers", "automobile industry"), "industrial", "vehicle buying dealer information ownership costs evidence"),
    ("legal_services", "法律服务", ("legal services", "law firms", "legal service providers"), "professional", "client choice service quality access evidence"),
    ("consumer_electronics", "消费电子", ("consumer electronics", "electronic consumer products", "consumer electronic devices"), "consumer", "buyer comparison technical specifications ownership evidence"),
    ("gaming", "游戏", ("video games", "gaming industry", "game developers"), "creative", "player discovery distribution engagement evidence"),
    ("logistics", "物流", ("logistics", "logistics services", "freight services"), "trade", "shipper carrier selection delivery reliability costs evidence"),
    ("environmental_technology", "环保科技", ("environmental technology", "environmental technologies", "pollution control technology"), "energy", "verified environmental performance adoption procurement evidence"),
    ("study_abroad_services", "留学服务", ("study abroad services", "international student recruitment", "education agents"), "education", "student advice provider choice service quality evidence"),
    ("paid_knowledge", "知识付费", ("paid knowledge products", "knowledge commerce", "paid educational content"), "creative", "content subscriptions learner willingness to pay evidence"),
    ("community_platforms", "社群平台", ("online community platforms", "community software", "community management platforms"), "digital", "community engagement moderation platform adoption evidence"),
    ("owned_customer_channels", "私域运营", ("private-domain marketing", "owned-channel marketing", "customer community operations"), "commercial_services", "customer retention owned channels measurement evidence"),
    ("cybersecurity", "网络安全", ("cybersecurity", "cyber security", "information security services"), "digital", "buyer evaluation assurance security control evidence"),
    ("vocational_education", "职业教育", ("vocational education", "vocational training", "technical and vocational education"), "education", "skills employment outcomes training quality evidence"),
    ("tax_accounting", "财税服务", ("tax and accounting services", "bookkeeping services", "tax advisory"), "professional", "client compliance provider quality digitalisation evidence"),
    ("cross_border_ecommerce", "跨境电商", ("cross-border ecommerce", "cross-border e-commerce", "cross border e-commerce"), "trade", "international online buyers trust market access evidence"),
    ("software_outsourcing", "软件外包", ("software outsourcing", "outsourced software development", "software development outsourcing"), "digital", "vendor selection delivery quality development costs evidence"),
    ("sports_outdoors", "运动户外", ("sporting goods", "sports and outdoor equipment", "outdoor recreation products"), "consumer", "consumer selection equipment performance product evidence"),
    ("franchising", "连锁加盟", ("franchising", "franchise networks", "franchise businesses"), "trade", "franchisee selection disclosure support economics evidence"),
    ("hospitality_tourism", "酒店旅游", ("hospitality and tourism", "hotel industry", "tourism businesses"), "travel", "traveller booking reviews accommodation demand evidence"),
    ("fintech", "金融科技", ("fintech", "financial technology", "digital financial services"), "financial", "customer adoption financial service trust evidence"),
    ("restaurant_chains", "餐饮连锁", ("restaurant chains", "chain restaurants", "chain foodservice"), "consumer", "diner choice menus locations franchise evidence"),
]

for _key, _zh, _en, _group, _focus in ADDITIONAL_INDUSTRY_PROFILES:
    INDUSTRY_ALIASES[_key] = tuple(dict.fromkeys((_zh.lower(), *(value.lower() for value in _en))))
    INDUSTRY_SEARCH_PROFILES[_key] = {"zh": [_zh], "en": list(_en),
        "domains": INDUSTRY_DOMAIN_GROUPS[_group], "focus": _focus}

# Discovery language must also be recognised in the body that discovery finds.
for _key, _profile in INDUSTRY_SEARCH_PROFILES.items():
    INDUSTRY_ALIASES[_key] = tuple(dict.fromkeys((*INDUSTRY_ALIASES[_key],
        *(term.lower() for term in _profile["zh"] + _profile["en"]))))

INDUSTRY_SCOPE_NOTES = {
    "direct_to_consumer": "DTC is direct brand-to-consumer selling; general ecommerce or retail statistics do not establish DTC outcomes.",
    "enterprise_services": "The source must concern suppliers or buyers of business services, not merely mention a business using any service.",
    "content_platforms": "Require a content-hosting/distribution or creator-platform context; general content marketing is a different activity.",
    "brand_consulting": "Brand positioning, architecture and strategy consultancy is distinct from ad buying, design and management consulting.",
    "public_relations": "Organisational reputation, media relations and corporate communications are distinct from all advertising activity.",
    "recruitment_platforms": "Online recruitment marketplaces differ from HR software, staffing agencies and general gig-economy platforms.",
    "paid_knowledge": "Paid knowledge is a business-model category without one global statistical definition. Do not equate it to all edtech or news subscriptions.",
    "community_platforms": "Community-platform software differs from general social media and a company's own community-operations activity.",
    "owned_customer_channels": "Owned-channel/private-domain marketing is a scoped analogy, not a standard global industry. CRM, membership or social-media totals are not private-domain market size.",
    "study_abroad_services": "Study-abroad recruitment/advice services differ from total international-student numbers or university tuition revenue.",
    "software_outsourcing": "Outsourced software development differs from all IT outsourcing, including infrastructure and operations.",
    "sports_outdoors": "Sporting/outdoor products differ from sports participation, fitness services, events and outdoor tourism.",
    "franchising": "Franchise relationships differ from all chains, including company-owned stores.",
    "maternal_infant": "Maternal/infant consumer products differ from maternity medical services, education and general household spending.",
    "industrial_products": "MRO supplies are a subset of industrial products, not all manufactured output.",
    "smart_hardware": "Specify consumer or industrial connected hardware; semiconductor and software totals are not smart-device market size.",
    "data_services": "Data provision/processing/analytics services differ from all cloud storage, data centres or AI tools.",
    "low_code": "Low-code and no-code are adjacent categories; if a study combines them, retain that scope explicitly.",
    "b2b_export": "Business-to-business international trade differs from all cross-border consumer ecommerce; use shared planning guidance only within its stated B2B/B2C scope.",
    "cross_border_ecommerce": "Cross-border online transactions differ from all domestic ecommerce and total merchandise exports; keep B2B/B2C coverage explicit.",
}

DEFAULT_SOURCES.extend([
    {"url": "https://www.samr.gov.cn/zw/zfxxgk/fdzdgknr/fgs/art/2026/art_ce66ea61fcec4583b5dbd677f470088b.html",
     "title": "直播电商监督管理办法", "tags": ["直播", "信任", "内容", "治理"], "industries": ["livestream_commerce"], "published": "2026-01-07",
     "scope_notes": "Chinese rules for livestream commerce. Supports only the stated obligations and scope; it is not a measure of market growth, customer acquisition or GEO effectiveness. Check applicability before transferring an obligation to a different actor or jurisdiction."},
    {"url": "https://support.google.com/business/answer/7091?hl=en",
     "title": "Tips to improve your local ranking on Google", "tags": ["搜索", "信息", "品牌", "评价"], "industries": ["local_services", "physical_retail"],
     "scope_notes": "Google documentation for local businesses and eligible retail stores. Supports Google local-search mechanisms and profile information practices only; it cannot establish ChatGPT citation behaviour, a China-wide local-services trend, or store revenue lift."},
    {"url": "https://www.trade.gov/ecommerce-digital-strategy",
     "title": "eCommerce Digital Strategy", "tags": ["跨境", "品牌", "预算", "指标"], "industries": ["cross_border_ecommerce"],
     "scope_notes": "US International Trade Administration guidance for cross-border ecommerce. It offers a planning framework, not a measured B2B-only purchasing cycle or a forecast of Chinese exporters' GEO returns."},
    {"url": "https://www.trade.gov/european-b2b-ecommerce-markets-forecast",
     "title": "European B2B eCommerce Markets Forecast", "tags": ["B2B", "外贸", "跨境", "采购", "证据"], "industries": ["b2b_export"],
     "scope_notes": "ITA's European B2B ecommerce outlook, including cross-border transactions and digital purchasing. Preserve its European geography, base years and forecast horizon; distinguish cited projections from observed outcomes. It does not measure Chinese exporters' buying cycles or GEO returns."},
    {"url": "https://www.fda.gov/medical-devices/aesthetic-cosmetic-devices/dermal-fillers-soft-tissue-fillers",
     "title": "Dermal Fillers (Soft Tissue Fillers)", "tags": ["证据", "信息", "医美", "信任"], "industries": ["medical_aesthetics"],
     "scope_notes": "US FDA information about dermal-filler uses, evidence and patient/professional information. Does not measure Chinese medical-aesthetics demand, lead conversion or clinical outcomes for all procedures; US product approval is not a clinic endorsement."},
    {"url": "https://www.samr.gov.cn/zw/zfxxgk/fdzdgknr/ggjgs/art/2023/art_d1b46dbc27214abcace53a0ec539f7bb.html",
     "title": "市场监管总局关于发布《医疗美容广告执法指南》的公告", "tags": ["医美", "信息", "品牌", "广告", "证据"], "industries": ["medical_aesthetics"], "published": "2021-11-02",
     "scope_notes": "SAMR's 2021 Chinese medical-aesthetics advertising enforcement guidance, including the distinction between public service information and advertising. The URL migration year is not the publication year. Check current applicable rules before making a legal claim; this is not efficacy, demand or acquisition data."},
    {"url": "https://www.iais.org/2026/07/iais-mid-year-global-insurance-market-report-2026-reflects-insurance-sector-stability-amid-global-uncertainty/",
     "title": "IAIS mid-year Global Insurance Market Report 2026 reflects insurance sector stability amid global uncertainty",
     "tags": ["保险", "指标", "证据", "趋势"], "industries": ["insurance"], "published": "2026-07-09",
     "scope_notes": "IAIS interim 2026 monitoring release describing global insurance-sector conditions primarily at end-2025. This is the release body, not the full report, and does not measure any individual Chinese insurer, product, distribution channel or GEO ROI."},
    {"url": "https://www.mca.org.uk/press-releases/uk-businesses-grapple-with-cost-pressures-cyber-risks-and-stalled-economic-growth-according-to-new-mca-research",
     "title": "UK businesses grapple with cost pressures, cyber risks and stalled economic growth according to new MCA research",
     "tags": ["咨询", "客户", "证据", "成果", "预算"], "industries": ["management_consulting"], "published": "2026-05-06",
     "scope_notes": "MCA/Savanta Client Survey 2026 of more than 350 senior users of consulting services in the UK, including private/public sectors. Self-reported client priorities and assessments are not representative of Chinese buyers and do not measure GEO attribution."},
    {"url": "https://www.fda.gov/cosmetics/registration-listing-cosmetic-product-facilities-and-products",
     "title": "Registration & Listing of Cosmetic Product Facilities and Products",
     "tags": ["化妆品", "品牌", "证据", "信息"], "industries": ["cosmetics_personal_care"],
     "scope_notes": "US MoCRA facility-registration and product-listing information. Registration/listing does not mean FDA approval or a promotional certification; counts are not sales or unique brands. Do not treat US requirements as Chinese rules."},
    {"url": "https://single-market-economy.ec.europa.eu/sectors/cosmetics/legislation_en",
     "title": "Cosmetics legislation", "tags": ["化妆品", "信息", "证据", "品牌"], "industries": ["cosmetics_personal_care"],
     "scope_notes": "European Commission description of the EU finished-cosmetics framework, responsible persons, assessment, notification and product claims. Applicable to the EU context; not Chinese rules, market-demand estimates, or proof of a brand's sales and GEO returns."},
    {"url": "https://www.wipo.int/web-publications/ip-facts-and-figures-2025/en/global-intellectual-property-applications-and-active-ip-rights.html",
     "title": "IP Facts and Figures 2025 — Global intellectual property applications and active IP rights",
     "tags": ["知识产权", "国际", "市场", "指标"], "industries": ["intellectual_property"],
     "scope_notes": "WIPO compilation of 2024 IP filings and active rights. Patent applications, trademark class counts and rights in force are distinct units. None measures IP-service revenue, client leads, agency market share or GEO effectiveness."},
    {"url": "https://ai-challenges.nist.gov/genai",
     "title": "Evaluating Generative AI Technologies",
     "tags": ["AI", "评估", "证据", "可靠性"], "industries": ["ai_tools"],
     "scope_notes": "NIST evaluation-program design and bounded findings for generators, discriminators and prompting systems. Supports testing concepts and their limits; it is not a commercial tool ranking, universal benchmark, product endorsement or proof of customer ROI."},
    {"url": "https://www.nist.gov/programs-projects/building-evaluation-probes-agentic-ai",
     "title": "Building Evaluation Probes into Agentic AI",
     "tags": ["AI", "评估", "证据", "可靠性"], "industries": ["ai_tools"], "published": "2026-05-01",
     "scope_notes": "An ongoing NIST research project on evaluating agent responses against trusted documents. It is not a universal industry standard, guarantee against hallucinations, or demonstration of every commercial AI tool's performance."},
])
INDUSTRY_FIELDS = {"行业", "行业类别", "所属行业", "industry", "sector", "industry category"}
GENERIC_CATEGORIES = {"", "brand geo", "geo", "seo", "品牌化geo", "内容", "阶段路线图", "营销", "marketing"}

TOPIC_CONCEPTS = [
    ("geo", "generative engine", "aeo", "answer engine"),
    ("AI搜索", "AI search", "generative search", "copilot search"),
    ("品牌", "brand"), ("营销", "marketing", "cmo"),
    ("内容", "content"), ("引用", "citation", "cited"),
    ("信任", "trust", "权威", "authority"),
    ("监测", "衡量", "指标", "measurement", "performance", "analytics"),
    ("预算", "投资", "budget", "investment", "roi"),
    ("增长", "growth"), ("转化", "conversion"),
    ("组织", "团队", "运营", "operating model", "organization"),
    ("智能体", "agentic", "agents"),
    ("结构化", "structured data"), ("抓取", "索引", "crawl", "indexing"),
]


class ResearchError(RuntimeError):
    """The source pack cannot meet its evidence requirements."""


def _integer(name: str, default: int, low: int, high: int) -> int:
    try:
        value = int(os.environ.get(name, str(default)))
    except ValueError as exc:
        raise ResearchError(f"{name} must be an integer") from exc
    if not low <= value <= high:
        raise ResearchError(f"{name} must be between {low} and {high}")
    return value


def validate_source_url(url: str) -> str:
    """Accept only HTTPS on curated public publisher hosts, including redirects."""
    if not isinstance(url, str) or any(ord(ch) < 32 or ch.isspace() for ch in url):
        raise ResearchError("Source URL contains whitespace or control characters")
    try:
        parsed = urllib.parse.urlsplit(url)
        hostname = parsed.hostname or ""
        if parsed.scheme != "https" or parsed.username or parsed.password or parsed.port not in (None, 443):
            raise ResearchError("Source URLs must be HTTPS without credentials or custom ports")
        try:
            ipaddress.ip_address(hostname)
        except ValueError:
            pass
        else:
            raise ResearchError("IP address source URLs are not allowed")
        if hostname not in TRUSTED_HOSTS:
            raise ResearchError(f"Source host is not in the publisher allowlist: {hostname}")
        if hostname == "arxiv.org" and not parsed.path.startswith("/html/"):
            raise ResearchError("Research papers require an arXiv HTML full-text URL, not an abstract or PDF")
        # Tracking variants should not count as separate sources.
        query = urllib.parse.urlencode([
            (key, val) for key, val in urllib.parse.parse_qsl(parsed.query, keep_blank_values=True)
            if not key.lower().startswith("utm_") and key.lower() not in {"gclid", "fbclid", "recommendedarticles"}
        ])
        return urllib.parse.urlunsplit(("https", hostname, parsed.path or "/", query, ""))
    except ValueError as exc:
        raise ResearchError("Malformed source URL") from exc


class _SafeRedirect(urllib.request.HTTPRedirectHandler):
    max_redirections = 5
    max_repeats = 2

    def redirect_request(self, req: Any, fp: Any, code: int, msg: str, headers: Any, newurl: str) -> Any:
        safe_url = validate_source_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, safe_url)


class _BodyParser(HTMLParser):
    """Prefer semantic article body containers; remove navigation and hidden UI."""

    VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}
    BLOCK = {"p", "div", "li", "section", "article", "main", "h1", "h2", "h3", "h4", "tr", "blockquote", "br"}
    SKIP = {"script", "style", "noscript", "nav", "footer", "aside", "form", "button", "svg", "template", "iframe"}
    UI = re.compile(r"(?:^|[\s_-])(?:nav(?:igation)?|footer|cookie|breadcrumb|subscribe|newsletter|share-tools|related-content|related-articles)(?:$|[\s_-])", re.I)

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.stack: list[tuple[str, bool, int | None]] = []
        self.candidates: list[dict[str, Any]] = []
        self.fallback: list[str] = []
        self.title: list[str] = []
        self.meta: dict[str, str] = {}

    def _append(self, text: str) -> None:
        if any(frame[1] for frame in self.stack):
            return
        if any(frame[0] == "title" for frame in self.stack):
            self.title.append(text)
            return
        if any(frame[0] == "head" for frame in self.stack):
            return
        self.fallback.append(text)
        for _, _, index in self.stack:
            if index is not None:
                self.candidates[index]["parts"].append(text)

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attributes = dict(attrs)
        if tag == "meta":
            key = attributes.get("property") or attributes.get("name") or attributes.get("itemprop")
            value = attributes.get("content")
            if key and value:
                self.meta[key.lower()] = value.strip()
        marker = f"{attributes.get('class') or ''} {attributes.get('id') or ''}"
        skip = (tag in self.SKIP or (tag not in {"html", "body"} and bool(self.UI.search(marker))) or "hidden" in attributes
                or attributes.get("aria-hidden", "").lower() == "true"
                or bool(re.search(r"display\s*:\s*none|visibility\s*:\s*hidden", attributes.get("style") or "", re.I)))
        inherited_skip = skip or any(frame[1] for frame in self.stack)
        if tag in self.BLOCK:
            self._append("\n")
        index = None
        if not inherited_skip:
            body_marker = bool(re.search(r"article[-_ ]?(?:body|content)|post[-_ ]?(?:body|content)|devsite-article-body|richtextbody|news-detail__body", marker, re.I))
            priority = 3 if body_marker or attributes.get("itemprop") == "articleBody" else 2 if tag == "article" else 1 if tag == "main" or attributes.get("role") == "main" else 0
            if priority:
                index = len(self.candidates)
                self.candidates.append({"priority": priority, "parts": []})
        if tag not in self.VOID:
            self.stack.append((tag, inherited_skip, index))

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.handle_starttag(tag, attrs)
        if tag not in self.VOID:
            self.handle_endtag(tag)

    def handle_endtag(self, tag: str) -> None:
        if tag in self.BLOCK:
            self._append("\n")
        for index in range(len(self.stack) - 1, -1, -1):
            if self.stack[index][0] == tag:
                del self.stack[index:]
                break

    def handle_data(self, data: str) -> None:
        self._append(data)

    @staticmethod
    def normalize(parts: Sequence[str]) -> str:
        lines = [re.sub(r"\s+", " ", line).strip() for line in "".join(parts).splitlines()]
        return "\n".join(line for line in lines if line)

    def body(self) -> str:
        candidates = [(item["priority"], self.normalize(item["parts"])) for item in self.candidates]
        substantial = [(priority, body) for priority, body in candidates if len(body) >= 300]
        if substantial:
            return max(substantial, key=lambda item: (item[0], len(item[1])))[1]
        # Some official blogs have no semantic main/article containers.
        return self.normalize(self.fallback)


def _publication_day(value: str) -> str:
    """Parse a date value from an explicit date field, never scan body prose."""
    value = re.sub(r"\s+", " ", value.strip())
    if len(value) > 100:
        return ""
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}(?:[Tt ][0-9:.]+(?:[Zz]|[+-]\d{2}:?\d{2})?)?", value):
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00").replace("z", "+00:00")).date().isoformat()
        except ValueError:
            return ""
    for pattern in ("%B %d, %Y", "%b %d, %Y", "%d %B %Y", "%d %b %Y", "%Y年%m月%d日"):
        try:
            return datetime.strptime(value, pattern).date().isoformat()
        except ValueError:
            pass
    return ""


class _PublicationDateParser(HTMLParser):
    """Collect semantic date fields independently of the evidence body parser."""

    PUBLISHED_META = {"article:published_time", "datepublished", "citation_publication_date", "dc.date.issued", "dcterms.issued"}
    OTHER_DATE_META = {"date", "datecreated", "datemodified", "article:modified_time", "article:created_time", "dc.date.created", "dcterms.created"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.stack: list[tuple[str, bool, bool, int | None]] = []
        self.records: list[dict[str, Any]] = []
        self.other_dates = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attributes = dict(attrs)
        marker = f"{attributes.get('class') or ''} {attributes.get('id') or ''}"
        skip = (tag in _BodyParser.SKIP or (tag not in {"html", "body"} and bool(_BodyParser.UI.search(marker)))
                or "hidden" in attributes or attributes.get("aria-hidden", "").lower() == "true"
                or bool(re.search(r"display\s*:\s*none|visibility\s*:\s*hidden", attributes.get("style") or "", re.I)))
        skipped = skip or any(frame[1] for frame in self.stack)
        in_article = tag in {"main", "article"} or attributes.get("role") == "main" or any(frame[2] for frame in self.stack)
        in_head = any(frame[0] == "head" for frame in self.stack)
        if tag == "meta" and not skipped and (in_head or in_article or not self.stack):
            key = (attributes.get("property") or attributes.get("name") or attributes.get("itemprop") or "").lower()
            value = attributes.get("content") or ""
            if key in self.PUBLISHED_META and value:
                self.records.append({"origin": key, "values": [value], "parts": []})
            elif key in self.OTHER_DATE_META and value:
                self.other_dates = True
        index = None
        # A date in arbitrary prose, excluded UI or an unlabelled <time> is not
        # evidence of the current article's publication date.
        if (not skipped and not in_head and in_article and tag != "meta"
                and "datepublished" in (attributes.get("itemprop") or "").lower().split()):
            index = len(self.records)
            self.records.append({"origin": "visible datePublished", "values": [attributes.get("datetime") or attributes.get("content") or ""], "parts": []})
        elif not skipped and in_article and set((attributes.get("itemprop") or "").lower().split()) & {"datecreated", "datemodified"}:
            self.other_dates = True
        if tag not in _BodyParser.VOID:
            self.stack.append((tag, skipped, in_article, index))

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.handle_starttag(tag, attrs)
        if tag not in _BodyParser.VOID:
            self.handle_endtag(tag)

    def handle_endtag(self, tag: str) -> None:
        for index in range(len(self.stack) - 1, -1, -1):
            if self.stack[index][0] == tag:
                del self.stack[index:]
                break

    def handle_data(self, data: str) -> None:
        if not any(frame[1] for frame in self.stack):
            for _, _, _, index in self.stack:
                if index is not None:
                    self.records[index]["parts"].append(data)

    def result(self) -> dict[str, str]:
        evidence = []
        unreadable = False
        for record in self.records:
            values = record["values"] + ["".join(record["parts"]).strip()]
            for value in filter(None, values):
                day = _publication_day(value)
                if day:
                    evidence.append((record["origin"], day))
                else:
                    unreadable = True
        days = {day for _, day in evidence}
        note, status, published = "", "absent", ""
        if len(days) > 1:
            detail = "; ".join(dict.fromkeys(f"{origin}={day}" for origin, day in evidence))
            note = f"Publication date unconfirmed: conflicting publication fields ({detail}). Neither date is assumed to be a creation timestamp."
            status = "conflict"
        elif unreadable:
            note = "Publication date unconfirmed: an explicit publication field could not be interpreted consistently."
            status = "unconfirmed"
        elif days:
            published, status = next(iter(days)), "confirmed"
        elif self.other_dates:
            note = "Publication date unconfirmed: only creation, modification or unspecified date metadata was found; these dates are not substituted for publication."
            status = "unconfirmed"
        return {"publication_date": published, "publication_date_status": status, "publication_date_note": note}


def _publication_metadata(metadata: Mapping[str, str], candidate: Mapping[str, Any] | None = None) -> tuple[str, str]:
    published = metadata.get("publication_date", "")
    note = metadata.get("publication_date_note", "")
    # Curated dates may fill absent page metadata on new research, but must not
    # override conflicting or uninterpretable publication fields. Resume never
    # treats the old audit's potentially incorrect date as a curated fallback.
    if not published and metadata.get("publication_date_status", "absent") == "absent" and candidate:
        published = str(candidate.get("published") or "")
    return published, note


def _with_publication_note(scope_notes: str, note: str) -> str:
    return scope_notes if not note or note in scope_notes else f"{scope_notes} {note}".strip()


def extract_body(document: str) -> tuple[str, dict[str, str]]:
    parser = _BodyParser()
    parser.feed(document)
    parser.close()
    metadata = dict(parser.meta)
    metadata["title"] = metadata.get("og:title") or " ".join(parser.title).strip()
    dates = _PublicationDateParser()
    dates.feed(document)
    dates.close()
    metadata.update(dates.result())
    return parser.body(), metadata


def _fetch_source(source: Mapping[str, Any], max_bytes: int, timeout: int) -> tuple[str, str, dict[str, str], str]:
    url = validate_source_url(str(source.get("url", "")))
    if source.get("_fixture_path"):
        fixture = Path(source["_fixture_path"])
        with fixture.open("rb") as file:
            raw = file.read(max_bytes + 1)
        content_type = "text/html" if fixture.suffix.lower() in {".html", ".htm"} else "text/plain"
        charset, method = "utf-8", "local_fixture"
    else:
        request = urllib.request.Request(url, headers={
            "User-Agent": "Eco-GEO-EditorialBot/2.0 (+https://eco-geo.org/)",
            "Accept": "text/html,application/xhtml+xml,text/plain;q=0.8",
            "Accept-Encoding": "identity",
        })
        opener = urllib.request.build_opener(_SafeRedirect())
        with opener.open(request, timeout=timeout) as response:
            url = validate_source_url(response.geturl())
            if getattr(response, "status", 200) != 200:
                raise ResearchError(f"Source returned status {response.status}")
            content_type = response.headers.get_content_type()
            if content_type not in {"text/html", "application/xhtml+xml", "text/plain"}:
                raise ResearchError(f"Unsupported source content type: {content_type}")
            length = response.headers.get("Content-Length")
            if length and int(length) > max_bytes:
                raise ResearchError("Source response exceeds the byte limit")
            raw = response.read(max_bytes + 1)
            charset = response.headers.get_content_charset() or "utf-8"
        method = "https_fetch"
    if len(raw) > max_bytes:
        raise ResearchError("Source response exceeds the byte limit")
    document = raw.decode(charset, errors="replace")
    if content_type in {"text/html", "application/xhtml+xml"}:
        body, metadata = extract_body(document)
    else:
        body, metadata = _BodyParser.normalize([document]), {}
    return body, url, metadata, method


def _topic_text(topic: Any) -> str:
    context = getattr(topic, "context", {})
    return " ".join([str(getattr(topic, key, "")) for key in ("title", "category", "keywords")]
                    + [str(value) for value in context.values()]).lower()


def _matches(term: str, text: str) -> bool:
    term = term.strip().lower()
    if not term:
        return False
    if re.fullmatch(r"[a-z0-9 ]+", term):
        return re.search(r"(?<![a-z0-9])" + re.escape(term) + r"(?![a-z0-9])", text) is not None
    return term in text


def _industry_name(value: str) -> str:
    original = re.sub(r"\s+", " ", value.strip())
    normalised = original.lower()
    return next((key for key, aliases in INDUSTRY_ALIASES.items()
                 if normalised == key or normalised in aliases), original)


def _industry_values(value: Any) -> set[str]:
    values = re.split(r"[,，;；|/、]", value) if isinstance(value, str) else value
    if not isinstance(values, list) or any(not isinstance(item, str) for item in values):
        raise ResearchError("Source industries must be a list of exact industry names")
    return {_industry_name(item) for item in values if item.strip()}


def topic_industries(topic: Any) -> set[str]:
    """Prefer the Excel industry column; category aliases are exact fallbacks.

    An unrelated sector merely mentioned in a title/context never changes an
    explicitly declared industry (for example cloud services used by farmers).
    """
    context = getattr(topic, "context", {})
    explicit = [str(value) for key, value in context.items() if key.strip().lower() in INDUSTRY_FIELDS and value]
    if explicit:
        return {value for value in set().union(*(_industry_values(value) for value in explicit))
                if value.lower() not in GENERIC_CATEGORIES}
    category = str(getattr(topic, "category", "")).strip().lower()
    name = _industry_name(category)
    return {name} if name in INDUSTRY_ALIASES else set()


def industry_search_plan(topic: Any) -> dict[str, Any]:
    """Build independent industry research queries for the daily search caller.

    Search the industry itself, without requiring a GEO/AI-search intersection.
    Exact publisher domains are discovery filters only: every result must still
    pass URL validation, body extraction and industry matching before use.
    Unknown industries retain their exact original name and use general official
    research publishers; they never borrow evidence from a different industry.
    """
    industries = sorted(topic_industries(topic))
    terms: dict[str, list[str]] = {"zh": [], "en": []}
    domains: list[str] = []
    queries: list[str] = []
    for industry in industries:
        profile = INDUSTRY_SEARCH_PROFILES.get(industry)
        if profile is None:
            chinese = bool(re.search(r"[\u4e00-\u9fff]", industry))
            profile = {"zh": [industry] if chinese else [], "en": [] if chinese else [industry],
                       "domains": ["www.gov.cn", "www.stats.gov.cn", "www.samr.gov.cn", "www.mofcom.gov.cn", "www.oecd.org", "www.bcg.com"],
                       "focus": "industry customers adoption evidence official research"}
        for lang in terms:
            for value in profile[lang]:
                if value not in terms[lang]:
                    terms[lang].append(value)
        for domain in profile["domains"]:
            if domain not in TRUSTED_HOSTS:
                raise ResearchError(f"Industry search domain is not allowlisted: {domain}")
            if domain not in domains:
                domains.append(domain)
        english = profile["en"] or profile["zh"]
        chinese = profile["zh"] or profile["en"]
        english_terms = " OR ".join(f'"{value}"' for value in english[:2])
        chinese_terms = " OR ".join(f'"{value}"' for value in chinese[:2])
        queries.extend([
            f"({english_terms}) {profile['focus']} official research",
            f"({chinese_terms}) 行业 客户需求 证据 调查 官方研究",
        ])
    return {"industries": industries, "terms": terms, "domains": domains,
            "queries": queries, "source_role": "industry_context"}


def _industry_mentions(text: str, industries: set[str]) -> set[str]:
    text = text.lower()
    matches = {industry for industry in industries
               if any(_matches(alias, text) for alias in INDUSTRY_ALIASES.get(industry, (industry,)))}
    if "b2b_export" in matches and not any(_matches(term, text) for term in
            ("export", "exports", "exporting", "overseas", "cross-border", "cross border", "international trade", "外贸", "跨境", "出口")):
        matches.remove("b2b_export")
    return matches


def _excerpt(body: str, candidate: Mapping[str, Any], max_chars: int) -> tuple[str, int]:
    anchor = candidate.get("excerpt_anchor")
    start = 0
    if anchor:
        if not isinstance(anchor, str) or not anchor.strip():
            raise ResearchError("excerpt_anchor must be a nonempty exact passage")
        start = body.lower().find(anchor.lower())
        if start < 0:
            raise ResearchError("The configured source excerpt anchor was not found in the read body")
    return body[start:start + max_chars], start


def _relevance(source: Mapping[str, Any], topic_text: str) -> int:
    tags = source.get("tags", [])
    if isinstance(tags, str):
        tags = re.split(r"[,，;；|]", tags)
    if not isinstance(tags, list) or any(not isinstance(tag, str) for tag in tags):
        raise ResearchError("Source tags must be a list of strings")
    # Specific tags outrank generic GEO matches; custom topic tags should be narrow.
    return sum(1 if tag.lower() in {"geo", "seo", "AI搜索".lower(), "ai search"} else 3
               for tag in tags if _matches(tag, topic_text))


def _lead_relevance(title: str, topic_text: str) -> int:
    """Match current first-party leads across the Chinese/English topic boundary."""
    title = title.lower()
    score = sum(1 for concept in TOPIC_CONCEPTS
                if any(_matches(term, topic_text) for term in concept)
                and any(_matches(term, title) for term in concept))
    tokens = set(re.findall(r"[a-z]{3,}|[\u4e00-\u9fff]{2,}", topic_text))
    return score + sum(1 for term in tokens if _matches(term, title))


def _is_paper_candidate(candidate: Mapping[str, Any]) -> bool:
    # Classification comes from the validated original-publisher URL, never a
    # lead's self-declared evidence_kind. It only determines fetch priority.
    return TRUSTED_HOSTS[urllib.parse.urlsplit(candidate["url"]).hostname][2] == "research_paper"


def _load_candidates(topic: Any, news_items: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
    configured = os.environ.get("RESEARCH_SOURCE_FILE", "").strip()
    if configured:
        path = Path(configured).expanduser().resolve()
        try:
            obj = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            raise ResearchError(f"Cannot read RESEARCH_SOURCE_FILE: {exc}") from exc
        entries = obj.get("sources") if isinstance(obj, dict) else obj
        if not isinstance(entries, list):
            raise ResearchError("RESEARCH_SOURCE_FILE must contain a sources list")
    else:
        entries = DEFAULT_SOURCES
        path = None
    topic_text = _topic_text(topic)
    industries = topic_industries(topic)
    candidates = []
    for entry in entries:
        if not isinstance(entry, dict):
            raise ResearchError("Each research source must be an object")
        candidate = dict(entry)
        candidate["url"] = validate_source_url(candidate.get("url", ""))
        source_industries = _industry_values(candidate.get("industries", []))
        matched = industries & source_industries
        if source_industries and not matched:
            continue
        score = _relevance(candidate, topic_text)
        if not score and not matched:
            continue
        if candidate.get("text_file"):
            if path is None:
                raise ResearchError("Source fixtures require an explicit RESEARCH_SOURCE_FILE")
            candidate["_fixture_path"] = str((path.parent / candidate["text_file"]).resolve())
        candidate["_matched_industries"] = sorted(matched)
        candidate["_relevance"] = score + (100 if matched else 0)
        candidates.append(candidate)
    # A direct original-publisher URL may provide a lead. RSS titles/descriptions
    # are never copied into the evidence body or counted towards source minimums.
    if not configured:
        for item in news_items:
            try:
                url = validate_source_url(str(item.get("url", "")))
            except ResearchError:
                continue
            title = str(item.get("title", ""))
            score = _lead_relevance(title, topic_text)
            matched = _industry_mentions(title, industries)
            if item.get("discovery_role") == "industry_context":
                # The query role can justify fetching a generically titled page;
                # it does not constitute evidence. The actual read excerpt below
                # must still contain the selected industry's terms.
                matched |= industries & _industry_values(item.get("industries", []))
            if not score and not matched:
                continue
            # A rediscovered curated paper retains its verified excerpt anchor
            # and scope, even when a current lead increases its priority.
            curated = next((item for item in candidates if item["url"] == url), {})
            candidates.append({**curated, "url": url, "title": title, "_relevance": (150 if matched else 50) + score,
                               "_matched_industries": sorted(matched)})
    # Reserve the platform baseline and one industry candidate before trying
    # relevant papers. Try paper alternatives consecutively so a failed fetch
    # does not consume a slot or crowd out actual industry evidence.
    ranked = sorted(candidates, key=lambda item: item["_relevance"], reverse=True)
    first, rest, domains = [], [], set()
    baseline = next((item for item in ranked if item["url"] == GOOGLE_BASELINE_URL), None)
    if baseline is not None:
        first.append(baseline)
        domains.add("google.com")
    industry = next((item for item in ranked if item is not baseline and item.get("_matched_industries")), None)
    if industry is not None:
        first.append(industry)
        domains.add(TRUSTED_HOSTS[urllib.parse.urlsplit(industry["url"]).hostname][0])
    papers = [item for item in ranked if item is not baseline and item is not industry and _is_paper_candidate(item)]
    first.extend(papers)
    if papers:
        domains.add("arxiv.org")
    reserved = {id(item) for item in first}
    # Then retain publisher diversity and prioritize current relevant leads
    # over reusable background. Explicit source files receive no extra defaults.
    for item in ranked:
        if id(item) in reserved:
            continue
        domain = TRUSTED_HOSTS[urllib.parse.urlsplit(item["url"]).hostname][0]
        if domain in domains:
            rest.append(item)
        else:
            first.append(item)
            domains.add(domain)
    return first + rest


def build_research_pack(topic: Any, news_items: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
    """Read actual publisher bodies or explicit fixtures; fail closed if sparse.

    text contains only [excerpt_start, excerpt_end) of the normalized body. The
    model must not infer anything outside that exact window. published is empty
    when publication metadata is absent or ambiguous; retrieval time is not
    publication. Date conflicts are retained in the source's scope notes.
    """
    minimum = _integer("RESEARCH_MIN_SOURCES", 3, 3, 5)
    domains_min = _integer("RESEARCH_MIN_DOMAINS", 2, 2, 5)
    maximum = _integer("RESEARCH_MAX_SOURCES", 5, minimum, 5)
    min_chars = _integer("RESEARCH_MIN_BODY_CHARS", 900, 300, 10000)
    max_chars = _integer("RESEARCH_MAX_SOURCE_CHARS", 10000, min_chars, 10000)
    timeout = _integer("RESEARCH_FETCH_TIMEOUT", 20, 1, 45)
    max_bytes = _integer("RESEARCH_MAX_RESPONSE_BYTES", 2500000, 10000, 4000000)
    if domains_min > maximum:
        raise ResearchError("RESEARCH_MIN_DOMAINS exceeds RESEARCH_MAX_SOURCES")
    industries = topic_industries(topic)
    pack: list[dict[str, Any]] = []
    seen_urls, seen_bodies, publisher_domains = set(), set(), set()
    failures = []
    for candidate in _load_candidates(topic, news_items):
        requested_url = candidate["url"]
        if requested_url in seen_urls:
            continue
        candidate_domain = TRUSTED_HOSTS[urllib.parse.urlsplit(requested_url).hostname][0]
        covered_industries = {industry for item in pack for industry in item["industries"]}
        new_industries = set(candidate.get("_matched_industries", [])) - covered_industries
        if _is_paper_candidate(candidate) and any(item["evidence_kind"] == "research_paper" for item in pack) and not new_industries:
            continue
        if len(pack) >= maximum and candidate_domain in publisher_domains and not new_industries:
            continue
        seen_urls.add(requested_url)
        try:
            body, url, metadata, method = _fetch_source(candidate, max_bytes, timeout)
            if url != requested_url and url in seen_urls:
                continue
            seen_urls.add(url)
            if len(body) < min_chars:
                raise ResearchError(f"Extracted body has only {len(body)} characters; minimum {min_chars}")
            if re.search(r"access denied|just a moment|verify (?:you are|you're) human|robot check|page not found", metadata.get("title", ""), re.I):
                raise ResearchError("Source returned an error or access-check page instead of an article")
            excerpt, excerpt_start = _excerpt(body, candidate, max_chars)
            if len(excerpt) < min_chars:
                raise ResearchError(f"Selected excerpt has only {len(excerpt)} characters; minimum {min_chars}")
            matched_industries = set(candidate.get("_matched_industries", []))
            if matched_industries and _industry_mentions(excerpt, matched_industries) != matched_industries:
                raise ResearchError("Read excerpt does not contain the declared industry context")
            digest = hashlib.sha256(excerpt.encode("utf-8")).hexdigest()
            if digest in seen_bodies:
                continue
            domain, publisher, evidence_kind = TRUSTED_HOSTS[urllib.parse.urlsplit(url).hostname]
            published, publication_note = _publication_metadata(metadata, candidate)
            if len(pack) >= maximum:
                if domain in publisher_domains and not new_industries:
                    continue
                # A later successful source from a missing domain can replace a
                # duplicate publisher; initial fetch failures must not make the
                # diversity requirement impossible merely due to ordering.
                replaceable = []
                for index in range(len(pack) - 1, -1, -1):
                    # Keep the baseline. Prefer retaining the empirical paper,
                    # but mandatory industry evidence wins if capacity cannot
                    # accommodate both (for example, a multi-industry topic).
                    if pack[index]["requested_url"] == GOOGLE_BASELINE_URL:
                        continue
                    if pack[index]["evidence_kind"] == "research_paper" and evidence_kind != "research_paper" and not new_industries:
                        continue
                    remaining = pack[:index] + pack[index + 1:]
                    next_domains = {item["publisher_domain"] for item in remaining} | {domain}
                    next_industries = {industry for item in remaining for industry in item["industries"]} | matched_industries
                    if len(next_domains) >= min(domains_min, len(publisher_domains)) and next_industries >= covered_industries:
                        replaceable.append(index)
                if not replaceable:
                    continue
                duplicate = min(replaceable, key=lambda index: pack[index]["evidence_kind"] == "research_paper")
                pack.pop(duplicate)
            seen_bodies.add(digest)
            publisher_domains.add(domain)
            scope_notes = str(candidate.get("scope_notes") or (
                "Industry relevance was matched by title and confirmed in the read excerpt. Use only the geography, population, period and statements explicitly supported by the excerpt; do not infer GEO effectiveness."
                if matched_industries else
                "General platform, search or marketing context only. This source cannot establish the selected industry's buying cycle, competition, adoption rates, budget thresholds or GEO conversion."
            )) + " ".join(" Sector boundary: " + INDUSTRY_SCOPE_NOTES[industry]
                          for industry in sorted(matched_industries) if industry in INDUSTRY_SCOPE_NOTES)
            if evidence_kind == "research_paper":
                scope_notes = _with_publication_note(scope_notes, RESEARCH_PAPER_SCOPE)
            pack.append({
                "id": f"S{len(pack) + 1}",
                "title": metadata.get("title") or str(candidate.get("title") or urllib.parse.urlsplit(url).path),
                "url": url,
                "requested_url": requested_url,
                "publisher": publisher,
                "publisher_domain": domain,
                "published": published,
                "retrieved_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                "text": excerpt,
                "evidence_kind": evidence_kind,
                "evidence_role": "industry_context" if matched_industries else "general_context",
                "industries": sorted(matched_industries),
                "scope_notes": _with_publication_note(scope_notes, publication_note),
                "retrieval_method": method,
                "excerpt_start": excerpt_start,
                "excerpt_end": excerpt_start + len(excerpt),
                "body_chars": len(body),
                "excerpt_truncated": excerpt_start > 0 or len(excerpt) < len(body),
                "text_sha256": digest,
            })
            publisher_domains = {item["publisher_domain"] for item in pack}
            covered_industries = {industry for item in pack for industry in item["industries"]}
            if len(pack) >= maximum and len(publisher_domains) >= domains_min and covered_industries >= industries:
                break
        except (OSError, ValueError, LookupError, ResearchError) as exc:
            failures.append(f"{requested_url}: {type(exc).__name__}: {exc}")
    covered_industries = {industry for item in pack for industry in item["industries"]}
    missing_industries = sorted(industries - covered_industries)
    if len(pack) < minimum or len(publisher_domains) < domains_min or missing_industries:
        detail = "; ".join(failures) or "No additional relevant, distinct source bodies were available"
        raise ResearchError(
            f"Insufficient research: {len(pack)}/{minimum} source bodies and "
            f"{len(publisher_domains)}/{domains_min} publisher domains. "
            f"Missing industry evidence: {', '.join(missing_industries) or 'none'}. {detail}"
        )
    print(f"Research pack: {len(pack)} read source bodies across {len(publisher_domains)} publisher domains.", flush=True)
    for index, item in enumerate(pack, 1):
        item["id"] = f"S{index}"
    return pack


def reread_research_pack(audit_sources: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
    """Restore an audited pack by reading the same public sources again.

    The audit's text_sha256 hashes the UTF-8 excerpt, not an unread document
    tail. Preserve that exact [excerpt_start, excerpt_end) window, its hash,
    source ID, URL and order. Also require the original normalized body length.
    No replacement sources, local fixtures or stored text are used on resume.
    Any drift or incomplete provenance requires fresh research before drafting.
    Publication metadata is re-audited independently; correcting that metadata
    never changes the original evidence text, window, source ID, URL or hash.
    """
    minimum = _integer("RESEARCH_MIN_SOURCES", 3, 3, 8)
    domains_min = _integer("RESEARCH_MIN_DOMAINS", 2, 2, 5)
    maximum = _integer("RESEARCH_MAX_SOURCES", 5, minimum, 8)
    min_chars = _integer("RESEARCH_MIN_BODY_CHARS", 900, 300, 10000)
    max_chars = _integer("RESEARCH_MAX_SOURCE_CHARS", 10000, min_chars, 10000)
    timeout = _integer("RESEARCH_FETCH_TIMEOUT", 20, 1, 45)
    max_bytes = _integer("RESEARCH_MAX_RESPONSE_BYTES", 2500000, 10000, 4000000)

    def invalid(message: str) -> ResearchError:
        return ResearchError(f"Cannot resume research: {message}. Fresh research is required.")

    if not isinstance(audit_sources, (list, tuple)) or not minimum <= len(audit_sources) <= maximum:
        raise invalid(f"audit must contain {minimum}–{maximum} source records")
    seen_ids, seen_urls, seen_hashes, domains = set(), set(), set(), set()
    # Validate the entire audit before any fetch, including each recorded URL.
    for source in audit_sources:
        if not isinstance(source, Mapping):
            raise invalid("source audit is not an object")
        source_id, url, digest = (source.get(key) for key in ("id", "url", "text_sha256"))
        if not isinstance(source_id, str) or not re.fullmatch(r"S[1-9][0-9]*", source_id) or source_id in seen_ids:
            raise invalid("source IDs must be unique original S-number identifiers")
        try:
            if not isinstance(url, str) or validate_source_url(url) != url:
                raise invalid(f"{source_id} has no canonical audited source URL")
            if source.get("requested_url"):
                validate_source_url(source["requested_url"])
        except (ResearchError, ValueError, TypeError) as exc:
            raise invalid(f"{source_id} has an invalid source URL: {exc}") from exc
        if url in seen_urls:
            raise invalid(f"{source_id} duplicates an audited source URL")
        if not isinstance(digest, str) or not re.fullmatch(r"[0-9a-f]{64}", digest) or digest in seen_hashes:
            raise invalid(f"{source_id} has a missing, invalid or duplicate excerpt hash")
        start, end, body_chars = (source.get(key) for key in ("excerpt_start", "excerpt_end", "body_chars"))
        if any(type(value) is not int for value in (start, end, body_chars)):
            raise invalid(f"{source_id} has missing or non-integer excerpt window metadata")
        if not (0 <= start < end <= body_chars and min_chars <= end - start <= max_chars):
            raise invalid(f"{source_id} excerpt window violates the recorded body or current size limits")
        truncated = start > 0 or end < body_chars
        if "excerpt_truncated" in source and source["excerpt_truncated"] is not truncated:
            raise invalid(f"{source_id} has inconsistent excerpt_truncated metadata")
        industries = source.get("industries", [])
        if not isinstance(industries, list) or any(not isinstance(item, str) or not item.strip() for item in industries):
            raise invalid(f"{source_id} has invalid industry provenance")
        expected_role = "industry_context" if industries else "general_context"
        if source.get("evidence_role", expected_role) != expected_role:
            raise invalid(f"{source_id} has inconsistent industry provenance")
        domain = TRUSTED_HOSTS[urllib.parse.urlsplit(url).hostname][0]
        if source.get("publisher_domain", domain) != domain:
            raise invalid(f"{source_id} publisher domain does not match the audited URL")
        seen_ids.add(source_id)
        seen_urls.add(url)
        seen_hashes.add(digest)
        domains.add(domain)
    if len(domains) < domains_min:
        raise invalid(f"audit has only {len(domains)}/{domains_min} publisher domains")

    pack = []
    for source in audit_sources:
        source_id, url = source["id"], source["url"]
        try:
            # Pass only the validated URL; ignore any text or fixture path in
            # the audit, and use the regular bounded HTTPS fetching path.
            body, fetched_url, metadata, method = _fetch_source({"url": url}, max_bytes, timeout)
            if fetched_url != url:
                raise invalid(f"{source_id} source URL drifted after redirect")
            if len(body) != source["body_chars"]:
                raise invalid(f"{source_id} normalized source body length drifted")
            if re.search(r"access denied|just a moment|verify (?:you are|you're) human|robot check|page not found", metadata.get("title", ""), re.I):
                raise invalid(f"{source_id} returned an error or access-check page")
            start, end = source["excerpt_start"], source["excerpt_end"]
            excerpt = body[start:end]
            digest = hashlib.sha256(excerpt.encode("utf-8")).hexdigest()
            if digest != source["text_sha256"]:
                raise invalid(f"{source_id} excerpt content drifted (SHA-256 mismatch)")
            industries = set(source.get("industries", []))
            if _industry_mentions(excerpt, industries) != industries:
                raise invalid(f"{source_id} read excerpt no longer confirms its audited industry")
            domain, publisher, evidence_kind = TRUSTED_HOSTS[urllib.parse.urlsplit(url).hostname]
            published, publication_note = _publication_metadata(metadata)
            if not published and not publication_note and source.get("published"):
                publication_note = "Publication date unconfirmed on reread; the previous audit date was not carried forward without current publication evidence."
            pack.append({
                "id": source_id,
                "title": source.get("title") or metadata.get("title") or urllib.parse.urlsplit(url).path,
                "url": url,
                "requested_url": source.get("requested_url") or url,
                "publisher": publisher,
                "publisher_domain": domain,
                "published": published,
                "retrieved_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                "text": excerpt,
                "evidence_kind": evidence_kind,
                "evidence_role": "industry_context" if industries else "general_context",
                "industries": list(source.get("industries", [])),
                "scope_notes": _with_publication_note(str(source.get("scope_notes", "")), publication_note),
                "retrieval_method": method,
                "excerpt_start": start,
                "excerpt_end": end,
                "body_chars": source["body_chars"],
                "excerpt_truncated": start > 0 or end < len(body),
                "text_sha256": source["text_sha256"],
            })
        except (OSError, ValueError, LookupError, ResearchError) as exc:
            if isinstance(exc, ResearchError) and str(exc).startswith("Cannot resume research:"):
                raise
            raise invalid(f"{source_id} source could not be reread: {type(exc).__name__}: {exc}") from exc
    return pack
