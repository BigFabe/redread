# redread

<img src="apps/web/public/logo.png" alt="redread – Deine Artikel. Zum Hören." width="160">

Persönliche Artikelbibliothek mit LLM-Hörfassung, TTS und Podcastfeed. Single-User-Prototyp ohne Anmeldung. Browsererweiterungen für Chrome und Firefox sind enthalten; die Android-App ist noch nicht umgesetzt.

## Zugriff und Betrieb

- Lokal: **http://127.0.0.1:3210**, RSS: http://127.0.0.1:3210/feed.xml
- Für entfernten Zugriff nur an die eigene Tailscale-IP binden oder Tailscale Serve verwenden; nicht ungeschützt ins Internet stellen.
- Beispiel für einen Tailnet-Endpunkt: `http://dein-host:3210`.
- Die unten gezeigten transienten systemd-User-Services laufen unabhängig vom Terminal. Kein automatischer Start nach Rechnerneustart.

```sh
systemctl --user status redread-web redread-worker
journalctl --user -u redread-web -u redread-worker -f
systemctl --user stop redread-web redread-worker
```

## Funktionen

- Artikel als öffentliche URL oder eingefügten Text speichern.
- Responsive Bibliothek mit Suche, Statusfiltern und Reader.
- Originaltext und Hörfassung separat speichern; Hörfassung nach fehlgeschlagener Verarbeitung editierbar.
- Unabhängig konfigurierbare LLM-/TTS-Basis-URLs, Modelle, API-Keys, Prompt und Stimme.
- OpenAI-kompatible `POST /chat/completions` (inklusive OpenRouter) und `POST /audio/speech` (MP3), zusätzlich Fish Audio `POST /v1/tts` mit Modell-Header und optionaler Voice-Reference-ID. Bei Fish die vollständige TTS-URL eintragen; bei OpenAI die Basis-URL (üblicherweise mit `/v1`).
- Persistente SQLite-Warteschlange, ein Worker-Prozess mit parallelen Artikeln und Abschnitten. Globale Limits für LLM/TTS, feste Reihenfolge der Ergebnisse und zwischengespeicherte erfolgreiche Schritte.
- MP3-Wiedergabe, Download und RSS mit stabilen IDs, Enclosures, Cover und HTTP-Range-Unterstützung.
- Ohne konfigurierte Modelle werden Artikel als Entwürfe gespeichert. Keine automatisch erzeugten Beispielinhalte und kein simuliertes Audio in der App.

## Browsererweiterung

[Chrome herunterladen](https://github.com/BigFabe/redread/releases/latest/download/redread-chrome.zip) · [Firefox herunterladen](https://github.com/BigFabe/redread/releases/latest/download/redread-firefox.zip)

Artikel der geöffneten Seite per Klick inklusive Text an den Server schicken und die Audioverarbeitung starten. Einrichtung, Installation und Testbefehle: [apps/extension/README.md](apps/extension/README.md). Firefox-Build noch unsigniert, daher zunächst als temporäres Add-on installierbar.

```sh
npm run extension:build  # benötigt zusätzlich das zip-Kommando
```

## Modellkonfiguration per `.env`

Die Datei `.env` im Repository wird von Webapp und Worker beim Start geladen. Vorlage: `.env.example`. Die echte Datei ist Git-ignoriert und nur für den Besitzer lesbar (`chmod 600 .env`).

- `LLM_BASE_URL`, `LLM_MODEL`, `LLM_API_KEY`: OpenRouter oder anderer OpenAI-kompatibler Anbieter.
- `TTS_PROVIDER=fish` oder `openai`, `TTS_URL`, `TTS_MODEL`, `TTS_API_KEY`.
- `TTS_VOICE`: Fish `reference_id` (optional) oder OpenAI-Stimmen-ID.
- `TTS_LANGUAGE_VOICES`: JSON-Zuordnung von Sprachcodes zu Stimmen, z. B. `'{"de":"deutsche-reference-id","en":"englische-reference-id"}'`. In der Webapp unter „Stimmen nach Sprache“ editierbar. Die IDs müssen zum gewählten TTS-Anbieter passen; ohne Zuordnung gilt `TTS_VOICE` als Standardstimme.

Vor der Textaufbereitung erkennt das konfigurierte LLM einmal die überwiegende Artikelsprache anhand von bis zu 6.000 Zeichen aus Anfang, Mitte und Ende. Alle Audioabschnitte verwenden die zugeordnete Stimme. Regionale Codes werden zuerst exakt und dann über die Basissprache zugeordnet (`en-US` → `en`); bei unbekannter Sprache oder fehlender Zuordnung gilt die Standardstimme. Ungültige Modellantworten brechen mit einer Fehlermeldung ab. Die erkannte Sprache wird am Artikel gespeichert und bei Wiederaufnahme wiederverwendet. „Neu verarbeiten“ erkennt sie erneut und wendet die aktuellen Zuordnungen an. Bestehende Audios bleiben unverändert, bis du sie neu verarbeitest.

**`.env` ist dauerhaft, Änderungen in der Oberfläche sind temporär.** Alle Optionen einschließlich Parallelität, Abschnittslänge, Anbieter, Modelle, Keys, Stimme, Prompt und Feed sind in den Einstellungen editierbar. Temporäre Werte haben Vorrang vor `.env` und werden zwischen Webapp und Worker über SQLite geteilt. Der Worker löscht sie bei jedem Start; „Auf .env zurücksetzen“ verwirft sie sofort. Browser-Reload oder alleiniger Webserver-Neustart behält die aktuelle Worker-Sitzung bei. Die `.env` wird niemals von der Oberfläche geändert. Nur abweichende Werte werden zwischengespeichert, unveränderte `.env`-Keys werden nicht kopiert.

Dauerhafte Prompt-/Feed-Werte: `LLM_PROMPT`, `FEED_TITLE`, `PUBLIC_URL`. Bereits exportierte Prozessvariablen haben Vorrang vor der Datei. Nach Änderungen an der Datei:

```sh
systemctl --user restart redread-web redread-worker
```

### Parallele Verarbeitung

In den Einstellungen temporär ohne Neustart oder in `.env` dauerhaft einstellbar:

- `ARTICLE_CONCURRENCY=2`: gleichzeitig aktive Artikel.
- `LLM_CONCURRENCY=3`: maximal gleichzeitige LLM-Aufrufe **über alle Artikel zusammen** und Zielzahl der LLM-Abschnitte pro Artikel.
- `TTS_CONCURRENCY=2`: maximal gleichzeitige TTS-Aufrufe **über alle Artikel zusammen**.
- `LLM_CHUNK_CHARS=3000`: maximale Abschnittslänge für das LLM; Trennung bevorzugt an Satz-/Absatzgrenzen.

Artikel- und API-Limits werden bei der weiteren Planung berücksichtigt, ohne laufende Aufrufe abzubrechen. Modelle, Prompt, Stimme und Abschnittslänge werden pro neu gestartetem Artikel übernommen. Text und Audio werden trotz unterschiedlicher Antwortzeiten in Originalreihenfolge zusammengesetzt. Identische Abschnitte teilen sich laufende Aufrufe. Nach einem Fehler werden keine weiteren Abschnitte gestartet; bereits eingeplante Aufrufe werden abgewartet und erfolgreiche Ergebnisse gespeichert. Erst danach wird der Artikel für Wiederholung/Löschen freigegeben. Weiterhin nur **einen Worker-Prozess** starten. Zu hohe Werte können Anbieterlimits auslösen; bei HTTP 429 Parallelität reduzieren. Auch kurze Artikel und Hörfassungen werden entsprechend der LLM- bzw. TTS-Parallelität aufgeteilt: bevorzugt an Satzgrenzen, bei Bedarf an Wortgrenzen. LLM-Abschnitte bleiben unter `LLM_CHUNK_CHARS`, Audioabschnitte unter 3.000 Zeichen. Unteilbare Einzelwörter und identische Abschnitte können weniger Aufrufe ergeben. Beide Limits gelten weiterhin global über alle Artikel. Änderungen der Parallelität können bei Wiederholungen andere Abschnitte und neue Modellaufrufe erzeugen.

Für andere Arbeitsverzeichnisse kann `REDREAD_ENV_FILE` einen absoluten Dateipfad festlegen. Ein leerer Wert deaktiviert das automatische Laden (Tests). Compose übergibt `.env` an beide Container; nach Änderungen Container neu erstellen.

## Monorepo

```text
apps/web/          Next.js / React: UI, REST-API, RSS, Audio
apps/worker/       Persistente Verarbeitung, LLM → TTS → FFmpeg
apps/extension/    Gemeinsame Chrome-/Firefox-Erweiterung
packages/core/     SQLite, Extraktion, Verarbeitung, gemeinsame Typen
tests/             API-/Pipeline- und Browsertests
```

TypeScript und npm Workspaces. Für diesen Prototyp direktes SQLite über `node:sqlite`, kein ORM, kein Redis. Eigenes CSS und Lucide-Icons; keine Codeübernahme aus Karakeep. Schriftdateien werden lokal ausgeliefert.

## Lokal entwickeln

Voraussetzungen: Node.js 24+, npm und FFmpeg inklusive ffprobe.

```sh
npm ci
npm run dev       # http://127.0.0.1:3210
# zweites Terminal, ebenfalls im Repository:
npm run worker
```

Standard-Datenverzeichnis bei diesen Workspace-Kommandos: `./data` im Repository. Bei anderen Arbeitsverzeichnissen explizit eine absolute `DATA_DIR` für beide Prozesse setzen.

```sh
npm run build
npm start
npm run typecheck
npm test          # benötigt zuvor npm run build; isolierte Daten und Mock-Modelle
# Gegen die laufende Webapp; erzeugt und entfernt einen Testartikel:
CHROMIUM_PATH=/usr/bin/chromium TEST_URL=http://127.0.0.1:3210 node tests/browser.mjs
```

Die Browserprüfung speichert die bestehenden Einstellungen unverändert und deaktiviert die automatische Vertonung des Testartikels.

## Tailscale-Prototyp erneut starten

Nach Änderungen zunächst `systemctl --user stop redread-web` und `npm run build`. Dann im Repository (Hostnamen und IP durch die eigenen Tailscale-Werte ersetzen):

```sh
systemd-run --user --unit=redread-web --collect \
  --property=WorkingDirectory="$PWD" --property=Restart=on-failure \
  --setenv=DATA_DIR="$PWD/data" \
  --setenv=PUBLIC_URL=http://dein-host:3210 \
  --setenv=NEXT_TELEMETRY_DISABLED=1 \
  /usr/bin/node node_modules/next/dist/bin/next start apps/web \
  --hostname "$(tailscale ip -4)" --port 3210

# Nur wenn der Worker nicht bereits läuft:
systemd-run --user --unit=redread-worker --collect \
  --property=WorkingDirectory="$PWD" --property=Restart=on-failure \
  --setenv=DATA_DIR="$PWD/data" /usr/bin/npm run worker
```

## Docker

```sh
PUBLIC_URL=https://dein-tailnet-host.example docker compose up --build -d
```

Webapp und Worker teilen sich das Volume `redread-data`. Der Web-Port wird nur an `127.0.0.1:3210` veröffentlicht. Ein Reverse Proxy/Tailscale Serve muss separat auf diesen Port zeigen. `PUBLIC_URL` bzw. die App-URL in den Einstellungen bestimmt die URLs im RSS. Die temporäre Einstellung in der Oberfläche hat Vorrang.

Dockerfile und Compose-Konfiguration sind vorhanden. Containerbetrieb wurde auf diesem Laptop nicht getestet: die lokale `docker`-CLI ist Podman und es ist kein Compose-Provider installiert. Der laufende Prototyp verwendet Node/systemd.

## Daten und Sicherheit

- `data/redread.sqlite`: Artikel, Status, Einstellungen.
- `data/articles/<uuid>/original.txt`, `script.txt`, `episode.mp3` und zwischengespeicherte Abschnitte.
- Backup: beide Prozesse anhalten und das gesamte Datenverzeichnis sichern. Bei Docker das Volume sichern.
- API-Keys werden nie in API-Antworten zurückgegeben. Sie liegen **nicht verschlüsselt** entweder in `.env` oder (bei temporärer Konfiguration über die Oberfläche) bis zum Zurücksetzen in SQLite. SQLite-Journal/Backups können frühere Werte enthalten. `.env`, Datenverzeichnis und Datenbank haben restriktive Dateirechte.
- Ohne Auth kann jeder mit Netzwerkzugriff die App bedienen, Daten löschen und Modellaufrufe auslösen. Nur im vertrauenswürdigen Tailnet einsetzen.
- Öffentliche URL-Importe blockieren private/spezielle IP-Adressen einschließlich DNS-Auflösung und Redirects. Modell-Endpunkte dürfen für lokale Modelle absichtlich interne Adressen verwenden.
- Import führt kein Webseiten-JavaScript aus. Login-, Paywall- und rein clientseitige Seiten ggf. als Text einfügen.
- Der LLM-Text kann trotz Prompt inhaltlich abweichen. Original bleibt zur Kontrolle erhalten.
- Podcastclients müssen direkt auf das Tailnet zugreifen können; serverseitige Podcast-Aggregatoren können den privaten Feed nicht abrufen.

## Verifikation

Build und Typecheck erfolgreich. Erweiterungsübertragung mit echten Chromium- und Firefox-APIs gegen isolierte Testinstanzen geprüft (keine echten Modellaufrufe). Automatisiert geprüft: Chunking, private IP-Sperren, CSRF, Entwurf/Speicherung, redigierte Keys, LLM→TTS mit Fehler und Wiederaufnahme ohne zweiten LLM-Aufruf, editierte Hörfassung, MP3, Range-/HEAD-Anfragen, RSS-XML und Löschen. Browserchecks auf Desktop und 390px Mobilbreite ohne JS-Fehler. Öffentlicher URL-Import zusätzlich live geprüft. OpenRouter und Fish Audio sind über `.env` konfiguriert. Adapter und Konfigurationsvorrang sind mit Test-Endpunkten geprüft; echte Modellaufrufe wurden nicht ausgeführt.
