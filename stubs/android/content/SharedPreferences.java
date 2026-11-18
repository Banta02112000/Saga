package android.content;
public interface SharedPreferences {
    String getString(String k, String d);
    int getInt(String k, int d);
    Editor edit();
    interface Editor { Editor putString(String k, String v); Editor putInt(String k, int v); void apply(); boolean commit(); }
}
