# Zepp Life API 接口文档

## 概述

Zepp Life（原小米运动）步数修改底层调用了小米运动/华米 API 接口。流程分四步：登录加密提交 → 获取 accessToken → 获取 login_token + app_token → 提交步数。

> 本项目的 Worker 端代码见 `worker/index.js`，旧版 Python Flask 端见 `archive/app.py`

---

## 完整调用流程

```
POST 加密参数 → [302 重定向] → 获取 accessToken
    ↓
POST 换取 login_token + user_id
    ↓
GET 换取 app_token
    ↓
POST 提交步数数据
```

---

## 第一步：登录（获取 accessToken）

### 请求

```
POST https://api-user.zepp.com/v2/registrations/tokens
```

### 请求头

```
content-type: application/x-www-form-urlencoded; charset=UTF-8
user-agent: MiFit6.14.0 (M2007J1SC; Android 12; Density/2.75)
app_name: com.xiaomi.hm.health
appname: com.xiaomi.hm.health
appplatform: android_phone
x-hm-ekv: 1
hm-privacy-ceip: false
```

### 请求体（需 AES-128-CBC 加密）

原始参数（加密前）：

```
emailOrPhone={手机号/邮箱}
password={密码}
state=REDIRECTION
client_id=HuaMi
country_code=CN
token=access
redirect_uri=https://s3-us-west-2.amazonaws.com/hm-registration/successsignin.html
```

### 加密方式

- **算法**: AES-128-CBC
- **Key**: `xeNtBVqzDc6tuNTh`
- **IV**: `MAAAYAAAAAAAAABg`
- 将参数拼接为 URL query string，对明文字节数组加密，直接 POST 二进制

### 响应

HTTP 303 重定向，从 `Location` 头提取 `access` 参数值：

```
Location: https://...?access={accessToken}&...
```

---

## 第二步：换取 login_token

### 请求

```
POST https://account.huami.com/v2/client/login
```

### 请求头

```
app_name: com.xiaomi.hm.health
x-request-id: {uuid}
accept-language: zh-CN
appname: com.xiaomi.hm.health
cv: 50818_6.14.0
v: 2.0
appplatform: android_phone
content-type: application/x-www-form-urlencoded; charset=UTF-8
```

### 请求体

**手机号账号：**

```
app_name=com.xiaomi.hm.health
app_version=6.14.0
code={accessToken}
country_code=CN
device_id={uuid}
device_model=phone
grant_type=access_token
third_name=huami_phone
```

**邮箱账号：**

```
allow_registration==false
app_name=com.xiaomi.hm.health
app_version=6.14.0
code={accessToken}
country_code=CN
device_id={uuid}
device_model=android_phone
dn=account.zepp.com,api-user.zepp.com,api-mifit.zepp.com,api-watch.zepp.com,app-analytics.zepp.com,api-analytics.huami.com,auth.zepp.com
grant_type=access_token
lang=zh_CN
os_version=1.5.0
source= com.xiaomi.hm.health:6.14.0:50818
third_name=email
```

### 返回值

```json
{
  "token_info": {
    "login_token": "{loginToken}",
    "user_id": "{userId}"
  }
}
```

---

## 第三步：获取 app_token

### 请求

```
GET https://account-cn.huami.com/v1/client/app_tokens
  ?app_name=com.xiaomi.hm.health
  &dn=api-user.huami.com%2Capi-mifit.huami.com%2Capp-analytics.huami.com
  &login_token={loginToken}
```

### 请求头

```
User-Agent: MiFit/5.3.0 (iPhone; iOS 14.7.1; Scale/3.00)
```

### 返回值

```json
{
  "token_info": {
    "app_token": "{appToken}"
  }
}
```

---

## 第四步：提交步数

### 请求

```
POST https://api-mifit-cn.huami.com/v1/data/band_data.json?t={timestamp}
```

### 请求头

```
apptoken: {appToken}
Content-Type: application/x-www-form-urlencoded
```

### 请求体

```
userid={userId}
last_sync_data_time=1597306380
device_type=0
last_deviceid=DA932FFFFE8816E7
data_json={dataJson}
```

### data_json 说明

`data_json` 是一个 URL 编码后的 JSON 字符串，描述一整天的运动数据。需替换：
- 日期 → `2021-08-07` → 当天日期 `YYYY-MM-DD`
- 步数值 → `ttl\":N`（替换 N 为目标步数）

核心字段结构：

```json
[{
  "data_hr": "(base64编码的心率数据)",
  "date": "YYYY-MM-DD",
  "data": [{
    "start": 0,
    "stop": 1439,
    "value": "(base64编码的分钟级步数分布)"
  }],
  "summary": "{\"v\":6,\"slp\":{...},\"stp\":{\"ttl\":{步数},\"dis\":...,\"cal\":...},\"goal\":8000,\"tz\":\"28800\"}",
  "source": 24,
  "type": 0
}]
```

---

## 关键常量

| 项目 | 值 |
|------|----|
| AES Key | `xeNtBVqzDc6tuNTh` (16字节) |
| AES IV | `MAAAYAAAAAAAAABg` (16字节) |
| 步数上限 | 98,800 |
| Client ID | Huawei (注意拼写，接口就是 `HuaMi`) |
| 设备 ID | 每次请求随机生成 UUID |
| App | `com.xiaomi.hm.health` (Zepp Life) |
| 版本 | `6.14.0` |

---

## 注意

- 短时间频繁提交可能触发 429 限流（接口层有重试逻辑）
- 步数超过 98,800 会被服务器拒绝
- 加密 key/IV 是硬编码的固定值，与旧版 Python Flask 一致
- 账号需绑定过小米运动设备才能成功修改步数
