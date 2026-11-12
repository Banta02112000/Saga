.class public Lcom/banta/gamecheck/ProxyTask;
.super Ljava/lang/Object;

# interfaces
.implements Ljava/lang/Runnable;


# instance fields
.field public a:Lcom/banta/gamecheck/MainActivity;

.field public js:Ljava/lang/String;

.field public origin:Ljava/lang/String;


# direct methods
.method public constructor <init>()V
    .locals 0

    invoke-direct {p0}, Ljava/lang/Object;-><init>()V

    return-void
.end method


# virtual methods
.method public run()V
    .locals 9

    :try_start_0
    iget-object v0, p0, Lcom/banta/gamecheck/ProxyTask;->a:Lcom/banta/gamecheck/MainActivity;

    iget-object v1, v0, Lcom/banta/gamecheck/MainActivity;->proxies:Ljava/util/HashMap;

    iget-object v2, p0, Lcom/banta/gamecheck/ProxyTask;->origin:Ljava/lang/String;

    invoke-virtual {v1, v2}, Ljava/util/HashMap;->get(Ljava/lang/Object;)Ljava/lang/Object;

    move-result-object v3

    check-cast v3, Lcom/banta/gamecheck/ProxyView;

    if-nez v3, :cond_0

    new-instance v4, Landroid/webkit/WebView;

    invoke-direct {v4, v0}, Landroid/webkit/WebView;-><init>(Landroid/content/Context;)V

    invoke-virtual {v4}, Landroid/webkit/WebView;->getSettings()Landroid/webkit/WebSettings;

    move-result-object v5

    const/4 v6, 0x1

    invoke-virtual {v5, v6}, Landroid/webkit/WebSettings;->setJavaScriptEnabled(Z)V

    invoke-virtual {v5, v6}, Landroid/webkit/WebSettings;->setDomStorageEnabled(Z)V

    invoke-virtual {v5, v6}, Landroid/webkit/WebSettings;->setBlockNetworkImage(Z)V

    new-instance v3, Lcom/banta/gamecheck/ProxyView;

    invoke-direct {v3}, Lcom/banta/gamecheck/ProxyView;-><init>()V

    iput-object v4, v3, Lcom/banta/gamecheck/ProxyView;->web:Landroid/webkit/WebView;

    invoke-virtual {v4, v3}, Landroid/webkit/WebView;->setWebViewClient(Landroid/webkit/WebViewClient;)V

    new-instance v5, Lcom/banta/gamecheck/ProxyJs;

    invoke-direct {v5, v0}, Lcom/banta/gamecheck/ProxyJs;-><init>(Lcom/banta/gamecheck/MainActivity;)V

    const-string v7, "GCProxy"

    invoke-virtual {v4, v5, v7}, Landroid/webkit/WebView;->addJavascriptInterface(Ljava/lang/Object;Ljava/lang/String;)V

    iget-object v5, v0, Lcom/banta/gamecheck/MainActivity;->root:Landroid/widget/FrameLayout;

    new-instance v7, Landroid/widget/FrameLayout$LayoutParams;

    const/4 v8, 0x1

    invoke-direct {v7, v8, v8}, Landroid/widget/FrameLayout$LayoutParams;-><init>(II)V

    invoke-virtual {v5, v4, v7}, Landroid/widget/FrameLayout;->addView(Landroid/view/View;Landroid/view/ViewGroup$LayoutParams;)V

    const/4 v7, 0x0

    invoke-virtual {v4, v7}, Landroid/webkit/WebView;->setAlpha(F)V

    invoke-virtual {v1, v2, v3}, Ljava/util/HashMap;->put(Ljava/lang/Object;Ljava/lang/Object;)Ljava/lang/Object;

    invoke-virtual {v4, v2}, Landroid/webkit/WebView;->loadUrl(Ljava/lang/String;)V

    :cond_0
    iget-object v4, p0, Lcom/banta/gamecheck/ProxyTask;->js:Ljava/lang/String;

    invoke-virtual {v3, v4}, Lcom/banta/gamecheck/ProxyView;->run(Ljava/lang/String;)V
    :try_end_0
    .catch Ljava/lang/Throwable; {:try_start_0 .. :try_end_0} :catch_0

    :catch_0
    return-void
.end method
