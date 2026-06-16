// StepWong Web — Claymorphism 版
const WORKER_URL = 'https://stepwong-api.3255962845.workers.dev';
const STORAGE_KEY = 'stepwong_accounts';
const HISTORY_KEY = 'stepwong_history';
const THEME_KEY = 'stepwong_theme';

let accounts = [];
let history = [];
let currentStep = 25000;

// ====== 初始化 ======
function init() {
  loadAccounts();
  loadHistory();
  loadTheme();
  renderHistory();
  updateStepDisplay(currentStep);
  setupStepInput();
  setupNav();
  setupThemeToggle();
  updateAccountSelect();
}

// ====== 账号管理（localStorage）======
function loadAccounts() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    accounts = raw ? JSON.parse(raw) : [];
  } catch(e) { accounts = []; }
  renderAccountList();
  updateAccountSelect();
}

function saveAccounts() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(accounts));
}

function desensitize(user) {
  const u = String(user);
  if (u.length <= 8) {
    const ln = Math.max(Math.floor(u.length / 3), 1);
    return u.slice(0, ln) + '***' + u.slice(-ln);
  }
  return u.slice(0, 3) + '****' + u.slice(-4);
}

// ====== 最近记录 ======
function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    history = raw ? JSON.parse(raw) : [];
  } catch(e) { history = []; }
}

function saveHistory() {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
}

function addHistory(accountName, steps, success) {
  history.unshift({
    account: accountName,
    steps: steps,
    time: Date.now(),
    success: !!success
  });
  if (history.length > 10) history = history.slice(0, 10);
  saveHistory();
  renderHistory();
}

function renderHistory() {
  const el = document.getElementById('historyList');
  if (!el) return;
  if (history.length === 0) {
    el.innerHTML = '<p class="history-empty">还没有提交记录</p>';
    return;
  }
  el.innerHTML = history.map(h => {
    const date = new Date(h.time);
    const timeStr = date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    return `<div class="history-item">
      <span class="h-account">${h.account}</span>
      <span class="h-step">${Number(h.steps).toLocaleString()} 步</span>
      <span class="h-time">${timeStr}</span>
    </div>`;
  }).join('');
}

// ====== 深色模式 ======
function loadTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
    document.getElementById('themeToggle').textContent = '☀️';
  }
}

function setupThemeToggle() {
  document.getElementById('themeToggle').addEventListener('click', function() {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    if (isDark) {
      document.documentElement.removeAttribute('data-theme');
      localStorage.setItem(THEME_KEY, 'light');
      this.textContent = '🌙';
    } else {
      document.documentElement.setAttribute('data-theme', 'dark');
      localStorage.setItem(THEME_KEY, 'dark');
      this.textContent = '☀️';
    }
  });
}

// ====== 底部导航 ======
function setupNav() {
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', function() {
      const tab = this.dataset.tab;
      document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      this.classList.add('active');
      document.getElementById('tab-' + tab).classList.add('active');
    });
  });
}

// ====== 步数控制 ======
function updateStepDisplay(val) {
  currentStep = parseInt(val) || 0;
  const display = document.getElementById('stepNumber');
  if (display) display.textContent = Number(currentStep).toLocaleString();
}

// 手动输入
function setupStepInput() {
  const display = document.getElementById('stepDisplay');
  const numberEl = document.getElementById('stepNumber');
  const inputEl = document.getElementById('stepInput');
  const hint = document.getElementById('stepHint');

  display.addEventListener('click', function() {
    numberEl.classList.add('hidden');
    inputEl.classList.remove('hidden');
    hint.textContent = '↵ 按 Enter 确认';
    inputEl.value = currentStep;
    inputEl.focus();
    inputEl.select();
  });

  inputEl.addEventListener('blur', function() {
    commitManualInput();
  });

  inputEl.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitManualInput();
    }
    if (e.key === 'Escape') {
      cancelManualInput();
    }
  });

  function commitManualInput() {
    let val = parseInt(inputEl.value);
    if (isNaN(val) || val < 1) val = 1;
    if (val > 98800) val = 98800;
    inputEl.value = val;

    // 同步到 slider 和 presets
    const slider = document.getElementById('stepSlider');
    slider.value = val;
    updateStepDisplay(val);
    syncPresets(val);

    // 恢复显示模式
    numberEl.classList.remove('hidden');
    inputEl.classList.add('hidden');
    hint.textContent = '👆 点击数字手动输入';
  }

  function cancelManualInput() {
    numberEl.classList.remove('hidden');
    inputEl.classList.add('hidden');
    hint.textContent = '👆 点击数字手动输入';
    inputEl.value = currentStep;
  }
}

function syncPresets(val) {
  document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
}

// 滑块
document.addEventListener('DOMContentLoaded', function() {
  const slider = document.getElementById('stepSlider');
  if (slider) {
    slider.addEventListener('input', function() {
      updateStepDisplay(parseInt(this.value) || 0);
      syncPresets(parseInt(this.value));
      // 如果手动输入开着，关掉
      const inputEl = document.getElementById('stepInput');
      const numberEl = document.getElementById('stepNumber');
      if (!inputEl.classList.contains('hidden')) {
        inputEl.classList.add('hidden');
        numberEl.classList.remove('hidden');
        document.getElementById('stepHint').textContent = '👆 点击数字手动输入';
      }
    });
  }

  // 预设按钮
  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', function() {
      document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
      this.classList.add('active');

      let val = this.dataset.step;
      if (val === 'random') {
        val = Math.floor(Math.random() * 98800) + 1;
      } else {
        val = parseInt(val);
      }
      const slider = document.getElementById('stepSlider');
      slider.value = val;
      updateStepDisplay(val);

      // 关掉手动输入
      const inputEl = document.getElementById('stepInput');
      const numberEl = document.getElementById('stepNumber');
      if (!inputEl.classList.contains('hidden')) {
        inputEl.classList.add('hidden');
        numberEl.classList.remove('hidden');
        document.getElementById('stepHint').textContent = '👆 点击数字手动输入';
      }
    });
  });
});

// ====== 日志 ======
function appendLog(type, text) {
  const log = document.getElementById('logContent');
  log.innerHTML += '<span class="log-prompt">></span> <span class="log-line ' + type + '">' + text + '</span><br>';
  log.scrollTop = log.scrollHeight;
}

// ====== 结果 ======
function showResult(success, msg) {
  const banner = document.getElementById('resultBanner');
  const icon = document.getElementById('resultIcon');
  const msgEl = document.getElementById('resultMsg');
  banner.classList.remove('error');
  if (!success) banner.classList.add('error');
  icon.textContent = success ? '✓' : '✕';
  msgEl.textContent = msg;
  banner.classList.remove('hidden');

  if (success) spawnConfetti();
}

function hideResult() {
  document.getElementById('resultBanner').classList.add('hidden');
}

// ====== 彩纸效果 ======
function spawnConfetti() {
  const container = document.createElement('div');
  container.className = 'confetti-container';
  const colors = ['#059669', '#ea580c', '#10b981', '#f59e0b', '#3b82f6', '#8b5cf6'];
  for (let i = 0; i < 40; i++) {
    const piece = document.createElement('div');
    piece.className = 'confetti-piece';
    piece.style.left = Math.random() * 100 + '%';
    piece.style.background = colors[Math.floor(Math.random() * colors.length)];
    piece.style.width = (Math.random() * 8 + 4) + 'px';
    piece.style.height = (Math.random() * 8 + 4) + 'px';
    piece.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px';
    piece.style.animationDuration = (Math.random() * 1.5 + 1.5) + 's';
    piece.style.animationDelay = (Math.random() * 0.5) + 's';
    container.appendChild(piece);
  }
  document.body.appendChild(container);
  setTimeout(() => container.remove(), 3500);
}

// ====== 提交刷步 ======
document.addEventListener('DOMContentLoaded', function() {
  const submitBtn = document.getElementById('submitBtn');
  if (!submitBtn) return;

  submitBtn.addEventListener('click', async function() {
    hideResult();

    const select = document.getElementById('accountSelect');
    const idx = parseInt(select.value);

    if (isNaN(idx) || idx < 0 || idx >= accounts.length) {
      appendLog('error', '✖ 请先选择账号！');
      return;
    }

    this.disabled = true;
    const origText = this.querySelector('.btn-text').textContent;
    this.querySelector('.btn-text').textContent = '执 行 中...';

    const acct = accounts[idx];
    appendLog('info', '⟳ 正在提交刷步请求...');
    appendLog('line', '   · 账号: ' + acct.name);
    appendLog('line', '   · 步数: ' + currentStep.toLocaleString());

    try {
      const resp = await fetch(WORKER_URL + '/api/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user: acct.user,
          password: acct.password,
          steps: currentStep
        })
      });
      const text = await resp.text();

      let data;
      try { data = JSON.parse(text); } catch(e) {
        showResult(false, '服务器返回了非JSON数据 (状态:' + resp.status + ')');
        appendLog('error', '✖ 服务器返回非JSON: ' + text.slice(0, 100));
        addHistory(acct.name, currentStep, false);
        this.querySelector('.btn-text').textContent = origText;
        this.disabled = false;
        return;
      }

      if (data.success) {
        showResult(true, '修改成功！步数: ' + currentStep.toLocaleString());
        appendLog('success', '✔ ' + data.message);
        addHistory(acct.name, currentStep, true);
      } else {
        showResult(false, data.message || '修改失败');
        appendLog('error', '✖ ' + data.message);
        addHistory(acct.name, currentStep, false);
      }

      if (data.log) {
        data.log.split('\n').forEach(line => {
          if (line.trim()) appendLog('line', '   ' + line.trim());
        });
      }
    } catch (err) {
      showResult(false, '网络错误: 无法连接到服务器');
      appendLog('error', '✖ 请求失败: ' + err.message);
      addHistory(acct.name, currentStep, false);
    }

    this.querySelector('.btn-text').textContent = origText;
    this.disabled = false;
  });
});

// ====== 清空日志 ======
document.addEventListener('DOMContentLoaded', function() {
  const clearBtn = document.getElementById('clearLogBtn');
  if (clearBtn) {
    clearBtn.addEventListener('click', function() {
      document.getElementById('logContent').innerHTML = '<span class="log-prompt">></span> <span class="log-line">系统就绪，等待执行...</span>';
    });
  }
});

// ====== 账号列表渲染 ======
function renderAccountList() {
  const list = document.getElementById('accountList');
  if (!list) return;
  if (accounts.length === 0) {
    list.innerHTML = '<p class="history-empty">还没有账号，快添加一个吧</p>';
    return;
  }
  list.innerHTML = accounts.map((acct, i) => `
    <div class="account-item" data-index="${i}">
      <div class="info">
        <div>
          <span class="name">${acct.name}</span>
          ${acct.is_active ? '<span class="active-badge">当前</span>' : ''}
          <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">${acct.user}</div>
        </div>
      </div>
      <div class="actions">
        <button class="btn-sm" onclick="useAccount(${i})">使用</button>
        <button class="btn-sm" onclick="renameAccount(${i})">重命名</button>
        <button class="btn-sm danger" onclick="deleteAccount(${i})">删除</button>
      </div>
    </div>
  `).join('');
}

function updateAccountSelect() {
  const select = document.getElementById('accountSelect');
  if (!select) return;
  select.innerHTML = '<option value="" disabled selected>— 请选择账号 —</option>';
  accounts.forEach((acct, i) => {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = acct.name + ' (' + acct.user + ')';
    if (acct.is_active) opt.selected = true;
    select.appendChild(opt);
  });
  if (accounts.length === 0) {
    select.innerHTML = '<option value="" disabled selected>暂无账号，请先添加</option>';
  }
}

// 使用账号
window.useAccount = function(idx) {
  accounts.forEach(a => a.is_active = false);
  accounts[idx].is_active = true;
  saveAccounts();
  renderAccountList();
  updateAccountSelect();
  appendLog('success', '✔ 已切换至: ' + accounts[idx].name);
};

// 重命名账号
window.renameAccount = function(idx) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-card">
      <h3>重命名账号</h3>
      <input type="text" id="renameInput" value="${accounts[idx].name}" placeholder="输入新名称">
      <div class="modal-actions">
        <button class="modal-cancel" id="renameCancel">取消</button>
        <button class="modal-confirm" id="renameConfirm">确认</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const input = overlay.querySelector('#renameInput');
  input.focus();
  input.select();

  overlay.querySelector('#renameCancel').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#renameConfirm').addEventListener('click', () => {
    const newName = input.value.trim();
    if (newName) {
      accounts[idx].name = newName;
      saveAccounts();
      renderAccountList();
      updateAccountSelect();
      appendLog('success', '✔ 已重命名为: ' + newName);
    }
    overlay.remove();
  });

  input.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') overlay.querySelector('#renameConfirm').click();
    if (e.key === 'Escape') overlay.remove();
  });

  overlay.addEventListener('click', function(e) {
    if (e.target === overlay) overlay.remove();
  });
};

// 删除账号
window.deleteAccount = function(idx) {
  if (!confirm('确认删除账号 ' + accounts[idx].name + ' 吗？')) return;
  accounts.splice(idx, 1);
  saveAccounts();
  renderAccountList();
  updateAccountSelect();
  appendLog('success', '✔ 账号已删除');
};

// ====== 添加账号 ======
document.addEventListener('DOMContentLoaded', function() {
  const addBtn = document.getElementById('addAccountBtn');
  if (!addBtn) return;

  addBtn.addEventListener('click', function() {
    const user = document.getElementById('newUser').value.trim();
    const pass = document.getElementById('newPass').value.trim();
    if (!user || !pass) {
      appendLog('error', '✖ 请填写完整的账号和密码');
      return;
    }

    const name = desensitize(user);
    accounts.push({ name, user, password: pass, is_active: false });
    saveAccounts();
    renderAccountList();
    updateAccountSelect();
    document.getElementById('newUser').value = '';
    document.getElementById('newPass').value = '';
    appendLog('success', '✔ 账号已添加: ' + name);
  });

  // Enter 快捷提交
  document.getElementById('newPass').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') addBtn.click();
  });
});

// ====== 启动 ======
document.addEventListener('DOMContentLoaded', init);
