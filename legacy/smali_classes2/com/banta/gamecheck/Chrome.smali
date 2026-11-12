.class public Lcom/banta/gamecheck/Chrome;
.super Landroid/webkit/WebChromeClient;


# instance fields
.field private a:Lcom/banta/gamecheck/MainActivity;


# direct methods
.method public constructor <init>(Lcom/banta/gamecheck/MainActivity;)V
    .locals 0

    invoke-direct {p0}, Landroid/webkit/WebChromeClient;-><init>()V

    iput-object p1, p0, Lcom/banta/gamecheck/Chrome;->a:Lcom/banta/gamecheck/MainActivity;

    return-void
.end method


# virtual methods
.method public onShowFileChooser(Landroid/webkit/WebView;Landroid/webkit/ValueCallback;Landroid/webkit/WebChromeClient$FileChooserParams;)Z
    .locals 3

    iget-object v0, p0, Lcom/banta/gamecheck/Chrome;->a:Lcom/banta/gamecheck/MainActivity;

    iget-object v1, v0, Lcom/banta/gamecheck/MainActivity;->cb:Landroid/webkit/ValueCallback;

    if-eqz v1, :cond_0

    const/4 v2, 0x0

    invoke-interface {v1, v2}, Landroid/webkit/ValueCallback;->onReceiveValue(Ljava/lang/Object;)V

    :cond_0
    iput-object p2, v0, Lcom/banta/gamecheck/MainActivity;->cb:Landroid/webkit/ValueCallback;

    new-instance v1, Landroid/content/Intent;

    const-string v2, "android.intent.action.GET_CONTENT"

    invoke-direct {v1, v2}, Landroid/content/Intent;-><init>(Ljava/lang/String;)V

    const-string v2, "android.intent.category.OPENABLE"

    invoke-virtual {v1, v2}, Landroid/content/Intent;->addCategory(Ljava/lang/String;)Landroid/content/Intent;

    const-string v2, "*/*"

    invoke-virtual {v1, v2}, Landroid/content/Intent;->setType(Ljava/lang/String;)Landroid/content/Intent;

    const/4 v2, 0x1

    invoke-virtual {v0, v1, v2}, Lcom/banta/gamecheck/MainActivity;->startActivityForResult(Landroid/content/Intent;I)V

    const/4 v2, 0x1

    return v2
.end method
