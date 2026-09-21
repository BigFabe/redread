package net.redread.app;

import org.json.*;
import java.net.*;
import java.io.*;
import java.nio.charset.StandardCharsets;

final class Api {
    static String request(String base, String path, JSONObject body) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(base + path).openConnection();
        connection.setConnectTimeout(12000);
        connection.setReadTimeout(60000);
        connection.setInstanceFollowRedirects(false);
        connection.setRequestProperty("Accept", "application/json");
        try {
            if (body != null) {
                connection.setRequestMethod("POST");
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
                try { message = new JSONObject(result).optString("error", message); } catch (JSONException ignored) {}
                throw new IOException(message);
            }
            return result;
        } finally { connection.disconnect(); }
    }
}
