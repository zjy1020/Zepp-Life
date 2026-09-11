#!/usr/bin/env python3
"""对 `npx cap add android` 生成的 Android 工程做必要改动。

在本项目里做三件事，都必须在 build 之前执行：

1. 清单加 `REQUEST_INSTALL_PACKAGES` —— 应用内一键更新要下载并安装 APK
2. 清单注册 `FileProvider` —— 安装包要通过 content:// URI 交给系统安装器
   （直接传 file:// 在 Android 7+ 会抛 FileUriExposedException）
3. `build.gradle` 注入固定签名 —— 否则 CI 每次构建都会现场生成新的
   debug.keystore，导致各版本签名不同、无法覆盖安装

签名所需的 keystore 与口令通过环境变量传入（GitHub Secrets）：
KEYSTORE_PATH / KEYSTORE_PASSWORD / KEY_ALIAS / KEY_PASSWORD
"""

import os
import pathlib
import re
import sys

ANDROID = pathlib.Path("android")
APP = ANDROID / "app"
MANIFEST = APP / "src/main/AndroidManifest.xml"
GRADLE = APP / "build.gradle"
FILE_PATHS = APP / "src/main/res/xml/file_paths.xml"

FILE_PATHS_XML = """<?xml version="1.0" encoding="utf-8"?>
<paths xmlns:android="http://schemas.android.com/apk/res/android">
    <!-- 与 StepWongPlugin.installUpdate 里 getCacheDir()/updates 对应 -->
    <cache-path name="updates" path="updates/" />
</paths>
"""

PROVIDER_TEMPLATE = """{inner}<provider
{inner}    android:name="androidx.core.content.FileProvider"
{inner}    android:authorities="${{applicationId}}.fileprovider"
{inner}    android:exported="false"
{inner}    android:grantUriPermissions="true">
{inner}    <meta-data
{inner}        android:name="android.support.FILE_PROVIDER_PATHS"
{inner}        android:resource="@xml/file_paths" />
{inner}</provider>
"""


def patch_manifest():
    if not MANIFEST.exists():
        sys.exit(f"找不到 AndroidManifest.xml: {MANIFEST}")
    text = MANIFEST.read_text(encoding="utf-8")
    changed = []

    # <uses-permission> 必须与 <application> 同级。按 <application 的实际缩进插入，
    # 不要用裸字符串替换——注释里出现 "<application" 会误伤。
    if "REQUEST_INSTALL_PACKAGES" not in text:
        m = re.search(r"^([ \t]*)<application\b", text, re.M)
        if not m:
            sys.exit("AndroidManifest.xml 里找不到 <application>")
        perm = (f'{m.group(1)}<uses-permission '
                f'android:name="android.permission.REQUEST_INSTALL_PACKAGES" />\n\n')
        text = text[:m.start()] + perm + text[m.start():]
        changed.append("REQUEST_INSTALL_PACKAGES")

    if "androidx.core.content.FileProvider" not in text:
        m = re.search(r"^([ \t]*)</application>", text, re.M)
        if not m:
            sys.exit("AndroidManifest.xml 里找不到 </application>")
        provider = PROVIDER_TEMPLATE.format(inner=m.group(1) + "    ")
        text = text[:m.start()] + provider + text[m.start():]
        changed.append("FileProvider")

    MANIFEST.write_text(text, encoding="utf-8")
    return changed


def write_file_paths():
    if FILE_PATHS.exists():
        return False
    FILE_PATHS.parent.mkdir(parents=True, exist_ok=True)
    FILE_PATHS.write_text(FILE_PATHS_XML, encoding="utf-8")
    return True


def patch_gradle():
    if not GRADLE.exists():
        sys.exit(f"找不到 build.gradle: {GRADLE}")
    text = GRADLE.read_text(encoding="utf-8")

    if "signingConfigs" in text:
        return "signingConfigs 已存在，跳过"

    m = re.search(r"^android\s*\{", text, re.M)
    if not m:
        sys.exit("build.gradle 里找不到 android { 块")

    signing = """
    signingConfigs {
        fixed {
            /* 路径与口令都由环境变量传入，仓库里不留任何凭据 */
            storeFile file(System.getenv("KEYSTORE_PATH"))
            storePassword System.getenv("KEYSTORE_PASSWORD")
            keyAlias System.getenv("KEY_ALIAS")
            keyPassword System.getenv("KEY_PASSWORD")
        }
    }
"""
    text = text[:m.end()] + signing + text[m.end():]

    m2 = re.search(r"^(\s*)buildTypes\s*\{", text, re.M)
    if not m2:
        sys.exit("build.gradle 里找不到 buildTypes 块")
    indent = m2.group(1) + "    "
    debug_block = (
        f"\n{indent}debug {{\n"
        f"{indent}    /* 固定密钥：否则每次 CI 现场生成新 keystore，无法覆盖安装 */\n"
        f"{indent}    signingConfig signingConfigs.fixed\n"
        f"{indent}}}\n"
    )
    text = text[:m2.end()] + debug_block + text[m2.end():]

    GRADLE.write_text(text, encoding="utf-8")
    return "已注入 signingConfigs 并把 debug 指向它"


def main():
    required = ["KEYSTORE_PATH", "KEYSTORE_PASSWORD", "KEY_ALIAS", "KEY_PASSWORD"]
    missing = [k for k in required if not os.environ.get(k)]
    if missing:
        sys.exit("缺少环境变量（应为 GitHub Secrets）: " + ", ".join(missing))

    keystore = pathlib.Path(os.environ["KEYSTORE_PATH"])
    if not keystore.exists() or keystore.stat().st_size == 0:
        sys.exit(f"keystore 不存在或为空: {keystore}")

    print(f"keystore: {keystore} ({keystore.stat().st_size} bytes)")
    print("manifest :", ", ".join(patch_manifest()) or "无需改动")
    print("file_paths:", "已写入" if write_file_paths() else "已存在，跳过")
    print("gradle   :", patch_gradle())

    print("\n--- AndroidManifest.xml 校验 ---")
    mt = MANIFEST.read_text(encoding="utf-8")
    for kw in ["REQUEST_INSTALL_PACKAGES", "androidx.core.content.FileProvider",
               "${applicationId}.fileprovider", "@xml/file_paths"]:
        print(f"  {'OK  ' if kw in mt else 'FAIL'} {kw}")

    print("\n--- build.gradle 签名段 ---")
    for i, line in enumerate(GRADLE.read_text(encoding="utf-8").splitlines(), 1):
        if "signingConfig" in line or "storeFile" in line or "keyAlias" in line:
            print(f"  {i}: {line.strip()}")


if __name__ == "__main__":
    main()
