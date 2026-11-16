package io.github.saturnskies.swapsmith;

import android.content.pm.ActivityInfo;
import android.os.Build;
import android.os.Bundle;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Let the page draw under a camera cutout on the short edges, so the full-screen Life Counter has no bar there.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            WindowManager.LayoutParams attrs = getWindow().getAttributes();
            attrs.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            getWindow().setAttributes(attrs);
        }
        // The page asks for landscape while the Life Counter shows (either landscape side, following the sensor) and lets go elsewhere.
        getBridge().getWebView().addJavascriptInterface(new Object() {
            @JavascriptInterface
            public void setLandscape(final boolean on) {
                runOnUiThread(() -> setRequestedOrientation(on ? ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE : ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED));
            }
        }, "SwapsmithNative");
    }
}
