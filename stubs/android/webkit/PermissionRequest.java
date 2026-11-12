package android.webkit;
public abstract class PermissionRequest {
    public static final String RESOURCE_VIDEO_CAPTURE = "android.webkit.resource.VIDEO_CAPTURE";
    public abstract String[] getResources();
    public abstract void grant(String[] resources);
    public abstract void deny();
}
