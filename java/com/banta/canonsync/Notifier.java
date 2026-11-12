package com.banta.canonsync;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;

final class Notifier {
    static final String CHANNEL = "releases";

    private Notifier() {
    }

    static final String STATUS = "status";
    static final int STATUS_ID = 42;

    // Quiet, updatable "Syncing… / Sync finished" notification. pct < 0 = no progress bar.
    static void status(Context ctx, String title, String text, int pct, boolean ongoing) {
        try {
            NotificationManager nm = (NotificationManager) ctx.getSystemService("notification");
            NotificationChannel ch = new NotificationChannel(STATUS, "Sync status", 2); // IMPORTANCE_LOW: no sound
            ch.setDescription("Progress and result of syncs and scans");
            nm.createNotificationChannel(ch);
            Intent open = new Intent(ctx, MainActivity.class);
            open.putExtra("tab", "home");
            open.addFlags(0x10000000 | 0x20000000 | 0x00020000);
            PendingIntent pi = PendingIntent.getActivity(ctx, STATUS_ID, open, 0x04000000 | 0x08000000);
            int icon = ctx.getResources().getIdentifier("ic_stat_canon", "drawable", ctx.getPackageName());
            if (icon == 0) icon = ctx.getResources().getIdentifier("stat_notify_sync", "drawable", "android");
            Notification.Builder b = new Notification.Builder(ctx, STATUS)
                    .setSmallIcon(icon)
                    .setContentTitle(title)
                    .setContentText(text)
                    .setStyle(new Notification.BigTextStyle().bigText(text))
                    .setColor(0xFFF5B841)
                    .setOnlyAlertOnce(true)
                    .setOngoing(ongoing)
                    .setAutoCancel(!ongoing)
                    .setContentIntent(pi);
            if (pct >= 0) b.setProgress(100, pct, false);
            nm.notify(STATUS_ID, b.build());
        } catch (Throwable ignored) {
        }
    }

    static void cancelStatus(Context ctx) {
        try {
            ((NotificationManager) ctx.getSystemService("notification")).cancel(STATUS_ID);
        } catch (Throwable ignored) {
        }
    }

    static void post(Context ctx, int id, String title, String text, String tab) {
        post(ctx, id, title, text, tab, null, null);
    }

    static void post(Context ctx, int id, String title, String text, String tab, String label, String payload) {
        try {
            NotificationManager nm = (NotificationManager) ctx.getSystemService("notification");
            NotificationChannel ch = new NotificationChannel(CHANNEL, "New releases", 3); // IMPORTANCE_DEFAULT
            ch.setDescription("New canon, new seasons and release days");
            nm.createNotificationChannel(ch);

            // "games" and "dw" open that tab's own screen; anything else is a tab inside Canon
            Intent open = new Intent(ctx, MainActivity.class);
            open.putExtra("tab", tab == null ? "home" : "dw".equals(tab) ? "timeline" : tab);
            open.addFlags(0x10000000 | 0x20000000 | 0x00020000); // NEW_TASK | SINGLE_TOP | REORDER_TO_FRONT
            PendingIntent pi = PendingIntent.getActivity(ctx, id, open, 0x04000000 | 0x08000000); // IMMUTABLE | UPDATE_CURRENT

            int icon = ctx.getResources().getIdentifier("ic_stat_canon", "drawable", ctx.getPackageName());
            if (icon == 0) icon = ctx.getResources().getIdentifier("stat_notify_more", "drawable", "android");

            Notification.Builder b = new Notification.Builder(ctx, CHANNEL)
                    .setSmallIcon(icon)
                    .setContentTitle(title)
                    .setContentText(text)
                    .setStyle(new Notification.BigTextStyle().bigText(text))
                    .setColor(0xFFF5B841)
                    .setAutoCancel(true)
                    .setContentIntent(pi);
            if (label != null && payload != null) {
                Intent act = new Intent().setClassName(ctx, "com.banta.canonsync.ActionReceiver");
                act.putExtra("payload", payload);
                act.putExtra("id", id);
                PendingIntent ap = PendingIntent.getBroadcast(ctx, id, act, 0x04000000 | 0x08000000);
                b.addAction(icon, label, ap);
            }
            nm.notify(id, b.build());
        } catch (Throwable ignored) {
        }
    }
}
