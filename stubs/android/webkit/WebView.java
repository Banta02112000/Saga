package android.webkit;
public class WebView extends android.view.View {
    public WebView(android.content.Context c) {}
    public WebSettings getSettings() { return null; }
    public void addJavascriptInterface(Object o, String name) {}
    public void loadUrl(String url) {}
    public void setWebViewClient(WebViewClient c) {}
    public void setWebChromeClient(WebChromeClient c) {}
    public void evaluateJavascript(String script, ValueCallback<String> cb) {}
    public void destroy() {}
    public void stopLoading() {}
    public String getUrl() { return null; }
}
