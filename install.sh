#!/usr/bin/env bash
set -euo pipefail

# Ähm-Zähler Installer für Debian 13 (Trixie) LXC / Linux
# Oneliner: curl -fsSL https://raw.githubusercontent.com/Schello805/aehm-zaehler/main/install.sh | bash

echo "=================================================="
echo "   Ähm-Zähler Installer (Debian 13 LXC / Linux)  "
echo "=================================================="

if [ "$(id -u)" -ne 0 ]; then
  echo "[FEHLER] Dieses Skript muss als root ausgeführt werden (z. B. via sudo)." >&2
  exit 1
fi

INSTALL_DIR="/opt/aehm-zaehler"
REPO_URL="https://github.com/Schello805/aehm-zaehler.git"

echo "--> [1/6] Aktualisiere Paketlisten & installiere Systemabhängigkeiten..."
apt-get update -y
apt-get install -y curl git ffmpeg python3 python3-venv python3-pip build-essential

echo "--> [2/6] Prüfe Node.js..."
if ! command -v node &> /dev/null || [ "$(node -v | cut -d. -f1 | tr -d 'v')" -lt 20 ]; then
  echo "Node.js v20+ nicht gefunden. Installiere Node.js 22 LTS..."
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
echo "Node.js Version: $(node -v)"
echo "npm Version: $(npm -v)"

echo "--> [3/6] Installiere neuestes yt-dlp..."
curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
chmod a+rx /usr/local/bin/yt-dlp
echo "yt-dlp Version: $(/usr/local/bin/yt-dlp --version)"

echo "--> [4/6] Ähm-Zähler Repository einrichten..."
if [ -d "$INSTALL_DIR/.git" ]; then
  echo "Repository in $INSTALL_DIR bereits vorhanden. Aktualisiere..."
  cd "$INSTALL_DIR"
  git pull origin main
else
  echo "Klone Repository nach $INSTALL_DIR..."
  mkdir -p "$INSTALL_DIR"
  git clone "$REPO_URL" "$INSTALL_DIR"
  cd "$INSTALL_DIR"
fi

echo "--> [5/6] Node & Python Umgebung aufbauen..."
npm install
npm run build

if [ ! -d ".venv" ]; then
  python3 -m venv .venv
fi
./.venv/bin/pip install --upgrade pip
./.venv/bin/pip install faster-whisper

chmod +x update.sh || true

echo "--> [6/6] Richte systemd Service (aehm-zaehler.service) ein..."
cat << 'EOF' > /etc/systemd/system/aehm-zaehler.service
[Unit]
Description=Ähm-Zähler Web Application
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/aehm-zaehler
ExecStart=/usr/bin/node server.mjs
Restart=always
RestartSec=5
Environment=NODE_ENV=production
Environment=PORT=8787

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable aehm-zaehler.service
systemctl restart aehm-zaehler.service

IP_ADDR=$(hostname -I | awk '{print $1}')

echo ""
echo "=================================================="
echo "   🎉 Installation erfolgreich abgeschlossen!   "
echo "=================================================="
echo "Der Ähm-Zähler läuft als Hintergrunddienst."
echo ""
echo "📱 Erreichbar im Browser unter:"
echo "   http://${IP_ADDR}:8787"
echo ""
echo "🛠️ Steuerung des Dienstes:"
echo "   systemctl status aehm-zaehler"
echo "   systemctl restart aehm-zaehler"
echo ""
echo "🔄 Für zukünftige Updates einfach ausführen:"
echo "   /opt/aehm-zaehler/update.sh"
echo "=================================================="
