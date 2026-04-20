#!/usr/bin/env bash
# ============================================================
# RingRaceViewer — Boot Logo Installer
# ============================================================
# Replaces the Ubuntu boot logo with RingRaceViewer branding.
# Does NOT rely on plymouth-set-default-theme (often missing).
# Directly edits config and replaces logo images.
#
# Usage: sudo bash scripts/install-bootlogo.sh
# Revert: sudo bash scripts/install-bootlogo.sh --remove
# ============================================================

export PATH="$PATH:/usr/sbin:/sbin"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}[RRV]${NC} $1"; }
warn() { echo -e "${YELLOW}[RRV]${NC} $1"; }

if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}[RRV]${NC} Please run as root: sudo bash $0"
  exit 1
fi

PLYMOUTH_CONF="/etc/plymouth/plymouthd.conf"
THEMES_DIR="/usr/share/plymouth/themes"

# --- Remove ---

if [ "${1:-}" = "--remove" ]; then
  log "Reverting boot logo..."
  find /usr/share/plymouth -name '*.rrv-backup' 2>/dev/null | while read f; do
    mv "$f" "${f%.rrv-backup}"
    log "  Restored: ${f%.rrv-backup}"
  done
  # Restore plymouth config
  [ -f "${PLYMOUTH_CONF}.rrv-backup" ] && mv "${PLYMOUTH_CONF}.rrv-backup" "$PLYMOUTH_CONF"
  update-initramfs -u 2>/dev/null || true
  log "Boot logo reverted. Reboot to apply."
  exit 0
fi

# --- Install ImageMagick ---

if ! command -v convert &>/dev/null; then
  log "Installing ImageMagick..."
  apt-get update -qq 2>/dev/null
  apt-get install -y imagemagick 2>/dev/null || true
fi

if ! command -v convert &>/dev/null; then
  warn "ImageMagick not available. Boot logo skipped."
  exit 0
fi

# --- Check Plymouth is installed at all ---

if [ ! -f /usr/sbin/plymouthd ] && ! command -v plymouthd &>/dev/null; then
  log "Installing Plymouth..."
  apt-get update -qq 2>/dev/null
  apt-get install -y plymouth 2>/dev/null || true
fi

if [ ! -d "$THEMES_DIR" ]; then
  warn "Plymouth themes directory not found. Boot logo skipped."
  exit 0
fi

# Install theme packages if no themes exist
THEME_COUNT=$(ls -d "$THEMES_DIR"/*/ 2>/dev/null | wc -l)
if [ "$THEME_COUNT" -lt 2 ]; then
  log "Installing Plymouth themes..."
  apt-get install -y plymouth-themes plymouth-theme-spinner 2>/dev/null || \
  apt-get install -y plymouth-themes 2>/dev/null || true
fi

# --- Find current theme ---

CURRENT_THEME=""
if [ -f "$PLYMOUTH_CONF" ]; then
  CURRENT_THEME=$(grep -oP '^Theme=\K.*' "$PLYMOUTH_CONF" 2>/dev/null || echo "")
fi
log "Current theme: ${CURRENT_THEME:-unknown}"

# --- Pick a theme that uses a logo image (not bgrt/BIOS) ---

TARGET_THEME=""
for theme in ubuntu-logo spinner lubuntu-logo bgrt; do
  if [ -d "$THEMES_DIR/$theme" ]; then
    TARGET_THEME="$theme"
    # Prefer non-bgrt themes
    [ "$theme" != "bgrt" ] && break
  fi
done

if [ -z "$TARGET_THEME" ]; then
  # Use first available theme
  TARGET_THEME=$(ls -d "$THEMES_DIR"/*/ 2>/dev/null | head -1 | xargs basename 2>/dev/null || echo "")
fi

if [ -z "$TARGET_THEME" ] || [ ! -d "$THEMES_DIR/$TARGET_THEME" ]; then
  warn "No Plymouth theme found. Boot logo skipped."
  exit 0
fi

THEME_DIR="$THEMES_DIR/$TARGET_THEME"
log "Target theme: $TARGET_THEME ($THEME_DIR)"

# --- Generate RingRaceViewer logo ---

log "Generating logo..."
LOGO_TMP="/tmp/rrv-boot-logo.png"

# Try with DejaVu font first, fallback to default
convert -size 800x200 xc:'#0a0a0f' \
  -font DejaVu-Sans-Bold -pointsize 80 \
  -fill '#e0e0e0' -annotate +10+140 'Ring' \
  -fill '#e10600' -annotate +230+140 'Race' \
  -fill '#e0e0e0' -annotate +460+140 'Viewer' \
  "$LOGO_TMP" 2>/dev/null

if [ ! -f "$LOGO_TMP" ]; then
  convert -size 800x200 xc:'#0a0a0f' \
    -pointsize 80 \
    -fill '#e0e0e0' -annotate +10+140 'Ring' \
    -fill '#e10600' -annotate +230+140 'Race' \
    -fill '#e0e0e0' -annotate +460+140 'Viewer' \
    "$LOGO_TMP" 2>/dev/null
fi

if [ ! -f "$LOGO_TMP" ]; then
  warn "Failed to generate logo. Boot logo skipped."
  exit 0
fi

log "Logo generated OK"

# --- Replace ALL png files that look like logos ---

REPLACED=0

# Check theme directory and plymouth root
for search_dir in "$THEME_DIR" "/usr/share/plymouth"; do
  find "$search_dir" -maxdepth 1 -name '*.png' 2>/dev/null | while read f; do
    fname=$(basename "$f")

    # Skip non-logo files
    case "$fname" in
      *throbber*|*spinner*|*bullet*|*lock*|*caps*|*keyboard*|*arrow*|*entry*|*box*|*progress*|*animation*) continue ;;
    esac

    # Backup original
    [ ! -f "${f}.rrv-backup" ] && cp "$f" "${f}.rrv-backup"

    # Get original dimensions
    ORIG_SIZE=$(identify -format '%wx%h' "$f" 2>/dev/null || echo "217x58")

    # Resize our logo to fit
    convert "$LOGO_TMP" -resize "$ORIG_SIZE" -gravity center \
      -background '#0a0a0f' -extent "$ORIG_SIZE" "$f" 2>/dev/null

    if [ $? -eq 0 ]; then
      log "  Replaced: $f ($ORIG_SIZE)"
      REPLACED=$((REPLACED + 1))
    fi
  done
done

rm -f "$LOGO_TMP"

# --- Switch theme in config (no plymouth-set-default-theme needed) ---

if [ "$CURRENT_THEME" = "bgrt" ] && [ "$TARGET_THEME" != "bgrt" ]; then
  log "Switching from bgrt (BIOS logo) to $TARGET_THEME..."
  [ ! -f "${PLYMOUTH_CONF}.rrv-backup" ] && cp "$PLYMOUTH_CONF" "${PLYMOUTH_CONF}.rrv-backup"
  sed -i "s/^Theme=.*/Theme=$TARGET_THEME/" "$PLYMOUTH_CONF"
  log "Plymouth config updated: Theme=$TARGET_THEME"
fi

# Also make sure Theme line exists
if [ -f "$PLYMOUTH_CONF" ] && ! grep -q '^Theme=' "$PLYMOUTH_CONF"; then
  echo "Theme=$TARGET_THEME" >> "$PLYMOUTH_CONF"
fi

# --- Ensure splash + quiet in GRUB ---

if [ -f /etc/default/grub ]; then
  GRUB_LINE=$(grep '^GRUB_CMDLINE_LINUX_DEFAULT=' /etc/default/grub || echo "")
  CHANGED=0
  if ! echo "$GRUB_LINE" | grep -q 'splash'; then
    sed -i 's/^GRUB_CMDLINE_LINUX_DEFAULT="\(.*\)"/GRUB_CMDLINE_LINUX_DEFAULT="\1 splash"/' /etc/default/grub
    CHANGED=1
  fi
  if ! echo "$GRUB_LINE" | grep -q 'quiet'; then
    sed -i 's/^GRUB_CMDLINE_LINUX_DEFAULT="\(.*\)"/GRUB_CMDLINE_LINUX_DEFAULT="\1 quiet"/' /etc/default/grub
    CHANGED=1
  fi
  [ "$CHANGED" -eq 1 ] && log "GRUB updated with quiet splash"
  update-grub 2>/dev/null || true
fi

# --- Rebuild initramfs ---

log "Rebuilding initramfs (this takes a moment)..."
update-initramfs -u -k all 2>&1 | tail -3

log "Done! Reboot to see it: sudo reboot"
log "To revert: sudo bash $0 --remove"
