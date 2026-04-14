#!/usr/bin/env bash
# RingRaceViewer — Ubuntu Kiosk Mode Setup
# Run once on the thin client to configure auto-login and kiosk autostart.
# Usage: sudo bash scripts/kiosk-setup.sh

set -euo pipefail

APP_URL="${1:-http://localhost:3000}"
USER="${SUDO_USER:-$(whoami)}"

echo "=== RingRaceViewer Kiosk Setup ==="
echo "App URL: $APP_URL"
echo "User:    $USER"
echo ""

# 1. Install Chromium if not present
if ! command -v chromium-browser &>/dev/null && ! command -v chromium &>/dev/null; then
  echo ">>> Installing Chromium..."
  apt-get update -qq && apt-get install -y chromium-browser || apt-get install -y chromium
fi

CHROMIUM=$(command -v chromium-browser || command -v chromium)
echo "Chromium: $CHROMIUM"

# 2. Install unclutter (hides mouse cursor after idle)
if ! command -v unclutter &>/dev/null; then
  echo ">>> Installing unclutter..."
  apt-get install -y unclutter
fi

# 3. Configure auto-login (GDM3)
GDM_CONF="/etc/gdm3/custom.conf"
if [ -f "$GDM_CONF" ]; then
  echo ">>> Configuring GDM auto-login for $USER..."
  sed -i "s/^#\?AutomaticLoginEnable=.*/AutomaticLoginEnable=true/" "$GDM_CONF"
  sed -i "s/^#\?AutomaticLogin=.*/AutomaticLogin=$USER/" "$GDM_CONF"
else
  echo ">>> GDM config not found at $GDM_CONF — configure auto-login manually."
fi

# 4. Create autostart entry
AUTOSTART_DIR="/home/$USER/.config/autostart"
mkdir -p "$AUTOSTART_DIR"

cat > "$AUTOSTART_DIR/ringraceviewer-kiosk.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=RingRaceViewer Kiosk
Exec=/home/$USER/.local/bin/ringraceviewer-kiosk.sh
X-GNOME-Autostart-enabled=true
EOF

# 5. Create kiosk launcher script
LAUNCHER_DIR="/home/$USER/.local/bin"
mkdir -p "$LAUNCHER_DIR"

cat > "$LAUNCHER_DIR/ringraceviewer-kiosk.sh" <<SCRIPT
#!/usr/bin/env bash
# RingRaceViewer Kiosk Launcher
# Waits for the server, then opens Chromium on both monitors.

APP_URL="$APP_URL"
CHROMIUM="$CHROMIUM"

# Hide cursor after 3 seconds idle
unclutter -idle 3 &

# Disable screen blanking / power management
xset s off
xset -dpms
xset s noblank

# Wait for server to be reachable
echo "Waiting for RingRaceViewer server..."
until curl -s -o /dev/null "\$APP_URL"; do
  sleep 2
done
echo "Server is up!"

# Launch Display 1 (primary monitor)
\$CHROMIUM \\
  --kiosk \\
  --no-first-run \\
  --disable-infobars \\
  --disable-session-crashed-bubble \\
  --disable-features=TranslateUI \\
  --window-position=0,0 \\
  --window-size=1920,1080 \\
  "\$APP_URL/?display=1" &

sleep 2

# Launch Display 2 (second monitor, offset by primary width)
\$CHROMIUM \\
  --kiosk \\
  --no-first-run \\
  --disable-infobars \\
  --disable-session-crashed-bubble \\
  --disable-features=TranslateUI \\
  --window-position=1920,0 \\
  --window-size=1920,1080 \\
  --user-data-dir=/tmp/chromium-display2 \\
  "\$APP_URL/?display=2" &
SCRIPT

chmod +x "$LAUNCHER_DIR/ringraceviewer-kiosk.sh"
chown -R "$USER:$USER" "$AUTOSTART_DIR" "$LAUNCHER_DIR"

echo ""
echo "=== Setup Complete ==="
echo "The kiosk will auto-start on next login."
echo "To test now:  bash $LAUNCHER_DIR/ringraceviewer-kiosk.sh"
echo ""
