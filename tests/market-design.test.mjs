import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as jsx from 'react/jsx-runtime';
import { brandDisplay } from './helpers/brand-display.mjs';

async function load(path, mocks = {}, globals = {}) {
  const file = new URL(path, import.meta.url), mod = { exports: {} };
  const code = ts.transpileModule(await readFile(file, 'utf8'), { fileName: file.pathname, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, { module: mod, exports: mod.exports, require: name => { if (name in mocks) return mocks[name]; throw Error(name); }, URL, URLSearchParams, Event, ...globals });
  return mod.exports;
}
const identity = await load('../lib/model-identity.ts');
const snapshot = JSON.parse(await readFile(new URL('../lib/model-directory-snapshot.json', import.meta.url), 'utf8'));
const refs = await load('../lib/tokenhub-model-reference.ts');
const ids = await load('../lib/model-id.ts');
const kinds = await load('../lib/model-request-kind.ts');
const catalog = await load('../lib/model-catalog.ts', { './tokenhub-model-reference': refs, './model-directory-snapshot.json': { default: snapshot }, './model-id': ids, './model-request-kind': kinds, './model-identity': identity });
const selected = JSON.parse(await readFile(new URL('../lib/rkapi-catalog-snapshot.json', import.meta.url), 'utf8')).models.map(row => ({ id: row.id, name: row.name, provider: row.manufacturer, category: row.category, upstream: 'selected', available: false, capabilities: [row.category === 'image' ? '图像生成' : '文本生成'], description: '', docs: '/dashboard/docs?provider=selected' }));
const fullCatalog = [...catalog.allModelCatalog, ...selected];
const nodes = (node, predicate) => Array.isArray(node) ? node.flatMap(child => nodes(child, predicate)) : !node?.props ? [] : [...(predicate(node) ? [node] : []), ...nodes(node.props.children, predicate)];
const text = node => typeof node === 'string' || typeof node === 'number' ? String(node) : Array.isArray(node) ? node.map(text).join('') : node?.props ? text(node.props.children) : '';

async function harness({ models = fullCatalog, url = 'https://tokvilo.com/models', english = false } = {}) {
  let location = new URL(url), hooks = [], index = 0, tree;
  const effects = [], listeners = new Map(), history = [], scrollCalls = [], focusCalls = [];
  const window = { get location() { return location; }, dispatchEvent(event) { listeners.get(event.type)?.(event); }, history: { state: { preserved: true }, pushState(state, _, path) { history.push(['push', state, path]); location = new URL(path, location); }, replaceState(state, _, path) { history.push(['replace', state, path]); location = new URL(path, location); } }, addEventListener(name, fn) { listeners.set(name, fn); }, removeEventListener(name) { listeners.delete(name); } };
  const ui = await load('../components/ModelMarket.tsx', {
    '@/lib/model-catalog': catalog, '@/lib/brand-display': brandDisplay, '@/lib/model-identity': identity,
    'react/jsx-runtime': jsx, 'next/link': { default: 'a' }, './Icon': { Icon: () => null }, './PriceTable': { PriceTable: () => null }, './ProviderLogo': { ProviderLogo: () => null },
    './LocaleProvider': { useSiteLocale: () => ({ isEnglish: english, locale: english ? 'en' : 'zh', t: (zh, en) => english ? en : zh, href: path => english ? `${path}${path.includes('?') ? '&' : '?'}lang=en` : path }) },
    react: {
      useState(initial) { const i = index++; if (!(i in hooks)) hooks[i] = initial; return [hooks[i], value => { hooks[i] = typeof value === 'function' ? value(hooks[i]) : value; }]; },
      useEffect(fn, deps) { const i = index++; const old = hooks[i]; if (!old || !deps || deps.some((dep, position) => !Object.is(dep, old[position]))) effects.push(fn); hooks[i] = deps; },
      useRef(initial) { const i = index++; if (!(i in hooks)) hooks[i] = { current: initial }; return hooks[i]; },
      useMemo: fn => fn(),
    },
  }, { window });
  const render = () => {
    index = 0; tree = ui.ModelMarket({ catalog: models });
    const results = nodes(tree, node => node.props.className === 'market-results')[0];
    if (results) results.props.ref.current = { focus: options => focusCalls.push(options), scrollIntoView: options => scrollCalls.push(options) };
    effects.splice(0).forEach(effect => effect());
    return tree;
  };
  render(); render();
  return { ui, render, history, scrollCalls, focusCalls, get tree() { return tree; }, get url() { return location; }, goBack(nextUrl) { location = new URL(nextUrl); listeners.get('popstate')(); render(); } };
}

test('family overview and paginated model lists retain every catalogue service identity exactly once', async () => {
  const h = await harness();
  assert.equal(nodes(h.tree, node => node.type === 'article').length, 0, 'Overview does not render hundreds of models');
  const families = [];
  for (;;) {
    const tiles = nodes(h.tree, node => node.props.className === 'market-family-tile');
    assert.ok(tiles.length <= h.ui.MARKET_PAGE_SIZE);
    families.push(...tiles.map(node => [node.props['data-provider-id'], node.props['data-family-id']]));
    const next = nodes(h.tree, node => node.props['aria-label'] === '下一页')[0];
    if (!next || next.props.disabled) break;
    next.props.onClick(); h.render();
  }
  assert.equal(families.length, identity.groupModels(fullCatalog).length);
  const identities = [];
  for (const [provider, family] of families) {
    h.goBack(`https://tokvilo.com/models?provider=${provider}&family=${family}`);
    for (;;) {
      const cards = nodes(h.tree, node => node.type === 'article');
      assert.ok(cards.length <= h.ui.MARKET_PAGE_SIZE);
      for (const card of cards) {
        const link = nodes(card, node => node.type === 'a' && node.props.href?.startsWith('/playground?'))[0];
        assert.ok(link, `Playground missing for ${card.props['data-model-id']}`);
        const url = new URL(link.props.href, 'https://tokvilo.com');
        assert.equal(url.searchParams.get('model'), card.props['data-model-id']);
        assert.equal(url.searchParams.get('service'), card.props['data-service']);
      }
      identities.push(...cards.map(node => `${node.props['data-service']}:${node.props['data-model-id']}`));
      const next = nodes(h.tree, node => node.props['aria-label'] === '下一页')[0];
      if (!next || next.props.disabled) break;
      next.props.onClick(); h.render();
    }
  }
  const expected = fullCatalog.map(model => `${model.upstream === 'selected' ? 'selected' : model.upstream === 'tokenhub' ? 'studio' : 'gateway'}:${model.id}`).sort();
  assert.deepEqual(identities.sort(), expected);
  assert.equal(nodes(h.tree, node => node.type === 'img').length, 0);
  assert.doesNotMatch(text(h.tree), /APIMart|TokenHub|rkapi|源价|加价|20%/i);
});

test('sidebar provider and family navigation is explicit and collapses the mobile menu after selection', async () => {
  const h = await harness({ english: true, url: 'https://tokvilo.com/en/models' });
  const toggle = () => nodes(h.tree, node => node.props.className === 'market-sidebar-toggle')[0];
  assert.equal(toggle().props['aria-expanded'], false);
  toggle().props.onClick(); h.render();
  assert.equal(toggle().props['aria-expanded'], true);
  const provider = nodes(h.tree, node => node.props.className === 'market-sidebar-provider').find(node => text(node).startsWith('OpenAI'));
  provider.props.onClick(); h.render();
  assert.equal(toggle().props['aria-expanded'], false);
  assert.equal(h.url.searchParams.get('provider'), 'openai');
  assert.equal(h.url.searchParams.get('family'), null);
  assert.equal(nodes(h.tree, node => node.type === 'article').length, 0, 'Provider selection presents families before versions');
  const familyNav = nodes(h.tree, node => node.props['aria-label'] === 'OpenAI model families')[0];
  nodes(familyNav, node => node.type === 'button').find(node => text(node).startsWith('GPT') && !text(node).startsWith('GPT Image')).props.onClick(); h.render();
  assert.equal(h.url.searchParams.get('family'), 'gpt');
  assert.equal(nodes(h.tree, node => node.type === 'article').length, h.ui.MARKET_PAGE_SIZE);
  assert.ok(nodes(h.tree, node => node.props['aria-current'] === 'true').some(node => text(node).startsWith('GPT')));
  nodes(h.tree, node => node.props.className === 'market-family-back')[0].props.onClick(); h.render();
  assert.equal(h.url.searchParams.get('family'), null);
  assert.equal(h.url.searchParams.get('provider'), 'openai');
  assert.ok(nodes(h.tree, node => node.props.className === 'market-family-tile').length > 0);
});

test('pagination is shareable, clamped and restored with Back; filtering returns to page one', async () => {
  const h = await harness({ url: 'https://tokvilo.com/en/models?provider=openai&family=gpt&page=2', english: true });
  const pageTwoIds = nodes(h.tree, node => node.type === 'article').map(node => node.props['data-model-id']);
  assert.equal(pageTwoIds.length, h.ui.MARKET_PAGE_SIZE);
  assert.match(text(h.tree), /13–24 of/);
  nodes(h.tree, node => node.props['aria-label'] === 'Next page')[0].props.onClick(); h.render();
  assert.equal(h.url.searchParams.get('page'), '3');
  assert.deepEqual(JSON.parse(JSON.stringify(h.scrollCalls.at(-1))), { block: 'start', behavior: 'auto' });
  assert.deepEqual(JSON.parse(JSON.stringify(h.focusCalls.at(-1))), { preventScroll: true });
  assert.deepEqual(h.history.at(-1)[1], { preserved: true });
  h.goBack('https://tokvilo.com/en/models?provider=openai&family=gpt&page=2');
  assert.deepEqual(nodes(h.tree, node => node.type === 'article').map(node => node.props['data-model-id']), pageTwoIds);
  nodes(h.tree, node => node.props['aria-label'] === 'Search models')[0].props.onChange({ target: { value: '6.1' } }); h.render();
  assert.equal(h.url.searchParams.get('page'), null);
  h.goBack('https://tokvilo.com/en/models?provider=openai&family=gpt&page=999999');
  assert.ok(nodes(h.tree, node => node.type === 'article').length > 0);
  assert.equal(nodes(h.tree, node => node.props['aria-label'] === 'Next page')[0].props.disabled, true);
});

test('deep links preserve exact service route, normalize manufacturer and survive history navigation', async () => {
  const h = await harness({ url: 'https://tokvilo.com/en/models?provider=OPENAI&family=gpt&category=text&service=selected&view=list', english: true });
  let articles = nodes(h.tree, node => node.type === 'article');
  assert.ok(articles.length > 0);
  assert.ok(articles.every(node => node.props['data-service'] === 'selected'));
  assert.match(text(h.tree), /models/);
  assert.doesNotMatch(text(h.tree), /[\u4e00-\u9fff]/);
  nodes(articles[0], node => node.type === 'button')[0].props.onClick(); h.render();
  assert.equal(nodes(h.tree, node => node.type === 'a' && node.props.href?.startsWith('/selected?')).length, 0, 'Unconfigured selected models do not offer an executable link');
  nodes(h.tree, node => node.type === 'button' && node.props['aria-label'] === 'Close model details')[0].props.onClick(); h.render();
  nodes(h.tree, node => node.type === 'input' && node.props['aria-label'] === 'Search models')[0].props.onChange({ target: { value: '6.1' } }); h.render();
  assert.equal(h.history.at(-1)[0], 'replace');
  assert.equal(h.url.pathname, '/en/models');
  assert.equal(h.url.searchParams.get('q'), '6.1');
  assert.deepEqual(h.history.at(-1)[1], { preserved: true });
  h.goBack('https://tokvilo.com/en/models?provider=GOOGLE&family=veo&category=video');
  articles = nodes(h.tree, node => node.type === 'article');
  assert.ok(articles.length > 0);
  assert.ok(articles.every(node => node.props['data-model-id'].startsWith('veo')));
});

test('category changes clear incompatible manufacturer, family and capability selections', async () => {
  const h = await harness({ url: 'https://tokvilo.com/models?provider=ZHIPU&family=glm&category=text&capability=文本生成' });
  assert.ok(nodes(h.tree, node => node.type === 'article').every(node => node.props['data-model-id'].startsWith('glm')));
  const categories = nodes(h.tree, node => node.props['aria-label'] === '模型类型')[0];
  nodes(categories, node => node.type === 'button').find(node => text(node).startsWith('图像')).props.onClick(); h.render();
  assert.equal(h.url.searchParams.get('provider'), null);
  assert.equal(h.url.searchParams.get('family'), null);
  assert.equal(h.url.searchParams.get('capability'), null);
  assert.equal(nodes(h.tree, node => node.type === 'article').length, 0);
  assert.ok(nodes(h.tree, node => node.props.className === 'market-family-tile').length > 0);
  assert.match(text(h.tree), new RegExp(`${fullCatalog.filter(model => model.category === 'image').length} 个模型`));
  assert.doesNotMatch(text(h.tree), /未找到匹配模型/);
});

test('filter URL roundtrip validates stale parameters and keeps repeated capabilities', async () => {
  const { ui } = await harness();
  const params = new URLSearchParams('provider=ANTHROPIC&family=claude&category=text&service=selected&q=claude&capability=文本生成&capability=文本生成&view=list&page=3');
  const parsed = ui.readMarketFilters(params, fullCatalog);
  assert.equal(parsed.provider, 'anthropic');
  assert.equal(parsed.page, 3);
  assert.equal(parsed.capabilities.length, 1);
  assert.equal(ui.marketFilterParams(parsed).get('service'), 'selected');
  const roundtrip = ui.readMarketFilters(ui.marketFilterParams(parsed), fullCatalog);
  assert.deepEqual(JSON.parse(JSON.stringify(roundtrip)), JSON.parse(JSON.stringify(parsed)));
  const invalid = ui.readMarketFilters(new URLSearchParams('category=invalid&provider=missing&family=missing&service=missing&capability=missing'), fullCatalog);
  assert.equal(ui.readMarketFilters(new URLSearchParams('service=constructor'), fullCatalog).service, 'all');
  assert.equal(invalid.category, 'all'); assert.equal(invalid.service, 'all'); assert.equal(invalid.provider, ''); assert.equal(invalid.family, ''); assert.equal(invalid.capabilities.length, 0);
});

test('same model across services has independent availability and exact workbench destinations', async () => {
  const models = ['apimart', 'selected', 'tokenhub'].map(upstream => ({ id: 'gpt-6.1-sol', name: 'GPT 6.1 Sol', provider: 'OPENAI', category: 'text', upstream, available: true, capabilities: ['文本生成'], description: '', docs: '/dashboard/docs' }));
  const h = await harness({ models, url: 'https://tokvilo.com/models?provider=openai&family=gpt' });
  for (const service of ['gateway', 'selected', 'studio']) {
    const card = nodes(h.tree, node => node.type === 'article' && node.props['data-service'] === service)[0];
    nodes(card, node => node.type === 'button')[0].props.onClick(); h.render();
    const detail = nodes(h.tree, node => node.props.className === 'model-detail-actions')[0];
    const link = nodes(detail, node => node.type === 'a' && node.props.href?.startsWith('/playground?'))[0];
    assert.ok(link);
    const url = new URL(link.props.href, 'https://tokvilo.com');
    assert.equal(url.searchParams.get('model'), 'gpt-6.1-sol');
    assert.equal(url.searchParams.get('service'), service);
    nodes(h.tree, node => node.type === 'button' && node.props['aria-label'] === '关闭模型详情')[0].props.onClick(); h.render();
  }
});

test('English catalogue translates manufacturer, family, capabilities and service copy', async () => {
  const models = fullCatalog.map((model, index) => index === 0 ? { ...model, name: `${model.name} tokvilo 模型服务` } : model);
  const h = await harness({ models, english: true, url: 'https://tokvilo.com/en/models?service=studio&view=list' });
  assert.doesNotMatch(text(h.tree), /[\u4e00-\u9fff]/);
  assert.match(text(h.tree), /OpenAI|ByteDance|Google/);
  assert.match(text(h.tree), /tokvilo Select/);
  assert.match(text(h.tree), /Text generation/);
  assert.ok(nodes(h.tree, node => node.props['aria-label']).every(node => !/[\u4e00-\u9fff]/.test(node.props['aria-label'])));
  const reference = nodes(h.tree, node => node.type === 'article' && node.props['data-service'] === 'studio' && node.props['data-model-id'] === models[0].id)[0];
  nodes(reference, node => node.type === 'button')[0].props.onClick(); h.render();
  assert.match(text(nodes(h.tree, node => node.props.id === 'model-detail-title')[0]), /tokvilo Models/);
  assert.doesNotMatch(text(h.tree), /[\u4e00-\u9fff]/);
});

test('catalogue-only models keep a playground entry while clearly describing unavailable execution', async () => {
  for (const upstream of ['apimart', 'selected']) {
    const model = { id: 'unavailable-v2', name: 'Unavailable V2', provider: 'OPENAI', category: 'text', upstream, available: false, capabilities: ['文本生成'], description: '', docs: '/dashboard/docs' };
    const h = await harness({ models: [model], english: true, url: 'https://tokvilo.com/en/models?view=list' });
    const card = nodes(h.tree, node => node.type === 'article')[0];
    assert.match(text(card), /Coming later/);
    assert.ok(nodes(card, node => node.type === 'a' && node.props.href.includes('model=unavailable-v2'))[0]);
    nodes(card, node => node.type === 'button')[0].props.onClick(); h.render();
    assert.match(text(h.tree), upstream === 'selected' ? /Generation requests are not yet available/ : /billing or API integration is still in progress/);
    const actions = nodes(h.tree, node => node.props.className === 'model-detail-actions')[0];
    const link = nodes(actions, node => node.type === 'a' && node.props.href.startsWith('/playground?'))[0];
    const url = new URL(link.props.href, 'https://tokvilo.com');
    assert.equal(url.searchParams.get('model'), model.id);
    assert.equal(url.searchParams.get('service'), upstream === 'selected' ? 'selected' : 'gateway');
    assert.equal(url.searchParams.get('lang'), 'en');
  }
});
