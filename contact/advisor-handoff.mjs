import { consumeContactHandoff } from '../package-advisor/handoff.mjs';

const root = document.querySelector('.eco-contact-form');
const field = root?.querySelector('textarea[name="message"]');
if (field) {
  const summary = consumeContactHandoff();
  if (summary) {
    const messages = {
      zh: ['你的方案已带入下方。可以修改，再填写姓名和邮箱提交；目前尚未发送。', '保留当前填写内容；点击此处附上方案摘要', '当前内容较长，请先下载方案，或精简需求描述后再附上摘要。'],
      en: ['Your plan is ready below. Review it, then enter your name and email to send it. Nothing has been sent yet.', 'Keep my text and add the plan summary', 'Please shorten your message before adding the plan summary, or download the full plan.'],
      ar: ['أُضيف ملخص خطتك أدناه. راجعه وأدخل اسمك وبريدك الإلكتروني لإرساله. لم يُرسل أي شيء بعد.', 'الاحتفاظ بنصي وإضافة ملخص الخطة', 'يرجى اختصار الرسالة قبل إضافة الملخص، أو تنزيل الخطة الكاملة.'],
    };
    const copy = messages[root.lang] || messages.en;
    const note = document.createElement('p');
    note.className = 'ecf-privacy';
    note.setAttribute('role', 'status');
    if (!field.value.trim()) {
      field.value = summary;
      note.textContent = copy[0];
    } else {
      const add = document.createElement('button');
      add.type = 'button';
      add.textContent = copy[1];
      add.addEventListener('click', () => {
        const combined = `${field.value}\n\n${summary}`;
        if (combined.length > 4500 || new TextEncoder().encode(combined).byteLength > 9000) { note.textContent = copy[2]; return; }
        field.value = combined;
        note.textContent = copy[0];
      });
      note.append(add);
    }
    root.querySelector('form').before(note);
  }
}
