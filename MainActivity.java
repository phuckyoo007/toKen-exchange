package com.tokenexchange.wallet;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.TextView;
import android.window.OnBackInvokedDispatcher;

public class MainActivity extends Activity {
    private static final int BG = Color.parseColor("#06080e"); // same near-black as the web app's backdrop
    private static final String HOME_URL = "http://" + LocalAssetServer.LOCAL_HOST + ":" + LocalAssetServer.PORT + "/index.html";

    private FrameLayout root;
    private WebView webView;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        root = new FrameLayout(this);
        root.setBackgroundColor(BG);
        getWindow().getDecorView().setBackgroundColor(BG);
        applyEdgeToEdge(root);
        setContentView(root);

        if (!LocalAssetServer.ensureStarted(this)) {
            TextView tv = new TextView(this);
            tv.setText("Token Exchange couldn't start its local UI server. Please close and reopen the app; if this keeps happening, reinstall the app.");
            tv.setTextColor(Color.WHITE);
            tv.setPadding(48, 48, 48, 48);
            root.addView(tv);
            return;
        }

        webView = new WebView(this);
        webView.setBackgroundColor(BG);
        root.addView(webView, new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);   // wallet data lives here (stable origin: see LocalAssetServer.PORT)
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setSupportZoom(false);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setUserAgentString(s.getUserAgentString() + " TokenExchangeApp/2.1");

        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new DomainScopedWebViewClient());

        registerBackHandling();

        if (savedInstanceState == null) webView.loadUrl(HOME_URL);
    }

    // ---------------------------------------------------------------- edge-to-edge
    /**
     * Android 15+ draws apps edge-to-edge (under the status and navigation
     * bars) and Android 16 removes the opt-out. Pad the root by the system bar,
     * cutout and keyboard insets so nothing hides underneath them; the WebView
     * then fills the safe area and the page's own env(safe-area-*) values stay 0.
     */
    private void applyEdgeToEdge(final View target) {
        Window w = getWindow();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            w.setDecorFitsSystemWindows(false);
            WindowInsetsController c = w.getInsetsController();
            if (c != null) c.setSystemBarsAppearance(0, WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS);
        } else {
            w.getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
        }
        w.setStatusBarColor(Color.TRANSPARENT);
        w.setNavigationBarColor(Color.TRANSPARENT);

        target.setOnApplyWindowInsetsListener((v, insets) -> {
            int l, t, r, b;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                android.graphics.Insets i = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
                l = i.left; t = i.top; r = i.right; b = i.bottom;
            } else {
                l = insets.getSystemWindowInsetLeft(); t = insets.getSystemWindowInsetTop();
                r = insets.getSystemWindowInsetRight(); b = insets.getSystemWindowInsetBottom();
            }
            v.setPadding(l, t, r, b);
            return Build.VERSION.SDK_INT >= Build.VERSION_CODES.R ? WindowInsets.CONSUMED : insets.consumeSystemWindowInsets();
        });
        target.requestApplyInsets();
    }

    // ---------------------------------------------------------------- Back button
    /**
     * Back asks the web app first (window.TMNativeBack in app.js closes an open
     * sheet or goes up one screen and returns true). If the app is already on a
     * top-level screen it returns false and we send the app to the background.
     * Android 13+ delivers Back through OnBackInvokedCallback; older versions
     * through onBackPressed().
     */
    private void registerBackHandling() {
        if (Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::handleBack);
        }
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        // Only reached below Android 13 (or if no callback is registered).
        handleBack();
    }

    private void handleBack() {
        if (webView == null) { moveTaskToBack(true); return; }
        webView.evaluateJavascript(
                "(function(){try{return !!(window.TMNativeBack && window.TMNativeBack());}catch(e){return false;}})()",
                value -> {
                    if ("true".equals(value)) return;
                    if (webView.canGoBack()) webView.goBack();
                    else moveTaskToBack(true);
                });
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            root.removeView(webView);
            webView.destroy();
            webView = null;
        }
        super.onDestroy(); // the local server is process-wide and stays up (stable port)
    }

    // ---------------------------------------------------------------- navigation scope
    private final class DomainScopedWebViewClient extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri u = request.getUrl();
            String host = u.getHost();
            boolean local = LocalAssetServer.LOCAL_HOST.equals(host) && u.getPort() == LocalAssetServer.PORT;
            boolean site = host != null && (host.equals("tokenswaphub.org") || host.endsWith(".tokenswaphub.org"));
            if (local || site) return false;
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, u));
            } catch (Exception ignored) { }
            return true;
        }
    }
}
