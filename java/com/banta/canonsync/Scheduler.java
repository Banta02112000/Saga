package com.banta.canonsync;

import android.app.job.JobInfo;
import android.app.job.JobScheduler;
import android.content.ComponentName;
import android.content.Context;

final class Scheduler {
    static final int PERIODIC = 7001;

    private Scheduler() {
    }

    // Schedules (or cancels) the periodic background check. Keeps an existing job with the same interval
    // so opening the app doesn't keep pushing the next run back.
    static boolean set(Context ctx, boolean on, int hours) {
        try {
            JobScheduler js = (JobScheduler) ctx.getSystemService("jobscheduler");
            if (!on) {
                js.cancel(PERIODIC);
                return true;
            }
            long ms = Math.max(1, hours) * 3600000L;
            JobInfo cur = js.getPendingJob(PERIODIC);
            if (cur != null && cur.getIntervalMillis() == ms) return true;
            JobInfo job = new JobInfo.Builder(PERIODIC, new ComponentName(ctx, SyncJobService.class))
                    .setPeriodic(ms)
                    .setRequiredNetworkType(1) // NETWORK_TYPE_ANY
                    .setPersisted(true)        // survives reboots
                    .build();
            return js.schedule(job) == 1; // RESULT_SUCCESS
        } catch (Throwable t) {
            return false;
        }
    }
}
