# -*- coding: utf8 -*-
import json
import os
import sys
import traceback
import uuid

from flask import Flask, render_template, jsonify, request

# 添加 stepwong 路径并导入
STEPWONG_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'stepwong'))
sys.path.insert(0, STEPWONG_DIR)

# 尝试导入真实的 MiMotionRunner
USE_REAL_RUNNER = False
try:
    import main as _stepwong
    _stepwong.user_tokens = {}
    _stepwong.aes_key = None
    _stepwong.encrypt_support = False
    _stepwong.config = {}
    _stepwong.time_bj = _stepwong.get_beijing_time()
    MiMotionRunner = _stepwong.MiMotionRunner
    USE_REAL_RUNNER = True
    print('[*] 使用真实 Zepp Life API')
except Exception as e:
    print(f'[*] 未加载真实API (使用模拟模式): {e}')

app = Flask(__name__)
app.secret_key = os.urandom(24).hex()

ACCOUNTS_FILE = os.path.join(os.path.dirname(__file__), 'accounts.json')
MIN_STEP = 1
MAX_STEP = 98800


def load_accounts():
    if not os.path.exists(ACCOUNTS_FILE):
        return []
    try:
        with open(ACCOUNTS_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return []


def save_accounts(accounts):
    with open(ACCOUNTS_FILE, 'w', encoding='utf-8') as f:
        json.dump(accounts, f, ensure_ascii=False, indent=2)


def desensitize(user):
    u = str(user)
    if len(u) <= 8:
        ln = max(len(u) // 3, 1)
        return f'{u[:ln]}***{u[-ln:]}'
    return f'{u[:3]}****{u[-4:]}'


# 全局错误处理 — 确保 API 永远返回 JSON
@app.errorhandler(404)
def not_found(e):
    return jsonify({'success': False, 'message': '接口不存在'}), 404

@app.errorhandler(500)
def server_error(e):
    return jsonify({'success': False, 'message': f'服务器错误: {str(e)}'}), 500


# ====== 路由 ======

@app.route('/')
def index():
    accounts = load_accounts()
    return render_template('index.html', accounts=accounts)


@app.route('/api/accounts', methods=['GET'])
def get_accounts():
    return jsonify({'success': True, 'accounts': load_accounts()})


@app.route('/api/accounts', methods=['POST'])
def add_account():
    try:
        data = request.get_json(force=True)
    except Exception:
        return jsonify({'success': False, 'message': '请求数据格式错误'})
    user = data.get('user', '').strip()
    password = data.get('password', '').strip()
    if not user or not password:
        return jsonify({'success': False, 'message': '账号和密码不能为空'})
    accounts = load_accounts()
    accounts.append({'name': desensitize(user), 'user': user, 'password': password, 'is_active': False})
    save_accounts(accounts)
    return jsonify({'success': True, 'name': desensitize(user), 'message': f'账号 {desensitize(user)} 已添加'})


@app.route('/api/accounts/<int:idx>', methods=['DELETE'])
def delete_account(idx):
    accounts = load_accounts()
    if idx < 0 or idx >= len(accounts):
        return jsonify({'success': False, 'message': '账号不存在'})
    removed = accounts.pop(idx)
    save_accounts(accounts)
    return jsonify({'success': True, 'message': f'账号 {removed["name"]} 已删除'})


@app.route('/api/accounts/use', methods=['POST'])
def use_account():
    try:
        data = request.get_json(force=True)
    except Exception:
        return jsonify({'success': False, 'message': '请求数据格式错误'})
    idx = data.get('account_idx')
    accounts = load_accounts()
    if idx is None or idx < 0 or idx >= len(accounts):
        return jsonify({'success': False, 'message': '账号不存在'})
    for i, acct in enumerate(accounts):
        acct['is_active'] = (i == idx)
    save_accounts(accounts)
    return jsonify({'success': True, 'message': f'已切换至 {accounts[idx]["name"]}'})


@app.route('/api/update', methods=['POST'])
def update_steps():
    print(f'[DEBUG] /api/update called, USE_REAL_RUNNER={USE_REAL_RUNNER}')
    # 解析请求
    try:
        data = request.get_json(force=True)
        print(f'[DEBUG] data received: account_idx={data.get("account_idx")}, steps={data.get("steps")}')
    except Exception as e:
        print(f'[DEBUG] JSON parse error: {e}')
        return jsonify({'success': False, 'message': '请求数据格式错误'})

    account_idx = data.get('account_idx')
    try:
        steps = int(data.get('steps', 25000))
    except (ValueError, TypeError):
        return jsonify({'success': False, 'message': '步数格式错误'})

    if steps < MIN_STEP or steps > MAX_STEP:
        return jsonify({'success': False, 'message': f'步数范围: {MIN_STEP}~{MAX_STEP}'})

    accounts = load_accounts()
    if account_idx is None or account_idx < 0 or account_idx >= len(accounts):
        return jsonify({'success': False, 'message': '账号不存在'})

    acct = accounts[account_idx]

    if USE_REAL_RUNNER:
        try:
            runner = MiMotionRunner(acct['user'], acct['password'])
            msg, success = runner.login_and_post_step(steps, steps)
            log_text = runner.log_str if hasattr(runner, 'log_str') else ''
            if success:
                return jsonify({'success': True, 'message': f'修改成功！当前步数: {steps}', 'log': log_text})
            else:
                return jsonify({'success': False, 'message': msg, 'log': log_text})
        except Exception as e:
            return jsonify({'success': False, 'message': str(e), 'log': traceback.format_exc()})
    else:
        # 模拟模式
        log_lines = (
            f'初始化 Runner 完成\n'
            f'设备ID:{uuid.uuid4()}\n'
            f'[模拟] 登录 Zepp Life...\n'
            f'[模拟] 登录成功\n'
            f'[模拟] 获取 app_token...\n'
            f'[模拟] 修改步数 ({steps}) 成功\n'
        )
        return jsonify({'success': True, 'message': f'[模拟] 修改成功！步数: {steps}', 'log': log_lines})


if __name__ == '__main__':
    port = 5800
    print(f'[*] StepWong Web 启动: http://127.0.0.1:{port}')
    print(f'[*] 模式: {"真实 Zepp Life API" if USE_REAL_RUNNER else "模拟模式"}')
    print('[*] 浏览器打开 http://127.0.0.1:5800 使用')
    app.run(host='127.0.0.1', port=port, debug=False)
