import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as jsx from 'react/jsx-runtime';

const compile = async path => ts.transpileModule(await readFile(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const site = { exports: {} };
vm.runInNewContext(await compile('../lib/site-locale.ts'), { module: site, exports: site.exports, URL });
const code = await compile('../components/LocaleProvider.tsx');

function fixture(initial = '/en/models?provider=OPENAI', server = false, locale = 'en') {
  let routerUrl = new URL(initial, 'https://tokvilo.com'), browserUrl = new URL(routerUrl), cursor = 0;
  const state = [], effects = [], listeners = new Map(), navigations = [], replacements = [];
  const compiledModule = { exports: {} };
  const listen = (name, fn) => { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); };
  const dispatch = name => { for (const listener of listeners.get(name) || []) listener(); };
  const location = { get pathname() { return browserUrl.pathname; }, get search() { return browserUrl.search; }, get hash() { return browserUrl.hash; }, get href() { return browserUrl.href; }, assign: path => navigations.push(path) };
  vm.runInNewContext(code, { module: compiledModule, exports: compiledModule.exports, URL, URLSearchParams,
    PopStateEvent: class { constructor(type) { this.type = type; } },
    ...(server ? {} : { window: { location, history: { state: { preserved: true }, replaceState: (value, title, path) => { replacements.push({ value, path }); browserUrl = new URL(path, browserUrl); } }, addEventListener: listen, removeEventListener: (name, fn) => listeners.get(name)?.delete(fn), dispatchEvent: event => dispatch(event.type) } }),
    fetch: () => { throw Error('Language changes must not request authentication'); },
    require(name) {
      if (name === 'react/jsx-runtime') return jsx;
      if (name === '@/lib/site-locale') return site.exports;
      if (name === 'next/navigation') return { usePathname: () => routerUrl.pathname, useSearchParams: () => routerUrl.searchParams };
      if (name === 'react') return {
        createContext: () => ({}), useContext: () => locale,
        useState: initialValue => { const index = cursor++; if (!state[index]) state[index] = { value: initialValue }; return [state[index].value, value => { state[index].value = value; }]; },
        useEffect: (fn, deps) => { const index = cursor++; if (!state[index] || deps.some((dep, key) => !Object.is(dep, state[index].deps[key]))) { const previous = state[index]; state[index] = { deps }; effects.push(() => { previous?.cleanup?.(); state[index].cleanup = fn(); }); } },
      };
      throw Error(name);
    },
  });
  const render = () => { cursor = 0; return compiledModule.exports.LanguageSwitcher(); };
  const commit = () => { for (const effect of effects.splice(0)) effect(); };
  return { render, commit, navigations, replacements, dispatch,
    navigate: path => { routerUrl = new URL(path, routerUrl); browserUrl = new URL(routerUrl); },
    previewNavigation: path => { routerUrl = new URL(path, routerUrl); },
    commitNavigation: () => { browserUrl = new URL(routerUrl); },
    native: path => { browserUrl = new URL(path, browserUrl); },
  };
}

test('language href follows Next client path and query navigation before effects commit', () => {
  const f = fixture();
  assert.equal(f.render().props.href, '/models?provider=OPENAI'); f.commit();
  assert.equal(f.render().props.href, '/models?provider=OPENAI');
  f.navigate('/en/pricing?provider=GOOGLE');
  assert.equal(f.render().props.href, '/pricing?provider=GOOGLE', 'copy/open-in-new-tab destination must use the new route immediately');
  f.commit();
  f.navigate('/en/pricing?provider=OPENAI');
  assert.equal(f.render().props.href, '/pricing?provider=OPENAI');
});

test('vinext render-before-history commit does not pin the language href to the previous page', () => {
  const f = fixture('/en/blog');
  assert.equal(f.render().props.href, '/blog'); f.commit();
  for (const [path, expected] of [
    ['/en/blog/getting-started-with-model-apis', '/blog/getting-started-with-model-apis'],
    ['/en/blog/comparing-models-for-your-workflow', '/blog/comparing-models-for-your-workflow'],
    ['/en/models?provider=GOOGLE', '/models?provider=GOOGLE'],
    ['/en/models?provider=OPENAI', '/models?provider=OPENAI'],
  ]) {
    f.previewNavigation(path); // Router snapshot advances before the URL.
    assert.equal(f.render().props.href, expected);
    f.commit(); // Effect must not associate the old browser URL with this route.
    assert.equal(f.render().props.href, expected);
    f.commitNavigation(); // No popstate event or different router snapshot.
    assert.equal(f.render().props.href, expected, 'copy and new-tab destinations remain correct after commit');
  }
});

test('initial browser hashes survive equivalent query string encoding', () => {
  const f = fixture('/en/models?query=hello%20world#results');
  f.render(); f.commit();
  assert.equal(f.render().props.href, '/models?query=hello+world#results');
});

test('native market filters, hash changes and back navigation refresh the actual anchor', () => {
  const f = fixture(); f.render(); f.commit();
  f.native('/en/models?provider=GOOGLE&family=gemini#models'); f.dispatch('tokvilo:locationchange');
  assert.equal(f.render().props.href, '/models?provider=GOOGLE&family=gemini#models');
  f.native('/en/models?provider=GOOGLE#families'); f.dispatch('hashchange');
  assert.equal(f.render().props.href, '/models?provider=GOOGLE#families');
  f.native('/en/models?provider=OPENAI'); f.dispatch('popstate');
  assert.equal(f.render().props.href, '/models?provider=OPENAI');
});

test('reset language switch stays in memory without navigation or auth requests', () => {
  const f = fixture('/reset-password?lang=en'); f.render(); f.commit();
  let prevented = false;
  f.render().props.onClick({ button: 0, preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
  assert.deepEqual(f.navigations, []);
  assert.equal(f.replacements[0].path, '/reset-password');
  assert.equal(f.replacements[0].value.preserved, true);
});

test('modified link clicks retain native browser behavior and server rendering needs no window', () => {
  const f = fixture();
  let prevented = false;
  f.render().props.onClick({ button: 0, ctrlKey: true, preventDefault: () => { prevented = true; } });
  assert.equal(prevented, false); assert.deepEqual(f.navigations, []);
  const server = fixture('/en/pricing?category=text', true);
  assert.equal(server.render().props.href, '/pricing?category=text');
});

test('recovery language anchors never retain secret fragments or query codes before or after URL cleanup', () => {
  for (const suffix of ['?lang=en#token_hash=private-recovery-secret&type=recovery', '?lang=en&code=private-code', '?lang=en&token_hash=private-query-secret&type=recovery']) {
    const f = fixture('/reset-password' + suffix);
    assert.equal(f.render().props.href, '/reset-password', 'initial href must already omit recovery material');
    f.commit();
    assert.equal(f.render().props.href, '/reset-password', 'effect must not copy secret material into the anchor');
    f.native('/reset-password?lang=en'); // Form cleanup emits no route or history event.
    const anchor = f.render();
    assert.equal(anchor.props.href, '/reset-password', 'cached browser path must not expose a scrubbed token');
    assert.doesNotMatch(anchor.props.href, /private|token_hash|code=|type=|#/);
    anchor.props.onClick({ button: 0, preventDefault() {} });
    assert.equal(f.replacements[0].path, '/reset-password');
    assert.deepEqual(f.navigations, []);
  }
});

test('clicking language before recovery cleanup never restores secret query or hash to the address bar', () => {
  const f = fixture('/reset-password?lang=en&code=private-code#token_hash=private-hash&type=recovery');
  f.render().props.onClick({ button: 0, preventDefault() {} });
  assert.equal(f.replacements[0].path, '/reset-password');
  assert.doesNotMatch(f.replacements[0].path, /private|token_hash|code=|type=|#/);
  assert.deepEqual(f.navigations, []);
  const chinese = fixture('/reset-password?code=private-code#token_hash=private-hash&type=recovery', false, 'zh');
  assert.equal(chinese.render().props.href, '/reset-password?lang=en');
  chinese.commit();
  chinese.render().props.onClick({ button: 0, preventDefault() {} });
  assert.equal(chinese.replacements[0].path, '/reset-password?lang=en');
});

test('login confirmation language anchors never preserve bearer tokens, codes, or callback errors', () => {
  for (const suffix of ['?lang=en&verified=1#access_token=private-access&refresh_token=private-refresh', '?lang=en&token_hash=private-token&code=private-code', '?lang=en#error_description=private-error']) {
    const f = fixture('/login' + suffix);
    assert.equal(f.render().props.href, '/login');
    f.commit();
    assert.equal(f.render().props.href, '/login');
    f.native('/login?lang=en'); // AuthForm cleans the URL without a router event.
    const anchor = f.render();
    assert.equal(anchor.props.href, '/login');
    assert.doesNotMatch(anchor.props.href, /private|token|code=|error|#/);
    anchor.props.onClick({ button: 0, preventDefault() {} });
    assert.deepEqual(f.navigations, ['/login']);
  }
  const chinese = fixture('/login?code=private-code#access_token=private-access', false, 'zh');
  assert.equal(chinese.render().props.href, '/login?lang=en');
  chinese.commit();
  chinese.render().props.onClick({ button: 0, preventDefault() {} });
  assert.deepEqual(chinese.navigations, ['/login?lang=en']);
});
