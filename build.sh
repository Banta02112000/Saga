#!/usr/bin/env bash
# Builds CanonSync.apk: javac (stubs) -> d8 -> apktool (aapt2) -> zipalign -> apksigner (v2+v3)
set -euo pipefail
cd "$(dirname "$0")"
KS=${KS:?path to upload.jks}; export KSPW=${KSPW:?keystore password}
VERSION_CODE=${VERSION_CODE:-121}; VERSION_NAME=${VERSION_NAME:-1.2}
# EDITION=own: Banta's app (her keys, lists and data). EDITION=blank: the shareable starter, with none of her data,
# its own package id (installs next to hers) and its own link scheme.
EDITION=${EDITION:-own}
# personal identifiers the starter must never contain: private/leak_patterns.txt (not in the public repo)
LEAKS=$(cat private/leak_patterns.txt 2>/dev/null || echo "NO_PRIVATE_PATTERNS_CONFIGURED")
if [ "$EDITION" = blank ]; then PKG=com.canonsync.starter; SCHEME=canonsyncstarter; else PKG=com.banta.canonsync.app; SCHEME=bantaapps; fi
J8="java -XX:+UnlockDiagnosticVMOptions -XX:-BytecodeVerificationRemote -XX:-BytecodeVerificationLocal -Xss16m"

rm -rf classes dexout app out && mkdir -p classes dexout out app/assets
javac --release 8 -Xlint:-options -cp stubs -d classes $(find stubs java -name "*.java")
$J8 -cp tools/d8-jvm.jar com.android.tools.r8.D8 --release --min-api 26 --output dexout $(find classes/com -name "*.class")

cp dexout/classes.dex app/
cp -r res_gen/res app/res
python3 scripts/gen_it.py
cp web/index.html web/boot.js web/style.css web/saga.css web/core.js web/extras.js web/app.js web/library.js web/activity.js web/imports.js web/kit.js web/images.js web/games.js web/games-ui.js web/books-ui.js web/timeline.js web/music.js web/website.js web/deals.js web/backup.js web/tidy.js web/rules.js web/foryou.js web/auto.js web/bg.html web/bg.js app/assets/
python3 scripts/stage_web.py app/assets $([ "$EDITION" = blank ] && echo --blank)
if [ "$EDITION" = blank ]; then
  printf '/* Shareable build: no personal sources or keys. Everything is entered in Settings. */\nwindow.CANONSYNC_PRESET = {};\n' > app/assets/preset.js
  # Banta's own Trakt API apps: the starter asks for the user's own Client ID instead
  sed -i 's/client_id: "YOUR_TRAKT_CLIENT_ID_PKCE"/client_id: ""/; s/client_id: "YOUR_TRAKT_CLIENT_ID_OOB"/client_id: ""/' app/assets/core.js
  sed -i 's/PKCE \/ Public Client (App 000001)/PKCE (your own Trakt app)/; s/OAuth OOB (App 000002)/OAuth with secret (your own Trakt app)/' app/assets/core.js app/assets/app.js
else
  cp private/own_preset.js app/assets/preset.js
fi
cp -r web/fonts app/assets/fonts
cp -r web/shared app/assets/shared
mkdir -p app/assets/books && cp web/books/index.html web/books/app.js web/books/core.js web/books/books.css app/assets/books/
# GameCheck + DW Canon (their original compiled code, pages and notification icon)
python3 legacy/prepare.py --out app/assets --scheme "$SCHEME" $([ "$EDITION" = blank ] && echo --blank)
cp -r legacy/smali_classes2 app/smali_classes2
mkdir -p app/res/drawable && cp legacy/res/drawable/ic_notif.xml app/res/drawable/
# home-screen widget
mkdir -p app/res/layout app/res/xml
cat > app/res/drawable/widget_bg.xml <<XML
<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
    <solid android:color="#F2221B3B"/>
    <corners android:radius="22dp"/>
</shape>
XML
# backgrounds for the widget transparency setting: dark and light, from solid to fully see-through
for A in 100:FF 85:D9 70:B3 55:8C 40:66 25:40 10:1A 0:00; do
  P=${A%%:*}; H=${A##*:}
  for T in dark:221B3B light:F7F4EE; do
cat > app/res/drawable/wbg_${T%%:*}_$P.xml <<XML
<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
    <solid android:color="#$H${T##*:}"/>
    <corners android:radius="22dp"/>
</shape>
XML
  done
done
cat > app/res/drawable/widget_btn.xml <<XML
<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
    <solid android:color="#F5B841"/>
    <corners android:radius="16dp"/>
</shape>
XML
for W in episodes upcoming games books year; do
cat > app/res/xml/widget_info_$W.xml <<XML
<?xml version="1.0" encoding="utf-8"?>
<appwidget-provider xmlns:android="http://schemas.android.com/apk/res/android"
    android:minWidth="180dp" android:minHeight="110dp" android:updatePeriodMillis="3600000"
    android:initialLayout="@layout/widget" android:previewImage="@drawable/preview_$W" android:description="@string/w_$W" android:resizeMode="horizontal|vertical" android:widgetCategory="home_screen"/>
XML
done
cat > app/res/layout/widget.xml <<XML
<?xml version="1.0" encoding="utf-8"?>
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android" android:id="@+id/w_root"
    android:layout_width="match_parent" android:layout_height="match_parent" android:orientation="vertical"
    android:background="@drawable/widget_bg" android:padding="14dp">
    <TextView android:id="@+id/w_title" android:layout_width="match_parent" android:layout_height="wrap_content"
        android:textColor="#F5B841" android:textSize="13sp" android:textStyle="bold" android:maxLines="1" android:ellipsize="end"/>
    <TextView android:id="@+id/w_body" android:layout_width="match_parent" android:layout_height="0dp" android:layout_weight="1"
        android:layout_marginTop="6dp" android:textColor="#F1ECFF" android:textSize="14sp" android:lineSpacingExtra="3dp" android:ellipsize="end"/>
    <TextView android:id="@+id/w_btn" android:layout_width="wrap_content" android:layout_height="wrap_content" android:visibility="gone"
        android:layout_marginTop="6dp" android:background="@drawable/widget_btn" android:paddingLeft="12dp" android:paddingRight="12dp"
        android:paddingTop="6dp" android:paddingBottom="6dp" android:textColor="#14101F" android:textSize="13sp" android:textStyle="bold" android:maxLines="1" android:ellipsize="end"/>
</LinearLayout>
XML
# widget previews (drawn by scripts, see res_extra) and the long-press shortcuts
mkdir -p app/res/drawable-nodpi app/res/values
cp res_extra/drawable-nodpi/preview_*.png app/res/drawable-nodpi/
cat > app/res/values/strings.xml <<XML
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="sc_search">Search</string><string name="sc_search_long">Search films, series, games, books</string>
    <string name="sc_next">Next episodes</string><string name="sc_next_long">Series you are watching</string>
    <string name="sc_sync">Sync now</string><string name="sc_sync_long">Sync IMDb, Trakt and the rest</string>
    <string name="sc_scan">Scan a book</string><string name="sc_scan_long">Add a book from its barcode</string>
    <string name="w_main">Up next, what you are watching, what is coming</string>
    <string name="w_episodes">Next episodes, with a Mark watched button</string>
    <string name="w_upcoming">Releases in the next three weeks</string>
    <string name="w_games">Games you are playing, and deals</string>
    <string name="w_books">Books you are reading</string>
    <string name="w_year">Your year in numbers</string>
</resources>
XML
cat > app/res/xml/shortcuts.xml <<XML
<?xml version="1.0" encoding="utf-8"?>
<shortcuts xmlns:android="http://schemas.android.com/apk/res/android">
  <shortcut android:shortcutId="search" android:enabled="true" android:icon="@mipmap/ic_launcher" android:shortcutShortLabel="@string/sc_search" android:shortcutLongLabel="@string/sc_search_long">
    <intent android:action="android.intent.action.VIEW" android:targetPackage="$PKG" android:targetClass="com.banta.canonsync.MainActivity"><extra android:name="tab" android:value="search"/></intent></shortcut>
  <shortcut android:shortcutId="nextep" android:enabled="true" android:icon="@mipmap/ic_launcher" android:shortcutShortLabel="@string/sc_next" android:shortcutLongLabel="@string/sc_next_long">
    <intent android:action="android.intent.action.VIEW" android:targetPackage="$PKG" android:targetClass="com.banta.canonsync.MainActivity"><extra android:name="tab" android:value="nextep"/></intent></shortcut>
  <shortcut android:shortcutId="syncnow" android:enabled="true" android:icon="@mipmap/ic_launcher" android:shortcutShortLabel="@string/sc_sync" android:shortcutLongLabel="@string/sc_sync_long">
    <intent android:action="android.intent.action.VIEW" android:targetPackage="$PKG" android:targetClass="com.banta.canonsync.MainActivity"><extra android:name="tab" android:value="syncnow"/></intent></shortcut>
  <shortcut android:shortcutId="scanbook" android:enabled="true" android:icon="@mipmap/ic_launcher" android:shortcutShortLabel="@string/sc_scan" android:shortcutLongLabel="@string/sc_scan_long">
    <intent android:action="android.intent.action.VIEW" android:targetPackage="$PKG" android:targetClass="com.banta.canonsync.MainActivity"><extra android:name="tab" android:value="scanbook"/></intent></shortcut>
</shortcuts>
XML
# API keys live in secrets.json, encrypted with a key that never leaves this phone: it can't be restored elsewhere, so it stays out of Android's backups
# HTTPS everywhere, except plain http:// to your own AI server through Tailscale (MagicDNS names end in .ts.net)
# and to this phone itself
cat > app/res/xml/network_security_config.xml <<XML
<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <base-config cleartextTrafficPermitted="false"/>
    <domain-config cleartextTrafficPermitted="true">
        <domain includeSubdomains="true">ts.net</domain>
        <domain includeSubdomains="false">localhost</domain>
        <domain includeSubdomains="false">127.0.0.1</domain>
    </domain-config>
</network-security-config>
XML
cat > app/res/xml/backup_rules.xml <<XML
<?xml version="1.0" encoding="utf-8"?>
<full-backup-content>
    <exclude domain="file" path="secrets.json"/>
    <exclude domain="file" path="secrets.json.tmp"/>
</full-backup-content>
XML
cat > app/res/xml/data_rules.xml <<XML
<?xml version="1.0" encoding="utf-8"?>
<data-extraction-rules>
    <cloud-backup><exclude domain="file" path="secrets.json"/><exclude domain="file" path="secrets.json.tmp"/></cloud-backup>
    <device-transfer><exclude domain="file" path="secrets.json"/><exclude domain="file" path="secrets.json.tmp"/></device-transfer>
</data-extraction-rules>
XML
cat > app/res/xml/widget_info.xml <<XML
<?xml version="1.0" encoding="utf-8"?>
<appwidget-provider xmlns:android="http://schemas.android.com/apk/res/android"
    android:minWidth="250dp" android:minHeight="110dp" android:updatePeriodMillis="3600000"
    android:initialLayout="@layout/widget" android:previewImage="@drawable/preview_widget" android:description="@string/w_main" android:resizeMode="horizontal|vertical" android:widgetCategory="home_screen"/>
XML
cat > app/AndroidManifest.xml <<XML
<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="$PKG">
    <uses-permission android:name="android.permission.INTERNET"/>
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE"/>
    <uses-permission android:name="android.permission.POST_NOTIFICATIONS"/>
    <uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED"/>
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE"/>
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE_DATA_SYNC"/>
    <uses-permission android:name="android.permission.CAMERA"/>
    <uses-feature android:name="android.hardware.camera" android:required="false"/>
    <queries><package android:name="com.google.android.apps.bard"/></queries>
    <application android:largeHeap="true" android:label="Saga" android:icon="@mipmap/ic_launcher" android:roundIcon="@mipmap/ic_launcher"
        android:allowBackup="true" android:fullBackupContent="@xml/backup_rules" android:dataExtractionRules="@xml/data_rules" android:hardwareAccelerated="true" android:supportsRtl="true" android:usesCleartextTraffic="false" android:networkSecurityConfig="@xml/network_security_config" android:resizeableActivity="true"
        android:theme="@android:style/Theme.Material.NoActionBar">
        <activity android:name="com.banta.canonsync.MainActivity" android:exported="true" android:enableOnBackInvokedCallback="true"
            android:windowSoftInputMode="adjustResize" android:launchMode="singleTask"
            android:configChanges="orientation|screenSize|smallestScreenSize|screenLayout|keyboard|keyboardHidden|navigation|uiMode|density">
            <intent-filter>
                <action android:name="android.intent.action.MAIN"/>
                <category android:name="android.intent.category.LAUNCHER"/>
            </intent-filter>
            <meta-data android:name="android.app.shortcuts" android:resource="@xml/shortcuts"/>
            <intent-filter android:label="Add to Saga">
                <action android:name="android.intent.action.SEND"/>
                <category android:name="android.intent.category.DEFAULT"/>
                <data android:mimeType="text/plain"/>
            </intent-filter>
        </activity>
        <activity android:name="com.banta.canonsync.BooksActivity" android:exported="false" android:enableOnBackInvokedCallback="true" android:windowSoftInputMode="adjustResize"
            android:configChanges="orientation|screenSize|smallestScreenSize|screenLayout|keyboard|keyboardHidden|navigation|uiMode|density"/>
        <activity android:name="com.banta.canonsync.Switch" android:exported="true" android:noHistory="true"
            android:excludeFromRecents="true" android:theme="@android:style/Theme.Translucent.NoTitleBar">
            <intent-filter>
                <action android:name="android.intent.action.VIEW"/>
                <category android:name="android.intent.category.DEFAULT"/>
                <category android:name="android.intent.category.BROWSABLE"/>
                <data android:scheme="$SCHEME"/>
            </intent-filter>
        </activity>
        <activity android:name="com.banta.gamecheck.MainActivity" android:exported="false" android:enableOnBackInvokedCallback="false"
            android:theme="@android:style/Theme.DeviceDefault.NoActionBar" android:windowSoftInputMode="adjustResize"
            android:configChanges="density|keyboardHidden|orientation|screenLayout|screenSize|smallestScreenSize|uiMode"/>
        <service android:name="com.banta.gamecheck.SyncSvc" android:exported="false" android:foregroundServiceType="dataSync"/>
        <receiver android:name="com.banta.gamecheck.AlarmRcv" android:exported="false"/>
        <receiver android:name="com.banta.gamecheck.BootRcv" android:exported="true">
            <intent-filter><action android:name="android.intent.action.BOOT_COMPLETED"/></intent-filter>
        </receiver>
        <activity android:name="it.banta.dwcheck.MainActivity" android:exported="false" android:enableOnBackInvokedCallback="false" android:hardwareAccelerated="true"
            android:theme="@android:style/Theme.Material.NoActionBar"
            android:configChanges="density|keyboard|keyboardHidden|navigation|orientation|screenLayout|screenSize|smallestScreenSize|uiMode" android:resizeableActivity="true"/>
        <receiver android:name="com.banta.canonsync.ActionReceiver" android:exported="false"/>
        <receiver android:name="com.banta.canonsync.Widget" android:exported="true" android:label="Saga: up next">
            <intent-filter><action android:name="android.appwidget.action.APPWIDGET_UPDATE"/></intent-filter>
            <meta-data android:name="android.appwidget.provider" android:resource="@xml/widget_info"/>
        </receiver>
        <receiver android:name="com.banta.canonsync.WidgetEpisodes" android:exported="true" android:label="Saga: next episodes">
            <intent-filter><action android:name="android.appwidget.action.APPWIDGET_UPDATE"/></intent-filter>
            <meta-data android:name="android.appwidget.provider" android:resource="@xml/widget_info_episodes"/>
        </receiver>
        <receiver android:name="com.banta.canonsync.WidgetUpcoming" android:exported="true" android:label="Saga: coming up">
            <intent-filter><action android:name="android.appwidget.action.APPWIDGET_UPDATE"/></intent-filter>
            <meta-data android:name="android.appwidget.provider" android:resource="@xml/widget_info_upcoming"/>
        </receiver>
        <receiver android:name="com.banta.canonsync.WidgetGames" android:exported="true" android:label="Saga: games">
            <intent-filter><action android:name="android.appwidget.action.APPWIDGET_UPDATE"/></intent-filter>
            <meta-data android:name="android.appwidget.provider" android:resource="@xml/widget_info_games"/>
        </receiver>
        <receiver android:name="com.banta.canonsync.WidgetBooks" android:exported="true" android:label="Saga: reading">
            <intent-filter><action android:name="android.appwidget.action.APPWIDGET_UPDATE"/></intent-filter>
            <meta-data android:name="android.appwidget.provider" android:resource="@xml/widget_info_books"/>
        </receiver>
        <receiver android:name="com.banta.canonsync.WidgetYear" android:exported="true" android:label="Saga: your year">
            <intent-filter><action android:name="android.appwidget.action.APPWIDGET_UPDATE"/></intent-filter>
            <meta-data android:name="android.appwidget.provider" android:resource="@xml/widget_info_year"/>
        </receiver>
        <service android:name="com.banta.canonsync.SyncJobService"
            android:permission="android.permission.BIND_JOB_SERVICE" android:exported="true"/>
    </application>
</manifest>
XML
cat > app/apktool.yml <<YML
!!brut.androlib.apk.ApkInfo
version: 2.9.3
apkFileName: CanonSync.apk
isFrameworkApk: false
usesFramework:
  ids:
  - 1
  tag: null
sdkInfo:
  minSdkVersion: 26
  targetSdkVersion: 36
packageInfo:
  forcedPackageId: 127
  renameManifestPackage: null
versionInfo:
  versionCode: $VERSION_CODE
  versionName: '$VERSION_NAME'
resourcesAreCompressed: false
sharedLibrary: false
sparseResources: false
doNotCompress:
- resources.arsc
- png
- woff2
YML
java -jar tools/apktool.jar b app -o out/unsigned.apk
python3 scripts/zipalign.py out/unsigned.apk out/aligned.apk
python3 scripts/checkalign.py out/aligned.apk
java -jar tools/apksigner.jar sign --ks "$KS" --ks-key-alias upload --ks-pass env:KSPW --key-pass env:KSPW \
  --min-sdk-version 26 --v1-signing-enabled true --v2-signing-enabled true --v3-signing-enabled true --out out/CanonSync.apk out/aligned.apk
java -jar tools/apksigner.jar verify --verbose --print-certs out/CanonSync.apk
python3 scripts/checkalign.py out/CanonSync.apk
tools/aapt2 dump badging out/CanonSync.apk
if [ "$EDITION" = blank ]; then
  # nothing of Banta's may be inside the shareable APK
  rm -rf out/check && mkdir out/check && (cd out/check && unzip -q ../CanonSync.apk)
  if grep -rliE "$LEAKS" out/check; then echo "PERSONAL DATA FOUND IN BLANK BUILD"; exit 1; fi
  if find out/check -name mine.js -o -name gc-mine.js -o -name dw-mine.js | grep -q .; then echo "PERSONAL DATA FOUND IN BLANK BUILD (mine files)"; exit 1; fi
  rm -rf out/check; echo "blank build: no personal data found"
fi
