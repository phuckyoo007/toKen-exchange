package com.tokenexchange.wallet;

import android.content.Context;
import android.content.res.AssetManager;
import android.util.Log;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Tiny HTTP server bound to 127.0.0.1 only. It serves the bundled web app from
 * assets/www and forwards /api/* to the live site, so the wallet UI is exactly
 * the website's code.
 *
 * The port is FIXED. A browser ties localStorage / IndexedDB (where the wallet
 * lives) to the exact origin, port included, so a port that changes between
 * launches would make the wallet vanish every time the app is closed. Never
 * change PORT in a later release or existing users lose access to their stored
 * wallet (they would need their recovery phrase).
 */
final class LocalAssetServer {
    static final int PORT = 47831;
    static final String LOCAL_HOST = "127.0.0.1";
    static final String UPSTREAM_ORIGIN = "https://www.tokenswaphub.org";
    private static final String ASSET_PREFIX = "www";
    private static final String TAG = "LocalAssetServer";
    private static final int MAX_BODY = 2 * 1024 * 1024;

    private static LocalAssetServer instance;

    private final AssetManager assets;
    private final ExecutorService pool = Executors.newCachedThreadPool(r -> {
        Thread t = new Thread(r, "LocalAssetServer-conn");
        t.setDaemon(true);
        return t;
    });
    private ServerSocket serverSocket;

    private LocalAssetServer(Context ctx) {
        this.assets = ctx.getApplicationContext().getAssets();
    }

    /** Starts the process-wide server once; later calls reuse it. Returns false if the port can't be bound. */
    static synchronized boolean ensureStarted(Context ctx) {
        if (instance != null && instance.serverSocket != null && !instance.serverSocket.isClosed()) return true;
        LocalAssetServer s = new LocalAssetServer(ctx);
        // The previous process may still be releasing the port for a moment.
        for (int attempt = 0; attempt < 10; attempt++) {
            try {
                ServerSocket ss = new ServerSocket();
                ss.setReuseAddress(true);
                ss.bind(new java.net.InetSocketAddress(InetAddress.getByName(LOCAL_HOST), PORT));
                s.serverSocket = ss;
                instance = s;
                Thread t = new Thread(s::acceptLoop, "LocalAssetServer-accept");
                t.setDaemon(true);
                t.start();
                return true;
            } catch (IOException e) {
                Log.w(TAG, "bind attempt " + attempt + " failed", e);
                try { Thread.sleep(300); } catch (InterruptedException ie) { Thread.currentThread().interrupt(); return false; }
            }
        }
        return false;
    }

    private void acceptLoop() {
        while (serverSocket != null && !serverSocket.isClosed()) {
            try {
                final Socket sock = serverSocket.accept();
                pool.execute(() -> handle(sock));
            } catch (IOException e) {
                if (serverSocket != null && !serverSocket.isClosed()) Log.w(TAG, "accept failed", e);
            }
        }
    }

    // ---------------------------------------------------------------- request parsing
    private static final class HttpRequest {
        String method = "GET";
        String path = "/";
        String query = "";
        final Map<String, String> headers = new LinkedHashMap<>();
        byte[] body = new byte[0];
    }

    private static String readLine(InputStream in) throws IOException {
        StringBuilder sb = new StringBuilder();
        int c;
        while ((c = in.read()) != -1) {
            if (c == '\n') break;
            if (c != '\r') sb.append((char) c);
            if (sb.length() > 16384) throw new IOException("header line too long");
        }
        if (c == -1 && sb.length() == 0) return null;
        return sb.toString();
    }

    private HttpRequest parse(InputStream in) throws IOException {
        String line = readLine(in);
        if (line == null || line.isEmpty()) return null;
        String[] parts = line.split(" ");
        if (parts.length < 2) return null;
        HttpRequest r = new HttpRequest();
        r.method = parts[0].toUpperCase(Locale.ROOT);
        String target = parts[1];
        int q = target.indexOf('?');
        if (q >= 0) { r.query = target.substring(q + 1); target = target.substring(0, q); }
        r.path = target;
        String h;
        while ((h = readLine(in)) != null && !h.isEmpty()) {
            int i = h.indexOf(':');
            if (i > 0) r.headers.put(h.substring(0, i).trim().toLowerCase(Locale.ROOT), h.substring(i + 1).trim());
        }
        String cl = r.headers.get("content-length");
        if (cl != null) {
            int len;
            try { len = Integer.parseInt(cl); } catch (NumberFormatException e) { return null; }
            if (len < 0 || len > MAX_BODY) return null;
            byte[] b = new byte[len];
            int off = 0;
            while (off < len) {
                int n = in.read(b, off, len - off);
                if (n < 0) break;
                off += n;
            }
            r.body = b;
        }
        return r;
    }

    // ---------------------------------------------------------------- handling
    private void handle(Socket sock) {
        try {
            sock.setSoTimeout(30000);
            InputStream in = sock.getInputStream();
            OutputStream out = sock.getOutputStream();
            HttpRequest req = parse(in);
            if (req == null) { respond(out, 400, "Bad Request", "text/plain; charset=utf-8", "Bad request".getBytes(StandardCharsets.UTF_8), null); return; }
            if (req.path.startsWith("/api/")) proxyToUpstream(req, out);
            else serveAsset(req, out);
            out.flush();
        } catch (Exception e) {
            Log.w(TAG, "request failed", e);
        } finally {
            try { sock.close(); } catch (IOException ignored) { }
        }
    }

    private void serveAsset(HttpRequest req, OutputStream out) throws IOException {
        if (!req.method.equals("GET") && !req.method.equals("HEAD")) {
            respond(out, 405, "Method Not Allowed", "text/plain; charset=utf-8", "Method not allowed".getBytes(StandardCharsets.UTF_8), null);
            return;
        }
        String path = req.path;
        if (path.contains("..") || path.contains("\\") || path.contains("%")) {
            respond(out, 400, "Bad Request", "text/plain; charset=utf-8", "Bad request".getBytes(StandardCharsets.UTF_8), null);
            return;
        }
        if (path.equals("/") || path.isEmpty()) path = "/index.html";
        byte[] data = readAsset(path);
        if (data == null) {
            // Unknown non-file route: fall back to the app shell, like the website does.
            if (!path.contains(".")) { path = "/index.html"; data = readAsset(path); }
        }
        if (data == null) {
            respond(out, 404, "Not Found", "text/plain; charset=utf-8", "Not found".getBytes(StandardCharsets.UTF_8), null);
            return;
        }
        Map<String, String> extra = new LinkedHashMap<>();
        extra.put("Cache-Control", "no-cache");
        respond(out, 200, "OK", mimeTypeFor(path), req.method.equals("HEAD") ? new byte[0] : data, extra, data.length);
    }

    private byte[] readAsset(String path) {
        try (InputStream is = assets.open(ASSET_PREFIX + path)) {
            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            byte[] buf = new byte[16384];
            int n;
            while ((n = is.read(buf)) > 0) bos.write(buf, 0, n);
            return bos.toByteArray();
        } catch (IOException e) {
            return null;
        }
    }

    private void proxyToUpstream(HttpRequest req, OutputStream out) throws IOException {
        HttpURLConnection c = null;
        try {
            String url = UPSTREAM_ORIGIN + req.path + (req.query.isEmpty() ? "" : "?" + req.query);
            c = (HttpURLConnection) new URL(url).openConnection();
            c.setConnectTimeout(15000);
            c.setReadTimeout(30000);
            c.setInstanceFollowRedirects(false);
            c.setRequestMethod(req.method);
            for (Map.Entry<String, String> e : req.headers.entrySet()) {
                String k = e.getKey();
                if (k.equals("host") || k.equals("connection") || k.equals("content-length") || k.equals("accept-encoding")
                        || k.equals("origin") || k.equals("cookie") || k.equals("referer")) continue;
                c.setRequestProperty(k, e.getValue());
            }
            c.setRequestProperty("Accept-Encoding", "identity");
            c.setRequestProperty("Origin", UPSTREAM_ORIGIN);
            if (req.body.length > 0 && !req.method.equals("GET") && !req.method.equals("HEAD")) {
                c.setDoOutput(true);
                c.setFixedLengthStreamingMode(req.body.length);
                try (OutputStream os = c.getOutputStream()) { os.write(req.body); }
            }
            int code = c.getResponseCode();
            String msg = c.getResponseMessage();
            InputStream is = code >= 400 ? c.getErrorStream() : c.getInputStream();
            byte[] body = new byte[0];
            if (is != null) {
                try (InputStream in = is) {
                    ByteArrayOutputStream bos = new ByteArrayOutputStream();
                    byte[] buf = new byte[16384];
                    int n;
                    while ((n = in.read(buf)) > 0) bos.write(buf, 0, n);
                    body = bos.toByteArray();
                }
            }
            String ctype = c.getContentType();
            respond(out, code, msg == null ? "" : msg, ctype == null ? "application/octet-stream" : ctype, body, null);
        } catch (IOException e) {
            Log.w(TAG, "proxy failed for " + req.path, e);
            respond(out, 502, "Bad Gateway", "application/json; charset=utf-8", "{\"error\":\"Bad Gateway\"}".getBytes(StandardCharsets.UTF_8), null);
        } finally {
            if (c != null) c.disconnect();
        }
    }

    private static void respond(OutputStream out, int code, String text, String type, byte[] body, Map<String, String> extra) throws IOException {
        respond(out, code, text, type, body, extra, body.length);
    }

    private static void respond(OutputStream out, int code, String text, String type, byte[] body, Map<String, String> extra, int declaredLength) throws IOException {
        StringBuilder sb = new StringBuilder();
        sb.append("HTTP/1.1 ").append(code).append(' ').append(text).append("\r\n");
        sb.append("Content-Type: ").append(type).append("\r\n");
        sb.append("Content-Length: ").append(declaredLength).append("\r\n");
        if (extra != null) for (Map.Entry<String, String> e : extra.entrySet()) sb.append(e.getKey()).append(": ").append(e.getValue()).append("\r\n");
        sb.append("Connection: close\r\n\r\n");
        out.write(sb.toString().getBytes(StandardCharsets.ISO_8859_1));
        out.write(body);
    }

    static String mimeTypeFor(String path) {
        String p = path.toLowerCase(Locale.ROOT);
        if (p.endsWith(".html")) return "text/html; charset=utf-8";
        if (p.endsWith(".js")) return "application/javascript; charset=utf-8";
        if (p.endsWith(".css")) return "text/css; charset=utf-8";
        if (p.endsWith(".json")) return "application/json; charset=utf-8";
        if (p.endsWith(".webmanifest")) return "application/manifest+json";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".jpg") || p.endsWith(".jpeg")) return "image/jpeg";
        if (p.endsWith(".ico")) return "image/x-icon";
        if (p.endsWith(".woff2")) return "font/woff2";
        if (p.endsWith(".woff")) return "font/woff";
        return "application/octet-stream";
    }
}
