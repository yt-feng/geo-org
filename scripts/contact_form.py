"""Reusable, localized consultation form for the existing Eco GEO website.

Insert contact_form_html(lang, endpoint) as one HTML block. CSS is scoped to the
component; each inline script binds only its preceding section. No customer data
is kept in browser storage, and an acknowledged request ID is required for success.
"""
from __future__ import annotations

import html
import json
import urllib.parse


PUBLIC_EMAIL = "info@eco-geo.com"

COPY = {
    "zh": {
        "eyebrow": "品牌咨询", "heading": "聊聊你的品牌与目标",
        "intro": "告诉我们你希望解决的 AI 搜索问题，我们会通过邮件与你联系。",
        "name": "姓名", "email": "联系邮箱", "company": "公司 / 品牌",
        "website": "官网", "message": "需求描述", "optional": "选填", "required": "必填",
        "message_hint": "例如：品牌与目标市场、目前的 AI 搜索表现，以及你希望改善的问题。",
        "privacy": "你提交的信息仅用于回应本次咨询。",
        "alternative": "也可以直接发邮件至", "submit": "提交咨询", "loading": "正在提交…",
        "success": "已收到你的咨询。我们会通过你填写的邮箱与你联系。",
        "invalid": "请检查姓名、联系邮箱和需求描述后重试。",
        "name_length": "姓名需为 2–100 个字符，请检查后重试。",
        "message_length": "需求描述需为 10–5,000 个字符，请检查后重试。",
        "too_long": "提交内容过长，请缩短需求描述或其他填写内容后重试。",
        "rate_limit": "提交较频繁，请稍后再试。你也可以直接发送邮件咨询。",
        "unconfirmed": "暂未确认提交结果，请稍后重试，或直接发送邮件咨询。",
        "noscript": "在线提交需要启用 JavaScript。你也可以通过下方邮箱联系我们。",
        "honeypot": "请保留此字段为空",
    },
    "en": {
        "eyebrow": "Brand consultation", "heading": "Tell us about your brand and goals",
        "intro": "Share the AI search questions you want to address. We will follow up by email.",
        "name": "Name", "email": "Email address", "company": "Company / brand",
        "website": "Website", "message": "How can we help?", "optional": "optional", "required": "required",
        "message_hint": "For example: your brand, target markets, current AI search visibility, and what you want to improve.",
        "privacy": "We use the information you submit only to respond to this inquiry.",
        "alternative": "You can also email", "submit": "Send inquiry", "loading": "Sending…",
        "success": "We have received your inquiry and will reply to the email address you provided.",
        "invalid": "Please check your name, email address, and message, then try again.",
        "name_length": "Your name must contain 2–100 characters. Please check it and try again.",
        "message_length": "Your message must contain 10–5,000 characters. Please check it and try again.",
        "too_long": "Your submission is too long. Please shorten your message or other fields and try again.",
        "rate_limit": "You have submitted several requests. Please try again later, or contact us by email.",
        "unconfirmed": "We could not confirm your submission. Please try again later, or contact us by email.",
        "noscript": "JavaScript is needed to submit this form. You can also reach us at the email address below.",
        "honeypot": "Leave this field empty",
    },
    "ar": {
        "eyebrow": "استشارة لعلامتك التجارية", "heading": "حدثنا عن علامتك التجارية وأهدافك",
        "intro": "شاركنا الأسئلة التي تريد معالجتها بشأن البحث بالذكاء الاصطناعي، وسنتواصل معك عبر البريد الإلكتروني.",
        "name": "الاسم", "email": "البريد الإلكتروني", "company": "الشركة / العلامة التجارية",
        "website": "الموقع الإلكتروني", "message": "كيف يمكننا مساعدتك؟", "optional": "اختياري", "required": "مطلوب",
        "message_hint": "مثلاً: علامتك التجارية، والأسواق المستهدفة، وظهورك الحالي في نتائج البحث بالذكاء الاصطناعي، وما ترغب في تحسينه.",
        "privacy": "نستخدم المعلومات التي ترسلها للرد على هذا الاستفسار فقط.",
        "alternative": "يمكنك أيضاً مراسلتنا على", "submit": "إرسال الاستفسار", "loading": "جارٍ الإرسال…",
        "success": "تم استلام استفسارك. سنرد عليك عبر البريد الإلكتروني الذي أدخلته.",
        "invalid": "يرجى التحقق من الاسم والبريد الإلكتروني والرسالة، ثم المحاولة مرة أخرى.",
        "name_length": "يجب أن يتكون الاسم من 2 إلى 100 حرف. يرجى التحقق منه والمحاولة مرة أخرى.",
        "message_length": "يجب أن تتكون الرسالة من 10 إلى 5,000 حرف. يرجى التحقق منها والمحاولة مرة أخرى.",
        "too_long": "محتوى الطلب طويل جداً. يرجى تقصير الرسالة أو الحقول الأخرى ثم المحاولة مرة أخرى.",
        "rate_limit": "أرسلت عدة طلبات خلال فترة قصيرة. يرجى المحاولة لاحقاً، أو التواصل معنا عبر البريد الإلكتروني.",
        "unconfirmed": "لم نتمكن من تأكيد إرسال استفسارك. يرجى المحاولة لاحقاً، أو التواصل معنا عبر البريد الإلكتروني.",
        "noscript": "يلزم تفعيل JavaScript لإرسال النموذج. يمكنك أيضاً التواصل معنا عبر البريد الإلكتروني أدناه.",
        "honeypot": "اترك هذا الحقل فارغاً",
    },
}


def contact_form_css() -> str:
    """Return component-scoped CSS without a style element."""
    return """
.eco-contact-form{position:relative;isolation:isolate;color:var(--text,#f5f8f4);font-family:inherit;border:1px solid var(--line,rgba(255,255,255,.15));border-radius:28px;padding:clamp(22px,4vw,36px);background:linear-gradient(135deg,rgba(140,233,154,.10),rgba(128,199,255,.045)),#0b1711;text-align:start}
.eco-contact-form *{box-sizing:border-box}.eco-contact-form .ecf-eyebrow{margin:0 0 10px;color:var(--green,#8ce99a);font-size:12px;font-weight:800;letter-spacing:.10em}.eco-contact-form h2{margin:0 0 12px;font-size:clamp(25px,3vw,36px);line-height:1.2;letter-spacing:-.025em}.eco-contact-form .ecf-intro{margin:0 0 24px;color:var(--muted,#b8c7bc);font-size:16px;line-height:1.7;max-width:66ch}
.eco-contact-form fieldset{border:0;margin:0;padding:0;min-width:0}.eco-contact-form .ecf-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}.eco-contact-form .ecf-field{display:flex;flex-direction:column;gap:8px;margin:0;color:var(--text,#f5f8f4);font-size:14px;font-weight:700;min-width:0}.eco-contact-form .ecf-field small{color:var(--muted,#b8c7bc);font-size:12px;font-weight:400;margin-inline-start:6px}.eco-contact-form .ecf-wide{grid-column:1/-1}
.eco-contact-form input,.eco-contact-form textarea{display:block;width:100%;margin:0;padding:13px 14px;border:1px solid rgba(184,199,188,.28);border-radius:13px;background:rgba(0,0,0,.20);color:var(--text,#f5f8f4);font:inherit;font-weight:400;line-height:1.5;transition:border-color .15s,box-shadow .15s;min-height:48px}.eco-contact-form textarea{resize:vertical;min-height:150px}.eco-contact-form input::placeholder,.eco-contact-form textarea::placeholder{color:#9bb1a3;opacity:1}.eco-contact-form input:focus-visible,.eco-contact-form textarea:focus-visible,.eco-contact-form button:focus-visible,.eco-contact-form a:focus-visible{outline:2px solid var(--green,#8ce99a);outline-offset:3px}.eco-contact-form input:focus,.eco-contact-form textarea:focus{border-color:var(--green,#8ce99a);box-shadow:0 0 0 3px rgba(140,233,154,.08)}
.eco-contact-form .ecf-privacy,.eco-contact-form .ecf-email,.eco-contact-form .ecf-noscript{color:var(--muted,#b8c7bc);font-size:13px;line-height:1.7;margin:16px 0 0}.eco-contact-form .ecf-email a{color:var(--green,#8ce99a);text-underline-offset:3px;overflow-wrap:anywhere}.eco-contact-form .ecf-actions{display:flex;align-items:center;gap:16px;flex-wrap:wrap;margin-top:22px}.eco-contact-form button{display:inline-flex;align-items:center;justify-content:center;min-height:48px;padding:13px 22px;border:1px solid transparent;border-radius:999px;background:var(--green,#8ce99a);color:#07110d;font:inherit;font-size:15px;font-weight:800;cursor:pointer}.eco-contact-form button:hover{background:#a2efad}.eco-contact-form button:disabled{opacity:.65;cursor:wait}.eco-contact-form .ecf-status{margin:0;flex:1 1 230px;font-size:14px;line-height:1.6;overflow-wrap:anywhere}.eco-contact-form .ecf-status[data-state=success]{color:var(--green,#8ce99a)}.eco-contact-form .ecf-status[data-state=error]{color:#ffd5a6}.eco-contact-form .ecf-honeypot{position:absolute;inset-inline-start:-10000px;top:0;width:1px;height:1px;overflow:hidden;white-space:nowrap}.eco-contact-form[dir=rtl] .ecf-eyebrow,.eco-contact-form[dir=rtl] h2{letter-spacing:0}
@media(max-width:620px){.eco-contact-form .ecf-fields{grid-template-columns:1fr}.eco-contact-form button{width:100%}.eco-contact-form .ecf-actions{gap:12px}.eco-contact-form .ecf-status{flex-basis:100%}}
""".strip()


def contact_form_script(lang: str = "zh") -> str:
    """Return the script binding the component immediately before its script tag."""
    copy = COPY[lang]
    messages = {key: copy[key] for key in ("submit", "loading", "success", "invalid", "name_length", "message_length", "too_long", "rate_limit", "unconfirmed")}
    encoded = json.dumps(messages, ensure_ascii=False).replace("<", "\\u003c")
    return r"""(function(){
  'use strict';
  const root = document.currentScript.previousElementSibling;
  if (!root || !root.classList.contains('eco-contact-form')) return;
  const form = root.querySelector('form');
  if (!form || form.dataset.bound === 'true') return;
  form.dataset.bound = 'true';
  const messages = __MESSAGES__;
  const button = form.querySelector('button[type="submit"]');
  const status = root.querySelector('.ecf-status');
  const fields = form.querySelector('fieldset');
  let pending = false;
  button.disabled = false;
  function show(message, state) {
    status.textContent = message;
    status.dataset.state = state;
  }
  form.addEventListener('submit', async function(event) {
    event.preventDefault();
    if (pending || !form.reportValidity()) return;
    const payload = {};
    ['name', 'email', 'company', 'website', 'message', 'website_confirm'].forEach(function(key) {
      payload[key] = form.elements.namedItem(key).value.trim();
    });
    payload.locale = root.lang;
    if (Array.from(payload.name).length < 2 || Array.from(payload.name).length > 100) {
      show(messages.name_length, 'error');
      return;
    }
    if (Array.from(payload.message).length < 10 || Array.from(payload.message).length > 5000) {
      show(messages.message_length, 'error');
      return;
    }
    const serialized = JSON.stringify(payload);
    if (new TextEncoder().encode(serialized).byteLength > 12000) {
      show(messages.too_long, 'error');
      return;
    }
    pending = true;
    button.disabled = true;
    fields.disabled = true;
    button.textContent = messages.loading;
    form.setAttribute('aria-busy', 'true');
    show('', 'pending');
    const controller = new AbortController();
    const timeout = setTimeout(function(){ controller.abort(); }, 25000);
    try {
      const response = await fetch(form.dataset.endpoint, {
        method: 'POST',
        headers: {'Content-Type': 'application/json', 'Accept': 'application/json'},
        mode: 'cors',
        credentials: 'omit',
        body: serialized,
        signal: controller.signal
      });
      let result = null;
      try { result = await response.json(); } catch (_) { /* No acknowledgement. */ }
      if (response.status === 200 && result && result.ok === true &&
          typeof result.requestId === 'string' && result.requestId.trim().length > 0) {
        form.reset();
        show(messages.success, 'success');
      } else if (response.status === 400 || response.status === 422) {
        show(messages.invalid, 'error');
      } else if (response.status === 413) {
        show(messages.too_long, 'error');
      } else if (response.status === 429) {
        show(messages.rate_limit, 'error');
      } else {
        show(messages.unconfirmed, 'error');
      }
    } catch (_) {
      show(messages.unconfirmed, 'error');
    } finally {
      clearTimeout(timeout);
      pending = false;
      button.disabled = false;
      fields.disabled = false;
      button.textContent = messages.submit;
      form.setAttribute('aria-busy', 'false');
    }
  });
})();""".replace("__MESSAGES__", encoded)


def _validate_endpoint(endpoint: str) -> str:
    if not isinstance(endpoint, str) or not endpoint or any(char.isspace() for char in endpoint):
        raise ValueError("Contact endpoint must be a URL or a root-relative path")
    parsed = urllib.parse.urlsplit(endpoint)
    if endpoint.startswith("/") and not endpoint.startswith("//") and not parsed.netloc and not parsed.fragment and "\\" not in endpoint:
        return endpoint
    if parsed.scheme == "https" and parsed.hostname and not parsed.username and not parsed.password and not parsed.fragment:
        return endpoint
    raise ValueError("Contact endpoint must be HTTPS or a root-relative path")


def contact_form_html(lang: str = "zh", endpoint: str = "/api/contact") -> str:
    """Build the entire localized form block for direct insertion into a page."""
    if lang not in COPY:
        raise ValueError(f"Unsupported contact form language: {lang}")
    endpoint = _validate_endpoint(endpoint)
    copy = COPY[lang]
    esc = html.escape

    def field(name: str, kind: str, limit: int, *, minimum: int = 0, required: bool = False, autocomplete: str = "", placeholder: str = "") -> str:
        flag = copy["required"] if required else copy["optional"]
        attrs = f' type="{kind}" name="{name}" maxlength="{limit}"'
        if minimum:
            attrs += f' minlength="{minimum}"'
        if required:
            attrs += " required"
        if autocomplete:
            attrs += f' autocomplete="{autocomplete}"'
        if placeholder:
            attrs += f' placeholder="{esc(placeholder, quote=True)}"'
        attrs += ' dir="ltr"' if kind in {"email", "url"} else ' dir="auto"'
        return f'<label class="ecf-field"><span>{esc(copy[name])}<small>{esc(flag)}</small></span><input{attrs}></label>'

    return (
        f'<style>{contact_form_css()}</style>'
        f'<section id="inquiry" class="eco-contact-form" lang="{lang}" dir="{"rtl" if lang == "ar" else "ltr"}">'
        f'<p class="ecf-eyebrow">{esc(copy["eyebrow"])}</p>'
        f'<h2>{esc(copy["heading"])}</h2><p class="ecf-intro">{esc(copy["intro"])}</p>'
        f'<form method="post" action="{esc(endpoint, quote=True)}" data-endpoint="{esc(endpoint, quote=True)}" aria-label="{esc(copy["heading"], quote=True)}" aria-busy="false">'
        '<fieldset><div class="ecf-fields">'
        + field("name", "text", 100, minimum=2, required=True, autocomplete="name")
        + field("email", "email", 254, required=True, autocomplete="email")
        + field("company", "text", 160, autocomplete="organization")
        + field("website", "url", 2048, autocomplete="url", placeholder="https://example.com")
        + f'<label class="ecf-field ecf-wide"><span>{esc(copy["message"])}<small>{esc(copy["required"])}</small></span>'
        f'<textarea name="message" dir="auto" rows="5" minlength="10" maxlength="5000" required placeholder="{esc(copy["message_hint"], quote=True)}"></textarea></label>'
        '</div>'
        f'<div class="ecf-honeypot" aria-hidden="true"><label>{esc(copy["honeypot"])}'
        '<input type="text" name="website_confirm" tabindex="-1" autocomplete="off" maxlength="200"></label></div>'
        '</fieldset>'
        f'<p class="ecf-privacy">{esc(copy["privacy"])}</p>'
        '<div class="ecf-actions">'
        f'<button type="submit" disabled>{esc(copy["submit"])}</button>'
        '<p class="ecf-status" role="status" aria-live="polite" aria-atomic="true"></p></div>'
        '</form>'
        f'<noscript><p class="ecf-noscript">{esc(copy["noscript"])}</p></noscript>'
        f'<p class="ecf-email">{esc(copy["alternative"])} '
        f'<a href="mailto:{PUBLIC_EMAIL}" rel="noopener" dir="ltr">{PUBLIC_EMAIL}</a></p>'
        f'</section><script>{contact_form_script(lang)}</script>'
    )
