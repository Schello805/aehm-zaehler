# Beitrag zum Projekt

Danke, dass du an diesem Projekt mitarbeiten möchtest.

## Grundprinzipien

- Das Projekt soll lokal nutzbar bleiben.
- Die Qualität der Füllwort-Erkennung hat Vorrang vor Geschwindigkeit.
- Neue Funktionen sollten klar dokumentiert werden.
- Kein neues Setup soll versteckte API-Kosten verursachen.

## Workflow

1. Repository forken oder lokal klonen
2. Abhängigkeiten installieren
3. Änderungen sauber und gezielt umsetzen
4. Build und relevante Checks ausführen
5. Pull Request mit klarer Beschreibung öffnen

## Lokale Entwicklung

```bash
npm install
python3 -m venv .venv
./.venv/bin/pip install --upgrade pip
./.venv/bin/pip install faster-whisper
npm run dev:full
```

## Checkliste vor dem PR

- `npm run build` erfolgreich
- keine relevanten Fehler im Frontend/Backend
- README oder Doku angepasst, falls Verhalten geändert wurde
- neue Funktionen sinnvoll dokumentiert
- keine geheimen Tokens oder API-Keys im Repo

## Code-Stil

- kurze, verständliche Funktionen
- saubere Fehlerbehandlung
- keine Abhängigkeit von OpenAI für den Standardbetrieb
- UI und Backend sollen robust und verständlich bleiben
