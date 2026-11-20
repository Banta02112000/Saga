package com.banta.canonsync;

import android.app.job.JobParameters;
import android.app.job.JobService;
import android.os.Handler;
import android.os.Looper;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

// Periodic background check: runs bg.html (the same JS logic as the app) in an off-screen WebView.
public class SyncJobService extends JobService {
    WebView web;
    JobParameters params;
    Handler handler;
    Runnable timeout;

    @Override
    public boolean onStartJob(JobParameters p) {
        // the app is open, or a step is waiting for an answer from the Gemini app: it owns the data; try at the next interval
        if (MainActivity.foreground || Shared.busy) {
            if (p.getJobId() == Scheduler.NIGHT) Scheduler.night(this, true); // the app is open at night: the next night then
            return false;
        }
        params = p;
        handler = new Handler(Looper.getMainLooper());
        try {
            web = new WebView(this);
            WebSettings s = web.getSettings();
            s.setJavaScriptEnabled(true);
            s.setDomStorageEnabled(true);
            s.setAllowFileAccess(true);
            web.addJavascriptInterface(new Bridge(this, null, web, this), "Android");
            web.addJavascriptInterface(new Shared(this, "canon-bg"), "Banta");
            web.setWebViewClient(new OtaClient(this));
            // 0.7.6: the night refresh runs the whole app off-screen (a full sync, your website, the jobs Saga does by
            // itself, every series' episodes); then the next night is set
            boolean night = p.getJobId() == Scheduler.NIGHT;
            if (night) Scheduler.night(this, true);
            web.loadUrl(night ? "file:///android_asset/index.html?night=1" : "file:///android_asset/bg.html");
            timeout = new Finish(this);
            handler.postDelayed(timeout, 9 * 60 * 1000L); // stay inside the system's 10-minute job limit
            return true;
        } catch (Throwable t) {
            cleanup();
            return false;
        }
    }

    @Override
    public boolean onStopJob(JobParameters p) {
        cleanup();
        return true;
    }

    void finishFromJs() {
        JobParameters p = params;
        cleanup();
        if (p != null) jobFinished(p, false);
    }

    void cleanup() {
        params = null;
        if (handler != null && timeout != null) handler.removeCallbacks(timeout);
        timeout = null;
        if (web != null) {
            try {
                web.stopLoading();
                web.destroy();
            } catch (Throwable ignored) {
            }
            web = null;
        }
    }

    static class Finish implements Runnable {
        final SyncJobService s;

        Finish(SyncJobService s) {
            this.s = s;
        }

        public void run() {
            s.finishFromJs();
        }
    }

    // 0.6.9.5: the background sync uses a screen update's files too
    static class OtaClient extends android.webkit.WebViewClient {
        final android.content.Context c;

        OtaClient(android.content.Context c) {
            this.c = c;
        }

        @Override
        public android.webkit.WebResourceResponse shouldInterceptRequest(android.webkit.WebView view, android.webkit.WebResourceRequest request) {
            android.webkit.WebResourceResponse r = Ota.serve(c, request.getUrl().toString());
            return r != null ? r : super.shouldInterceptRequest(view, request);
        }
    }
}
