const API_BASE = 'https://brain-api.eco-geo.org';
const $ = (id) => document.getElementById(id);
const state = { user: null, config: null, view: 'chat', mode: 'sales', conversationId: null, conversations: [], messages: [], authMode: 'login', captchaId: '', knowledgeTab: 'documents', knowledge: null, customers: [], customer: null, customerId: null, editCustomerId: null, pendingChat: false, imagePolls: new Map(), adminAction: null, social: null, customerFilter: 'active', lastChatRequest: null, lastImageRequest: null, checkoutRequests: new Map(), imageAdmin: null };
const modeNames = { sales: '销售助手', proposal: '客户方案', research: '市场研究', brand: '品牌文案' };
const starters = {
  sales: ['明天拜访商超采购，帮我准备佳农香蕉的沟通提纲', '客户说水果供应商都差不多，我该怎么回应？', '为水果连锁客户整理佳农的核心合作价值'],
  proposal: ['为区域商超设计一份佳农水果合作方案', '帮我梳理水果经销商最关心的五个合作问题', '设计一份企业水果礼赠提案的内容框架'],
  research: ['近期水果零售渠道有哪些值得关注的变化？', '整理香蕉市场近期动态，并给出可追溯来源', '拜访采购前，应该掌握哪些产区与消费信息？'],
  brand: ['把佳农的品牌优势写成一段采购沟通开场白', '写一封商超客户拜访后的跟进邮件', '把产品介绍改写成适合朋友圈的品牌文案']
};
const viewNames = { chat: '销售工作台', customers: '我的客户', images: '图片创意', knowledge: '品牌资料库', wallet: '我的积分', admin: '管理后台', listening: '社媒聆听' };

function el(tag, className = '', text = '') { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined && text !== null) node.textContent = String(text); return node; }
function setText(id, value) { const node = $(id); if (node) node.textContent = value == null ? '' : String(value); }
function empty(node) { node.replaceChildren(); }
function money(value) { return Number(value || 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 }); }
function points(value) { return Number(value || 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 }); }
function date(value) { if (!value) return '—'; const d = new Date(value); return Number.isNaN(d.getTime()) ? String(value).slice(0, 20) : new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(d); }
function safeUrl(value, allowRelative = true) { try { const url = new URL(String(value || ''), location.origin); if (!value || !['https:', 'http:'].includes(url.protocol)) return ''; if (!allowRelative && !/^https?:\/\//i.test(value)) return ''; return url.href; } catch { return ''; } }
function status(id, message, bad = false) { const node = $(id); if (!node) return; node.textContent = message || ''; node.classList.toggle('negative', bad); }
let toastTimer;
function toast(message) { setText('toast', message); $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 5500); }
function busy(form, value) { form.querySelectorAll('button[type="submit"],button:not([type])').forEach((node) => { node.disabled = value; }); }
function showDialog(id) { const dialog = $(id); if (!dialog.open) dialog.showModal(); }
function closeDialog(id) { $(id).close(); }
function newId() { return crypto.randomUUID(); }

let accountGeneration = 0;
const accountRequests = new Set();
class StaleAccountResponse extends Error {
  constructor() { super('Account changed while this request was in flight.'); this.name = 'StaleAccountResponse'; }
}
function isStaleAccountResponse(error) { return error instanceof StaleAccountResponse; }
function assertAccountGeneration(generation) { if (generation !== accountGeneration) throw new StaleAccountResponse(); }
function clearPrivateWorkspace() {
  state.conversationId = null; state.messages = []; state.conversations = [];
  state.customers = []; state.customer = null; state.customerId = null; state.editCustomerId = null;
  state.knowledge = null; state.social = null; state.knowledgeTab = 'documents'; state.customerFilter = 'active';
  state.lastChatRequest = null; state.lastImageRequest = null; state.checkoutRequests.clear();
  state.adminAction = null; state.imageAdmin = null; state.captchaId = ''; state.pendingChat = false;
  state.imagePolls.forEach((token) => { token.cancelled = true; }); state.imagePolls.clear();
  for (const id of ['messages','history-list','mobile-history','image-results','image-history','knowledge-results','customer-list','customer-detail-body','activity-list','account-details','detail-body','admin-users','admin-metrics','admin-image-tasks','ledger-body','orders-body','listening-metrics','listening-platforms','listening-themes','listening-results']) {
    const node = $(id); if (node) empty(node);
  }
  for (const id of ['auth-form','chat-form','image-form','customer-form','activity-form','password-form','admin-action-form','image-admin-form']) {
    const form = $(id); if (form) { form.reset(); busy(form, false); }
  }
  for (const id of ['chat-input','image-prompt','customer-raw','customer-query','knowledge-query','listening-query','admin-query','auth-password','auth-captcha','auth-phone','auth-name','auth-department','auth-username','admin-action-value','provider-task-id','image-admin-note']) {
    const node = $(id); if (node) node.value = '';
  }
  for (const id of ['customer-detail-title','detail-title','admin-action-description','image-admin-description','listening-count','knowledge-status','customer-status','admin-status','image-status','auth-status','password-status','customer-form-status','activity-status','admin-action-status','image-admin-status','listening-status']) setText(id, '');
  setText('listening-notice', '品牌社媒资料为历史采样，展示采样时间、平台口径及来源，不代表实时全网舆情。');
  document.querySelectorAll('dialog').forEach((dialog) => { if (dialog.id !== 'auth-dialog' && dialog.open) dialog.close(); });
  document.querySelectorAll('[data-customer-filter]').forEach((button) => { const active = button.dataset.customerFilter === 'active'; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); });
  document.querySelectorAll('[data-knowledge-tab]').forEach((button) => { const active = button.dataset.knowledgeTab === 'documents'; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); });
  $('customer-context')?.remove(); $('send-button').disabled = false; $('refresh-captcha').disabled = false;
  clearTimeout(toastTimer); $('toast').hidden = true; setText('toast', '');
}
async function api(path, { method = 'GET', body, timeout = 95000, silent = false } = {}) {
  const generation = accountGeneration;
  const controller = new AbortController(); accountRequests.add(controller);
  const timer = setTimeout(() => controller.abort(), timeout);
  let currentSessionExpired = false;
  try {
    const response = await fetch(`${API_BASE}/api${path}`, { method, credentials: 'include', headers: body === undefined ? { Accept: 'application/json' } : { Accept: 'application/json', 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal });
    assertAccountGeneration(generation);
    const type = response.headers.get('content-type') || '';
    const data = type.includes('json') ? await response.json() : {};
    assertAccountGeneration(generation);
    if (!response.ok) {
      const error = new Error(data.message || data.detail || (typeof data.error === 'string' ? friendlyError(data.error) : data.error?.message) || (response.status === 401 ? '请先登录账号。' : `服务暂时未完成请求（${response.status}），请稍后重试。`));
      error.status = response.status; error.data = data;
      // An old 401 must never expire a newer session. The generation checks above
      // happen before this branch; this request's own expiry remains a normal 401.
      if (response.status === 401 && !silent && !['/login', '/register', '/password'].includes(path)) { currentSessionExpired = true; updateUser(null); }
      throw error;
    }
    return data;
  } catch (error) {
    if (isStaleAccountResponse(error) || (!currentSessionExpired && generation !== accountGeneration)) throw new StaleAccountResponse();
    if (error.name === 'AbortError') throw new Error('本次请求等待时间较长，请查看历史记录后再重试。');
    if (error instanceof TypeError) throw new Error('暂时无法连接服务，请稍后重试。');
    throw error;
  } finally { clearTimeout(timer); accountRequests.delete(controller); }
}

function updateUser(user, { newSession = false } = {}) {
  const identityChanged = newSession || (state.user?.id || null) !== (user?.id || null);
  if (identityChanged) {
    accountGeneration += 1;
    accountRequests.forEach((controller) => controller.abort()); accountRequests.clear();
    clearPrivateWorkspace();
  }
  state.user = user || null;
  const name = user?.name || user?.username || '';
  setText('account-name', user ? name : '登录 / 注册');
  setText('account-avatar', name ? name.slice(0, 1) : '佳');
  setText('credit-balance', user ? `${points(user.credits)} 积分` : '积分账户');
  $('admin-nav').hidden = !isAdmin();
  if (!isAdmin() && state.view === 'admin') switchView('chat');
  if (identityChanged) { renderHistory(); updateChatIntro(); renderCustomerContext(); }
  updateWalletSummary();
  setText('composer-note', user ? `对话体验剩余 ${Number(user.trial_remaining || 0)} 次 · 体验积分 ${points(user.trial_credits)} · 通用积分 ${points(user.credits)}。单次对话最多 ${state.config?.chat_reserve_credits || 60} 积分，按实际用量结算。` : '答案结合品牌资料生成；报价、库存及交付承诺请以业务确认信息为准。');
}

function isAdmin() { return ['admin', 'super'].includes(state.user?.role); }
function requireUser() { if (state.user) return true; openAuth('login'); return false; }
function authGate(container, label = '登录后，继续使用你的专属工作空间。') { empty(container); const box = el('div', 'auth-gate', label); const button = el('button', 'primary-button', '登录 / 注册'); button.type = 'button'; button.addEventListener('click', () => openAuth('login')); box.append(button); container.append(box); }

async function switchView(view) {
  if (!viewNames[view] || (view === 'admin' && !isAdmin())) return;
  state.view = view;
  document.querySelectorAll('.view').forEach((node) => { node.hidden = node.id !== `view-${view}`; });
  document.querySelectorAll('[data-view]').forEach((node) => { const active = node.dataset.view === view; node.classList.toggle('active', active); if (active) node.setAttribute('aria-current', 'page'); else node.removeAttribute('aria-current'); });
  setText('view-label', viewNames[view]);
  if (view === 'knowledge') await loadKnowledge();
  if (view === 'wallet') await loadWallet();
  if (view === 'images') await loadImages();
  if (view === 'customers') await loadCustomers();
  if (view === 'admin') await loadAdmin();
  if (view === 'listening') await loadListening();
}
function setMode(mode) {
  if (!modeNames[mode]) return;
  state.mode = mode;
  document.querySelectorAll('[data-mode]').forEach((node) => { const active = node.dataset.mode === mode; node.classList.toggle('selected', active); node.setAttribute('aria-pressed', String(active)); });
  setText('composer-mode', `↗ ${modeNames[mode]}`);
  $('use-news').checked = mode === 'research';
  const node = $('starter-list'); empty(node);
  starters[mode].forEach((text) => { const button = el('button', '', text); button.type = 'button'; button.addEventListener('click', () => { $('chat-input').value = text; $('chat-input').focus(); }); node.append(button); });
}
function updateChatIntro() { const active = state.messages.length > 0; $('chat-intro').hidden = active; $('mode-section').hidden = active; $('starter-area').hidden = active; }
function newChat() { if (state.pendingChat) { toast('当前回答完成后即可开启新对话。'); return; } state.conversationId = null; state.messages = []; state.customerId = null; state.lastChatRequest = null; empty($('messages')); updateChatIntro(); renderCustomerContext(); renderHistory(); switchView('chat'); $('chat-input').value = ''; $('chat-input').focus(); }

// Model text is converted into DOM nodes; HTML returned by a model is never inserted.
function inlineText(container, text) {
  const expression = /(\*\*[^*\n]+\*\*|\[[^\]\n]+\]\(https?:\/\/[^\s)]+\))/g;
  let last = 0;
  for (const match of text.matchAll(expression)) {
    container.append(document.createTextNode(text.slice(last, match.index)));
    if (match[0].startsWith('**')) container.append(el('strong', '', match[0].slice(2, -2)));
    else { const parsed = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(match[0]); const href = safeUrl(parsed?.[2], false); if (href) { const link = el('a', '', parsed[1]); link.href = href; link.target = '_blank'; link.rel = 'noopener noreferrer'; container.append(link); } else container.append(document.createTextNode(match[0])); }
    last = match.index + match[0].length;
  }
  container.append(document.createTextNode(text.slice(last)));
}
function renderText(container, content) {
  const lines = String(content || '').split('\n'); let list = null; let code = null;
  for (const line of lines) {
    if (/^\s*```/.test(line)) { if (code) code = null; else { code = el('pre'); container.append(code); } list = null; continue; }
    if (code) { code.append(document.createTextNode(line + '\n')); continue; }
    if (!line.trim()) { list = null; continue; }
    const heading = /^#{1,4}\s+(.+)$/.exec(line);
    const bullet = /^\s*(?:[-*•]|\d+[.)、])\s+(.+)$/.exec(line);
    if (heading) { const h = el('h3'); inlineText(h, heading[1]); container.append(h); list = null; }
    else if (bullet) { if (!list) { list = el('ul'); container.append(list); } const item = el('li'); inlineText(item, bullet[1]); list.append(item); }
    else { list = null; const p = el('p'); inlineText(p, line); container.append(p); }
  }
}
function renderMessage(message, { pending = false } = {}) {
  const article = el('article', `message ${message.role === 'user' ? 'user' : 'assistant'}${pending ? ' pending' : ''}`);
  if (message.role === 'user') { article.textContent = message.content; $('messages').append(article); return article; }
  const header = el('div', 'message-header'); header.append(el('span', 'brand-mark', '佳'), el('span', '', pending ? '正在为你整理思路' : '佳农品牌大脑')); article.append(header);
  const content = el('div', 'message-content'); if (pending) content.textContent = message.content; else renderText(content, message.content); article.append(content);
  if (message.sources?.length) {
    const sources = el('div', 'source-list'); sources.append(el('p', '', '本次参考 · 点击查看来源'));
    message.sources.forEach((source, index) => { const button = el('button', 'source-chip', `${source.id || index + 1} · ${source.title || '参考资料'}`); button.type = 'button'; button.addEventListener('click', () => showSource(source)); sources.append(button); }); article.append(sources);
  }
  if (!pending) { const meta = el('div', 'message-meta'); const charged = message.charged_credits != null ? `本次使用 ${points(message.charged_credits)} 积分` : ''; meta.append(el('span', '', [date(message.created_at) === '—' ? '' : date(message.created_at), charged].filter(Boolean).join(' · '))); const copy = el('button', '', '复制内容'); copy.type = 'button'; copy.addEventListener('click', () => copyText(message.content)); meta.append(copy); article.append(meta); }
  $('messages').append(article); return article;
}
async function copyText(value) { try { await navigator.clipboard.writeText(String(value || '')); toast('内容已复制。'); } catch { toast('暂时无法复制，请选中文字后复制。'); } }
function showSource(source) {
  setText('detail-category', source.category || 'REFERENCE SOURCE'); setText('detail-title', source.title || '参考资料'); const body = $('detail-body'); empty(body);
  renderText(body, source.excerpt || source.content || '此资料已用于本次回答的检索参考。');
  const url = safeUrl(source.url, false); if (url) { const link = el('a', 'source-chip', '打开原始来源 ↗'); link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer'; body.append(link); }
  if (source.id) body.append(el('p', 'source-note', `来源编号：${source.id}`)); showDialog('detail-dialog');
}
async function sendChat(event) {
  const generation = accountGeneration;
  event.preventDefault(); if (state.pendingChat || !requireUser()) return;
  const message = $('chat-input').value.trim(); if (!message) return;
  state.pendingChat = true; $('send-button').disabled = true;
  const userMessage = { role: 'user', content: message, created_at: new Date().toISOString() }; state.messages.push(userMessage); renderMessage(userMessage); updateChatIntro(); $('chat-input').value = '';
  const pending = renderMessage({ role: 'assistant', content: state.mode === 'research' || $('use-news').checked ? '正在检索品牌资料与市场动态，请稍候…' : '正在结合品牌资料，准备一份更贴近实际业务的回答…' }, { pending: true });
  pending.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  try {
    const chatBody = { conversation_id: state.conversationId, message, mode: $('use-news').checked && state.mode !== 'research' ? 'research' : state.mode, ...(state.customerId ? { customer_id: state.customerId } : {}) };
    const fingerprint = JSON.stringify(chatBody); if (state.lastChatRequest?.fingerprint !== fingerprint) state.lastChatRequest = { fingerprint, id: newId() };
    const result = await api('/chat', { method: 'POST', timeout: 135000, body: { ...chatBody, request_id: state.lastChatRequest.id } }); state.lastChatRequest = null;
    pending.remove(); state.conversationId = result.conversation_id || state.conversationId;
    const answer = { role: 'assistant', content: result.answer || '', sources: result.sources || [], charged_credits: result.charged_credits, created_at: new Date().toISOString() }; state.messages.push(answer); renderMessage(answer);
    if (result.user) updateUser(result.user); else refreshMe();
    if (result.news_status && /unavailable|failed|timeout/.test(String(result.news_status))) toast('最新市场动态本次未能获取，回答中的来源以已列出的资料为准。');
    await loadHistory();
  } catch (error) { if (isStaleAccountResponse(error)) return;
    if (generation !== accountGeneration) { if (error.status === 401 && !state.user) openAuth('login'); return; }
    pending.remove(); if (['previous_request_failed','provider_unavailable','answer_incomplete','answer_invalid','citation_invalid','insufficient_credits','rate_limited','login_required','message_length'].includes(error.data?.error)) state.lastChatRequest = null; const failure = el('div', 'message assistant error-message', error.message); $('messages').append(failure);
    if (error.status === 401) openAuth('login');
    if ([402, 429].includes(error.status)) { const button = el('button', 'text-button', '查看积分与充值 →'); button.type = 'button'; button.style.display = 'block'; button.style.marginTop = '10px'; button.addEventListener('click', () => switchView('wallet')); failure.append(button); }
    $('chat-input').value = message;
  } finally { if (generation === accountGeneration) { state.pendingChat = false; $('send-button').disabled = false; $('chat-input').focus(); } }
}
async function loadHistory() {
  if (!state.user) { state.conversations = []; renderHistory(); return; }
  try { const result = await api('/conversations'); state.conversations = result.conversations || []; renderHistory(); } catch (error) { if (isStaleAccountResponse(error)) return; setText('history-list', error.message); }
}
function renderHistory() {
  const list = $('history-list'); empty(list);
  if (!state.user) list.append(el('p', 'sidebar-empty', '登录后，在这里接着聊。'));
  else if (!state.conversations.length) list.append(el('p', 'sidebar-empty', '你的下一段好对话，从这里开始。'));
  state.conversations.forEach((conversation) => { const button = el('button', `history-button${state.conversationId === conversation.id ? ' active' : ''}`, conversation.title || '新的对话'); button.type = 'button'; button.title = conversation.title || '新的对话'; button.addEventListener('click', () => loadConversation(conversation.id)); list.append(button); });
  let picker = $('mobile-history'); if (!picker) { picker = el('div', 'chat-history-picker'); picker.id = 'mobile-history'; $('view-chat').prepend(picker); } empty(picker);
  if (state.user && state.conversations.length) { const label = el('label', '', '继续对话'); label.htmlFor = 'history-select'; label.style.margin = '0'; const select = el('select'); select.id = 'history-select'; const defaultOption = el('option', '', '选择历史对话'); defaultOption.value = ''; select.append(defaultOption); state.conversations.forEach((conversation) => { const option = el('option', '', conversation.title || '新的对话'); option.value = conversation.id; option.selected = conversation.id === state.conversationId; select.append(option); }); select.addEventListener('change', () => { if (select.value) loadConversation(select.value); }); picker.append(label, select); }
}
async function loadConversation(id) {
  if (state.pendingChat) { toast('请等待当前回答完成。'); return; }
  try { const result = await api(`/conversations/${encodeURIComponent(id)}`); state.conversationId = id; state.messages = result.messages || []; state.customerId = result.conversation?.customer_id || null; empty($('messages')); state.messages.forEach((message) => renderMessage(message)); updateChatIntro(); renderHistory(); renderCustomerContext(); await switchView('chat'); } catch (error) { if (isStaleAccountResponse(error)) return; toast(error.message); }
}

function setAuthMode(mode) {
  state.authMode = mode; const register = mode === 'register';
  $('register-fields').hidden = !register; $('consent-label').hidden = !register; $('auth-consent').required = register;
  ['auth-phone', 'auth-name', 'auth-department'].forEach((id) => { $(id).required = register; });
  $('auth-password').autocomplete = register ? 'new-password' : 'current-password';
  ['login', 'register'].forEach((key) => { $(`auth-tab-${key}`).classList.toggle('active', key === mode); $(`auth-tab-${key}`).setAttribute('aria-pressed', String(key === mode)); });
  setText('auth-submit', register ? '注册，领取对话体验 →' : '登录，开始工作 →');
  setText('auth-policy', register ? `新账号可体验 ${state.config?.trial_turns || 20} 次对话，共享 ${points(state.config?.trial_credits ?? 450)} 体验积分；图片使用充值积分。` : '登录后可继续你的历史对话。'); status('auth-status', '');
}
async function openAuth(mode = 'login') { setAuthMode(mode); showDialog('auth-dialog'); await refreshCaptcha(); }
async function refreshCaptcha() {
  const generation = accountGeneration;
  state.captchaId = ''; $('captcha-image').removeAttribute('src'); $('captcha-loading').hidden = false; $('refresh-captcha').disabled = true; setText('captcha-loading', '加载验证码');
  try { const result = await api('/captcha', { silent: true }); state.captchaId = result.id; if (typeof result.svg !== 'string' || !result.svg.trim().startsWith('<svg')) throw new Error('验证码暂时不可用，请点击重试。'); $('captcha-image').src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(result.svg)}`; $('captcha-loading').hidden = true; $('auth-captcha').value = ''; }
  catch (error) { if (isStaleAccountResponse(error)) return; setText('captcha-loading', '点击重试'); status('auth-status', error.message, true); }
  finally { if (generation === accountGeneration) $('refresh-captcha').disabled = false; }
}
async function submitAuth(event) {
  let generation = accountGeneration;
  event.preventDefault(); if (!state.captchaId) { status('auth-status', '请先加载数字验证码。', true); await refreshCaptcha(); return; }
  const form = event.currentTarget; busy(form, true); status('auth-status', '正在验证…');
  try {
    const body = { username: $('auth-username').value.trim(), password: $('auth-password').value, captcha_id: state.captchaId, captcha_answer: $('auth-captcha').value.trim() };
    if (state.authMode === 'register') { if (!$('auth-consent').checked) throw new Error('请阅读并同意服务条款和隐私政策。'); Object.assign(body, { phone: $('auth-phone').value.trim(), name: $('auth-name').value.trim(), department: $('auth-department').value.trim(), accept_terms: true }); }
    const result = await api(`/${state.authMode}`, { method: 'POST', body, silent: true }); updateUser(result.user, { newSession: true }); generation = accountGeneration; closeDialog('auth-dialog'); $('auth-password').value = ''; $('auth-captcha').value = ''; toast(state.authMode === 'register' ? '欢迎加入，开始你的第一段销售对话吧。' : '登录成功，欢迎回来。'); await loadHistory(); assertAccountGeneration(generation); await switchView(state.view);
  } catch (error) { if (isStaleAccountResponse(error)) return; const message = error.message; await refreshCaptcha(); if (generation !== accountGeneration) return; status('auth-status', message, true); }
  finally { if (generation === accountGeneration) busy(form, false); }
}
async function refreshMe() { try { const result = await api('/me', { silent: true }); updateUser(result.user); return result.user; } catch (error) { if (isStaleAccountResponse(error)) return; if (error.status === 401) updateUser(null); return null; } }
function openAccount() {
  if (!state.user) { openAuth('login'); return; }
  const fields = [['用户名', state.user.username], ['姓名', state.user.name], ['手机', state.user.phone], ['部门', state.user.department], ['账号角色', isAdmin() ? '管理员' : '普通用户']]; const list = $('account-details'); empty(list); fields.forEach(([key, value]) => { list.append(el('dt', '', key), el('dd', '', value || '—')); }); status('password-status', ''); showDialog('account-dialog');
}
async function changePassword(event) {
  const generation = accountGeneration;
  event.preventDefault(); busy(event.currentTarget, true); status('password-status', '正在保存…');
  try { const result = await api('/password', { method: 'POST', body: { old_password: $('current-password').value, new_password: $('new-password').value } }); $('password-form').reset(); if (result.login_required) { updateUser(null); closeDialog('account-dialog'); toast('密码已更新，请使用新密码重新登录。'); await openAuth('login'); } else { if (result.user) updateUser(result.user); status('password-status', '密码已更新。'); toast('密码已更新。'); } }
  catch (error) { if (isStaleAccountResponse(error)) return; status('password-status', error.message, true); }
  finally { if (generation === accountGeneration) busy(event.currentTarget, false); }
}
async function logout() { try { await api('/logout', { method: 'POST', body: {} }); updateUser(null); closeDialog('account-dialog'); newChat(); toast('已退出登录。'); } catch (error) { if (isStaleAccountResponse(error)) return; toast(error.message); } }

async function loadKnowledge() {
  const container = $('knowledge-results'); container.className = state.knowledgeTab === 'assets' ? 'asset-grid' : 'knowledge-grid';
  if (!state.user) { authGate(container, '登录后查看佳农品牌知识与产品资产。'); return; }
  status('knowledge-status', '正在查找品牌资料…');
  try { const result = await api(`/knowledge?q=${encodeURIComponent($('knowledge-query').value.trim())}`); state.knowledge = result; renderKnowledge(); }
  catch (error) { if (isStaleAccountResponse(error)) return; status('knowledge-status', error.message, true); empty(container); }
}
function renderKnowledge() {
  const container = $('knowledge-results'); empty(container); container.className = state.knowledgeTab === 'assets' ? 'asset-grid' : 'knowledge-grid';
  const data = state.knowledge || {}; const rows = data[state.knowledgeTab] || [];
  status('knowledge-status', `${state.knowledgeTab === 'assets' ? '品牌资产' : '知识文档'} · ${rows.length} 项${$('knowledge-query').value.trim() ? '匹配结果' : ''}`);
  if (!rows.length) { container.append(el('p', 'loading-placeholder', '暂未找到匹配资料，试试更简短的关键词。')); return; }
  rows.forEach((row) => {
    if (state.knowledgeTab === 'assets') {
      const card = el('button', 'asset-card'); card.type = 'button'; const url = safeUrl(row.preview_url); if (url) { const img = el('img'); img.src = url; img.alt = row.title || '品牌资产'; img.loading = 'lazy'; card.append(img); }
      const copy = el('div'); copy.append(el('h3', '', row.title), el('p', '', row.description || row.summary || row.category || '品牌资产')); card.append(copy); card.addEventListener('click', () => showKnowledge(row, true)); container.append(card);
    } else {
      const card = el('button', 'knowledge-card'); card.type = 'button'; card.append(el('span', 'card-category', row.category || '品牌知识'), el('h3', '', row.title), el('p', '', row.content || row.excerpt || '点击阅读资料')); const foot = el('div', 'card-footer'); foot.append(el('span', '', row.source?.title || row.source_date || '佳农品牌知识'), el('b', '', '↗')); card.append(foot); card.addEventListener('click', () => showKnowledge(row)); container.append(card);
    }
  });
}
function showKnowledge(row, asset = false) {
  setText('detail-category', row.category || 'BRAND KNOWLEDGE'); setText('detail-title', row.title || '品牌资料'); const body = $('detail-body'); empty(body);
  if (asset) { const url = safeUrl(row.preview_url); if (url) { const img = el('img'); img.src = url; img.alt = row.title || ''; body.append(img); } renderText(body, row.description || row.summary || ''); if (row.usage_note) body.append(el('p', '', row.usage_note)); }
  else renderText(body, row.content || row.excerpt || '');
  const source = typeof row.source === 'string' ? row.source : row.source?.title || row.source?.project || '';
  body.append(el('p', 'source-note', [source ? `资料来源：${source}` : '', row.source_date ? `资料日期：${row.source_date}` : '', row.evidence_status ? `资料状态：${row.evidence_status}` : ''].filter(Boolean).join(' · '))); showDialog('detail-dialog');
}

async function loadImages() {
  if (!state.user) { authGate($('image-history'), '登录后查看你的图片作品。'); return; }
  try { const result = await api('/images'); const list = $('image-history'); empty(list); const rows = result.images || []; if (!rows.length) list.append(el('p', 'loading-placeholder', '还没有作品，试着生成第一张品牌创意。')); rows.forEach((row) => { const card = el('button', 'asset-card'); card.type = 'button'; const url = safeUrl(row.url); if (url) { const img = el('img'); img.src = url; img.alt = row.prompt || '生成图片'; img.loading = 'lazy'; card.append(img); } const copy = el('div'); copy.append(el('h3', '', row.prompt?.slice(0, 30) || '品牌图片'), el('p', '', `${imageStatus(row.status)} · ${date(row.created_at)}`)); card.append(copy); card.addEventListener('click', () => openImage(row.id)); list.append(card); }); }
  catch (error) { if (isStaleAccountResponse(error)) return; toast(error.message); }
}
function imageStatus(value) { return ({ pending: '等待生成', queued: '排队中', processing: '正在生成', running: '正在生成', succeeded: '已完成', completed: '已完成', success: '已完成', failed: '生成未完成', refunded: '已退回积分', reserved: '已预留积分', submitting: '正在提交', uncertain: '提交待确认' })[value] || value || '已提交'; }
function imageComplete(result) { return Boolean(result.url) || ['succeeded', 'completed', 'success'].includes(result.status); }
function imageFailed(result) { return ['failed', 'error', 'cancelled', 'refunded'].includes(result.status); }
function renderImageResult(result) {
  const box = $('image-results'); empty(box); const url = safeUrl(result.url);
  if (url) { const card = el('div', 'image-result-card'); const img = el('img'); img.src = url; img.alt = result.prompt || '佳农品牌创意生成结果'; card.append(img, el('p', '', result.prompt || '生成图为创意稿，品牌标识、文字和包装细节请复核后使用。')); const download = el('a', '', '打开原图 / 下载 ↗'); download.href = url; download.target = '_blank'; download.rel = 'noopener noreferrer'; card.append(download); if (result.charged_credits != null) card.append(el('p', '', `本次使用 ${points(result.charged_credits)} 积分`)); box.append(card); }
  else { const card = el('div', 'image-empty'); card.append(el('div', 'empty-art', imageFailed(result) ? '↻' : '✳'), el('h2', '', imageStatus(result.status)), el('p', '', imageFailed(result) ? result.message || '这次图片未能完成，请查看积分流水后再试。' : '图片正在制作，你可以先处理其他工作。\n也可以在「我的图片作品」中继续查看。')); const refresh = el('button', 'light-button', '继续查看进度'); refresh.type = 'button'; refresh.addEventListener('click', () => openImage(result.id)); card.append(refresh); box.append(card); }
}
async function submitImage(event) {
  const generation = accountGeneration;
  event.preventDefault(); if (!requireUser()) return;
  const prompt = $('image-prompt').value.trim(); if (!prompt) return;
  if (state.config?.image_credits && Number(state.user.credits || 0) < Number(state.config.image_credits)) { status('image-status', `本次需预留 ${points(state.config.image_credits)} 通用积分，请先充值后生成。`, true); return; }
  busy(event.currentTarget, true); status('image-status', '正在提交图片创意…');
  try { const imageBody = { prompt, size: $('image-size').value }; const fingerprint = JSON.stringify(imageBody); if (state.lastImageRequest?.fingerprint !== fingerprint) state.lastImageRequest = { fingerprint, id: newId() }; const result = await api('/images', { method: 'POST', body: { ...imageBody, request_id: state.lastImageRequest.id } }); state.lastImageRequest = null; renderImageResult({ ...result, prompt }); status('image-status', '创意已提交，正在生成。'); if (result.user) updateUser(result.user); await loadImages(); assertAccountGeneration(generation); pollImage(result.id); }
  catch (error) { if (isStaleAccountResponse(error)) return; if (['image_rejected','insufficient_credits','rate_limited','prompt_length'].includes(error.data?.error)) state.lastImageRequest = null; status('image-status', error.message, true); if (error.data?.error === 'image_submission_uncertain') await loadImages(); }
  finally { if (generation === accountGeneration) busy(event.currentTarget, false); }
}
async function openImage(id) {
  try { const result = await api(`/images/${encodeURIComponent(id)}`); renderImageResult(result); if (result.user) updateUser(result.user); if (!imageComplete(result) && !imageFailed(result)) pollImage(id); $('image-results').scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
  catch (error) { if (isStaleAccountResponse(error)) return; toast(error.message); }
}
async function pollImage(id) {
  if (!id || state.imagePolls.has(id)) return;
  const generation = accountGeneration; const token = { cancelled: false, generation }; state.imagePolls.set(id, token);
  try {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 15000)); if (token.cancelled || generation !== accountGeneration || !state.user) return;
      const result = await api(`/images/${encodeURIComponent(id)}/poll`, { method: 'POST', body: {} });
      if (token.cancelled) return;
      if (result.user) updateUser(result.user);
      if (imageComplete(result) || imageFailed(result)) { renderImageResult(result); status('image-status', imageComplete(result) ? '图片已生成，作品已保存。' : '图片未完成，请查看积分流水。', imageFailed(result)); await loadImages(); return; }
      status('image-status', `图片${imageStatus(result.status)}，结果将自动显示。`);
    }
    status('image-status', '图片仍在处理。稍后在「我的图片作品」中点击作品，可继续查看。'); await loadImages();
  } catch (error) { if (isStaleAccountResponse(error)) return; status('image-status', `${error.message} 已提交的作品可在下方继续查看。`, true); }
  finally { if (state.imagePolls.get(id) === token) state.imagePolls.delete(id); }
}

function updateWalletSummary() {
  const user = state.user; setText('wallet-balance', user ? points(user.credits) : '—');
  setText('wallet-policy', user ? `通用积分用于对话与图片。你还有 ${Number(user.trial_remaining || 0)} 次对话体验、${points(user.trial_credits)} 体验积分。体验积分仅限对话，在次数或额度用完后结束。` : `注册即可领取 ${state.config?.trial_turns || 20} 次对话体验，共享 ${points(state.config?.trial_credits ?? 450)} 体验积分。图片使用充值积分。`);
}
function renderPackages() {
  const container = $('pricing-plans'); empty(container); const packages = state.config?.packages || [{id:'30',amount_cny:30,credits:3000},{id:'90',amount_cny:90,credits:9000},{id:'300',amount_cny:300,credits:30000}];
  if (!packages.length) { container.append(el('p', 'loading-placeholder', '正在读取充值套餐…')); return; }
  packages.forEach((plan, index) => { const card = el('div', 'price-card'); card.append(el('p', 'plan-name', plan.label || ['轻量补充', '常用之选', '持续创作'][index] || '积分套餐')); const price = el('div', 'plan-price'); price.append(el('small', '', '¥'), document.createTextNode(money(plan.amount_cny))); card.append(price, el('div', 'plan-points', `${points(plan.credits)} 通用积分`), el('p', 'plan-description', ['适合偶尔准备提案、打磨内容。', '适合日常客户沟通与品牌创作。', '适合持续拓客、研究与视觉输出。'][index] || '按需补充，按实际使用扣分。')); const button = el('button', 'primary-button wide', `充值 ${money(plan.amount_cny)} 元 →`); button.type = 'button'; button.addEventListener('click', () => startCheckout(plan.id, button)); card.append(button); container.append(card); });
  setText('billing-note', state.config?.paddle?.enabled ? '付款将在 jianong.eco-geo.org/credits/ 独立软件充值站完成。价格、货币与税费以 Paddle 结账页为准，付款确认后积分自动到账。' : '独立软件充值站 jianong.eco-geo.org/credits/ 正在等待 Paddle 审核；当前暂不收款，已有体验积分可正常使用。');
  const portal = el('a', 'source-chip', '查看独立充值站 ↗'); portal.href = 'https://jianong.eco-geo.org/credits/'; portal.target = '_blank'; portal.rel = 'noopener noreferrer'; $('billing-note').append(document.createTextNode(' '), portal);
}
async function loadWallet() {
  renderPackages(); updateWalletSummary();
  const body = $('ledger-body'); empty(body); renderOrders([]);
  if (!state.user) { const tr = el('tr'); const td = el('td', 'empty-row', '登录后查看你的积分流水。'); td.colSpan = 4; tr.append(td); body.append(tr); return; }
  try { const result = await api('/wallet'); if (result.user) updateUser(result.user); renderOrders(result.orders || []); const ledger = result.ledger || []; if (!ledger.length) { const tr = el('tr'); const td = el('td', 'empty-row', '尚无积分记录。'); td.colSpan = 4; tr.append(td); body.append(tr); } ledger.forEach((row) => { const tr = el('tr'); const amount = Number(row.credits || 0); tr.append(el('td', '', date(row.created_at)), el('td', '', row.note || ledgerKind(row.kind)), el('td', amount >= 0 ? 'positive' : 'negative', `${amount > 0 ? '+' : ''}${points(amount)}${row.trial ? ' 体验' : ''}`), el('td', '', ledgerKind(row.kind))); body.append(tr); }); }
  catch (error) { if (isStaleAccountResponse(error)) return; toast(error.message); }
}
function renderOrders(orders) {
  const body = $('orders-body'); if (!body) return; empty(body);
  if (!orders.length) { const tr = el('tr'), td = el('td', 'empty-row', state.user ? '尚无充值订单。' : '登录后查看你的充值订单。'); td.colSpan = 4; tr.append(td); body.append(tr); return; }
  const labels = { creating: '正在创建', pending: '待付款 / 确认中', uncertain: '待核实，请勿重复付款', paid: '已到账', partially_reversed: '部分退回', reversed: '已退回' };
  for (const order of orders) { const tr = el('tr'); tr.append(el('td', '', date(order.created_at)), el('td', '', order.id), el('td', '', `¥${money(order.amount_cny)} / ${points(order.credits)} 积分`), el('td', '', labels[order.status] || order.status)); body.append(tr); }
}
function ledgerKind(kind) { return ({ purchase: '充值到账', recharge: '充值到账', chat: '对话使用', image: '图片生成', refund: '积分退回', trial: '体验积分', trial_grant: '体验赠送', admin_credit: '管理员赠送', admin_grant: '管理员赠送', welcome: '体验赠送', reserve: '积分预留', settle: '使用结算', release: '预留退回', credit: '赠送积分', image_reserve: '图片积分预留', image_refund: '图片积分退回' })[kind] || '积分变动'; }
async function startCheckout(packageId, button) {
  const generation = accountGeneration;
  if (!requireUser()) return;
  if (!state.config?.paddle?.enabled) { toast('独立充值站正在等待 Paddle 审核，审核通过后开放购买。'); return; }
  button.disabled = true;
  try { const result = await api('/checkout', { method: 'POST', body: { package_id: packageId, request_id: state.checkoutRequests.get(packageId) || (state.checkoutRequests.set(packageId, newId()), state.checkoutRequests.get(packageId)) } }); assertAccountGeneration(generation); const url = new URL(result.checkout_url); if (url.origin !== 'https://jianong.eco-geo.org' || url.pathname !== '/credits/' || url.searchParams.get('_ptxn') !== result.transaction_id || !/^txn_[a-z0-9]{26}$/.test(result.transaction_id) || url.username || url.password || url.hash || [...url.searchParams].length !== 1) throw new Error('结账链接尚未准备好，请稍后重试。'); window.location.assign(url.href); }
  catch (error) { if (isStaleAccountResponse(error)) return; toast(error.message); }
  finally { if (generation === accountGeneration) button.disabled = false; }
}


async function loadAdmin() {
  if (!isAdmin()) return; const generation = accountGeneration;
  await loadAdminStats(); if (generation !== accountGeneration) return; status('admin-status', '正在读取团队成员…');
  try { const result = await api(`/admin/users?q=${encodeURIComponent($('admin-query').value.trim())}`); const body = $('admin-users'); empty(body); const users = result.users || []; status('admin-status', `${users.length} 位成员`); if (!users.length) { const tr = el('tr'); const td = el('td', 'empty-row', '暂无匹配成员。'); td.colSpan = 6; tr.append(td); body.append(tr); }
    users.forEach((user) => { const tr = el('tr'); const identity = el('td'); identity.append(el('strong', '', user.name || user.username), el('small', '', user.username)); const contact = el('td'); contact.append(el('span', '', user.department || '—'), el('small', '', user.phone || '—')); const statusCell = el('td'); statusCell.append(el('span', `status-pill${user.disabled ? ' disabled' : ''}`, user.disabled ? '已停用' : '可使用')); const actions = el('td'); const group = el('div', 'table-actions'); [['credit', '赠送积分'], ['reset_password', '重置密码'], [user.disabled ? 'enable' : 'disable', user.disabled ? '启用' : '停用']].forEach(([action, label]) => { const button = el('button', '', label); button.type = 'button'; if (['admin', 'super'].includes(user.role)) { button.disabled = true; button.title = '管理员账户受保护，请在我的账号中修改密码'; } button.addEventListener('click', () => adminAction(user, action)); group.append(button); }); actions.append(group); tr.append(identity, contact, el('td', '', ['admin', 'super'].includes(user.role) ? '管理员' : '普通用户'), el('td', '', points(user.credits)), statusCell, actions); body.append(tr); });
  } catch (error) { if (isStaleAccountResponse(error)) return; status('admin-status', error.message, true); }
}
async function adminAction(user, action) {
  if (['disable', 'enable'].includes(action)) { try { await api(`/admin/users/${encodeURIComponent(user.id)}`, { method: 'POST', body: { action } }); toast(action === 'disable' ? '账号已停用。' : '账号已启用。'); await loadAdmin(); } catch (error) { if (isStaleAccountResponse(error)) return; toast(error.message); } return; }
  state.adminAction = { user, action }; $('admin-action-form').reset(); setText('admin-action-title', action === 'credit' ? '赠送积分' : '重置密码'); setText('admin-action-description', `操作账号：${user.name || user.username}（${user.username}）`); setText('admin-action-label', action === 'credit' ? '赠送积分数量' : '设置新密码'); const input = $('admin-action-value'); input.type = action === 'credit' ? 'number' : 'password'; input.value = ''; input.min = action === 'credit' ? '1' : ''; input.step = '1'; if (action === 'credit') input.removeAttribute('minlength'); else input.minLength = 10; input.maxLength = action === 'credit' ? 12 : 128; input.autocomplete = 'new-password'; $('admin-action-reason').required = action === 'credit'; input.placeholder = action === 'credit' ? '输入要赠送的积分' : '至少 10 位字符'; status('admin-action-status', ''); showDialog('admin-action-dialog');
}
async function submitAdminAction(event) {
  const generation = accountGeneration;
  event.preventDefault(); if (!state.adminAction) return; busy(event.currentTarget, true); const { user, action } = state.adminAction;
  try { const body = { action, note: $('admin-action-reason').value.trim() }; if (action === 'credit') { body.credits = Number($('admin-action-value').value); if (!Number.isInteger(body.credits) || body.credits <= 0 || body.credits > 1000000) throw new Error('请输入 1–1000000 之间的整数积分。'); } else body.password = $('admin-action-value').value; await api(`/admin/users/${encodeURIComponent(user.id)}`, { method: 'POST', body }); closeDialog('admin-action-dialog'); $('admin-action-value').value = ''; toast(action === 'credit' ? '积分已赠送。' : '密码已重置，请通过合适渠道告知该成员。'); await loadAdmin(); if (user.id === state.user?.id) await refreshMe(); }
  catch (error) { if (isStaleAccountResponse(error)) return; status('admin-action-status', error.message, true); }
  finally { if (generation === accountGeneration) busy(event.currentTarget, false); }
}

async function loadCustomers() {
  const container = $('customer-list'); if (!state.user) { authGate(container, '登录后建立你的客户档案，客户资料仅本人可见。'); return; } status('customer-status', '正在读取你的客户…');
  try { const result = await api(`/customers?q=${encodeURIComponent($('customer-query').value.trim())}&archived=${state.customerFilter === 'archived' ? '1' : '0'}`); state.customers = result.customers || []; empty(container); status('customer-status', `${state.customers.length} 位${state.customerFilter === 'archived' ? '已归档' : ''}客户 · 仅本人可见`); if (!state.customers.length) { const box = el('div', 'auth-gate', state.customerFilter === 'archived' ? '还没有归档客户。' : '还没有客户档案，把下一位客户的需求记录下来吧。'); const button = el('button', 'primary-button', '添加第一位客户'); button.type = 'button'; button.addEventListener('click', () => editCustomer()); box.append(button); container.append(box); }
    state.customers.forEach((customer) => { const card = el('article', 'customer-card'); const top = el('div', 'customer-card-top'); top.append(el('h3', '', customer.company || '未命名客户'), el('span', 'status-pill', customer.stage || '线索')); card.append(top, el('p', '', [customer.contact, customer.city, customer.channel].filter(Boolean).join(' · ') || '等待完善客户资料'), el('p', 'customer-needs', customer.needs || '暂未记录需求')); const bottom = el('div', 'customer-card-bottom'); bottom.append(el('small', '', customer.next_follow_up ? `下次跟进 ${date(customer.next_follow_up)}` : '尚未安排下次跟进')); const button = el('button', 'text-button', '打开客户档案 ↗'); button.type = 'button'; button.textContent = customer.archived ? '恢复客户 ↗' : '打开客户档案 ↗'; button.addEventListener('click', () => customer.archived ? restoreCustomer(customer.id) : openCustomer(customer.id)); bottom.append(button); card.append(bottom); container.append(card); });
  } catch (error) { if (isStaleAccountResponse(error)) return; status('customer-status', error.message, true); }
}
function localDate(value) { if (!value) return ''; const d = new Date(value); if (Number.isNaN(d.getTime())) return ''; const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000); return local.toISOString().slice(0, 16); }
function inputDate(value) { return value ? new Date(value).toISOString() : null; }
function editCustomer(customer = null) {
  if (!requireUser()) return; state.editCustomerId = customer?.id || null; $('customer-form').reset(); $('customer-raw').value = ''; setText('customer-title', customer ? '编辑客户资料' : '添加客户'); status('customer-form-status', '');
  if (customer) ['company', 'contact', 'phone', 'city', 'channel', 'stage', 'needs', 'notes', 'next_follow_up'].forEach((field) => { const input = $('customer-form').elements[field]; const value = field === 'next_follow_up' ? localDate(customer[field]) : customer[field] || ''; if (input instanceof HTMLSelectElement && value && ![...input.options].some((option) => option.value === value)) { const option = el('option', '', value); option.value = value; input.append(option); } input.value = value; });
  closeDialog('customer-detail-dialog'); showDialog('customer-dialog');
}
function parseCustomer() {
  const raw = $('customer-raw').value.trim(); if (!raw) { toast('先粘贴客户信息，再整理到表单。'); return; }
  const mappings = { company: ['公司', '企业', '客户', '单位', '公司名称'], contact: ['联系人', '姓名', '联络人'], phone: ['手机', '电话', '联系方式', '手机号码'], city: ['城市', '地区', '所在城市'], needs: ['需求', '采购需求', '客户需求'], notes: ['备注', '补充信息'] };
  let count = 0; const form = $('customer-form');
  Object.entries(mappings).forEach(([field, labels]) => { const regex = new RegExp(`(?:^|\\n)\\s*(?:${labels.join('|')})\\s*[:：]\\s*([^\\n]+)`, 'i'); const match = raw.match(regex); if (match) { form.elements[field].value = match[1].trim(); count += 1; } });
  if (!form.elements.phone.value) { const phone = raw.match(/(?:\+?86[-\s]?)?1[3-9]\d{9}/); if (phone) { form.elements.phone.value = phone[0]; count += 1; } }
  if (!count && !form.elements.notes.value) form.elements.notes.value = raw;
  toast(count ? `已初填 ${count} 项，请核对后保存。` : '已保留到备注，请补充公司与联系人后保存。');
}
async function saveCustomer(event) {
  const generation = accountGeneration;
  event.preventDefault(); busy(event.currentTarget, true); status('customer-form-status', '正在保存…');
  try { const data = Object.fromEntries(new FormData(event.currentTarget)); data.raw_text = $('customer-raw').value.trim(); data.next_follow_up = inputDate(data.next_follow_up); const id = state.editCustomerId; await api(id ? `/customers/${encodeURIComponent(id)}` : '/customers', { method: id ? 'PATCH' : 'POST', body: data }); closeDialog('customer-dialog'); toast('客户资料已保存。'); await loadCustomers(); assertAccountGeneration(generation); if (id) await openCustomer(id); }
  catch (error) { if (isStaleAccountResponse(error)) return; status('customer-form-status', error.message, true); }
  finally { if (generation === accountGeneration) busy(event.currentTarget, false); }
}
async function openCustomer(id) {
  try { const result = await api(`/customers/${encodeURIComponent(id)}`); state.customer = result.customer; const customer = result.customer; if (!customer) throw new Error('未找到这位客户。'); setText('customer-detail-title', customer.company); const body = $('customer-detail-body'); empty(body); const dl = el('dl', 'customer-info-grid'); [['联系人', customer.contact], ['手机 / 电话', customer.phone], ['城市 / 渠道', [customer.city, customer.channel].filter(Boolean).join(' · ')], ['当前阶段', customer.stage], ['客户需求', customer.needs], ['补充备注', customer.notes], ['下次跟进', date(customer.next_follow_up)]].forEach(([key, value]) => dl.append(el('dt', '', key), el('dd', '', value || '—'))); body.append(dl); $('activity-form').reset(); $('activity-next').value = localDate(customer.next_follow_up); status('activity-status', ''); const activities = $('activity-list'); empty(activities); if (!result.activities?.length) activities.append(el('p', 'field-help', '还没有跟进记录。')); (result.activities || []).forEach((activity) => { const item = el('div', 'activity-item'); item.append(el('small', '', [date(activity.created_at), activity.stage].filter(Boolean).join(' · ')), el('p', '', activity.content)); activities.append(item); }); showDialog('customer-detail-dialog'); }
  catch (error) { if (isStaleAccountResponse(error)) return; toast(error.message); }
}
async function saveActivity(event) {
  const generation = accountGeneration;
  event.preventDefault(); if (!state.customer) return; busy(event.currentTarget, true);
  try { await api(`/customers/${encodeURIComponent(state.customer.id)}/activities`, { method: 'POST', body: { content: $('activity-content').value.trim(), next_follow_up: inputDate($('activity-next').value), stage: $('activity-stage').value || state.customer.stage } }); toast('跟进记录已保存。'); await openCustomer(state.customer.id); assertAccountGeneration(generation); await loadCustomers(); }
  catch (error) { if (isStaleAccountResponse(error)) return; status('activity-status', error.message, true); }
  finally { if (generation === accountGeneration) busy(event.currentTarget, false); }
}
async function archiveCustomer() {
  if (!state.customer) return;
  try { await api(`/customers/${encodeURIComponent(state.customer.id)}`, { method: 'DELETE', body: {} }); closeDialog('customer-detail-dialog'); if (state.customerId === state.customer.id) { state.customerId = null; renderCustomerContext(); } toast('客户已归档。'); await loadCustomers(); }
  catch (error) { if (isStaleAccountResponse(error)) return; toast(error.message); }
}
function proposalForCustomer() {
  if (!state.customer) return; if (state.pendingChat) { toast('当前回答完成后即可准备客户方案。'); return; }
  newChat(); state.customerId = state.customer.id; setMode('proposal'); closeDialog('customer-detail-dialog'); renderCustomerContext();
  $('chat-input').value = `请为${state.customer.company}准备一份佳农水果合作沟通方案，结合客户档案中的渠道、需求和最近跟进记录，给出合作思路、关键确认问题与下一步行动。`; $('chat-input').focus();
}
function renderCustomerContext() {
  $('customer-context')?.remove(); if (!state.customerId) return; const customer = state.customers.find((item) => item.id === state.customerId) || (state.customer?.id === state.customerId ? state.customer : null);
  const box = el('div', 'customer-context', `当前客户：${customer?.company || '已关联客户'} · 本次对话结合你的客户资料`); box.id = 'customer-context'; const remove = el('button', '', '解除关联 ×'); remove.type = 'button'; remove.addEventListener('click', () => { state.customerId = null; renderCustomerContext(); }); box.append(remove); $('view-chat').insertBefore(box, $('messages'));
}



async function loadAdminStats() {
  try {
    const stats = await api('/admin/stats'); const metrics = $('admin-metrics'); empty(metrics);
    [['团队账户', stats.users], ['模型请求', stats.requests], ['累计 API 成本 ¥', stats.cost_cny], ['累计到账 ¥', stats.paid_cny]].forEach(([label, value]) => { const card = el('div', 'metric-card'); card.append(el('strong', '', money(value)), el('span', '', label)); metrics.append(card); });
    const rows = $('admin-image-tasks'); empty(rows);
    if (!stats.unresolved_images?.length) { const tr = el('tr'), td = el('td', 'empty-row', '暂无需要核实的图片任务。'); td.colSpan = 4; tr.append(td); rows.append(tr); }
    (stats.unresolved_images || []).forEach((task) => { const tr = el('tr'), identity = el('td'); identity.append(el('strong', '', task.id), el('small', '', `用户 ${task.user_id}`)); const actions = el('td'), group = el('div', 'table-actions'); [['refund', '核实后退款'], ['recover', '恢复已有任务']].forEach(([action, label]) => { const button = el('button', '', label); button.type = 'button'; button.addEventListener('click', () => openImageAdmin(task, action)); group.append(button); }); actions.append(group); tr.append(identity, el('td', '', date(task.created_at)), el('td', '', points(task.reserved)), actions); rows.append(tr); });
  } catch (error) { if (isStaleAccountResponse(error)) return; status('admin-status', error.message, true); }
}
function openImageAdmin(task, action) {
  state.imageAdmin = { task, action }; $('image-admin-form').reset();
  setText('image-admin-title', action === 'refund' ? '供应商核实后，归还积分' : '恢复已有的供应商任务');
  setText('image-admin-description', `任务 ${task.id}。${action === 'refund' ? '请确认已在供应商核实这笔任务可以退款，再记录依据。' : '请填写在 APIMart 查到的原 task_id，仅恢复状态跟踪。'}`);
  $('provider-task-label').hidden = action === 'refund'; $('provider-task-id').required = action === 'recover';
  setText('image-admin-submit', action === 'refund' ? '已核实，归还预留积分' : '已核实，恢复任务跟踪'); status('image-admin-status', ''); showDialog('image-admin-dialog');
}
async function submitImageAdmin(event) {
  const generation = accountGeneration;
  event.preventDefault(); if (!state.imageAdmin) return; const { task, action } = state.imageAdmin; busy(event.currentTarget, true);
  try { const note = $('image-admin-note').value.trim(); if (note.length < 5) throw new Error('请填写至少 5 个字的核实依据。'); const body = { action, note }; if (action === 'recover') body.provider_task = $('provider-task-id').value.trim(); await api(`/admin/images/${encodeURIComponent(task.id)}`, { method: 'POST', body }); closeDialog('image-admin-dialog'); toast(action === 'refund' ? '预留积分已归还，并留下处理记录。' : '已恢复原任务跟踪。'); await loadAdminStats(); }
  catch (error) { if (isStaleAccountResponse(error)) return; status('image-admin-status', error.message, true); }
  finally { if (generation === accountGeneration) busy(event.currentTarget, false); }
}

function friendlyError(code) {
  return ({ login_required: '请先登录账号。', auth_required: '请先登录账号。', invalid_credentials: '用户名或密码不正确，请核对后重试。', invalid_username: '用户名需为 3–32 位字母、数字、点、短横线或下划线。', invalid_phone: '请输入有效的中国大陆手机号码。', profile_required: '请填写姓名和部门。', terms_required: '请阅读并同意服务条款和隐私政策。', password_length: '密码需为 10–128 位字符。', captcha_invalid: '数字验证码不正确或已过期，请重新输入。', account_exists: '用户名或手机已注册，请直接登录或更换信息。', rate_limited: '操作较频繁，请稍后重试。', insufficient_credits: '可用积分不足，请在「我的积分」中充值后继续。', model_unavailable: '对话服务正在准备中，请稍后重试。', image_unavailable: '图片服务正在准备中，请稍后重试。', billing_unavailable: 'Paddle 在线支付正在开通，开通后即可充值。', provider_unavailable: '本次服务暂未完成，请稍后重试，未完成的对话会归还预留积分。', answer_incomplete: '本次回答未完整生成，请稍后重试。', answer_invalid: '本次回答未能完成校验，请重试。', citation_invalid: '本次来源未能完成校验，请重试。', image_rejected: '本次图片生成未被受理，请调整描述后重试。', image_submission_uncertain: '图片提交结果正在确认，请先查看「我的图片作品」，避免重复提交。', previous_request_failed: '上一次请求未完成且积分已归还，请再次发送以重新生成。', request_in_progress: '相同请求正在处理，请稍后查看历史记录。', request_pending: '相同请求仍在处理，请稍后查看历史记录。', request_conflict: '这次请求已经提交，请重新打开记录查看。', company_required: '请填写客户公司名称。', customer_field_too_long: '部分客户信息过长，请缩短后保存。', invalid_followup_date: '请填写有效的下次跟进时间。', activity_required: '请填写本次跟进记录。', admin_account_protected: '管理员账户受保护，请在「我的账号」中修改自己的密码。', invalid_credit: '请输入 1–1000000 的整数积分，并填写赠送备注。', admin_required: '此操作仅对管理员开放。', account_disabled: '该账户暂不可用。', customer_not_found: '未找到这位客户，请刷新客户列表。', conversation_not_found: '未找到这段对话，请刷新历史记录。', image_not_found: '未找到这张图片，请刷新作品列表。', message_length: '问题需为 2–4000 个字符。', prompt_length: '图片描述需为 5–3000 个字符。', package_invalid: '请选择有效的充值套餐。', paddle_unavailable: '支付服务暂时未响应，请稍后重试。', checkout_invalid: '结账链接尚未准备好，请稍后重试。', body_too_large: '本次提交内容过长，请缩短后重试。', service_unavailable: '服务暂时未完成请求，请稍后重试。' })[code] || '服务暂时未完成请求，请稍后重试。';
}
async function restoreCustomer(id) {
  try { await api(`/customers/${encodeURIComponent(id)}`, { method: 'PATCH', body: { archived: false } }); toast('客户已恢复到跟进列表。'); await loadCustomers(); }
  catch (error) { if (isStaleAccountResponse(error)) return; toast(error.message); }
}
async function loadListening() {
  if (!state.user) { authGate($('listening-results'), '登录后查看完整社媒历史样本与来源索引。'); setText('listening-notice', '品牌社媒资料为历史采样，展示采样时间、平台口径及来源，不代表实时全网舆情。'); return; }
  status('listening-status', '正在整理历史采样…');
  try {
    if (!state.social) state.social = await api('/social-listening');
    const { summary = {}, platforms = [] } = state.social;
    const sampled = String(summary.sampled_at || '').slice(0, 10);
    setText('listening-notice', `${sampled ? `采样日期：${sampled}。` : ''}${summary.interpretation || '探索性历史采样，非实时、非全网全量；跨平台互动口径不同，主题、情绪与 ToB 相关度均为机器辅助标签。'}`);
    const metrics = $('listening-metrics'); empty(metrics);
    [['内容样本', summary.content_count], ['覆盖平台', summary.platforms_with_records], ['评论样本', summary.comment_count], ['ToB 高相关样本', summary.high_tob_count]].forEach(([label, value]) => { const card = el('div', 'metric-card'); card.append(el('strong', '', points(value)), el('span', '', label)); metrics.append(card); });
    const table = $('listening-platforms'); empty(table);
    platforms.forEach((platform) => { const tr = el('tr'); [platform.platform, points(platform.content_count), points(platform.visible_interactions), points(platform.high_tob_count), points(platform.comment_sample_count)].forEach((value) => tr.append(el('td', '', value))); table.append(tr); });
    const themes = $('listening-themes'); empty(themes); Object.entries(summary.theme_labels || {}).forEach(([name, count]) => { const card = el('div', 'theme-card'); card.append(el('span', '', name), el('strong', '', points(count))); themes.append(card); });
    const select = $('listening-platform'); const current = select.value; empty(select); const all = el('option', '', '全部平台'); all.value = ''; select.append(all); platforms.forEach((platform) => { const option = el('option', '', platform.platform); option.value = platform.platform; select.append(option); }); select.value = current;
    renderSocialAssets();
  } catch (error) { if (isStaleAccountResponse(error)) return; status('listening-status', error.message, true); }
}
function renderSocialAssets() {
  if (!state.social || !state.user) return;
  const query = $('listening-query').value.trim().toLowerCase(), platform = $('listening-platform').value;
  const assets = (state.social.assets || []).filter((asset) => (!platform || asset.platform === platform) && (!query || [asset.title, asset.theme, asset.tob_relevance, asset.platform].filter(Boolean).join(' ').toLowerCase().includes(query)));
  setText('listening-count', `共 ${state.social.assets?.length || 0} 条历史来源`); status('listening-status', `显示 ${assets.length} 条样本 · 互动数为历史采样时可见数值`);
  const list = $('listening-results'); empty(list);
  if (!assets.length) list.append(el('p', 'loading-placeholder', '暂未找到匹配样本。'));
  assets.forEach((asset, index) => {
    const card = el('article', 'listening-card'); card.append(el('span', 'listening-index', String(index + 1).padStart(2, '0')));
    const copy = el('div', 'listening-copy'), title = el('h3'); const url = safeUrl(asset.url, false);
    if (url) { const link = el('a', '', asset.title || '未命名内容'); link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer'; title.append(link); } else title.textContent = asset.title || '未命名内容';
    const tags = el('div', 'listening-tags'); [asset.platform, asset.theme, asset.ownership_label, asset.sentiment_label, asset.tob_relevance ? `ToB ${asset.tob_relevance}` : ''].filter(Boolean).forEach((tag) => tags.append(el('span', '', tag)));
    copy.append(title, tags, el('p', '', [`可见互动 ${points(asset.visible_interactions)}`, asset.published_at ? `发布于 ${String(asset.published_at).slice(0, 10)}` : '原始发布时间未记录', asset.note || '历史搜索样本，请结合来源语境解读。'].join(' · '))); card.append(copy);
    if (url) { const link = el('a', 'listening-link', '↗'); link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.setAttribute('aria-label', `打开来源：${asset.title || '社媒内容'}`); card.append(link); } list.append(card);
  });
}

function bindEvents() {
  document.querySelectorAll('[data-view]').forEach((node) => node.addEventListener('click', () => switchView(node.dataset.view)));
  document.querySelectorAll('[data-mode]').forEach((node) => node.addEventListener('click', () => setMode(node.dataset.mode)));
  document.querySelectorAll('.close-dialog').forEach((node) => node.addEventListener('click', () => node.closest('dialog').close()));
  document.querySelectorAll('dialog').forEach((dialog) => dialog.addEventListener('click', (event) => { if (event.target !== dialog) return; const rect = dialog.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close(); }));
  $('new-chat').addEventListener('click', newChat); $('account-button').addEventListener('click', openAccount); $('credit-shortcut').addEventListener('click', () => switchView('wallet'));
  $('chat-form').addEventListener('submit', sendChat); $('chat-input').addEventListener('keydown', (event) => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && matchMedia('(min-width:701px)').matches) { event.preventDefault(); $('chat-form').requestSubmit(); } });
  $('refresh-history').addEventListener('click', loadHistory);
  $('auth-tab-login').addEventListener('click', () => setAuthMode('login')); $('auth-tab-register').addEventListener('click', () => setAuthMode('register')); $('refresh-captcha').addEventListener('click', refreshCaptcha); $('auth-form').addEventListener('submit', submitAuth); $('password-form').addEventListener('submit', changePassword); $('logout').addEventListener('click', logout);
  $('knowledge-search').addEventListener('submit', (event) => { event.preventDefault(); loadKnowledge(); }); document.querySelectorAll('[data-knowledge-tab]').forEach((button) => button.addEventListener('click', () => { state.knowledgeTab = button.dataset.knowledgeTab; document.querySelectorAll('[data-knowledge-tab]').forEach((node) => { node.classList.toggle('active', node === button); node.setAttribute('aria-pressed', String(node === button)); }); if (state.knowledge) renderKnowledge(); else loadKnowledge(); }));
  $('image-form').addEventListener('submit', submitImage); $('refresh-images').addEventListener('click', loadImages); document.querySelectorAll('[data-image-preset]').forEach((button) => button.addEventListener('click', () => { $('image-prompt').value = button.dataset.imagePreset; $('image-prompt').focus(); }));
  $('refresh-wallet').addEventListener('click', loadWallet); $('billing-help').addEventListener('click', () => { window.open('/jianong/refunds.html', '_blank', 'noopener'); });
  $('admin-search').addEventListener('submit', (event) => { event.preventDefault(); loadAdmin(); }); $('admin-action-form').addEventListener('submit', submitAdminAction); $('image-admin-form').addEventListener('submit', submitImageAdmin);
  $('listening-search').addEventListener('submit', (event) => { event.preventDefault(); renderSocialAssets(); }); $('listening-platform').addEventListener('change', renderSocialAssets);
  document.querySelectorAll('[data-customer-filter]').forEach((button) => button.addEventListener('click', () => { state.customerFilter = button.dataset.customerFilter; document.querySelectorAll('[data-customer-filter]').forEach((node) => { node.classList.toggle('active', node === button); node.setAttribute('aria-pressed', String(node === button)); }); loadCustomers(); }));
  $('new-customer').addEventListener('click', () => editCustomer()); $('customer-search').addEventListener('submit', (event) => { event.preventDefault(); loadCustomers(); }); $('customer-form').addEventListener('submit', saveCustomer); $('parse-customer').addEventListener('click', parseCustomer); $('edit-customer').addEventListener('click', () => editCustomer(state.customer)); $('archive-customer').addEventListener('click', archiveCustomer); $('activity-form').addEventListener('submit', saveActivity); $('customer-proposal').addEventListener('click', proposalForCustomer);
}
async function initialize() {
  const generation = accountGeneration;
  bindEvents(); setMode('sales'); renderHistory(); renderPackages();
  const results = await Promise.allSettled([api('/config', { silent: true }), api('/me', { silent: true })]);
  if (results[0].status === 'fulfilled') { state.config = results[0].value; renderPackages(); if (state.config.image_credits != null) setText('image-price-note', `本次最多预留 ${points(state.config.image_credits)} 通用积分，完成后按用量结算、多余退回；生成图为创意稿，品牌标识、包装与文字请复核后使用。`); }
  else if (!isStaleAccountResponse(results[0].reason)) { toast('服务配置暂时无法读取，登录前请稍后刷新。'); setText('billing-note', '充值配置暂时未能读取，请稍后刷新。'); }
  if (generation === accountGeneration) { if (results[1].status === 'fulfilled') { updateUser(results[1].value.user); await loadHistory(); } else if (!isStaleAccountResponse(results[1].reason)) updateUser(null); }
  const entry = new URLSearchParams(location.search);
  const recharge = entry.get('recharge');
  if (entry.get('view') === 'wallet' || ['30', '90', '300'].includes(recharge)) {
    await switchView('wallet');
    if (recharge) toast(`已选择 ${recharge} 元软件积分套餐，请确认账号后点击对应套餐继续。`);
  }
  const oldTransaction = entry.get('_ptxn');
  if (oldTransaction && /^txn_[a-z0-9]{26}$/.test(oldTransaction)) {
    await switchView('wallet');
    toast('付款入口已迁移到独立充值站，请从积分页面重新选择套餐。');
  }
}
initialize();
