# 动动吧

Zepp Life（原小米运动）步数更新工具。提供网页版与 Android APK 两种用法，APK 内置本地同步器，**不经过任何第三方服务器**。

---

## 下载 APK

前往 **[Releases](https://github.com/zjy1020/Zepp-Life/releases/latest)** 下载最新的
`DongDongBa-vX.Y.Z.apk`，直接安装即可（首次安装需在系统设置里允许「安装未知来源应用」）。

- 包名 `com.zepplife.steps`，debug 签名；后续版本可直接覆盖安装
- 应用内可查看当前版本号；启动时会自动检查是否有新版本，也可在「日志」页手动点「检查更新」

> 网页版需要用浏览器打开 `index.html`。仓库未启用 GitHub Pages，所以没有现成的在线地址。

---

## 功能

### 刷步

- **本地直连** — APK 内置同步器直接与华米接口通信，不依赖 Cloudflare Worker，也不经过任何中转
- **动态步数上限** — 基准为上次成功步数，本次最高 `基准 + 1000`；手动输入不受此限制（上限 98,800）
- **随机步数** — 在「基准 ~ 基准+1000」之间随机取一个值
- **令牌缓存** — 登录令牌按账号缓存 12 小时，命中时跳过登录三步，请求量从 4 个降到 1 个
- **提交冷却** — 两次提交间隔至少 60 秒，避免短时间连发触发服务端限流（HTTP 429）
- **每日清零** — 跨过自然日后，步数基准与上限自动归零；页面开着跨零点也会即时归零

### 账号与记录

- **多账号管理** — 添加、删除、重命名、一键切换当前账号
- **最近记录** — 当天记录按时间倒序展示；跨天时自动归档，历史按日期分组保留 30 天
- **本地持久化** — 账号、记录、主题、当前步数、登录令牌均保存在本地

### 排障

- **执行日志** — 每条带时间戳；同步器内部步骤带 `[+耗时]` 前缀与每步 HTTP 状态码，结尾汇总请求数与总耗时
- **日志持久化与复制** — 日志跨会话保留（上限 400 行），可一键复制文本
- **版本与更新检查** — 页脚显示当前版本与同步模式；启动时自动检查，也可手动触发

### 其他

- **深色模式** — 亮色/深色主题切换
- **微信绑定教学** — 右上角教程入口

---

## 使用说明

1. 打开应用，切到「账号」页，添加 Zepp Life 账号（手机号 / 邮箱 + 密码）。
2. 回到「步数」页，选择账号。
3. 用滑条、随机按钮或点数字手动输入步数。
4. 点「执行步数」提交。

### 步数规则

- 新用户或无记录时：默认 `1`，最高只能设置到 `1,001`。
- 若上次成功刷到 `1,020`：下次打开显示 `1,020`，最高可设置到 `2,020`。
- 想一次设置更大的值，点数字手动输入即可（不受动态上限限制）。

### 关于凌晨 0-8 点

「凌晨 0-8 点禁止刷步」是**网页通道（Cloudflare Worker）**的限制，**APK 本地直连不受影响**。
因此该提示只在网页模式下显示。

---

## 构建

### GitHub Actions（推荐）

推送到 `main` 分支会自动触发 `Build APK`，也可在 Actions 页面手动 `workflow_dispatch`。
约 3 分钟完成，产物在本次 workflow 的 Artifacts 中（`动动吧`）。

构建流程包含：Node.js 22 · Java 21 · Capacitor Android 初始化与同步 ·
ImageMagick 生成各密度图标 · Gradle `assembleDebug` · 上传 Artifact。

### 本地构建

```bash
npm ci          # 安装依赖
npm run build   # 同步 Capacitor 资源
npm run build:apk   # 本地打包（需已安装 Android SDK 与 Gradle）
```

前端是静态页面，不装 Android 环境时直接打开 `index.html` 也能预览网页版。

### 测试

```bash
node --test
```

---

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | 原生 HTML + CSS + JavaScript |
| 移动端 | Capacitor 8 + Android |
| Web 端 API 层 | Cloudflare Worker |
| 底层接口 | [redgreat/stepwong](https://github.com/redgreat/stepwong) |
| 自动构建 | GitHub Actions |
| 设计风格 | 像素风 / Pixel Fresh |

## 项目结构

```text
Zepp-Life/
├── .github/workflows/build-apk.yml   # APK 构建流程
├── capacitor.config.json             # Capacitor 配置
├── index.html                        # 主页面
├── icon.png                          # 启动图标源（构建时生成各密度）
├── package.json
├── static/
│   ├── css/style.css                 # 样式与设计 token
│   ├── js/app.js                     # 前端全部逻辑
│   ├── js/motion.js                  # 零依赖动效内核
│   └── images/                       # 图片资源
├── stepwong-plugin/                  # APK 内置本地同步器（Java + 步数模板）
├── worker/                           # Cloudflare Worker（网页端回退）
├── test/                             # node --test 单元测试
├── tutorial/                         # 微信步数绑定教程
└── docs/                             # 接口与项目文档
```

## Cloudflare Worker（可选）

只有当你在**浏览器里**使用网页版时才需要它——网页端没有 Capacitor 插件，
会回退到 Worker API。APK 用户不需要部署。

```bash
npx wrangler login
npx wrangler deploy worker/index.js
```

---

## 注意事项

- 需要 Zepp Life 账号，且账号已完成微信步数绑定。
- 账号密码保存在**应用本地存储**，卸载应用或清除数据会丢失；本仓库不含任何账号信息。
- 请合理设置步数，避免异常频繁提交；被限流（HTTP 429）时等几分钟或切换网络再试。
- 仅供学习交流，请遵守相关服务条款。

---

Made by [zjy1020](https://github.com/zjy1020)
