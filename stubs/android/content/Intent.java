package android.content;
import android.net.Uri;
public class Intent {
    public Intent(String action) {}
    public Intent(String action, Uri uri) {}
    public Intent(Context c, Class<?> cls) {}
    public Intent() {}
    public Intent setClassName(Context c, String cls) { return this; }
    public Intent addCategory(String c) { return this; }
    public Intent setType(String t) { return this; }
    public Intent setPackage(String p) { return this; }
    public Intent putExtra(String k, boolean v) { return this; }
    public Intent putExtra(String k, String v) { return this; }
    public String getStringExtra(String k) { return null; }
    public int getIntExtra(String k, int d) { return d; }
    public Intent putExtra(String k, int v) { return this; }
    public String getAction() { return null; }
    public int getFlags() { return 0; }
    public Intent addFlags(int f) { return this; }
    public Uri getData() { return null; }
    public static Intent createChooser(Intent target, CharSequence title) { return target; }
    public ClipData getClipData() { return null; }
    public void removeExtra(String k) { }
}
