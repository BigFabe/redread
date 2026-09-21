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
    private boolean prepared, resumeOnGain;
    private final Handler handler = new Handler();
    String title = "", id = "", base = "", error = "";
    float speed = 1f;
    private static final String CHANNEL = "playback";
    private final Runnable persist = new Runnable() { public void run() { save(); handler.postDelayed(this, 5000); } };
    private final BroadcastReceiver noisy = new BroadcastReceiver() {
        public void onReceive(Context context, Intent intent) { pause(); }
    };

    @Override public void onCreate() {
        super.onCreate(); current = this;
        audio = (AudioManager) getSystemService(AUDIO_SERVICE);
        AudioAttributes attributes = new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build();
        focus = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN).setAudioAttributes(attributes).setOnAudioFocusChangeListener(change -> {
            if (change == AudioManager.AUDIOFOCUS_GAIN) { if (resumeOnGain) play(); resumeOnGain = false; }
            else if (change == AudioManager.AUDIOFOCUS_LOSS) pause();
            else { resumeOnGain = playing(); if (prepared) { player.pause(); save(); update(); } stopForeground(false); }
        }).build();
        session = new MediaSession(this, "redread");
        session.setSessionActivity(PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));
        session.setCallback(new MediaSession.Callback() {
            @Override public void onPlay() { play(); }
            @Override public void onPause() { pause(); }
            @Override public void onStop() { stopSelf(); }
            @Override public void onSeekTo(long position) { seek((int) position); }
            @Override public void onRewind() { seek(position() - 15000); }
            @Override public void onFastForward() { seek(position() + 30000); }
            @Override public void onSetPlaybackSpeed(float value) { rate(value); }
        });
        session.setActive(true);
        ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).createNotificationChannel(new NotificationChannel(CHANNEL, "Listen to episodes", NotificationManager.IMPORTANCE_LOW));
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(noisy, new IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY), RECEIVER_NOT_EXPORTED);
        else registerReceiver(noisy, new IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY));
        handler.postDelayed(persist, 5000);
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) { stopSelf(); return START_NOT_STICKY; }
        String action = intent.getAction();
        if ("load".equals(action)) {
            String nextId = intent.getStringExtra("id"), nextBase = intent.getStringExtra("base");
            if (nextId == null || nextBase == null) { stopSelf(); return START_NOT_STICKY; }
            startForeground(1, notification());
            if (nextId.equals(id) && nextBase.equals(base) && prepared) { play(); return START_NOT_STICKY; }
            save(); releasePlayer();
            id = nextId; base = nextBase; title = intent.getStringExtra("title"); error = "";
            speed = getSharedPreferences("redread", 0).getFloat("speed", 1f);
            session.setMetadata(new MediaMetadata.Builder().putString(MediaMetadata.METADATA_KEY_TITLE, title).putString(MediaMetadata.METADATA_KEY_ARTIST, "redread").build());
            player = new MediaPlayer();
            player.setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build());
            player.setWakeMode(this, PowerManager.PARTIAL_WAKE_LOCK);
            player.setOnPreparedListener(p -> {
                prepared = true;
                int last = getSharedPreferences("redread", 0).getInt(positionKey(), 0);
                if (last > 0 && last < p.getDuration() - 1500) p.seekTo(last);
                session.setMetadata(new MediaMetadata.Builder().putString(MediaMetadata.METADATA_KEY_TITLE, title).putString(MediaMetadata.METADATA_KEY_ARTIST, "redread").putLong(MediaMetadata.METADATA_KEY_DURATION, p.getDuration()).build());
                play();
            });
            player.setOnCompletionListener(p -> {
                getSharedPreferences("redread", 0).edit().putInt(positionKey(), 0).apply();
                p.seekTo(0); update(); audio.abandonAudioFocusRequest(focus); stopForeground(false);
            });
            player.setOnErrorListener((p, what, extra) -> { fail("Audio could not be loaded. Check the connection and reopen the episode."); return true; });
            try { player.setDataSource(base + "/api/articles/" + id + "/audio"); player.prepareAsync(); update(); }
            catch (Exception e) { fail("Audio could not be opened."); }
        } else if ("toggle".equals(action)) { if (playing()) pause(); else play(); }
        else if ("back".equals(action)) seek(position() - 15000);
        else if ("forward".equals(action)) seek(position() + 30000);
        else if ("stop".equals(action)) stopSelf();
        return START_NOT_STICKY;
    }
    private String positionKey() { return "position:" + base + ":" + id; }
    private void save() { if (prepared) getSharedPreferences("redread", 0).edit().putInt(positionKey(), position()).apply(); }
    boolean playing() { return prepared && player != null && player.isPlaying(); }
    int position() { return prepared ? player.getCurrentPosition() : 0; }
    int duration() { return prepared ? player.getDuration() : 0; }
    void seek(int value) { if (prepared) { player.seekTo(Math.max(0, Math.min(duration(), value))); save(); update(); } }
    void rate(float value) {
        if (value < 0.5f || value > 2.5f) return;
        speed = value; getSharedPreferences("redread", 0).edit().putFloat("speed", value).apply();
        if (prepared) { boolean active = playing(); player.setPlaybackParams(new PlaybackParams().setSpeed(speed)); if (!active) player.pause(); update(); }
    }
    void play() {
        if (!prepared) return;
        startForeground(1, notification());
        if (audio.requestAudioFocus(focus) != AudioManager.AUDIOFOCUS_REQUEST_GRANTED) { error = "Another app is currently using audio."; update(); stopForeground(false); return; }
        error = ""; player.start(); player.setPlaybackParams(new PlaybackParams().setSpeed(speed)); update();
    }
    void pause() {
        resumeOnGain = false;
        if (prepared) { player.pause(); save(); update(); }
        audio.abandonAudioFocusRequest(focus); stopForeground(false);
    }
    private void fail(String message) {
        error = message; releasePlayer(); audio.abandonAudioFocusRequest(focus); update(); stopForeground(false);
    }
    private PendingIntent command(String action) { return PendingIntent.getService(this, action.hashCode(), new Intent(this, PlaybackService.class).setAction(action), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT); }
    private Notification notification() {
        return new Notification.Builder(this, CHANNEL).setSmallIcon(R.drawable.ic_redread).setContentTitle(title.isEmpty() ? "redread" : title).setContentText(error.isEmpty() ? (prepared ? "Your articles. Ready to listen." : "Loading audio…") : error)
            .setContentIntent(session.getController().getSessionActivity()).setVisibility(Notification.VISIBILITY_PUBLIC).setOnlyAlertOnce(true).setOngoing(playing())
            .addAction(android.R.drawable.ic_media_rew, "Back 15 seconds", command("back"))
            .addAction(playing() ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play, playing() ? "Pause" : "Play", command("toggle"))
            .addAction(android.R.drawable.ic_media_ff, "Forward 30 seconds", command("forward"))
            .setDeleteIntent(command("stop")).setStyle(new Notification.MediaStyle().setMediaSession(session.getSessionToken()).setShowActionsInCompactView(0, 1, 2)).build();
    }
    private void update() {
        int state = !error.isEmpty() ? PlaybackState.STATE_ERROR : !prepared ? PlaybackState.STATE_BUFFERING : playing() ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED;
        PlaybackState.Builder b = new PlaybackState.Builder().setActions(PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE | PlaybackState.ACTION_PLAY_PAUSE | PlaybackState.ACTION_SEEK_TO | PlaybackState.ACTION_REWIND | PlaybackState.ACTION_FAST_FORWARD | PlaybackState.ACTION_STOP | PlaybackState.ACTION_SET_PLAYBACK_SPEED).setState(state, position(), speed);
        if (!error.isEmpty()) b.setErrorMessage(error);
        session.setPlaybackState(b.build());
        ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).notify(1, notification());
    }
    private void releasePlayer() { prepared = false; if (player != null) { player.release(); player = null; } }
    @Override public void onDestroy() {
        save(); handler.removeCallbacksAndMessages(null); releasePlayer(); session.release(); audio.abandonAudioFocusRequest(focus); unregisterReceiver(noisy); current = null; stopForeground(true); super.onDestroy();
    }
    @Override public IBinder onBind(Intent intent) { return null; }
}
