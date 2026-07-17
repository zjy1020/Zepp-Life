const WORKER_URL = 'https://stepwong-api.3255962845.workers.dev';
const STORAGE_KEYS = { accounts: 'stepwong_accounts', history: 'stepwong_history', theme: 'stepwong_theme', tab: 'stepwong_tab', step: 'stepwong_step', lastSuccessStep: 'stepwong_last_success_step' };
const STEP_LIMITS = { min: 1, max: 98800 };
const STEP_INCREMENT_LIMIT = 1000;
const QUICK_PRESETS = [3000, 8000, 25000, 50000];
let accounts = [];
let stepHistory = [];
let currentStep = 1;
let activeTab = 'steps';
let lastSuccessStep = null;
let delegatedActionsReady = false;

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

function getLastSuccessForAccount(account) {
  if (!account) return null;
  return stepHistory.find((item) => item.success && ((item.accountUser && item.accountUser === account.user) || item.account === account.name)) || null;
}

function updateSliderRange() {
  const max = getDynamicStepMax();
  const slider = document.getElementById('stepSlider');
  const input = document.getElementById('stepInput');
  const minLabel = document.getElementById('sliderMinLabel');
  const midLabel = document.getElementById('sliderMidLabel');
  const maxLabel = document.getElementById('sliderMaxLabel');
  const rangeHint = document.getElementById('stepRangeHint');
  const baselinePreset = document.getElementById('baselinePresetBtn');
  const maxPreset = document.getElementById('maxPresetBtn');
  if (slider) slider.max = String(max);
  if (input) input.max = String(max);
  if (minLabel) minLabel.textContent = `${formatStep(STEP_LIMITS.min)} 步`;
  if (midLabel) midLabel.textContent = formatStep(Math.round((STEP_LIMITS.min + max) / 2));
  if (maxLabel) maxLabel.textContent = formatStep(max);
  if (rangeHint) rangeHint.textContent = getStepRangeHintText();
  if (baselinePreset) baselinePreset.textContent = `基准 ${formatStep(getLatestStepBaseline())}`;
  if (maxPreset) maxPreset.textContent = `最高 ${formatStep(max)}`;
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
  if (toggle) toggle.textContent = dark ? '☀️' : '🌙';
}
function toggleTheme() {
  const toggle = document.getElementById('themeToggle');
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  if (dark) { document.documentElement.removeAttribute('data-theme'); localStorage.setItem(STORAGE_KEYS.theme, 'light'); if (toggle) toggle.textContent = '🌙'; }
  else { document.documentElement.setAttribute('data-theme', 'dark'); localStorage.setItem(STORAGE_KEYS.theme, 'dark'); if (toggle) toggle.textContent = '☀️'; }
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
  const lastSuccessBtn = document.getElementById('useLastSuccessBtn');
  if (accountCountEl) accountCountEl.textContent = String(accounts.length);
  if (historyCountEl) historyCountEl.textContent = String(stepHistory.length);
  if (activeLabel) { const active = getActiveAccount(); activeLabel.textContent = active ? active.name : '未选择'; activeLabel.title = active ? active.user : '未选择账号'; }
  if (lastSuccessBtn) {
    const step = lastSuccessStep || getLastSuccessfulHistory()?.steps;
    if (step) { lastSuccessBtn.disabled = false; lastSuccessBtn.textContent = '沿用 ' + Number(step).toLocaleString(); }
    else { lastSuccessBtn.disabled = true; lastSuccessBtn.textContent = '沿用上次成功'; }
  }
}
function getPresetStepValue(stepKey) {
  if (stepKey === 'baseline') return getLatestStepBaseline();
  if (stepKey === 'max') return getDynamicStepMax();
  const parsed = Number.parseInt(stepKey || '', 10);
  return Number.isNaN(parsed) ? null : parsed;
}
function syncPresets(value) {
  const normalized = clampStep(value, getDynamicStepMax());
  document.querySelectorAll('.preset-btn').forEach((button) => {
    const preset = getPresetStepValue(button.dataset.step);
    button.classList.toggle('active', preset !== null && preset === normalized);
  });
}
function setStep(value, options = {}) {
  const { persist = true } = options;
  updateSliderRange();
  currentStep = clampStep(value, getDynamicStepMax());
  const stepNumber = document.getElementById('stepNumber');
  const stepSlider = document.getElementById('stepSlider');
  const stepInput = document.getElementById('stepInput');
  if (stepNumber) stepNumber.textContent = formatStep(currentStep);
  if (stepSlider) stepSlider.value = String(currentStep);
  if (stepInput) stepInput.value = String(currentStep);
  syncPresets(currentStep);
  if (persist) localStorage.setItem(STORAGE_KEYS.step, String(currentStep));
}function setActiveTab(tab, options = {}) {
  const { persist = true } = options;
  activeTab = tab;
  document.querySelectorAll('.nav-item').forEach((button) => button.classList.toggle('active', button.dataset.tab === tab));
  document.querySelectorAll('.tab-panel').forEach((panel) => panel.classList.toggle('active', panel.id === 'tab-' + tab));
  if (persist) localStorage.setItem(STORAGE_KEYS.tab, tab);
}
function renderHistory() {
  const list = document.getElementById('historyList');
  const chartWrap = document.getElementById('chartContainer');
  if (!list || !chartWrap) return;
  if (!stepHistory.length) { list.innerHTML = '<p class="history-empty">还没有提交记录</p>'; chartWrap.classList.add('hidden'); return; }
  list.innerHTML = stepHistory.map((item) => {
    const timeStr = formatHistoryTime(item.time);
    const stateClass = item.success ? 'is-success' : 'is-error';
    return `<div class="history-item ${stateClass}"><div class="history-main"><span class="h-account">${escapeHtml(item.account)}</span><span class="history-status ${stateClass}">${item.success ? '成功' : '失败'}</span></div><div class="history-sub"><span class="h-step">${Number(item.steps).toLocaleString()} 步</span><span class="h-time">${timeStr}</span></div></div>`;
  }).join('');
  renderChart();
}
function ensureChartShell(wrap) {
  if (document.getElementById('stepDistributionChart')) return;
  wrap.innerHTML = `
    <div class="chart-block">
      <div class="chart-title-row">
        <span class="chart-title">趋势折线</span>
        <span class="chart-note">最近 10 次</span>
      </div>
      <svg id="stepChart" viewBox="0 0 340 160" preserveAspectRatio="xMidYMid meet"></svg>
    </div>
    <div class="chart-block">
      <div class="chart-title-row">
        <span class="chart-title">步数分布</span>
        <span class="chart-note">按区间统计</span>
      </div>
      <svg id="stepDistributionChart" viewBox="0 0 340 170" preserveAspectRatio="xMidYMid meet"></svg>
    </div>
  `;
}

function renderChart() {
  const wrap = document.getElementById('chartContainer');
  if (!wrap) return;
  if (stepHistory.length === 0) { wrap.classList.add('hidden'); return; }
  wrap.classList.remove('hidden');
  ensureChartShell(wrap);

  const svg = document.getElementById('stepChart');
  if (!svg) return;

  const W = 340, H = 160, PAD = { top: 22, right: 12, bottom: 30, left: 46 };
  const data = stepHistory.slice(0, 10).reverse();
  if (data.length < 2) {
    svg.innerHTML = `<text x="170" y="78" text-anchor="middle" fill="var(--text-muted)" font-size="12">至少 2 条记录后显示趋势</text>`;
    renderDistributionChart();
    return;
  }

  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const values = data.map((item) => item.steps);
  const niceMax = Math.ceil(Math.max(...values, 1) / 5000) * 5000 || 5000;
  const points = values.map((step, index) => {
    const x = PAD.left + (index / (values.length - 1)) * plotW;
    const y = PAD.top + (1 - step / niceMax) * plotH;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  const gridLines = [0, 0.25, 0.5, 0.75, 1].map((factor) => {
    const y = PAD.top + factor * plotH;
    const val = Math.round(niceMax * (1 - factor));
    return `<line x1="${PAD.left}" y1="${y}" x2="${W - PAD.right}" y2="${y}" stroke="var(--border)" stroke-width="0.6" stroke-dasharray="4,4"/><text x="${PAD.left - 5}" y="${y + 4}" text-anchor="end" fill="var(--text-muted)" font-size="8">${val.toLocaleString()}</text>`;
  }).join('');

  const dots = data.map((item, index) => {
    const x = PAD.left + (index / (values.length - 1)) * plotW;
    const y = PAD.top + (1 - item.steps / niceMax) * plotH;
    const color = item.success ? 'var(--primary)' : 'var(--danger)';
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.5" fill="${color}" stroke="var(--surface)" stroke-width="2"><title>${item.steps.toLocaleString()} 步 · ${item.success ? '成功' : '失败'}</title></circle>`;
  }).join('');

  const labels = data.map((item, index) => {
    const x = PAD.left + (index / (values.length - 1)) * plotW;
    const date = new Date(item.time);
    return `<text x="${x.toFixed(1)}" y="${H - 6}" text-anchor="middle" fill="var(--text-muted)" font-size="8">${date.getMonth() + 1}/${date.getDate()}</text>`;
  }).join('');

  svg.innerHTML = `${gridLines}<polyline points="${points}" fill="none" stroke="var(--primary)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/><polyline points="${points}" fill="none" stroke="var(--primary)" stroke-width="8" stroke-linejoin="round" stroke-linecap="round" opacity="0.12"/><g>${dots}</g><g>${labels}</g>`;
  renderDistributionChart();
}

function renderDistributionChart() {
  const svg = document.getElementById('stepDistributionChart');
  if (!svg) return;

  const buckets = [
    { label: '<5K', min: 1, max: 4999 },
    { label: '5-10K', min: 5000, max: 9999 },
    { label: '10-25K', min: 10000, max: 24999 },
    { label: '25-50K', min: 25000, max: 49999 },
    { label: '50K+', min: 50000, max: STEP_LIMITS.max }
  ];
  const rows = buckets.map((bucket) => ({
    ...bucket,
    count: stepHistory.filter((item) => item.steps >= bucket.min && item.steps <= bucket.max).length
  }));

  const W = 340, H = 170, PAD = { top: 18, right: 12, bottom: 34, left: 26 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const maxCount = Math.max(...rows.map((row) => row.count), 1);
  const barGap = 10;
  const barW = (plotW - barGap * (rows.length - 1)) / rows.length;

  const bars = rows.map((row, index) => {
    const x = PAD.left + index * (barW + barGap);
    const barH = row.count === 0 ? 3 : (row.count / maxCount) * plotH;
    const y = PAD.top + plotH - barH;
    const active = row.count > 0;
    return `
      <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${barH.toFixed(1)}" rx="8" fill="${active ? 'var(--primary)' : 'var(--primary-soft)'}" opacity="${active ? '0.9' : '0.75'}"/>
      <text x="${(x + barW / 2).toFixed(1)}" y="${Math.max(12, y - 6).toFixed(1)}" text-anchor="middle" fill="var(--text-secondary)" font-size="10" font-weight="700">${row.count}</text>
      <text x="${(x + barW / 2).toFixed(1)}" y="${H - 10}" text-anchor="middle" fill="var(--text-muted)" font-size="8">${row.label}</text>
    `;
  }).join('');

  svg.innerHTML = `<line x1="${PAD.left}" y1="${PAD.top + plotH}" x2="${W - PAD.right}" y2="${PAD.top + plotH}" stroke="var(--border)" stroke-width="1"/>${bars}`;
}
function renderAccountList() {
  const list = document.getElementById('accountList');
  if (!list) return;
  if (!accounts.length) { list.innerHTML = '<p class="history-empty">还没有账号，快添加一个吧</p>'; return; }
  list.innerHTML = accounts.map((acct, index) => {
    const lastSuccess = getLastSuccessForAccount(acct);
    const successMeta = lastSuccess
      ? `<div class="account-success"><span>上次成功</span><strong>${formatStep(lastSuccess.steps)} 步</strong><small>${formatHistoryTime(lastSuccess.time)}</small></div>`
      : '<div class="account-success is-empty"><span>上次成功</span><strong>暂无</strong><small>完成一次刷步后显示</small></div>';
    return `<div class="account-item ${acct.is_active ? 'is-active' : ''}" data-index="${index}"><div class="info"><div class="account-main"><span class="name">${escapeHtml(acct.name)}</span>${acct.is_active ? '<span class="active-badge">当前</span>' : ''}</div><div class="account-sub">${escapeHtml(desensitize(acct.user))}</div>${successMeta}</div><div class="actions"><button type="button" class="btn-sm" data-account-action="use" data-account-index="${index}">使用</button><button type="button" class="btn-sm" data-account-action="rename" data-account-index="${index}">重命名</button><button type="button" class="btn-sm danger" data-account-action="delete" data-account-index="${index}">删除</button></div></div>`;
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
function appendLog(type, text) {
  const log = document.getElementById('logContent');
  if (!log) return;
  const row = document.createElement('div');
  row.className = 'log-row';
  const prompt = document.createElement('span');
  prompt.className = 'log-prompt';
  prompt.textContent = '>';
  const line = document.createElement('span');
  line.className = 'log-line ' + type;
  line.textContent = ' ' + text;
  row.append(prompt, line);
  log.appendChild(row);
  log.scrollTop = log.scrollHeight;
}
function clearLog() { const log = document.getElementById('logContent'); if (log) log.innerHTML = '<div class="log-row"><span class="log-prompt">&gt;</span><span class="log-line">系统就绪，等待执行...</span></div>'; }
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
  const container = document.createElement('div');
  container.className = 'confetti-container';
  const colors = ['#E11D48', '#BE123C', '#FDA4AF', '#FB7185', '#FECDD3', '#4C0519'];
  for (let i = 0; i < 40; i += 1) {
    const piece = document.createElement('div');
    piece.className = 'confetti-piece';
    piece.style.left = Math.random() * 100 + '%';
    piece.style.background = colors[Math.floor(Math.random() * colors.length)];
    piece.style.width = Math.random() * 8 + 4 + 'px';
    piece.style.height = Math.random() * 8 + 4 + 'px';
    piece.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px';
    piece.style.animationDuration = Math.random() * 1.5 + 1.5 + 's';
    piece.style.animationDelay = Math.random() * 0.5 + 's';
    container.appendChild(piece);
  }
  document.body.appendChild(container);
  setTimeout(() => container.remove(), 3500);
}
async function clashStart() {
  try { if (window.Capacitor?.Plugins?.ClashControl) return await window.Capacitor.Plugins.ClashControl.startClash(); } catch (err) { appendLog('error', '✖ Clash 启动失败: ' + (err?.message || err)); }
  return null;
}
function updateBusyState(isBusy, button) {
  const submitBtn = button || document.getElementById('submitBtn');
  const slider = document.getElementById('stepSlider');
  const select = document.getElementById('accountSelect');
  document.querySelectorAll('.preset-btn, .tool-btn, .increment-btn, .account-action-btn').forEach((el) => { el.disabled = isBusy || (el.classList.contains('account-action-btn') && getSelectedAccountIndex() < 0); });
  if (submitBtn) submitBtn.disabled = isBusy;
  if (slider) slider.disabled = isBusy;
  if (select) select.disabled = isBusy;
}
function clearManualStepInput() {
  document.getElementById('stepNumber')?.classList.remove('hidden');
  document.getElementById('stepInput')?.classList.add('hidden');
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
function applyLastSuccessStep() {
  const target = lastSuccessStep || getLastSuccessfulHistory()?.steps;
  if (!target) { appendLog('error', '✖ 还没有可沿用的成功步数'); return; }
  setStep(target);
  appendLog('success', '✔ 已沿用上次成功步数: ' + Number(target).toLocaleString());
}
function setupStepInput() {
  const display = document.getElementById('stepDisplay');
  const input = document.getElementById('stepInput');
  const number = document.getElementById('stepNumber');
  const hint = document.getElementById('stepHint');
  if (!display || !input || !number || !hint) return;
  display.addEventListener('click', () => {
    number.classList.add('hidden');
    input.classList.remove('hidden');
    hint.textContent = '↵ 按 Enter 确认';
    input.value = String(currentStep);
    input.focus();
    input.select();
  });
  input.addEventListener('blur', commit);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); commit(); }
    if (event.key === 'Escape') { event.preventDefault(); input.value = String(currentStep); clearManualStepInput(); }
  });
  function commit() { setStep(input.value); clearManualStepInput(); }
}
function setupQuickStepButtons() {
  document.querySelectorAll('[data-adjust]').forEach((button) => button.addEventListener('click', () => { setStep(currentStep + Number.parseInt(button.dataset.adjust || '0', 10)); clearManualStepInput(); }));
  document.querySelectorAll('.preset-btn').forEach((button) => button.addEventListener('click', () => {
    if (button.dataset.step === 'random') applyRandomStep();
    else setStep(getPresetStepValue(button.dataset.step) || STEP_LIMITS.min);
    clearManualStepInput();
  }));
  document.getElementById('resetStepBtn')?.addEventListener('click', () => { setStep(1); clearManualStepInput(); });
  document.getElementById('useLastSuccessBtn')?.addEventListener('click', () => { applyLastSuccessStep(); clearManualStepInput(); });
  document.getElementById('stepSlider')?.addEventListener('input', function () { setStep(this.value); clearManualStepInput(); });
}
function setupNavigation() { document.querySelectorAll('.nav-item').forEach((button) => button.addEventListener('click', function () { setActiveTab(this.dataset.tab || 'steps'); })); }
function setupThemeToggle() { document.getElementById('themeToggle')?.addEventListener('click', toggleTheme); }
function setupLogControls() { document.getElementById('clearLogBtn')?.addEventListener('click', clearLog); }
function setupHistoryControls() { document.getElementById('clearHistoryBtn')?.addEventListener('click', clearHistory); }
function setupAccountSelectBinding() {
  document.getElementById('accountSelect')?.addEventListener('change', function () {
    const index = Number.parseInt(this.value, 10);
    if (!Number.isNaN(index)) setActiveAccount(index, { silent: true });
    updateAccountManagementControls();
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
  if (!confirm('确认清空最近记录吗？')) return;
  stepHistory = [];
  lastSuccessStep = null;
  localStorage.removeItem(STORAGE_KEYS.history);
  localStorage.removeItem(STORAGE_KEYS.lastSuccessStep);
  updateSliderRange();
  setStep(STEP_LIMITS.min, { persist: false });
  renderHistory();
  renderAccountList();
  renderSummary();
  appendLog('line', '   · 已清空最近记录');
}
function renderBusyState(isBusy, button) {
  updateBusyState(isBusy, button);
  const text = button?.querySelector('.btn-text');
  if (text) text.textContent = isBusy ? '执 行 中...' : '开 始 刷 步';
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
  hideResult();
  const select = document.getElementById('accountSelect');
  const index = Number.parseInt(select?.value || '', 10);
  if (Number.isNaN(index) || index < 0 || index >= accounts.length) { renderBusyState(false, button); appendLog('error', '✖ 请先选择账号！'); return; }
  setActiveAccount(index, { silent: true });
  const account = accounts[index];
  const previousStep = currentStep;
  const clashResult = await clashStart();
  const clashStarted = !!clashResult?.success;
  appendLog('info', '⟳ 正在提交刷步请求...');
  appendLog('line', '   · 账号: ' + account.name);
  appendLog('line', '   · 步数: ' + Number(currentStep).toLocaleString());
  if (clashStarted) { appendLog('line', '   · Clash 代理已自动开启'); appendLog('line', '   · 等待 VPN 连接...'); await new Promise((resolve) => setTimeout(resolve, 2500)); }
  try {
    const response = await fetch(WORKER_URL + '/api/update', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user: account.user, password: account.password, steps: currentStep }) });
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch {
      showResult(false, '服务器返回了非JSON数据 (状态:' + response.status + ')');
      appendLog('error', '✖ 服务器返回非JSON: ' + text.slice(0, 100));
      addHistory(account, currentStep, false);
      return;
    }
    if (data.success) { showResult(true, '修改成功！步数: ' + Number(currentStep).toLocaleString()); appendLog('success', '✔ ' + data.message); addHistory(account, currentStep, true); }
    else { showResult(false, data.message || '修改失败'); appendLog('error', '✖ ' + (data.message || '修改失败')); addHistory(account, currentStep, false); }
    if (data.log) data.log.split('\n').forEach((line) => { const trimmed = line.trim(); if (trimmed) appendLog('line', '   ' + trimmed); });
  } catch (err) {
    showResult(false, '网络错误: 无法连接到服务器');
    appendLog('error', '✖ 请求失败: ' + (err?.message || err));
    addHistory(account, currentStep, false);
  } finally {
    if (clashStarted) appendLog('line', '   · Clash 代理已保持开启，请按需在 CMFA 中关闭');
    setStep(previousStep, { persist: false });
    renderBusyState(false, button);
  }
}
function setupSubmitButton() {
  const submitBtn = document.getElementById('submitBtn');
  if (!submitBtn) return;
  submitBtn.addEventListener('click', async function () { if (this.disabled) return; renderBusyState(true, this); await submitStepUpdate(this); });
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
  try {
    const response = await fetch('tutorial/Zepp修改微信步数教学.md');
    if (!response.ok) throw new Error('HTTP ' + response.status);
    body.innerHTML = simpleMarkdown(await response.text());
    body.dataset.loaded = '1';
  } catch (err) {
    body.innerHTML = '<p style="text-align:center;color:#ef4444;padding:40px 0;">加载失败: ' + escapeHtml(err?.message || err) + '</p>';
  }
}
function closeTutorial() { document.getElementById('tutorialOverlay')?.classList.add('hidden'); }
function setupTutorial() {
  document.getElementById('tutorialBtn')?.addEventListener('click', openTutorial);
  document.getElementById('tutorialClose')?.addEventListener('click', closeTutorial);
  document.getElementById('tutorialOverlay')?.addEventListener('click', (event) => { if (event.target === document.getElementById('tutorialOverlay')) closeTutorial(); });
}
function init() {
  loadHistory();
  loadAccounts();
  loadTheme();
  loadTab();
  loadStep();
  setStep(currentStep, { persist: false });
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
  setupSubmitButton();
  setupTutorial();
}
window.useAccount = function useAccount(index) { setActiveAccount(index, { silent: false }); };
window.renameAccount = function renameAccountGlobal(index) { renameAccount(index); };
window.deleteAccount = function deleteAccountGlobal(index) { deleteAccount(index); };
window.hideResult = hideResult;
setupDelegatedActions();
document.addEventListener('DOMContentLoaded', init);






















