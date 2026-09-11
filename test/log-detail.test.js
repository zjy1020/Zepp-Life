const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function createElement() {
  const listeners = new Map();
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
      add() {},
      remove() {},
      toggle() {},
      contains() { return false; },
      has() { return false; }
    },
    append(...kids) { this.children.push(...kids); },
    appendChild(kid) { this.children.push(kid); },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    addEventListener(type, listener) { listeners.set(type, listener); },
    dispatch(type, event = {}) { listeners.get(type)?.({ preventDefault() {}, ...event }); },
    focus() {},
    select() {},
    remove() {}
  };
}

/**
 * 捕获写入日志面板的每一行文本。
 * appendLog 会 createElement 出 row / prompt / line 三层再 appendChild 到 #logContent，
 * 所以这里在 logContent.appendChild 处拦截，取出其中的 .log-line 文本。
 */
function createAppHarness({ localPlugin } = {}) {
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
  const storage = new Map();
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
    setInterval: () => 0,
    clearInterval: () => {}
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
    logLines,
    runSubmit() { return vm.runInContext('submitStepUpdate(null)', context); },
    run(code) { return vm.runInContext(code, context); }
  };
}

test('formatLogTime 输出补零的 HH:MM:SS', () => {
  const app = createAppHarness();
  assert.equal(app.run('formatLogTime(new Date(2026, 8, 11, 9, 5, 3))'), '09:05:03');
  assert.equal(app.run('formatLogTime(new Date(2026, 8, 11, 23, 59, 59))'), '23:59:59');
  assert.equal(app.run('formatLogTime(new Date(2026, 8, 11, 0, 0, 0))'), '00:00:00');
});

test('日志每行都带 [HH:MM:SS] 墙钟前缀', async () => {
  const app = createAppHarness({
    localPlugin: async () => ({ success: true, message: '同步成功！当前步数: 5000', log: '+0ms 设备ID:abc\n+120ms 同步步数（5000）[HTTP 200][success]' })
  });

  await app.runSubmit();

  assert.ok(app.logLines.length > 0, '应写入日志');
  for (const line of app.logLines) {
    assert.match(line, /^ \[\d{2}:\d{2}:\d{2}\] /, '缺少时间戳前缀: ' + JSON.stringify(line));
  }
});

test('日志记录脱敏后的登录账号，便于区分同名的多个账号', async () => {
  const app = createAppHarness({
    localPlugin: async () => ({ success: true, message: '同步成功！当前步数: 5000', log: '' })
  });

  await app.runSubmit();

  const accountLine = app.logLines.find((l) => l.includes('账号:'));
  assert.ok(accountLine, '应有一行记录账号');
  assert.ok(accountLine.includes('测试账号'), '应含账号昵称');
  assert.ok(accountLine.includes('tes****.com'), '应含脱敏后的登录账号: ' + accountLine);
  assert.ok(!accountLine.includes('test@example.com'), '不应出现完整登录账号');
});

test('日志声明本次的令牌缓存状态与预期请求数', async () => {
  const app = createAppHarness({
    localPlugin: async () => ({ success: true, message: '同步成功！当前步数: 5000', log: '' })
  });

  await app.runSubmit();

  const cacheLine = app.logLines.find((l) => l.includes('令牌缓存:'));
  assert.ok(cacheLine, '应有一行说明令牌缓存状态');
  assert.ok(cacheLine.includes('无，走完整登录 4 个请求'), '首次应说明走完整登录: ' + cacheLine);
});

test('同步器内部日志按原样透传，保留 [+耗时] 前缀', async () => {
  const app = createAppHarness({
    localPlugin: async () => ({
      success: true,
      message: '同步成功！当前步数: 5000',
      log: '[+0ms] 命中缓存令牌，跳过登录（预期仅 1 个请求）\n[+2ms] 提交步数 [HTTP 200] 耗时 620ms\n[+623ms] 本次共发出 1 个请求，总耗时 623ms —— 成功（缓存令牌）'
    })
  });

  await app.runSubmit();

  const inner = app.logLines.filter((l) => l.includes('[+'));
  assert.equal(inner.length, 3, '内部日志应有 3 行');
  for (const line of inner) {
    assert.match(line, /\[\+\d+ms\]/, '应保留相对耗时前缀: ' + line);
  }
  assert.ok(inner.some((l) => l.includes('本次共发出 1 个请求')), '应包含请求数与总耗时汇总');
});
