package com.zepplife.steps;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import javax.crypto.Cipher;
import javax.crypto.spec.IvParameterSpec;
import javax.crypto.spec.SecretKeySpec;

/**
 * APK 内置 Zepp Life 步数同步器，逻辑与 worker/index.js 保持一致：
 * 加密登录 -> 获取 login_token -> 获取 app_token -> 提交步数。
 * 页面走该插件时不再依赖 Cloudflare Worker。
 */
@CapacitorPlugin(name = "StepWong")
public class StepWongPlugin extends Plugin {

    private static final byte[] AES_KEY = "xeNtBVqzDc6tuNTh".getBytes(StandardCharsets.UTF_8);
    private static final byte[] AES_IV = "MAAAYAAAAAAAAABg".getBytes(StandardCharsets.UTF_8);
    private static final int CONNECT_TIMEOUT_MS = 15000;
    private static final int READ_TIMEOUT_MS = 20000;
    private static final int STEP_MIN = 1;
    private static final int STEP_MAX = 98800;
    /*
     * FileProvider 的 authority 后缀，必须与 scripts/patch_android.py 里注入的
     * android:authorities="${applicationId}.updates" 完全一致。
     * 用独立 authority 而非 Capacitor 模板自带的 .fileprovider——
     * 模板那份的 file_paths.xml 不保证覆盖到本插件的缓存目录。
     */
    private static final String AUTHORITY_SUFFIX = ".updates";

    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    @PluginMethod
    public void updateSteps(PluginCall call) {
        final String user = call.getString("user", "").trim();
        final String password = call.getString("password", "").trim();
        final String rawSteps = call.getString("steps", "").trim();
        /* 可选的令牌缓存：命中时跳过登录三步，请求量从 4 降到 1 */
        final String cachedUserId = call.getString("userId", "");
        final String cachedAppToken = call.getString("appToken", "");
        final FlowLog log = new FlowLog();

        if (user.isEmpty() || password.isEmpty()) {
            JSObject error = new JSObject();
            error.put("success", false);
            error.put("message", "账号和密码不能为空");
            error.put("log", joinLog(log));
            call.resolve(error);
            return;
        }

        final int steps;
        try {
            steps = Integer.parseInt(rawSteps);
        } catch (NumberFormatException e) {
            call.resolve(failure("步数范围: " + STEP_MIN + "~" + STEP_MAX, log));
            return;
        }
        if (steps < STEP_MIN || steps > STEP_MAX) {
            call.resolve(failure("步数范围: " + STEP_MIN + "~" + STEP_MAX, log));
            return;
        }

        executor.execute(() -> {
            JSObject result;
            try {
                result = handleUpdate(user, password, steps, cachedUserId, cachedAppToken, log);
            } catch (FlowException e) {
                /* 流程内的可预期失败（限流、响应异常等）：message 已是面向用户的说明 */
                result = failure(e.getMessage(), log);
            } catch (Exception e) {
                log.add("异常: " + e.getClass().getSimpleName() + ": " + e.getMessage());
                result = failure(String.valueOf(e.getMessage()), log);
            }
            result.put("log", joinLog(log));
            call.resolve(result);
        });
    }

    /**
     * 下载新版 APK 并拉起系统安装器。
     *
     * Android 不允许普通应用静默安装，只能把安装包交给系统安装界面由用户确认，
     * 所以这里做三件事：下载到应用缓存目录、通过 FileProvider 暴露成 content:// URI、
     * 用 ACTION_VIEW 唤起安装器。Android 8+ 首次还需用户授权「安装未知应用」。
     */
    @PluginMethod
    public void installUpdate(PluginCall call) {
        final String url = call.getString("url", "");
        final String version = call.getString("version", "");
        if (url == null || url.isEmpty()) {
            call.resolve(installFailure("缺少下载地址"));
            return;
        }

        executor.execute(() -> {
            try {
                File dir = new File(getContext().getCacheDir(), "updates");
                if (!dir.exists() && !dir.mkdirs()) {
                    call.resolve(installFailure("无法创建缓存目录"));
                    return;
                }
                File apk = new File(dir, "dongdongba-update.apk");
                if (apk.exists() && !apk.delete()) {
                    call.resolve(installFailure("无法清理上一次的安装包"));
                    return;
                }

                HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
                conn.setInstanceFollowRedirects(true);
                conn.setConnectTimeout(CONNECT_TIMEOUT_MS);
                conn.setReadTimeout(120000);
                conn.setRequestProperty("User-Agent", "DongDongBa");
                int code = conn.getResponseCode();
                if (code < 200 || code >= 300) {
                    call.resolve(installFailure("下载失败：HTTP " + code));
                    return;
                }

                long total = 0;
                try (InputStream in = conn.getInputStream();
                     FileOutputStream out = new FileOutputStream(apk)) {
                    byte[] buf = new byte[16384];
                    int n;
                    while ((n = in.read(buf)) > 0) {
                        out.write(buf, 0, n);
                        total += n;
                    }
                }
                conn.disconnect();

                if (total < 1024) {
                    call.resolve(installFailure("下载内容过小（" + total + " 字节），可能不是安装包"));
                    return;
                }

                /* Android 8+ 需要用户先允许「安装未知应用」，否则安装器会直接闪退 */
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                        && !getContext().getPackageManager().canRequestPackageInstalls()) {
                    openUnknownSourcesSettings();
                    JSObject need = new JSObject();
                    need.put("success", false);
                    need.put("needPermission", true);
                    need.put("message", "请先允许本应用「安装未知应用」，开启后返回再点一次「立即更新」");
                    call.resolve(need);
                    return;
                }

                Uri uri = FileProvider.getUriForFile(
                    getContext(),
                    getContext().getPackageName() + AUTHORITY_SUFFIX,
                    apk
                );
                Intent intent = new Intent(Intent.ACTION_VIEW);
                intent.setDataAndType(uri, "application/vnd.android.package-archive");
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION
                        | Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(intent);

                JSObject result = new JSObject();
                result.put("success", true);
                result.put("version", version == null ? "" : version);
                result.put("size", total);
                result.put("message", "安装包已下载，请在系统界面点击「安装」");
                call.resolve(result);
            } catch (Exception e) {
                call.resolve(installFailure("更新失败："
                        + e.getClass().getSimpleName() + "：" + e.getMessage()));
            }
        });
    }

    private static JSObject installFailure(String message) {
        JSObject r = new JSObject();
        r.put("success", false);
        r.put("message", message);
        return r;
    }

    /** 跳到本应用的「安装未知应用」授权页。部分 ROM 无此页，失败可忽略。 */
    private void openUnknownSourcesSettings() {
        try {
            Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES);
            intent.setData(Uri.parse("package:" + getContext().getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
        } catch (Exception ignored) {
            /* 忽略：用户可自行到系统设置里开启 */
        }
    }

    private JSObject handleUpdate(String user, String password, int steps,
                                  String cachedUserId, String cachedAppToken,
                                  FlowLog log) throws Exception {
        final String deviceId = UUID.randomUUID().toString();
        final boolean isPhone = user.startsWith("+86") || !user.contains("@");
        log.add("设备ID:" + deviceId);
        log.add("账号类型:" + (isPhone ? "手机号" : "邮箱"));

        String userId = cachedUserId == null ? "" : cachedUserId.trim();
        String appToken = cachedAppToken == null ? "" : cachedAppToken.trim();

        /* 令牌缓存：命中时跳过登录三步，请求量从 4 降到 1。
           被限流的正是登录端点（api-user.zepp.com），跳过它等于不再触碰限流接口。 */
        if (!userId.isEmpty() && !appToken.isEmpty()) {
            log.add("命中缓存令牌，跳过登录（预期仅 1 个请求）");
            SubmitOutcome cached = submitSteps(userId, appToken, steps, log);
            if (cached.ok) {
                log.add("本次共发出 " + log.requests + " 个请求，总耗时 " + log.elapsed() + "ms —— 成功（缓存令牌）");
                return success(steps, userId, appToken);
            }
            /* 缓存令牌可能已失效：不直接失败，回退完整登录重试一次 */
            log.add("缓存令牌提交未通过：" + cached.reason + "，回退完整登录");
        }

        log.add("执行完整登录（预期共 4 个请求）");
        LoginToken login = runLoginFlow(user, password, deviceId, isPhone, log);

        SubmitOutcome submit = submitSteps(login.userId, login.appToken, steps, log);
        if (!submit.ok) {
            log.add("本次共发出 " + log.requests + " 个请求，总耗时 " + log.elapsed() + "ms —— 失败：" + submit.reason);
            return failure(submit.reason, log);
        }
        log.add("本次共发出 " + log.requests + " 个请求，总耗时 " + log.elapsed() + "ms —— 成功（完整登录）");
        return success(steps, login.userId, login.appToken);
    }

    /** 完整登录：加密登录 -> login_token -> app_token。任何一步被限流都立刻中止并说明原因。 */
    private LoginToken runLoginFlow(String user, String password, String deviceId,
                                    boolean isPhone, FlowLog log) throws Exception {
        Map<String, String> loginData = new LinkedHashMap<>();
        loginData.put("emailOrPhone", user);
        loginData.put("password", password);
        loginData.put("state", "REDIRECTION");
        loginData.put("client_id", "HuaMi");
        loginData.put("country_code", "CN");
        loginData.put("token", "access");
        loginData.put("redirect_uri", "https://s3-us-west-2.amazonaws.com/hm-registration/successsignin.html");

        String queryStr = buildQuery(loginData);
        byte[] encrypted = encryptLoginData(queryStr.getBytes(StandardCharsets.UTF_8));
        log.add("登录参数加密完成，长度:" + encrypted.length);

        Map<String, String> headers1 = new LinkedHashMap<>();
        headers1.put("content-type", "application/x-www-form-urlencoded; charset=UTF-8");
        headers1.put("user-agent", "MiFit6.14.0 (M2007J1SC; Android 12; Density/2.75)");
        headers1.put("app_name", "com.xiaomi.hm.health");
        headers1.put("appname", "com.xiaomi.hm.health");
        headers1.put("appplatform", "android_phone");
        headers1.put("x-hm-ekv", "1");
        headers1.put("hm-privacy-ceip", "false");

        /* 原实现在 429 上做零延迟热重试：从已经枯竭的配额里再抢一次，
           只会延长限流窗口，且把「被限流」误报成「获取 accessToken 失败」。
           现在改为直接中止，并给出可据此行动的原因。 */
        long t1 = log.mark();
        HttpResponse r1 = httpRequest("POST", "https://api-user.zepp.com/v2/registrations/tokens", headers1, encrypted, false);
        log.requests++;
        log.add("登录第一步 [HTTP " + r1.status + "] 耗时 " + log.since(t1) + "ms");

        if (r1.status == 429) {
            log.add("登录第一步被限流（HTTP 429）");
            throw new FlowException(rateLimitedMessage("登录", r1));
        }
        if (r1.status != 303) {
            log.add("v2登录异常，status: " + r1.status);
            log.add("响应片段: " + r1.text(120));
            throw new FlowException("登录第一步失败（HTTP " + r1.status + "）");
        }

        String location = r1.header("Location");
        String code = getAccessToken(location);
        if (code == null) {
            log.add("Location头: " + location);
            log.add("状态码: " + r1.status);
            throw new FlowException("登录第一步响应中缺少 accessToken");
        }
        log.add("登录第一步成功，Location 解析完成");

        Map<String, String> headers2 = new LinkedHashMap<>();
        headers2.put("app_name", "com.xiaomi.hm.health");
        headers2.put("x-request-id", UUID.randomUUID().toString());
        headers2.put("accept-language", "zh-CN");
        headers2.put("appname", "com.xiaomi.hm.health");
        headers2.put("cv", "50818_6.14.0");
        headers2.put("v", "2.0");
        headers2.put("appplatform", "android_phone");
        headers2.put("content-type", "application/x-www-form-urlencoded; charset=UTF-8");

        Map<String, String> data2 = new LinkedHashMap<>();
        if (isPhone) {
            data2.put("app_name", "com.xiaomi.hm.health");
            data2.put("app_version", "6.14.0");
            data2.put("code", code);
            data2.put("country_code", "CN");
            data2.put("device_id", deviceId);
            data2.put("device_model", "phone");
            data2.put("grant_type", "access_token");
            data2.put("third_name", "huami_phone");
        } else {
            data2.put("allow_registration=", "false");
            data2.put("app_name", "com.xiaomi.hm.health");
            data2.put("app_version", "6.14.0");
            data2.put("code", code);
            data2.put("country_code", "CN");
            data2.put("device_id", deviceId);
            data2.put("device_model", "android_phone");
            data2.put("dn", "account.zepp.com,api-user.zepp.com,api-mifit.zepp.com,api-watch.zepp.com,app-analytics.zepp.com,api-analytics.huami.com,auth.zepp.com");
            data2.put("grant_type", "access_token");
            data2.put("lang", "zh_CN");
            data2.put("os_version", "1.5.0");
            data2.put("source", " com.xiaomi.hm.health:6.14.0:50818");
            data2.put("third_name", "email");
        }

        long t2 = log.mark();
        HttpResponse r2 = httpRequest(
            "POST",
            "https://account.huami.com/v2/client/login",
            headers2,
            urlSearchParams(data2).getBytes(StandardCharsets.UTF_8),
            true
        );
        log.requests++;
        log.add("登录第二步 [HTTP " + r2.status + "] 耗时 " + log.since(t2) + "ms");

        if (r2.status == 429) {
            log.add("登录第二步被限流（HTTP 429）");
            throw new FlowException(rateLimitedMessage("登录", r2));
        }
        if (r2.status != 200) {
            log.add("获取login_token失败，HTTP状态码: " + r2.status);
            log.add("响应内容: " + r2.text(200));
            throw new FlowException("登录第二步失败（HTTP " + r2.status + "）");
        }

        JSONObject r2json = parseJson(r2);
        if (!r2json.has("token_info")) {
            log.add("响应缺少 token_info 字段: " + r2.text(200));
            throw new FlowException("登录第二步失败：响应缺少 token_info");
        }

        JSONObject tokenInfo2 = r2json.getJSONObject("token_info");
        String loginToken = tokenInfo2.getString("login_token");
        String userId = tokenInfo2.getString("user_id");
        log.add("登录第二步成功，login_token 与 userid 获取完成");

        String url3 = "https://account-cn.huami.com/v1/client/app_tokens?app_name=com.xiaomi.hm.health"
            + "&dn=api-user.huami.com%2Capi-mifit.huami.com%2Capp-analytics.huami.com"
            + "&login_token=" + loginToken;
        Map<String, String> headers3 = new LinkedHashMap<>();
        headers3.put("User-Agent", "MiFit/5.3.0 (iPhone; iOS 14.7.1; Scale/3.00)");

        long t3 = log.mark();
        HttpResponse r3 = httpRequest("GET", url3, headers3, null, true);
        log.requests++;
        log.add("获取 app_token [HTTP " + r3.status + "] 耗时 " + log.since(t3) + "ms");

        if (r3.status == 429) {
            log.add("获取 app_token 被限流（HTTP 429）");
            throw new FlowException(rateLimitedMessage("获取 app_token", r3));
        }
        if (r3.status != 200) {
            log.add("获取app_token失败，HTTP状态码: " + r3.status);
            log.add("响应内容: " + r3.text(200));
            throw new FlowException("获取 app_token 失败（HTTP " + r3.status + "）");
        }

        JSONObject r3json = parseJson(r3);
        if (!r3json.has("token_info")) {
            log.add("app_tokens 响应缺少 token_info: " + r3.text(200));
            throw new FlowException("获取 app_token 失败：响应缺少 token_info");
        }
        String appToken = r3json.getJSONObject("token_info").getString("app_token");
        log.add("app_token 获取成功");

        return new LoginToken(userId, appToken);
    }

    /** 提交步数。返回结构化结果，由调用方决定是否回退完整登录。 */
    private SubmitOutcome submitSteps(String userId, String appToken, int steps, FlowLog log) throws Exception {
        String today = getToday();
        String step = String.valueOf(steps);
        String dataJson = loadDataJsonTemplate().replace("2021-08-07", today);
        dataJson = dataJson.replaceFirst("(ttl%5C%22%3A)\\d+", "$1" + step);
        log.add("提交目标: userid " + maskId(userId) + "，日期 " + today + "，步数 " + step + "，data_json " + dataJson.length() + " 字节");

        String t = String.valueOf(System.currentTimeMillis());
        String postData = "userid=" + userId
            + "&last_sync_data_time=1597306380"
            + "&device_type=0"
            + "&last_deviceid=DA932FFFFE8816E7"
            + "&data_json=" + dataJson;

        Map<String, String> headers4 = new LinkedHashMap<>();
        headers4.put("apptoken", appToken);
        headers4.put("Content-Type", "application/x-www-form-urlencoded");

        long t4 = log.mark();
        HttpResponse r4 = httpRequest(
            "POST",
            "https://api-mifit-cn.huami.com/v1/data/band_data.json?&t=" + t,
            headers4,
            postData.getBytes(StandardCharsets.UTF_8),
            true
        );
        log.requests++;
        log.add("提交步数 [HTTP " + r4.status + "] 耗时 " + log.since(t4) + "ms");

        if (r4.status == 429) {
            log.add("提交步数被限流（HTTP 429）");
            return new SubmitOutcome(false, rateLimitedMessage("提交步数", r4));
        }

        /* 判定真实成败：不能只看有没有响应。
           原实现无条件返回 success=true，导致提交失败也被记成"同步成功"，
           进而写入成功记录、推进步数基准——这是"记录对不上"的根因。 */
        JSONObject r4json;
        try {
            r4json = parseJson(r4);
        } catch (Exception e) {
            log.add("同步响应解析失败，HTTP状态码: " + r4.status);
            log.add("响应片段: " + r4.text(200));
            return new SubmitOutcome(false, "提交步数失败：响应无法解析（HTTP " + r4.status + "）");
        }

        String message = r4json.optString("message", "");
        log.add("同步步数（" + step + "）[HTTP " + r4.status + "][" + message + "]");

        StepSubmitVerdict verdict = judgeStepSubmit(r4.status, message);
        if (!verdict.ok) {
            log.add("提交被服务端拒绝：" + verdict.reason);
            return new SubmitOutcome(false, "同步失败：" + verdict.reason);
        }
        return new SubmitOutcome(true, "");
    }

    /** 把 429 翻译成用户能据此行动的话，并带上服务端建议的等待时间。 */
    private static String rateLimitedMessage(String stage, HttpResponse response) {
        long waitSeconds = retryAfterSeconds(response);
        StringBuilder sb = new StringBuilder(stage + "被限流（HTTP 429）");
        if (waitSeconds > 0) {
            sb.append("，服务端建议等待 ").append(waitSeconds).append(" 秒");
        }
        sb.append("；请稍后重试，或切换网络（飞行模式重拨）后重试");
        return sb.toString();
    }

    private static long retryAfterSeconds(HttpResponse response) {
        String value = response.header("Retry-After");
        if (value == null) {
            return -1;
        }
        try {
            return Long.parseLong(value.trim());
        } catch (NumberFormatException e) {
            return -1;
        }
    }

    /** 日志里只保留 userid 前 8 位，够用于比对是否换过账号，又不至于完整暴露。 */
    private static String maskId(String value) {
        if (value == null || value.isEmpty()) {
            return "(空)";
        }
        return value.length() <= 8 ? value : value.substring(0, 8) + "…";
    }

    /**
     * 带耗时前缀与请求计数的日志容器。
     * 每条日志自动带上「相对本次流程起点的毫秒偏移」，这样日志本身就能说明
     * 每一步花了多久、两次尝试之间隔了多久——不必再去推算。
     */
    private static class FlowLog extends ArrayList<String> {
        private final long start = System.currentTimeMillis();
        int requests = 0;

        @Override
        public boolean add(String text) {
            return super.add("[+" + (System.currentTimeMillis() - start) + "ms] " + text);
        }

        long mark() {
            return System.currentTimeMillis();
        }

        long since(long from) {
            return System.currentTimeMillis() - from;
        }

        long elapsed() {
            return System.currentTimeMillis() - start;
        }
    }

    private static JSObject success(int steps, String userId, String appToken) {
        JSObject result = new JSObject();
        result.put("success", true);
        result.put("message", "同步成功！当前步数: " + steps);
        /* 回传令牌，前端据此缓存；下次提交可跳过登录三步 */
        result.put("userId", userId == null ? "" : userId);
        result.put("appToken", appToken == null ? "" : appToken);
        return result;
    }

    private static class LoginToken {
        final String userId;
        final String appToken;

        LoginToken(String userId, String appToken) {
            this.userId = userId;
            this.appToken = appToken;
        }
    }

    private static class SubmitOutcome {
        final boolean ok;
        final String reason;

        SubmitOutcome(boolean ok, String reason) {
            this.ok = ok;
            this.reason = reason;
        }
    }

    private static class FlowException extends Exception {
        FlowException(String message) {
            super(message);
        }
    }

    /**
     * 判定步数提交是否真正成功。
     *
     * huami 的 band_data 接口在成功时返回 message="success"（大小写/措辞可能微调），
     * 失败时会给出 4xx/5xx 状态码，或 message 中带有错误描述。
     * 这里采取保守策略：只有明确看到成功标志才判成功，其余一律判失败，
     * 避免把失败记录成成功（宁可误报失败，也不要污染成功记录与步数基准）。
     */
    private static StepSubmitVerdict judgeStepSubmit(int httpStatus, String message) {
        if (httpStatus < 200 || httpStatus >= 300) {
            return StepSubmitVerdict.fail("HTTP 状态码 " + httpStatus);
        }
        String msg = message == null ? "" : message.trim();
        String lower = msg.toLowerCase(Locale.US);

        if (lower.contains("success") || msg.contains("成功")) {
            return StepSubmitVerdict.pass();
        }
        if (lower.contains("error") || lower.contains("fail") || lower.contains("invalid")
            || lower.contains("denied") || lower.contains("expired") || lower.contains("unauthor")
            || msg.contains("失败") || msg.contains("错误") || msg.contains("无效")) {
            return StepSubmitVerdict.fail(msg.isEmpty() ? "服务端返回错误" : msg);
        }
        // message 为空：部分情况下服务端成功但不回 message，按成功处理
        if (msg.isEmpty()) {
            return StepSubmitVerdict.pass();
        }
        // 有内容但既非成功也非明确的失败关键词——保守判失败
        return StepSubmitVerdict.fail(msg);
    }

    private static class StepSubmitVerdict {
        final boolean ok;
        final String reason;

        private StepSubmitVerdict(boolean ok, String reason) {
            this.ok = ok;
            this.reason = reason;
        }

        static StepSubmitVerdict pass() { return new StepSubmitVerdict(true, ""); }
        static StepSubmitVerdict fail(String reason) { return new StepSubmitVerdict(false, reason); }
    }

    private static byte[] encryptLoginData(byte[] plain) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/CBC/PKCS5Padding");
        cipher.init(Cipher.ENCRYPT_MODE, new SecretKeySpec(AES_KEY, "AES"), new IvParameterSpec(AES_IV));
        return cipher.doFinal(plain);
    }

    private static String buildQuery(Map<String, String> params) throws IOException {
        StringBuilder sb = new StringBuilder();
        boolean first = true;
        for (Map.Entry<String, String> entry : params.entrySet()) {
            if (!first) {
                sb.append('&');
            }
            first = false;
            sb.append(encodeComponent(entry.getKey()));
            sb.append('=');
            sb.append(encodeComponent(entry.getValue()));
        }
        return sb.toString();
    }

    /** 兼容 JS encodeURIComponent + 空格转 +。 */
    private static String encodeComponent(String value) throws IOException {
        String encoded = URLEncoder.encode(value, "UTF-8");
        return encoded
            .replace("%21", "!")
            .replace("%7E", "~")
            .replace("%27", "'")
            .replace("%28", "(")
            .replace("%29", ")");
    }

    /** 兼容 JS new URLSearchParams(...).toString()。 */
    private static String urlSearchParams(Map<String, String> params) throws IOException {
        StringBuilder sb = new StringBuilder();
        boolean first = true;
        for (Map.Entry<String, String> entry : params.entrySet()) {
            if (!first) {
                sb.append('&');
            }
            first = false;
            sb.append(URLEncoder.encode(entry.getKey(), "UTF-8"));
            sb.append('=');
            sb.append(URLEncoder.encode(entry.getValue(), "UTF-8"));
        }
        return sb.toString();
    }

    private static String getAccessToken(String location) {
        if (location == null) {
            return null;
        }
        String[] parts = location.split("access=", 2);
        if (parts.length < 2) {
            return null;
        }
        String token = parts[1];
        int end = token.indexOf('&');
        return end >= 0 ? token.substring(0, end) : token;
    }

    private static String getToday() {
        return new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date());
    }

    private String loadDataJsonTemplate() throws IOException {
        Context context = getContext();
        try (InputStream in = context.getAssets().open("data_json.tpl")) {
            return new String(readAll(in), StandardCharsets.UTF_8);
        }
    }

    private static HttpResponse httpRequest(
        String method,
        String urlString,
        Map<String, String> headers,
        byte[] body,
        boolean followRedirects
    ) throws IOException {
        HttpURLConnection conn = (HttpURLConnection) new URL(urlString).openConnection();
        try {
            conn.setRequestMethod(method);
            conn.setConnectTimeout(CONNECT_TIMEOUT_MS);
            conn.setReadTimeout(READ_TIMEOUT_MS);
            conn.setInstanceFollowRedirects(followRedirects);
            if (headers != null) {
                for (Map.Entry<String, String> entry : headers.entrySet()) {
                    conn.setRequestProperty(entry.getKey(), entry.getValue());
                }
            }
            if (body != null && !"GET".equals(method)) {
                conn.setDoOutput(true);
                try (OutputStream out = conn.getOutputStream()) {
                    out.write(body);
                }
            }
            int status = conn.getResponseCode();
            InputStream stream = status >= 400 ? conn.getErrorStream() : conn.getInputStream();
            byte[] responseBody = stream == null ? new byte[0] : readAll(stream);
            return new HttpResponse(status, responseBody, conn.getHeaderFields());
        } finally {
            conn.disconnect();
        }
    }

    private static byte[] readAll(InputStream in) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buffer = new byte[8192];
        int read;
        while ((read = in.read(buffer)) != -1) {
            out.write(buffer, 0, read);
        }
        return out.toByteArray();
    }

    private static JSONObject parseJson(HttpResponse response) throws Exception {
        return new JSONObject(new String(response.body, StandardCharsets.UTF_8));
    }

    private static String joinLog(List<String> log) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < log.size(); i++) {
            if (i > 0) {
                sb.append('\n');
            }
            sb.append(log.get(i));
        }
        return sb.toString();
    }

    private static JSObject failure(String message, List<String> log) {
        JSObject result = new JSObject();
        result.put("success", false);
        result.put("message", message);
        result.put("log", joinLog(log));
        return result;
    }

    private static class HttpResponse {
        final int status;
        final byte[] body;
        final Map<String, List<String>> headers;

        HttpResponse(int status, byte[] body, Map<String, List<String>> headers) {
            this.status = status;
            this.body = body;
            this.headers = headers;
        }

        String header(String name) {
            for (Map.Entry<String, List<String>> entry : headers.entrySet()) {
                if (entry.getKey() != null && entry.getKey().equalsIgnoreCase(name)) {
                    List<String> values = entry.getValue();
                    return values == null || values.isEmpty() ? null : values.get(0);
                }
            }
            return null;
        }

        String text(int max) {
            String text = new String(body, StandardCharsets.UTF_8);
            return text.length() <= max ? text : text.substring(0, max);
        }
    }
}
