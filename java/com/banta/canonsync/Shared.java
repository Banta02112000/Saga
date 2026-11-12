package com.banta.canonsync;

import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.webkit.JavascriptInterface;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.HashMap;

// The "Banta" bridge every tab gets (Canon, Games, Doctor Who): small shared files so the tabs can see each
// other's data (search index, backups, what's next), a mailbox for "open this item", and a few device helpers.
public class Shared {
    static final HashMap<String, String> BOX = new HashMap<String, String>();
    static volatile boolean busy = false; // a step is waiting for the person (e.g. a Gemini answer): background sync holds off

    final Context ctx;
    final String app;

    public Shared(Context ctx, String app) {
        this.ctx = ctx.getApplicationContext() == null ? ctx : ctx.getApplicationContext();
        this.app = app;
    }

    static String safe(String name) {
        return "shared_" + String.valueOf(name).replaceAll("[^A-Za-z0-9._-]", "_");
    }

    static String readFile(Context ctx, String name) {
        try {
            File f = new File(ctx.getFilesDir(), safe(name));
            if (!f.exists()) return "";
            InputStream in = new FileInputStream(f);
            ByteArrayOutputStream o = new ByteArrayOutputStream();
            byte[] buf = new byte[16384];
            int n;
            while ((n = in.read(buf)) > 0) o.write(buf, 0, n);
            in.close();
            return new String(o.toByteArray(), "UTF-8");
        } catch (Throwable t) {
            return "";
        }
    }

    @JavascriptInterface
    public String app() {
        return app;
    }

    @JavascriptInterface
    public String read(String name) {
        return readFile(ctx, name);
    }

    @JavascriptInterface
    public boolean write(String name, String text) {
        return writeFile(ctx, name, text);
    }

    static boolean writeFile(Context ctx, String name, String text) {
        try {
            File dir = ctx.getFilesDir();
            File tmp = new File(dir, safe(name) + ".tmp");
            OutputStream o = new FileOutputStream(tmp);
            o.write(String.valueOf(text).getBytes("UTF-8"));
            o.close();
            return tmp.renameTo(new File(dir, safe(name)));
        } catch (Throwable t) {
            return false;
        }
    }

    @JavascriptInterface
    public boolean remove(String name) {
        try {
            return new File(ctx.getFilesDir(), safe(name)).delete();
        } catch (Throwable t) {
            return false;
        }
    }

    @JavascriptInterface
    public String stamp(String name) {
        try {
            File f = new File(ctx.getFilesDir(), safe(name));
            return f.exists() ? f.lastModified() + ":" + f.length() : "";
        } catch (Throwable t) {
            return "";
        }
    }

    // One pending message per tab, e.g. {"open":"g12"}; taken (and cleared) by that tab when it comes to the front.
    @JavascriptInterface
    public void post(String toApp, String msg) {
        synchronized (BOX) {
            BOX.put(String.valueOf(toApp), String.valueOf(msg));
        }
    }

    @JavascriptInterface
    public String take() {
        synchronized (BOX) {
            String m = BOX.remove(app);
            return m == null ? "" : m;
        }
    }

    @JavascriptInterface
    public void busy(boolean on) {
        busy = on;
    }

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

    // Hands text straight to another app's share target (the Gemini app). False when that app can't take it.
    @JavascriptInterface
    public boolean shareTo(String pkg, String text) {
        try {
            if (text == null || text.length() > 120000) return false; // too big for one intent
            Intent i = new Intent("android.intent.action.SEND");
            i.setType("text/plain");
            i.putExtra("android.intent.extra.TEXT", text);
            i.setPackage(pkg);
            i.addFlags(0x10000000);
            ctx.startActivity(i);
            return true;
        } catch (Throwable t) {
            return false;
        }
    }

    @JavascriptInterface
    public void notify(int id, String title, String text, String tab) {
        Notifier.post(ctx, id, title, text, tab);
    }

    @JavascriptInterface
    public void widget() {
        Widget.refresh(ctx);
    }
}
