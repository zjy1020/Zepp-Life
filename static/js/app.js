// ============================================
// StepWong Web — 前端交互
// ============================================

// --- Tab 切换 ---
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', function() {
    const tab = this.dataset.tab;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    this.classList.add('active');
    document.getElementById('tab-' + tab).classList.add('active');
  });
});

// --- 步数控制 ---
const stepSlider = document.getElementById('stepSlider');
const stepValue = document.getElementById('stepValue');
let currentStep = 25000;

function updateStepDisplay(val) {
  currentStep = val;
  stepValue.textContent = Number(val).toLocaleString();
}

stepSlider.addEventListener('input', function() {
  updateStepDisplay(parseInt(this.value) || 0);
});

document.querySelectorAll('.btn-preset').forEach(btn => {
  btn.addEventListener('click', function() {
    document.querySelectorAll('.btn-preset').forEach(b => b.classList.remove('active'));
    this.classList.add('active');

    let val = this.dataset.step;
    if (val === 'random') {
      val = Math.floor(Math.random() * 98800) + 1;
    } else {
      val = parseInt(val);
    }
    stepSlider.value = val;
    updateStepDisplay(val);
  });
});

// --- 日志 ---
function appendLog(type, text) {
  const log = document.getElementById('logContent');
  log.innerHTML += '<span class="log-prompt">></span> <span class="log-line ' + type + '">' + text + '</span><br>';
  log.scrollTop = log.scrollHeight;
}

// --- 结果显示 ---
function showResult(success, msg) {
  const banner = document.getElementById('resultBanner');
  const icon = document.getElementById('resultIcon');
  const msgEl = document.getElementById('resultMsg');
  banner.classList.remove('error');
  if (!success) banner.classList.add('error');
  icon.textContent = success ? '✔' : '✖';
  msgEl.textContent = msg;
  banner.style.display = 'flex';
}

function hideResult() {
  document.getElementById('resultBanner').style.display = 'none';
}

// --- 提交刷步 ---
document.getElementById('stepForm').addEventListener('submit', async function(e) {
  e.preventDefault();
  hideResult();
  const select = document.getElementById('accountSelect');
  const idx = select.value;

  if (!idx || idx === '') {
    appendLog('error', '✖ 请先选择账号！');
    return;
  }

  const submitBtn = this.querySelector('.btn-primary');
  submitBtn.disabled = true;
  const origText = submitBtn.textContent;
  submitBtn.textContent = '[ 执 行 中 ... ]';

  appendLog('info', '⟳ 正在提交刷步请求...');
  appendLog('line', '   · 步数: ' + currentStep.toLocaleString());

  try {
    const resp = await fetch('http://127.0.0.1:5800/api/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account_idx: parseInt(idx), steps: currentStep })
    });
    const text = await resp.text();
    console.log('Response:', resp.status, text.slice(0, 200));

    let data;
    try { data = JSON.parse(text); } catch(e) {
      showResult(false, '服务器返回了非JSON数据 (状态:' + resp.status + ')');
      appendLog('error', '✖ 服务器返回HTML而非JSON: ' + text.slice(0, 100));
      return;
    }

    if (data.success) {
      showResult(true, '修改成功！步数: ' + currentStep.toLocaleString());
      appendLog('success', '✔ ' + data.message);
    } else {
      showResult(false, data.message || '修改失败');
      appendLog('error', '✖ ' + data.message);
    }

    if (data.log) {
      data.log.split('\n').forEach(line => {
        if (line.trim()) appendLog('line', '   ' + line.trim());
      });
    }
  } catch (err) {
    showResult(false, '网络错误: 无法连接到服务器');
    appendLog('error', '✖ 请求失败: ' + err.message);
  }

  submitBtn.disabled = false;
  submitBtn.textContent = origText;
});

// --- 清空日志 ---
document.getElementById('clearLogBtn').addEventListener('click', function() {
  document.getElementById('logContent').innerHTML = '<span class="log-prompt">></span> <span class="log-line">系统就绪，等待执行...</span><br>';
});

// --- 多账号管理 ---
const accounts = window.__INITIAL_ACCOUNTS || [];

function renderAccountList() {
  const list = document.getElementById('accountList');
  if (accounts.length === 0) {
    list.innerHTML = '<p style="color:var(--text-muted);font-size:13px;text-align:center;padding:24px 0;">＞ 还没有账号，快添加一个吧</p>';
    return;
  }
  list.innerHTML = accounts.map((acct, i) => `
    <div class="account-item" data-index="${i}">
      <div class="info">
        <span class="name">${acct.name}</span>
        ${acct.is_active ? '<span style="color:var(--accent-cyan);font-size:10px;margin-left:8px;">● 当前</span>' : ''}
      </div>
      <div class="actions">
        <button class="btn-sm" onclick="useAccount(${i})">使用</button>
        <button class="btn-sm" onclick="deleteAccount(${i})">删除</button>
      </div>
    </div>
  `).join('');
}

function updateAccountSelect() {
  const select = document.getElementById('accountSelect');
  select.innerHTML = '<option value="" disabled selected>— 请选择账号 —</option>';
  accounts.forEach((acct, i) => {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = acct.name;
    if (acct.is_active) opt.selected = true;
    select.appendChild(opt);
  });
  if (accounts.length === 0) {
    select.innerHTML = '<option value="" disabled selected>暂无账号，请先添加</option>';
  }
}

// 使用账号
window.useAccount = async function(idx) {
  const resp = await fetch('http://127.0.0.1:5800/api/accounts/use', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account_idx: idx })
  });
  const data = await resp.json();
  if (data.success) {
    accounts.forEach(a => a.is_active = false);
    accounts[idx].is_active = true;
    renderAccountList();
    updateAccountSelect();
    appendLog('success', '✔ 已切换至: ' + accounts[idx].name);
  }
};

// 删除账号
window.deleteAccount = async function(idx) {
  if (!confirm('确认删除账号 ' + accounts[idx].name + ' 吗？')) return;
  const resp = await fetch('http://127.0.0.1:5800/api/accounts/' + idx, { method: 'DELETE' });
  const data = await resp.json();
  if (data.success) {
    accounts.splice(idx, 1);
    renderAccountList();
    updateAccountSelect();
    appendLog('success', '✔ 账号已删除');
  }
};

// 添加账号
document.getElementById('addAccountBtn').addEventListener('click', async function() {
  const user = document.getElementById('newUser').value.trim();
  const pass = document.getElementById('newPass').value.trim();
  if (!user || !pass) {
    appendLog('error', '✖ 请填写完整的账号和密码');
    return;
  }

  const resp = await fetch('http://127.0.0.1:5800/api/accounts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user: user, password: pass })
  });
  const data = await resp.json();
  if (data.success) {
    accounts.push({ name: data.name, user: user, password: pass, is_active: false });
    renderAccountList();
    updateAccountSelect();
    document.getElementById('newUser').value = '';
    document.getElementById('newPass').value = '';
    appendLog('success', '✔ 账号已添加: ' + data.name);
  } else {
    appendLog('error', '✖ ' + data.message);
  }
});
