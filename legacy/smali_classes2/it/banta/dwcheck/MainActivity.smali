.class public Lit/banta/dwcheck/MainActivity;
.super Landroid/app/Activity;
.source "MainActivity.java"


# instance fields
.field final main:Landroid/os/Handler;

.field web:Landroid/webkit/WebView;


# direct methods
.method public constructor <init>()V
    .locals 2

    .line 13
    invoke-direct {p0}, Landroid/app/Activity;-><init>()V

    .line 15
    new-instance v0, Landroid/os/Handler;

    invoke-static {}, Landroid/os/Looper;->getMainLooper()Landroid/os/Looper;

    move-result-object v1

    invoke-direct {v0, v1}, Landroid/os/Handler;-><init>(Landroid/os/Looper;)V

    iput-object v0, p0, Lit/banta/dwcheck/MainActivity;->main:Landroid/os/Handler;

    return-void
.end method


# virtual methods
.method public onBackPressed()V
    .locals 4

    .line 40
    iget-object v0, p0, Lit/banta/dwcheck/MainActivity;->web:Landroid/webkit/WebView;

    new-instance v1, Lit/banta/dwcheck/Task;

    const/4 v2, 0x0

    const/4 v3, 0x0

    invoke-direct {v1, p0, v3, v2, v2}, Lit/banta/dwcheck/Task;-><init>(Lit/banta/dwcheck/MainActivity;ILjava/lang/String;Ljava/lang/String;)V

    const-string v2, "window.onBack ? window.onBack() : false"

    invoke-virtual {v0, v2, v1}, Landroid/webkit/WebView;->evaluateJavascript(Ljava/lang/String;Landroid/webkit/ValueCallback;)V

    return-void
.end method

.method protected onCreate(Landroid/os/Bundle;)V
    .locals 2

    .line 19
    invoke-super {p0, p1}, Landroid/app/Activity;->onCreate(Landroid/os/Bundle;)V

    const p1, -0xf8f1e6

    .line 21
    :try_start_0
    invoke-virtual {p0}, Lit/banta/dwcheck/MainActivity;->getWindow()Landroid/view/Window;

    move-result-object v0

    const v1, -0xf6eddf

    invoke-virtual {v0, v1}, Landroid/view/Window;->setStatusBarColor(I)V

    .line 22
    invoke-virtual {p0}, Lit/banta/dwcheck/MainActivity;->getWindow()Landroid/view/Window;

    move-result-object v0

    invoke-virtual {v0, p1}, Landroid/view/Window;->setNavigationBarColor(I)V
    :try_end_0
    .catch Ljava/lang/Exception; {:try_start_0 .. :try_end_0} :catch_0

    .line 24
    :catch_0
    new-instance v0, Landroid/webkit/WebView;

    invoke-direct {v0, p0}, Landroid/webkit/WebView;-><init>(Landroid/content/Context;)V

    iput-object v0, p0, Lit/banta/dwcheck/MainActivity;->web:Landroid/webkit/WebView;

    .line 25
    iget-object v0, p0, Lit/banta/dwcheck/MainActivity;->web:Landroid/webkit/WebView;

    invoke-virtual {v0, p1}, Landroid/webkit/WebView;->setBackgroundColor(I)V

    .line 26
    iget-object p1, p0, Lit/banta/dwcheck/MainActivity;->web:Landroid/webkit/WebView;

    invoke-virtual {p1}, Landroid/webkit/WebView;->getSettings()Landroid/webkit/WebSettings;

    move-result-object p1

    const/4 v0, 0x1

    .line 27
    invoke-virtual {p1, v0}, Landroid/webkit/WebSettings;->setJavaScriptEnabled(Z)V

    .line 28
    invoke-virtual {p1, v0}, Landroid/webkit/WebSettings;->setDomStorageEnabled(Z)V

    .line 29
    invoke-virtual {p1, v0}, Landroid/webkit/WebSettings;->setDatabaseEnabled(Z)V

    .line 30
    invoke-virtual {p1, v0}, Landroid/webkit/WebSettings;->setAllowFileAccess(Z)V

    .line 31
    iget-object p1, p0, Lit/banta/dwcheck/MainActivity;->web:Landroid/webkit/WebView;

    new-instance v0, Landroid/webkit/WebChromeClient;

    invoke-direct {v0}, Landroid/webkit/WebChromeClient;-><init>()V

    invoke-virtual {p1, v0}, Landroid/webkit/WebView;->setWebChromeClient(Landroid/webkit/WebChromeClient;)V

    .line 32
    iget-object p1, p0, Lit/banta/dwcheck/MainActivity;->web:Landroid/webkit/WebView;

    new-instance v0, Lit/banta/dwcheck/Client;

    invoke-direct {v0, p0}, Lit/banta/dwcheck/Client;-><init>(Lit/banta/dwcheck/MainActivity;)V

    invoke-virtual {p1, v0}, Landroid/webkit/WebView;->setWebViewClient(Landroid/webkit/WebViewClient;)V

    .line 33
    iget-object p1, p0, Lit/banta/dwcheck/MainActivity;->web:Landroid/webkit/WebView;

    new-instance v0, Lit/banta/dwcheck/Bridge;

    invoke-direct {v0, p0}, Lit/banta/dwcheck/Bridge;-><init>(Lit/banta/dwcheck/MainActivity;)V

    const-string v1, "Android"

    invoke-virtual {p1, v0, v1}, Landroid/webkit/WebView;->addJavascriptInterface(Ljava/lang/Object;Ljava/lang/String;)V

    new-instance v0, Lcom/banta/canonsync/Shared;

    const-string v1, "dw"

    invoke-direct {v0, p0, v1}, Lcom/banta/canonsync/Shared;-><init>(Landroid/content/Context;Ljava/lang/String;)V

    const-string v1, "Banta"

    invoke-virtual {p1, v0, v1}, Landroid/webkit/WebView;->addJavascriptInterface(Ljava/lang/Object;Ljava/lang/String;)V

    .line 34
    iget-object p1, p0, Lit/banta/dwcheck/MainActivity;->web:Landroid/webkit/WebView;

    invoke-virtual {p0, p1}, Lit/banta/dwcheck/MainActivity;->setContentView(Landroid/view/View;)V

    .line 35
    iget-object p1, p0, Lit/banta/dwcheck/MainActivity;->web:Landroid/webkit/WebView;

    const-string v0, "https://app.dwcanon.local/dw/index.html"

    invoke-virtual {p1, v0}, Landroid/webkit/WebView;->loadUrl(Ljava/lang/String;)V

    return-void
.end method

.method openUrl(Ljava/lang/String;)V
    .locals 2

    .line 46
    :try_start_0
    new-instance v0, Landroid/content/Intent;

    const-string v1, "android.intent.action.VIEW"

    invoke-static {p1}, Landroid/net/Uri;->parse(Ljava/lang/String;)Landroid/net/Uri;

    move-result-object p1

    invoke-direct {v0, v1, p1}, Landroid/content/Intent;-><init>(Ljava/lang/String;Landroid/net/Uri;)V

    invoke-virtual {p0, v0}, Lit/banta/dwcheck/MainActivity;->startActivity(Landroid/content/Intent;)V
    :try_end_0
    .catch Ljava/lang/Exception; {:try_start_0 .. :try_end_0} :catch_0

    :catch_0
    return-void
.end method

.method superBack()V
    .locals 0

    .line 43
    invoke-super {p0}, Landroid/app/Activity;->onBackPressed()V

    return-void
.end method
