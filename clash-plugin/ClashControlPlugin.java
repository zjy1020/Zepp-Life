package com.zepplife.steps;

import android.content.Intent;
import android.os.Handler;
import android.os.Looper;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "ClashControl")
public class ClashControlPlugin extends Plugin {

    @PluginMethod
    public void startClash(PluginCall call) {
        JSObject log = new JSObject();
        try {
            log.put("step1", "正在构建 START_CLASH Intent...");
            Intent intent = new Intent();
            intent.setClassName(
                "com.github.metacubex.clash.meta",
                "com.github.kr328.clash.ExternalControlActivity"
            );
            intent.setAction("com.github.metacubex.clash.meta.action.START_CLASH");
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            log.put("step2", "Intent 已构建，正在发送...");
            getActivity().startActivity(intent);
            log.put("step3", "Intent 已发送至 CMFA");
            log.put("success", true);
            call.resolve(log);
        } catch (Exception e) {
            log.put("success", false);
            log.put("error", e.getClass().getSimpleName() + ": " + e.getMessage());
            call.resolve(log);
        }
    }

    @PluginMethod
    public void stopClash(PluginCall call) {
        JSObject log = new JSObject();
        try {
            log.put("step1", "正在启动 CMFA MainActivity 用于注册广播...");
            Intent warmup = new Intent();
            warmup.setClassName(
                "com.github.metacubex.clash.meta",
                "com.github.kr328.clash.MainActivity"
            );
            warmup.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            try {
                getActivity().startActivity(warmup);
                log.put("step2b", "CMFA MainActivity 已启动");
            } catch (Exception e) {
                log.put("step2b", "启动 MainActivity 失败: " + e.getClass().getSimpleName() + ": " + e.getMessage());
            }

            log.put("step3", "等待 1.5s 让广播注册...");
            new Handler(Looper.getMainLooper()).postDelayed(() -> {
                try {
                    log.put("step4", "正在发送 STOP_CLASH Intent...");
                    Intent stopIntent = new Intent();
                    stopIntent.setClassName(
                        "com.github.metacubex.clash.meta",
                        "com.github.kr328.clash.ExternalControlActivity"
                    );
                    stopIntent.setAction("com.github.metacubex.clash.meta.action.STOP_CLASH");
                    stopIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    getActivity().startActivity(stopIntent);
                    log.put("step5", "STOP_CLASH Intent 已发送");
                    log.put("success", true);
                    call.resolve(log);
                } catch (Exception e2) {
                    log.put("success", false);
                    log.put("error", "发送 STOP 时异常: " + e2.getClass().getSimpleName() + ": " + e2.getMessage());
                    call.resolve(log);
                }
            }, 1500);
        } catch (Exception e) {
            log.put("success", false);
            log.put("error", e.getClass().getSimpleName() + ": " + e.getMessage());
            call.resolve(log);
        }
    }
}
