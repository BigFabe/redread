package net.redread.app;

public final class ShareInputTest {
    private static void equal(String expected, String actual) { if (!expected.equals(actual)) throw new AssertionError(expected + " != " + actual); }
    public static void main(String[] args) {
        equal("https://example.com/story", ShareInput.url("An article\nhttps://example.com/story"));
        equal("https://example.com/wiki/A_(B)", ShareInput.url("Read (https://example.com/wiki/A_(B))."));
        equal("", ShareInput.url("Shared article text without a URL."));
        equal("", ShareInput.url("https://user:pass@example.com"));
        equal("http://100.101.173.69:3210", ShareInput.server(" http://100.101.173.69:3210/ "));
        for (String invalid : new String[]{"file:///etc/passwd", "https://user:pass@example.com", "https://example.com/path", "https://example.com?x=1", "localhost:3210"}) {
            try { ShareInput.server(invalid); throw new AssertionError("Accepted " + invalid); } catch (IllegalArgumentException expected) {}
        }
        System.out.println("ShareInput: all checks passed");
    }
}
