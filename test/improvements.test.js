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

function createHarness({ localPlugin, storageSeed, fetchImpl } = {}) {
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
  const pendingIntervals = [];

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
    fetch: fetchImpl || (async () => { throw new Error('本用例不应发起网络请求'); }),
    localStorage: {
      getItem(key) { return storage.has(key) ? storage.get(key) : null; },
      removeItem(key) { storage.delete(key); },
      setItem(key, value) { storage.set(key, String(value)); }
    },
      /* 定时器收集起来由测试主动 flush，避免真等待，也避免进程挂住 */
      setTimeout: (fn) => { pendingTimers.push(fn); return pendingTimers.length; },
      clearTimeout: () => {},
      setInterval: (fn) => { pendingIntervals.push(fn); return pendingIntervals.length; },
      clearInterval: (id) => { if (id > 0) pendingIntervals[id - 1] = null; }
    });
    context.window = context;
    if (localPlugin) {
      /* 传对象时用它当插件（便于注入 getUpdateProgress 等能力），传 true 用默认桩 */
      const plugin = (typeof localPlugin === 'object')
        ? localPlugin
        : { updateSteps: async () => ({ success: true, message: '', log: '' }) };
      context.Capacitor = { Plugins: { StepWong: plugin } };
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
      flushTimers() { const list = pendingTimers.splice(0); list.forEach((fn) => fn()); },
      async flushIntervals() {
        for (const fn of pendingIntervals.filter(Boolean)) await fn();
      },
      intervalCount() { return pendingIntervals.filter(Boolean).length; }
    };
  }

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

test('页脚按状态显示当前版本与更新情况', () => {
  const app = createHarness({ localPlugin: true });
  app.run('renderVersionInfo()');
  const base = app.el('logFooter').textContent;
  assert.ok(base.includes('v' + app.run('APP_VERSION')), '应含当前版本号: ' + base);
  assert.ok(base.includes('本地直连'), '应含同步模式: ' + base);
  assert.ok(!base.includes('有新版本'), '尚未检查时不应提示更新');

  app.run('updateState = "latest"; renderVersionInfo();');
  assert.ok(app.el('logFooter').textContent.includes('已是最新'));

  app.run('latestVersion = "99.0.0"; updateState = "outdated"; renderVersionInfo();');
  assert.ok(app.el('logFooter').textContent.includes('有新版本 v99.0.0'));

  app.run('updateState = "failed"; renderVersionInfo();');
  assert.ok(app.el('logFooter').textContent.includes('检查更新失败'));
});

/* ---------- 7b 手动检查更新 ---------- */

function releaseResponse(tag) {
  return { ok: true, status: 200, json: async () => ({ tag_name: tag }) };
}

test('自动检查：拉到与本地相同版本 -> 页脚「已是最新」且不写日志', async () => {
  const app = createHarness({
    fetchImpl: async () => releaseResponse('动动吧-v' + app.run('APP_VERSION'))
  });

  await app.run('checkForUpdate()');

  assert.equal(app.run('updateState'), 'latest');
  assert.ok(app.el('logFooter').textContent.includes('已是最新'));
  assert.equal(app.logLines.length, 0, '自动检查成功且无新版时不应打扰用户');
});

test('自动检查：拉到更高版本 -> 页脚提示并写日志', async () => {
  const app = createHarness({ fetchImpl: async () => releaseResponse('动动吧-v99.9.9') });

  await app.run('checkForUpdate()');

  assert.equal(app.run('updateState'), 'outdated');
  assert.ok(app.el('logFooter').textContent.includes('有新版本 v99.9.9'));
  assert.ok(app.logLines.some((l) => l.includes('发现新版本 v99.9.9')), '应写入日志');
});

test('手动检查：已是最新时给出明确反馈', async () => {
  const app = createHarness({
    fetchImpl: async () => releaseResponse('动动吧-v' + app.run('APP_VERSION'))
  });

  await app.run('checkForUpdate({ manual: true })');

  assert.equal(app.run('updateState'), 'latest');
  assert.ok(app.logLines.some((l) => l.includes('已是最新版本')), '手动检查应写入日志: ' + JSON.stringify(app.logLines));
});

test('手动检查失败：页脚明示失败并写入原因', async () => {
  const app = createHarness({ fetchImpl: async () => { throw new Error('网络不可用'); } });

  await app.run('checkForUpdate({ manual: true })');

  assert.equal(app.run('updateState'), 'failed');
  assert.ok(app.el('logFooter').textContent.includes('检查更新失败'));
  assert.ok(app.logLines.some((l) => l.includes('检查更新失败') && l.includes('网络不可用')));
});

test('接口返回非 2xx 时判为失败，而不是当作已是最新', async () => {
  const app = createHarness({
    fetchImpl: async () => ({ ok: false, status: 404, json: async () => ({}) })
  });

  await app.run('checkForUpdate({ manual: true })');

  assert.equal(app.run('updateState'), 'failed');
  assert.ok(app.logLines.some((l) => l.includes('HTTP 404')));
});

test('检查进行中：按钮禁用并显示「检查中…」', async () => {
  let during = null;
  let release;
  const app = createHarness({
    fetchImpl: () => new Promise((resolve) => {
      during = {
        btnText: app.el('checkUpdateBtn').textContent,
        btnDisabled: app.el('checkUpdateBtn').disabled,
        footer: app.el('logFooter').textContent
      };
      release = resolve;
    })
  });

  const pending = app.run('checkForUpdate({ manual: true })');

  assert.ok(during, 'fetch 应已被调用');
  assert.equal(during.btnDisabled, true, '检查中按钮应禁用');
  assert.equal(during.btnText, '检查中…');
  assert.ok(during.footer.includes('检查中…'));

  release(releaseResponse('动动吧-v1.0.0'));
  await pending;
});

test('检查进行中重复触发会被忽略，只发一次请求', async () => {
  let calls = 0;
  let release;
  const app = createHarness({
    fetchImpl: () => { calls += 1; return new Promise((resolve) => { release = resolve; }); }
  });

  const first = app.run('checkForUpdate({ manual: true })');
  const second = await app.run('checkForUpdate({ manual: true })');

  assert.equal(second, null, '进行中再次调用应直接返回 null');
  assert.equal(calls, 1, '只应发出一次请求');

  release(releaseResponse('动动吧-v1.0.0'));
  await first;
});

/* ---------- 一键更新的下载进度 ---------- */

const MB = 1048576;

/* 装好一个可测的插件：installUpdate 挂着不 resolve，好让轮询有机会跑；
   getUpdateProgress 依次吐出预设样本，最后一条会被反复复用。 */
function updatePlugin(samples, { withProgress = true } = {}) {
  let i = 0;
  const plugin = {
    updateSteps: async () => ({ success: true, message: '', log: '' }),
    installUpdate: () => new Promise((resolve) => { plugin.__resolve = resolve; })
  };
  if (withProgress) {
    plugin.getUpdateProgress = async () => samples[Math.min(i++, samples.length - 1)];
  }
  return plugin;
}

function armUpdate(app) {
  app.run('updateState = UPDATE_STATE.outdated; latestVersion = "1.0.9";'
    + ' latestApkUrl = "https://example.com/DongDongBa-v1.0.9.apk";');
}

test('一键更新：下载中按百分比更新按钮，并在 25% 档位写一条日志', async () => {
  const plugin = updatePlugin([
    { active: true, percent: 10, downloaded: 1 * MB, total: 10 * MB },
    { active: true, percent: 30, downloaded: 3 * MB, total: 10 * MB },
    { active: true, percent: 50, downloaded: 5 * MB, total: 10 * MB }
  ]);
  const app = createHarness({ localPlugin: plugin });
  armUpdate(app);

  const pending = app.run('installUpdate()');
  /* 每次 flush 驱动一轮轮询，依次取走一个进度样本 */
  await app.flushIntervals();
  await app.flushIntervals();
  await app.flushIntervals();

  assert.equal(app.el('updateBtn').textContent, '下载中 50%', '按钮应显示最新百分比');
  assert.equal(app.el('updateBtn').disabled, true, '下载中按钮应禁用');

  /* 10% 那一轮不跨档位，不写；30% 跨 25%、50% 跨 50%，各写一条 */
  const milestones = app.logLines.filter((l) => l.includes('已下载 '));
  assert.equal(milestones.length, 2, '每跨过一个 25% 档位写一条，避免刷屏');
  assert.ok(milestones[0].includes('已下载 25%') && milestones[0].includes('3.0MB / 10.0MB'),
    '实际: ' + milestones[0]);
  assert.ok(milestones[1].includes('已下载 50%') && milestones[1].includes('5.0MB / 10.0MB'),
    '实际: ' + milestones[1]);
  assert.ok(milestones.every((l) => l.includes('MB/s')), '应带上速度');

  plugin.__resolve({ success: true, message: '安装包已就绪', size: 10 * MB });
  await pending;
});

test('一键更新：服务端未给总长度时退化为显示已下载量', async () => {
  const plugin = updatePlugin([
    { active: true, percent: -1, downloaded: 0, total: -1 },
    { active: true, percent: -1, downloaded: 2.5 * MB, total: -1 }
  ]);
  const app = createHarness({ localPlugin: plugin });
  armUpdate(app);

  const pending = app.run('installUpdate()');
  await app.flushIntervals();
  await app.flushIntervals();

  assert.equal(app.el('updateBtn').textContent, '下载中 2.5MB', 'percent 为 -1 时应改报已下载量');
  assert.ok(!app.logLines.some((l) => l.includes('已下载 ')), '无百分比时不应写档位日志');

  plugin.__resolve({ success: true, message: 'ok', size: 0 });
  await pending;
});

test('一键更新：完成后按钮复位、轮询停止', async () => {
  const plugin = updatePlugin([{ active: true, percent: 50, downloaded: 5, total: 10 }]);
  const app = createHarness({ localPlugin: plugin });
  armUpdate(app);

  const pending = app.run('installUpdate()');
  assert.equal(app.intervalCount(), 1, '应已启动轮询');

  plugin.__resolve({ success: true, message: '安装包已就绪', size: 10 * MB });
  await pending;

  assert.equal(app.intervalCount(), 0, '完成后应停止轮询，否则会一直空转');
  assert.equal(app.el('updateBtn').textContent, '立即更新');
  assert.equal(app.el('updateBtn').disabled, false);
  assert.ok(app.logLines.some((l) => l.includes('安装包已就绪') && l.includes('10.0MB')));
});

test('一键更新：插件不支持进度查询时不轮询、不报错', async () => {
  const plugin = updatePlugin([], { withProgress: false });
  const app = createHarness({ localPlugin: plugin });
  armUpdate(app);

  const pending = app.run('installUpdate()');

  assert.equal(app.intervalCount(), 0, '无 getUpdateProgress 时不应启动轮询');
  assert.equal(app.el('updateBtn').textContent, '下载中…', '应回退到原来的文案');

  plugin.__resolve({ success: true, message: 'ok', size: 0 });
  await pending;

  assert.equal(app.el('updateBtn').textContent, '立即更新');
});

test('一键更新：插件抛异常时按钮复位且写明失败原因', async () => {
  let i = 0;
  const plugin = {
    updateSteps: async () => ({ success: true, message: '', log: '' }),
    getUpdateProgress: async () => { i += 1; return { active: true, percent: 10, downloaded: 1, total: 10 }; },
    installUpdate: async () => { throw new Error('网络中断'); }
  };
  const app = createHarness({ localPlugin: plugin });
  armUpdate(app);

  await app.run('installUpdate()');

  assert.equal(app.el('updateBtn').textContent, '立即更新');
  assert.equal(app.el('updateBtn').disabled, false);
  assert.equal(app.intervalCount(), 0, '异常路径也要停掉轮询');
  assert.ok(app.logLines.some((l) => l.includes('更新失败') && l.includes('网络中断')));
});
