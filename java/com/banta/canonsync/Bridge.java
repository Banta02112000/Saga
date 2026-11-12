package com.banta.canonsync;

import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.view.ViewGroup;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

public class Bridge {
    static final int PICK = 4242;
    static final String UA = "Saga/0.5.4.4 (Android)";
    final Context ctx;
    final MainActivity act;       // null when running inside the background job
    final SyncJobService job;     // null in the app
    final WebView web;
    final Handler main = new Handler(Looper.getMainLooper());
    final Map<String, String> results = new ConcurrentHashMap<String, String>();
    volatile String pendingPick = null;

    Bridge(Context ctx, MainActivity act, WebView web, SyncJobService job) {
        this.ctx = ctx;
        this.act = act;
        this.web = web;
        this.job = job;
    }

    // ---------- API keys and tokens: encrypted with a Keystore key ("!" = the Keystore can't be used here) ----------
    @JavascriptInterface
    public String secretsLoad() {
        String s = Secrets.load(ctx);
        return s == null ? "!" : s;
    }

    @JavascriptInterface
    public boolean secretsSave(String text) {
        return Secrets.save(ctx, text == null ? "" : text);
    }

    // ---------- storage ----------
    @JavascriptInterface
    public String load(String name) {
        try {
            File f = new File(ctx.getFilesDir(), safe(name));
            // the main file can be missing for a moment while the daily copy is being rotated: the copy is used then
            if (!f.exists() || f.length() == 0) f = new File(ctx.getFilesDir(), safe(name) + ".bak");
            if (!f.exists()) return "";
            return new String(readAll(new FileInputStream(f)), "UTF-8");
        } catch (Throwable t) {
            return "";
        }
    }

    // Changes whenever the file is rewritten (by this screen or the background sync), so a resume can skip re-reading it.
    @JavascriptInterface
    public String stamp(String name) {
        try {
            File f = new File(ctx.getFilesDir(), safe(name));
            return f.exists() ? f.lastModified() + ":" + f.length() : "";
        } catch (Throwable t) {
            return "";
        }
    }

    @JavascriptInterface
    public boolean save(String name, String text) {
        try {
            File dir = ctx.getFilesDir();
            File tmp = new File(dir, safe(name) + ".tmp");
            OutputStream o = new FileOutputStream(tmp);
            o.write(text.getBytes("UTF-8"));
            o.close();
            // once a day the previous good file is kept as name.bak, so a damaged file can be recovered
            File main = new File(dir, safe(name)), bak = new File(dir, safe(name) + ".bak");
            long now = System.currentTimeMillis();
            if (name.endsWith(".json") && main.exists() && main.length() > 2 && (!bak.exists() || now - bak.lastModified() > 86400000L)) {
                bak.delete();
                if (main.renameTo(bak)) bak.setLastModified(now);
            }
            return tmp.renameTo(main);
        } catch (Throwable t) {
            return false;
        }
    }

    static String safe(String n) {
        return n.replaceAll("[^A-Za-z0-9._-]", "_");
    }

    // ---------- http ----------
    @JavascriptInterface
    public void http(String id, String method, String url, String headers, String body) {
        new Thread(new HttpTask(this, id, method, url, headers, body)).start();
    }

    @JavascriptInterface
    public String take(String id) {
        String r = results.remove(id);
        return r == null ? "" : r;
    }

    // Big results (a large export) are read in pieces: one huge string through the bridge can fail without a word.
    @JavascriptInterface
    public int takeLength(String id) {
        String r = results.get(id);
        return r == null ? 0 : r.length();
    }

    @JavascriptInterface
    public String takePart(String id, int start, int end) {
        String r = results.get(id);
        if (r == null) return "";
        int e = Math.min(end, r.length());
        String part = r.substring(Math.min(start, e), e);
        if (e >= r.length()) results.remove(id);
        return part;
    }

    // Main-thread Handler, not web.post(): an off-screen WebView (background job) never runs View.post callbacks.
    void deliver(String fn, String id, String json) {
        results.put(id, json);
        main.post(new JsCall(web, "window." + fn + "(" + q(id) + ")"));
    }

    static class HttpTask implements Runnable {
        final Bridge b;
        final String id, method, url, headers, body;

        HttpTask(Bridge b, String id, String method, String url, String headers, String body) {
            this.b = b;
            this.id = id;
            this.method = method;
            this.url = url;
            this.headers = headers;
            this.body = body;
        }

        public void run() {
            StringBuilder sb = new StringBuilder();
            HttpURLConnection c = null;
            try {
                c = (HttpURLConnection) new URL(url).openConnection();
                c.setConnectTimeout(25000);
                c.setReadTimeout(600000); // long AI answers
                c.setInstanceFollowRedirects(true);
                c.setRequestMethod(method);
                c.setRequestProperty("User-Agent", UA);
                if (headers != null) {
                    for (String line : headers.split("\n")) {
                        int i = line.indexOf(':');
                        if (i > 0) c.setRequestProperty(line.substring(0, i).trim(), line.substring(i + 1).trim());
                    }
                }
                if (body != null && body.length() > 0) {
                    c.setDoOutput(true);
                    OutputStream o = c.getOutputStream();
                    o.write(body.getBytes("UTF-8"));
                    o.close();
                }
                int code = c.getResponseCode();
                InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
                String text = in == null ? "" : new String(readAll(in), "UTF-8");
                sb.append("{\"status\":").append(code).append(",\"headers\":{");
                boolean first = true;
                for (String h : new String[]{"Retry-After", "X-Pagination-Page-Count", "Content-Type"}) {
                    String v = c.getHeaderField(h);
                    if (v == null) continue;
                    if (!first) sb.append(',');
                    sb.append(q(h.toLowerCase())).append(':').append(q(v));
                    first = false;
                }
                sb.append("},\"body\":").append(q(text)).append('}');
            } catch (Throwable t) {
                sb.setLength(0);
                sb.append("{\"status\":0,\"headers\":{},\"body\":\"\",\"error\":").append(q(String.valueOf(t))).append('}');
            } finally {
                if (c != null) c.disconnect();
            }
            b.deliver("__httpDone", id, sb.toString());
        }
    }

    // ---------- saving a file where the person chooses ----------
    static final int SAVE = 7003;
    String pendingSave, pendingSaveText;

    @JavascriptInterface
    public void saveAs(String id, String filename, String text) {
        if (act == null) {
            deliver("__saveDone", id, "false");
            return;
        }
        pendingSave = id;
        pendingSaveText = text;
        main.post(new SaveStarter(act, filename));
    }

    static class SaveStarter implements Runnable {
        final MainActivity act;
        final String name;

        SaveStarter(MainActivity act, String name) {
            this.act = act;
            this.name = name;
        }

        public void run() {
            try {
                Intent i = new Intent("android.intent.action.CREATE_DOCUMENT");
                i.addCategory("android.intent.category.OPENABLE");
                i.setType("application/json");
                i.putExtra("android.intent.extra.TITLE", name);
                act.startActivityForResult(i, SAVE);
            } catch (Throwable t) {
                act.bridge.onSaved(0, null);
            }
        }
    }

    void onSaved(int resultCode, Intent data) {
        String id = pendingSave, text = pendingSaveText;
        pendingSave = null;
        pendingSaveText = null;
        boolean ok = false;
        try {
            if (resultCode == -1 && data != null && data.getData() != null && text != null) {
                OutputStream o = ctx.getContentResolver().openOutputStream(data.getData());
                o.write(text.getBytes("UTF-8"));
                o.close();
                ok = true;
            }
        } catch (Throwable ignored) {
        }
        if (id != null) deliver("__saveDone", id, ok ? "true" : "false");
    }

    // ---------- the automatic backup file: picked once, rewritten by the app ----------
    static final int BACKUP = 7004;

    @JavascriptInterface
    public void pickBackupFile(String filename) {
        if (act != null) main.post(new BackupStarter(act, filename));
    }

    static class BackupStarter implements Runnable {
        final MainActivity act;
        final String name;

        BackupStarter(MainActivity act, String name) {
            this.act = act;
            this.name = name;
        }

        public void run() {
            try {
                Intent i = new Intent("android.intent.action.CREATE_DOCUMENT");
                i.addCategory("android.intent.category.OPENABLE");
                i.setType("application/json");
                i.putExtra("android.intent.extra.TITLE", name);
                act.startActivityForResult(i, BACKUP);
            } catch (Throwable ignored) {
            }
        }
    }

    void onBackupPicked(int resultCode, Intent data) {
        String uri = "";
        try {
            if (resultCode == -1 && data != null && data.getData() != null) {
                try {
                    ctx.getContentResolver().takePersistableUriPermission(data.getData(), 3); // READ | WRITE
                } catch (Throwable ignored) {
                }
                uri = data.getData().toString();
            }
        } catch (Throwable ignored) {
        }
        if (web != null) web.evaluateJavascript("window.__backupPicked && window.__backupPicked(" + q(uri) + ")", null);
    }

    @JavascriptInterface
    public boolean writeUri(String uri, String text) {
        try {
            OutputStream o = ctx.getContentResolver().openOutputStream(Uri.parse(uri), "wt");
            if (o == null) return false;
            o.write(text.getBytes("UTF-8"));
            o.close();
            return true;
        } catch (Throwable t) {
            return false;
        }
    }

    // ---------- Share to Saga: text or a link shared from another app ----------
    // the status and navigation bars follow the theme (dark icons on the light theme)
    @JavascriptInterface
    public void setBars(String color, boolean light) {
        if (act == null) return;
        act.runOnUiThread(new Bars(act, color, light));
    }

    // a named class rather than an anonymous one: this build's dexer can't read the parameter data javac writes for those
    static final class Bars implements Runnable {
        final MainActivity a;
        final String color;
        final boolean light;

        Bars(MainActivity a, String color, boolean light) {
            this.a = a;
            this.color = color;
            this.light = light;
        }

        public void run() {
            try {
                String h = color.replace("#", "").trim();
                int c = 0xFF000000 | Integer.parseInt(h.length() == 3 ? expand(h) : h, 16);
                a.getWindow().setStatusBarColor(c);
                a.getWindow().setNavigationBarColor(c);
                if (a.web != null) a.web.setBackgroundColor(c);
                if (a.root != null) a.root.setBackgroundColor(c); // shows under the bars on Android 15+
                int f = a.getWindow().getDecorView().getSystemUiVisibility();
                f = light ? (f | 0x2000 | 0x10) : (f & ~0x2000 & ~0x10); // LIGHT_STATUS_BAR, LIGHT_NAVIGATION_BAR
                a.getWindow().getDecorView().setSystemUiVisibility(f);
            } catch (Throwable ignored) {
            }
        }
    }

    static String expand(String c) {
        String h = c.replace("#", "").trim();
        return "" + h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2);
    }

    @JavascriptInterface
    public String takeShared() {
        String s = MainActivity.shared;
        MainActivity.shared = null;
        return s == null ? "" : s;
    }

    // a notification with a button (Mark watched); the tap is written to pending_actions.json for the app to apply
    @JavascriptInterface
    public void notifyAction(int id, String title, String text, String tab, String label, String payload) {
        Notifier.post(ctx, id, title, text, tab, label, payload);
    }

    // ---------- file picking ----------
    @JavascriptInterface
    public void pick(String id, boolean multiple) {
        pickSkip(id, multiple, "");
    }

    // skip: a regex of ZIP entries not to read (a Trakt export's history files can be hundreds of MB and aren't used)
    String skipZip = "";

    @JavascriptInterface
    public void pickSkip(String id, boolean multiple, String skip) {
        skipZip = skip == null ? "" : skip;
        if (act == null) {
            deliver("__pickDone", id, "[]");
            return;
        }
        pendingPick = id;
        main.post(new PickStarter(act, multiple));
    }

    static class PickStarter implements Runnable {
        final MainActivity act;
        final boolean multiple;

        PickStarter(MainActivity act, boolean multiple) {
            this.act = act;
            this.multiple = multiple;
        }

        public void run() {
            Intent i = new Intent("android.intent.action.OPEN_DOCUMENT");
            i.addCategory("android.intent.category.OPENABLE");
            i.setType("*/*");
            i.putExtra("android.intent.extra.ALLOW_MULTIPLE", multiple);
            act.startActivityForResult(i, PICK);
        }
    }

    void onPicked(int resultCode, Intent data) {
        String id = pendingPick;
        pendingPick = null;
        if (id == null) return;
        List<Uri> uris = new ArrayList<Uri>();
        if (resultCode == -1 && data != null) { // RESULT_OK
            ClipData clip = data.getClipData();
            if (clip != null) {
                for (int i = 0; i < clip.getItemCount(); i++) uris.add(clip.getItemAt(i).getUri());
            } else if (data.getData() != null) {
                uris.add(data.getData());
            }
        }
        new Thread(new ReadTask(this, id, uris, skipZip)).start();
    }

    static class ReadTask implements Runnable {
        final Bridge b;
        final String id;
        final List<Uri> uris;

        final java.util.regex.Pattern skip;

        ReadTask(Bridge b, String id, List<Uri> uris, String skip) {
            this.b = b;
            this.id = id;
            this.uris = uris;
            java.util.regex.Pattern p = null;
            try { if (skip != null && skip.length() > 0) p = java.util.regex.Pattern.compile(skip, java.util.regex.Pattern.CASE_INSENSITIVE); } catch (Throwable ignored) { }
            this.skip = p;
        }

        public void run() {
            StringBuilder sb = new StringBuilder("[");
            for (int n = 0; n < uris.size(); n++) {
                Uri u = uris.get(n);
                if (n > 0) sb.append(',');
                String name = b.displayName(u);
                try {
                    byte[] bytes = readAll(b.ctx.getContentResolver().openInputStream(u));
                    // MyAnimeList and others hand out .gz files: unpack them here
                    if (bytes.length > 2 && (bytes[0] & 0xff) == 0x1f && (bytes[1] & 0xff) == 0x8b) {
                        bytes = readAll(new java.util.zip.GZIPInputStream(new java.io.ByteArrayInputStream(bytes)));
                        if (name.toLowerCase().endsWith(".gz")) name = name.substring(0, name.length() - 3);
                    }
                    sb.append("{\"name\":").append(q(name));
                    if (name.toLowerCase().endsWith(".zip") || (bytes.length > 3 && bytes[0] == 'P' && bytes[1] == 'K'
                            && bytes[2] == 3 && bytes[3] == 4)) {
                        sb.append(",\"zip\":{");
                        ZipInputStream z = new ZipInputStream(new java.io.ByteArrayInputStream(bytes));
                        ZipEntry e;
                        boolean first = true;
                        StringBuilder other = new StringBuilder(); // entries that aren't text data, so imports can say what they skipped
                        while ((e = z.getNextEntry()) != null) {
                            String en = e.getName();
                            String el = en.toLowerCase();
                            if (e.isDirectory()) continue;
                            if (skip != null && skip.matcher(en).find()) {
                                if (other.length() > 0) other.append(',');
                                other.append(q(en));
                                continue;
                            }
                            if (!(el.endsWith(".json") || el.endsWith(".csv") || el.endsWith(".tsv") || el.endsWith(".txt") || el.endsWith(".ndjson") || el.endsWith(".xml"))) {
                                if (other.length() > 0) other.append(',');
                                other.append(q(en));
                                continue;
                            }
                            byte[] eb = readAll(z, false);
                            if (!first) sb.append(',');
                            sb.append(q(en)).append(':').append(q(new String(eb, "UTF-8")));
                            first = false;
                        }
                        z.close();
                        sb.append("},\"zipOther\":[").append(other).append(']');
                    } else {
                        sb.append(",\"text\":").append(q(new String(bytes, "UTF-8")));
                    }
                    sb.append('}');
                } catch (Throwable t) {
                    sb.append("{\"name\":").append(q(name)).append(",\"error\":").append(q(String.valueOf(t))).append('}');
                }
            }
            sb.append(']');
            b.deliver("__pickDone", id, sb.toString());
        }
    }

    String displayName(Uri u) {
        Cursor c = null;
        try {
            c = ctx.getContentResolver().query(u, null, null, null, null);
            if (c != null && c.moveToFirst()) {
                int i = c.getColumnIndex("_display_name");
                if (i >= 0) {
                    String s = c.getString(i);
                    if (s != null) return s;
                }
            }
        } catch (Throwable ignored) {
        } finally {
            try {
                if (c != null) c.close();
            } catch (Throwable ignored) {
            }
        }
        String s = u.getLastPathSegment();
        return s == null ? "file" : s;
    }

    // ---------- hidden browser (pages that block plain HTTP clients) ----------
    // Loads url in an invisible WebView (real Chrome engine, shared cookies), then evaluates `probe`
    // every second until it returns something other than null/"" or the timeout passes.
    @JavascriptInterface
    public void browse(String id, String url, String probe, int timeoutMs) {
        if (act == null) {
            deliver("__httpDone", id, "{\"status\":0,\"value\":null,\"error\":\"the in-app browser only works with the app open\"}");
            return;
        }
        main.post(new BrowseTask(this, id, url, probe, timeoutMs));
    }

    static class BrowseTask implements Runnable {
        final Bridge b;
        final String id, url, probe;
        final int timeoutMs;
        WebView w;
        long started;
        boolean done = false;

        BrowseTask(Bridge b, String id, String url, String probe, int timeoutMs) {
            this.b = b;
            this.id = id;
            this.url = url;
            this.probe = probe;
            this.timeoutMs = timeoutMs;
        }

        public void run() {
            try {
                w = new WebView(b.act);
                WebSettings s = w.getSettings();
                s.setJavaScriptEnabled(true);
                s.setDomStorageEnabled(true);
                s.setBlockNetworkImage(true);
                w.setWebViewClient(new WebViewClient());
                // Full-size so pages lay out and lazy-load like on screen, but kept behind the app's own view:
                // invisible and never receives taps.
                w.setAlpha(0f);
                b.act.addContentView(w, new ViewGroup.LayoutParams(-1, -1)); // MATCH_PARENT
                b.web.bringToFront();
                started = System.currentTimeMillis();
                w.loadUrl(url);
                w.postDelayed(new Poll(this), 1500);
            } catch (Throwable t) {
                finish("{\"status\":0,\"value\":null,\"error\":" + q(String.valueOf(t)) + "}");
            }
        }

        @SuppressWarnings("unchecked")
        void poll() {
            if (done) return;
            w.evaluateJavascript(probe, new ProbeResult(this));
        }

        void onProbe(String v) {
            if (done) return;
            if (v != null && !"null".equals(v) && !"\"\"".equals(v) && v.length() > 0) {
                finish("{\"status\":200,\"url\":" + q(String.valueOf(w.getUrl())) + ",\"value\":" + v + "}");
            } else if (System.currentTimeMillis() - started > timeoutMs) {
                timeout();
            } else {
                w.postDelayed(new Poll(this), 1000);
            }
        }

        @SuppressWarnings("unchecked")
        void timeout() {
            w.evaluateJavascript("(document.title || '') + ' | ' + location.href", new TitleResult(this));
        }

        void onTitle(String v) {
            finish("{\"status\":0,\"value\":null,\"error\":\"timeout\",\"title\":" + (v == null ? "null" : v) + "}");
        }

        void finish(String json) {
            if (done) return;
            done = true;
            try {
                if (w != null) {
                    w.stopLoading();
                    Object p = w.getParent();
                    if (p instanceof ViewGroup) ((ViewGroup) p).removeView(w);
                    w.destroy();
                }
            } catch (Throwable ignored) {
            }
            b.deliver("__httpDone", id, json);
        }
    }

    static class Poll implements Runnable {
        final BrowseTask t;

        Poll(BrowseTask t) {
            this.t = t;
        }

        public void run() {
            t.poll();
        }
    }

    @SuppressWarnings("rawtypes")
    static class ProbeResult implements ValueCallback {
        final BrowseTask t;

        ProbeResult(BrowseTask t) {
            this.t = t;
        }

        public void onReceiveValue(Object v) {
            t.onProbe(v == null ? null : String.valueOf(v));
        }
    }

    @SuppressWarnings("rawtypes")
    static class TitleResult implements ValueCallback {
        final BrowseTask t;

        TitleResult(BrowseTask t) {
            this.t = t;
        }

        public void onReceiveValue(Object v) {
            t.onTitle(v == null ? null : String.valueOf(v));
        }
    }

    // Visible in-app browser, e.g. to sign in to IMDb. Back closes it.
    @JavascriptInterface
    public void openInApp(String url) {
        if (act != null) main.post(new InAppOpener(act, url));
    }

    static class InAppOpener implements Runnable {
        final MainActivity act;
        final String url;

        InAppOpener(MainActivity act, String url) {
            this.act = act;
            this.url = url;
        }

        public void run() {
            act.openInApp(url);
        }
    }

    // ---------- misc ----------
    @JavascriptInterface
    public void openUrl(String url) {
        main.post(new UrlOpener(this, url));
    }

    static class UrlOpener implements Runnable {
        final Bridge b;
        final String url;

        UrlOpener(Bridge b, String url) {
            this.b = b;
            this.url = url;
        }

        public void run() {
            try {
                Intent i = new Intent("android.intent.action.VIEW", Uri.parse(url));
                if (b.act != null) b.act.startActivity(i);
                else b.ctx.startActivity(i.addFlags(0x10000000)); // FLAG_ACTIVITY_NEW_TASK
            } catch (Throwable ignored) {
            }
        }
    }

    @JavascriptInterface
    public void copy(String text) {
        main.post(new Copier(ctx, text));
    }

    static class Copier implements Runnable {
        final Context ctx;
        final String text;

        Copier(Context ctx, String text) {
            this.ctx = ctx;
            this.text = text;
        }

        public void run() {
            try {
                ClipboardManager cm = (ClipboardManager) ctx.getSystemService("clipboard");
                cm.setPrimaryClip(ClipData.newPlainText("Saga", text));
            } catch (Throwable ignored) {
            }
        }
    }

    // Reads the clipboard for the Gemini app copy-and-paste flow (the app is in the foreground when this runs).
    @JavascriptInterface
    public String paste() {
        try {
            ClipboardManager cm = (ClipboardManager) ctx.getSystemService("clipboard");
            ClipData c = cm.getPrimaryClip();
            if (c == null || c.getItemCount() == 0) return "";
            CharSequence t = c.getItemAt(0).coerceToText(ctx);
            return t == null ? "" : t.toString();
        } catch (Throwable e) {
            return "";
        }
    }

    @JavascriptInterface
    public String sha256url(String s) {
        try {
            byte[] d = MessageDigest.getInstance("SHA-256").digest(s.getBytes("UTF-8"));
            return Base64.getUrlEncoder().withoutPadding().encodeToString(d);
        } catch (Throwable t) {
            return "";
        }
    }

    @JavascriptInterface
    public String randomUrl(int n) {
        byte[] b = new byte[n];
        new SecureRandom().nextBytes(b);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(b);
    }

    @JavascriptInterface
    public String version() {
        return "0.5.4.4";
    }

    // ---------- background sync & notifications ----------
    @JavascriptInterface
    public void notify(int id, String title, String text, String tab) {
        Notifier.post(ctx, id, title, text, tab);
    }

    // the old Games / Doctor Who screens, kept for one version so their data can be brought over again
    @JavascriptInterface
    public void openClassic(String app) {
        try {
            Intent i = new Intent().setClassName(ctx, Switch.target(app));
            i.addFlags(0x10000000);
            ctx.startActivity(i);
        } catch (Throwable ignored) {
        }
    }

    @JavascriptInterface
    public void openApp(String app) {
        if (act != null) main.post(new AppOpener(act, app));
    }

    static class AppOpener implements Runnable {
        final MainActivity act;
        final String app;

        AppOpener(MainActivity act, String app) {
            this.act = act;
            this.app = app;
        }

        public void run() {
            try {
                Switch.open(act, app);
                act.overridePendingTransition(0, 0);
            } catch (Throwable ignored) {
            }
        }
    }

    @JavascriptInterface
    public void status(String title, String text, int pct, boolean ongoing) {
        Notifier.status(ctx, title, text, pct, ongoing);
    }

    @JavascriptInterface
    public void clearStatus() {
        Notifier.cancelStatus(ctx);
    }

    @JavascriptInterface
    public boolean setBackground(boolean on, int hours) {
        return Scheduler.set(ctx, on, hours);
    }

    @JavascriptInterface
    public void requestNotifications() {
        if (act != null) main.post(new PermissionAsker(act));
    }

    static class PermissionAsker implements Runnable {
        final MainActivity act;

        PermissionAsker(MainActivity act) {
            this.act = act;
        }

        public void run() {
            try {
                act.requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"}, 4343);
            } catch (Throwable ignored) {
            }
        }
    }

    @JavascriptInterface
    public boolean isBackground() {
        return job != null;
    }

    // Called by bg.js when the background run is finished.
    @JavascriptInterface
    public void done(String report) {
        if (job != null) main.post(new JobDone(job));
    }

    static class JobDone implements Runnable {
        final SyncJobService job;

        JobDone(SyncJobService job) {
            this.job = job;
        }

        public void run() {
            job.finishFromJs();
        }
    }

    // ---------- helpers ----------
    static class JsCall implements Runnable {
        final WebView web;
        final String js;

        JsCall(WebView web, String js) {
            this.web = web;
            this.js = js;
        }

        public void run() {
            web.evaluateJavascript(js, null);
        }
    }

    static byte[] readAll(InputStream in) throws java.io.IOException {
        return readAll(in, true);
    }

    static byte[] readAll(InputStream in, boolean close) throws java.io.IOException {
        ByteArrayOutputStream o = new ByteArrayOutputStream();
        byte[] buf = new byte[65536];
        int n;
        while ((n = in.read(buf)) > 0) o.write(buf, 0, n);
        if (close) in.close();
        return o.toByteArray();
    }

    static String q(String s) {
        StringBuilder sb = new StringBuilder(s.length() + 16);
        sb.append('"');
        for (int i = 0; i < s.length(); i++) {
            char ch = s.charAt(i);
            switch (ch) {
                case '"': sb.append("\\\""); break;
                case '\\': sb.append("\\\\"); break;
                case '\n': sb.append("\\n"); break;
                case '\r': sb.append("\\r"); break;
                case '\t': sb.append("\\t"); break;
                default:
                    if (ch < 0x20 || ch == 0x2028 || ch == 0x2029) {
                        String h = Integer.toHexString(ch);
                        sb.append("\\u");
                        for (int k = h.length(); k < 4; k++) sb.append('0');
                        sb.append(h);
                    } else sb.append(ch);
            }
        }
        return sb.append('"').toString();
    }
}
