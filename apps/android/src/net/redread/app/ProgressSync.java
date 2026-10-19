package net.redread.app;

import android.content.*;
import android.database.Cursor;
import android.database.sqlite.*;
import android.os.*;
import android.util.Log;
import org.json.*;
import java.io.IOException;
import java.net.URLEncoder;
import java.util.*;
import java.util.concurrent.*;

/** All database and sync work is serialized here, never on the main thread. */
final class ProgressSync {
    static final class Key {
        final String origin, serverId, articleId, audioId;
        Key(String origin, String serverId, String articleId, String audioId) {
            this.origin = origin; this.serverId = serverId; this.articleId = articleId; this.audioId = audioId;
        }
        boolean same(Key other) {
            return other != null && serverId.equals(other.serverId)
                && articleId.equals(other.articleId) && audioId.equals(other.audioId);
        }
    }
    interface Callback { void accept(Snapshot snapshot); }
    static final class Snapshot {
        final Key key;
        final int position;
        final boolean completed, conflict;
        final String status;
        Snapshot(Row row) {
            key = row.key; position = (int) Math.min(Integer.MAX_VALUE, row.position);
            completed = row.completed; conflict = row.conflict && !row.blocked;
            status = row.blocked ? row.problem
                : row.conflict ? "Progress conflict · local position kept"
                : row.dirty() || !row.initialized || !row.mutation.isEmpty() || !row.problem.isEmpty() ? "Saved locally · sync pending"
                : "Progress synced";
        }
    }
    private static final class Row {
        Key key;
        long position, sequence, acknowledged, revision, flightPosition, flightRevision, flightSequence, nextAt;
        boolean completed, initialized, conflict, blocked, flightCompleted;
        int retries;
        String mutation = "", problem = "";
        Row(Key key) { this.key = key; }
        boolean dirty() { return sequence > acknowledged; }
    }
    private static final class Remote {
        long position, revision;
        boolean completed;
        String mutation;
        Remote(JSONObject json, Key key) throws Exception {
            if (!key.articleId.equals(json.getString("articleId")) || !key.audioId.equals(json.getString("audioId")))
                throw new ProtocolError("Server returned another listening version.");
            position = integer(json, "positionMs"); revision = integer(json, "revision");
            if (!(json.get("completed") instanceof Boolean)) throw new ProtocolError("Invalid playback response.");
            completed = json.getBoolean("completed"); mutation = json.getString("mutationId");
            json.getString("updatedAt");
        }
        private static long integer(JSONObject json, String field) throws Exception {
            Object value = json.get(field);
            if (!(value instanceof Number) || value instanceof Double || value instanceof Float || ((Number) value).longValue() < 0)
                throw new ProtocolError("Invalid playback response.");
            return ((Number) value).longValue();
        }
    }
    private static final class ProtocolError extends IOException {
        ProtocolError(String message) { super(message); }
    }
    private static ProgressSync instance;
    static synchronized ProgressSync get(Context context) {
        if (instance == null) instance = new ProgressSync(context.getApplicationContext());
        return instance;
    }
    static boolean uuid(String value) {
        try { return value != null && UUID.fromString(value).toString().equalsIgnoreCase(value); }
        catch (IllegalArgumentException e) { return false; }
    }
    private final ScheduledExecutorService io = Executors.newSingleThreadScheduledExecutor();
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Store store;
    private ScheduledFuture<?> retry;
    private volatile Callback listener;
    private ProgressSync(Context context) {
        store = new Store(context);
        io.execute(() -> {
            try {
                store.getWritableDatabase().execSQL("UPDATE progress SET next_at=0 WHERE blocked=0 AND conflict=0 AND (sequence>acknowledged OR mutation!='')");
                drain();
            } catch (Exception e) { Log.e("redread", "Cannot open playback progress", e); }
        });
    }
    void listen(Callback callback) { listener = callback; }
    private void deliver(Row row, Callback callback) {
        Snapshot snapshot = new Snapshot(row);
        Callback observer = listener;
        main.post(() -> { if (observer != null) observer.accept(snapshot); if (callback != null) callback.accept(snapshot); });
    }
    private void storageFailure(Key key, Callback callback, Exception e) {
        Log.e("redread", "Cannot save playback progress", e);
        Row row = new Row(key); row.blocked = true; row.problem = "Local progress storage unavailable";
        deliver(row, callback);
    }
    /** Resolve an uncertain receipt BEFORE looking for remote changes. */
    void open(Key key, Callback callback) {
        io.execute(() -> {
            try {
                Row row = store.load(key);
                try {
                    if (!row.blocked) {
                        if (!row.mutation.isEmpty()) send(row);
                        merge(row, remote(row));
                        if (row.dirty() && !row.conflict) row.nextAt = System.currentTimeMillis();
                        store.save(row);
                    }
                } catch (Exception e) { failed(row, e); }
                deliver(row, callback); schedule();
            } catch (Exception e) { storageFailure(key, callback, e); }
        });
    }
    void snapshot(Key key, int position, boolean completed, boolean flush) {
        io.execute(() -> {
            try {
                Row row = store.load(key);
                boolean changed = row.position != Math.max(0, position) || row.completed != completed;
                if (changed) {
                    boolean wasClean = !row.dirty() && row.mutation.isEmpty();
                    row.position = Math.max(0, position); row.completed = completed; row.sequence++;
                    if (wasClean) row.nextAt = System.currentTimeMillis() + 10000;
                }
                if (flush && row.dirty() && row.retries == 0) row.nextAt = System.currentTimeMillis();
                if (changed || (flush && row.dirty())) store.save(row);
                deliver(row, null); schedule();
            } catch (Exception e) { storageFailure(key, null, e); }
        });
    }
    void resolve(Key key, boolean keepLocal, Callback callback) {
        io.execute(() -> {
            try {
                Row row = store.load(key);
                try {
                    if (row.blocked) { deliver(row, callback); return; }
                    if (!row.mutation.isEmpty()) send(row);
                    Remote latest = remote(row);
                    if (keepLocal) {
                        // This is the ONLY dirty rebase, explicitly requested by the listener.
                        row.revision = latest.revision; row.initialized = true; row.conflict = false;
                        row.sequence++; row.nextAt = System.currentTimeMillis();
                        store.save(row); flush(row);
                    } else {
                        row.position = latest.position; row.completed = latest.completed;
                        row.revision = latest.revision; row.initialized = true; row.conflict = false;
                        row.sequence++; row.acknowledged = row.sequence; row.retries = 0; row.problem = "";
                        store.save(row);
                    }
                } catch (Exception e) { failed(row, e); }
                deliver(row, callback); schedule();
            } catch (Exception e) { storageFailure(key, callback, e); }
        });
    }
    private String path(Key key) throws Exception {
        return "/api/articles/" + URLEncoder.encode(key.articleId, "UTF-8") + "/playback?version=" + URLEncoder.encode(key.audioId, "UTF-8");
    }
    private String request(Key key, String path, String method, JSONObject body) throws Exception {
        // A short connect + read budget; unavailable sync must not prevent listening.
        return Api.request(key.origin, path, method, body, Collections.singletonMap("X-Redread-Server", key.serverId), 1500, 1500);
    }
    private Remote remote(Row row) throws Exception {
        JSONObject health = new JSONObject(request(row.key, "/api/health", "GET", null));
        String identity = health.optString("serverId");
        if (!"redread".equals(health.optString("app")) || !uuid(identity)) throw new ProtocolError("Upgrade the Redread server to sync progress.");
        if (!row.key.serverId.equals(identity)) throw new Api.HttpError(412, "Server identity changed", new JSONObject());
        return new Remote(new JSONObject(request(row.key, path(row.key), "GET", null)), row.key);
    }
    private void merge(Row row, Remote remote) {
        if (!row.dirty()) {
            row.position = remote.position; row.completed = remote.completed; row.revision = remote.revision;
        } else if (row.revision != remote.revision) row.conflict = true;
        row.initialized = true; row.retries = 0; row.problem = "";
    }
    private void flush(Row row) throws Exception {
        if (row.blocked || row.conflict) return;
        if (!row.mutation.isEmpty()) send(row);
        if (!row.initialized) { merge(row, remote(row)); store.save(row); }
        if (!row.dirty() || row.conflict) return;
        row.mutation = UUID.randomUUID().toString(); row.flightPosition = row.position;
        row.flightCompleted = row.completed; row.flightRevision = row.revision; row.flightSequence = row.sequence;
        store.save(row); // Durable immutable payload before the first byte leaves the device.
        send(row);
    }
    private void send(Row row) throws Exception {
        JSONObject body = new JSONObject().put("positionMs", row.flightPosition).put("completed", row.flightCompleted)
            .put("baseRevision", row.flightRevision).put("mutationId", row.mutation);
        Remote receipt = new Remote(new JSONObject(request(row.key, path(row.key), "PUT", body)), row.key);
        if (!row.mutation.equals(receipt.mutation) || receipt.revision != row.flightRevision + 1
            || Math.abs(receipt.position - row.flightPosition) > 2000 || receipt.completed != row.flightCompleted)
            throw new ProtocolError("Invalid progress receipt · local position kept");
        // The server may normalize the small duration difference between ffprobe
        // and MediaPlayer, including the exact end of a completed episode.
        if (row.sequence == row.flightSequence) { row.position = receipt.position; row.completed = receipt.completed; }
        // Never replace a newer local snapshot with the acknowledged payload.
        row.revision = receipt.revision; row.acknowledged = row.flightSequence; row.initialized = true;
        row.mutation = ""; row.retries = 0; row.problem = ""; row.nextAt = System.currentTimeMillis();
        store.save(row);
    }
    private void failed(Row row, Exception error) {
        if (error instanceof Api.HttpError) {
            Api.HttpError http = (Api.HttpError) error;
            if (http.code == 409) {
                // A definitive rejection is not an uncertain write. Keep the local snapshot and base.
                row.mutation = ""; row.conflict = true;
                try { new Remote(http.body.getJSONObject("current"), row.key); }
                catch (Exception ignored) { /* Still require explicit conflict resolution. */ }
            } else if (http.code == 404 || http.code == 412 || (http.code >= 400 && http.code < 500 && http.code != 408 && http.code != 429)) {
                row.blocked = true;
                row.problem = http.code == 404 ? "Listening version unavailable · local position kept"
                    : http.code == 412 ? "Server identity changed · local position kept"
                    : "Server rejected sync · local position kept";
            }
        } else if (error instanceof ProtocolError || error instanceof JSONException) {
            row.blocked = true; row.problem = "Upgrade/check Redread server · local position kept";
        }
        if (!row.blocked && !row.conflict) {
            row.problem = "pending";
            row.retries = Math.min(6, row.retries + 1);
            row.nextAt = System.currentTimeMillis() + Math.min(60000, 2000L << (row.retries - 1));
        }
        store.save(row);
    }
    private void drain() {
        try {
            for (Key key : store.due()) {
                Row row = store.load(key);
                try { flush(row); } catch (Exception e) { failed(row, e); }
                deliver(row, null);
            }
            schedule();
        } catch (Exception e) { Log.e("redread", "Cannot flush playback progress", e); }
    }
    private void schedule() {
        if (retry != null) { retry.cancel(false); retry = null; }
        long next = store.next();
        if (next >= 0) retry = io.schedule(this::drain, Math.max(100, next - System.currentTimeMillis()), TimeUnit.MILLISECONDS);
    }
    private static final class Store extends SQLiteOpenHelper {
        Store(Context context) { super(context, "playback-progress.db", null, 1); }
        @Override public void onCreate(SQLiteDatabase db) {
            db.execSQL("CREATE TABLE progress (server_id TEXT NOT NULL, article_id TEXT NOT NULL, audio_id TEXT NOT NULL, origin TEXT NOT NULL, "
                + "position INTEGER NOT NULL, completed INTEGER NOT NULL, sequence INTEGER NOT NULL, acknowledged INTEGER NOT NULL, revision INTEGER NOT NULL, "
                + "initialized INTEGER NOT NULL, conflict INTEGER NOT NULL, blocked INTEGER NOT NULL, mutation TEXT NOT NULL, flight_position INTEGER NOT NULL, "
                + "flight_completed INTEGER NOT NULL, flight_revision INTEGER NOT NULL, flight_sequence INTEGER NOT NULL, next_at INTEGER NOT NULL, retries INTEGER NOT NULL, problem TEXT NOT NULL, "
                + "PRIMARY KEY(server_id,article_id,audio_id))");
        }
        @Override public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) { throw new IllegalStateException("Unknown progress database version"); }
        Row load(Key key) {
            try (Cursor c = getReadableDatabase().query("progress", null, "server_id=? AND article_id=? AND audio_id=?", new String[]{key.serverId, key.articleId, key.audioId}, null, null, null)) {
                if (!c.moveToFirst()) return new Row(key);
                // An explicitly reconnected URL can change while the server ID
                // stays the same. Background retries supply the saved origin.
                Row r = new Row(key);
                r.position = number(c,"position"); r.completed = number(c,"completed") != 0; r.sequence = number(c,"sequence"); r.acknowledged = number(c,"acknowledged"); r.revision = number(c,"revision");
                r.initialized = number(c,"initialized") != 0; r.conflict = number(c,"conflict") != 0; r.blocked = number(c,"blocked") != 0;
                r.mutation = c.getString(c.getColumnIndexOrThrow("mutation")); r.flightPosition = number(c,"flight_position"); r.flightCompleted = number(c,"flight_completed") != 0;
                r.flightRevision = number(c,"flight_revision"); r.flightSequence = number(c,"flight_sequence"); r.nextAt = number(c,"next_at"); r.retries = (int) number(c,"retries"); r.problem = c.getString(c.getColumnIndexOrThrow("problem"));
                return r;
            }
        }
        private long number(Cursor c, String field) { return c.getLong(c.getColumnIndexOrThrow(field)); }
        void save(Row r) {
            ContentValues v = new ContentValues();
            v.put("server_id",r.key.serverId); v.put("article_id",r.key.articleId); v.put("audio_id",r.key.audioId); v.put("origin",r.key.origin);
            v.put("position",r.position); v.put("completed",r.completed ? 1 : 0); v.put("sequence",r.sequence); v.put("acknowledged",r.acknowledged); v.put("revision",r.revision);
            v.put("initialized",r.initialized ? 1 : 0); v.put("conflict",r.conflict ? 1 : 0); v.put("blocked",r.blocked ? 1 : 0); v.put("mutation",r.mutation);
            v.put("flight_position",r.flightPosition); v.put("flight_completed",r.flightCompleted ? 1 : 0); v.put("flight_revision",r.flightRevision); v.put("flight_sequence",r.flightSequence);
            v.put("next_at",r.nextAt); v.put("retries",r.retries); v.put("problem",r.problem);
            if (getWritableDatabase().insertWithOnConflict("progress", null, v, SQLiteDatabase.CONFLICT_REPLACE) == -1) throw new SQLiteException("Cannot save progress");
        }
        private static final String PENDING = "blocked=0 AND conflict=0 AND (sequence>acknowledged OR mutation!='')";
        List<Key> due() {
            List<Key> keys = new ArrayList<>();
            try (Cursor c = getReadableDatabase().query("progress", new String[]{"origin","server_id","article_id","audio_id"}, PENDING + " AND next_at<=?", new String[]{Long.toString(System.currentTimeMillis())}, null, null, "next_at")) {
                while (c.moveToNext()) keys.add(new Key(c.getString(0),c.getString(1),c.getString(2),c.getString(3)));
            }
            return keys;
        }
        long next() {
            try (Cursor c = getReadableDatabase().rawQuery("SELECT MIN(next_at) FROM progress WHERE " + PENDING, null)) {
                return c.moveToFirst() && !c.isNull(0) ? c.getLong(0) : -1;
            }
        }
    }
}
