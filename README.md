# Y子步数

Zepp Life（原小米运动）步数修改的在线工具。Claymorphism 卡通风格，支持多账号管理、步数预设/手动输入、一键提交。

🌐 **在线使用**: https://zjy1020.github.io/Zepp-Life/

> 手机电脑均可打开，无需本地运行。

---

## 功能

- **步数控制** — 预设按钮（3K / 8K / 25K / 50K / 随机）、滑块微调（1 ~ 98,800）、点击数字手动输入
- **多账号管理** — 添加/删除/重命名 Zepp Life 账号，一键切换
- **一键提交** — 调用 Zepp Life 真实 API 修改步数，实时日志反馈
- **深色模式** — 🌙/☀️ 一键切换，自动保存偏好
- **最近记录** — 显示最近 10 次提交历史
- **成功彩纸** — 修改成功触发庆祝动画

## 快速开始

打开 https://zjy1020.github.io/Zepp-Life/ 即可使用。

1. 切换到「账号」tab，添加你的 Zepp Life 账号（手机号/邮箱 + 密码）
2. 切换到「步数」tab，选择账号，设置步数
3. 点击「开始刷步」提交

> 需要 Zepp Life 账号，且账号必须绑定过小米运动设备。
> 步数上限 98,800，超过会被服务器拒绝。

## 技术栈

| 层 | 技术 |
|---|---|
| **前端** | 原生 HTML + CSS + JavaScript |
| **API 层** | Cloudflare Workers (免费计划) |
| **底层** | [redgreat/stepwong](https://github.com/redgreat/stepwong) — Zepp Life 内部 API |
| **设计** | Claymorphism 卡通风格 · Nunito + DM Sans 字体 |
| **部署** | GitHub Pages（页面）+ Cloudflare Workers（API 代理） |

## 架构

```
用户 → GitHub Pages（静态页面）→ Cloudflare Workers（API 代理）→ Zepp Life API
```

两个服务均为免费计划，手机直接打开网址即可使用。

## 项目结构

```
stepwong-web/
├── index.html              # 主页面（静态）
├── wrangler.toml           # Worker 部署配置
├── worker/
│   └── index.js            # Cloudflare Worker（API 代理）
├── static/
│   ├── css/
│   │   └── style.css       # Claymorphism 样式
│   ├── js/
│   │   └── app.js          # 前端交互逻辑
│   └── images/
│       ├── Y.png           # 应用图标
│       ├── bg.png          # 背景壁纸
│       └── github-fill.png # GitHub 跳转图标
```

## 分支

| 分支 | 说明 |
|------|------|
| `main` | **新版** — Cloudflare Workers + GitHub Pages 在线版 |
| `flask` | **旧版** — Python Flask 本地运行版（`git switch flask`） |

## 开发

### 前端

直接修改 `index.html` / `static/css/style.css` / `static/js/app.js` 即可，浏览器刷新即时生效。

### Worker

```bash
npx wrangler deploy worker/index.js
```

需先配置 Cloudflare 认证（`npx wrangler login`）。

## 接口文档

完整的 Zepp Life API 调用流程（AES 加密、登录、获取 token、提交步数）见 [`docs/zepp-life-api.md`](docs/zepp-life-api.md)。

## 历史

本项目的 v1 版本为本地 Python Flask 应用（见 `flask` 分支），v2 迁移至 Serverless 架构实现全在线使用。

---

Made by [zjy1020](https://github.com/zjy1020)
