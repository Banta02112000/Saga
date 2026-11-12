package android.view;
public abstract class ViewGroup extends View implements ViewParent {
    public void removeView(View v) {}
    public void removeAllViews() {}
    public void addView(View v) {}
    public void addView(View v, LayoutParams p) {}
    public static class LayoutParams {
        public static final int MATCH_PARENT = -1;
        public LayoutParams(int w, int h) {}
    }
}
