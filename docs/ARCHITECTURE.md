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

`transcribe_chunks.py` verwendet `faster-whisper`, um die Audioabschnitte lokal zu transkribieren. `transcribe_local.py` enthält weiterhin Hilfsfunktionen für Audioanalyse.

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

## Lange Videos und Wiederaufnahme

Die Analyse normalisiert Audio und zerlegt es in zehnminütige Abschnitte. Whisper lädt das Modell einmal und verarbeitet die Abschnitte nacheinander. Jeder abgeschlossene Abschnitt wird atomar als Checkpoint gespeichert; bei einem erneuten Versuch mit derselben Quelle und Suchwortliste werden fertige Abschnitte übersprungen.

Uploads für `/api/analyze` werden auf Festplatte angenommen (bis 20 GB), nicht vollständig im Node.js-Arbeitsspeicher gehalten. Arbeitsdateien und Checkpoints liegen standardmäßig in `.analysis-jobs/`; `ANALYSIS_JOBS_DIR` kann den Speicherort ändern. Nicht verwendete Arbeitsverzeichnisse werden nach sieben Tagen entfernt. Der Server benötigt ausreichend freien Festplattenspeicher für die Quelldatei und das normalisierte Audio.

Fortschritt bleibt über die Job-ID abrufbar. Das vollständige Ergebnis wird separat geladen, sobald der Job abgeschlossen ist, damit lange Transkripte nicht bei jedem Statusabruf erneut übertragen werden. Verliert eine noch geöffnete Browser-Sitzung die Serververbindung, kann sie den Auftrag erneut senden und abgeschlossene Abschnitte fortsetzen. Nach einem Browser-Neustart muss eine Upload-Datei erneut ausgewählt werden.

Die automatische Füllworterkennung verwendet keine Fülllaut-Hotwords mehr, die kurze Wörter wie „es“ in Richtung „ähm“ verzerren können. Unsichere Fülllaut-Worttokens unter 0,65 Modellwahrscheinlichkeit werden verworfen. Diese Einstellung ist bewusst konservativer, um falsche Treffer zu reduzieren.
