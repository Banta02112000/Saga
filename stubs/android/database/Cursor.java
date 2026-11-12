package android.database;
public interface Cursor {
    boolean moveToFirst();
    int getColumnIndex(String name);
    String getString(int i);
    void close();
}
