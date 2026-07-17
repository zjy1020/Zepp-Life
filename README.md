# Y子步数

Zepp Life（原小米运动）步数更新工具。项目提供网页/PWA 和 GitHub Actions 自动打包 APK，适合手机直接使用。

🌐 **在线使用**: https://zjy1020.github.io/Zepp-Life/

> 手机电脑均可打开；Android 用户也可以下载 Actions 构建出的 APK。

---

## 功能亮点

- **动态步数上限** — 默认基准为 `1`，本次最高 `基准 + 1000`；刷步成功后下次打开会沿用上次成功步数继续递增。
- **智能快捷操作** — 支持 `+200` / `+500` / `+1000`、基准、最高、随机和重置，不再展示无效的大步数预设。
- **多账号管理** — 添加、删除、重命名 Zepp Life 账号，一键切换当前账号。
- **账号成功记录** — 账号卡片显示该账号上次成功步数和时间。
- **最近记录图表** — 最近 10 次记录支持趋势折线图和步数分布柱形图。
- **一键提交** — 调用 Cloudflare Worker API 更新步数，实时日志反馈。
- **本地持久化** — 账号、历史记录、主题、当前步数都会保存到本地；APK 关闭后再次打开仍会保留。
- **深色模式** — 支持亮色/深色主题切换。
- **微信绑定教学** — 右上角教程入口查看 Zepp 绑定微信步数说明。

## 使用说明

1. 打开网页或 APK。
2. 切换到「账号」页，添加 Zepp Life 账号（手机号/邮箱 + 密码）。
3. 回到「步数」页，选择账号。
4. 使用滑条、`+200/+500/+1000` 或智能快捷设置步数。
5. 点击「开始刷步」提交。

### 步数规则

- 新用户或无记录时：默认步数 `1`，最高只能设置到 `1001`。
- 如果上次成功刷到 `1020`：下次打开显示 `1020`，最高可设置到 `2020`。
- 成功记录会保存到本地，除非卸载 APK 或清除应用数据。

## GitHub Actions 构建 APK

仓库已配置 `.github/workflows/build-apk.yml`：

- 推送到 `main` 分支会自动触发 `Build APK`。
- 也可以在 GitHub Actions 页面手动运行 `workflow_dispatch`。
- 构建完成后，在本次 workflow 的 Artifacts 中下载 `Y子步数` APK。

构建流程包含：

- Node.js 22
- Java 21
- Capacitor Android 初始化与同步
- ImageMagick 生成 Android 图标
- Gradle `assembleDebug`
- 上传 APK Artifact

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | 原生 HTML + CSS + JavaScript |
| 移动端 | Capacitor 8 + Android |
| API 层 | Cloudflare Worker |
| 底层接口 | [redgreat/stepwong](https://github.com/redgreat/stepwong) |
| 自动构建 | GitHub Actions |
| 设计风格 | Candy Glass / Claymorphism |

## 项目结构

```text
Zepp-Life/
├── .github/workflows/build-apk.yml  # GitHub Actions APK 构建
├── capacitor.config.json            # Capacitor 配置
├── index.html                       # 主页面
├── package.json                     # Capacitor 依赖与脚本
├── static/
│   ├── css/style.css                # 页面样式
│   ├── js/app.js                    # 前端交互逻辑
│   └── images/                      # 图片资源
├── tutorial/                        # 微信步数绑定教程
├── worker/                          # Cloudflare Worker
├── clash-plugin/                    # Android Clash 控制插件
└── docs/                            # 接口与项目文档
```

## 本地开发

前端是静态页面，直接打开 `index.html` 即可预览。

安装依赖：

```bash
npm ci
```

同步 Capacitor：

```bash
npm run build
```

本地构建 APK（需要 Android/Gradle 环境）：

```bash
npm run build:apk
```

## Cloudflare Worker

```bash
npx wrangler deploy worker/index.js
```

需先配置 Cloudflare 认证：

```bash
npx wrangler login
```

## 注意事项

- 需要 Zepp Life 账号，且账号已完成微信步数绑定。
- 本项目仅保存到浏览器或 APK 本地存储，卸载应用或清除数据会丢失本地记录。
- 请合理设置步数，避免异常频繁提交。

---

Made by [zjy1020](https://github.com/zjy1020)
