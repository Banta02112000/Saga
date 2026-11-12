.class public Lcom/banta/gamecheck/MainActivity;
.super Landroid/app/Activity;


# instance fields
.field public cb:Landroid/webkit/ValueCallback;

.field public proxies:Ljava/util/HashMap;

.field public root:Landroid/widget/FrameLayout;

.field public web:Landroid/webkit/WebView;


# direct methods
.method public constructor <init>()V
    .locals 0

    invoke-direct {p0}, Landroid/app/Activity;-><init>()V

    return-void
.end method


# virtual methods
.method protected onActivityResult(IILandroid/content/Intent;)V
    .locals 2

    invoke-super {p0, p1, p2, p3}, Landroid/app/Activity;->onActivityResult(IILandroid/content/Intent;)V

    iget-object v0, p0, Lcom/banta/gamecheck/MainActivity;->cb:Landroid/webkit/ValueCallback;

    if-eqz v0, :cond_0

    invoke-static {p2, p3}, Landroid/webkit/WebChromeClient$FileChooserParams;->parseResult(ILandroid/content/Intent;)[Landroid/net/Uri;

    move-result-object v1

    invoke-interface {v0, v1}, Landroid/webkit/ValueCallback;->onReceiveValue(Ljava/lang/Object;)V

    const/4 v1, 0x0

    iput-object v1, p0, Lcom/banta/gamecheck/MainActivity;->cb:Landroid/webkit/ValueCallback;

    :cond_0
    return-void
.end method

.method public onBackPressed()V
    .locals 3

    iget-object v0, p0, Lcom/banta/gamecheck/MainActivity;->web:Landroid/webkit/WebView;

    const-string v1, "(window.__back&&window.__back())?\'1\':\'0\'"

    new-instance v2, Lcom/banta/gamecheck/BackCb;

    invoke-direct {v2, p0}, Lcom/banta/gamecheck/BackCb;-><init>(Lcom/banta/gamecheck/MainActivity;)V

    invoke-virtual {v0, v1, v2}, Landroid/webkit/WebView;->evaluateJavascript(Ljava/lang/String;Landroid/webkit/ValueCallback;)V

    return-void
.end method

.method protected onCreate(Landroid/os/Bundle;)V
    .locals 6

    invoke-super {p0, p1}, Landroid/app/Activity;->onCreate(Landroid/os/Bundle;)V

    invoke-virtual {p0}, Lcom/banta/gamecheck/MainActivity;->getWindow()Landroid/view/Window;

    move-result-object v3

    const v4, -0xf1f0ed

    invoke-virtual {v3, v4}, Landroid/view/Window;->setStatusBarColor(I)V

    invoke-virtual {v3, v4}, Landroid/view/Window;->setNavigationBarColor(I)V

    new-instance v0, Landroid/webkit/WebView;

    invoke-direct {v0, p0}, Landroid/webkit/WebView;-><init>(Landroid/content/Context;)V

    iput-object v0, p0, Lcom/banta/gamecheck/MainActivity;->web:Landroid/webkit/WebView;

    invoke-virtual {v0, v4}, Landroid/webkit/WebView;->setBackgroundColor(I)V

    invoke-virtual {v0}, Landroid/webkit/WebView;->getSettings()Landroid/webkit/WebSettings;

    move-result-object v1

    const/4 v2, 0x1

    invoke-virtual {v1, v2}, Landroid/webkit/WebSettings;->setJavaScriptEnabled(Z)V

    invoke-virtual {v1, v2}, Landroid/webkit/WebSettings;->setDomStorageEnabled(Z)V

    invoke-virtual {v1, v2}, Landroid/webkit/WebSettings;->setAllowFileAccess(Z)V

    invoke-virtual {v1, v2}, Landroid/webkit/WebSettings;->setAllowUniversalAccessFromFileURLs(Z)V

    new-instance v1, Lcom/banta/gamecheck/Bridge;

    invoke-direct {v1, p0}, Lcom/banta/gamecheck/Bridge;-><init>(Lcom/banta/gamecheck/MainActivity;)V

    const-string v2, "Android"

    invoke-virtual {v0, v1, v2}, Landroid/webkit/WebView;->addJavascriptInterface(Ljava/lang/Object;Ljava/lang/String;)V

    new-instance v1, Lcom/banta/canonsync/Shared;

    const-string v2, "games"

    invoke-direct {v1, p0, v2}, Lcom/banta/canonsync/Shared;-><init>(Landroid/content/Context;Ljava/lang/String;)V

    const-string v2, "Banta"

    invoke-virtual {v0, v1, v2}, Landroid/webkit/WebView;->addJavascriptInterface(Ljava/lang/Object;Ljava/lang/String;)V

    new-instance v1, Lcom/banta/gamecheck/Chrome;

    invoke-direct {v1, p0}, Lcom/banta/gamecheck/Chrome;-><init>(Lcom/banta/gamecheck/MainActivity;)V

    invoke-virtual {v0, v1}, Landroid/webkit/WebView;->setWebChromeClient(Landroid/webkit/WebChromeClient;)V

    new-instance v1, Landroid/widget/FrameLayout;

    invoke-direct {v1, p0}, Landroid/widget/FrameLayout;-><init>(Landroid/content/Context;)V

    iput-object v1, p0, Lcom/banta/gamecheck/MainActivity;->root:Landroid/widget/FrameLayout;

    new-instance v2, Ljava/util/HashMap;

    invoke-direct {v2}, Ljava/util/HashMap;-><init>()V

    iput-object v2, p0, Lcom/banta/gamecheck/MainActivity;->proxies:Ljava/util/HashMap;

    invoke-virtual {v1, v4}, Landroid/widget/FrameLayout;->setBackgroundColor(I)V

    invoke-virtual {p0, v1}, Lcom/banta/gamecheck/MainActivity;->setContentView(Landroid/view/View;)V

    new-instance v2, Landroid/widget/FrameLayout$LayoutParams;

    const/4 v3, -0x1

    invoke-direct {v2, v3, v3}, Landroid/widget/FrameLayout$LayoutParams;-><init>(II)V

    invoke-virtual {v1, v0, v2}, Landroid/widget/FrameLayout;->addView(Landroid/view/View;Landroid/view/ViewGroup$LayoutParams;)V

    const-string v1, "file:///android_asset/gc/index.html"

    invoke-virtual {v0, v1}, Landroid/webkit/WebView;->loadUrl(Ljava/lang/String;)V

    :try_start_0
    invoke-static {p0}, Lcom/banta/gamecheck/Notif;->ensureChannel(Landroid/content/Context;)V
    :try_end_0
    .catch Ljava/lang/Throwable; {:try_start_0 .. :try_end_0} :catch_0

    :catch_0
    return-void
.end method
