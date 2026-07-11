package com.zepplife.steps;

import android.content.Context;
import android.content.Intent;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.VpnService;
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
            log.put("step1", "正在调用 VpnService.prepare()...");
            Intent vpnIntent = VpnService.prepare(getContext());
            log.put("intent", vpnIntent != null ? vpnIntent.toString() : "null");
            if (vpnIntent != null) {
                log.put("step2", "VpnService.prepare() 返回了 Intent");
                log.put("step3", "正在添加 FLAG_ACTIVITY_NEW_TASK...");
                vpnIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                log.put("step4", "正在调用 startActivity(vpnIntent)...");
                getActivity().startActivity(vpnIntent);
                log.put("step5", "startActivity 执行完毕（未抛异常）");
                log.put("hint", "系统应弹出了 VPN 授权对话框，点击「确定」即可断开 Clash");
                log.put("success", true);
                call.resolve(log);
            } else {
                log.put("step2", "VpnService.prepare() 返回 null，可能原因：");
                log.put("hint2a", " - 当前没有活跃的 VPN 连接");
                log.put("hint2b", " - 我们的应用已是当前 VPN 提供者");
                log.put("success", true);
                call.resolve(log);
            }
        } catch (Exception e) {
            log.put("success", false);
            log.put("error", e.getClass().getSimpleName() + ": " + e.getMessage());
            call.resolve(log);
        }
    }
}
