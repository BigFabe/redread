package net.redread.app;

import java.net.URI;
import java.util.regex.*;

final class ShareInput {
    static String server(String value) {
        String clean = value.trim().replaceAll("/+$", "");
        URI uri = URI.create(clean);
        if (!("http".equalsIgnoreCase(uri.getScheme()) || "https".equalsIgnoreCase(uri.getScheme())) || uri.getHost() == null || uri.getUserInfo() != null || uri.getQuery() != null || uri.getFragment() != null || !(uri.getPath() == null || uri.getPath().isEmpty()))
            throw new IllegalArgumentException("Please enter a server address such as https://redread.example, without a path or credentials.");
        return clean;
    }
    static String url(String value) {
        Matcher m = Pattern.compile("https?://[^\\s<>\"]+", Pattern.CASE_INSENSITIVE).matcher(value);
        if (!m.find()) return "";
        String result = m.group().replaceAll("[.,;!?]+$", "");
        while (result.endsWith(")") && result.chars().filter(c -> c == ')').count() > result.chars().filter(c -> c == '(').count()) result = result.substring(0, result.length()-1);
        try { URI u = URI.create(result); return u.getHost() != null && u.getUserInfo() == null ? result : ""; }
        catch (IllegalArgumentException e) { return ""; }
    }
}
