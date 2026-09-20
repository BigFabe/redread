# redread Browsererweiterung

Gemeinsame TypeScript-Codebasis mit getrennten Manifest-V3-Builds für **Chrome/Chromium/Brave ab 120** und **Firefox ab 142**. Keine Browser- oder Modell-API-Keys erforderlich.

## Installieren

Pakete aus dem aktuellen GitHub-Release:

- [Chrome herunterladen](https://github.com/BigFabe/redread/releases/latest/download/redread-chrome.zip)
- [Firefox herunterladen](https://github.com/BigFabe/redread/releases/latest/download/redread-firefox.zip)

Nach lokalem Build außerdem unter `/extensions/redread-chrome.zip` bzw. `/extensions/redread-firefox.zip` auf dem eigenen redread-Server verfügbar.

### Chrome / Brave

1. ZIP entpacken (oder lokal `apps/extension/dist/chrome` verwenden).
2. `chrome://extensions` öffnen (Brave: `brave://extensions`).
3. Entwicklermodus aktivieren → **Entpackte Erweiterung laden** → den Ordner mit `manifest.json` auswählen.
4. redread in der Toolbar anheften.

### Firefox

1. ZIP entpacken (oder lokal `apps/extension/dist/firefox` verwenden).
2. `about:debugging#/runtime/this-firefox` öffnen.
3. **Temporäres Add-on laden** → `manifest.json` im Firefox-Ordner auswählen.

**Wichtig:** Temporäre Firefox-Add-ons werden beim Browserneustart entfernt. Für eine dauerhafte Installation in regulärem Firefox muss der Build von Mozilla signiert werden (eine nicht öffentlich gelistete AMO-Signierung genügt). Dieser Prototyp ist noch nicht signiert. Keine Sicherheitseinstellungen oder Signaturprüfung deaktivieren.

## Einrichten und verwenden

1. Erweiterung öffnen: Im Popup erscheint direkt das Feld für die Serveradresse.
2. Serveradresse eintragen: `http://dein-host:3210`.
3. **Speichern & verbinden**, den Zugriff auf den Server bestätigen. Tailscale muss verbunden sein. Nach erfolgreicher Prüfung erscheint die Artikelansicht im selben Popup.
4. Artikel öffnen → redread-Symbol → optional **Stimme** wählen → **Artikel hörbar machen**. Die Liste wird aus „Eigene Stimmen“ der Webapp-Einstellungen geladen. Ohne Auswahl gelten die Sprachzuordnung und Standardstimme.
5. Die Erweiterung überträgt Titel, Quell-URL und den mit Mozilla Readability extrahierten Text der bereits geöffneten Seite. Der Server startet automatisch die LLM-/TTS-Verarbeitung.
6. **Artikel in redread öffnen** führt direkt zur Artikelansicht. Fehlen Modelle, wird stattdessen ein Entwurf gespeichert und dies angezeigt.

Das Zahnrad öffnet die Einstellungen direkt im Popup, ohne zusätzliche Seite. **Ausloggen** entfernt die Serveradresse, lokale Übertragungsstatus und Serverberechtigungen und zeigt wieder das leere Adressfeld. Bereits gespeicherte Artikel auf dem Server bleiben erhalten; laufende serverseitige Audioverarbeitung wird nicht abgebrochen.

Das Popup darf nach dem Senden geschlossen werden; die Übertragung läuft im Hintergrund und die eigentliche Audioverarbeitung auf dem Server. Der letzte Übertragungsstatus bleibt pro Tab erhalten. Während der Übertragung werden doppelte Klicks zusammengefasst. Ein bereits erfolgreich gespeicherter Artikel wird im selben Tab und unter derselben URL nicht erneut gesendet. Nach einem unklaren Netzwerkfehler vor erneutem Senden die Bibliothek prüfen: Der Server könnte die Anfrage bereits erhalten haben.

## Berechtigungen und Datenschutz

- `activeTab`: Zugriff auf die aktuelle Seite erst nach dem Klick auf die Erweiterung.
- `scripting`: den Artikeltext in diesem Tab auslesen, ohne die Originalseite zu verändern.
- `storage`: Serveradresse und letzter Übertragungsstatus lokal speichern, kein Browser-Sync.
- Optionale HTTP(S)-Hostberechtigung: wird beim Speichern nur für den angegebenen Server angefordert. Die Browserberechtigung kann technisch nicht auf einen einzelnen Port begrenzt werden.
- Keine automatisch injizierten Content-Scripts, kein Zugriff auf alle besuchten Seiten, keine Analytics, keine Remote-Scripts.
- Übertragen werden Artikeltext, Titel und URL (einschließlich möglicher Query-Parameter). Angemeldete Inhalte können enthalten sein. Formulare und Eingabefelder werden vor der Extraktion entfernt. Cookies und Modell-Keys werden nicht mitgesendet.
- Der konfigurierte Server kann den Text an seine LLM-/TTS-Anbieter weiterleiten.
- Eingeschränkte Browserseiten, Add-on-Stores, PDFs und manche eingebetteten Inhalte lassen sich nicht auslesen. In diesem Fall Text direkt in der Webapp einfügen.

Die Server-API erlaubt Erweiterungs-Origin-POSTs ausschließlich für `/api/articles` mit dem Marker `X-Redread-Extension: 1`. Die Same-Origin-Prüfung anderer schreibender Endpunkte bleibt bestehen. Der Server hat weiterhin keine Authentifizierung und gehört ausschließlich in ein vertrauenswürdiges Netzwerk.

## Entwickeln

Im Monorepo-Root (Node.js 24+, npm und `zip`):

```sh
npm ci
npm run extension:build
npm run typecheck
npm run lint:firefox -w @redread/extension
```

Erzeugt:

```text
apps/extension/dist/chrome/           entpackt installierbar
apps/extension/dist/firefox/          entpackt installierbar
apps/extension/artifacts/redread-chrome.zip
apps/extension/artifacts/redread-firefox.zip
apps/web/public/extensions/           Downloads über die Webapp
```

Nach Änderungen neu bauen und auf der Erweiterungsseite des Browsers **Neu laden** wählen. Die Erweiterung verwendet nur mitgelieferte Skripte und Schriften. `.env` und andere Serverdateien gelangen nicht in die Pakete. Für Downloads im Produktionsserver zuerst Erweiterung und anschließend Webapp bauen.

## Tests

```sh
npm run extension:build
npm run build
npm test
npx playwright install firefox
npm run test:extension
```

`test:extension` verwendet ein isoliertes Datenverzeichnis und echte Chromium-/Firefox-Erweiterungs-APIs. Kein Worker und keine externen Modellaufrufe. Firefox wird über `web-ext` temporär installiert, Chromium über einen separaten Profilordner. Bei Bedarf `CHROMIUM_PATH` oder `FIREFOX_PATH` setzen.

Die Testkopien erhalten ausschließlich für lokale Testseiten automatische Hostberechtigungen, um Toolbar-Klicks/Browser-Permission-Dialoge im Headless-Modus zu ersetzen. **Die Release-Pakete enthalten diese zusätzlichen Berechtigungen und Testskripte nicht.** Geprüft werden gerenderter DOM-Inhalt, Extraktion, Hintergrundübertragung zur echten redread-API, Queue-Start, Doppelklickschutz und Statusspeicherung. Popup-UI einschließlich eingebetteter Einstellungen wird zusätzlich in Chromium geprüft. Der eigenständige Test `node tests/extension-popup.mjs` prüft außerdem Ersteinrichtung, fehlgeschlagene Verbindung, Ausloggen und erneutes Öffnen ohne Webapp-Build.

Firefox-Lint: keine Fehler; zwei `innerHTML`-Warnungen aus dem eingebundenen Mozilla-Readability-Code. Readability arbeitet auf einer abgetrennten Dokumentkopie; die Erweiterung sendet nur Text und setzt keinen fremden HTML-Inhalt in ihre Oberfläche ein.
