.class public Lcom/banta/gamecheck/Bridge;
.super Ljava/lang/Object;


# instance fields
.field private a:Lcom/banta/gamecheck/MainActivity;


# direct methods
.method public constructor <init>(Lcom/banta/gamecheck/MainActivity;)V
    .locals 0

    invoke-direct {p0}, Ljava/lang/Object;-><init>()V

    iput-object p1, p0, Lcom/banta/gamecheck/Bridge;->a:Lcom/banta/gamecheck/MainActivity;

    return-void
.end method


# virtual methods
.method public copy(Ljava/lang/String;)V
    .locals 2
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation

    new-instance v0, Lcom/banta/gamecheck/ClipRun;

    iget-object v1, p0, Lcom/banta/gamecheck/Bridge;->a:Lcom/banta/gamecheck/MainActivity;

    invoke-direct {v0, v1, p1}, Lcom/banta/gamecheck/ClipRun;-><init>(Lcom/banta/gamecheck/MainActivity;Ljava/lang/String;)V

    invoke-virtual {v1, v0}, Lcom/banta/gamecheck/MainActivity;->runOnUiThread(Ljava/lang/Runnable;)V

    return-void
.end method

.method public http(Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;)V
    .locals 3
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation

    new-instance v0, Lcom/banta/gamecheck/Http;

    invoke-direct {v0}, Lcom/banta/gamecheck/Http;-><init>()V

    iget-object v1, p0, Lcom/banta/gamecheck/Bridge;->a:Lcom/banta/gamecheck/MainActivity;

    iput-object v1, v0, Lcom/banta/gamecheck/Http;->a:Lcom/banta/gamecheck/MainActivity;

    iput-object p1, v0, Lcom/banta/gamecheck/Http;->id:Ljava/lang/String;

    iput-object p2, v0, Lcom/banta/gamecheck/Http;->url:Ljava/lang/String;

    iput-object p3, v0, Lcom/banta/gamecheck/Http;->method:Ljava/lang/String;

    iput-object p4, v0, Lcom/banta/gamecheck/Http;->headers:Ljava/lang/String;

    iput-object p5, v0, Lcom/banta/gamecheck/Http;->body:Ljava/lang/String;

    new-instance v1, Ljava/lang/Thread;

    invoke-direct {v1, v0}, Ljava/lang/Thread;-><init>(Ljava/lang/Runnable;)V

    invoke-virtual {v1}, Ljava/lang/Thread;->start()V

    return-void
.end method

.method public notifEnabled()Z
    .locals 3
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation

    const/4 v2, 0x1

    :try_start_0
    iget-object v0, p0, Lcom/banta/gamecheck/Bridge;->a:Lcom/banta/gamecheck/MainActivity;

    const-string v1, "notification"

    invoke-virtual {v0, v1}, Lcom/banta/gamecheck/MainActivity;->getSystemService(Ljava/lang/String;)Ljava/lang/Object;

    move-result-object v0

    check-cast v0, Landroid/app/NotificationManager;

    invoke-virtual {v0}, Landroid/app/NotificationManager;->areNotificationsEnabled()Z

    move-result v2
    :try_end_0
    .catch Ljava/lang/Throwable; {:try_start_0 .. :try_end_0} :catch_0

    :catch_0
    return v2
.end method

.method public notify(ILjava/lang/String;Ljava/lang/String;)V
    .locals 1
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation

    :try_start_0
    iget-object v0, p0, Lcom/banta/gamecheck/Bridge;->a:Lcom/banta/gamecheck/MainActivity;

    invoke-static {v0, p1, p2, p3}, Lcom/banta/gamecheck/Notif;->show(Landroid/content/Context;ILjava/lang/String;Ljava/lang/String;)V
    :try_end_0
    .catch Ljava/lang/Throwable; {:try_start_0 .. :try_end_0} :catch_0

    :catch_0
    return-void
.end method

.method public openNotifSettings()V
    .locals 4
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation

    :try_start_0
    iget-object v0, p0, Lcom/banta/gamecheck/Bridge;->a:Lcom/banta/gamecheck/MainActivity;

    new-instance v1, Landroid/content/Intent;

    const-string v2, "android.settings.APP_NOTIFICATION_SETTINGS"

    invoke-direct {v1, v2}, Landroid/content/Intent;-><init>(Ljava/lang/String;)V

    const-string v2, "android.provider.extra.APP_PACKAGE"

    invoke-virtual {v0}, Lcom/banta/gamecheck/MainActivity;->getPackageName()Ljava/lang/String;

    move-result-object v3

    invoke-virtual {v1, v2, v3}, Landroid/content/Intent;->putExtra(Ljava/lang/String;Ljava/lang/String;)Landroid/content/Intent;

    const/high16 v2, 0x10000000

    invoke-virtual {v1, v2}, Landroid/content/Intent;->addFlags(I)Landroid/content/Intent;

    invoke-virtual {v0, v1}, Lcom/banta/gamecheck/MainActivity;->startActivity(Landroid/content/Intent;)V
    :try_end_0
    .catch Ljava/lang/Throwable; {:try_start_0 .. :try_end_0} :catch_0

    :catch_0
    return-void
.end method

.method public openUrl(Ljava/lang/String;)V
    .locals 3
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation

    :try_start_0
    new-instance v0, Landroid/content/Intent;

    const-string v1, "android.intent.action.VIEW"

    invoke-static {p1}, Landroid/net/Uri;->parse(Ljava/lang/String;)Landroid/net/Uri;

    move-result-object v2

    invoke-direct {v0, v1, v2}, Landroid/content/Intent;-><init>(Ljava/lang/String;Landroid/net/Uri;)V

    iget-object v1, p0, Lcom/banta/gamecheck/Bridge;->a:Lcom/banta/gamecheck/MainActivity;

    invoke-virtual {v1, v0}, Lcom/banta/gamecheck/MainActivity;->startActivity(Landroid/content/Intent;)V
    :try_end_0
    .catch Ljava/lang/Throwable; {:try_start_0 .. :try_end_0} :catch_0

    :catch_0
    return-void
.end method

.method public schedule(Ljava/lang/String;)V
    .locals 1
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation

    iget-object v0, p0, Lcom/banta/gamecheck/Bridge;->a:Lcom/banta/gamecheck/MainActivity;

    invoke-static {v0, p1}, Lcom/banta/gamecheck/Notif;->schedule(Landroid/content/Context;Ljava/lang/String;)V

    return-void
.end method

.method public share(Ljava/lang/String;)V
    .locals 4
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation

    new-instance v0, Landroid/content/Intent;

    const-string v1, "android.intent.action.SEND"

    invoke-direct {v0, v1}, Landroid/content/Intent;-><init>(Ljava/lang/String;)V

    const-string v1, "text/plain"

    invoke-virtual {v0, v1}, Landroid/content/Intent;->setType(Ljava/lang/String;)Landroid/content/Intent;

    const-string v1, "android.intent.extra.TEXT"

    invoke-virtual {v0, v1, p1}, Landroid/content/Intent;->putExtra(Ljava/lang/String;Ljava/lang/String;)Landroid/content/Intent;

    const-string v1, "android.intent.extra.SUBJECT"

    const-string v2, "gamecheck-progress.json"

    invoke-virtual {v0, v1, v2}, Landroid/content/Intent;->putExtra(Ljava/lang/String;Ljava/lang/String;)Landroid/content/Intent;

    const-string v1, "Save GameCheck progress"

    invoke-static {v0, v1}, Landroid/content/Intent;->createChooser(Landroid/content/Intent;Ljava/lang/CharSequence;)Landroid/content/Intent;

    move-result-object v0

    iget-object v1, p0, Lcom/banta/gamecheck/Bridge;->a:Lcom/banta/gamecheck/MainActivity;

    invoke-virtual {v1, v0}, Lcom/banta/gamecheck/MainActivity;->startActivity(Landroid/content/Intent;)V

    return-void
.end method

.method public syncDone(Ljava/lang/String;Ljava/lang/String;)V
    .locals 9
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation

    iget-object v0, p0, Lcom/banta/gamecheck/Bridge;->a:Lcom/banta/gamecheck/MainActivity;

    :try_start_0
    new-instance v1, Landroid/content/Intent;

    const-class v2, Lcom/banta/gamecheck/SyncSvc;

    invoke-direct {v1, v0, v2}, Landroid/content/Intent;-><init>(Landroid/content/Context;Ljava/lang/Class;)V

    invoke-virtual {v0, v1}, Lcom/banta/gamecheck/MainActivity;->stopService(Landroid/content/Intent;)Z
    :try_end_0
    .catch Ljava/lang/Throwable; {:try_start_0 .. :try_end_0} :catch_0

    :catch_0
    :try_start_1
    invoke-static {v0}, Lcom/banta/gamecheck/Notif;->ensureSync(Landroid/content/Context;)V

    const-string v1, "notification"

    invoke-virtual {v0, v1}, Lcom/banta/gamecheck/MainActivity;->getSystemService(Ljava/lang/String;)Ljava/lang/Object;

    move-result-object v7

    check-cast v7, Landroid/app/NotificationManager;

    const/16 v1, 0x4d

    invoke-virtual {v7, v1}, Landroid/app/NotificationManager;->cancel(I)V

    if-eqz p1, :cond_0

    const-string v2, "syncdone"

    const/4 v5, 0x0

    const/4 v6, 0x0

    move-object v1, v0

    move-object v3, p1

    move-object v4, p2

    move-object v8, v7

    const/4 v7, 0x0

    invoke-static/range {v1 .. v7}, Lcom/banta/gamecheck/Notif;->build(Landroid/content/Context;Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;IIZ)Landroid/app/Notification;

    move-result-object v1

    const/16 v2, 0x4e

    invoke-virtual {v8, v2, v1}, Landroid/app/NotificationManager;->notify(ILandroid/app/Notification;)V

    :cond_0
    nop
    :try_end_1
    .catch Ljava/lang/Throwable; {:try_start_1 .. :try_end_1} :catch_1

    :catch_1
    return-void
.end method

.method public syncStatus(Ljava/lang/String;Ljava/lang/String;II)V
    .locals 8
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation

    iget-object v0, p0, Lcom/banta/gamecheck/Bridge;->a:Lcom/banta/gamecheck/MainActivity;

    :try_start_0
    new-instance v1, Landroid/content/Intent;

    const-class v2, Lcom/banta/gamecheck/SyncSvc;

    invoke-direct {v1, v0, v2}, Landroid/content/Intent;-><init>(Landroid/content/Context;Ljava/lang/Class;)V

    const-string v2, "t"

    invoke-virtual {v1, v2, p1}, Landroid/content/Intent;->putExtra(Ljava/lang/String;Ljava/lang/String;)Landroid/content/Intent;

    const-string v2, "x"

    invoke-virtual {v1, v2, p2}, Landroid/content/Intent;->putExtra(Ljava/lang/String;Ljava/lang/String;)Landroid/content/Intent;

    const-string v2, "m"

    invoke-virtual {v1, v2, p3}, Landroid/content/Intent;->putExtra(Ljava/lang/String;I)Landroid/content/Intent;

    const-string v2, "c"

    invoke-virtual {v1, v2, p4}, Landroid/content/Intent;->putExtra(Ljava/lang/String;I)Landroid/content/Intent;

    invoke-virtual {v0, v1}, Lcom/banta/gamecheck/MainActivity;->startService(Landroid/content/Intent;)Landroid/content/ComponentName;

    return-void
    :try_end_0
    .catch Ljava/lang/Throwable; {:try_start_0 .. :try_end_0} :catch_0

    :catch_0
    :try_start_1
    invoke-static {v0}, Lcom/banta/gamecheck/Notif;->ensureSync(Landroid/content/Context;)V

    const-string v2, "sync"

    const/4 v7, 0x1

    move-object v1, v0

    move-object v3, p1

    move-object v4, p2

    move v5, p3

    move v6, p4

    invoke-static/range {v1 .. v7}, Lcom/banta/gamecheck/Notif;->build(Landroid/content/Context;Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;IIZ)Landroid/app/Notification;

    move-result-object v1

    const-string v2, "notification"

    invoke-virtual {v0, v2}, Lcom/banta/gamecheck/MainActivity;->getSystemService(Ljava/lang/String;)Ljava/lang/Object;

    move-result-object v2

    check-cast v2, Landroid/app/NotificationManager;

    const/16 v3, 0x4d

    invoke-virtual {v2, v3, v1}, Landroid/app/NotificationManager;->notify(ILandroid/app/Notification;)V
    :try_end_1
    .catch Ljava/lang/Throwable; {:try_start_1 .. :try_end_1} :catch_1

    :catch_1
    return-void
.end method

.method public webfetch(Ljava/lang/String;Ljava/lang/String;)V
    .locals 2
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation

    new-instance v0, Lcom/banta/gamecheck/ProxyTask;

    invoke-direct {v0}, Lcom/banta/gamecheck/ProxyTask;-><init>()V

    iget-object v1, p0, Lcom/banta/gamecheck/Bridge;->a:Lcom/banta/gamecheck/MainActivity;

    iput-object v1, v0, Lcom/banta/gamecheck/ProxyTask;->a:Lcom/banta/gamecheck/MainActivity;

    iput-object p1, v0, Lcom/banta/gamecheck/ProxyTask;->origin:Ljava/lang/String;

    iput-object p2, v0, Lcom/banta/gamecheck/ProxyTask;->js:Ljava/lang/String;

    invoke-virtual {v1, v0}, Lcom/banta/gamecheck/MainActivity;->runOnUiThread(Ljava/lang/Runnable;)V

    return-void
.end method
