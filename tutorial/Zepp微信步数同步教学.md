# Zepp Life 微信步数同步教学

## 1. 下载并安装 Zepp Life

![](images/Pasted%20image%2020260616193355.png)

手机下载 Zepp Life（原小米运动）App。应用商店搜不到的话用浏览器下载。

---

## 2. 登录账号

![](images/Pasted%20image%2020260616193439.png)

进入 App 后，点击右上角的「人物」图标。

![](images/Pasted%20image%2020260616193509.png)

点击「立即登录」。没有账号就注册一个，推荐用邮箱注册。**账号和密码一定要记好**，后面同步步数的时候要用。

---

## 3. 绑定微信

![](images/Pasted%20image%2020260616193649.png)

登录后回到「我的」页面，点击「第三方账户绑定」。

![](images/Pasted%20image%2020260616193710.png)

找到微信，点击进入。

![](images/Pasted%20image%2020260616193736.png)

点击「上传步数到微信」右侧的「未绑定」。

![](images/Pasted%20image%2020260616193811.png)

会弹出一个二维码，用想同步步数的微信扫码。

![](images/Pasted%20image%2020260616193859.png)

扫码后关注 **amazfit 华米** 服务号，点击绑定设备即可。

> **取消绑定**：取消关注该服务号即可停止同步步数。

---

## 4. 开始同步步数

完成以上绑定后，打开步数同步工具，用刚才的 Zepp Life 账号密码登录，设置步数提交即可。

> 步数上限 98,800，不要超过。

### 在线版

- **主用**：https://lby0626.github.io/Zepp-Life/
- **备用**：https://zjy1020.github.io/Zepp-Life/

### 本地版（需 Python 环境）

下载 `flask` 分支的代码，双击 `start.bat` 运行（会自动安装依赖）：
- https://github.com/lby0626/Zepp-Life/tree/flask
- https://github.com/zjy1020/Zepp-Life/tree/flask

手动安装依赖：
```bash
pip install flask requests pycryptodome
```

### 研究接口

项目仓库内有完整的 Zepp Life API 接口文档（AES 加密、登录流程、提交步数等），想深入研究可以查看：

- **GitHub 仓库**：https://github.com/lby0626/Zepp-Life
- **接口文档路径**：`docs/zepp-life-api.md`（后续可能不会更新了）
