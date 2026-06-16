# Y子步数 — Flask 本地版

Zepp Life（原小米运动）步数修改的本地 Web 工具。Claymorphism 卡通风格，支持多账号管理、步数预设/手动输入、一键提交。

> 此分支为 **v1 本地运行版**，需要电脑开机 + Python 环境。
> 新版在线版（无需下载）见 [`main` 分支](https://github.com/zjy1020/Zepp-Life)。

---

## 功能

- **步数控制** — 预设按钮（3K / 8K / 25K / 50K / 随机）、滑块微调、手动输入
- **多账号管理** — 添加/删除/重命名 Zepp Life 账号，一键切换
- **一键提交** — 调用 Zepp Life 真实 API 修改步数，实时日志反馈
- **深色模式** — 一键切换，自动保存偏好
- **最近记录** — 显示最近提交历史

## 快速开始

### 环境要求

- Python 3.8+
- 双击 `start.bat`（Windows）或运行 `bash start.sh`

### 启动

```bash
# 安装依赖
pip install -r requirements.txt

# 启动服务
python app.py
```

浏览器自动打开 http://127.0.0.1:5800

1. 添加 Zepp Life 账号（手机号/邮箱 + 密码）
2. 选择账号，设置步数
3. 点击「开始刷步」提交

> 需要 Zepp Life 账号，且账号必须绑定过小米运动设备。
> 步数上限 98,800。

## 项目结构

```
├── app.py              # Flask 后端（含完整 Zepp Life API 调用）
├── accounts.json       # 本地存储的账号
├── requirements.txt    # Python 依赖
├── start.bat / start.sh / stop.bat / stop.sh
├── templates/
│   ├── base.html       # 基础模板
│   └── index.html      # 主页面
└── static/
    ├── css/style.css   # Claymorphism 样式
    ├── js/app.js       # 前端交互逻辑
    └── images/         # 图标与壁纸
```

## 技术栈

- **后端**: Python Flask（内置 PyCryptodome AES 加密）
- **前端**: 原生 HTML + CSS + JavaScript
- **API**: Zepp Life 内部接口（四步登录 + 提交步数）
- **设计**: Claymorphism 卡通风格

## 注意

- 第一次启动会自动安装依赖（`pip install`）
- 端口 5800 被占用时启动脚本会自动杀掉旧进程
- 手机访问需在同一 WiFi 下，地址见控制台输出
- 如果 pycryptodome 安装失败，AES 加密无法执行，将不能修改步数

## 接口文档

完整的 Zepp Life API 调用流程（AES 加密、登录、获取 token、提交步数）见 [`docs/zepp-life-api.md`](docs/zepp-life-api.md)。

---

Made by [zjy1020](https://github.com/zjy1020)
