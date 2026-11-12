package com.biteandbrew.pos;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.view.KeyEvent;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.ValueCallback;
import android.webkit.URLUtil;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.webkit.WebViewAssetLoader;

/**
 * Bite & Brew Android app: a full-screen shell around the café's website.
 *
 *  - First launch shows start.html (bundled): enter the café's web address, or try the demo.
 *  - The saved address is opened on every launch; the website itself holds all data
 *    (the app stores nothing about the café except that address).
 *  - If the server cannot be reached an offline page offers Retry / Change address.
 *  - Reports (PDF/Excel/CSV) are saved to the phone's Downloads folder.
 */
public class MainActivity extends Activity {
    private static final String PREFS = "bitebrew";
    private static final String KEY_URL = "server_url";
    private static final String ASSETS = "https://appassets.androidplatform.net/assets/";
    private static final int FILE_CHOOSER = 42;

    private WebView web;
    private WebViewAssetLoader assetLoader;
    private ValueCallback<Uri[]> filePathCallback;
    private SharedPreferences prefs;
    private boolean onLocalPage = true;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON); // tills should not sleep

        assetLoader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        web = new WebView(this);
        setContentView(web);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setMediaPlaybackRequiresUserGesture(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setUserAgentString(s.getUserAgentString() + " BiteBrewApp/1.0");
        CookieManager.getInstance().setAcceptCookie(true);

        web.setWebViewClient(new Client());
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (filePathCallback != null) filePathCallback.onReceiveValue(null);
                filePathCallback = callback;
                try {
                    startActivityForResult(params.createIntent(), FILE_CHOOSER);
                } catch (Exception e) {
                    filePathCallback = null;
                    return false;
                }
                return true;
            }
        });
        web.setDownloadListener((url, userAgent, contentDisposition, mimeType, contentLength) -> {
            try {
                DownloadManager.Request req = new DownloadManager.Request(Uri.parse(url));
                String name = URLUtil.guessFileName(url, contentDisposition, mimeType);
                req.setMimeType(mimeType);
                req.addRequestHeader("Cookie", CookieManager.getInstance().getCookie(url));
                req.addRequestHeader("User-Agent", userAgent);
                req.addRequestHeader("x-bitebrew-client", "web");
                req.setTitle(name);
                req.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                req.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name);
                ((DownloadManager) getSystemService(DOWNLOAD_SERVICE)).enqueue(req);
                Toast.makeText(this, "Saving " + name + " to Downloads", Toast.LENGTH_LONG).show();
            } catch (Exception e) {
                Toast.makeText(this, "Could not save the file", Toast.LENGTH_LONG).show();
            }
        });

        if (savedInstanceState != null) {
            web.restoreState(savedInstanceState);
        } else {
            openStart();
        }
    }

    private String savedUrl() { return prefs.getString(KEY_URL, null); }

    private void openStart() {
        String url = savedUrl();
        if (url != null) { onLocalPage = false; web.loadUrl(url); }
        else { onLocalPage = true; web.loadUrl(ASSETS + "start.html"); }
    }

    private class Client extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            return assetLoader.shouldInterceptRequest(request.getUrl());
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri u = request.getUrl();
            if ("bitebrew".equals(u.getScheme())) { handleCommand(u); return true; }
            String host = u.getHost() == null ? "" : u.getHost();
            String server = savedUrl();
            String serverHost = server == null ? "" : String.valueOf(Uri.parse(server).getHost());
            boolean ours = host.equals("appassets.androidplatform.net") || host.equals(serverHost);
            if (ours) return false;
            try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception ignored) { }
            return true;
        }

        @Override
        public void onPageStarted(WebView view, String url, Bitmap favicon) {
            onLocalPage = url != null && url.startsWith(ASSETS);
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (request.isForMainFrame() && !request.getUrl().toString().startsWith(ASSETS)) {
                String shown = Uri.encode(request.getUrl().toString());
                onLocalPage = true;
                view.loadUrl(ASSETS + "offline.html?url=" + shown);
            }
        }
    }

    /** Commands from the bundled pages: bitebrew://connect?url=…, demo, retry, change. */
    private void handleCommand(Uri u) {
        String cmd = u.getHost();
        if ("connect".equals(cmd)) {
            String url = u.getQueryParameter("url");
            if (url != null && (url.startsWith("http://") || url.startsWith("https://"))) {
                prefs.edit().putString(KEY_URL, url).apply();
                onLocalPage = false;
                web.loadUrl(url);
            }
        } else if ("demo".equals(cmd)) {
            onLocalPage = true;
            web.loadUrl(ASSETS + "demo.html");
        } else if ("retry".equals(cmd)) {
            openStart();
        } else if ("change".equals(cmd)) {
            prefs.edit().remove(KEY_URL).apply();
            onLocalPage = true;
            web.loadUrl(ASSETS + "start.html");
        }
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            if (web.canGoBack() && !onLocalPage) { web.goBack(); return true; }
            new AlertDialog.Builder(this)
                    .setTitle("Bite & Brew")
                    .setItems(new String[]{"Stay", "Change café address", "Exit"}, (d, which) -> {
                        if (which == 1) handleCommand(Uri.parse("bitebrew://change"));
                        else if (which == 2) finish();
                    }).show();
            return true;
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == FILE_CHOOSER && filePathCallback != null) {
            filePathCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
            filePathCallback = null;
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        web.saveState(outState);
    }
}
