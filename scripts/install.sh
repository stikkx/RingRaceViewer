#!/usr/bin/env bash
# ============================================================
# RingRaceViewer — One-Line Install Script for Ubuntu
# ============================================================
# Usage:
#   curl -sSL https://raw.githubusercontent.com/stikkx/RingRaceViewer/main/scripts/install.sh | sudo bash
#
# What it does:
#   1. Installs Node.js 24 (via nvm), git, bluez (Bluetooth), chromium
#   2. Clones the repo (or updates to latest)
#   3. Runs npm install
#   4. Creates a systemd service (auto-starts on boot)
#   5. Sets up kiosk mode (auto-login + Chromium fullscreen on all monitors)
#   6. Installs RingRaceViewer boot logo
#
# Flags:
#   --no-kiosk      Skip kiosk mode setup
#   --no-bootlogo   Skip boot logo install
#
# After install, open:
#   Dashboard: http://localhost/?display=1
#   Admin:     http://localhost/admin.html
# ============================================================

set -euo pipefail

REPO_URL="https://github.com/stikkx/RingRaceViewer.git"
INSTALL_DIR="/opt/ringraceviewer"
SERVICE_NAME="ringraceviewer"
PORT=80

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}[RRV]${NC} $1"; }
warn() { echo -e "${YELLOW}[RRV]${NC} $1"; }
err()  { echo -e "${RED}[RRV]${NC} $1"; exit 1; }

# Must be root
if [ "$EUID" -ne 0 ]; then
  err "Please run as root:  sudo bash install.sh"
fi

REAL_USER="${SUDO_USER:-$(logname 2>/dev/null || echo root)}"
log "Installing RingRaceViewer for user: $REAL_USER"

# ---- 1. System packages ----

log "Updating packages..."
apt-get update -qq

log "Installing dependencies..."
apt-get install -y -qq \
  git curl wget openssh-server xdotool wmctrl \
  bluez pulseaudio-utils \
  chromium-browser unclutter \
  2>/dev/null || apt-get install -y -qq \
  git curl wget openssh-server xdotool wmctrl \
  bluez pipewire-pulse \
  chromium unclutter \
  2>/dev/null || true

# ---- 2. Node.js 24 via nvm ----

export NVM_DIR="/opt/nvm"
NODE_VERSION="24"

if [ ! -d "$NVM_DIR" ]; then
  log "Installing nvm..."
  mkdir -p "$NVM_DIR"
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | NVM_DIR="$NVM_DIR" bash
fi

# Load nvm
export NVM_DIR="/opt/nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

if ! nvm ls "$NODE_VERSION" &>/dev/null; then
  log "Installing Node.js $NODE_VERSION..."
  nvm install "$NODE_VERSION"
fi

nvm use "$NODE_VERSION"
nvm alias default "$NODE_VERSION"

# Make node/npm available system-wide for systemd
NODE_PATH="$(dirname "$(nvm which $NODE_VERSION)")"
ln -sf "$NODE_PATH/node" /usr/local/bin/node
ln -sf "$NODE_PATH/npm" /usr/local/bin/npm
ln -sf "$NODE_PATH/npx" /usr/local/bin/npx

NODE_VER=$(node -v)
log "Node.js: $NODE_VER (via nvm)"

# ---- 3. Clone or update repo ----

if [ -d "$INSTALL_DIR/.git" ]; then
  log "Updating existing installation..."
  cd "$INSTALL_DIR"
  git fetch origin
  git reset --hard origin/main
else
  log "Cloning repository..."
  git clone "$REPO_URL" "$INSTALL_DIR"
  cd "$INSTALL_DIR"
fi

# ---- 4. Install npm dependencies ----

log "Installing npm packages..."
cd "$INSTALL_DIR"
npm install --omit=dev --loglevel=warn

# Allow Node.js to bind to port 80 without root
setcap 'cap_net_bind_service=+ep' "$(readlink -f /usr/local/bin/node)" 2>/dev/null || true

# ---- 5. Create data & assets directories ----

mkdir -p "$INSTALL_DIR/data"
mkdir -p "$INSTALL_DIR/public/assets"
chown -R "$REAL_USER:$REAL_USER" "$INSTALL_DIR/data" "$INSTALL_DIR/public/assets"

# ---- 6. Create systemd service ----

log "Creating systemd service..."
cat > /etc/systemd/system/${SERVICE_NAME}.service <<EOF
[Unit]
Description=RingRaceViewer Dashboard
After=network.target bluetooth.target

[Service]
Type=simple
User=$REAL_USER
WorkingDirectory=$INSTALL_DIR
ExecStart=/usr/local/bin/node server.js
Restart=always
RestartSec=5
Environment=PORT=$PORT
Environment=NODE_ENV=production
Environment=NVM_DIR=/opt/nvm

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable "$SERVICE_NAME"
systemctl restart "$SERVICE_NAME"

# Wait for server to start
sleep 2
if systemctl is-active --quiet "$SERVICE_NAME"; then
  log "Service is running!"
else
  warn "Service may not have started. Check: journalctl -u $SERVICE_NAME"
fi

# ---- 7. SSH access ----

log "Enabling SSH..."
systemctl enable ssh 2>/dev/null || systemctl enable sshd 2>/dev/null || true
systemctl start ssh 2>/dev/null || systemctl start sshd 2>/dev/null || true

# ---- 8. Firewall (if ufw is active) ----

if command -v ufw &>/dev/null && ufw status | grep -q "active"; then
  log "Opening ports in firewall..."
  ufw allow "$PORT"/tcp
  ufw allow 22/tcp
fi

# ---- 8. Kiosk mode ----
# Installed by default. Use --no-kiosk to skip.

SKIP_KIOSK="n"
for arg in "$@"; do [ "$arg" = "--no-kiosk" ] && SKIP_KIOSK="y"; done

if [ "$SKIP_KIOSK" = "n" ]; then
  log "Setting up kiosk mode..."

  # Auto-login + force X11 (Wayland breaks window positioning and xdotool)
  GDM_CONF="/etc/gdm3/custom.conf"
  if [ -f "$GDM_CONF" ]; then
    sed -i "s/^#\?AutomaticLoginEnable=.*/AutomaticLoginEnable=true/" "$GDM_CONF"
    sed -i "s/^#\?AutomaticLogin=.*/AutomaticLogin=$REAL_USER/" "$GDM_CONF"
    sed -i "s/^#\?WaylandEnable=.*/WaylandEnable=false/" "$GDM_CONF"
    # If WaylandEnable line doesn't exist, add it
    if ! grep -q 'WaylandEnable' "$GDM_CONF"; then
      sed -i '/\[daemon\]/a WaylandEnable=false' "$GDM_CONF"
    fi
    log "GDM: auto-login for $REAL_USER, X11 forced (Wayland disabled)"
  fi

  # Kiosk launcher script
  KIOSK_DIR="/home/$REAL_USER/.local/bin"
  mkdir -p "$KIOSK_DIR"

  CHROMIUM=$(command -v chromium-browser || command -v chromium || echo "chromium-browser")

  cat > "$KIOSK_DIR/ringraceviewer-kiosk.sh" <<'SCRIPT'
#!/usr/bin/env bash
# RingRaceViewer Kiosk Launcher
# Auto-detects all connected monitors and opens a kiosk window on each.

APP_URL="http://localhost"
RRV_DIR="/opt/ringraceviewer"
EXT_DIR="$HOME/snap/chromium/common/extensions"
CHROMIUM=$(command -v chromium-browser || command -v chromium || echo "chromium-browser")

# Disable screen blanking / power management
xset s off 2>/dev/null; xset -dpms 2>/dev/null; xset s noblank 2>/dev/null

# Force dark mode (makes Chromium title bar dark)
gsettings set org.gnome.desktop.interface color-scheme 'prefer-dark' 2>/dev/null
gsettings set org.gnome.desktop.interface gtk-theme 'Yaru-dark' 2>/dev/null

# Hide GNOME panel/dock for clean kiosk look
gsettings set org.gnome.shell.extensions.dash-to-dock dock-fixed false 2>/dev/null
gsettings set org.gnome.shell.extensions.dash-to-dock autohide true 2>/dev/null
gsettings set org.gnome.shell.extensions.dash-to-dock intellihide true 2>/dev/null

# Kill any leftover unclutter/chromium
killall unclutter 2>/dev/null
pkill -f chromium 2>/dev/null || killall chrome chromium chromium-browser 2>/dev/null
sleep 1
unclutter -idle 2 &

# Wait for server
echo "Waiting for RingRaceViewer..."
until curl -s -o /dev/null "$APP_URL"; do sleep 2; done
echo "Server is up!"

# Parse connected monitors into arrays (avoids subshell pipe issue)
MONITORS=()
while IFS= read -r line; do
  GEOM=$(echo "$line" | grep -oP '\d+x\d+\+\d+\+\d+' | head -1)
  [ -n "$GEOM" ] && MONITORS+=("$GEOM")
done < <(xrandr --query | grep ' connected')

echo "Found ${#MONITORS[@]} monitor(s)"

# Kill any leftover Chromium instances
pkill -f chromium 2>/dev/null || killall chrome chromium chromium-browser 2>/dev/null
sleep 1

# Remove old display configs, register fresh ones matching actual monitors
# Delete all displays above monitor count
for d in $(seq $((${#MONITORS[@]} + 1)) 20); do
  curl -s -X DELETE "$APP_URL/api/displays/$d" -o /dev/null 2>/dev/null
done

# Launch Chromium on each monitor
for i in "${!MONITORS[@]}"; do
  GEOM="${MONITORS[$i]}"
  NUM=$((i + 1))

  WIDTH=$(echo "$GEOM" | cut -dx -f1)
  HEIGHT=$(echo "$GEOM" | cut -d+ -f1 | cut -dx -f2)
  XOFF=$(echo "$GEOM" | cut -d+ -f2)
  YOFF=$(echo "$GEOM" | cut -d+ -f3)

  echo "Monitor $NUM: ${WIDTH}x${HEIGHT} at +${XOFF}+${YOFF}"

  # Register display with correct resolution (PUT upserts)
  curl -s -X PUT "$APP_URL/api/displays/$NUM" \
    -H "Content-Type: application/json" \
    -d "{\"width\":$WIDTH,\"height\":$HEIGHT}" -o /dev/null 2>/dev/null

  # Clean user data dir to prevent "restore session" dialogs
  rm -rf "/tmp/chromium-display${NUM}"
  mkdir -p "/tmp/chromium-display${NUM}"

  # --app mode gives a clean window (no tabs/address bar)
  # --load-extension loads the LiveTiming dark theme for timing iframes
  # Separate --user-data-dir per monitor prevents process merging
  EXT_FLAGS=""
  # Try snap-accessible path first, then fall back to install dir
  if [ -d "$EXT_DIR/livetiming-dark" ]; then
    EXT_FLAGS="--load-extension=$EXT_DIR/livetiming-dark"
  elif [ -d "$RRV_DIR/extensions/livetiming-dark" ]; then
    EXT_FLAGS="--load-extension=$RRV_DIR/extensions/livetiming-dark"
  fi

  $CHROMIUM \
    --app="$APP_URL/?display=${NUM}" \
    --no-first-run \
    --disable-infobars \
    --disable-session-crashed-bubble \
    --disable-restore-session-state \
    --disable-features=TranslateUI \
    --autoplay-policy=no-user-gesture-required \
    --noerrdialogs \
    --no-default-browser-check \
    --enable-features=WebUIDarkMode \
    --force-dark-mode \
    $EXT_FLAGS \
    --window-position=${XOFF},${YOFF} \
    --window-size=${WIDTH},${HEIGHT} \
    --user-data-dir="/tmp/chromium-display${NUM}" &

  sleep 3

  # Force-move window to correct monitor via wmctrl (xdotool is blocked by GNOME/mutter)
  WID=$(wmctrl -l | grep "RRV-Display-${NUM}" | head -1 | awk '{print $1}')
  if [ -n "$WID" ]; then
    wmctrl -i -r "$WID" -e "0,${XOFF},${YOFF},${WIDTH},${HEIGHT}"
    wmctrl -i -r "$WID" -b add,fullscreen
    echo "Monitor $NUM: placed at +${XOFF}+${YOFF} (fullscreen)"
  else
    echo "Monitor $NUM: window not found, retrying..."
    sleep 3
    WID=$(wmctrl -l | grep "RRV-Display-${NUM}" | head -1 | awk '{print $1}')
    if [ -n "$WID" ]; then
      wmctrl -i -r "$WID" -e "0,${XOFF},${YOFF},${WIDTH},${HEIGHT}"
      wmctrl -i -r "$WID" -b add,fullscreen
      echo "Monitor $NUM: placed at +${XOFF}+${YOFF} (fullscreen, retry)"
    fi
  fi
done

echo "All monitors started"
SCRIPT

  chmod +x "$KIOSK_DIR/ringraceviewer-kiosk.sh"

  # Autostart desktop entry
  AUTOSTART_DIR="/home/$REAL_USER/.config/autostart"
  mkdir -p "$AUTOSTART_DIR"
  cat > "$AUTOSTART_DIR/ringraceviewer-kiosk.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=RingRaceViewer Kiosk
Exec=$KIOSK_DIR/ringraceviewer-kiosk.sh
X-GNOME-Autostart-enabled=true
DESKTOP

  chown -R "$REAL_USER:$REAL_USER" "$KIOSK_DIR" "$AUTOSTART_DIR"

  # Deploy extensions to snap-accessible dir (snap Chromium can't read /opt/)
  if snap list chromium &>/dev/null && [ -d "$INSTALL_DIR/extensions" ]; then
    SNAP_EXT="/home/$REAL_USER/snap/chromium/common/extensions"
    mkdir -p "$SNAP_EXT"
    cp -r "$INSTALL_DIR/extensions/"* "$SNAP_EXT/"
    chown -R "$REAL_USER:$REAL_USER" "$SNAP_EXT"
    log "Extensions deployed to snap path"
  fi

  log "Kiosk mode ready! Will auto-start on next login."
fi

# ---- 9. Boot logo ----
# Installed by default. Use --no-bootlogo to skip.

SKIP_BOOTLOGO="n"
for arg in "$@"; do [ "$arg" = "--no-bootlogo" ] && SKIP_BOOTLOGO="y"; done

if [ "$SKIP_BOOTLOGO" = "n" ]; then
  log "Installing boot logo..."
  bash "$INSTALL_DIR/scripts/install-bootlogo.sh"
fi

# ---- Done ----

IP=$(hostname -I | awk '{print $1}')

echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  RingRaceViewer installed successfully!${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "  Dashboard:  ${YELLOW}http://${IP}:${PORT}/?display=1${NC}"
echo -e "  Admin:      ${YELLOW}http://${IP}:${PORT}/admin.html${NC}"
echo ""
echo -e "  Service:    sudo systemctl {start|stop|restart} $SERVICE_NAME"
echo -e "  Logs:       sudo journalctl -u $SERVICE_NAME -f"
echo -e "  Update:     Re-run this install script"
echo ""
