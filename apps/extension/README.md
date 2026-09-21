# redread browser extension

Shared TypeScript codebase with separate Manifest V3 builds for **Chrome/Chromium/Brave 120+** and **Firefox 142+**. No browser or model API keys are required.

## Installation

Packages from the latest GitHub release:

- [Download for Chrome](https://github.com/BigFabe/redread/releases/latest/download/redread-chrome.zip)
- [Download for Firefox](https://github.com/BigFabe/redread/releases/latest/download/redread-firefox.zip)

After a local build, the packages are also available from your redread server at `/extensions/redread-chrome.zip` and `/extensions/redread-firefox.zip`.

### Chrome / Brave

1. Extract the ZIP file, or use `apps/extension/dist/chrome` locally.
2. Open `chrome://extensions` (Brave: `brave://extensions`).
3. Enable Developer mode → **Load unpacked** → select the directory containing `manifest.json`.
4. Pin redread to the toolbar.

### Firefox

1. Extract the ZIP file, or use `apps/extension/dist/firefox` locally.
2. Open `about:debugging#/runtime/this-firefox`.
3. **Load Temporary Add-on** → select `manifest.json` in the Firefox directory.

**Important:** Temporary Firefox add-ons are removed when the browser restarts. For permanent installation in standard Firefox, Mozilla must sign the build; an unlisted AMO signing is sufficient. This prototype is not signed yet. Do not disable security settings or signature verification.

## Setup and usage

1. Open the extension. The server-address field appears directly in the popup.
2. Enter the server address: `http://your-host:3210`.
3. Select **Save & connect** and confirm access to the server. Tailscale must be connected. After a successful check, the article view appears in the same popup.
4. Open an article → select the redread icon → optionally choose a **Voice** → select **Make article listenable**. The list is loaded from “Custom voices” in the web app settings. Without a selection, the language mapping and default voice apply.
5. The extension sends the title, source URL, and text extracted from the open page with Mozilla Readability. The server starts LLM/TTS processing automatically.
6. **Open article in redread** goes directly to the article view. If models are missing, a draft is saved instead and the popup explains this.

The gear opens Settings directly in the popup without an additional page. **Log out** removes the server address, local transfer statuses, and server permissions, then returns to the empty address field. Articles already stored on the server remain intact, and active server-side audio processing is not cancelled.

You can close the popup after sending. The transfer continues in the background, while audio processing happens on the server. The latest transfer status is retained per tab. Duplicate clicks during a transfer are coalesced. An article already saved successfully is not sent again from the same tab at the same URL. After an ambiguous network error, check the library before retrying because the server may already have received the request.

## Permissions and privacy

- `activeTab`: access to the current page only after the extension is selected.
- `scripting`: reads the article text from that tab without modifying the original page.
- `storage`: stores the server address and latest transfer status locally, without browser sync.
- Optional HTTP(S) host permission: requested only for the specified server when saving. Browser permissions cannot technically be limited to a single port.
- No automatically injected content scripts, access to all visited pages, analytics, or remote scripts.
- The extension sends article text, title, and URL, including possible query parameters. This may include authenticated content. Forms and input fields are removed before extraction. Cookies and model keys are not sent.
- The configured server may forward the text to its LLM/TTS providers.
- Restricted browser pages, add-on stores, PDFs, and some embedded content cannot be read. Paste the text directly into the web app in these cases.

The server API permits extension-origin POST requests only to `/api/articles` and only with the `X-Redread-Extension: 1` marker. Same-origin checks remain in place for other write endpoints. The server still has no authentication and belongs only in a trusted network.

## Development

From the monorepo root (Node.js 24+, npm, and `zip`):

```sh
npm ci
npm run extension:build
npm run typecheck
npm run lint:firefox -w @redread/extension
```

Produces:

```text
apps/extension/dist/chrome/           installable unpacked
apps/extension/dist/firefox/          installable unpacked
apps/extension/artifacts/redread-chrome.zip
apps/extension/artifacts/redread-firefox.zip
apps/web/public/extensions/           downloads served by the web app
```

After making changes, rebuild and select **Reload** on the browser's extension page. The extension uses only bundled scripts and fonts. `.env` and other server files are not included in the packages. To serve downloads from the production server, build the extension first and the web app second.

## Tests

```sh
npm run extension:build
npm run build
npm test
npx playwright install firefox
npm run test:extension
```

`test:extension` uses an isolated data directory and real Chromium/Firefox extension APIs. It runs without a worker or external model calls. Firefox is installed temporarily through `web-ext`, while Chromium uses a separate profile directory. Set `CHROMIUM_PATH` or `FIREFOX_PATH` if needed.

Test copies receive automatic host permissions only for local test pages, replacing toolbar clicks and browser permission dialogs in headless mode. **Release packages do not contain these extra permissions or test scripts.** Tests cover rendered DOM content, extraction, background transfer to the real redread API, queue startup, duplicate-click protection, and status persistence. Chromium additionally checks the popup UI, including embedded settings. The standalone `node tests/extension-popup.mjs` test also covers first-time setup, connection failure, logout, and reopening without a web app build.

Firefox lint reports no errors and two `innerHTML` warnings from the bundled Mozilla Readability code. Readability operates on a detached document copy; the extension sends text only and never inserts foreign HTML into its UI.
