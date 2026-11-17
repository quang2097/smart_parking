package com.smarttraffic.android;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.net.URL;

@CapacitorPlugin(name = "TrafficCamera")
public class TrafficCameraPlugin extends Plugin {
    @PluginMethod public void stopMedia(PluginCall call) {
        ((MainActivity) getActivity()).stopCameraMedia();
        call.resolve();
    }
    @PluginMethod public void setBackend(PluginCall call) {
        try {
            URL url = new URL(call.getString("base", ""));
            if ((!url.getProtocol().equals("http") && !url.getProtocol().equals("https")) || url.getHost().isEmpty()
                || url.getUserInfo() != null || url.getQuery() != null || url.getRef() != null
                || (!url.getPath().isEmpty() && !url.getPath().equals("/"))) throw new Exception("Invalid backend origin");
            String origin = url.getProtocol() + "://" + url.getHost() + (url.getPort() == -1 ? "" : ":" + url.getPort());
            ((MainActivity) getActivity()).setCameraBackend(origin);
            call.resolve();
        } catch (Exception error) { call.reject("Invalid camera backend origin"); }
    }
}
