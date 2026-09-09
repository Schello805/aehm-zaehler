# Architektur

## Überblick

Das Projekt ist bewusst als lokal-first Applikation aufgebaut. Die zentrale Idee ist: Audio und Video sollen ohne API-Key und ohne laufende Cloud-Kosten analysiert werden.

## Komponenten

### Frontend

Das React-Frontend übernimmt:

- Dateiupload
- Link-Eingabe
- Wort-/Phrasen-Konfiguration
- Ergebnisdarstellung
- Verlauf und Historie
- Status- und Fortschrittsanzeige

### Backend

Das Express-Backend koordiniert:

- Dateiannahme
- Download von Medienlinks
- Audio-Konvertierung mit ffmpeg
- Aufruf der lokalen Python-Transkription
- Zählung und Ergebnisaggregation

### Python-Transkription

`transcribe_local.py` verwendet `faster-whisper`, um die Audiodaten lokal zu transkribieren. Dabei werden deutsche Fülllaute und kurze Wörter bevorzugt behandelt, um eine robustere Erkennung zu erreichen.

## Datenfluss

```text
Datei oder YouTube-Link
        ↓
Express API
        ↓
ffmpeg (falls nötig)
        ↓
lokale Whisper-Transkription
        ↓
Zählung der Suchwörter / Muster
        ↓
Ergebnis im Frontend
```

## Warum lokal-first?

- keine laufenden OpenAI-Kosten
- keine Schlüsselverwaltung im Frontend
- transparente und nachvollziehbare Verarbeitung
- einfacher für lokale Tests und private Nutzung

## Wichtige Designentscheidungen

- Füllwort-Erkennung hat Priorität vor Reaktionsgeschwindigkeit
- Standardbetrieb läuft ohne externe API-Keys
- Ergebnisse müssen reproduzierbar und nachvollziehbar sein
- Laufzeit- und Fortschrittsinfos sollen realistisch bleiben
