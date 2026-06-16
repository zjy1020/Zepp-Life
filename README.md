# StepWong Web

Zepp Life（原小米运动）步数修改的本地 Web 工具。像素 NES 风格界面，支持多账号管理、步数预设、实时日志。

## 截图

![screenshot](https://img.shields.io/badge/status-working-brightgreen)

## 功能

- 添加 / 管理多个 Zepp Life 账号
- 预设步数（10K / 20K / 30K / 50K / 随机）或滑块自定义（1 ~ 98,800）
- 一键提交刷步（真实 Zepp Life API）
- 实时执行日志
- 无感切换账号

## 快速开始

### 1. 安装依赖

首次使用需要安装 Python 包：

```bash
pip install -r requirements.txt
```

### 2. 启动

双击 `start.bat` 或在终端运行：

```bash
bash start.sh
```

### 3. 使用

浏览器打开 http://127.0.0.1:5800

1. 切换到「账号管理」tab，添加你的 Zepp Life 账号（手机号/邮箱 + 密码）
2. 切换到「步数更新」tab，选择账号，设置步数
3. 点击「动动吧」提交

### 4. 关闭

双击 `stop.bat` 或在终端运行：

```bash
bash stop.sh
```

## 项目结构

```
stepwong-web/
├── app.py              # Flask 后端
├── accounts.json       # 本地存储的账号
├── start.bat / start.sh
├── stop.bat / stop.sh
├── requirements.txt
├── templates/
│   ├── base.html       # 基础模板
│   └── index.html      # 主页面
└── static/
    ├── css/pixel.css   # 像素风样式
    └── js/app.js       # 前端交互
```

## 技术栈

- **后端**: Python Flask
- **前端**: 原生 JavaScript + CSS
- **API**: 底层调用 [redgreat/stepwong](https://github.com/redgreat/stepwong) 的 MiMotionRunner（Zepp Life 内部 API）
- **设计**: NES 像素风格（Press Start 2P 字体、CRT 扫描线、点阵背景）

## 注意

- 需要 Zepp Life（原小米运动）账号，账号必须绑定过小米运动设备
- 步数上限 98,800，超过会被服务器拒绝
- 仅在本地运行，不会上传你的账号信息
