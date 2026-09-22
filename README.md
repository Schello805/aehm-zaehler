# Ähm-Zähler

Ein lokales Analyse-Tool für deutsche Sprache, das Füllwörter wie „äh“, „ähm“, „hm“, „genau“ und individuelle Sprachmuster automatisch erkennt und statistisch auswertet.

Das Projekt ist komplett **Local-First** aufgebaut: Keine externen API-Keys, keine Cloud-Kosten, volle Datenschutz-Kontrolle. Für die präzise Spracherkennung wird eine lokale Python-Umgebung mit `faster-whisper` (inklusive optimierter Füllwort-Hotword-Erkennung) genutzt.

---

## ⚡ Easy LXC / Debian 13 One-Liner

Auf einem frischen **Debian 13 (Trixie) LXC-Container** oder Linux-Server lässt sich die vollständige Anwendung inklusive systemd-Dienst mit nur einem Befehl als Root installieren:

### 🚀 Installation (One-Liner):

```bash
curl -fsSL https://raw.githubusercontent.com/Schello805/aehm-zaehler/main/install.sh | bash
```

Nach der Installation läuft die App automatisch als systemd-Dienst unter:
👉 `http://<DEINE-LXC-IP>:8787`

### 🔄 Update (One-Liner):

```bash
/opt/aehm-zaehler/update.sh
```
*oder via Curl:*
```bash
bash <(curl -fsSL https://raw.githubusercontent.com/Schello805/aehm-zaehler/main/update.sh)
```

---

## 💡 Features

- **YouTube- & Medien-Download**: Direktes Einfügen von YouTube-Links (via `yt-dlp` mit HTTP 403-Bypass) oder Upload von MP3/MP4-Dateien.
- **Präzise Füllwort-Erkennung**: Speziell getunte Whisper-Parameter (`hotwords`, Deaktivierung von Sentence-Smoothing), um gesprochene Laute wie „äh“ und „ähm“ nicht wegzuglätten.
- **Eigene Wörter & Phrasen**: Flexible Verwaltung von Suchbegriffen in den Einstellungen.
- **Minuten-Dichtediagramm**: Grafische Auswertung der Füllwort-Frequenz pro Minute.
- **Interaktives Transkript**: Klickbare Zeitstempel mit Direkt-Sprung zum Audio/Video.
- **Verlauf & Export**: Automatische lokale Speicherung alter Analysen mit Such- und Filterfunktionen.
- **Clean LXC Service**: Integrierter Single-Port-Production-Server für einfache Proxmox/LXC-Container-Einbindung.

---

## 🛠 Tech-Stack

- **Frontend**: React 19 + TypeScript + Vite
- **Backend-API**: Node.js + Express (Single-Port Serve für Produktion)
- **Audio-Engine**: Python 3 + `faster-whisper` (CPU/GPU-unterstützt)
- **Medien-Tools**: `ffmpeg` & `yt-dlp`

---

## 💻 Manuelle Installation (Entwicklung / macOS)

### Voraussetzungen

- Node.js 20+ & npm
- Python 3.11+ mit `venv`
- `ffmpeg` & `yt-dlp` im PATH

### Installation & Start

```bash
# 1. Repository klonen & Node-Pakete installieren
git clone https://github.com/Schello805/aehm-zaehler.git
cd aehm-zaehler
npm install

# 2. Python Virtual Environment & Whisper aufbauen
python3 -m venv .venv
./.venv/bin/pip install --upgrade pip
./.venv/bin/pip install faster-whisper

# 3. Entwicklungs-Server starten (Backend + Frontend)
npm run dev:full
```

Danach erreichbar unter:
- Frontend: `http://localhost:5173`
- Backend-API: `http://127.0.0.1:8787`

---

## 📁 Projektstruktur

```text
.
├── install.sh               # One-Liner Installer für Debian 13 LXC
├── update.sh                # Automatisiertes Update-Skript
├── server.mjs               # Express API & Production Static Server
├── transcribe_local.py      # Python Whisper-Engine mit Hotword-Tuning
├── src/                     # React Frontend Source Code
├── public/                  # Statische Assets
├── package.json             # Node Scripts & Dependencies
├── vite.config.ts           # Vite Konfiguration
└── docs/                    # Detaillierte Dokumentation
```

---

## 📜 Lizenz

Dieses Projekt steht unter der [MIT-Lizenz](LICENSE).

---

## 📸 Screenshots

### Home & Upload
<img width="1464" height="764" alt="Screenshot ähzähler home" src="https://github.com/user-attachments/assets/1b11d1ad-2cd8-486b-a2f5-a3e8d1aa0d07" />

### Einstellungen (Füllwörter verwalten)
<img width="1525" height="708" alt="Screenshot ähzähler settings" src="https://github.com/user-attachments/assets/d5dd25d7-aee3-4a4d-aebb-9a435032f961" />

### Ergebnis & Zeitstempel
<img width="677" height="777" alt="Screenshot Ergebnis" src="https://github.com/user-attachments/assets/d0390779-349a-40b3-897d-c383e301faca" />
