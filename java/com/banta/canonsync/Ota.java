package com.banta.canonsync;

import android.content.Context;
import android.content.SharedPreferences;
import android.webkit.WebResourceResponse;

import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.KeyFactory;
import java.security.PublicKey;
import java.security.Signature;
import java.security.spec.X509EncodedKeySpec;
import java.util.Iterator;
import java.util.zip.GZIPInputStream;

// 0.6.9.5: screen updates without installing an APK. A bundle holds the app's pages and scripts (no keys, no
// personal data); it is used only if it's signed with Saga's update key (the private half never leaves the build
// machine), is newer than the installed app, and needs no newer Android shell than this one. Its files are served
// in place of the built-in ones (same addresses, so nothing saved changes); a file it doesn't have comes from the
// app as before. If a bundle fails to start three times, Saga goes back to its built-in screens by itself.
final class Ota {
    // what the Android side offers the pages; a bundle that needs more waits for a new APK
    static final int SHELL = 1;
    static final String PUB = "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE0cFR5t1IfuDcyiZqmjo/el+BP5k/wEglfjeAvyvZOt7ro2rUUihvsKOxSax0RltmZY4I+LrwkAeCtde2W2NJvA==";
    static final String ASSET = "file:///android_asset/";

    private static volatile File active;
    private static volatile boolean looked;

    static File base(Context c) {
        return new File(c.getFilesDir(), "ota");
    }

    static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences("ota", Context.MODE_PRIVATE);
    }

    static String apkVersion(Context c) {
        try {
            return c.getPackageManager().getPackageInfo(c.getPackageName(), 0).versionName;
        } catch (Throwable t) {
            return "0";
        }
    }

    // "0.6.9.5" > "0.6.9.4"
    static int compare(String a, String b) {
        String[] x = String.valueOf(a).split("\\."), y = String.valueOf(b).split("\\.");
        for (int i = 0; i < Math.max(x.length, y.length); i++) {
            int p = 0, q = 0;
            try { p = i < x.length ? Integer.parseInt(x[i].replaceAll("[^0-9]", "")) : 0; } catch (Throwable t) { p = 0; }
            try { q = i < y.length ? Integer.parseInt(y[i].replaceAll("[^0-9]", "")) : 0; } catch (Throwable t) { q = 0; }
            if (p != q) return p < q ? -1 : 1;
        }
        return 0;
    }

    // the folder of the bundle in use, or null (the built-in screens)
    static synchronized File active(Context c) {
        if (looked) return active;
        looked = true;
        active = null;
        try {
            SharedPreferences p = prefs(c);
            String v = p.getString("version", "");
            if (v.length() == 0) return null;
            File d = new File(base(c), v);
            if (!d.isDirectory() || compare(v, apkVersion(c)) <= 0 || p.getInt("shell", 99) > SHELL) return null;
            if (p.getInt("fails", 0) >= 3) { p.edit().putString("disabled", v).putString("version", "").apply(); return null; }
            active = d;
        } catch (Throwable t) {
            active = null;
        }
        return active;
    }

    // a page is starting with the bundle: counted until the page says it started fine (started())
    static void starting(Context c) {
        if (active(c) == null) return;
        SharedPreferences p = prefs(c);
        p.edit().putInt("fails", p.getInt("fails", 0) + 1).apply();
    }

    static void started(Context c) {
        prefs(c).edit().putInt("fails", 0).apply();
    }

    static void reset(Context c) {
        prefs(c).edit().putString("version", "").putInt("fails", 0).apply();
        synchronized (Ota.class) { looked = false; active = null; }
    }

    static String info(Context c) {
        try {
            File a = active(c);
            JSONObject o = new JSONObject();
            o.put("shell", SHELL);
            o.put("apk", apkVersion(c));
            o.put("active", a == null ? JSONObject.NULL : a.getName());
            o.put("disabled", prefs(c).getString("disabled", ""));
            return o.toString();
        } catch (Throwable t) {
            return "{}";
        }
    }

    static String mime(String n) {
        String l = n.toLowerCase();
        if (l.endsWith(".js")) return "text/javascript";
        if (l.endsWith(".css")) return "text/css";
        if (l.endsWith(".html")) return "text/html";
        if (l.endsWith(".json")) return "application/json";
        if (l.endsWith(".svg")) return "image/svg+xml";
        if (l.endsWith(".png")) return "image/png";
        if (l.endsWith(".woff2")) return "font/woff2";
        return "application/octet-stream";
    }

    // the bundle's copy of an app file, if it has one
    static WebResourceResponse serve(Context c, String url) {
        try {
            if (url == null || !url.startsWith(ASSET)) return null;
            File d = active(c);
            if (d == null) return null;
            String rel = url.substring(ASSET.length());
            int q = rel.indexOf('?'); if (q >= 0) rel = rel.substring(0, q);
            int h = rel.indexOf('#'); if (h >= 0) rel = rel.substring(0, h);
            if (!rel.matches("[A-Za-z0-9_./-]+") || rel.contains("..")) return null;
            File f = new File(d, rel);
            if (!f.isFile() || !f.getCanonicalPath().startsWith(d.getCanonicalPath() + File.separator)) return null;
            String m = mime(rel);
            return new WebResourceResponse(m, m.startsWith("text/") || m.endsWith("json") ? "UTF-8" : null, new FileInputStream(f));
        } catch (Throwable t) {
            return null;
        }
    }

    static byte[] fetch(String url) throws Exception {
        HttpURLConnection h = (HttpURLConnection) new URL(url).openConnection();
        h.setConnectTimeout(20000);
        h.setReadTimeout(60000);
        h.setRequestProperty("User-Agent", "Saga-Android");
        int code = h.getResponseCode();
        if (code != 200) throw new Exception("HTTP " + code + " for " + url);
        InputStream in = h.getInputStream();
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[65536];
        int n;
        while ((n = in.read(buf)) > 0) {
            out.write(buf, 0, n);
            if (out.size() > 40 * 1024 * 1024) throw new Exception("update too big");
        }
        in.close();
        return out.toByteArray();
    }

    static boolean verify(byte[] data, byte[] sig) {
        try {
            PublicKey k = KeyFactory.getInstance("EC").generatePublic(new X509EncodedKeySpec(android.util.Base64.decode(PUB, android.util.Base64.DEFAULT)));
            Signature s = Signature.getInstance("SHA256withECDSA");
            s.initVerify(k);
            s.update(data);
            return s.verify(sig);
        } catch (Throwable t) {
            return false;
        }
    }

    static void deleteTree(File f) {
        if (f == null || !f.exists()) return;
        File[] kids = f.listFiles();
        if (kids != null) for (File k : kids) deleteTree(k);
        f.delete();
    }

    // download, check and unpack; the new screens are used from the next start (or a reload)
    static String install(Context c, String bundleUrl, String sigUrl) {
        try {
            byte[] gz = fetch(bundleUrl);
            String sigText = new String(fetch(sigUrl), "UTF-8").trim();
            byte[] sig = android.util.Base64.decode(sigText, android.util.Base64.DEFAULT);
            if (!verify(gz, sig)) return "error:the update isn't signed with Saga's key, so it wasn't used";
            GZIPInputStream zin = new GZIPInputStream(new ByteArrayInputStream(gz));
            ByteArrayOutputStream raw = new ByteArrayOutputStream();
            byte[] buf = new byte[65536];
            int n;
            while ((n = zin.read(buf)) > 0) raw.write(buf, 0, n);
            JSONObject o = new JSONObject(raw.toString("UTF-8"));
            String v = o.getString("version");
            int shell = o.optInt("shell", 1);
            if (!v.matches("[0-9.]+")) return "error:bad version";
            if (shell > SHELL) return "shell:" + v;
            if (compare(v, apkVersion(c)) <= 0) return "old:" + v;
            File b = base(c), tmp = new File(b, v + ".part"), dir = new File(b, v);
            deleteTree(tmp);
            tmp.mkdirs();
            JSONObject files = o.getJSONObject("files");
            Iterator<String> it = files.keys();
            int count = 0;
            while (it.hasNext()) {
                String rel = it.next();
                if (!rel.matches("[A-Za-z0-9_./-]+") || rel.contains("..") || rel.startsWith("/")) return "error:bad file name in the update";
                File f = new File(tmp, rel);
                f.getParentFile().mkdirs();
                FileOutputStream out = new FileOutputStream(f);
                out.write(android.util.Base64.decode(files.getString(rel), android.util.Base64.DEFAULT));
                out.close();
                count++;
            }
            deleteTree(dir);
            if (!tmp.renameTo(dir)) return "error:couldn't save the update";
            // older bundles go
            File[] olds = b.listFiles();
            if (olds != null) for (File d : olds) if (!d.getName().equals(v)) deleteTree(d);
            prefs(c).edit().putString("version", v).putInt("shell", shell).putInt("fails", 0).putString("disabled", "").apply();
            synchronized (Ota.class) { looked = false; active = null; }
            return "ok:" + v + ":" + count;
        } catch (Throwable t) {
            return "error:" + t.getClass().getSimpleName() + ": " + t.getMessage();
        }
    }
}
