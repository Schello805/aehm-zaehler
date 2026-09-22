#!/usr/bin/env bash
set -euo pipefail

# Ähm-Zähler Update-Skript für Debian 13 LXC / Linux
# Aufruf: /opt/aehm-zaehler/update.sh oder bash <(curl -fsSL https://raw.githubusercontent.com/Schello805/aehm-zaehler/main/update.sh)

echo "=================================================="
echo "         Ähm-Zähler Update wird gestartet        "
echo "=================================================="

INSTALL_DIR="/opt/aehm-zaehler"

if [ -d "$INSTALL_DIR/.git" ]; then
  cd "$INSTALL_DIR"
fi

echo "--> [1/5] Hole neuesten Code von GitHub..."
git reset --hard HEAD
git pull origin main

echo "--> [2/5] Aktualisiere Node-Pakete & baue Frontend..."
npm install
npm run build

echo "--> [3/5] Aktualisiere Python-Umgebung..."
if [ -d ".venv" ]; then
  ./.venv/bin/pip install --upgrade pip faster-whisper
else
  python3 -m venv .venv
  ./.venv/bin/pip install --upgrade pip faster-whisper
fi

echo "--> [4/5] Aktualisiere yt-dlp..."
if [ -f "/usr/local/bin/yt-dlp" ]; then
  /usr/local/bin/yt-dlp -U || true
fi

echo "--> [5/5] Starte Ähm-Zähler Service neu..."
if command -v systemctl &> /dev/null && systemctl list-unit-files | grep -q aehm-zaehler.service; then
  systemctl restart aehm-zaehler.service
  echo "Dienst aehm-zaehler.service neu gestartet."
fi

echo ""
echo "=================================================="
echo "   ✅ Ähm-Zähler wurde erfolgreich aktualisiert! "
echo "=================================================="
