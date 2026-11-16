package com.banta.canonsync;

import android.net.Uri;
import android.app.Activity;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowInsets;
import android.widget.FrameLayout;
import android.webkit.CookieManager;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.ValueCallback;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

public class MainActivity extends Activity {
    static final int BG = 0xFF0E0B1A;
    static volatile String shared = null;     // text from Share to Saga, picked up by the page
    static volatile boolean foreground = false; // the background job skips while the app is open
    static volatile String pendingOauth = null; // 0.6.6: …://oauth/itad?code=… waiting for the page
    WebView web;
    FrameLayout root; // holds the page (or the sign-in browser); padded for the system bars on Android 15+
    WebView inApp; // visible browser used for signing in to IMDb
    Bridge bridge;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        requestWindowFeature(1); // Window.FEATURE_NO_TITLE
        try {
            getWindow().setStatusBarColor(BG);
            getWindow().setNavigationBarColor(BG);
        } catch (Throwable ignored) {
        }
        try {
            CookieManager.getInstance().setAcceptCookie(true);
        } catch (Throwable ignored) {
        }
        takeShare(getIntent());
        takeOauth(getIntent());
        web = new WebView(this);
        web.setBackgroundColor(BG);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(true);
        // 0.6.5: follow Android's font size (Settings › Display › Font size), within limits the layout handles
        float fs = 1f;
        try { fs = getResources().getConfiguration().fontScale; } catch (Throwable t) { fs = 1f; }
        s.setTextZoom(Math.max(85, Math.min(160, Math.round(fs * 100))));
        bridge = new Bridge(this, this, web, null);
        web.addJavascriptInterface(bridge, "Android");
        web.addJavascriptInterface(new Shared(this, appName()), "Banta");
        web.setWebViewClient(new LocalOnly(this));
        web.setWebChromeClient(new Chrome(this));
        String h = tabHash(getIntent());
        web.loadUrl("file:///android_asset/" + (h.length() > 1 ? "index.html" + h : startPage()));
        root = new FrameLayout(this);
        root.setBackgroundColor(BG);
        root.addView(web);
        setContentView(root);
        // Android 15+ draws apps behind the status and navigation bars: keep the page clear of them and of the keyboard
        if (Build.VERSION.SDK_INT >= 35) {
            try {
                root.setOnApplyWindowInsetsListener(new Pad());
                root.requestApplyInsets();
            } catch (Throwable ignored) {
            }
        }
        // Android 13+ sends Back to a callback instead of onBackPressed (always, for apps targeting Android 16)
        if (Build.VERSION.SDK_INT >= 33) BackCb.register(this);
        if (Build.VERSION.SDK_INT >= 33) askNotificationsOnce();
    }

    // Android 13+: notifications need the person's yes. Asked once, on the first start; Settings can ask again.
    void askNotificationsOnce() {
        try {
            java.io.File flag = new java.io.File(getFilesDir(), "asked_notifications");
            if (flag.exists() || checkSelfPermission("android.permission.POST_NOTIFICATIONS") == 0) return;
            flag.createNewFile();
            requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"}, 4343);
        } catch (Throwable ignored) {
        }
    }

    static final class Pad implements View.OnApplyWindowInsetsListener {
        public WindowInsets onApplyWindowInsets(View v, WindowInsets in) {
            try {
                android.graphics.Insets i = in.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
                v.setPadding(i.left, i.top, i.right, i.bottom);
            } catch (Throwable ignored) {
            }
            return in;
        }
    }

    // only loaded on Android 13+, where the callback classes exist
    static final class BackCb implements android.window.OnBackInvokedCallback {
        final MainActivity a;

        BackCb(MainActivity a) {
            this.a = a;
        }

        static void register(MainActivity a) {
            try {
                a.getOnBackInvokedDispatcher().registerOnBackInvokedCallback(0, new BackCb(a));
            } catch (Throwable ignored) {
            }
        }

        public void onBackInvoked() {
            a.onBackPressed();
        }
    }

    // BooksActivity reuses this screen with its own page.
    String startPage() {
        return "index.html";
    }

    String appName() {
        return "canon";
    }

    // Camera for the barcode scanner: the page asks, Android asks the person once, then the page gets the camera.
    static final int CAMERA = 7101;
    PermissionRequest pendingCamera;

    // The app's own pages are the only thing this WebView (which has the Android bridge) may show: any other
    // address opens in the phone's browser, so a stray link can never reach the bridge, the files or the keys.
    static class LocalOnly extends WebViewClient {
        final MainActivity a;

        LocalOnly(MainActivity a) {
            this.a = a;
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, String url) {
            if (url == null || url.startsWith("file:///android_asset/") || url.startsWith("about:") || url.startsWith("javascript:")) return false;
            try {
                a.startActivity(new Intent("android.intent.action.VIEW", Uri.parse(url)));
            } catch (Throwable ignored) {
            }
            return true;
        }
    }

    static class Chrome extends WebChromeClient {
        final MainActivity a;

        Chrome(MainActivity a) {
            this.a = a;
        }

        @Override
        public void onPermissionRequest(PermissionRequest r) {
            try {
                if (a.checkSelfPermission("android.permission.CAMERA") == 0) {
                    r.grant(r.getResources());
                } else {
                    a.pendingCamera = r;
                    a.requestPermissions(new String[]{"android.permission.CAMERA"}, CAMERA);
                }
            } catch (Throwable t) {
                try {
                    r.deny();
                } catch (Throwable ignored) {
                }
            }
        }
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] results) {
        if (code != CAMERA || pendingCamera == null) return;
        PermissionRequest r = pendingCamera;
        pendingCamera = null;
        try {
            if (results != null && results.length > 0 && results[0] == 0) r.grant(r.getResources());
            else r.deny();
        } catch (Throwable ignored) {
        }
    }

    static boolean takeShare(Intent i) {
        try {
            if (i != null && "android.intent.action.SEND".equals(i.getAction())) {
                String t = i.getStringExtra("android.intent.extra.TEXT");
                if (t != null && t.length() > 0) {
                    shared = t;
                    return true;
                }
            }
        } catch (Throwable ignored) {
        }
        return false;
    }

    // 0.6.6: a sign-in redirect handed over by Switch (extra "oauth")
    boolean takeOauth(Intent i) {
        String u = i == null ? null : i.getStringExtra("oauth");
        if (u == null || u.length() == 0) return false;
        pendingOauth = u;
        i.removeExtra("oauth");
        return true;
    }

    static String tabHash(Intent i) {
        String tab = i == null ? null : i.getStringExtra("tab");
        return tab == null ? "" : "#" + tab.replaceAll("[^a-z]", "");
    }

    @Override
    protected void onResume() {
        super.onResume();
        foreground = true;
        if (web != null) web.evaluateJavascript("window.__resumed && window.__resumed()", null);
    }

    @Override
    protected void onPause() {
        foreground = false;
        // anything not yet written is written now (the background job reads these files)
        try {
            if (web != null) web.evaluateJavascript("window.__paused && window.__paused()", null);
        } catch (Throwable ignored) {
        }
        super.onPause();
    }

    // Tapping a notification while the app is already running.
    @Override
    protected void onNewIntent(Intent i) {
        super.onNewIntent(i);
        setIntent(i);
        if (takeShare(i) && web != null) web.evaluateJavascript("window.__sharePoll && window.__sharePoll()", null);
        if (takeOauth(i) && web != null) web.evaluateJavascript("window.__oauthPoll && window.__oauthPoll()", null);
        String h = tabHash(i);
        if (web != null && h.length() > 1) {
            web.evaluateJavascript("window.__openTab && window.__openTab('" + h.substring(1) + "')", null);
        }
    }

    void openInApp(String url) {
        closeInApp(false);
        inApp = new WebView(this);
        WebSettings s = inApp.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        inApp.setWebViewClient(new WebViewClient());
        inApp.loadUrl(url);
        show(inApp);
    }

    void closeInApp(boolean notify) {
        if (inApp == null) return;
        show(web);
        try {
            inApp.stopLoading();
            inApp.destroy();
        } catch (Throwable ignored) {
        }
        inApp = null;
        try {
            CookieManager.getInstance().flush();
        } catch (Throwable ignored) {
        }
        if (notify) web.evaluateJavascript("window.__browserClosed && window.__browserClosed()", null);
    }

    void show(View v) {
        if (root == null) {
            setContentView(v);
            return;
        }
        root.removeAllViews();
        root.addView(v);
    }

    @Override
    public void onBackPressed() {
        if (inApp != null) {
            closeInApp(true);
            return;
        }
        evalBack();
    }

    @SuppressWarnings("unchecked")
    void evalBack() {
        web.evaluateJavascript("(window.__back ? window.__back() : false)", new BackHandler(this));
    }

    void superBack() {
        finish();
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == Bridge.PICK) {
            bridge.onPicked(resultCode, data);
        } else if (requestCode == Bridge.SAVE) {
            bridge.onSaved(resultCode, data);
        } else if (requestCode == Bridge.BACKUP) {
            bridge.onBackupPicked(resultCode, data);
        }
    }

    @SuppressWarnings("rawtypes")
    static class BackHandler implements ValueCallback {
        final MainActivity a;

        BackHandler(MainActivity a) {
            this.a = a;
        }

        public void onReceiveValue(Object v) {
            if (!"true".equals(String.valueOf(v))) a.superBack();
        }
    }
}
