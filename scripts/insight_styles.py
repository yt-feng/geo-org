"""Shared reading styles for long-form analytical exhibits in all locales."""

INSIGHT_CSS = """
html[lang="en"] article>h1{font-size:clamp(34px,4.2vw,56px);line-height:1.08}
.content{overflow-wrap:anywhere}
.content [data-role="executive-summary"]{border-inline-start:4px solid var(--green);padding:20px 24px;margin:28px 0 38px;background:rgba(140,233,154,.07);border-radius:0 14px 14px 0}
.content [data-role="executive-summary"] h2{margin-top:0;font-size:24px}
.content [data-role="assumptions"]{font-size:16px;color:var(--muted);padding:22px;border:1px solid var(--line);border-radius:16px;margin:32px 0}
.content [data-role="assumptions"] h2{margin-top:0;font-size:25px}
.content table{display:block;width:100%;max-width:100%;overflow-x:auto;border-collapse:collapse;margin:28px 0 32px;font-size:15px;line-height:1.65;border:1px solid var(--line);border-radius:12px}
.content caption{display:table-caption;text-align:start;color:var(--green);font-size:17px;font-weight:750;padding:16px;background:rgba(140,233,154,.06)}
.content th,.content td{min-width:90px;text-align:start;padding:13px 16px;vertical-align:top;border-bottom:1px solid var(--line)}
.content th:first-child,.content td:first-child,.content th:last-child,.content td:last-child{min-width:160px}
.content th{color:var(--text);background:rgba(255,255,255,.07);font-weight:750}
.content tr:last-child td{border-bottom:0}
.content a[data-source-id]{font-size:.78em;color:var(--green);text-decoration:none;white-space:nowrap}
.content h3{font-size:22px;margin:28px 0 12px;line-height:1.4}
.source-list li{font-size:14px;margin:14px 0;overflow-wrap:anywhere}
@media(max-width:640px){.content{font-size:17px}.content h2{font-size:26px;line-height:1.35}.content [data-role="executive-summary"]{padding:16px}.content table{font-size:14px}.content th,.content td{padding:11px;min-width:125px}}
"""
