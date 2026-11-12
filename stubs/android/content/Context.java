package android.content;
public abstract class Context {
    public abstract Object getSystemService(String name);
    public java.io.File getFilesDir() { return null; }
    public ContentResolver getContentResolver() { return null; }
    public android.content.res.Resources getResources() { return null; }
    public String getPackageName() { return null; }
    public Context getApplicationContext() { return null; }
    public void startActivity(Intent i) {}
}
