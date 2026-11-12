.class public Lcom/banta/gamecheck/ProxyJs;
.super Ljava/lang/Object;


# instance fields
.field public a:Lcom/banta/gamecheck/MainActivity;


# direct methods
.method public constructor <init>(Lcom/banta/gamecheck/MainActivity;)V
    .locals 0

    invoke-direct {p0}, Ljava/lang/Object;-><init>()V

    iput-object p1, p0, Lcom/banta/gamecheck/ProxyJs;->a:Lcom/banta/gamecheck/MainActivity;

    return-void
.end method


# virtual methods
.method public done(Ljava/lang/String;ILjava/lang/String;)V
    .locals 4
    .annotation runtime Landroid/webkit/JavascriptInterface;
    .end annotation

    new-instance v0, Ljava/lang/StringBuilder;

    invoke-direct {v0}, Ljava/lang/StringBuilder;-><init>()V

    const-string v1, "window.__nativeCb("

    invoke-virtual {v0, v1}, Ljava/lang/StringBuilder;->append(Ljava/lang/String;)Ljava/lang/StringBuilder;

    invoke-static {p1}, Lorg/json/JSONObject;->quote(Ljava/lang/String;)Ljava/lang/String;

    move-result-object v1

    invoke-virtual {v0, v1}, Ljava/lang/StringBuilder;->append(Ljava/lang/String;)Ljava/lang/StringBuilder;

    const-string v1, ","

    invoke-virtual {v0, v1}, Ljava/lang/StringBuilder;->append(Ljava/lang/String;)Ljava/lang/StringBuilder;

    invoke-virtual {v0, p2}, Ljava/lang/StringBuilder;->append(I)Ljava/lang/StringBuilder;

    invoke-virtual {v0, v1}, Ljava/lang/StringBuilder;->append(Ljava/lang/String;)Ljava/lang/StringBuilder;

    invoke-static {p3}, Lorg/json/JSONObject;->quote(Ljava/lang/String;)Ljava/lang/String;

    move-result-object v1

    invoke-virtual {v0, v1}, Ljava/lang/StringBuilder;->append(Ljava/lang/String;)Ljava/lang/StringBuilder;

    const-string v1, ")"

    invoke-virtual {v0, v1}, Ljava/lang/StringBuilder;->append(Ljava/lang/String;)Ljava/lang/StringBuilder;

    invoke-virtual {v0}, Ljava/lang/StringBuilder;->toString()Ljava/lang/String;

    move-result-object v1

    new-instance v2, Lcom/banta/gamecheck/JsRun;

    iget-object v3, p0, Lcom/banta/gamecheck/ProxyJs;->a:Lcom/banta/gamecheck/MainActivity;

    invoke-direct {v2, v3, v1}, Lcom/banta/gamecheck/JsRun;-><init>(Lcom/banta/gamecheck/MainActivity;Ljava/lang/String;)V

    invoke-virtual {v3, v2}, Lcom/banta/gamecheck/MainActivity;->runOnUiThread(Ljava/lang/Runnable;)V

    return-void
.end method
