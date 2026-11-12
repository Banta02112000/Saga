.class public Lit/banta/dwcheck/Task;
.super Ljava/lang/Object;
.source "Task.java"

# interfaces
.implements Ljava/lang/Runnable;
.implements Landroid/webkit/ValueCallback;


# static fields
.field static final BACK:I = 0x0

.field static final COPY:I = 0x2

.field static final EVAL:I = 0x5

.field static final FETCH:I = 0x4

.field static final OPEN:I = 0x1

.field static final SHARE:I = 0x3


# instance fields
.field final a:Lit/banta/dwcheck/MainActivity;

.field final kind:I

.field final s1:Ljava/lang/String;

.field final s2:Ljava/lang/String;


# direct methods
.method constructor <init>(Lit/banta/dwcheck/MainActivity;ILjava/lang/String;Ljava/lang/String;)V
    .locals 0

    .line 17
    invoke-direct {p0}, Ljava/lang/Object;-><init>()V

    iput-object p1, p0, Lit/banta/dwcheck/Task;->a:Lit/banta/dwcheck/MainActivity;

    iput p2, p0, Lit/banta/dwcheck/Task;->kind:I

    iput-object p3, p0, Lit/banta/dwcheck/Task;->s1:Ljava/lang/String;

    iput-object p4, p0, Lit/banta/dwcheck/Task;->s2:Ljava/lang/String;

    return-void
.end method


# virtual methods
.method public onReceiveValue(Ljava/lang/Object;)V
    .locals 1

    .line 20
    iget v0, p0, Lit/banta/dwcheck/Task;->kind:I

    if-nez v0, :cond_0

    const-string v0, "true"

    invoke-virtual {v0, p1}, Ljava/lang/String;->equals(Ljava/lang/Object;)Z

    move-result p1

    if-nez p1, :cond_0

    iget-object p1, p0, Lit/banta/dwcheck/Task;->a:Lit/banta/dwcheck/MainActivity;

    invoke-virtual {p1}, Lit/banta/dwcheck/MainActivity;->superBack()V

    :cond_0
    return-void
.end method

.method public run()V
    .locals 10

    .line 24
    iget v0, p0, Lit/banta/dwcheck/Task;->kind:I

    const/4 v1, 0x1

    if-eq v0, v1, :cond_7

    const/4 v2, 0x2

    if-eq v0, v2, :cond_6

    const/4 v2, 0x3

    if-eq v0, v2, :cond_5

    const/4 v2, 0x4

    const/4 v3, 0x0

    const/4 v4, 0x5

    if-eq v0, v2, :cond_1

    if-eq v0, v4, :cond_0

    goto/16 :goto_3

    .line 38
    :cond_0
    iget-object v0, p0, Lit/banta/dwcheck/Task;->a:Lit/banta/dwcheck/MainActivity;

    iget-object v0, v0, Lit/banta/dwcheck/MainActivity;->web:Landroid/webkit/WebView;

    iget-object v1, p0, Lit/banta/dwcheck/Task;->s1:Ljava/lang/String;

    invoke-virtual {v0, v1, v3}, Landroid/webkit/WebView;->evaluateJavascript(Ljava/lang/String;Landroid/webkit/ValueCallback;)V

    goto/16 :goto_3

    :cond_1
    const/4 v0, 0x0

    .line 42
    :try_start_0
    new-instance v2, Ljava/net/URL;

    iget-object v5, p0, Lit/banta/dwcheck/Task;->s1:Ljava/lang/String;

    invoke-direct {v2, v5}, Ljava/net/URL;-><init>(Ljava/lang/String;)V

    invoke-virtual {v2}, Ljava/net/URL;->openConnection()Ljava/net/URLConnection;

    move-result-object v2

    check-cast v2, Ljava/net/HttpURLConnection;

    const-string v5, "User-Agent"

    const-string v6, "DWCanonChecklist/1.0 (personal Android app)"

    .line 43
    invoke-virtual {v2, v5, v6}, Ljava/net/HttpURLConnection;->setRequestProperty(Ljava/lang/String;Ljava/lang/String;)V

    const/16 v5, 0x3a98

    .line 44
    invoke-virtual {v2, v5}, Ljava/net/HttpURLConnection;->setConnectTimeout(I)V

    const/16 v5, 0x7530

    invoke-virtual {v2, v5}, Ljava/net/HttpURLConnection;->setReadTimeout(I)V

    .line 45
    invoke-virtual {v2}, Ljava/net/HttpURLConnection;->getResponseCode()I

    move-result v5

    const/16 v6, 0x190

    if-ge v5, v6, :cond_2

    .line 46
    invoke-virtual {v2}, Ljava/net/HttpURLConnection;->getInputStream()Ljava/io/InputStream;

    move-result-object v2

    goto :goto_0

    :cond_2
    invoke-virtual {v2}, Ljava/net/HttpURLConnection;->getErrorStream()Ljava/io/InputStream;

    move-result-object v2

    .line 47
    :goto_0
    new-instance v7, Ljava/io/ByteArrayOutputStream;

    invoke-direct {v7}, Ljava/io/ByteArrayOutputStream;-><init>()V

    const/16 v8, 0x4000

    new-array v8, v8, [B

    :goto_1
    if-eqz v2, :cond_3

    .line 49
    invoke-virtual {v2, v8}, Ljava/io/InputStream;->read([B)I

    move-result v9

    if-lez v9, :cond_3

    invoke-virtual {v7, v8, v0, v9}, Ljava/io/ByteArrayOutputStream;->write([BII)V

    goto :goto_1

    :cond_3
    const-string v2, "UTF-8"

    .line 50
    invoke-virtual {v7, v2}, Ljava/io/ByteArrayOutputStream;->toString(Ljava/lang/String;)Ljava/lang/String;

    move-result-object v2
    :try_end_0
    .catch Ljava/lang/Exception; {:try_start_0 .. :try_end_0} :catch_0

    if-ge v5, v6, :cond_4

    move v0, v1

    goto :goto_2

    :catch_0
    move-exception v1

    .line 51
    invoke-static {v1}, Ljava/lang/String;->valueOf(Ljava/lang/Object;)Ljava/lang/String;

    move-result-object v2

    .line 52
    :cond_4
    :goto_2
    new-instance v1, Ljava/lang/StringBuilder;

    invoke-direct {v1}, Ljava/lang/StringBuilder;-><init>()V

    const-string v5, "window.__httpCb("

    invoke-virtual {v1, v5}, Ljava/lang/StringBuilder;->append(Ljava/lang/String;)Ljava/lang/StringBuilder;

    iget-object v5, p0, Lit/banta/dwcheck/Task;->s2:Ljava/lang/String;

    invoke-static {v5}, Lorg/json/JSONObject;->quote(Ljava/lang/String;)Ljava/lang/String;

    move-result-object v5

    invoke-virtual {v1, v5}, Ljava/lang/StringBuilder;->append(Ljava/lang/String;)Ljava/lang/StringBuilder;

    const-string v5, ","

    invoke-virtual {v1, v5}, Ljava/lang/StringBuilder;->append(Ljava/lang/String;)Ljava/lang/StringBuilder;

    invoke-virtual {v1, v0}, Ljava/lang/StringBuilder;->append(Z)Ljava/lang/StringBuilder;

    invoke-virtual {v1, v5}, Ljava/lang/StringBuilder;->append(Ljava/lang/String;)Ljava/lang/StringBuilder;

    invoke-static {v2}, Lorg/json/JSONObject;->quote(Ljava/lang/String;)Ljava/lang/String;

    move-result-object v0

    invoke-virtual {v1, v0}, Ljava/lang/StringBuilder;->append(Ljava/lang/String;)Ljava/lang/StringBuilder;

    const-string v0, ")"

    invoke-virtual {v1, v0}, Ljava/lang/StringBuilder;->append(Ljava/lang/String;)Ljava/lang/StringBuilder;

    invoke-virtual {v1}, Ljava/lang/StringBuilder;->toString()Ljava/lang/String;

    move-result-object v0

    .line 53
    iget-object v1, p0, Lit/banta/dwcheck/Task;->a:Lit/banta/dwcheck/MainActivity;

    iget-object v1, v1, Lit/banta/dwcheck/MainActivity;->main:Landroid/os/Handler;

    new-instance v2, Lit/banta/dwcheck/Task;

    iget-object v5, p0, Lit/banta/dwcheck/Task;->a:Lit/banta/dwcheck/MainActivity;

    invoke-direct {v2, v5, v4, v0, v3}, Lit/banta/dwcheck/Task;-><init>(Lit/banta/dwcheck/MainActivity;ILjava/lang/String;Ljava/lang/String;)V

    invoke-virtual {v1, v2}, Landroid/os/Handler;->post(Ljava/lang/Runnable;)Z

    goto :goto_3

    .line 32
    :cond_5
    new-instance v0, Landroid/content/Intent;

    const-string v1, "android.intent.action.SEND"

    invoke-direct {v0, v1}, Landroid/content/Intent;-><init>(Ljava/lang/String;)V

    const-string v1, "text/plain"

    .line 33
    invoke-virtual {v0, v1}, Landroid/content/Intent;->setType(Ljava/lang/String;)Landroid/content/Intent;

    .line 34
    iget-object v1, p0, Lit/banta/dwcheck/Task;->s1:Ljava/lang/String;

    const-string v2, "android.intent.extra.TEXT"

    invoke-virtual {v0, v2, v1}, Landroid/content/Intent;->putExtra(Ljava/lang/String;Ljava/lang/String;)Landroid/content/Intent;

    .line 35
    iget-object v1, p0, Lit/banta/dwcheck/Task;->a:Lit/banta/dwcheck/MainActivity;

    const-string v2, "Export DW Canon backup"

    invoke-static {v0, v2}, Landroid/content/Intent;->createChooser(Landroid/content/Intent;Ljava/lang/CharSequence;)Landroid/content/Intent;

    move-result-object v0

    invoke-virtual {v1, v0}, Lit/banta/dwcheck/MainActivity;->startActivity(Landroid/content/Intent;)V

    goto :goto_3

    .line 27
    :cond_6
    iget-object v0, p0, Lit/banta/dwcheck/Task;->a:Lit/banta/dwcheck/MainActivity;

    const-string v1, "clipboard"

    invoke-virtual {v0, v1}, Lit/banta/dwcheck/MainActivity;->getSystemService(Ljava/lang/String;)Ljava/lang/Object;

    move-result-object v0

    check-cast v0, Landroid/content/ClipboardManager;

    .line 28
    iget-object v1, p0, Lit/banta/dwcheck/Task;->s1:Ljava/lang/String;

    const-string v2, "DW Canon"

    invoke-static {v2, v1}, Landroid/content/ClipData;->newPlainText(Ljava/lang/CharSequence;Ljava/lang/CharSequence;)Landroid/content/ClipData;

    move-result-object v1

    invoke-virtual {v0, v1}, Landroid/content/ClipboardManager;->setPrimaryClip(Landroid/content/ClipData;)V

    goto :goto_3

    .line 25
    :cond_7
    iget-object v0, p0, Lit/banta/dwcheck/Task;->a:Lit/banta/dwcheck/MainActivity;

    iget-object v1, p0, Lit/banta/dwcheck/Task;->s1:Ljava/lang/String;

    invoke-virtual {v0, v1}, Lit/banta/dwcheck/MainActivity;->openUrl(Ljava/lang/String;)V

    :goto_3
    return-void
.end method
