package com.banta.canonsync;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;

// Receives bantaapps://open/<app> from the app switcher inside GameCheck and DW Canon and brings that app's
// screen to the front without restarting it.
public class Switch extends Activity {
    static String target(String app) {
        if ("games".equals(app)) return "com.banta.gamecheck.MainActivity";
        if ("dw".equals(app)) return "it.banta.dwcheck.MainActivity";
        if ("books".equals(app)) return "com.banta.canonsync.BooksActivity";
        return "com.banta.canonsync.MainActivity";
    }

    static void open(Context ctx, String app) {
        Intent i = new Intent().setClassName(ctx, "com.banta.canonsync.MainActivity");
        i.putExtra("tab", "dw".equals(app) ? "timeline" : "canon".equals(app) ? "home" : app);
        i.addFlags(0x00020000 | 0x00010000); // REORDER_TO_FRONT | NO_ANIMATION
        if (!(ctx instanceof Activity)) i.addFlags(0x10000000);
        ctx.startActivity(i);
    }

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        String app = "canon";
        try {
            Uri u = getIntent().getData();
            // 0.6.6: …://oauth/itad?code=… from a sign-in in the browser goes to Saga's main screen
            if (u != null && "oauth".equals(u.getHost())) {
                Intent i = new Intent().setClassName(this, "com.banta.canonsync.MainActivity");
                i.putExtra("oauth", u.toString());
                i.addFlags(0x00020000 | 0x10000000); // REORDER_TO_FRONT | NEW_TASK
                startActivity(i);
                finish();
                return;
            }
            if (u != null && u.getLastPathSegment() != null) app = u.getLastPathSegment();
        } catch (Throwable ignored) {
        }
        try {
            open(this, app);
        } catch (Throwable ignored) {
        }
        finish();
        overridePendingTransition(0, 0);
    }
}
