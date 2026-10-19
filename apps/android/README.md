# redread for Android

Native Android app (Android 8 / API 26 and newer) for a private redread server.

- **Share → redread:** import a URL or text, review the title, choose a server voice, and optionally generate audio immediately. Nothing is transferred until you select “Add.” For shared text containing links, clear “Import included link as article” to save the complete text.
- **Library:** completed episodes, all articles, search, processing status, and retrying failed articles. Refreshes every 15 seconds while in the foreground.
- **Player:** streaming, background playback, lock-screen/headset controls, seek bar, −15/+30 seconds, and 0.75–2× speed. Positions are checkpointed in local SQLite every five seconds while playing and synced with the server/web player about every ten seconds, plus on pause, completed seeks, and completion. Playback pauses for calls, audio-focus loss, and disconnected headphones.
- **Progress sync:** positions are isolated by server identity and audio generation. Pending updates survive restarts and retry without blocking playback. The player shows sync status; conflicting changes offer the server position or an explicit local continuation. Finished episodes retain their completion state until replayed. Old unversioned local positions are not automatically imported. Update the server alongside the app.
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

GitHub Actions can build the APK without a local SDK: run `gh workflow run build.yml --ref main` and download `redread-android-<run number>` from the run's artifacts. CI uses JDK 17, Android platform 35, and Build Tools 36.0.0, and also builds/typechecks the web app. Each CI run generates a fresh development signing key; these APKs are not compatible with in-place updates of an app signed by a different key. Use the retained local key for updates that must preserve installed app data.

On first launch, enter the web app address available in the Tailnet under “Server.” Tailscale must be active on the device. HTTP is supported for private Tailnet endpoints. The app contains neither a hard-coded server nor API keys, and it does not bypass server access rules.

If Xiaomi/HyperOS reports `INSTALL_FAILED_USER_RESTRICTED`, enable “Install via USB” in Developer options and confirm the installation dialog on the unlocked device.

Current limitations: streaming requires a server connection; there are no offline downloads, automatic next episode, or synchronization between independent servers. Pending progress sync resumes when the app is opened again; no upload is guaranteed while its process is stopped. Dismissing the app from Recents does not stop active playback. Aggressive manufacturer battery restrictions may still terminate background playback.
