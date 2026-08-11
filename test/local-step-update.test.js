const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function createElement() {
  const listeners = new Map();
  return {
    value: '',
    max: '',
    textContent: '',
    innerHTML: '',
    dataset: {},
    disabled: false,
    selected: false,
    classList: {
      add() {},
      remove() {},
      toggle() {}
    },
    style: {},
    scrollTop: 0,
    scrollHeight: 0,
    appendChild() {},
    append() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    addEventListener(type, listener) { listeners.set(type, listener); },
    dispatch(type, event = {}) { listeners.get(type)?.({ preventDefault() {}, ...event }); },
    focus() {},
    select() {},
    remove() {}
  };
}

function createAppHarness({ localPlugin, fetchImpl } = {}) {
  const elements = new Map();
  const getElement = (id) => {
    if (!elements.has(id)) elements.set(id, createElement());
    return elements.get(id);
  };
  const storage = new Map();
  const fetchCalls = [];
  const context = vm.createContext({
    console,
    confirm: () => true,
    navigator: { vibrate() {} },
    document: {
      documentElement: createElement(),
      body: { appendChild() {} },
      addEventListener() {},
      getElementById(id) { return getElement(id); },
      querySelectorAll() { return []; },
      createElement() { return createElement(); }
    },
    fetch: fetchImpl || (async (url, options) => {
      fetchCalls.push({ url, options });
      return { status: 200, text: async () => JSON.stringify({ success: false, message: '远程失败', log: '远程日志' }) };
    }),
    localStorage: {
      getItem(key) { return storage.get(key) ?? null; },
      removeItem(key) { storage.delete(key); },
      setItem(key, value) { storage.set(key, String(value)); }
    },
    setTimeout,
    clearTimeout
  });
  context.window = context;
  if (localPlugin) {
    context.Capacitor = { Plugins: { StepWong: { updateSteps: localPlugin } } };
  }

  const appPath = path.join(__dirname, '..', 'static', 'js', 'app.js');
  vm.runInContext(fs.readFileSync(appPath, 'utf8'), context, { filename: appPath });
  vm.runInContext('accounts = [{ name: "测试账号", user: "test@example.com", password: "secret", is_active: true }]; currentStep = 5000; stepHistory = [];', context);
  getElement('accountSelect').value = '0';

  return {
    elements: { get: getElement },
    fetchCalls,
    runSubmit() { return vm.runInContext('submitStepUpdate(null)', context); },
    runTutorial() { return vm.runInContext('openTutorial()', context); },
    get history() { return vm.runInContext('stepHistory.map((item) => ({ ...item }))', context); }
  };
}

test('APK 本地插件存在时优先本地同步，不请求 Worker', async () => {
  const pluginCalls = [];
  const app = createAppHarness({
    localPlugin: async (options) => {
      pluginCalls.push({ ...options });
      return { success: true, message: '同步成功！当前步数: 5000', log: '本地日志' };
    }
  });

  await app.runSubmit();

  assert.deepEqual(pluginCalls, [{ user: 'test@example.com', password: 'secret', steps: '5000' }]);
  assert.equal(app.fetchCalls.length, 0);
  assert.ok(app.elements.get('resultMsg').textContent.includes('同步成功！步数:'));
  assert.equal(app.history.length, 1);
  assert.equal(app.history[0].success, true);
  assert.equal(app.history[0].steps, 5000);
});

test('没有本地插件时回退到 Cloudflare Worker', async () => {
  const app = createAppHarness();

  await app.runSubmit();

  assert.equal(app.fetchCalls.length, 1);
  assert.ok(app.fetchCalls[0].url.startsWith('https://stepwong-api.3255962845.workers.dev/api/update'));
  assert.equal(app.elements.get('resultMsg').textContent, '远程失败');
  assert.equal(app.history.length, 1);
  assert.equal(app.history[0].success, false);
});

test('本地插件抛异常时记录失败且不请求 Worker', async () => {
  const app = createAppHarness({
    localPlugin: async () => { throw new Error('插件异常'); }
  });

  await app.runSubmit();

  assert.equal(app.fetchCalls.length, 0);
  assert.equal(app.elements.get('resultMsg').textContent, '本地同步失败: 插件异常');
  assert.equal(app.history.length, 1);
  assert.equal(app.history[0].success, false);
});

test('教程 fetch 失败时回退到内置 markdown', async () => {
  const app = createAppHarness({ fetchImpl: async () => { throw new Error('blocked'); } });
  app.elements.get('tutorialMarkdown').textContent = '# Zepp Life 微信步数同步教学\n\n内置教程';

  await app.runTutorial();

  assert.ok(app.elements.get('tutorialBody').innerHTML.includes('Zepp Life 微信步数同步教学'));
  assert.ok(app.elements.get('tutorialBody').innerHTML.includes('内置教程'));
});
