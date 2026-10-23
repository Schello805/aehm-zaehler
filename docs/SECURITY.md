# Sicherheitskonfiguration

Für öffentlich erreichbare Instanzen HTTPS am Reverse Proxy verwenden. Der
Anwendungsport 8787 sollte nur vom Reverse Proxy erreichbar sein. Der Server
vertraut standardmäßig keinen weitergeleiteten IP-Headern; hinter einem Proxy
gelten IP-Limits daher gemeinsam für dessen Adresse. `trust proxy` nur passend
zum tatsächlichen Netzwerk und niemals pauschal aktivieren.

## Admin-Prüfung und lokale Daten

`ADMIN_DELETE_PASSWORD` in der serverseitigen `.env` auf einen neuen, zufälligen
Wert mit mindestens 20 Zeichen setzen. Der frühere Standard gilt als öffentlich
bekannt und darf nicht weiterverwendet werden. Ohne Konfiguration ist die
Passwortprüfung deaktiviert. Die Oberfläche wartet auf die serverseitige Antwort.
Fehlversuche werden nach der tatsächlichen Verbindungsadresse begrenzt.

Verlauf und Ranglisten sind weiterhin lokale Browserdaten. Der Besitzer des
Browsers kann diese über die Entwicklertools ändern oder löschen. Die
Admin-Abfrage schützt keine gemeinsame serverseitige Ranglisten-Datenbank.

Analyse-Status, Ergebnis, Audio und Abbruch sind an ein zufälliges HttpOnly-Cookie
gebunden. URLs mit Job-IDs allein gewähren keinen Zugriff. Das Cookie gilt sieben
Tage; Status und Job-Ergebnisse bleiben nur zeitlich begrenzt im Serverprozess.
Ein Browserwechsel oder das Löschen der Cookies beendet den Zugriff.

## Ressourcen und Medienquellen

`MAX_MEDIA_BYTES` begrenzt Analyse-Uploads und direkte Audio-Downloads, standardmäßig
auf 2 GiB. Die Warteschlange nimmt höchstens zehn wartende Analysen an. Andere
Medienverarbeitungen sind auf zwei gleichzeitig begrenzt; deren Uploads haben
ein Limit von 50 MiB und liegen weiterhin im Arbeitsspeicher. Rate-Limits gelten
zusätzlich; regelmäßige Statusabfragen sind davon ausgenommen.

Direkte HTTP-Aufrufe prüfen öffentliche Zieladressen bei jeder Weiterleitung
und nochmals bei der DNS-Auflösung für die Verbindung. Private und reservierte
IPv4-/IPv6-Adressen, Zugangsdaten in URLs und andere Ports als 80/443 werden
abgewiesen. RSS-Metadaten sind auf 2 MiB begrenzt. ffmpeg darf für hochgeladene
Dateien keine Netzwerkprotokolle verwenden.

Video-Downloads über yt-dlp sind auf YouTube-Hosts beschränkt. Direkte Audiodateien
und Podcast-RSS bleiben unterstützt. yt-dlp ist ein eigenständiger Prozess:
Seine internen Folgeanfragen laufen nicht durch den HTTP-Schutz von Node.js.
Für vollständige Netzwerkisolation sind zusätzlich ausgehende Firewall-Regeln
gegen interne Netze und Metadaten-Dienste oder ein isolierter Download-Worker
erforderlich. yt-dlp, ffmpeg und Python-Pakete müssen auf dem Server separat
aktuell gehalten werden; `npm audit` prüft diese Programme nicht.

Für öffentliche Bereitstellung außerdem einen unprivilegierten Dienstbenutzer
verwenden (ältere Installer konfigurieren `User=root`), CPU/RAM- und Datenträger-
Quoten setzen sowie die siebentägige Speicherung von Checkpoints berücksichtigen.
Die Anwendung darf nicht auf vertrauliche Host-Dateien zugreifen können.

## Überprüfung

`npm test` prüft interne und verschleierte IP-Adressen, DNS-Rebinding,
Weiterleitungen, Sitzungstrennung der API und lange Statusabfragen.
`npm audit` prüft bekannte npm-Schwachstellen anhand der installierten Versionen.
