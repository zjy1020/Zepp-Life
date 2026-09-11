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
      classes: new Set(),
      add(cls) { this.classes.add(cls); },
      remove(cls) { this.classes.delete(cls); },
      toggle(cls, force) {
        const on = force === undefined ? !this.classes.has(cls) : !!force;
        if (on) this.classes.add(cls); else this.classes.delete(cls);
      },
      contains(cls) { return this.classes.has(cls); },
      has(cls) { return this.classes.has(cls); }
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

function createAppHarness({ localPlugin, storageSeed } = {}) {
  const elements = new Map();
  const getElement = (id) => {
    if (!elements.has(id)) elements.set(id, createElement());
    return elements.get(id);
  };
  const storage = new Map(Object.entries(storageSeed || {}));
  const pluginCalls = [];
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
    fetch: async () => { throw new Error('本用例不应走 Worker 回退'); },
    localStorage: {
      getItem(key) { return storage.has(key) ? storage.get(key) : null; },
      removeItem(key) { storage.delete(key); },
      setItem(key, value) { storage.set(key, String(value)); }
    },
    setTimeout,
    clearTimeout,
    /* 冷却倒计时打桩：测试里不需要真的走时，否则进程无法退出 */
    setInterval: () => 0,
    clearInterval: () => {}
  });
  context.window = context;
  if (localPlugin) {
    context.Capacitor = {
      Plugins: {
        StepWong: {
          updateSteps: async (options) => {
            pluginCalls.push({ ...options });
            return localPlugin(options);
          }
        }
      }
    };
  }

  const appPath = path.join(__dirname, '..', 'static', 'js', 'app.js');
  vm.runInContext(fs.readFileSync(appPath, 'utf8'), context, { filename: appPath });
  vm.runInContext('accounts = [{ name: "测试账号", user: "test@example.com", password: "secret", is_active: true }]; currentStep = 5000; stepHistory = [];', context);
  getElement('accountSelect').value = '0';

  return {
    elements: { get: getElement },
    pluginCalls,
    runSubmit() { return vm.runInContext('submitStepUpdate(null)', context); },
    run(code) { return vm.runInContext(code, context); },
    readAuthCache() {
      const raw = storage.get('stepwong_auth_cache');
      return raw ? JSON.parse(raw) : null;
    },
    setLastSubmitAt(value) { storage.set('stepwong_last_submit_at', String(value)); }
  };
}

const SUCCESS_WITH_TOKEN = () => ({
  success: true,
  message: '同步成功！当前步数: 5000',
  userId: 'uid-1',
  appToken: 'tok-1',
  log: '命中缓存令牌，跳过登录（本次仅 1 个请求）'
});

test('首次提交成功后，把插件回传的令牌写入缓存', async () => {
  const app = createAppHarness({ localPlugin: SUCCESS_WITH_TOKEN });

  await app.runSubmit();

  assert.deepEqual(app.pluginCalls[0], {
    user: 'test@example.com',
    password: 'secret',
    steps: '5000',
    userId: '',
    appToken: ''
  });
  const cache = app.readAuthCache();
  assert.ok(cache, '应写入令牌缓存');
  assert.equal(cache['test@example.com'].userId, 'uid-1');
  assert.equal(cache['test@example.com'].appToken, 'tok-1');
});

test('命中缓存时把令牌传给插件，使其跳过登录三步', async () => {
  const app = createAppHarness({
    storageSeed: {
      stepwong_auth_cache: JSON.stringify({
        'test@example.com': { userId: 'uid-9', appToken: 'tok-9', savedAt: Date.now() }
      })
    },
    localPlugin: async () => ({ success: true, message: '同步成功！当前步数: 5000', userId: 'uid-9', appToken: 'tok-9', log: '' })
  });

  await app.runSubmit();

  assert.equal(app.pluginCalls[0].userId, 'uid-9');
  assert.equal(app.pluginCalls[0].appToken, 'tok-9');
});

test('缓存超过有效期后不再传给插件', async () => {
  const stale = Date.now() - 13 * 60 * 60 * 1000;
  const app = createAppHarness({
    storageSeed: {
      stepwong_auth_cache: JSON.stringify({
        'test@example.com': { userId: 'uid-old', appToken: 'tok-old', savedAt: stale }
      })
    },
    localPlugin: async () => ({ success: true, message: '同步成功！当前步数: 5000', log: '' })
  });

  await app.runSubmit();

  assert.equal(app.pluginCalls[0].userId, '');
  assert.equal(app.pluginCalls[0].appToken, '');
});

test('冷却期内第二次提交被拦截，插件不会被再次调用', async () => {
  const app = createAppHarness({ localPlugin: SUCCESS_WITH_TOKEN });

  await app.runSubmit();
  assert.equal(app.pluginCalls.length, 1);
  assert.equal(app.elements.get('submitBtn').disabled, true, '冷却期间提交按钮应禁用');

  await app.runSubmit();
  assert.equal(app.pluginCalls.length, 1, '冷却期内不应再次请求插件');
});

test('冷却窗口结束后可以正常再次提交', async () => {
  const app = createAppHarness({ localPlugin: SUCCESS_WITH_TOKEN });

  await app.runSubmit();
  assert.equal(app.pluginCalls.length, 1);

  /* 把上次提交时间往前推 61 秒，模拟冷却已过 */
  app.setLastSubmitAt(Date.now() - 61000);

  await app.runSubmit();
  assert.equal(app.pluginCalls.length, 2);
});

test('提交失败时清除缓存的令牌，下次重新走完整登录', async () => {
  const app = createAppHarness({
    storageSeed: {
      stepwong_auth_cache: JSON.stringify({
        'test@example.com': { userId: 'uid-9', appToken: 'tok-9', savedAt: Date.now() }
      })
    },
    localPlugin: async () => ({ success: false, message: '登录被限流（HTTP 429）；请稍后重试，或切换网络（飞行模式重拨）后重试', log: '' })
  });

  await app.runSubmit();

  const cache = app.readAuthCache();
  assert.equal(cache['test@example.com'], undefined, '失败后应清掉该账号的缓存令牌');
});
