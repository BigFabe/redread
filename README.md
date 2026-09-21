# redread

<img src="apps/web/public/logo.png" alt="redread — Your articles. Made for listening." width="160">

Personal article library with LLM-generated listening versions, TTS, and a podcast feed. This is a single-user prototype without authentication. It includes browser extensions for Chrome and Firefox as well as a native Android app with share integration and background playback.

## Access and operation

- Local: **http://127.0.0.1:3210**, RSS: http://127.0.0.1:3210/feed.xml
- For remote access, bind only to your own Tailscale IP or use Tailscale Serve; do not expose the app to the public internet without protection.
- Example Tailnet endpoint: `http://your-host:3210`.
- The transient systemd user services shown below run independently of the terminal. They do not start automatically after a reboot.

```sh
systemctl --user status redread-web redread-worker
journalctl --user -u redread-web -u redread-worker -f
systemctl --user stop redread-web redread-worker
```

## Features

- Save articles from a public URL or pasted text.
- URL imports and the browser extension extract articles with Mozilla Readability and convert them to Markdown with Turndown. Headings, lists, quotes, code, and tables retain their structure. Complex tables, such as those with merged cells, remain as sanitized HTML tables. Previously saved articles must be imported again to benefit from this improvement.
- Responsive library with search, status filters, and a reader.
- Store the original text and listening version separately; the listening version can be edited after failed processing.
- Independently configurable LLM/TTS base URLs, models, API keys, prompt, and voice.
- OpenAI-compatible `POST /chat/completions` (including OpenRouter) and `POST /audio/speech` (MP3), plus Fish Audio `POST /v1/tts` with a model header and optional voice reference ID. For Fish, enter the complete TTS URL; for OpenAI, enter the base URL, usually ending in `/v1`.
- Persistent SQLite queue with one worker process handling articles and chunks concurrently. Global LLM/TTS limits, stable result ordering, and cached successful steps.
- MP3 playback, download, and RSS with stable IDs, enclosures, artwork, and HTTP range support.
- If no models are configured, articles are saved as drafts. The app does not generate sample content or simulated audio automatically.

## Browser extension

[Download for Chrome](https://github.com/BigFabe/redread/releases/latest/download/redread-chrome.zip) · [Download for Firefox](https://github.com/BigFabe/redread/releases/latest/download/redread-firefox.zip)

Send the open page, including its article text, to the server with one click and start audio processing. Setup, installation, and test commands: [apps/extension/README.md](apps/extension/README.md). The Firefox build is not signed yet, so it can currently be installed only as a temporary add-on.

```sh
npm run extension:build  # also requires the zip command
```

## Android app

Import articles through Android's share menu and listen to episodes with background playback, lock-screen controls, and saved playback progress. Setup and APK build instructions: [apps/android/README.md](apps/android/README.md).

```sh
./apps/android/build.sh
adb install -r apps/android/build/redread.apk
```

## Model configuration with `.env`

The web app and worker load the repository's `.env` file at startup. Use `.env.example` as a template. The actual file is ignored by Git and should be readable only by its owner (`chmod 600 .env`).

- `LLM_BASE_URL`, `LLM_MODEL`, `LLM_API_KEY`: OpenRouter or another OpenAI-compatible provider.
- `TTS_PROVIDER=fish` or `openai`, `TTS_URL`, `TTS_MODEL`, `TTS_API_KEY`.
- `TTS_VOICE`: Fish `reference_id` (optional) or an OpenAI voice ID.
- `TTS_CUSTOM_VOICES`: named voices as a JSON list, for example `'[{"name":"Narrator","voice":"reference-id"}]'`. Editable as a table under “Custom voices”; the web app and extension popup offer these voices before processing starts. A voice stored for an article takes precedence over language mapping and the default voice, including when processing resumes. Without a selection, the previous behavior remains unchanged. IDs must match the active TTS provider. Like all saved web app settings, the list persists across restarts.
- `TTS_LANGUAGE_VOICES`: JSON mapping of language codes to voices, for example `'{"de":"german-reference-id","en":"english-reference-id"}'`. Editable under “Voices by language” in the web app. IDs must match the selected TTS provider; without a mapping, `TTS_VOICE` is used as the default voice.

Before preparing the text, the configured LLM detects the article's predominant language once, using up to 6,000 characters from the beginning, middle, and end. All audio chunks use the mapped voice. Regional codes are matched exactly first and then by base language (`en-US` → `en`); the default voice is used for unknown languages or missing mappings. Invalid model responses stop processing with an error. The detected language is stored with the article and reused when processing resumes. “Process again” detects it again and applies the current mappings. Existing audio remains unchanged until you process it again.

**`.env` provides the baseline; changes saved in the UI persist.** Every option, including concurrency, chunk length, providers, models, keys, voice, prompt, and feed settings, is editable in Settings. Saved values override `.env` and are shared between the web app and worker through SQLite. They survive worker and web-server restarts; “Reset to .env” explicitly discards them. The UI never modifies `.env`. Only values that differ from the baseline are stored; unchanged `.env` keys are not copied.

Choose the color mode under **Settings → Appearance**. `UI_THEME=light` (default), `UI_THEME=dark`, or `UI_THEME=auto` (follows system changes) sets the persistent baseline; the selection saved in the web app also persists across restarts.

Persistent prompt/feed values: `LLM_PROMPT`, `FEED_TITLE`, `PUBLIC_URL`. Environment variables already exported to the process take precedence over the file. After changing the file:

```sh
systemctl --user restart redread-web redread-worker
```

### Concurrent processing

Configure these persistently in Settings without a restart, or use `.env` as the baseline:

- `ARTICLE_CONCURRENCY=2`: concurrently active articles.
- `LLM_CONCURRENCY=3`: maximum concurrent LLM calls **across all articles** and target number of LLM chunks per article.
- `TTS_CONCURRENCY=2`: maximum concurrent TTS calls **across all articles**.
- `LLM_CHUNK_CHARS=3000`: maximum LLM chunk length; splitting prefers sentence and paragraph boundaries.

Article and API limits are applied when scheduling more work without cancelling calls already in progress. Models, prompt, voice, and chunk length are captured when an article starts. Text and audio are assembled in their original order despite different response times. Identical chunks share in-flight calls. After an error, no additional chunks are started; already scheduled calls are allowed to finish and successful results are saved. Only then is the article released for retrying or deletion. Continue to run only **one worker process**. Values that are too high can trigger provider limits; reduce concurrency after HTTP 429 responses. Short articles and listening versions are also split according to LLM or TTS concurrency, preferably at sentence boundaries and, if needed, at word boundaries. LLM chunks stay below `LLM_CHUNK_CHARS`, while audio chunks stay below 3,000 characters. Unsplittable single words and identical chunks can result in fewer calls. Both limits remain global across all articles. Changing concurrency can produce different chunks and new model calls on retries.

For other working directories, `REDREAD_ENV_FILE` can specify an absolute path. An empty value disables automatic loading for tests. Compose passes `.env` to both containers; recreate the containers after changes.

## Monorepo

```text
apps/web/          Next.js / React: UI, REST-API, RSS, Audio
apps/worker/       Persistent processing, LLM → TTS → FFmpeg
apps/extension/    Shared Chrome/Firefox extension
apps/android/      Native Android app: sharing, library, audio player
packages/core/     SQLite, extraction, processing, shared types
tests/             API, pipeline, and browser tests
```

TypeScript and npm workspaces. This prototype uses SQLite directly through `node:sqlite`, without an ORM or Redis. It uses custom CSS and Lucide icons, with no code copied from Karakeep. Font files are served locally.

## Local development

Requirements: Node.js 24+, npm, and FFmpeg including ffprobe.

```sh
npm ci
npm run dev       # http://127.0.0.1:3210
# second terminal, also in the repository:
npm run worker
```

The default data directory for these workspace commands is `./data` in the repository. When using other working directories, explicitly set the same absolute `DATA_DIR` for both processes.

```sh
npm run build
npm start
npm run typecheck
npm test          # requires npm run build first; isolated data and mock models
# Against the running web app; creates and removes one test article:
CHROMIUM_PATH=/usr/bin/chromium TEST_URL=http://127.0.0.1:3210 node tests/browser.mjs
```

The browser check preserves existing settings and disables automatic audio generation for its test article.

## Restart the Tailscale prototype

After changes, first run `systemctl --user stop redread-web` and `npm run build`. Then run the following from the repository, replacing the host name and IP with your own Tailscale values:

```sh
systemd-run --user --unit=redread-web --collect \
  --property=WorkingDirectory="$PWD" --property=Restart=on-failure \
  --setenv=DATA_DIR="$PWD/data" \
  --setenv=PUBLIC_URL=http://your-host:3210 \
  --setenv=NEXT_TELEMETRY_DISABLED=1 \
  /usr/bin/node node_modules/next/dist/bin/next start apps/web \
  --hostname "$(tailscale ip -4)" --port 3210

# Only if the worker is not already running:
systemd-run --user --unit=redread-worker --collect \
  --property=WorkingDirectory="$PWD" --property=Restart=on-failure \
  --setenv=DATA_DIR="$PWD/data" /usr/bin/npm run worker
```

## Docker

```sh
PUBLIC_URL=https://your-tailnet-host.example docker compose up --build -d
```

The web app and worker share the `redread-data` volume. The web port is published only on `127.0.0.1:3210`. A reverse proxy or Tailscale Serve must point to this port separately. `PUBLIC_URL`, or the app URL in Settings, determines the URLs in the RSS feed. The setting saved in the UI takes precedence.

The Dockerfile and Compose configuration are included. Container operation has not been tested on this laptop: the local `docker` CLI is Podman and no Compose provider is installed. The running prototype uses Node/systemd.

## Data and security

- `data/redread.sqlite`: articles, statuses, and settings.
- `data/articles/<uuid>/original.txt`, `script.txt`, `episode.mp3`, and cached chunks.
- Backup: stop both processes and back up the entire data directory. With Docker, back up the volume.
- API keys are never returned in API responses. They are stored **unencrypted**, either in `.env` or, when configured through the UI, in SQLite until settings are reset. SQLite journals and backups can contain previous values. `.env`, the data directory, and the database use restrictive file permissions.
- Without authentication, anyone with network access can operate the app, delete data, and trigger model calls. Use it only within a trusted Tailnet.
- Public URL imports block private and special IP addresses, including after DNS resolution and redirects. Model endpoints may intentionally use internal addresses for local models.
- Imports do not execute website JavaScript. Paste login-protected, paywalled, or client-rendered pages as text if necessary.
- LLM output can deviate from the source despite the prompt. The original remains available for comparison.
- Podcast clients need direct Tailnet access; server-side podcast aggregators cannot fetch the private feed.

## Verification

Build and typecheck pass. Extension transfer was verified against isolated test instances using real Chromium and Firefox extension APIs, without real model calls. Automated coverage includes chunking, private-IP blocking, CSRF, draft storage, redacted keys, LLM→TTS failure and resume without a second LLM call, edited listening versions, MP3 output, range/HEAD requests, RSS XML, and deletion. Browser checks pass on desktop and at a 390 px mobile width without JavaScript errors. Public URL import was also tested live. OpenRouter and Fish Audio are configured through `.env`. Adapter behavior and configuration precedence were verified with test endpoints; no real model calls were made.
