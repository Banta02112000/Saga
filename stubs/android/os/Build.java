package android.os;
public class Build {
    public static class VERSION {
        // not a compile-time constant, so javac reads the real value on the phone
        public static final int SDK_INT = Integer.parseInt("0");
    }
}
