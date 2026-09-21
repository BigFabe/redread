package net.redread.app;

import android.app.*;
import android.content.*;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.*;
import android.text.*;
import android.view.*;
import android.widget.*;
import org.json.*;
import java.util.concurrent.*;

public final class MainActivity extends Activity {
    private static final int BG = Color.rgb(248,249,251), INK = Color.rgb(37,38,53), MUTED = Color.rgb(123,126,139), RED = Color.rgb(215,71,82);
    private final ExecutorService io = Executors.newFixedThreadPool(2);
    private final Handler handler = new Handler();
    private LinearLayout root, list, playerBox;
    private TextView status, playerTitle, time;
    private Button speedButton;
    private ImageButton toggle, fullToggle;
    private Typeface bodyFont, headingFont;
    private Dialog playerDialog;
    private TextView fullTitle;
    private ProgressBar miniProgress;
    private EditText search;
    private SeekBar seek;
    private JSONArray articles = new JSONArray();
    private String base = "", pendingShare = "", pendingTitle = "";
    private boolean loading, seeking;
    private AlertDialog importDialog;
    private long lastRefresh;
    private final Runnable tick = new Runnable() { public void run() { updatePlayer(); if (System.currentTimeMillis() - lastRefresh > 15000 && !base.isEmpty()) refresh(); handler.postDelayed(this, 500); } };

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        base = getSharedPreferences("redread", 0).getString("server", "");
        if (state != null) { pendingShare = state.getString("share", ""); pendingTitle = state.getString("shareTitle", ""); }
        else readShare(getIntent());
        bodyFont = Typeface.createFromAsset(getAssets(), "fonts/dm-sans.ttf");
        headingFont = Typeface.createFromAsset(getAssets(), "fonts/manrope.ttf");
        build();
        if (base.isEmpty()) serverDialog(); else { refresh(); if (!pendingShare.isEmpty()) showImport(); }
    }
    @Override protected void onSaveInstanceState(Bundle state) { super.onSaveInstanceState(state); state.putString("share", pendingShare); state.putString("shareTitle", pendingTitle); }
    @Override protected void onNewIntent(Intent intent) { super.onNewIntent(intent); setIntent(intent); readShare(intent); if (!pendingShare.isEmpty() && !base.isEmpty()) showImport(); }
    private void readShare(Intent intent) {
        if (Intent.ACTION_SEND.equals(intent.getAction())) {
            CharSequence text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
            if (text == null && intent.getClipData() != null && intent.getClipData().getItemCount() > 0) text = intent.getClipData().getItemAt(0).getText();
            pendingShare = text == null ? "" : text.toString();
            pendingTitle = intent.getStringExtra(Intent.EXTRA_SUBJECT); if (pendingTitle == null) pendingTitle = "";
            intent.setAction(Intent.ACTION_MAIN); intent.removeExtra(Intent.EXTRA_TEXT);
        }
    }
    @Override protected void onResume() { super.onResume(); handler.post(tick); }
    @Override protected void onPause() { handler.removeCallbacks(tick); super.onPause(); }
    @Override protected void onDestroy() { if (playerDialog != null) playerDialog.dismiss(); io.shutdown(); super.onDestroy(); }
    private int dp(int n) { return (int)(getResources().getDisplayMetrics().density * n + .5f); }
    private LinearLayout column() { LinearLayout l = new LinearLayout(this); l.setOrientation(LinearLayout.VERTICAL); return l; }
    private LinearLayout row() { LinearLayout l = new LinearLayout(this); l.setGravity(Gravity.CENTER_VERTICAL); return l; }
    private TextView text(String value, int size, int color) { TextView v = new TextView(this); v.setText(value); v.setTypeface(bodyFont); v.setTextSize(size); v.setTextColor(color); v.setPadding(0, dp(4), 0, dp(4)); return v; }
    private void bold(TextView v) { v.setTypeface(headingFont); }
    private ImageButton icon(String glyph, String label, Runnable action) {
        ImageButton b = new ImageButton(this); b.setImageDrawable(new Glyph(glyph, RED)); b.setContentDescription(label); b.setTooltipText(label);
        b.setBackground(background(Color.TRANSPARENT)); b.setPadding(dp(12), dp(12), dp(12), dp(12));
        b.setLayoutParams(new LinearLayout.LayoutParams(dp(48), dp(48))); b.setOnClickListener(v -> action.run()); return b;
    }
    private void togglePlayback() { PlaybackService p = PlaybackService.current; if (p != null) { if (p.playing()) p.pause(); else p.play(); updatePlayer(); } }
    private GradientDrawable background(int color) { GradientDrawable d = new GradientDrawable(); d.setColor(color); d.setCornerRadius(dp(14)); return d; }
    private Button button(String label, Runnable action) {
        Button b = new Button(this); b.setText(label); b.setTypeface(bodyFont); b.setBackground(background(Color.TRANSPARENT)); b.setAllCaps(false); b.setTextSize(14); b.setTextColor(RED); b.setMinHeight(dp(48)); b.setMinimumWidth(0); b.setOnClickListener(v -> action.run()); return b;
    }
    private EditText input(String hint) { EditText v = new EditText(this); v.setTypeface(bodyFont); v.setBackgroundTintList(android.content.res.ColorStateList.valueOf(RED)); v.setTextSize(16); v.setTextColor(INK); v.setHint(hint); v.setHintTextColor(MUTED); v.setSingleLine(true); return v; }
    private void build() {
        root = column(); root.setBackgroundColor(BG); root.setPadding(dp(20), 0, dp(20), 0);
        root.setOnApplyWindowInsetsListener((v, insets) -> { v.setPadding(dp(20), insets.getSystemWindowInsetTop(), dp(20), insets.getSystemWindowInsetBottom()); return insets; });
        setContentView(root);
        LinearLayout header = row(); TextView brand = text("redread", 26, INK); bold(brand);
        brand.setSingleLine(true); brand.setAutoSizeTextTypeUniformWithConfiguration(18, 26, 1, android.util.TypedValue.COMPLEX_UNIT_SP);
        header.addView(brand, new LinearLayout.LayoutParams(0, dp(66), 1));
        search = input("Search articles"); search.setContentDescription("Search articles"); search.setVisibility(View.GONE);
        header.addView(search, new LinearLayout.LayoutParams(0, dp(66), 1));
        ImageButton searchButton = icon("search", "Search articles", () -> {});
        ImageButton refreshButton = icon("refresh", "Refresh", this::refresh);
        ImageButton addButton = icon("plus", "Add article", () -> { pendingShare = ""; pendingTitle = ""; showImport(); });
        ImageButton settingsButton = icon("settings", "Server", this::serverDialog);
        header.addView(searchButton); header.addView(refreshButton); header.addView(addButton); header.addView(settingsButton); root.addView(header);
        searchButton.setOnClickListener(v -> {
            boolean open = search.getVisibility() != View.VISIBLE;
            search.setVisibility(open ? View.VISIBLE : View.GONE);
            for (View control : new View[]{brand, refreshButton, addButton, settingsButton}) control.setVisibility(open ? View.GONE : View.VISIBLE);
            searchButton.setImageDrawable(new Glyph(open ? "close" : "search", RED));
            searchButton.setContentDescription(open ? "Close search" : "Search articles"); searchButton.setTooltipText(searchButton.getContentDescription());
            android.view.inputmethod.InputMethodManager keyboard = (android.view.inputmethod.InputMethodManager) getSystemService(INPUT_METHOD_SERVICE);
            if (open) { search.requestFocus(); keyboard.showSoftInput(search, android.view.inputmethod.InputMethodManager.SHOW_IMPLICIT); }
            else { keyboard.hideSoftInputFromWindow(search.getWindowToken(), 0); search.setText(""); search.clearFocus(); }
        });
        search.addTextChangedListener(new TextWatcher() { public void beforeTextChanged(CharSequence s,int st,int c,int a) {} public void onTextChanged(CharSequence s,int st,int b,int c) { renderArticles(); } public void afterTextChanged(Editable e) {} });
        status = text("Connecting to your Redread…", 13, MUTED); root.addView(status);
        ScrollView scroll = new ScrollView(this); list = column(); scroll.addView(list); root.addView(scroll, new LinearLayout.LayoutParams(-1, 0, 1));
        playerBox = column(); playerBox.setPadding(dp(12), dp(8), dp(12), dp(8)); playerBox.setBackground(background(Color.WHITE)); playerBox.setVisibility(View.GONE);
        LinearLayout mini = row(); playerTitle = text("", 14, INK); bold(playerTitle); playerTitle.setMaxLines(2); playerTitle.setEllipsize(TextUtils.TruncateAt.END);
        mini.addView(playerTitle, new LinearLayout.LayoutParams(0, dp(56), 1)); playerTitle.setOnClickListener(v -> showPlayer()); playerTitle.setContentDescription("Open player");
        toggle = icon("play", "Play", this::togglePlayback); mini.addView(toggle); mini.addView(icon("down", "Open player", this::showPlayer)); playerBox.addView(mini);
        miniProgress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal); miniProgress.setProgressTintList(android.content.res.ColorStateList.valueOf(RED)); playerBox.addView(miniProgress, new LinearLayout.LayoutParams(-1, dp(2)));
        root.addView(playerBox);
    }
    private void showPlayer() {
        PlaybackService p = PlaybackService.current; if (p == null) return;
        if (playerDialog != null && playerDialog.isShowing()) return;
        playerDialog = new Dialog(this); LinearLayout panel = column(); panel.setPadding(dp(24), dp(20), dp(24), dp(24)); panel.setBackgroundColor(BG);
        LinearLayout heading = row(); TextView caption = text("Now playing", 14, MUTED); heading.addView(caption, new LinearLayout.LayoutParams(0, -2, 1)); heading.addView(icon("down", "Close player", () -> playerDialog.dismiss())); panel.addView(heading);
        Artwork art = new Artwork(this, p.id, "redread", true); int width = getResources().getDisplayMetrics().widthPixels - dp(96); int size = Math.min(dp(280), width);
        LinearLayout.LayoutParams artLayout = new LinearLayout.LayoutParams(size, size); artLayout.gravity = Gravity.CENTER_HORIZONTAL; artLayout.setMargins(0, dp(20), 0, dp(20)); panel.addView(art, artLayout);
        fullTitle = text(p.title, 22, INK); bold(fullTitle); panel.addView(fullTitle);
        seek = new SeekBar(this); seek.setProgressTintList(android.content.res.ColorStateList.valueOf(RED)); seek.setThumbTintList(android.content.res.ColorStateList.valueOf(RED)); seek.setContentDescription("Playback position"); panel.addView(seek);
        seek.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
            public void onProgressChanged(SeekBar bar,int value,boolean user) {}
            public void onStartTrackingTouch(SeekBar bar) { seeking = true; }
            public void onStopTrackingTouch(SeekBar bar) { PlaybackService p = PlaybackService.current; if (p != null) p.seek(bar.getProgress()); seeking = false; }
        });
        time = text("", 12, MUTED); panel.addView(time);
        LinearLayout controls = row(); controls.addView(button("−15 s", () -> { if (PlaybackService.current != null) PlaybackService.current.seek(PlaybackService.current.position()-15000); }), new LinearLayout.LayoutParams(0, dp(48), 1));
        fullToggle = icon("play", "Play", this::togglePlayback); controls.addView(fullToggle, new LinearLayout.LayoutParams(0, dp(48), 1));
        controls.addView(button("+30 s", () -> { if (PlaybackService.current != null) PlaybackService.current.seek(PlaybackService.current.position()+30000); }), new LinearLayout.LayoutParams(0, dp(48), 1));
        speedButton = button("1×", () -> new AlertDialog.Builder(this).setTitle("Speed").setItems(new String[]{"0.75×", "1×", "1.25×", "1.5×", "1.75×", "2×"}, (d, which) -> { if (PlaybackService.current != null) PlaybackService.current.rate(new float[]{.75f,1f,1.25f,1.5f,1.75f,2f}[which]); }).show()); controls.addView(speedButton, new LinearLayout.LayoutParams(0, dp(48), 1)); panel.addView(controls);
        ScrollView scroll = new ScrollView(this); scroll.addView(panel); playerDialog.setContentView(scroll); playerDialog.show();
        playerDialog.getWindow().setLayout(-1, -2); playerDialog.getWindow().setGravity(Gravity.BOTTOM); updatePlayer();
    }
    private void serverDialog() {
        LinearLayout content = column(); content.setPadding(dp(24), dp(8), dp(24), 0);
        content.addView(text("The address of your Redread web app. Your phone must be connected to Tailscale when you are away from home.", 15, MUTED));
        EditText address = input("https://your-redread-server"); address.setInputType(android.text.InputType.TYPE_CLASS_TEXT | android.text.InputType.TYPE_TEXT_VARIATION_URI); address.setText(base); content.addView(address);
        TextView feedback = text("", 13, RED); content.addView(feedback);
        AlertDialog dialog = new AlertDialog.Builder(this).setTitle("Connect to Redread").setView(content).setNegativeButton("Cancel", null).setPositiveButton("Connect", null).create();
        dialog.setOnShowListener(d -> dialog.getButton(-1).setOnClickListener(v -> {
            final String url; try { url = ShareInput.server(address.getText().toString()); } catch (Exception e) { feedback.setText("Please enter a valid HTTP(S) server address without a path."); return; }
            dialog.getButton(-1).setEnabled(false); feedback.setText("Checking connection…");
            io.execute(() -> { try {
                JSONObject health = new JSONObject(Api.request(url, "/api/health", null)); if (!"redread".equals(health.optString("app"))) throw new Exception("No Redread server is responding at this address.");
                runOnUiThread(() -> { if (isDestroyed()) return; if (!base.equals(url)) { stopService(new Intent(this, PlaybackService.class)); articles = new JSONArray(); } base = url; getSharedPreferences("redread", 0).edit().putString("server", base).apply(); dialog.dismiss(); refresh(); if (!pendingShare.isEmpty()) showImport(); });
            } catch (Exception e) { runOnUiThread(() -> { dialog.getButton(-1).setEnabled(true); feedback.setText(connectionError(e)); }); } });
        })); dialog.show();
    }
    private String connectionError(Exception e) { return "Connection failed. Check the server and Tailscale.\n" + (e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage()); }
    private void refresh() {
        if (loading || base.isEmpty()) return; loading = true; lastRefresh = System.currentTimeMillis(); final String server = base;
        status.setText("Loading library…");
        io.execute(() -> { try { JSONArray result = new JSONArray(Api.request(server, "/api/articles", null)); runOnUiThread(() -> { loading = false; if (isDestroyed() || !server.equals(base)) return; articles = result; status.setText(articles.length() + " articles · connected to Redread"); renderArticles(); }); }
        catch (Exception e) { runOnUiThread(() -> { loading = false; if (!isDestroyed() && server.equals(base)) status.setText(connectionError(e)); }); } });
    }
    private void renderArticles() {
        if (list == null) return; list.removeAllViews();
        String query = search.getText().toString().toLowerCase(java.util.Locale.ROOT); int count = 0;
        java.util.ArrayList<JSONObject> ordered = new java.util.ArrayList<>();
        for (int i = 0; i < articles.length(); i++) { JSONObject article = articles.optJSONObject(i); if (article != null) ordered.add(article); }
        // Stable sort keeps the server's order within unfinished and ready articles.
        ordered.sort((a, b) -> Boolean.compare("ready".equals(a.optString("status")), "ready".equals(b.optString("status"))));
        for (JSONObject a : ordered) {
            String state = a.optString("status"); boolean ready = state.equals("ready");
            if (!(a.optString("title") + " " + a.optString("source")).toLowerCase(java.util.Locale.ROOT).contains(query)) continue;
            count++;
            LinearLayout card = row(); card.setPadding(0, dp(14), 0, dp(14));
            Artwork art = new Artwork(this, a.optString("id"), a.optString("source"), false); card.addView(art, new LinearLayout.LayoutParams(dp(58), dp(58)));
            LinearLayout copy = column(); copy.setPadding(dp(14), 0, dp(8), 0); card.addView(copy, new LinearLayout.LayoutParams(0, -2, 1));
            TextView meta = text(a.optString("source") + "  ·  " + (ready ? clock((int)(a.optDouble("duration") * 1000)) : label(state)), 11, MUTED);
            TextView name = text(a.optString("title"), 15, INK); bold(name); name.setMaxLines(3); name.setEllipsize(TextUtils.TruncateAt.END); copy.addView(name); copy.addView(meta);
            if (!ready) { String detail = state.equals("failed") ? a.optString("error") : a.optString("progress"); if (!detail.isEmpty()) copy.addView(text(detail, 12, MUTED)); }
            if (ready) card.addView(icon("play", "Listen to " + a.optString("title"), () -> startForegroundService(new Intent(this, PlaybackService.class).setAction("load").putExtra("id", a.optString("id")).putExtra("title", a.optString("title")).putExtra("base", base))));
            else if (state.equals("draft") || state.equals("failed")) card.addView(icon("refresh", state.equals("failed") ? "Try again" : "Create listening version", () -> process(a)));
            list.addView(card, new LinearLayout.LayoutParams(-1, -2));
            View divider = new View(this); divider.setBackgroundColor(0xffe8e9ee); list.addView(divider, new LinearLayout.LayoutParams(-1, dp(1)));
        }
        if (count == 0) list.addView(text(query.isEmpty() ? "Your library is still empty.\nUse \"Share → redread\" to add your first article." : "No matching articles found.", 16, MUTED));
    }
    private String label(String state) { switch(state) { case "draft": return "Draft"; case "queued": return "Queued"; case "preparing": return "Preparing text"; case "speaking": return "Creating audio"; case "failed": return "Failed"; default: return state; } }
    private void process(JSONObject article) {
        final String server = base;
        io.execute(() -> { try {
            Api.request(server, "/api/articles/" + article.optString("id") + "/process", new JSONObject());
            runOnUiThread(() -> { if (!isDestroyed()) refresh(); });
        } catch (Exception e) {
            runOnUiThread(() -> { if (!isDestroyed()) new AlertDialog.Builder(this).setMessage(e.getMessage()).setPositiveButton("OK", null).show(); });
        } });
    }

    private void showImport() {
        if (base.isEmpty()) { serverDialog(); return; }
        if (importDialog != null && importDialog.isShowing()) importDialog.dismiss();
        LinearLayout content = column(); content.setPadding(dp(24), 0, dp(24), 0);
        EditText title = input("Title (optional)"); title.setText(pendingTitle); content.addView(title);
        EditText value = input("Link or article text"); value.setSingleLine(false); value.setMinLines(3); value.setMaxLines(7); value.setText(pendingShare); content.addView(value);
        TextView importLabel = text("Article", 12, MUTED); content.addView(importLabel, 0);
        CheckBox useLink = new CheckBox(this); useLink.setTypeface(bodyFont); useLink.setTextColor(INK); useLink.setText("Import included link as article"); useLink.setChecked(true); content.addView(useLink);
        CheckBox process = new CheckBox(this); process.setTypeface(bodyFont); process.setTextColor(INK); process.setText("Create listening version immediately"); process.setChecked(true); content.addView(process);
        Spinner voices = new Spinner(this); content.addView(voices); final JSONArray[] options = {new JSONArray()};
        voices.setAdapter(new ArrayAdapter<String>(this, android.R.layout.simple_spinner_dropdown_item, new String[]{"Server default voice"}));
        TextView feedback = text("", 13, RED); content.addView(feedback);
        final String server = base;
        ScrollView importScroll = new ScrollView(this); importScroll.addView(content);
        AlertDialog dialog = new AlertDialog.Builder(this).setTitle("Add article").setView(importScroll).setNegativeButton("Cancel", (d,w) -> { pendingShare = ""; pendingTitle = ""; }).setPositiveButton("Add", null).create(); importDialog = dialog;
        value.addTextChangedListener(new TextWatcher() { public void beforeTextChanged(CharSequence s,int st,int c,int a) {} public void onTextChanged(CharSequence s,int st,int b,int c) { pendingShare = s.toString(); } public void afterTextChanged(Editable e) {} });
        title.addTextChangedListener(new TextWatcher() { public void beforeTextChanged(CharSequence s,int st,int c,int a) {} public void onTextChanged(CharSequence s,int st,int b,int c) { pendingTitle = s.toString(); } public void afterTextChanged(Editable e) {} });
        io.execute(() -> { try { JSONArray result = new JSONArray(Api.request(server, "/api/voices", null)); runOnUiThread(() -> { if (!dialog.isShowing()) return; options[0] = result; String[] names = new String[result.length()+1]; names[0] = "Server default voice"; for(int i=0;i<result.length();i++) names[i+1] = result.optJSONObject(i).optString("name"); voices.setAdapter(new ArrayAdapter<String>(this, android.R.layout.simple_spinner_dropdown_item, names)); }); } catch(Exception ignored) {} });
        dialog.setOnShowListener(d -> dialog.getButton(-1).setOnClickListener(v -> {
            String raw = value.getText().toString().trim(); if (raw.isEmpty()) { feedback.setText("Please paste a link or text."); return; }
            JSONObject body = new JSONObject(); try {
                String url = useLink.isChecked() ? ShareInput.url(raw) : ""; if (!url.isEmpty()) body.put("url", url); else body.put("text", raw);
                if (!title.getText().toString().trim().isEmpty()) body.put("title", title.getText().toString().trim());
                body.put("process", process.isChecked()); int voice = voices.getSelectedItemPosition(); if (voice > 0) body.put("voice", options[0].getJSONObject(voice-1).getString("voice"));
            } catch (Exception e) { feedback.setText(e.getMessage()); return; }
            dialog.getButton(-1).setEnabled(false); dialog.getButton(-2).setEnabled(false); dialog.setCancelable(false); feedback.setText("Sending article…");
            io.execute(() -> { try { JSONObject result = new JSONObject(Api.request(server, "/api/articles", body)); runOnUiThread(() -> { if (isDestroyed()) return; pendingShare = ""; pendingTitle = ""; dialog.dismiss(); refresh(); Toast.makeText(this, result.optString("status").equals("draft") ? "Saved as a draft" : "Saved. The listening version is being created.", Toast.LENGTH_LONG).show(); }); }
            catch (Exception e) { runOnUiThread(() -> { if (isDestroyed()) return; dialog.getButton(-1).setEnabled(true); dialog.getButton(-2).setEnabled(true); dialog.setCancelable(true); feedback.setText(e.getMessage() + "\nIf the connection drops, check your library before sending again."); }); } });
        })); dialog.show();
    }
    private static String clock(int ms) { int s = ms/1000; return s >= 3600 ? String.format(java.util.Locale.ROOT, "%d:%02d:%02d", s/3600, s/60%60, s%60) : String.format(java.util.Locale.ROOT, "%d:%02d", s/60, s%60); }
    private void updatePlayer() {
        PlaybackService p = PlaybackService.current; playerBox.setVisibility(p == null ? View.GONE : View.VISIBLE); if (p == null) return;
        playerTitle.setText(p.error.isEmpty() ? p.title : p.error); toggle.setImageDrawable(new Glyph(p.playing() ? "pause" : "play", RED)); toggle.setContentDescription(p.playing() ? "Pause" : "Play");
        miniProgress.setMax(p.duration()); miniProgress.setProgress(p.position());
        if (playerDialog != null && playerDialog.isShowing()) {
            fullTitle.setText(p.title); fullToggle.setImageDrawable(new Glyph(p.playing() ? "pause" : "play", RED)); fullToggle.setContentDescription(p.playing() ? "Pause" : "Play"); speedButton.setText(p.speed + "×");
            if (!seeking) { seek.setMax(p.duration()); seek.setProgress(p.position()); }
            time.setText(p.error.isEmpty() ? clock(p.position()) + " / " + clock(p.duration()) : p.error);
        }
    }
}
