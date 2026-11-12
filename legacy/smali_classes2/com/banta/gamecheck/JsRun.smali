.class public Lcom/banta/gamecheck/JsRun;
.super Ljava/lang/Object;

# interfaces
.implements Ljava/lang/Runnable;


# instance fields
.field public a:Lcom/banta/gamecheck/MainActivity;

.field public js:Ljava/lang/String;


# direct methods
.method public constructor <init>(Lcom/banta/gamecheck/MainActivity;Ljava/lang/String;)V
    .locals 0

    invoke-direct {p0}, Ljava/lang/Object;-><init>()V

    iput-object p1, p0, Lcom/banta/gamecheck/JsRun;->a:Lcom/banta/gamecheck/MainActivity;

    iput-object p2, p0, Lcom/banta/gamecheck/JsRun;->js:Ljava/lang/String;

    return-void
.end method


# virtual methods
.method public run()V
    .locals 3

    iget-object v0, p0, Lcom/banta/gamecheck/JsRun;->a:Lcom/banta/gamecheck/MainActivity;

    iget-object v0, v0, Lcom/banta/gamecheck/MainActivity;->web:Landroid/webkit/WebView;

    iget-object v1, p0, Lcom/banta/gamecheck/JsRun;->js:Ljava/lang/String;

    const/4 v2, 0x0

    invoke-virtual {v0, v1, v2}, Landroid/webkit/WebView;->evaluateJavascript(Ljava/lang/String;Landroid/webkit/ValueCallback;)V

    return-void
.end method
