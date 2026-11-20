package com.banta.canonsync;

import android.app.job.JobInfo;
import android.app.job.JobScheduler;
import android.content.ComponentName;
import android.content.Context;

final class Scheduler {
    static final int PERIODIC = 7001;
    static final int NIGHT = 7002;

    private Scheduler() {
    }

    // 0.7.6: the night refresh: once, between 03:30 and 05:30 (when the system lets it), then the next night again.
    static boolean night(Context ctx, boolean on) {
        try {
            JobScheduler js = (JobScheduler) ctx.getSystemService("jobscheduler");
            if (!on) {
                js.cancel(NIGHT);
                return true;
            }
            java.util.Calendar c = java.util.Calendar.getInstance();
            long now = c.getTimeInMillis();
            c.set(java.util.Calendar.HOUR_OF_DAY, 3);
            c.set(java.util.Calendar.MINUTE, 30);
            c.set(java.util.Calendar.SECOND, 0);
            if (c.getTimeInMillis() <= now + 60000L) c.add(java.util.Calendar.DAY_OF_MONTH, 1);
            long delay = c.getTimeInMillis() - now;
            // setting it again replaces the one already set: always for the same next 03:30
            JobInfo job = new JobInfo.Builder(NIGHT, new ComponentName(ctx, SyncJobService.class))
                    .setMinimumLatency(delay)
                    .setOverrideDeadline(delay + 2 * 3600000L)
                    .setRequiredNetworkType(1)
                    .setPersisted(true)
                    .build();
            return js.schedule(job) == 1;
        } catch (Throwable t) {
            return false;
        }
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
