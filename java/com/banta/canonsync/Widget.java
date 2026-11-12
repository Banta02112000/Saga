package com.banta.canonsync;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.widget.RemoteViews;

// Home-screen widgets. Each kind shows the text the app last wrote to its shared file:
// widget.txt (Up next), widget_episodes.txt, widget_upcoming.txt, widget_games.txt, widget_books.txt, widget_year.txt.
// File format: line 1 = heading; line 2 = "@@label<TAB>payload" for an optional button (or "@@"); the rest = body.
// Tapping the widget opens the app on its tab; the button (Mark watched) goes through ActionReceiver.
public class Widget extends AppWidgetProvider {
    String kind() { return ""; }
    String tab() { return "home"; }

    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
        draw(ctx, mgr, ids, kind(), tab(), 77);
    }

    static final Widget[] ALL = { new Widget(), new WidgetEpisodes(), new WidgetUpcoming(), new WidgetGames(), new WidgetBooks(), new WidgetYear() };

    static void refresh(Context ctx) {
        for (int n = 0; n < ALL.length; n++) {
            try {
                AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
                int[] ids = mgr.getAppWidgetIds(new ComponentName(ctx, ALL[n].getClass()));
                if (ids != null && ids.length > 0) draw(ctx, mgr, ids, ALL[n].kind(), ALL[n].tab(), 77 + n * 10);
            } catch (Throwable ignored) {
            }
        }
    }

    static String file(String kind) { return kind.length() == 0 ? "widget.txt" : "widget_" + kind + ".txt"; }

    static void draw(Context ctx, AppWidgetManager mgr, int[] ids, String kind, String tab, int code) {
        try {
            String pkg = ctx.getPackageName();
            int layout = ctx.getResources().getIdentifier("widget", "layout", pkg);
            int idTitle = ctx.getResources().getIdentifier("w_title", "id", pkg);
            int idBody = ctx.getResources().getIdentifier("w_body", "id", pkg);
            int idRoot = ctx.getResources().getIdentifier("w_root", "id", pkg);
            int idBtn = ctx.getResources().getIdentifier("w_btn", "id", pkg);
            if (layout == 0) return;
            String text = Shared.readFile(ctx, file(kind));
            String title = "Saga", body = "Open Saga once to fill this in.", btn = "", payload = "";
            if (text != null && text.length() > 0) {
                int nl = text.indexOf('\n');
                title = nl < 0 ? text : text.substring(0, nl);
                body = nl < 0 ? "" : text.substring(nl + 1);
                if (body.startsWith("@@")) {
                    int nl2 = body.indexOf('\n');
                    String head = nl2 < 0 ? body.substring(2) : body.substring(2, nl2);
                    body = nl2 < 0 ? "" : body.substring(nl2 + 1);
                    int tb = head.indexOf('\t');
                    if (tb > 0) { btn = head.substring(0, tb); payload = head.substring(tb + 1); }
                }
            }
            RemoteViews v = new RemoteViews(pkg, layout);
            v.setTextViewText(idTitle, title);
            v.setTextViewText(idBody, body);
            Intent open = new Intent(ctx, MainActivity.class);
            open.putExtra("tab", tab);
            open.addFlags(0x10000000 | 0x20000000 | 0x00020000);
            v.setOnClickPendingIntent(idRoot, PendingIntent.getActivity(ctx, code, open, 0x04000000 | 0x08000000));
            if (idBtn != 0) {
                if (btn.length() > 0) {
                    v.setTextViewText(idBtn, btn);
                    v.setViewVisibility(idBtn, 0); // VISIBLE
                    Intent act = new Intent(ctx, ActionReceiver.class);
                    act.putExtra("payload", payload);
                    act.putExtra("widget", kind);
                    act.putExtra("id", 0);
                    v.setOnClickPendingIntent(idBtn, PendingIntent.getBroadcast(ctx, code + 1, act, 0x04000000 | 0x08000000));
                } else v.setViewVisibility(idBtn, 8); // GONE
            }
            mgr.updateAppWidget(ids, v);
        } catch (Throwable ignored) {
        }
    }
}
