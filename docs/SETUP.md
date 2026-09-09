# Setup und lokale Nutzung

Dieses Handbuch erklärt die Einrichtung des Projekts für lokale Entwicklung und Nutzung.

## Voraussetzungen

- Node.js 20+
- npm
- Python 3.11+
- ffmpeg
- `yt-dlp`

## 1) Abhängigkeiten installieren

```bash
npm install
python3 -m venv .venv
./.venv/bin/pip install --upgrade pip
./.venv/bin/pip install faster-whisper
```

## 2) ffmpeg prüfen

```bash
ffmpeg -version
```

## 3) yt-dlp prüfen

```bash
yt-dlp --version
```

Falls der Befehl nicht gefunden wird, setze ihn in `PATH` oder in `.env`:

```bash
export YT_DLP_PATH="/opt/homebrew/bin/yt-dlp"
```

## 4) App starten

```bash
npm run dev:full
```

- Frontend: http://localhost:5173
- Backend: http://127.0.0.1:8787

## 5) Beispielanalyse

1. Audiodatei hochladen oder YouTube-Link eingeben
2. Füllwörter wählen
3. Analyse starten
4. Ergebnis prüfen

## 6) Troubleshooting

### Python-Umgebung fehlt

```bash
python3 -m venv .venv
./.venv/bin/pip install faster-whisper
```

### ffmpeg fehlt

macOS:

```bash
brew install ffmpeg
```

### yt-dlp fehlt

```bash
brew install yt-dlp
```

### Port 8787 belegt

```bash
PORT=8788 npm run server
```
