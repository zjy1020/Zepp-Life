package com.zepplife.steps;

import android.content.Intent;
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
            if (vpnIntent != null) {
                log.put("step2", "返回 VPN Intent，正在弹出系统确认框...");
                log.put("hint", "请在系统弹窗中点击「确定」断开 Clash VPN");
                getActivity().startActivity(vpnIntent);
                log.put("success", true);
                call.resolve(log);
            } else {
                log.put("step2", "VpnService.prepare() 返回 null（已无 VPN 连接）");
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
