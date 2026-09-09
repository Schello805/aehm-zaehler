# Ähm-Zähler

Ein lokales Analyse-Tool für deutsche Sprache, das Füllwörter wie „äh“, „ähm“, „hm“ und ähnliche Muster automatisch erkennt und auswertet.

Das Projekt ist komplett lokal-first aufgebaut: Keine OpenAI-API, kein teurer Cloud-Provider, keine Abhängigkeit von geheimen Keys im normalen Nutzungspfad. Für die Transkription wird eine lokale Python-Umgebung mit `faster-whisper` genutzt.

## Warum dieses Projekt?

Die App hilft dabei, den Sprechfluss bewusster zu analysieren:

- Füllwörter und typische Redewendungen zählen
- Audio- und Video-Dateien analysieren
- YouTube-Links direkt verarbeiten
- eigene Suchbegriffe definieren und anpassen
- Analyse-Ergebnisse mit Verlauf und Metadaten speichern

Das Projekt ist für Präsentationen, Selbsttraining, Podcast-Checks, Interviews oder das tägliche Üben von gesprochenem Deutsch gedacht.

## Funktionen

- Upload von Audio-/Video-Dateien
- Analyse von YouTube-Links via `yt-dlp`
- lokale Transkription mit Whisper im Projekt-Ordner
- Zählung eigener Füllwörter und Phrasen
- kompakte Ergebnisübersicht mit Kennzahlen und Empfehlungen
- Verlaufshistorie mit Wiederaufnahmen und Bearbeitung
- cancelierbare Analyse-Läufe
- keine API-Schlüssel für den Standardbetrieb nötig

## Tech-Stack

- React + TypeScript + Vite
- Express (Backend-API)
- Python + `faster-whisper`
- `yt-dlp` für Link-Metadaten und Download
- ffmpeg für Audio-Konvertierung

## Schnellstart

### Voraussetzungen

- Node.js 20+
- npm
- Python 3.11+
- ffmpeg installiert und im PATH verfügbar
- `yt-dlp` installiert und im PATH verfügbar oder in `YT_DLP_PATH` konfiguriert

### Installation

```bash
npm install
python3 -m venv .venv
./.venv/bin/pip install --upgrade pip
./.venv/bin/pip install faster-whisper
```

Wenn `yt-dlp` nicht im PATH liegt, stelle die Umgebungsvariable `YT_DLP_PATH` ein:

```bash
export YT_DLP_PATH="/opt/homebrew/bin/yt-dlp"
```

### Projekt starten

Backend und Frontend gleichzeitig:

```bash
npm run dev:full
```

Oder separat:

```bash
npm run server
npm run dev
```

Danach öffnest du die App im Browser unter:

- Frontend: http://localhost:5173
- Backend: http://127.0.0.1:8787

## Build

```bash
npm run build
```

## Projektstruktur

```text
.
├── src/                     # React Frontend
├── public/                  # statische Assets
├── server.mjs               # Express API
├── transcribe_local.py      # lokale Whisper-Transkription
├── package.json             # Scripts und Abhängigkeiten
├── vite.config.ts           # Vite-Konfiguration
├── .env.example             # Beispiel-Umgebungsvariablen
├── .gitignore               # Projekt-Ignore-Datei
├── README.md                # Projekt-Übersicht
├── CONTRIBUTING.md           # Beitragshinweise
├── LICENSE                  # MIT-Lizenz
├── docs/
│   ├── SETUP.md             # detaillierte Einrichtung
│   └── ARCHITECTURE.md      # technische Architektur
└── .venv/                   # lokale Python-Umgebung
```

## Nutzung

1. Audio oder Video hochladen oder YouTube-Link einfügen
2. gewünschte Füllwörter oder Muster definieren
3. Analyse starten
4. Ergebnis mit ausführlicher Zählung und Vorschlägen prüfen
5. Verlauf und Wiederholungen im Projektverlauf verwalten

## Lokale Architektur

Die App arbeitet bewusst ohne Cloud-Transkription als Standard:

- Eingaben werden lokal verarbeitet
- Medien werden vor der Transkription vorbereitet
- `faster-whisper` erzeugt ein Transkript mit Zeitstempeln
- Text wird nach Füllwörtern und phrasebasierten Mustern ausgewertet
- Ergebnisse werden im Browser dargestellt

Damit bleibt das Projekt transparenter, günstiger und einfacher zu betreiben.

## Beitragen

Beiträge sind willkommen. Bitte prüfe zunächst die Hinweise in [CONTRIBUTING.md](CONTRIBUTING.md).

## Lizenz

Dieses Projekt steht unter der MIT-Lizenz. Siehe [LICENSE](LICENSE).

## Hinweis

Das Projekt wurde bewusst als lokal nutzbares Open-Source-Tool entwickelt. Der Standardbetrieb benötigt keine externe API-Konfiguration. Für die besten Ergebnisse empfiehlt sich eine gute Sprachaufnahme mit sauberem Audio und möglichst wenig Hintergrundrauschen.
