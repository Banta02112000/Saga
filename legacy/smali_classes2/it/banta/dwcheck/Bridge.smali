.class public Lit/banta/dwcheck/Bridge;
.super Ljava/lang/Object;
.source "Bridge.java"


# instance fields
.field final a:Lit/banta/dwcheck/MainActivity;


# direct methods
.method constructor <init>(Lit/banta/dwcheck/MainActivity;)V
    .locals 0

    .line 10
    invoke-direct {p0}, Ljava/lang/Object;-><init>()V

    iput-object p1, p0, Lit/banta/dwcheck/Bridge;->a:Lit/banta/dwcheck/MainActivity;

    return-void
.end method


# virtual methods
.method public copy(Ljava/lang/String;)V
    .locals 5
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation

    .line 13
    iget-object v0, p0, Lit/banta/dwcheck/Bridge;->a:Lit/banta/dwcheck/MainActivity;

    iget-object v0, v0, Lit/banta/dwcheck/MainActivity;->main:Landroid/os/Handler;

    new-instance v1, Lit/banta/dwcheck/Task;

    iget-object v2, p0, Lit/banta/dwcheck/Bridge;->a:Lit/banta/dwcheck/MainActivity;

    const/4 v3, 0x2

    const/4 v4, 0x0

    invoke-direct {v1, v2, v3, p1, v4}, Lit/banta/dwcheck/Task;-><init>(Lit/banta/dwcheck/MainActivity;ILjava/lang/String;Ljava/lang/String;)V

    invoke-virtual {v0, v1}, Landroid/os/Handler;->post(Ljava/lang/Runnable;)Z

    return-void
.end method

.method public get(Ljava/lang/String;Ljava/lang/String;)V
    .locals 4
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation

    .line 15
    new-instance v0, Ljava/lang/Thread;

    new-instance v1, Lit/banta/dwcheck/Task;

    iget-object v2, p0, Lit/banta/dwcheck/Bridge;->a:Lit/banta/dwcheck/MainActivity;

    const/4 v3, 0x4

    invoke-direct {v1, v2, v3, p1, p2}, Lit/banta/dwcheck/Task;-><init>(Lit/banta/dwcheck/MainActivity;ILjava/lang/String;Ljava/lang/String;)V

    invoke-direct {v0, v1}, Ljava/lang/Thread;-><init>(Ljava/lang/Runnable;)V

    invoke-virtual {v0}, Ljava/lang/Thread;->start()V

    return-void
.end method

.method public open(Ljava/lang/String;)V
    .locals 5
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation

    .line 12
    iget-object v0, p0, Lit/banta/dwcheck/Bridge;->a:Lit/banta/dwcheck/MainActivity;

    iget-object v0, v0, Lit/banta/dwcheck/MainActivity;->main:Landroid/os/Handler;

    new-instance v1, Lit/banta/dwcheck/Task;

    iget-object v2, p0, Lit/banta/dwcheck/Bridge;->a:Lit/banta/dwcheck/MainActivity;

    const/4 v3, 0x1

    const/4 v4, 0x0

    invoke-direct {v1, v2, v3, p1, v4}, Lit/banta/dwcheck/Task;-><init>(Lit/banta/dwcheck/MainActivity;ILjava/lang/String;Ljava/lang/String;)V

    invoke-virtual {v0, v1}, Landroid/os/Handler;->post(Ljava/lang/Runnable;)Z

    return-void
.end method

.method public paste()Ljava/lang/String;
    .locals 3
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation

    const-string v0, ""

    .line 18
    :try_start_0
    iget-object v1, p0, Lit/banta/dwcheck/Bridge;->a:Lit/banta/dwcheck/MainActivity;

    const-string v2, "clipboard"

    invoke-virtual {v1, v2}, Lit/banta/dwcheck/MainActivity;->getSystemService(Ljava/lang/String;)Ljava/lang/Object;

    move-result-object v1

    check-cast v1, Landroid/content/ClipboardManager;

    .line 19
    invoke-virtual {v1}, Landroid/content/ClipboardManager;->getPrimaryClip()Landroid/content/ClipData;

    move-result-object v1

    if-eqz v1, :cond_2

    .line 20
    invoke-virtual {v1}, Landroid/content/ClipData;->getItemCount()I

    move-result v2

    if-nez v2, :cond_0

    goto :goto_0

    :cond_0
    const/4 v2, 0x0

    .line 21
    invoke-virtual {v1, v2}, Landroid/content/ClipData;->getItemAt(I)Landroid/content/ClipData$Item;

    move-result-object v1

    iget-object v2, p0, Lit/banta/dwcheck/Bridge;->a:Lit/banta/dwcheck/MainActivity;

    invoke-virtual {v1, v2}, Landroid/content/ClipData$Item;->coerceToText(Landroid/content/Context;)Ljava/lang/CharSequence;

    move-result-object v1

    if-nez v1, :cond_1

    goto :goto_0

    .line 22
    :cond_1
    invoke-interface {v1}, Ljava/lang/CharSequence;->toString()Ljava/lang/String;

    move-result-object v0
    :try_end_0
    .catch Ljava/lang/Exception; {:try_start_0 .. :try_end_0} :catch_0

    :catch_0
    :cond_2
    :goto_0
    return-object v0
.end method

.method public share(Ljava/lang/String;)V
    .locals 5
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation

    .line 14
    iget-object v0, p0, Lit/banta/dwcheck/Bridge;->a:Lit/banta/dwcheck/MainActivity;

    iget-object v0, v0, Lit/banta/dwcheck/MainActivity;->main:Landroid/os/Handler;

    new-instance v1, Lit/banta/dwcheck/Task;

    iget-object v2, p0, Lit/banta/dwcheck/Bridge;->a:Lit/banta/dwcheck/MainActivity;

    const/4 v3, 0x3

    const/4 v4, 0x0

    invoke-direct {v1, v2, v3, p1, v4}, Lit/banta/dwcheck/Task;-><init>(Lit/banta/dwcheck/MainActivity;ILjava/lang/String;Ljava/lang/String;)V

    invoke-virtual {v0, v1}, Landroid/os/Handler;->post(Ljava/lang/Runnable;)Z

    return-void
.end method
