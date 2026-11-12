.class public Lcom/banta/gamecheck/ClipRun;
.super Ljava/lang/Object;

# interfaces
.implements Ljava/lang/Runnable;


# instance fields
.field public a:Lcom/banta/gamecheck/MainActivity;

.field public t:Ljava/lang/String;


# direct methods
.method public constructor <init>(Lcom/banta/gamecheck/MainActivity;Ljava/lang/String;)V
    .locals 0

    invoke-direct {p0}, Ljava/lang/Object;-><init>()V

    iput-object p1, p0, Lcom/banta/gamecheck/ClipRun;->a:Lcom/banta/gamecheck/MainActivity;

    iput-object p2, p0, Lcom/banta/gamecheck/ClipRun;->t:Ljava/lang/String;

    return-void
.end method


# virtual methods
.method public run()V
    .locals 4

    :try_start_0
    iget-object v0, p0, Lcom/banta/gamecheck/ClipRun;->a:Lcom/banta/gamecheck/MainActivity;

    const-string v1, "clipboard"

    invoke-virtual {v0, v1}, Lcom/banta/gamecheck/MainActivity;->getSystemService(Ljava/lang/String;)Ljava/lang/Object;

    move-result-object v0

    check-cast v0, Landroid/content/ClipboardManager;

    const-string v1, "GameCheck"

    iget-object v2, p0, Lcom/banta/gamecheck/ClipRun;->t:Ljava/lang/String;

    invoke-static {v1, v2}, Landroid/content/ClipData;->newPlainText(Ljava/lang/CharSequence;Ljava/lang/CharSequence;)Landroid/content/ClipData;

    move-result-object v1

    invoke-virtual {v0, v1}, Landroid/content/ClipboardManager;->setPrimaryClip(Landroid/content/ClipData;)V
    :try_end_0
    .catch Ljava/lang/Throwable; {:try_start_0 .. :try_end_0} :catch_0

    :catch_0
    return-void
.end method
