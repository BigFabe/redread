package net.redread.app;

import android.app.*;
import android.content.*;
import android.media.*;
import android.media.session.*;
import android.os.*;

public final class PlaybackService extends Service {
    static PlaybackService current;
    private MediaPlayer player;
    private MediaSession session;
    private AudioManager audio;
    private AudioFocusRequest focus;
    private ProgressSync sync;
    private ProgressSync.Key key;
    private boolean prepared, resumeOnGain, restoring, seekPending, completed, wantPlay, conflict;
    private boolean seekIsRestore, replayAfterRestore, checkpointReady;
    private int generation, operation, seekTarget, heartbeat;
    private Integer queuedSeek;
    private Intent pendingLoad;
    private boolean pendingStop;
    private final Handler handler = new Handler(Looper.getMainLooper());
    String title = "", id = "", base = "", audioId = "", serverId = "", error = "", syncStatus = "Checking progress…";
    float speed = 1f;
    private static final String CHANNEL = "playback";
    private static final int RESUME_REWIND_MS = 10000;
    private final Runnable persist = new Runnable() {
        public void run() {
            if (!playing()) return;
            checkpoint(++heartbeat % 2 == 0);
            handler.postDelayed(this, 5000);
        }
    };
    private final BroadcastReceiver noisy = new BroadcastReceiver() {
        public void onReceive(Context context, Intent intent) { pause(); }
    };

    @Override public void onCreate() {
        super.onCreate(); current = this; sync = ProgressSync.get(this);
        audio = (AudioManager) getSystemService(AUDIO_SERVICE);
        AudioAttributes attributes = new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build();
        focus = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN).setAudioAttributes(attributes).setOnAudioFocusChangeListener(change -> {
            if (change == AudioManager.AUDIOFOCUS_GAIN) { boolean resume = resumeOnGain; resumeOnGain = false; if (resume) play(); }
            else if (change == AudioManager.AUDIOFOCUS_LOSS) pause();
            else {
                boolean resume = playing() || wantPlay;
                pausePlayback(false); resumeOnGain = resume;
            }
        }).build();
        session = new MediaSession(this, "redread");
        session.setSessionActivity(PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));
        session.setCallback(new MediaSession.Callback() {
            @Override public void onPlay() { play(); }
            @Override public void onPause() { pause(); }
            @Override public void onStop() { stopPlayback(); }
            @Override public void onSeekTo(long position) { seek((int) Math.min(Integer.MAX_VALUE, Math.max(0, position))); }
            @Override public void onRewind() { seek(position() - 15000); }
            @Override public void onFastForward() { seek(position() + 30000); }
            @Override public void onSetPlaybackSpeed(float value) { rate(value); }
        });
        session.setActive(true);
        ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).createNotificationChannel(new NotificationChannel(CHANNEL, "Listen to episodes", NotificationManager.IMPORTANCE_LOW));
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(noisy, new IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY), RECEIVER_NOT_EXPORTED);
        else registerReceiver(noisy, new IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY));
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) { stopPlayback(); return START_NOT_STICKY; }
        String action = intent.getAction();
        if ("load".equals(action)) {
            String nextId = intent.getStringExtra("id"), nextBase = intent.getStringExtra("base");
            String nextAudio = intent.getStringExtra("audioId"), nextServer = intent.getStringExtra("serverId");
            startForeground(1, notification());
            if (nextId == null || nextBase == null || !ProgressSync.uuid(nextAudio) || !ProgressSync.uuid(nextServer)) {
                fail("Upgrade the Redread server, then refresh the library."); return START_NOT_STICKY;
            }
            ProgressSync.Key next = new ProgressSync.Key(nextBase, nextServer, nextId, nextAudio);
            if (next.same(key) && nextBase.equals(base) && player != null) { if (prepared) play(); return START_NOT_STICKY; }
            if (seekPending && !seekIsRestore) {
                pendingLoad = new Intent(intent); pendingStop = false; pause(); return START_NOT_STICKY;
            }
            checkpoint(true); releasePlayer();
            key = next; id = nextId; base = nextBase; audioId = nextAudio; serverId = nextServer;
            title = intent.getStringExtra("title"); if (title == null) title = "redread";
            error = ""; syncStatus = "Checking progress…"; conflict = false; completed = false; wantPlay = true;
            speed = getSharedPreferences("redread", 0).getFloat("speed", 1f);
            final int loaded = generation;
            sync.listen(snapshot -> {
                if (current != this || generation != loaded || !key.same(snapshot.key)) return;
                syncStatus = snapshot.status; conflict = snapshot.conflict; update();
            });
            session.setMetadata(new MediaMetadata.Builder().putString(MediaMetadata.METADATA_KEY_TITLE, title).putString(MediaMetadata.METADATA_KEY_ARTIST, "redread").build());
            player = new MediaPlayer();
            player.setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build());
            player.setWakeMode(this, PowerManager.PARTIAL_WAKE_LOCK);
            player.setOnPreparedListener(p -> {
                if (!valid(p, loaded)) return;
                prepared = true;
                session.setMetadata(new MediaMetadata.Builder().putString(MediaMetadata.METADATA_KEY_TITLE, title).putString(MediaMetadata.METADATA_KEY_ARTIST, "redread").putLong(MediaMetadata.METADATA_KEY_DURATION, p.getDuration()).build());
                restore(wantPlay);
            });
            player.setOnSeekCompleteListener(p -> {
                if (!valid(p, loaded) || !seekPending) return;
                seekPending = false;
                if (queuedSeek != null) {
                    int target = queuedSeek; queuedSeek = null; beginSeek(target, false); return;
                }
                if (seekIsRestore) {
                    restoring = false;
                    if (replayAfterRestore) { completed = false; checkpoint(true); }
                    if (wantPlay) startAudio();
                } else {
                    completed = seekTarget >= duration() && duration() > 0;
                    checkpoint(true);
                    if (completed) {
                        wantPlay = false; handler.removeCallbacks(persist);
                        if (playing()) player.pause();
                        audio.abandonAudioFocusRequest(focus); stopForeground(false);
                    }
                }
                if (pendingLoad != null) {
                    Intent queued = pendingLoad; pendingLoad = null; onStartCommand(queued, 0, 0); return;
                }
                if (pendingStop) { pendingStop = false; stopPlayback(); return; }
                update();
            });
            player.setOnCompletionListener(p -> {
                if (!valid(p, loaded) || restoring || seekPending) return;
                completed = true; wantPlay = false; handler.removeCallbacks(persist);
                checkpoint(true); update(); audio.abandonAudioFocusRequest(focus); stopForeground(false);
            });
            player.setOnErrorListener((p, what, extra) -> {
                if (valid(p, loaded)) fail("Audio could not be loaded. Check the connection and reopen the episode.");
                return true;
            });
            try {
                player.setDataSource(base + "/api/articles/" + java.net.URLEncoder.encode(id, "UTF-8") + "/audio?version=" + java.net.URLEncoder.encode(audioId, "UTF-8"));
                player.prepareAsync(); update();
            } catch (Exception e) { fail("Audio could not be opened."); }
        } else if ("toggle".equals(action)) { if (playing() || wantPlay) pause(); else play(); }
        else if ("back".equals(action)) seek(position() - 15000);
        else if ("forward".equals(action)) seek(position() + 30000);
        else if ("stop".equals(action)) stopPlayback();
        return START_NOT_STICKY;
    }
    private boolean valid(MediaPlayer p, int loaded) { return current == this && generation == loaded && player == p; }
    private void checkpoint(boolean flush) {
        if (prepared && checkpointReady && !restoring && !seekPending && key != null)
            sync.snapshot(key, completed ? duration() : position(), completed, flush);
    }
    boolean playing() { return prepared && player != null && player.isPlaying(); }
    boolean hasConflict() { return conflict; }
    boolean playRequested() { return wantPlay; }
    int identityGeneration() { return generation; }
    int position() { return prepared && player != null ? completed ? duration() : seekPending ? seekTarget : player.getCurrentPosition() : 0; }
    int duration() { return prepared && player != null ? player.getDuration() : 0; }
    void seek(int value) {
        if (!prepared || restoring) return;
        int target = Math.max(0, Math.min(duration(), value));
        checkpointReady = true; // Explicit seeks are saved, unlike an unplayed resume preview.
        if (seekPending) { queuedSeek = target; return; }
        beginSeek(target, false);
    }
    private void beginSeek(int target, boolean restore) {
        seekTarget = target; seekIsRestore = restore; seekPending = true;
        player.seekTo(target, MediaPlayer.SEEK_CLOSEST); update();
    }
    void rate(float value) {
        if (value < 0.5f || value > 2.5f) return;
        speed = value; getSharedPreferences("redread", 0).edit().putFloat("speed", value).apply();
        if (prepared && !restoring && !seekPending) {
            boolean active = playing(); player.setPlaybackParams(new PlaybackParams().setSpeed(speed)); if (!active) player.pause(); update();
        }
    }
    /** Fetch before every start/resume. No late network callback is allowed to seek running audio. */
    private void restore(boolean autoplay) {
        if (!prepared) return;
        restoring = true; checkpointReady = false; wantPlay = autoplay;
        final int loaded = generation, request = ++operation;
        final MediaPlayer expected = player;
        syncStatus = "Checking progress…"; update();
        sync.open(key, snapshot -> {
            if (!valid(expected, loaded) || operation != request || playing()) return;
            syncStatus = snapshot.status; conflict = snapshot.conflict; completed = snapshot.completed;
            replayAfterRestore = completed && wantPlay;
            int target = Math.min(duration(), snapshot.position);
            if (replayAfterRestore) target = 0;
            else if (!completed && wantPlay) target = Math.max(0, target - RESUME_REWIND_MS);
            if (target != player.getCurrentPosition()) beginSeek(target, true);
            else {
                restoring = false;
                if (replayAfterRestore) { completed = false; checkpoint(true); }
                if (wantPlay) startAudio();
                update();
            }
        });
    }
    void play() {
        if (!prepared || playing() || restoring || seekPending) return;
        startForeground(1, notification()); restore(true);
    }
    private void startAudio() {
        if (!prepared || restoring || seekPending || !wantPlay) return;
        startForeground(1, notification());
        if (audio.requestAudioFocus(focus) != AudioManager.AUDIOFOCUS_REQUEST_GRANTED) {
            wantPlay = false; error = "Another app is currently using audio."; update(); stopForeground(false); return;
        }
        error = ""; player.start(); player.setPlaybackParams(new PlaybackParams().setSpeed(speed));
        checkpointReady = true;
        handler.removeCallbacks(persist); heartbeat = 0; handler.postDelayed(persist, 5000); update();
    }
    void pause() { pausePlayback(true); }
    private void pausePlayback(boolean abandonFocus) {
        resumeOnGain = false; wantPlay = false; handler.removeCallbacks(persist);
        if (prepared) { if (playing()) player.pause(); checkpoint(true); update(); }
        if (abandonFocus) audio.abandonAudioFocusRequest(focus);
        stopForeground(false);
    }
    /** User-initiated only. Pause while resolving, so an eventual callback cannot jump running audio. */
    void resolveConflict(boolean keepLocal) {
        if (!prepared || restoring || seekPending || !conflict) return;
        pause(); restoring = true;
        final int loaded = generation, request = ++operation;
        final MediaPlayer expected = player;
        syncStatus = "Resolving progress…"; update();
        sync.resolve(key, keepLocal, snapshot -> {
            if (!valid(expected, loaded) || operation != request || playing()) return;
            syncStatus = snapshot.status; conflict = snapshot.conflict; completed = snapshot.completed;
            replayAfterRestore = false;
            if (!keepLocal && !snapshot.conflict) beginSeek(Math.min(duration(), snapshot.position), true);
            else { restoring = false; update(); }
        });
    }
    void stopPlayback() {
        pause(); pendingLoad = null;
        if (seekPending && !seekIsRestore) { pendingStop = true; return; }
        checkpoint(true); operation++; stopSelf();
    }
    private void fail(String message) {
        checkpoint(true); error = message; releasePlayer(); audio.abandonAudioFocusRequest(focus); update(); stopForeground(false);
    }
    private PendingIntent command(String action) { return PendingIntent.getService(this, action.hashCode(), new Intent(this, PlaybackService.class).setAction(action), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT); }
    private Notification notification() {
        String detail = !error.isEmpty() ? error : !prepared ? "Loading audio…" : syncStatus;
        return new Notification.Builder(this, CHANNEL).setSmallIcon(R.drawable.ic_redread).setContentTitle(title.isEmpty() ? "redread" : title).setContentText(detail)
            .setContentIntent(session.getController().getSessionActivity()).setVisibility(Notification.VISIBILITY_PUBLIC).setOnlyAlertOnce(true).setOngoing(playing())
            .addAction(android.R.drawable.ic_media_rew, "Back 15 seconds", command("back"))
            .addAction(playing() ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play, playing() ? "Pause" : "Play", command("toggle"))
            .addAction(android.R.drawable.ic_media_ff, "Forward 30 seconds", command("forward"))
            .setDeleteIntent(command("stop")).setStyle(new Notification.MediaStyle().setMediaSession(session.getSessionToken()).setShowActionsInCompactView(0, 1, 2)).build();
    }
    private void update() {
        int state = !error.isEmpty() ? PlaybackState.STATE_ERROR : !prepared || restoring ? PlaybackState.STATE_BUFFERING : playing() ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED;
        PlaybackState.Builder b = new PlaybackState.Builder().setActions(PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE | PlaybackState.ACTION_PLAY_PAUSE | PlaybackState.ACTION_SEEK_TO | PlaybackState.ACTION_REWIND | PlaybackState.ACTION_FAST_FORWARD | PlaybackState.ACTION_STOP | PlaybackState.ACTION_SET_PLAYBACK_SPEED).setState(state, position(), speed);
        if (!error.isEmpty()) b.setErrorMessage(error);
        session.setPlaybackState(b.build());
        ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).notify(1, notification());
    }
    private void releasePlayer() {
        generation++; operation++; prepared = false; restoring = false; seekPending = false; queuedSeek = null; wantPlay = false; checkpointReady = false;
        pendingLoad = null; pendingStop = false;
        handler.removeCallbacks(persist);
        if (player != null) { player.release(); player = null; }
    }
    @Override public void onDestroy() {
        checkpoint(true); sync.listen(null); handler.removeCallbacksAndMessages(null); releasePlayer(); session.release(); audio.abandonAudioFocusRequest(focus); unregisterReceiver(noisy);
        if (current == this) current = null;
        stopForeground(true); super.onDestroy();
    }
    @Override public IBinder onBind(Intent intent) { return null; }
}
