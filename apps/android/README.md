# redread for Android

Native Android app (Android 8 / API 26 and newer) for a private redread server.

- **Share → redread:** import a URL or text, review the title, choose a server voice, and optionally generate audio immediately. Nothing is transferred until you select “Add.” For shared text containing links, clear “Import included link as article” to save the complete text.
- **Library:** completed episodes, all articles, search, processing status, and retrying failed articles. Refreshes every 15 seconds while in the foreground.
- **Player:** streaming, background playback, lock-screen/headset controls, seek bar, −15/+30 seconds, and 0.75–2× speed. Playback positions are saved per server and episode every five seconds and when pausing. Playback pauses for calls, audio-focus loss, and disconnected headphones.
- **Server:** configurable HTTP(S) base address, checked through `/api/health` before saving and stored persistently on the device. Model configuration remains centralized in redread (`.env` / SQLite web app settings).

## Build and install

Requires JDK 17+, Python 3, and the Android SDK. No additional Java libraries or Gradle downloads are needed. The build uses the official SDK tools `aapt2`, `d8`, `zipalign`, and `apksigner`.

```sh
# From the repository:
./apps/android/build.sh
adb install -r apps/android/build/redread.apk
adb shell am start -n net.redread.app/.MainActivity
```

Defaults: SDK at `~/Android/Sdk`, Build Tools `36.0.0`, platform `android-37.0`. For other installations, set `ANDROID_HOME` (or `ANDROID_SDK_ROOT`), `ANDROID_BUILD_TOOLS`, `ANDROID_PLATFORM`, and optionally `JAVA_HOME`. The selected platform must include at least API 35. The target API is 35.

The APK and local development key are stored in the ignored `build/` directory. **Keep the key for future updates.** A new key requires uninstalling the old app, which also removes local server and player settings. This is a development build, not a signed Play Store release.

On first launch, enter the web app address available in the Tailnet under “Server.” Tailscale must be active on the device. HTTP is supported for private Tailnet endpoints. The app contains neither a hard-coded server nor API keys, and it does not bypass server access rules.

If Xiaomi/HyperOS reports `INSTALL_FAILED_USER_RESTRICTED`, enable “Install via USB” in Developer options and confirm the installation dialog on the unlocked device.

## Verification

```sh
mkdir -p apps/android/build/tests
javac -d apps/android/build/tests apps/android/src/net/redread/app/ShareInput.java apps/android/tests/ShareInputTest.java
java -cp apps/android/build/tests net.redread.app.ShareInputTest

# Opens the import dialog only; nothing is sent yet:
adb shell am start -a android.intent.action.SEND -t text/plain \
  --es android.intent.extra.TEXT 'https://example.com/article' \
  -n net.redread.app/.MainActivity
```

Verify on the device: connect to the server; share a browser link; save article text as a draft; start a completed episode; test Home/lock screen, media controls, seeking/speed, and headphone disconnection; reopen the app and resume from the saved playback position. The build creates no audio files or test articles.

Current limitations: streaming requires a server connection; there are no offline downloads, automatic next episode, or cross-server playback-progress synchronization. Dismissing the app from Recents does not stop active playback. Aggressive manufacturer battery restrictions may still terminate background playback.
