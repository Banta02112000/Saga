package com.banta.canonsync;

import android.app.NotificationManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

// A tap on a notification button (Mark watched): saved to pending_actions.json; the app applies it next time it's
// in front (or right away if it's open), and the notification goes away.
public class ActionReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context c, Intent i) {
        try {
            String p = i.getStringExtra("payload");
            if (p != null) p = p.replace("__NOW__", new java.text.SimpleDateFormat("yyyy-MM-dd").format(new java.util.Date()));
            if (p != null) {
                synchronized (ActionReceiver.class) {
                    String old = Shared.readFile(c, "pending_actions.json");
                    String body = old == null || old.trim().length() < 2 ? "[]" : old.trim();
                    String next = body.equals("[]") ? "[" + p + "]" : body.substring(0, body.length() - 1) + "," + p + "]";
                    Shared.writeFile(c, "pending_actions.json", next);
                }
            }
            String w = i.getStringExtra("widget");
            if (w != null) {
                // from a widget button: show it as done right away (the app rewrites the widget when it next runs)
                String f = Widget.file(w), t = Shared.readFile(c, f);
                if (t != null) {
                    int a = t.indexOf("\n@@");
                    if (a >= 0) {
                        int b = t.indexOf('\n', a + 1);
                        String rest = b < 0 ? "" : t.substring(b + 1);
                        Shared.writeFile(c, f, t.substring(0, a) + "\n@@\n✓ Marked watched. Open Saga to see what's next.\n" + rest);
                    }
                }
                Widget.refresh(c);
                return;
            }
            ((NotificationManager) c.getSystemService("notification")).cancel(i.getIntExtra("id", 0));
        } catch (Throwable ignored) {
        }
    }
}
