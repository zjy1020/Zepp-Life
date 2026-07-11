const WORKER_URL = 'https://stepwong-api.3255962845.workers.dev';
const STORAGE_KEY = 'stepwong_accounts';
const HISTORY_KEY = 'stepwong_history';
const THEME_KEY = 'stepwong_theme';
const CLASH_SUB_KEY = 'stepwong_clash_sub';

let accounts = [];
let stepHistory = [];
let currentStep = 1;

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

function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    stepHistory = raw ? JSON.parse(raw) : [];
  } catch(e) { stepHistory = []; }
}

function saveHistory() {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(stepHistory));
}

function addHistory(accountName, steps, success) {
  stepHistory.unshift({
    account: accountName,
    steps: steps,
    time: Date.now(),
    success: !!success
  });
  if (stepHistory.length > 10) stepHistory = stepHistory.slice(0, 10);
  saveHistory();
  renderHistory();
}

function renderHistory() {
  const el = document.getElementById('historyList');
  if (!el) return;
  if (stepHistory.length === 0) {
    el.innerHTML = '<p class="history-empty">还没有提交记录</p>';
    document.getElementById('chartContainer').classList.add('hidden');
    return;
  }
  el.innerHTML = stepHistory.map(h => {
    const date = new Date(h.time);
    const timeStr = date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    return `<div class="history-item">
      <span class="h-account">${h.account}</span>
      <span class="h-step">${Number(h.steps).toLocaleString()} 步</span>
      <span class="h-time">${timeStr}</span>
    </div>`;
  }).join('');
  renderChart();
}

function renderChart() {
  const svg = document.getElementById('stepChart');
  const container = document.getElementById('chartContainer');
  if (!svg || !container) return;
  if (stepHistory.length < 2) { container.classList.add('hidden'); return; }
  container.classList.remove('hidden');

  const W = 340, H = 160, PAD = { top: 18, right: 10, bottom: 28, left: 44 };
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const data = stepHistory.slice(0, 10).map(h => h.steps);
  const max = Math.max(...data, 1);
  const niceMax = Math.ceil(max / 5000) * 5000 || 5000;

  let points = '';
  data.forEach((s, i) => {
    const x = PAD.left + (i / (data.length - 1)) * plotW;
    const y = PAD.top + (1 - s / niceMax) * plotH;
    points += `${x.toFixed(1)},${y.toFixed(1)} `;
  });

  const gridLines = [0, 0.25, 0.5, 0.75, 1];
  const gridHTML = gridLines.map(f => {
    const y = PAD.top + f * plotH;
    const val = Math.round(niceMax * (1 - f));
    return `<line x1="${PAD.left}" y1="${y}" x2="${W - PAD.right}" y2="${y}" stroke="var(--border)" stroke-width="0.5" stroke-dasharray="3,3"/>
      <text x="${PAD.left - 4}" y="${y + 3}" text-anchor="end" fill="var(--text-muted)" font-size="8">${val.toLocaleString()}</text>`;
  }).join('');

  const pointDots = data.map((s, i) => {
    const x = PAD.left + (i / (data.length - 1)) * plotW;
    const y = PAD.top + (1 - s / niceMax) * plotH;
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" fill="var(--primary)" stroke="var(--surface)" stroke-width="1.5">
      <title>${s.toLocaleString()} 步</title></circle>`;
  }).join('');

  const timeLabels = stepHistory.slice(0, 10).reverse().map((h, i) => {
    const x = PAD.left + (i / (Math.min(data.length, 10) - 1)) * plotW;
    const d = new Date(h.time);
    const label = `${d.getMonth() + 1}/${d.getDate()}`;
    return `<text x="${x.toFixed(1)}" y="${H - 4}" text-anchor="middle" fill="var(--text-muted)" font-size="7">${label}</text>`;
  }).join('');

  svg.innerHTML = gridHTML + `
    <polyline points="${points.trim()}" fill="none" stroke="var(--primary)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    <polyline points="${points.trim()}" fill="none" stroke="var(--primary)" stroke-width="6" stroke-linejoin="round" stroke-linecap="round" opacity="0.12"/>
    <g>${pointDots}</g>
    <g>${timeLabels}</g>
  `;
}

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

function updateStepDisplay(val) {
  currentStep = parseInt(val) || 0;
  const display = document.getElementById('stepNumber');
  if (display) display.textContent = Number(currentStep).toLocaleString();
}

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

    const slider = document.getElementById('stepSlider');
    slider.value = val;
    updateStepDisplay(val);
    syncPresets(val);

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

async function clashStart() {
  try {
    if (window.Capacitor?.Plugins?.ClashControl) {
      await Capacitor.Plugins.ClashControl.startClash();
      return true;
    }
  } catch(e) {
    appendLog('error', '✖ Clash 启动失败: ' + (e.message || e));
  }
  return false;
}

async function clashStop() {
  try {
    if (window.Capacitor?.Plugins?.ClashControl) {
      await Capacitor.Plugins.ClashControl.stopClash();
      return true;
    }
  } catch(e) {}
  return false;
}

document.addEventListener('DOMContentLoaded', function() {
  const slider = document.getElementById('stepSlider');
  if (slider) {
    slider.addEventListener('input', function() {
      updateStepDisplay(parseInt(this.value) || 0);
      syncPresets(parseInt(this.value));
      const inputEl = document.getElementById('stepInput');
      const numberEl = document.getElementById('stepNumber');
      if (!inputEl.classList.contains('hidden')) {
        inputEl.classList.add('hidden');
        numberEl.classList.remove('hidden');
        document.getElementById('stepHint').textContent = '👆 点击数字手动输入';
      }
    });
  }

  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', function() {
      document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
      this.classList.add('active');

      let val = this.dataset.step;
      if (val === 'random') {
        const latest = stepHistory.length > 0 ? stepHistory[0].steps : null;
        if (latest) {
          const max = Math.min(98800, latest + 1000);
          val = Math.floor(Math.random() * (max - latest + 1)) + latest;
        } else {
          val = Math.floor(Math.random() * 98800) + 1;
        }
      } else {
        val = parseInt(val);
      }
      const slider = document.getElementById('stepSlider');
      slider.value = val;
      updateStepDisplay(val);

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

function restoreSlider(val) {
  const slider = document.getElementById('stepSlider');
  const display = document.getElementById('stepNumber');
  slider.value = val;
  display.textContent = Number(val).toLocaleString();
  currentStep = val;
}

function appendLog(type, text) {
  const log = document.getElementById('logContent');
  log.innerHTML += '<span class="log-prompt">></span> <span class="log-line ' + type + '">' + text + '</span><br>';
  log.scrollTop = log.scrollHeight;
}

function haptic(type) {
  if (!navigator.vibrate) return;
  if (type === 'success') navigator.vibrate(30);
  else navigator.vibrate([60, 30, 60]);
}

function showResult(success, msg) {
  const banner = document.getElementById('resultBanner');
  const icon = document.getElementById('resultIcon');
  const msgEl = document.getElementById('resultMsg');
  banner.classList.remove('error');
  if (!success) banner.classList.add('error');
  icon.textContent = success ? '✓' : '✕';
  msgEl.textContent = msg;
  banner.classList.remove('hidden');

  haptic(success ? 'success' : 'error');
  if (success) spawnConfetti();
}

function hideResult() {
  document.getElementById('resultBanner').classList.add('hidden');
}

function spawnConfetti() {
  const container = document.createElement('div');
  container.className = 'confetti-container';
  const colors = ['#E11D48', '#BE123C', '#FDA4AF', '#FB7185', '#FECDD3', '#4C0519'];
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
    const lockedStep = currentStep;
    const slider = document.getElementById('stepSlider');
    slider.disabled = true;
    document.querySelectorAll('.preset-btn').forEach(b => b.disabled = true);

    const clashStarted = await clashStart();
    if (clashStarted) appendLog('line', '   · Clash 代理已自动开启');

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
        if (clashStarted) { await clashStop(); appendLog('line', '   · Clash 代理已自动关闭'); }
        restoreSlider(lockedStep);
        this.querySelector('.btn-text').textContent = origText;
        slider.disabled = false;
        document.querySelectorAll('.preset-btn').forEach(b => b.disabled = false);
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

    if (clashStarted) { await clashStop(); appendLog('line', '   · Clash 代理已自动关闭'); }
    restoreSlider(lockedStep);
    this.querySelector('.btn-text').textContent = origText;
    slider.disabled = false;
    document.querySelectorAll('.preset-btn').forEach(b => b.disabled = false);
    this.disabled = false;
  });
});

document.addEventListener('DOMContentLoaded', function() {
  const clearBtn = document.getElementById('clearLogBtn');
  if (clearBtn) {
    clearBtn.addEventListener('click', function() {
      document.getElementById('logContent').innerHTML = '<span class="log-prompt">></span> <span class="log-line">系统就绪，等待执行...</span>';
    });
  }
});

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

window.useAccount = function(idx) {
  accounts.forEach(a => a.is_active = false);
  accounts[idx].is_active = true;
  saveAccounts();
  renderAccountList();
  updateAccountSelect();
  appendLog('success', '✔ 已切换至: ' + accounts[idx].name);
};

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

window.deleteAccount = function(idx) {
  if (!confirm('确认删除账号 ' + accounts[idx].name + ' 吗？')) return;
  accounts.splice(idx, 1);
  saveAccounts();
  renderAccountList();
  updateAccountSelect();
  appendLog('success', '✔ 账号已删除');
};

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

  document.getElementById('newPass').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') addBtn.click();
  });
});

document.addEventListener('DOMContentLoaded', init);

function simpleMarkdown(md) {
  let html = md
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (m, alt, src) => {
      const fixedSrc = src.startsWith('images/') ? 'tutorial/' + src : src;
      return `<img src="${fixedSrc}" alt="${alt}" loading="lazy">`;
    })
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
  overlay.classList.remove('hidden');

  if (body.dataset.loaded) return;

  try {
    const resp = await fetch('tutorial/Zepp修改微信步数教学.md');
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const md = await resp.text();
    body.innerHTML = simpleMarkdown(md);
    body.dataset.loaded = '1';
  } catch (err) {
    body.innerHTML = '<p style="text-align:center;color:#ef4444;padding:40px 0;">加载失败: ' + err.message + '</p>';
  }
}

function closeTutorial() {
  document.getElementById('tutorialOverlay').classList.add('hidden');
}

document.addEventListener('DOMContentLoaded', function() {
  const openBtn = document.getElementById('tutorialBtn');
  const closeBtn = document.getElementById('tutorialClose');
  const overlay = document.getElementById('tutorialOverlay');

  if (openBtn) openBtn.addEventListener('click', openTutorial);
  if (closeBtn) closeBtn.addEventListener('click', closeTutorial);
  if (overlay) overlay.addEventListener('click', function(e) {
    if (e.target === overlay) closeTutorial();
  });
});

document.addEventListener('DOMContentLoaded', function() {
  const subInput = document.getElementById('clashSubUrl');
  const saveBtn = document.getElementById('saveSubBtn');
  const copyBtn = document.getElementById('copySubBtn');
  const testBtn = document.getElementById('testClashBtn');

  if (subInput) {
    subInput.value = localStorage.getItem(CLASH_SUB_KEY) || '';
  }

  if (saveBtn) {
    saveBtn.addEventListener('click', function() {
      const val = subInput.value.trim();
      if (!val) { appendLog('error', '✖ 请输入订阅链接'); return; }
      localStorage.setItem(CLASH_SUB_KEY, val);
      appendLog('success', '✔ 订阅链接已保存');
    });
  }

  if (copyBtn) {
    copyBtn.addEventListener('click', async function() {
      const url = localStorage.getItem(CLASH_SUB_KEY) || '';
      if (!url) { appendLog('error', '✖ 请先保存订阅链接'); return; }
      try {
        await navigator.clipboard.writeText(url);
        appendLog('success', '✔ 订阅链接已复制，请打开 Clash Meta 手动导入');
      } catch(e) {
        appendLog('error', '✖ 复制失败');
      }
    });
  }

  if (testBtn) {
    testBtn.addEventListener('click', async function() {
      appendLog('info', '--- Clash 诊断开始 ---');
      appendLog('line', '   · window.Capacitor: ' + (typeof window.Capacitor !== 'undefined' ? '存在' : '未定义'));
      if (window.Capacitor) {
        appendLog('line', '   · Capacitor.Plugins: ' + (window.Capacitor.Plugins ? '存在' : '未定义'));
        appendLog('line', '   · 已注册插件: ' + (window.Capacitor.Plugins ? Object.keys(window.Capacitor.Plugins).join(', ') : '无'));
        if (window.Capacitor.Plugins?.ClashControl) {
          appendLog('line', '   · ClashControl 插件: 存在');
          try {
            await Capacitor.Plugins.ClashControl.startClash();
            appendLog('success', '✔ START_CLASH Intent 已发送 (如 VPN 未启动请检查 CMFA)');
          } catch(e) {
            appendLog('error', '✖ 调用 startClash 失败: ' + e.message);
          }
        } else {
          appendLog('error', '✖ ClashControl 插件未注册！检查 APK 是否包含插件');
          appendLog('line', '   · 若 APK 未更新，请重新构建');
        }
      }
      appendLog('info', '--- 诊断结束 ---');
    });
  }
});
