.class public Lcom/banta/gamecheck/BackCb;
.super Ljava/lang/Object;

# interfaces
.implements Landroid/webkit/ValueCallback;


# instance fields
.field public a:Lcom/banta/gamecheck/MainActivity;


# direct methods
.method public constructor <init>(Lcom/banta/gamecheck/MainActivity;)V
    .locals 0

    invoke-direct {p0}, Ljava/lang/Object;-><init>()V

    iput-object p1, p0, Lcom/banta/gamecheck/BackCb;->a:Lcom/banta/gamecheck/MainActivity;

    return-void
.end method


# virtual methods
.method public onReceiveValue(Ljava/lang/Object;)V
    .locals 2

    const-string v0, "\"1\""

    invoke-virtual {v0, p1}, Ljava/lang/String;->equals(Ljava/lang/Object;)Z

    move-result v1

    if-nez v1, :cond_0

    iget-object p0, p0, Lcom/banta/gamecheck/BackCb;->a:Lcom/banta/gamecheck/MainActivity;

    invoke-virtual {p0}, Lcom/banta/gamecheck/MainActivity;->finish()V

    :cond_0
    return-void
.end method
