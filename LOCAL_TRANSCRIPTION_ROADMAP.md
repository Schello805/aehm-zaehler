# Roadmap: lokale Transkription ohne OpenAI-Kosten

## Ziel
Die App soll ohne laufende Cloud-Kosten zuverlässig deutsche Audio- und Video-Dateien analysieren können. Dabei bleibt OpenAI als optionales Backup erhalten, aber der Standardbetrieb soll lokal laufen.

## Phase 1: Transkriptions-Provider sauber abstrahieren
Ziel: Die App soll zwischen verschiedenen Transkriptions-Engines wechseln können, ohne das gesamte Backend neu zu schreiben.

- Backend so aufteilen, dass ein Provider-Interface existiert
- OpenAI-Transkription und lokale Whisper-Transkription als getrennte Implementierungen
- Request-Header für Provider-Auswahl vorbereiten
- Standard-Provider auf `local` setzen
- einheitliches Ergebnisformat für alle Provider definieren

Erfolgsmaß: Ein Request liefert immer dasselbe Ergebnis-Format, egal ob lokal oder über OpenAI.

## Phase 2: lokale Whisper-Implementierung einbauen
Ziel: echte lokale Transkription ohne API-Kosten.

- Python-Umgebung im Projekt anlegen
- `faster-whisper` installieren und testen
- Audio vor der Transkription normalisieren und konvertieren
- lokale Transkription mit deutscher Sprache und Fülllaut-Prompt ausführen
- Transkriptionsergebnis als Text an das Ergebnis-Format anpassen
- lokale Ergebnisse mit derselben Füllwort-Zählung verarbeiten

Erfolgsmaß: Eine reale Audio-Datei kann lokal transkribiert und mit Füllwörtern ausgewertet werden.

## Phase 3: Füllwort-Erkennung verifizieren
Ziel: Die wirklich relevanten Füllwörter wie „äh“, „ähm“, „hm“, „genau“ zuverlässig zählen.

- echte Audio-Beispiele mit Fülllauten sammeln
- lokale Transkription mit deutschsprachigen Beispielen testen
- Umlaut- und Wortgrenzenfälle absichern
- zusätzliche Normalisierung für Schreibweisen und Kleinschreibung ergänzen
- die Treffer-Zählung mit echten Beispielen validieren

Erfolgsmaß: Die Werte für typischen Füllwort-Mix entsprechen realen Sprachmustern.

## Phase 4: UX und Provider-Feedback erweitern
Ziel: Der Nutzer sieht sofort, was gerade läuft.

- Provider-Auswahl im Settings-Bereich ergänzen
- aktive Variante im Analyse-Panel anzeigen
- Statusmeldungen: „lokal“, „OpenAI“, „Fallback“
- Fehlerzustände klarer machen, wenn lokaler Provider fehlt oder fehlschlägt

Erfolgsmaß: Der Nutzer versteht sofort, welcher Provider läuft und warum.

## Phase 5: Stabilität und Fehlerfälle
Ziel: Die App soll robust bleiben, auch bei langen Dateien oder fehlenden Bibliotheken.

- fehlende Python-Umgebung sauber erkennen
- Fallback auf OpenAI nur dann, wenn sinnvoll
- Timeout- und Fehlerbehandlung für lange Verarbeitungen
- freie Speicherbereiche und temporäre Dateien sauber bereinigen
- geeignete Fehlermeldungen für Datei/Format/Language issues

Erfolgsmaß: Ein Problem beim lokalen Provider führt nicht zu einer unbrauchbaren App.

## Phase 6: Performance und Nutzerfreundlichkeit
Ziel: Verarbeitung muss akzeptabel und nachvollziehbar sein.

- Laufzeit- und Restzeit-Schätzung für lokale Verarbeitung verbessern
- Ladezustand mit realistischen Phasen weiter verfeinern
- bei längeren Dateien mehr Vertrauen durch Transparenz schaffen
- spätere Optimierungen: GPU/Model-Cache, Sprachvorselektion, schnellere Variante

Erfolgsmaß: Der Nutzer sieht eine logische und belastbare Verarbeitung, selbst bei längeren Aufnahmen.

## Phase 7: Produktreife und Release
Ziel: Das Produkt kann ernsthaft genutzt werden.

- lokale erste Nutzung ohne API-Setup testen
- Dokumentation für Setup, Abhängigkeiten und Startbefehle ergänzen
- README aktualisieren
- häufige Füllwörter und Beispieldaten in der Test-Suite absichern
- Release-Checkliste für lokaler Betrieb erstellen

Erfolgsmaß: Ein neues Gerät kann mit wenigen Schritten lokal gestartet werden.

## Aktueller Stand
- Provider-Abstraktion ist vorhanden.
- lokaler Whisper-Provider ist eingerichtet.
- Standardbetrieb ist lokal.
- OpenAI bleibt als Backup-Fallback erhalten.
- Die nächste Stufe ist die echte Validierung mit realen Sprachbeispielen und eine letzte Verfeinerung der Füllwort-Erkennung.

## Nächste unmittelbar geplante Aufgaben
1. reale deutsche Sprachprobe mit Fülllauten lokal testen
2. Füllwort-Erkennung an echten Beispielen verifizieren
3. Abweichungen in der Transkription dokumentieren und gezielt verbessern
4. lokale Nutzung noch klarer im UI darstellen
5. Release-Checkliste für lokalen Betrieb abschließen
