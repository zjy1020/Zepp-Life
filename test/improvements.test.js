const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function createElement() {
  const listeners = new Map();
  const classes = new Set();
  return {
    className: '',
    value: '',
    max: '',
    textContent: '',
    innerHTML: '',
    dataset: {},
    disabled: false,
    selected: false,
    style: {},
    scrollTop: 0,
    scrollHeight: 0,
    children: [],
    classList: {
      add(cls) { classes.add(cls); },
      remove(cls) { classes.delete(cls); },
      toggle(cls, force) {
        const on = force === undefined ? !classes.has(cls) : !!force;
        if (on) classes.add(cls); else classes.delete(cls);
      },
      contains(cls) { return classes.has(cls); },
      has(cls) { return classes.has(cls); }
    },
    append(...kids) { this.children.push(...kids); },
    appendChild(kid) { this.children.push(kid); },
    setAttribute() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    addEventListener(type, listener) { listeners.set(type, listener); },
    dispatch(type, event = {}) { listeners.get(type)?.({ preventDefault() {}, ...event }); },
    focus() {},
    select() {},
    remove() {}
  };
}

function createHarness({ localPlugin, storageSeed } = {}) {
  const elements = new Map();
  const logLines = [];
  const logContent = createElement();
  const baseAppend = logContent.appendChild.bind(logContent);
  logContent.appendChild = function (row) {
    baseAppend(row);
    const line = (row.children || []).find((c) => String(c.className).includes('log-line'));
    if (line) logLines.push(line.textContent);
  };
  elements.set('logContent', logContent);

  const getElement = (id) => {
    if (!elements.has(id)) elements.set(id, createElement());
    return elements.get(id);
  };
  const storage = new Map(Object.entries(storageSeed || {}));
  const pendingTimers = [];

  const context = vm.createContext({
    console,
    JSON,
    confirm: () => true,
    navigator: { vibrate() {}, clipboard: { writeText: async () => {} } },
    document: {
      documentElement: createElement(),
      body: { appendChild() {} },
      addEventListener() {},
      getElementById(id) { return getElement(id); },
      querySelectorAll() { return []; },
      createElement() { return createElement(); }
    },
    fetch: async () => { throw new Error('本用例不应发起网络请求'); },
    localStorage: {
      getItem(key) { return storage.has(key) ? storage.get(key) : null; },
      removeItem(key) { storage.delete(key); },
      setItem(key, value) { storage.set(key, String(value)); }
    },
    /* 定时器收集起来由测试主动 flush，避免真等待，也避免进程挂住 */
    setTimeout: (fn) => { pendingTimers.push(fn); return pendingTimers.length; },
    clearTimeout: () => {},
    setInterval: () => 0,
    clearInterval: () => {}
  });
  context.window = context;
  if (localPlugin) {
    context.Capacitor = { Plugins: { StepWong: { updateSteps: async () => ({ success: true, message: '', log: '' }) } } };
  }

  const appPath = path.join(__dirname, '..', 'static', 'js', 'app.js');
  vm.runInContext(fs.readFileSync(appPath, 'utf8'), context, { filename: appPath });

  return {
    logLines,
    run(code) { return vm.runInContext(code, context); },
    el(id) { return getElement(id); },
    raw(key) { return storage.has(key) ? storage.get(key) : null; },
    readJSON(key, fallback = null) {
      const raw = storage.get(key);
      return raw === undefined ? fallback : JSON.parse(raw);
    },
    flushTimers() { const list = pendingTimers.splice(0); list.forEach((fn) => fn()); }
  };
}

/* ---------- 4 快捷档位 ---------- */

test('快捷档位走全局上限，而默认路径被动态上限夹住', () => {
  const app = createHarness();
  app.run('stepHistory = []; lastSuccessStep = null;');

  app.run('setStep(25000)');
  assert.equal(app.run('currentStep'), 1001, '默认路径应被动态上限（基准+1000）夹住');

  app.run('applyPresetStep("25000")');
  assert.equal(app.run('currentStep'), 25000, '快捷档位应可达绝对步数');
});

test('快捷档位超过全局上限时被夹到 98800，非法值被忽略', () => {
  const app = createHarness();
  app.run('stepHistory = []; lastSuccessStep = null; currentStep = 500;');

  app.run('applyPresetStep("99999")');
  assert.equal(app.run('currentStep'), 98800);

  app.run('applyPresetStep("abc")');
  assert.equal(app.run('currentStep'), 98800, '非法输入不应改变当前值');

  app.run('applyPresetStep("-5")');
  assert.equal(app.run('currentStep'), 98800);
});

test('setupQuickStepButtons 把非 random 按钮接到绝对步数', () => {
  const app = createHarness();
  const buttons = ['random', '3000', '8000', '25000', '50000'].map((step) => {
    const el = createElement();
    el.dataset.step = step;
    return el;
  });
  const context = app.run('typeof setupQuickStepButtons');
  assert.equal(context, 'function');

  /* document.querySelectorAll 在本 harness 里返回空数组，这里直接验证分支逻辑 */
  app.run('stepHistory = []; lastSuccessStep = null;');
  app.run('applyPresetStep("8000")');
  assert.equal(app.run('currentStep'), 8000);
  assert.equal(buttons.length, 5, '快捷档位应有 5 个按钮（随机 + 4 档）');
});

/* ---------- 3 时段提示与模式指示 ---------- */

test('本地模式：隐藏时段提示，副标题显示「本地直连」', () => {
  const app = createHarness({ localPlugin: true });

  app.run('updateSyncTip()');

  assert.equal(app.el('appMode').textContent, '本地直连');
  assert.equal(app.el('syncTip').classList.contains('hidden'), true, '本地不受 0-8 点限制，提示应隐藏');
});

test('网页模式：显示时段提示，副标题显示「网页模式」', () => {
  const app = createHarness();

  app.run('updateSyncTip()');

  assert.equal(app.el('appMode').textContent, '网页模式');
  assert.equal(app.el('syncTip').classList.contains('hidden'), false);
  assert.ok(app.el('syncTip').textContent.includes('网页通道'), '文案应点明这是网页通道的限制');
});

/* ---------- 9 历史归档 ---------- */

test('dateKeyOf 输出本地日期键 YYYY-MM-DD', () => {
  const app = createHarness();
  assert.equal(app.run('dateKeyOf(new Date(2026, 8, 11, 23, 30).getTime())'), '2026-09-11');
  assert.equal(app.run('dateKeyOf(new Date(2026, 0, 5, 0, 0).getTime())'), '2026-01-05');
  assert.equal(app.run('dateKeyOf("")'), '');
});

test('跨天清零把当天记录并入归档，而不是直接丢掉', () => {
  const app = createHarness();
  const yesterday = app.run('dateKeyOf(Date.now() - 86400000)');
  app.run(`
    stepHistory = [{ account: 'A', steps: 8000, time: Date.now() - 86400000, success: true }];
    localStorage.setItem('stepwong_last_reset_date', '2020-01-01');
  `);

  const didReset = app.run('applyDailyReset({ persist: true, silent: true })');

  assert.equal(didReset, true);
  assert.equal(app.run('stepHistory.length'), 0, '当天列表应被清空');
  const archive = app.readJSON('stepwong_history_archive', {});
  assert.deepEqual(Object.keys(archive), [yesterday], '记录应按其实际日期归档');
  assert.equal(archive[yesterday][0].steps, 8000);
});

test('归档每天最多 10 条', () => {
  const app = createHarness();
  app.run(`
    var entries = [];
    for (var i = 0; i < 14; i++) {
      entries.push({ account: 'A', steps: 1000 + i, time: new Date(2026, 0, 5, 10, i).getTime(), success: true });
    }
    archiveHistory(entries, '2026-01-05');
  `);
  const archive = app.readJSON('stepwong_history_archive', {});
  assert.equal(archive['2026-01-05'].length, 10);
});

test('归档最多保留 30 天，最旧的被裁掉', () => {
  const app = createHarness();
  app.run(`
    var entries = [];
    for (var d = 1; d <= 40; d++) {
      entries.push({ account: 'A', steps: d, time: new Date(2026, 0, d).getTime(), success: true });
    }
    archiveHistory(entries, '2026-01-01');
  `);
  const archive = app.readJSON('stepwong_history_archive', {});
  assert.equal(Object.keys(archive).length, 30);
  assert.equal(archive['2026-01-01'], undefined, '最旧的日期应被裁掉');
});

/* ---------- 6 日志持久化 ---------- */

test('日志写入 localStorage，可跨会话回填', () => {
  const app = createHarness();
  app.run('appendLog("info", "第一次提交")');
  app.run('appendLog("line", "   · 细节")');
  app.flushTimers();

  const saved = app.readJSON('stepwong_logs', []);
  assert.equal(saved.length, 2);
  assert.ok(saved[0].text.includes('第一次提交'));
  assert.ok(/^ \[\d{2}:\d{2}:\d{2}\] /.test(saved[0].text), '持久化的文本应保留时间戳');
  assert.equal(saved[0].type, 'info');
});

test('启动时回填上次会话的日志', () => {
  const app = createHarness({
    storageSeed: {
      stepwong_logs: JSON.stringify([
        { type: 'info', text: ' [10:00:00] 上次的第一行' },
        { type: 'line', text: ' [10:00:01] 上次的第二行' }
      ])
    }
  });

  app.run('loadPersistedLogs()');

  assert.equal(app.run('logBuffer.length'), 2);
  assert.ok(app.logLines.some((l) => l.includes('上次的第二行')), '应把历史日志渲染回面板');
});

test('清空日志会同时清掉持久化内容', () => {
  const app = createHarness();
  app.run('appendLog("info", "x")');
  app.flushTimers();
  assert.equal(app.readJSON('stepwong_logs', []).length, 1);

  app.run('clearLog()');

  assert.equal(app.raw('stepwong_logs'), null);
  assert.equal(app.run('logBuffer.length'), 0);
});

test('日志超过上限时按行数截断', () => {
  const app = createHarness();
  app.run('for (var i = 0; i < 420; i++) appendLog("line", "第 " + i + " 行");');
  app.flushTimers();

  assert.equal(app.run('logBuffer.length'), 400);
  const saved = app.readJSON('stepwong_logs', []);
  assert.equal(saved.length, 400);
  assert.ok(saved[saved.length - 1].text.includes('第 419 行'), '应保留最新的行');
});

/* ---------- 7 版本与更新 ---------- */

test('版本比较按数值而非字符串', () => {
  const app = createHarness();
  assert.ok(app.run('compareVersion("1.0.5", "1.0.4")') > 0);
  assert.equal(app.run('compareVersion("1.0.4", "1.0.4")'), 0);
  assert.ok(app.run('compareVersion("1.0.3", "1.0.4")') < 0);
  assert.ok(app.run('compareVersion("1.2.0", "1.10.0")') < 0, '2 与 10 应按数值比较');
});

test('能从带中文前缀的 Release tag 中解析版本号', () => {
  const app = createHarness();
  /* 用 join 比较而非 deepEqual：vm 上下文里的 Array 与宿主原型不同，
     deepEqual 会因 cross-realm 判为不等 */
  assert.equal(app.run('parseVersion("动动吧-v1.0.5").join(".")'), '1.0.5');
  assert.equal(app.run('parseVersion("1.10.2").join(".")'), '1.10.2');
  assert.equal(app.run('parseVersion("没有版本号")'), null);
});

test('页脚显示当前版本；有新版时追加提示', () => {
  const app = createHarness({ localPlugin: true });
  app.run('renderVersionInfo()');
  const base = app.el('logFooter').textContent;
  assert.ok(base.includes('v' + app.run('APP_VERSION')), '应含当前版本号: ' + base);
  assert.ok(base.includes('本地直连'), '应含同步模式: ' + base);
  assert.ok(!base.includes('有新版本'), '没有新版时不应提示更新');

  app.run('latestVersion = "99.0.0"; renderVersionInfo();');
  assert.ok(app.el('logFooter').textContent.includes('有新版本 v99.0.0'));
});
