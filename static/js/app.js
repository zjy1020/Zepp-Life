const WORKER_URL = 'https://stepwong-api.3255962845.workers.dev';
const STORAGE_KEYS = { accounts: 'stepwong_accounts', history: 'stepwong_history', historyArchive: 'stepwong_history_archive', theme: 'stepwong_theme', tab: 'stepwong_tab', step: 'stepwong_step', lastSuccessStep: 'stepwong_last_success_step', lastResetDate: 'stepwong_last_reset_date', authCache: 'stepwong_auth_cache', lastSubmitAt: 'stepwong_last_submit_at', logs: 'stepwong_logs' };
/* 当前版本号。升版本时与 Release 的 tag 保持一致，便于在界面里确认装的是哪一版 */
const APP_VERSION = '1.0.7';
const RELEASES_API = 'https://api.github.com/repos/zjy1020/Zepp-Life/releases/latest';
/* 两次提交之间的最小间隔。华米按来源 IP 限流，短窗口内连发多轮即触发 429；
   冷却挡的是误触连点，代价由失败后的无效重试承担。 */
const SUBMIT_COOLDOWN_MS = 60000;
/* 令牌缓存有效期。华米 app_token 的真实 TTL 未经实测，12 小时是保守取值：
   同一天内复用，跨天自然失效走完整登录。即使提前失效也不会卡住——
   插件在提交失败时会回退完整登录，前端也会清掉这份缓存。 */
const AUTH_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
/* 日志持久化上限。日志是排查问题的唯一线索，刷新即丢太浪费；
   但也不能无限增长撑爆 localStorage，按行数截断。 */
const LOG_MAX_LINES = 400;
/* 历史归档上限（天） */
const HISTORY_ARCHIVE_DAYS = 30;
const THEME_ICONS = {
  light: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>',
  dark: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>',
};
const STEP_LIMITS = { min: 1, max: 98800 };
const STEP_INCREMENT_LIMIT = 1000;
let accounts = [];
let stepHistory = [];
let currentStep = 1;
let activeTab = 'steps';
let lastSuccessStep = null;
let delegatedActionsReady = false;
let rollCancel = null;
const TAB_ORDER = ['steps', 'accounts', 'logs'];

function readJSON(key, fallback) {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; } catch { return fallback; }
}
function writeJSON(key, value) { localStorage.setItem(key, JSON.stringify(value)); }
function escapeHtml(value) { return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
function desensitize(user) {
  const text = String(user || '').trim();
  if (!text) return '未命名账号';
  if (text.length <= 8) { const len = Math.max(Math.floor(text.length / 3), 1); return text.slice(0, len) + '***' + text.slice(-len); }
  return text.slice(0, 3) + '****' + text.slice(-4);
}
function clampStep(value, max = STEP_LIMITS.max) {
  const parsed = Number.parseInt(value, 10);
  const safeMax = Math.max(STEP_LIMITS.min, Math.min(STEP_LIMITS.max, Number.parseInt(max, 10) || STEP_LIMITS.max));
  return Number.isNaN(parsed) ? STEP_LIMITS.min : Math.max(STEP_LIMITS.min, Math.min(safeMax, parsed));
}

function getLatestStepBaseline() {
  const latestSuccess = getLastSuccessfulHistory();
  if (latestSuccess) return latestSuccess.steps;
  return lastSuccessStep || STEP_LIMITS.min;
}

/* ---------- 每日清零 ----------
   规则：跨过自然日（过了 0 点）后，步数基准与动态上限一并重置为 1 / 1001。
   实现方式：记录"上次清零日期"，每次启动与每次操作前比对当前日期。
   不与"上次成功步数"耦合，因为清零的语义就是**忘掉昨天的成绩**。 */

/* 把时间戳格式化为本地日期键 YYYY-MM-DD */
function dateKeyOf(time) {
  const d = time instanceof Date ? time : new Date(time);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getTodayKey() {
  return dateKeyOf(new Date());
}

/* ---------- 历史归档 ----------
   跨天清零会把当天的记录一并删除，导致"昨天刷过什么"完全查不到。
   清零前先把记录按各自的实际日期并入归档；界面上仍以今天为主。 */
function loadHistoryArchive() {
  const archive = readJSON(STORAGE_KEYS.historyArchive, {});
  return archive && typeof archive === 'object' && !Array.isArray(archive) ? archive : {};
}

function archiveHistory(entries, fallbackDateKey) {
  const list = Array.isArray(entries) ? entries : [];
  if (!list.length) return;
  const archive = loadHistoryArchive();
  list.forEach((item) => {
    const key = dateKeyOf(item?.time) || fallbackDateKey;
    if (!key) return;
    if (!Array.isArray(archive[key])) archive[key] = [];
    archive[key].push(item);
  });
  Object.keys(archive).forEach((key) => {
    archive[key] = archive[key].slice(0, 10);
  });
  Object.keys(archive).sort().reverse().slice(HISTORY_ARCHIVE_DAYS).forEach((key) => {
    delete archive[key];
  });
  writeJSON(STORAGE_KEYS.historyArchive, archive);
}

function renderHistoryDay(title, entries) {
  const items = entries.map((item) => {
    const timeStr = formatHistoryTime(item.time);
    const stateClass = item.success ? 'is-success' : 'is-error';
    return `<div class="history-item ${stateClass}"><div class="history-main"><span class="h-account">${escapeHtml(item.account)}</span><span class="history-status ${stateClass}">${item.success ? '成功' : '失败'}</span></div><div class="history-sub"><span class="h-step">${Number(item.steps).toLocaleString()} 步</span><span class="h-time">${timeStr}</span></div></div>`;
  }).join('');
  return `<div class="history-day"><div class="history-day-title">${escapeHtml(title)}</div>${items}</div>`;
}

function hasCrossedNewDay() {
  const last = localStorage.getItem(STORAGE_KEYS.lastResetDate);
  if (!last) return false; // 首次使用：没有"上一次"可言，不算跨天
  return last !== getTodayKey();
}

/* 执行清零。返回 true 表示本次确实发生了重置。 */
function applyDailyReset(options = {}) {
  const { persist = true, silent = false } = options;
  const last = localStorage.getItem(STORAGE_KEYS.lastResetDate);

  /* 首次使用：只落下日期基线，不清空任何东西 */
  if (!last) {
    if (persist) localStorage.setItem(STORAGE_KEYS.lastResetDate, getTodayKey());
    return false;
  }
  if (last === getTodayKey()) return false;

  /* 先把当天的记录并入归档，再清空——否则跨天之后就再也查不到昨天刷过什么 */
  archiveHistory(stepHistory, last);

  stepHistory = [];
  lastSuccessStep = null;
  currentStep = STEP_LIMITS.min;

  localStorage.removeItem(STORAGE_KEYS.history);
  localStorage.removeItem(STORAGE_KEYS.lastSuccessStep);
  localStorage.removeItem(STORAGE_KEYS.step);
  if (persist) localStorage.setItem(STORAGE_KEYS.lastResetDate, getTodayKey());

  if (!silent) appendLog('line', '   · 已跨天，步数基准与上限重置为 ' + formatStep(STEP_LIMITS.min) + ' / ' + formatStep(STEP_LIMITS.min + STEP_INCREMENT_LIMIT));
  return true;
}

/* 跨天检测触发点：启动时、以及每次提交前。
   提交前检测可覆盖"App 一直开着跨了 0 点"的情况。 */
function ensureFreshDay() {
  if (!hasCrossedNewDay()) return false;
  const didReset = applyDailyReset({ persist: true, silent: true });
  if (didReset) {
    updateSliderRange();
    setStep(STEP_LIMITS.min, { persist: false, animate: false });
    renderHistory();
    renderSummary();
  }
  return didReset;
}

/* ---------- 零点自动归零 ----------
   原实现调用 plugin.scheduleMidnightReset()，但插件端从未实现这个方法，
   调用总是静默失败——等于"界面挂在前台跨过 0 点不会归零"。
   改用纯 JS 定时器：只在页面存活时生效，而这恰好就是界面需要刷新的场景；
   后台期间的跨天仍由 ensureFreshDay()（启动时 + 每次提交前）兜底。 */
let midnightTimer = null;

function scheduleMidnightTick() {
  if (midnightTimer && typeof clearTimeout === 'function') clearTimeout(midnightTimer);
  midnightTimer = null;
  if (typeof setTimeout !== 'function') return;
  /* 多等 2 秒，避免因时钟精度落在 23:59:59.999 而立刻触发 */
  const now = new Date();
  const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 2, 0);
  midnightTimer = setTimeout(() => {
    midnightTimer = null;
    if (ensureFreshDay()) {
      appendLog('line', '   · 已跨零点，步数基准与上限已自动归零');
    }
    /* 时段提示依赖当前小时，跨点后需要重算 */
    updateSyncTip();
    scheduleMidnightTick();
  }, nextMidnight.getTime() - now.getTime());
}

function getDynamicStepMax() {
  const latestStep = getLatestStepBaseline();
  return Math.min(STEP_LIMITS.max, clampStep(latestStep, STEP_LIMITS.max) + STEP_INCREMENT_LIMIT);
}

function formatStep(value) {
  return Number(value).toLocaleString();
}

function formatHistoryTime(time) {
  return new Date(time).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function getStepRangeHintText() {
  const baseline = getLatestStepBaseline();
  const max = getDynamicStepMax();
  const hasSuccess = !!(lastSuccessStep || getLastSuccessfulHistory());
  return hasSuccess
    ? `上次成功 ${formatStep(baseline)}，本次最高 ${formatStep(max)}`
    : `当前基准 ${formatStep(baseline)}，本次最高 ${formatStep(max)}`;
}
function updateSliderRange() {
  const max = getDynamicStepMax();
  const slider = document.getElementById('stepSlider');
  const input = document.getElementById('stepInput');
  const minLabel = document.getElementById('sliderMinLabel');
  const midLabel = document.getElementById('sliderMidLabel');
  const maxLabel = document.getElementById('sliderMaxLabel');
  const rangeHint = document.getElementById('stepRangeHint');
  if (slider) slider.max = String(max);
  if (input) input.max = String(STEP_LIMITS.max);
  if (minLabel) minLabel.textContent = `${formatStep(STEP_LIMITS.min)} 步`;
  if (midLabel) midLabel.textContent = formatStep(Math.round((STEP_LIMITS.min + max) / 2));
  if (maxLabel) maxLabel.textContent = formatStep(max);
  if (rangeHint) rangeHint.textContent = getStepRangeHintText();
  updateSliderFill();
}
function getActiveAccountIndex() { return accounts.findIndex((acct) => acct.is_active); }
function getActiveAccount() { const index = getActiveAccountIndex(); return index >= 0 ? accounts[index] : null; }
function getLastSuccessfulHistory() { return stepHistory.find((item) => item.success) || null; }

function normalizeAccounts() {
  if (!Array.isArray(accounts)) { accounts = []; return; }
  let activeSeen = false;
  accounts = accounts.map((acct) => ({ name: String(acct?.name || '').trim(), user: String(acct?.user || '').trim(), password: String(acct?.password || '').trim(), is_active: !!acct?.is_active })).filter((acct) => acct.user && acct.password);
  accounts.forEach((acct) => {
    if (!acct.name) acct.name = desensitize(acct.user);
    if (acct.is_active && !activeSeen) { activeSeen = true; return; }
    acct.is_active = false;
  });
  if (accounts.length && !activeSeen) accounts[0].is_active = true;
}
function saveAccounts() { writeJSON(STORAGE_KEYS.accounts, accounts); }
function saveHistory() { writeJSON(STORAGE_KEYS.history, stepHistory); }
function loadTheme() {
  const saved = localStorage.getItem(STORAGE_KEYS.theme);
  const toggle = document.getElementById('themeToggle');
  const dark = saved === 'dark';
  document.documentElement.toggleAttribute('data-theme', dark);
  if (toggle) toggle.innerHTML = dark ? THEME_ICONS.dark : THEME_ICONS.light;
}
function toggleTheme() {
  const toggle = document.getElementById('themeToggle');
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  if (dark) { document.documentElement.removeAttribute('data-theme'); localStorage.setItem(STORAGE_KEYS.theme, 'light'); if (toggle) toggle.innerHTML = THEME_ICONS.light; }
  else { document.documentElement.setAttribute('data-theme', 'dark'); localStorage.setItem(STORAGE_KEYS.theme, 'dark'); if (toggle) toggle.innerHTML = THEME_ICONS.dark; }
}
function loadHistory() {
  const raw = readJSON(STORAGE_KEYS.history, []);
  stepHistory = Array.isArray(raw) ? raw.map((item) => ({ account: String(item?.account || '未知账号'), accountUser: String(item?.accountUser || ''), steps: clampStep(item?.steps || STEP_LIMITS.min), time: Number(item?.time) || Date.now(), success: !!item?.success })).sort((a, b) => b.time - a.time) : [];
  const demoAccounts = ['示例账号', '备用账号'];
  const onlyDemoHistory = stepHistory.length > 0 && stepHistory.every((item) => demoAccounts.includes(item.account));
  if (onlyDemoHistory) {
    stepHistory = [];
    localStorage.removeItem(STORAGE_KEYS.history);
    localStorage.removeItem(STORAGE_KEYS.lastSuccessStep);
  }

  if (!stepHistory.length) {
    lastSuccessStep = null;
    localStorage.removeItem(STORAGE_KEYS.lastSuccessStep);
    return;
  }

  const stored = Number.parseInt(localStorage.getItem(STORAGE_KEYS.lastSuccessStep) || '', 10);
  lastSuccessStep = !Number.isNaN(stored) ? clampStep(stored) : (getLastSuccessfulHistory()?.steps || null);
}
function loadAccounts() {
  accounts = readJSON(STORAGE_KEYS.accounts, []);
  normalizeAccounts();
  saveAccounts();
  renderAccountList();
  updateAccountSelect();
  renderSummary();
}
function loadTab() { activeTab = localStorage.getItem(STORAGE_KEYS.tab) || 'steps'; }
function loadStep() {
  if (!stepHistory.length) {
    currentStep = STEP_LIMITS.min;
    return;
  }

  const stored = Number.parseInt(localStorage.getItem(STORAGE_KEYS.step) || '', 10);
  const dynamicMax = getDynamicStepMax();
  if (lastSuccessStep) currentStep = clampStep(lastSuccessStep, dynamicMax);
  else if (!Number.isNaN(stored)) currentStep = clampStep(stored, dynamicMax);
  else currentStep = STEP_LIMITS.min;
}
function renderSummary() {
  const accountCountEl = document.getElementById('accountCount');
  const historyCountEl = document.getElementById('historyCount');
  const activeLabel = document.getElementById('activeAccountLabel');
  if (accountCountEl) accountCountEl.textContent = String(accounts.length);
  if (historyCountEl) historyCountEl.textContent = String(stepHistory.length);
  if (activeLabel) { const active = getActiveAccount(); activeLabel.textContent = active ? active.name : '未选择'; activeLabel.title = active ? active.user : '未选择账号'; }
}
function setStep(value, options = {}) {
  const { persist = true, max = getDynamicStepMax(), animate = true } = options;
  updateSliderRange();
  const previousStep = currentStep;
  currentStep = clampStep(value, max);
  const stepNumber = document.getElementById('stepNumber');
  const stepSlider = document.getElementById('stepSlider');
  const stepInput = document.getElementById('stepInput');
  if (stepNumber) {
    const kit = window.MotionKit;
    if (animate && kit && Math.abs(previousStep - currentStep) > 1 && !stepNumber.classList.contains('hidden')) {
      stepNumber.classList.add('is-rolling');
      rollCancel?.();
      rollCancel = kit.rollNumber(previousStep, currentStep, {
        duration: 420,
        onUpdate: (v) => { stepNumber.textContent = formatStep(v); },
        onDone: () => {
          stepNumber.textContent = formatStep(currentStep);
          stepNumber.classList.remove('is-rolling');
        }
      });
    } else {
      stepNumber.textContent = formatStep(currentStep);
    }
  }
  if (stepSlider) stepSlider.value = String(currentStep);
  if (stepInput) stepInput.value = String(currentStep);
  updateSliderFill();
  if (persist) localStorage.setItem(STORAGE_KEYS.step, String(currentStep));
}
function updateSliderFill() {
  const slider = document.getElementById('stepSlider');
  if (!slider || !slider.style || typeof slider.style.setProperty !== 'function') return;
  const min = Number(slider.min) || 0;
  const max = Number(slider.max) || 100;
  const val = Number(slider.value) || 0;
  const percent = max > min ? ((val - min) / (max - min)) * 100 : 0;
  slider.style.setProperty('--slider-fill', percent.toFixed(2) + '%');
}function setActiveTab(tab, options = {}) {
  const { persist = true } = options;
  const previousTab = activeTab;
  activeTab = tab;
  document.querySelectorAll('.nav-item').forEach((button) => button.classList.toggle('active', button.dataset.tab === tab));
  document.querySelectorAll('.tab-panel').forEach((panel) => {
    const isActive = panel.id === 'tab-' + tab;
    panel.classList.toggle('active', isActive);
    if (isActive && previousTab !== tab) {
      const from = TAB_ORDER.indexOf(previousTab);
      const to = TAB_ORDER.indexOf(tab);
      const direction = (from >= 0 && to >= 0 && to < from) ? -1 : 1;
      window.MotionKit?.panelEnter(panel, direction);
    }
  });
  if (persist) localStorage.setItem(STORAGE_KEYS.tab, tab);
}
function renderHistory() {
  const list = document.getElementById('historyList');
  if (!list) return;
  const blocks = [];
  if (stepHistory.length) blocks.push(renderHistoryDay('今天', stepHistory));
  const archive = loadHistoryArchive();
  Object.keys(archive).sort().reverse().forEach((key) => {
    const entries = Array.isArray(archive[key]) ? archive[key] : [];
    if (entries.length) blocks.push(renderHistoryDay(key, entries));
  });
  list.innerHTML = blocks.length ? blocks.join('') : '<p class="history-empty">还没有提交记录</p>';
}

function renderAccountList() {
  const list = document.getElementById('accountList');
  if (!list) return;
  if (!accounts.length) { list.innerHTML = '<p class="history-empty">还没有账号，快添加一个吧</p>'; return; }
  list.innerHTML = accounts.map((acct, index) => {

    return `<div class="account-item ${acct.is_active ? 'is-active' : ''}" data-index="${index}"><div class="info"><div class="account-main"><span class="name">${escapeHtml(acct.name)}</span>${acct.is_active ? '<span class="active-badge">当前</span>' : ''}</div><div class="account-sub">${escapeHtml(desensitize(acct.user))}</div></div><div class="actions"><button type="button" class="btn-sm" data-account-action="use" data-account-index="${index}" onclick="event.stopPropagation(); useAccount(${index})">使用</button><button type="button" class="btn-sm" data-account-action="rename" data-account-index="${index}" onclick="event.stopPropagation(); renameAccount(${index})">重命名</button><button type="button" class="btn-sm danger" data-account-action="delete" data-account-index="${index}" onclick="event.stopPropagation(); deleteAccount(${index})">删除</button></div></div>`;
  }).join('');
}
function updateAccountSelect() {
  const select = document.getElementById('accountSelect');
  if (!select) return;
  select.innerHTML = '';
  if (!accounts.length) {
    const option = document.createElement('option');
    option.value = '';
    option.disabled = true;
    option.selected = true;
    option.textContent = '暂无账号，请先添加';
    select.appendChild(option);
    updateAccountManagementControls();
    return;
  }
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.disabled = true;
  placeholder.textContent = '— 请选择账号 —';
  select.appendChild(placeholder);
  const activeIndex = getActiveAccountIndex();
  accounts.forEach((acct, index) => {
    const option = document.createElement('option');
    option.value = String(index);
    option.textContent = `${acct.name} (${acct.user})`;
    if (index === activeIndex) option.selected = true;
    select.appendChild(option);
  });
  if (activeIndex < 0) select.value = '';
  updateAccountManagementControls();
}
function getSelectedAccountIndex() {
  const select = document.getElementById('accountSelect');
  const index = Number.parseInt(select?.value || '', 10);
  if (Number.isNaN(index) || index < 0 || index >= accounts.length) return -1;
  return index;
}
function updateAccountManagementControls() {
  const selectedIndex = getSelectedAccountIndex();
  const hasAccount = selectedIndex >= 0;
  const renameBtn = document.getElementById('renameSelectedAccountBtn');
  const deleteBtn = document.getElementById('deleteSelectedAccountBtn');
  const row = document.getElementById('accountManageRow');
  if (renameBtn) renameBtn.disabled = !hasAccount;
  if (deleteBtn) deleteBtn.disabled = !hasAccount;
  row?.classList.toggle('is-disabled', !hasAccount);
}
function formatLogTime(date) {
  const d = date instanceof Date ? date : new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
}
/* ---------- 日志 ----------
   日志是排查问题的唯一线索，刷新即丢太浪费，因此同时写入 localStorage。
   内存里保留最近 LOG_MAX_LINES 行，落盘做节流避免逐行写。 */
let logBuffer = [];
let logPersistTimer = null;

function writeLogsToStorage() {
  try {
    writeJSON(STORAGE_KEYS.logs, logBuffer);
  } catch {
    /* localStorage 配额满：日志可丢，不能因此打断主流程 */
  }
}

function persistLogsThrottled() {
  if (typeof setTimeout !== 'function') { writeLogsToStorage(); return; }
  if (logPersistTimer) return;
  logPersistTimer = setTimeout(() => {
    logPersistTimer = null;
    writeLogsToStorage();
  }, 400);
}

function renderLogRow(log, entry) {
  const row = document.createElement('div');
  row.className = 'log-row';
  const prompt = document.createElement('span');
  prompt.className = 'log-prompt';
  prompt.textContent = '>';
  const line = document.createElement('span');
  line.className = 'log-line ' + (entry.type || '');
  line.textContent = entry.text;
  row.append(prompt, line);
  log.appendChild(row);
}

function appendLog(type, text) {
  /* 前端事件打墙钟时间；同步器内部步骤自带 [+耗时] 前缀。
     两者回答的是不同问题：什么时候发生 vs 每一步花了多久。 */
  const entry = { type, text: ' [' + formatLogTime() + '] ' + text };
  logBuffer.push(entry);
  if (logBuffer.length > LOG_MAX_LINES) logBuffer = logBuffer.slice(-LOG_MAX_LINES);
  persistLogsThrottled();

  const log = document.getElementById('logContent');
  if (!log) return;
  renderLogRow(log, entry);
  log.scrollTop = log.scrollHeight;
}

/* 启动时回填上次会话的日志，这样"上次为什么失败"不用重新复现 */
function loadPersistedLogs() {
  const saved = readJSON(STORAGE_KEYS.logs, []);
  if (!Array.isArray(saved) || !saved.length) return;
  logBuffer = saved.filter((item) => item && typeof item.text === 'string').slice(-LOG_MAX_LINES);
  const log = document.getElementById('logContent');
  if (!log) return;
  log.innerHTML = '';
  logBuffer.forEach((entry) => renderLogRow(log, entry));
  log.scrollTop = log.scrollHeight;
}

function clearLog() {
  logBuffer = [];
  if (logPersistTimer && typeof clearTimeout === 'function') clearTimeout(logPersistTimer);
  logPersistTimer = null;
  try { localStorage.removeItem(STORAGE_KEYS.logs); } catch { /* 忽略 */ }
  const log = document.getElementById('logContent');
  if (log) log.innerHTML = '<div class="log-row"><span class="log-prompt">&gt;</span><span class="log-line">系统就绪，等待执行...</span></div>';
}

function logText() {
  return logBuffer.map((entry) => String(entry.text).replace(/^ /, '')).join('\n');
}

/* 写剪贴板：优先用异步剪贴板 API，失败则退回临时 textarea + execCommand。
   WebView 里前者的可用性取决于安全上下文，两条路都留着更稳。 */
async function writeClipboard(text) {
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* 落到降级方案 */ }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.left = '-9999px';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

async function copyLog() {
  const text = logText();
  if (!text) {
    appendLog('line', '   · 日志为空，没有可复制的内容');
    return;
  }
  const ok = await writeClipboard(text);
  appendLog(ok ? 'success' : 'error',
    ok ? '✔ 已复制 ' + logBuffer.length + ' 行日志到剪贴板' : '✖ 复制失败，请长按日志手动选择');
}
function haptic(type) { if (!navigator.vibrate) return; navigator.vibrate(type === 'success' ? 30 : [60, 30, 60]); }
function showResult(success, message) {
  const banner = document.getElementById('resultBanner');
  const icon = document.getElementById('resultIcon');
  const msg = document.getElementById('resultMsg');
  if (!banner || !icon || !msg) return;
  banner.classList.toggle('error', !success);
  icon.textContent = success ? '✓' : '✕';
  msg.textContent = message;
  banner.classList.remove('hidden');
  haptic(success ? 'success' : 'error');
  if (success) spawnConfetti();
}
function hideResult() { document.getElementById('resultBanner')?.classList.add('hidden'); }
function spawnConfetti() {
  const kit = window.MotionKit;
  if (kit?.spawnConfetti) {
    kit.spawnConfetti({ count: 42, colors: ['#1FA89A', '#4A9FE8', '#F26D5B', '#F2B83C', '#2F9E6E', '#20303C'] });
    return;
  }
  /* 降级：内核不可用时保持静默，不阻塞成功反馈 */
}
function createRequestSignal(timeoutMs) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') return AbortSignal.timeout(timeoutMs);
  return undefined;
}
function getLocalStepWongPlugin() {
  try { return window.Capacitor?.Plugins?.StepWong || null; } catch { return null; }
}

/* ---------- 令牌缓存 ----------
   完整登录链是 4 个请求，其中前 3 个只产出可复用的令牌。
   缓存后每次提交只需 1 个请求，且不再触碰会被限流的登录端点
   （api-user.zepp.com/v2/registrations/tokens）。 */
function loadAuthCache() {
  const cache = readJSON(STORAGE_KEYS.authCache, {});
  return cache && typeof cache === 'object' ? cache : {};
}
function getCachedAuth(user) {
  if (!user) return null;
  const entry = loadAuthCache()[String(user)];
  if (!entry || !entry.userId || !entry.appToken) return null;
  const savedAt = Number(entry.savedAt) || 0;
  if (!savedAt || Date.now() - savedAt > AUTH_CACHE_TTL_MS) return null;
  return entry;
}
function saveCachedAuth(user, userId, appToken) {
  if (!user || !userId || !appToken) return;
  const cache = loadAuthCache();
  cache[String(user)] = { userId: String(userId), appToken: String(appToken), savedAt: Date.now() };
  writeJSON(STORAGE_KEYS.authCache, cache);
}
function clearCachedAuth(user) {
  if (!user) return;
  const cache = loadAuthCache();
  if (!cache[String(user)]) return;
  delete cache[String(user)];
  writeJSON(STORAGE_KEYS.authCache, cache);
}

/* ---------- 提交冷却 ---------- */
let cooldownTimer = null;
let submitInFlight = false;

function getCooldownRemaining() {
  const last = Number(localStorage.getItem(STORAGE_KEYS.lastSubmitAt) || 0);
  if (!last) return 0;
  return Math.max(0, SUBMIT_COOLDOWN_MS - (Date.now() - last));
}

function applyCooldownState() {
  const btn = document.getElementById('submitBtn');
  const text = btn && typeof btn.querySelector === 'function' ? btn.querySelector('.btn-text') : null;
  const remaining = getCooldownRemaining();
  if (remaining > 0) {
    if (btn) btn.disabled = true;
    if (text) text.textContent = '冷却 ' + Math.ceil(remaining / 1000) + 's';
    if (!cooldownTimer && typeof setInterval === 'function') {
      cooldownTimer = setInterval(applyCooldownState, 500);
    }
    return;
  }
  if (cooldownTimer && typeof clearInterval === 'function') {
    clearInterval(cooldownTimer);
  }
  cooldownTimer = null;
  if (submitInFlight) return;
  if (btn) btn.disabled = false;
  if (text) text.textContent = '执 行 步 数';
}

function updateBusyState(isBusy, button) {
  const submitBtn = button || document.getElementById('submitBtn');
  const slider = document.getElementById('stepSlider');
  const select = document.getElementById('accountSelect');
  document.querySelectorAll('.preset-btn, .step-confirm, .account-action-btn').forEach((el) => { el.disabled = isBusy || (el.classList.contains('account-action-btn') && getSelectedAccountIndex() < 0); });
  if (submitBtn) submitBtn.disabled = isBusy;
  if (slider) slider.disabled = isBusy;
  if (select) select.disabled = isBusy;
}
function clearManualStepInput() {
  document.getElementById('stepNumber')?.classList.remove('hidden');
  document.getElementById('stepInputRow')?.classList.add('hidden');
  const hint = document.getElementById('stepHint');
  if (hint) hint.textContent = '点击数字手动输入';
}
function applyRandomStep() {
  const ref = getLatestStepBaseline();
  const max = getDynamicStepMax();
  const min = ref ? clampStep(ref, max) : STEP_LIMITS.min;
  const value = Math.floor(Math.random() * (max - min + 1)) + min;
  setStep(value);
}
function setupStepInput() {
  const display = document.getElementById('stepDisplay');
  const input = document.getElementById('stepInput');
  const number = document.getElementById('stepNumber');
  const hint = document.getElementById('stepHint');
  const confirmBtn = document.getElementById('stepConfirm');
  if (!display || !input || !number || !hint || !confirmBtn) return;
  let suppressDisplayClick = false;
  display.addEventListener('click', (event) => {
    if (suppressDisplayClick) return;
    if (event.target.closest?.('.step-input-row')) return;
    number.classList.add('hidden');
    document.getElementById('stepInputRow')?.classList.remove('hidden');
    hint.textContent = '输入后点确定';
    input.value = String(currentStep);
    input.focus();
    input.select();
  });
  confirmBtn.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); commit(); });
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); commit(); }
    if (event.key === 'Escape') { event.preventDefault(); input.value = String(currentStep); clearManualStepInput(); }
  });
  function commit() {
    setStep(input.value, { max: STEP_LIMITS.max });
    clearManualStepInput();
    suppressDisplayClick = true;
    setTimeout(() => { suppressDisplayClick = false; }, 400);
  }
}
function setupQuickStepButtons() {
  document.querySelectorAll('.preset-btn').forEach((button) => button.addEventListener('click', () => {
    if (button.dataset.step === 'random') applyRandomStep();
    clearManualStepInput();
  }));
  const slider = document.getElementById('stepSlider');
  if (!slider) return;
  const kit = window.MotionKit;
  const coupler = kit?.velocityCouple ? kit.velocityCouple(slider.parentElement, { gain: 0.4, max: 5 }) : null;
  let dragging = false;
  slider.addEventListener('input', function () {
    setStep(this.value);
    clearManualStepInput();
    coupler?.nudge(Number(this.value));
  });
  const startDrag = () => { dragging = true; slider.classList.add('is-dragging'); };
  const endDrag = () => { dragging = false; slider.classList.remove('is-dragging'); };
  slider.addEventListener('pointerdown', startDrag);
  slider.addEventListener('pointerup', endDrag);
  slider.addEventListener('pointercancel', endDrag);
  slider.addEventListener('pointerleave', endDrag);
}

/* 给可点击元素挂上按压回弹。像素按键不回弹就是"死"的。 */
function setupPressFeedback() {
  const kit = window.MotionKit;
  if (!kit?.pressFeedback) return;
  const selector = '.preset-btn, .step-confirm, .submit-btn, .clear-btn, .btn-sm, .nav-item, ' +
    '.account-action-btn, .tutorial-btn, .theme-toggle, .result-close, .add-account-card button, ' +
    '.section-collapse-btn, .mini-manage-btn, .modal-actions button';
  document.querySelectorAll(selector).forEach((el) => {
    if (el.dataset.pressBound) return;
    el.dataset.pressBound = '1';
    kit.pressFeedback(el, { depth: 3 });
  });
}
function setupAccountCollapse() {
  const btn = document.getElementById('accountCollapseBtn');
  const list = document.getElementById('accountList');
  const section = document.getElementById('accountSection');
  if (!btn || !list) return;
  btn.addEventListener('click', () => {
    const collapsed = list.classList.toggle('hidden');
    section?.classList.toggle('open', !collapsed);
    btn.setAttribute('aria-expanded', String(!collapsed));
  });
}
/* 0-8 点禁止刷步是网页通道（Cloudflare Worker）的限制，本地直连不受影响。
   因此本地模式下整条提示都隐藏——继续显示只会让人误以为刷了也不生效。
   顺带把同步模式写到标题副行，这也正是它与网页版的唯一差别。 */
function updateSyncTip() {
  const local = !!getLocalStepWongPlugin();
  const modeEl = document.getElementById('appMode');
  if (modeEl) modeEl.textContent = local ? '本地直连' : '网页模式';

  const tip = document.getElementById('syncTip');
  if (!tip) return;
  if (local) {
    tip.classList.add('hidden');
    tip.classList.remove('blocked');
    return;
  }
  tip.classList.remove('hidden');
  const hour = new Date().getHours();
  const blocked = hour >= 0 && hour < 8;
  tip.classList.toggle('blocked', blocked);
  tip.textContent = blocked
    ? '网页通道当前禁止刷步：凌晨 0 点 - 早上 8 点'
    : '温馨提示：网页通道在凌晨 0 点 - 早上 8 点禁止刷步';
}
function setupNavigation() { document.querySelectorAll('.nav-item').forEach((button) => button.addEventListener('click', function () { setActiveTab(this.dataset.tab || 'steps'); })); }
function setupThemeToggle() { document.getElementById('themeToggle')?.addEventListener('click', toggleTheme); }
function setupLogControls() {
  document.getElementById('clearLogBtn')?.addEventListener('click', clearLog);
  document.getElementById('copyLogBtn')?.addEventListener('click', copyLog);
  document.getElementById('checkUpdateBtn')?.addEventListener('click', () => { checkForUpdate({ manual: true }); });
  document.getElementById('updateBtn')?.addEventListener('click', installUpdate);
}
function setupHistoryControls() { document.getElementById('clearHistoryBtn')?.addEventListener('click', clearHistory); }
function setupAccountSelectBinding() {
  document.getElementById('accountSelect')?.addEventListener('change', function () {
    const index = Number.parseInt(this.value, 10);
    if (!Number.isNaN(index)) setActiveAccount(index, { silent: true });
    updateAccountManagementControls();
  });
}
function setupAccountManagePanel() {
  const btn = document.getElementById('accountManageBtn');
  const panel = document.getElementById('accountManagePanel');
  if (!btn || !panel) return;
  btn.addEventListener('click', (event) => {
    event.stopPropagation();
    panel.classList.toggle('hidden');
    updateAccountSelect();
    updateAccountManagementControls();
  });
  document.addEventListener('click', (event) => {
    if (panel.classList.contains('hidden')) return;
    const inside = (panel.contains && panel.contains(event.target)) || (btn.contains && btn.contains(event.target));
    if (!inside) panel.classList.add('hidden');
  });
}
function setupAccountManagementControls() {
  updateAccountManagementControls();
}
function setupDelegatedActions() {
  if (delegatedActionsReady) return;
  delegatedActionsReady = true;
  document.addEventListener('click', (event) => {
    const navButton = event.target.closest?.('.nav-item[data-tab]');
    if (navButton) {
      event.preventDefault();
      setActiveTab(navButton.dataset.tab || 'steps');
      return;
    }

    const accountButton = event.target.closest?.('[data-account-action]');
    if (!accountButton || accountButton.disabled) return;
    const action = accountButton.dataset.accountAction;
    const explicitIndex = Number.parseInt(accountButton.dataset.accountIndex || '', 10);
    const index = Number.isNaN(explicitIndex) ? getSelectedAccountIndex() : explicitIndex;
    if (index < 0 || index >= accounts.length) return;

    event.preventDefault();
    if (action === 'use') setActiveAccount(index, { silent: false });
    if (action === 'rename' || action === 'rename-selected') renameAccount(index);
    if (action === 'delete' || action === 'delete-selected') deleteAccount(index);
  });
}
function upsertAccount(user, password) {
  const normalizedUser = String(user).trim();
  const normalizedPassword = String(password).trim();
  const existingIndex = accounts.findIndex((acct) => acct.user.toLowerCase() === normalizedUser.toLowerCase());
  const next = { name: desensitize(normalizedUser), user: normalizedUser, password: normalizedPassword, is_active: true };
  if (existingIndex >= 0) { accounts[existingIndex] = { ...accounts[existingIndex], ...next }; setActiveAccount(existingIndex, { silent: true }); return { mode: 'updated', account: accounts[existingIndex] }; }
  accounts.forEach((acct) => { acct.is_active = false; });
  accounts.unshift(next);
  normalizeAccounts();
  setActiveAccount(0, { silent: true, persist: false });
  return { mode: 'added', account: accounts[0] };
}
function setActiveAccount(index, options = {}) {
  const { silent = false, persist = true } = options;
  if (index < 0 || index >= accounts.length) return false;
  accounts.forEach((acct, acctIndex) => { acct.is_active = acctIndex === index; });
  if (persist) saveAccounts();
  renderAccountList();
  updateAccountSelect();
  renderSummary();
  if (!silent) appendLog('success', '✔ 已切换至: ' + accounts[index].name);
  return true;
}
function renameAccount(index) {
  if (index < 0 || index >= accounts.length) return;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `<div class="modal-card"><h3>重命名账号</h3><input type="text" id="renameInput" value="${escapeHtml(accounts[index].name)}" placeholder="输入新名称"><div class="modal-actions"><button class="modal-cancel" id="renameCancel">取消</button><button class="modal-confirm" id="renameConfirm">确认</button></div></div>`;
  document.body.appendChild(overlay);
  const input = overlay.querySelector('#renameInput');
  const cancelBtn = overlay.querySelector('#renameCancel');
  const confirmBtn = overlay.querySelector('#renameConfirm');
  input?.focus(); input?.select();
  cancelBtn?.addEventListener('click', () => overlay.remove());
  confirmBtn?.addEventListener('click', () => { const newName = String(input?.value || '').trim(); if (newName) { accounts[index].name = newName; saveAccounts(); renderAccountList(); updateAccountSelect(); renderSummary(); appendLog('success', '✔ 已重命名为: ' + newName); } overlay.remove(); });
  input?.addEventListener('keydown', (event) => { if (event.key === 'Enter') confirmBtn?.click(); if (event.key === 'Escape') overlay.remove(); });
  overlay.addEventListener('click', (event) => { if (event.target === overlay) overlay.remove(); });
}
function deleteAccount(index) {
  if (index < 0 || index >= accounts.length) return;
  if (!confirm('确认删除账号 ' + accounts[index].name + ' 吗？')) return;
  const wasActive = accounts[index].is_active;
  accounts.splice(index, 1);
  normalizeAccounts();
  saveAccounts();
  renderAccountList();
  updateAccountSelect();
  renderSummary();
  appendLog('success', wasActive && accounts.length ? '✔ 已删除并自动切换到: ' + accounts[getActiveAccountIndex()].name : '✔ 账号已删除');
}
function addHistory(accountRef, steps, success) {
  const accountName = typeof accountRef === 'object' && accountRef ? accountRef.name : accountRef;
  const accountUser = typeof accountRef === 'object' && accountRef ? accountRef.user : '';
  const entry = { account: String(accountName || '未知账号'), accountUser: String(accountUser || ''), steps: clampStep(steps, STEP_LIMITS.max), time: Date.now(), success: !!success };
  stepHistory.unshift(entry);
  if (stepHistory.length > 10) stepHistory = stepHistory.slice(0, 10);
  if (entry.success) {
    lastSuccessStep = entry.steps;
    localStorage.setItem(STORAGE_KEYS.lastSuccessStep, String(entry.steps));
    localStorage.setItem(STORAGE_KEYS.step, String(entry.steps));
  }
  saveHistory();
  updateSliderRange();
  setStep(currentStep, { persist: false });
  renderHistory();
  renderAccountList();
  renderSummary();
}
function clearHistory() {
  const archivedDays = Object.keys(loadHistoryArchive()).length;
  const hint = archivedDays ? '（含 ' + archivedDays + ' 天历史归档）' : '';
  if (!confirm('确认清空最近记录' + hint + '吗？')) return;
  stepHistory = [];
  lastSuccessStep = null;
  localStorage.removeItem(STORAGE_KEYS.history);
  localStorage.removeItem(STORAGE_KEYS.historyArchive);
  localStorage.removeItem(STORAGE_KEYS.lastSuccessStep);
  updateSliderRange();
  setStep(STEP_LIMITS.min, { persist: false });
  renderHistory();
  renderAccountList();
  renderSummary();
  appendLog('line', '   · 已清空最近记录与历史归档');
}
function renderBusyState(isBusy, button) {
  submitInFlight = !!isBusy;
  updateBusyState(isBusy, button);
  const submitBtn = button || document.getElementById('submitBtn');
  const text = submitBtn && typeof submitBtn.querySelector === 'function' ? submitBtn.querySelector('.btn-text') : null;
  if (isBusy) {
    if (text) text.textContent = '执 行 中...';
    return;
  }
  /* 结束忙碌后不能直接恢复按钮文字：可能仍落在冷却窗口内 */
  applyCooldownState();
}
function setupAddAccountForm() {
  const addBtn = document.getElementById('addAccountBtn');
  const userInput = document.getElementById('newUser');
  const passInput = document.getElementById('newPass');
  if (!addBtn || !userInput || !passInput) return;
  const submitAccount = () => {
    const user = userInput.value.trim();
    const password = passInput.value.trim();
    if (!user || !password) { appendLog('error', '✖ 请填写完整的账号和密码'); return; }
    const result = upsertAccount(user, password);
    saveAccounts();
    renderAccountList();
    updateAccountSelect();
    renderSummary();
    userInput.value = '';
    passInput.value = '';
    appendLog('success', result.mode === 'updated' ? '✔ 账号已更新: ' + result.account.name : '✔ 账号已添加: ' + result.account.name);
  };
  addBtn.addEventListener('click', submitAccount);
  userInput.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); passInput.focus(); } });
  passInput.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); submitAccount(); } });
}
async function submitStepUpdate(button) {
  /* 冷却期内直接拦截。被限流的是登录端点，连发只会延长限流窗口 */
  const cooldown = getCooldownRemaining();
  if (cooldown > 0) {
    appendLog('line', '   · 距上次提交不足 ' + Math.round(SUBMIT_COOLDOWN_MS / 1000) + ' 秒，请再等 ' + Math.ceil(cooldown / 1000) + ' 秒');
    applyCooldownState();
    return;
  }
  hideResult();
  /* 提交前再查一次跨天：App 一直挂着跨过 0 点时，需要就地重置而不是沿用昨天的基准 */
  if (ensureFreshDay()) {
    appendLog('line', '   · 检测到已跨天，本次提交从新基准 ' + formatStep(currentStep) + ' 开始');
  }
  const select = document.getElementById('accountSelect');
  const index = Number.parseInt(select?.value || '', 10);
  if (Number.isNaN(index) || index < 0 || index >= accounts.length) { renderBusyState(false, button); appendLog('error', '✖ 请先选择账号！'); return; }
  setActiveAccount(index, { silent: true });
  const account = accounts[index];
  const previousStep = currentStep;
  if (!confirm('当前账号：' + account.name + '，确认刷步？')) { renderBusyState(false, button); return; }
  const localPlugin = getLocalStepWongPlugin();
  const cached = getCachedAuth(account.user);
  appendLog('info', localPlugin ? '⟳ 正在通过 APK 内置同步器提交...' : '⟳ 正在提交同步请求...');
  appendLog('line', '   · 账号: ' + account.name + '（' + desensitize(account.user) + '）');
  appendLog('line', '   · 步数: ' + Number(currentStep).toLocaleString());
  if (localPlugin) appendLog('line', '   · 同步方式: 本地模式（无需 Cloudflare Worker）');
  appendLog('line', '   · 令牌缓存: ' + (cached ? '命中，本次仅 1 个请求' : '无，走完整登录 4 个请求'));
  renderBusyState(true, button);
  let data = null;
  try {
    if (localPlugin) {
      const result = await localPlugin.updateSteps({
        user: account.user,
        password: account.password,
        steps: String(currentStep),
        userId: cached ? cached.userId : '',
        appToken: cached ? cached.appToken : ''
      });
      data = (result && typeof result === 'object')
        ? { success: !!result.success, message: result.message || '', log: result.log || '', userId: result.userId || '', appToken: result.appToken || '' }
        : { success: false, message: '本地同步器返回异常', log: '' };
    } else {
      const response = await fetch(WORKER_URL + '/api/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user: account.user,
          password: account.password,
          steps: currentStep,
          userId: cached ? cached.userId : '',
          appToken: cached ? cached.appToken : ''
        }),
        signal: createRequestSignal(15000)
      });
      const text = await response.text();
      try { data = JSON.parse(text); } catch { throw new Error('服务器返回了非JSON数据 (状态:' + response.status + '): ' + text.slice(0, 100)); }
    }
    /* 先铺细节日志，再给结论——否则用户会先看到错误摘要、后看到解释它的原因 */
    if (data.log) data.log.split('\n').forEach((line) => { const trimmed = line.trim(); if (trimmed) appendLog('line', '   ' + trimmed); });
    if (data.success) {
      saveCachedAuth(account.user, data.userId, data.appToken);
      showResult(true, '同步成功！步数: ' + Number(currentStep).toLocaleString());
      appendLog('success', '✔ ' + (data.message || '同步成功'));
      addHistory(account, currentStep, true);
    } else {
      /* 插件在缓存令牌被拒时已内部回退；这里再清一次，确保下次从干净状态开始 */
      if (cached) clearCachedAuth(account.user);
      showResult(false, data.message || '同步失败');
      appendLog('error', '✖ ' + (data.message || '同步失败'));
      addHistory(account, currentStep, false);
    }
  } catch (err) {
    showResult(false, localPlugin ? ('本地同步失败: ' + (err?.message || err)) : '网络错误: 无法连接到服务器');
    appendLog('error', '✖ ' + (localPlugin ? ('本地同步失败: ' + (err?.message || err)) : ('请求失败: ' + (err?.message || err))));
    addHistory(account, currentStep, false);
  } finally {
    setStep(previousStep, { persist: false });
    /* 无论成败都进入冷却：失败多半就是被限流，立刻重试只会更糟 */
    localStorage.setItem(STORAGE_KEYS.lastSubmitAt, String(Date.now()));
    renderBusyState(false, button);
  }
}
function setupSubmitButton() {
  const submitBtn = document.getElementById('submitBtn');
  if (!submitBtn) return;
  submitBtn.addEventListener('click', async function () { if (this.disabled) return; await submitStepUpdate(this); });
}
function simpleMarkdown(md) {
  let html = md
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, alt, src) => { const fixedSrc = src.startsWith('images/') ? 'tutorial/' + src : src; return `<img src="${fixedSrc}" alt="${escapeHtml(alt)}" loading="lazy">`; })
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/^---$/gm, '<hr>')
    .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
    .replace(/\n\n+/g, '</p><p>')
    .replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>')
    .replace(/(<blockquote>.*<\/blockquote>\n?)+/g, '<blockquote>$&</blockquote>')
    .replace(/<blockquote><blockquote>/g, '<blockquote>')
    .replace(/<\/blockquote><\/blockquote>/g, '</blockquote>');
  return '<p>' + html + '</p>';
}
async function openTutorial() {
  const overlay = document.getElementById('tutorialOverlay');
  const body = document.getElementById('tutorialBody');
  if (!overlay || !body) return;
  overlay.classList.remove('hidden');
  if (body.dataset.loaded) return;
  let markdown = '';
  try {
    const response = await fetch('tutorial/Zepp微信步数同步教学.md');
    if (response.ok) markdown = await response.text();
  } catch { markdown = ''; }
  if (!markdown.trim()) {
    const embedded = document.getElementById('tutorialMarkdown');
    if (embedded) markdown = embedded.textContent;
  }
  if (!markdown.trim()) {
    body.innerHTML = '<p style="text-align:center;color:var(--danger);padding:40px 0;">加载失败: 教程内容缺失</p>';
    return;
  }
  body.innerHTML = simpleMarkdown(markdown);
  body.dataset.loaded = '1';
}
function closeTutorial() { document.getElementById('tutorialOverlay')?.classList.add('hidden'); }
function setupTutorial() {
  document.getElementById('tutorialBtn')?.addEventListener('click', openTutorial);
  document.getElementById('tutorialClose')?.addEventListener('click', closeTutorial);
  document.getElementById('tutorialOverlay')?.addEventListener('click', (event) => { if (event.target === document.getElementById('tutorialOverlay')) closeTutorial(); });
}

/* ---------- 版本与更新检查 ----------
   界面原本没有任何版本标识，"手机里装的到底是哪一版"无从确认。
   顺带查一次 GitHub Releases，有新版就在日志与页脚提示。 */
function parseVersion(text) {
  const match = String(text || '').match(/(\d+)\.(\d+)\.(\d+)/);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

function compareVersion(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return 0;
  for (let i = 0; i < 3; i += 1) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}

let latestVersion = '';
/* 新版 APK 的直链，从 release 的 assets 里取。App 内一键更新要用它下载。 */
let latestApkUrl = '';

/* 检查更新的四种终态 + 进行中。
   之前只做静默自动检查，导致"已是最新"和"根本没查成"在界面上完全一样——
   加手动按钮后必须把状态显式表达出来。 */
const UPDATE_STATE = { idle: 'idle', checking: 'checking', latest: 'latest', outdated: 'outdated', failed: 'failed' };
let updateState = UPDATE_STATE.idle;

/* 从 release 响应里挑出 APK 直链。assets 里可能混有其他文件，只认 .apk。 */
function pickApkAssetUrl(release) {
  const assets = (release && release.assets) || [];
  for (const asset of assets) {
    if (asset && /\.apk$/i.test(String(asset.name || ''))) {
      return String(asset.browser_download_url || '');
    }
  }
  return '';
}

function renderVersionInfo() {
  const el = document.getElementById('logFooter');
  const btn = document.getElementById('checkUpdateBtn');
  const checking = updateState === UPDATE_STATE.checking;

  if (el) {
    const mode = getLocalStepWongPlugin() ? '本地直连' : '网页模式';
    const parts = ['动动吧 v' + APP_VERSION, mode];
    if (checking) parts.push('检查中…');
    else if (updateState === UPDATE_STATE.outdated) parts.push('有新版本 v' + latestVersion);
    else if (updateState === UPDATE_STATE.latest) parts.push('已是最新');
    else if (updateState === UPDATE_STATE.failed) parts.push('检查更新失败');
    el.textContent = parts.join(' · ');
  }

  if (btn) {
    btn.disabled = checking;
    btn.textContent = checking ? '检查中…' : '检查更新';
  }

  /* 「立即更新」只在确实有新版本时才出现 */
  document.getElementById('updateBtn')?.classList.toggle('hidden', updateState !== UPDATE_STATE.outdated);
}

/* 检查 GitHub Releases 的最新版本。
   manual=true 时（用户点了按钮）会把结果写进日志，包括失败原因。 */
async function checkForUpdate(options = {}) {
  const manual = !!options.manual;
  if (updateState === UPDATE_STATE.checking) return null;

  if (typeof fetch !== 'function') {
    updateState = UPDATE_STATE.failed;
    renderVersionInfo();
    return null;
  }

  updateState = UPDATE_STATE.checking;
  renderVersionInfo();
  if (manual) appendLog('info', '⟳ 正在检查新版本…');

  try {
    const response = await fetch(RELEASES_API, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: createRequestSignal(8000)
    });
    if (!response.ok) {
      throw new Error('HTTP ' + response.status);
    }
    const data = await response.json();
    const parsed = parseVersion(data && data.tag_name);
    if (!parsed) {
      throw new Error('响应中没有可识别的版本号');
    }
    latestVersion = parsed.join('.');
    latestApkUrl = pickApkAssetUrl(data);
    updateState = compareVersion(latestVersion, APP_VERSION) > 0 ? UPDATE_STATE.outdated : UPDATE_STATE.latest;
    renderVersionInfo();

    if (updateState === UPDATE_STATE.outdated) {
      appendLog('info', '发现新版本 v' + latestVersion + '（当前 v' + APP_VERSION + '），点下方「立即更新」可直接安装');
    } else if (manual) {
      appendLog('success', '✔ 已是最新版本 v' + APP_VERSION);
    }
    return latestVersion;
  } catch (err) {
    updateState = UPDATE_STATE.failed;
    latestVersion = '';
    latestApkUrl = '';
    renderVersionInfo();
    if (manual) {
      appendLog('error', '✖ 检查更新失败：' + ((err && err.message) || '网络不可用'));
    }
    return null;
  }
}

/* 下载新版并唤起系统安装器。
   APK 内走原生插件（能自动拉起安装界面）；网页模式没有安装权限，退化为打开下载链接。

   注意：Android 不允许普通应用静默安装，下载完只会跳出系统安装界面，
   仍需用户点一次「安装」；Android 8+ 首次还要先授权「安装未知应用」。 */
async function installUpdate() {
  if (updateState !== UPDATE_STATE.outdated || !latestVersion) return;

  const btn = document.getElementById('updateBtn');
  const plugin = getLocalStepWongPlugin();

  if (!latestApkUrl) {
    appendLog('error', '✖ 没找到安装包下载地址，请到 GitHub Releases 手动下载');
    return;
  }

  if (!plugin || typeof plugin.installUpdate !== 'function') {
    appendLog('info', '⟳ 网页模式无法直接安装，已打开下载链接，请下载后手动安装');
    try { window.open(latestApkUrl, '_blank'); } catch { /* 弹窗被拦截时忽略 */ }
    return;
  }

  if (btn) { btn.disabled = true; btn.textContent = '下载中…'; }
  appendLog('info', '⟳ 正在下载 v' + latestVersion + ' 安装包…');

  try {
    const result = await plugin.installUpdate({ url: latestApkUrl, version: latestVersion });
    const size = result && result.size ? '（' + (Number(result.size) / 1048576).toFixed(1) + 'MB）' : '';
    if (result && result.success) {
      appendLog('success', '✔ ' + (result.message || '安装包已就绪') + size);
      appendLog('line', '   · 若系统提示需要「安装未知应用」权限，开启后返回再点一次即可');
    } else if (result && result.needPermission) {
      appendLog('info', '⟳ ' + (result.message || '需要先允许「安装未知应用」'));
    } else {
      appendLog('error', '✖ ' + ((result && result.message) || '更新失败'));
    }
  } catch (err) {
    appendLog('error', '✖ 更新失败：' + ((err && err.message) || err));
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '立即更新'; }
  }
}

function init() {
  loadHistory();
  /* 回填上次会话的日志：这样"上次为什么失败"不必重新复现 */
  loadPersistedLogs();
  /* 跨天检测要早于 loadStep，否则会用昨天的基准算出今天的上限 */
  const didDailyReset = applyDailyReset({ persist: true, silent: true });
  loadAccounts();
  loadTheme();
  loadTab();
  loadStep();
  if (didDailyReset) currentStep = STEP_LIMITS.min;
  setStep(currentStep, { persist: false, animate: false });
  setActiveTab(activeTab, { persist: false });
  renderSummary();
  renderHistory();
  updateAccountSelect();
  clearManualStepInput();
  setupStepInput();
  setupQuickStepButtons();
  setupNavigation();
  setupThemeToggle();
  setupLogControls();
  setupHistoryControls();
  setupAccountSelectBinding();
  setupAccountManagementControls();
  setupAddAccountForm();
  setupAccountCollapse();
  setupAccountManagePanel();
  updateSyncTip();
  setupSubmitButton();
  /* 重开页面时若仍在冷却窗口内，需恢复倒计时，否则按钮会短暂可点 */
  applyCooldownState();
  setupTutorial();
  setupPressFeedback();
  /* 纯 JS 定时器：页面活着时跨零点自动归零（后台期间的跨天由 ensureFreshDay 兜底） */
  scheduleMidnightTick();
  renderVersionInfo();
  /* 不 await：检查更新是锦上添花，不能拖慢启动，失败也不提示 */
  checkForUpdate();
}
window.useAccount = function useAccount(index) { setActiveAccount(index, { silent: false }); };
window.renameAccount = renameAccount;
window.deleteAccount = deleteAccount;
window.setActiveTab = setActiveTab;
window.renameSelectedAccount = function renameSelectedAccount() {
  const index = getSelectedAccountIndex();
  if (index >= 0) renameAccount(index);
};
window.deleteSelectedAccount = function deleteSelectedAccount() {
  const index = getSelectedAccountIndex();
  if (index >= 0) deleteAccount(index);
};
window.hideResult = hideResult;
setupDelegatedActions();
document.addEventListener('DOMContentLoaded', init);














