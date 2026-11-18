package org.json;
public class JSONObject {
    public static final Object NULL = new Object();
    public JSONObject() {}
    public JSONObject(String s) throws JSONException {}
    public JSONObject put(String k, Object v) throws JSONException { return this; }
    public JSONObject put(String k, int v) throws JSONException { return this; }
    public String getString(String k) throws JSONException { return null; }
    public int optInt(String k, int d) { return d; }
    public JSONObject getJSONObject(String k) throws JSONException { return null; }
    public java.util.Iterator<String> keys() { return null; }
    public static String quote(String s) { return null; }
}
