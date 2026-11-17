package com.smarttraffic.android;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;

public class MainActivity extends BridgeActivity {
    private CameraWebViewClient cameras;
    @Override public void onCreate(Bundle state) {
        registerPlugin(TrafficCameraPlugin.class);
        super.onCreate(state);
        cameras = new CameraWebViewClient(getBridge());
        getBridge().setWebViewClient(cameras);
    }
    public void setCameraBackend(String origin) { if (cameras != null) cameras.setBackend(origin); }
    public void stopCameraMedia() { if (cameras != null) cameras.cancelAll(); }
    @Override public void onPause() {
        if (cameras != null) cameras.cancelAll();
        if (getBridge() != null) getBridge().triggerWindowJSEvent("traffic-camera-paused");
        super.onPause();
    }
    @Override public void onDestroy() {
        if (cameras != null) cameras.cancelAll();
        super.onDestroy();
    }
}
