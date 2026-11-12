package android.view;
public class View {
    public boolean post(Runnable r) { return true; }
    public boolean postDelayed(Runnable r, long ms) { return true; }
    public void setBackgroundColor(int c) {}
    public void setSystemUiVisibility(int v) {}
    public int getSystemUiVisibility() { return 0; }
    public void setAlpha(float a) {}
    public void setVisibility(int v) {}
    public void bringToFront() {}
    public final ViewParent getParent() { return null; }
    public void setPadding(int l, int t, int r, int b) {}
    public void setOnApplyWindowInsetsListener(OnApplyWindowInsetsListener l) {}
    public void requestApplyInsets() {}
    public interface OnApplyWindowInsetsListener { WindowInsets onApplyWindowInsets(View v, WindowInsets insets); }
}
