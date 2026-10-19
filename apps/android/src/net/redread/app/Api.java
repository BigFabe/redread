package net.redread.app;

import org.json.*;
import java.net.*;
import java.io.*;
import java.nio.charset.StandardCharsets;

final class Api {
    static final class HttpError extends IOException {
        final int code;
        final JSONObject body;
        HttpError(int code, String message, JSONObject body) {
            super(message); this.code = code; this.body = body;
        }
    }
    static String request(String base, String path, JSONObject body) throws Exception {
        return request(base, path, body == null ? "GET" : "POST", body, null, 12000, 60000);
    }
    static String request(String base, String path, String method, JSONObject body,
                          java.util.Map<String, String> headers, int connectTimeout, int readTimeout) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(base + path).openConnection();
        connection.setConnectTimeout(connectTimeout);
        connection.setReadTimeout(readTimeout);
        connection.setInstanceFollowRedirects(false);
        connection.setRequestProperty("Accept", "application/json");
        try {
            connection.setRequestMethod(method);
            if (headers != null) for (java.util.Map.Entry<String, String> header : headers.entrySet())
                connection.setRequestProperty(header.getKey(), header.getValue());
            if (body != null) {
                connection.setDoOutput(true);
                connection.setRequestProperty("Content-Type", "application/json");
                try (OutputStream out = connection.getOutputStream()) { out.write(body.toString().getBytes(StandardCharsets.UTF_8)); }
            }
            int code = connection.getResponseCode();
            InputStream stream = code >= 400 ? connection.getErrorStream() : connection.getInputStream();
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            if (stream != null) try (InputStream in = stream) {
                byte[] buffer = new byte[8192]; int n;
                while ((n = in.read(buffer)) != -1) {
                    if (bytes.size() + n > 16000000) throw new IOException("Server response is too large.");
                    bytes.write(buffer, 0, n);
                }
            }
            String result = bytes.toString("UTF-8");
            if (code < 200 || code >= 300) {
                String message = "Server error (HTTP " + code + ").";
                JSONObject detail = new JSONObject();
                try { detail = new JSONObject(result); message = detail.optString("error", message); } catch (JSONException ignored) {}
                throw new HttpError(code, message, detail);
            }
            return result;
        } finally { connection.disconnect(); }
    }
}
