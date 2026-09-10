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
    min: '',
    textContent: '',
    innerHTML: '',
    dataset: {},
    disabled: false,
    selected: false,
    title: '',
    classList: {
      classes: new Set(),
      add(cls) { this.classes.add(cls); },
      remove(cls) { this.classes.delete(cls); },
      toggle(cls, force) {
        const on = force === undefined ? !this.classes.has(cls) : force;
        if (on) this.classes.add(cls); else this.classes.delete(cls);
      },
      contains(cls) { return this.classes.has(cls); },
      has(cls) { return this.classes.has(cls); }
    },
    style: { setProperty() {}, removeProperty() {} },
    scrollTop: 0,
    scrollHeight: 0,
    appendChild() {},
    append() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    addEventListener(type, listener) { listeners.set(type, listener); },
    dispatch(type, event = {}) { listeners.get(type)?.({ preventDefault() {}, stopPropagation() {}, ...event }); },
    focus() {},
    select() {},
    remove() {},
    closest() { return null; }
  };
}

/* 构造一个可控"当前时间"的 app 环境，便于模拟跨天 */
function createHarness({ storageSeed = {}, now = null } = {}) {
  const elements = new Map();
  const getElement = (id) => {
    if (!elements.has(id)) elements.set(id, createElement());
    return elements.get(id);
  };
  const storage = new Map(Object.entries(storageSeed));

  const context = vm.createContext({
    console,
    confirm: () => true,
    navigator: {},
    document: {
      documentElement: createElement(),
      body: { appendChild() {} },
      addEventListener() {},
      getElementById(id) { return getElement(id); },
      querySelectorAll() { return []; },
      createElement() { return createElement(); }
    },
    localStorage: {
      getItem(key) { return storage.has(key) ? storage.get(key) : null; },
      removeItem(key) { storage.delete(key); },
      setItem(key, value) { storage.set(key, String(value)); },
      __dump() { return Object.fromEntries(storage); }
    },
    setTimeout,
    clearTimeout,
    AbortSignal
  });
  context.window = context;

  const appPath = path.join(__dirname, '..', 'static', 'js', 'app.js');
  vm.runInContext(fs.readFileSync(appPath, 'utf8'), context, { filename: appPath });

  return {
    context,
    elements: { get: getElement },
    storage,
    run(code) { return vm.runInContext(code, context); },
    getStorage() { return Object.fromEntries(storage); }
  };
}

const KEY = {
  history: 'stepwong_history',
  lastSuccessStep: 'stepwong_last_success_step',
  step: 'stepwong_step',
  lastResetDate: 'stepwong_last_reset_date'
};

test('首次使用（无清零记录）不触发清零，仅落下日期基线', () => {
  const app = createHarness({
    storageSeed: {
      [KEY.history]: JSON.stringify([{ account: 'a', steps: 5000, time: Date.now(), success: true }]),
      [KEY.lastSuccessStep]: '5000'
    }
  });

  const didReset = app.run('applyDailyReset({ persist: true, silent: true })');

  assert.equal(didReset, false, '首次使用不应重置');
  const store = app.getStorage();
  assert.ok(store[KEY.lastResetDate], '应写入今天的日期基线');
  assert.ok(store[KEY.history], '原有历史不应被清空');
});

test('同一天内重复调用不触发清零', () => {
  const today = app0Today();
  const app = createHarness({
    storageSeed: {
      [KEY.lastResetDate]: today,
      [KEY.history]: JSON.stringify([{ account: 'a', steps: 8000, time: Date.now(), success: true }]),
      [KEY.lastSuccessStep]: '8000'
    }
  });

  const didReset = app.run('applyDailyReset({ persist: true, silent: true })');

  assert.equal(didReset, false);
  assert.ok(app.getStorage()[KEY.history], '历史应保留');
});

test('跨天后清零：历史、成功步数、当前步数全部归位', () => {
  const app = createHarness({
    storageSeed: {
      [KEY.lastResetDate]: '2020-01-01',
      [KEY.history]: JSON.stringify([{ account: 'a', steps: 8000, time: Date.now(), success: true }]),
      [KEY.lastSuccessStep]: '8000',
      [KEY.step]: '8000'
    }
  });

  const didReset = app.run('applyDailyReset({ persist: true, silent: true })');

  assert.equal(didReset, true, '跨天应触发重置');
  const store = app.getStorage();
  assert.equal(store[KEY.history], undefined, '历史应被清空');
  assert.equal(store[KEY.lastSuccessStep], undefined, '上次成功步数应被清空');
  assert.equal(store[KEY.step], undefined, '当前步数应被清空');
  assert.equal(store[KEY.lastResetDate], app0Today(), '日期基线应更新为今天');

  const baseline = app.run('getLatestStepBaseline()');
  const max = app.run('getDynamicStepMax()');
  assert.equal(baseline, 1, '清零后基准应为 1');
  assert.equal(max, 1001, '清零后上限应为 1001');
});

test('hasCrossedNewDay：无记录时为 false，日期不同才为 true', () => {
  const fresh = createHarness();
  assert.equal(fresh.run('hasCrossedNewDay()'), false, '无日期基线不算跨天');

  const stale = createHarness({ storageSeed: { [KEY.lastResetDate]: '2020-01-01' } });
  assert.equal(stale.run('hasCrossedNewDay()'), true, '与今天不同应算跨天');

  const same = createHarness({ storageSeed: { [KEY.lastResetDate]: app0Today() } });
  assert.equal(same.run('hasCrossedNewDay()'), false, '与今天相同不算跨天');
});

test('getTodayKey 返回 YYYY-MM-DD 格式且与本地日期一致', () => {
  const app = createHarness();
  const key = app.run('getTodayKey()');
  assert.match(key, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(key, app0Today());
});

/* 与实现同源的"今天"算法，避免测试自身引入时区偏差 */
function app0Today() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
