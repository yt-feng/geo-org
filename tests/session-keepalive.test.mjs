import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const source = await readFile(new URL('../components/SessionKeepAlive.tsx', import.meta.url), 'utf8');
const code = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function harness(initialPath) {
  let pathname = initialPath, cleanup, dependencies;
  const requests = [], listeners = new Map(), timers = [], destinations = [];
  const mod = { exports: {} };
  vm.runInNewContext(code, {
    module: mod, exports: mod.exports, AbortController,
    fetch: (url, options) => new Promise(resolve => requests.push({ url, options, resolve })),
    setTimeout: callback => { timers.push(callback); return timers.length; },
    clearTimeout: () => {},
    window: {
      location: { get pathname() { return pathname; }, assign: path => destinations.push(path) },
      addEventListener: (name, listener) => listeners.set(name, listener),
      removeEventListener: name => listeners.delete(name),
    },
    require: name => {
      if (name === 'next/navigation') return { usePathname: () => pathname };
      if (name === 'react') return {
        useEffect(effect, nextDependencies) {
          if (!dependencies || nextDependencies.some((value, i) => value !== dependencies[i])) {
            cleanup?.(); dependencies = nextDependencies; cleanup = effect();
          }
        },
      };
      throw Error(`Unexpected dependency ${name}`);
    },
  });
  return {
    render(path = pathname) { pathname = path; mod.exports.SessionKeepAlive(); },
    requests, listeners, timers, destinations,
  };
}

test('password recovery never starts normal session refresh', () => {
  const app = harness('/reset-password');
  app.render();
  assert.equal(app.requests.length, 0);
  assert.equal(app.listeners.size, 0);
});

test('entering recovery aborts prior refresh and suppresses stale scheduling', async () => {
  const app = harness('/dashboard');
  app.render();
  assert.equal(app.requests.length, 1);
  app.render('/reset-password');
  assert.equal(app.requests[0].options.signal.aborted, true);
  app.requests[0].resolve({ ok: true, status: 200 });
  await Promise.resolve();
  assert.equal(app.requests.length, 1);
  assert.equal(app.timers.length, 0);
  assert.equal(app.listeners.size, 0);
  assert.deepEqual(app.destinations, []);
});
