<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="public/assets/logo.svg">
    <img src="public/assets/logo.svg" alt="RingRaceViewer" width="480">
  </picture>
</p>

<p align="center">
  A real-time, remote-controlled multi-display dashboard for endurance racing events like the Nurburgring 24h.
  <br>
  Run it on an Ubuntu thin client, control it from your tablet, and show YouTube onboard streams and live timing on big screens in the paddock.
</p>

---

## Features

### Dashboard Display (`/`)
- Full-screen kiosk view designed for large monitors
- Renders YouTube streams and web pages as iframes in a configurable grid
- **Unlimited displays** — start with one, add more from the admin panel. Each monitor loads `/?display=N`
- Updates instantly via WebSocket when the layout changes — no manual refresh needed
- Splash screen on boot with automatic fade to layout
- Idle screen (logo) when no content is assigned
- Screen wake lock prevents the display from sleeping
- Auto-hides cursor after 2 seconds

### Admin Panel (`/admin`)
- **Tablet-friendly** control interface — dark mode, touch-optimized, works on any device in the same network
- **Source Management** — add YouTube streams (just paste the video ID) or any web page URL. Edit or delete sources on the fly
- **Dynamic Displays** — add or remove displays from the admin UI. Each display shows its URL (`/?display=N`) for easy kiosk setup
- **Layout Presets** — one-click arrangements:
  - **Full** — single source fills the entire screen
  - **2H** — two sources side by side (50/50)
  - **2V** — two sources stacked top/bottom
  - **2x2** — four equal quadrants
  - **2+1** — two on top, one full-width below
  - **1+2** — one full-width on top, two below
  - **Race** — big main video + two small below + timing sidebar
  - **Focus** — one large left, two small stacked on the right
  - **3Col** — three equal columns
- **Auto Layout** — automatically picks the best preset based on the number of sources
- **Multiple Layouts** — create, save, and switch between different layout setups (e.g. "Qualifying", "Race Day", "Night Setup")
- **Go Live** — one button push activates the layout on all connected displays in real-time
- **Configurable Display Resolution** — set the exact width and height per display. The admin grid preview matches the real aspect ratio
- **Bluetooth Speaker Management** — scan, pair, connect, and combine multiple Bluetooth speakers for audio output (see below)
- **Keyboard shortcut** — `Ctrl+S` to save the current layout
- **Responsive** — works on mobile phones and tablets

### Bluetooth Multi-Speaker Support
- Manage Bluetooth speakers directly from the admin panel sidebar
- **Scan** for nearby Bluetooth devices
- **Pair & Connect** speakers with one tap
- **Combine multiple speakers** — routes audio to all connected BT speakers simultaneously using PipeWire/PulseAudio `module-combine-sink`
- **Graceful degradation** — if Bluetooth isn't available (e.g. running in Docker without BT access), the section shows a friendly "not available" message instead of breaking

### Persistence
- All data (sources, layouts, theme, display config) is stored in a single JSON file (`data/db.json`)
- Survives reboots and power outages — no database server needed

### mDNS / Local Network
- The server announces itself as **`rrv.local`** on the local network via mDNS
- No IP address needed — just open `http://rrv.local/admin` from any device in the same network
- Custom hostname via `MDNS_NAME=myname` environment variable (becomes `myname.local`)

### Kiosk Mode
- Auto-detects all connected monitors via `xrandr`
- Opens a Chromium app window on each monitor with the correct display URL
- Forces X11 (disables Wayland) for reliable window positioning
- GNOME dark mode for clean dark title bars
- Hides GNOME dock/panel for a clean look
- Disables screen blanking and power management
- Auto-login via GDM

### Boot Logo
- Custom **RingRaceViewer** Plymouth boot logo (replaces the Ubuntu logo on startup)
- Skip with `--no-bootlogo` flag during install

### SSL / DNS (Nginx Proxy Manager)
- Docker Compose includes [Nginx Proxy Manager](https://nginxproxymanager.com/) for easy SSL setup
- Point your domain's DNS A record to the server, then configure the proxy host and request a free Let's Encrypt certificate — all through a web UI on port 81

---

## Quick Start

### One-Line Install (Ubuntu)

```bash
curl -sSL https://raw.githubusercontent.com/stikkx/RingRaceViewer/main/scripts/install.sh | sudo bash
```

Installs Node.js 24 (via nvm), clones the repo, creates a systemd service, sets up kiosk mode, and installs the boot logo. After install:
- **Dashboard:** `http://rrv.local/?display=1`
- **Admin Panel:** `http://rrv.local/admin`

Flags:
- `--no-kiosk` — skip kiosk mode setup
- `--no-bootlogo` — skip boot logo install

### Manual Install

```bash
git clone https://github.com/stikkx/RingRaceViewer.git
cd RingRaceViewer
npm install
node server.js
```

### Docker (no Bluetooth)

```bash
docker compose up -d
```

- **Dashboard:** `http://rrv.local`
- **Admin Panel:** `http://rrv.local/admin`
- **Nginx Proxy Manager:** `http://localhost:81` (default login: `admin@example.com` / `changeme`)

### Docker with Bluetooth

```bash
docker compose -f docker-compose.yml -f docker-compose.bluetooth.yml up -d
```

Gives the container access to the host's Bluetooth adapter and audio system. Requires `bluez` and PipeWire/PulseAudio running on the host.

---

## Managing the Service

```bash
sudo systemctl start ringraceviewer      # start
sudo systemctl stop ringraceviewer       # stop
sudo systemctl restart ringraceviewer    # restart
sudo journalctl -u ringraceviewer -f     # live logs
```

**Update to latest version:**
```bash
cd /opt/ringraceviewer && sudo git pull && sudo npm install && sudo systemctl restart ringraceviewer
```

---

## SSL Setup with Nginx Proxy Manager

1. Make sure your domain (e.g. `race.yourdomain.com`) has a DNS **A record** pointing to your server's public IP
2. Start the stack: `docker compose up -d`
3. Open `http://<server-ip>:81` and log in (default: `admin@example.com` / `changeme`)
4. Go to **Proxy Hosts** -> **Add Proxy Host**:
   - **Domain:** `race.yourdomain.com`
   - **Forward Hostname:** `app`
   - **Forward Port:** `80`
5. Go to the **SSL** tab -> check **Request a new SSL Certificate** -> enable **Force SSL**
6. Save — done. Your dashboard is now available over HTTPS

---

## Project Structure

```
RingRaceViewer/
├── server.js                       # Express + Socket.io + REST API
├── bluetooth.js                    # Bluetooth speaker management module
├── package.json
├── Dockerfile
├── docker-compose.yml              # App + Nginx Proxy Manager
├── docker-compose.bluetooth.yml    # Override for Bluetooth-in-Docker
├── .env.example
├── .gitignore
├── data/                           # JSON database (auto-created)
│   └── db.json
├── public/
│   ├── index.html                  # Dashboard (kiosk display)
│   ├── admin.html                  # Admin panel (tablet control)
│   ├── assets/                     # Logo and uploaded files
│   │   └── logo.svg
│   ├── css/
│   │   └── style.css               # Full design system (CSS custom properties)
│   └── js/
│       ├── dashboard.js            # Dashboard logic + WebSocket client
│       ├── admin.js                # Admin panel logic (pure CSS Grid)
│       └── bluetooth.js            # Bluetooth speaker UI module
└── scripts/
    ├── install.sh                  # One-line Ubuntu install script
    ├── install-bootlogo.sh         # Plymouth boot logo installer
    ├── kiosk-setup.sh              # Standalone kiosk mode setup
    └── plymouth/                   # Plymouth theme files
        ├── ringraceviewer.plymouth
        └── ringraceviewer.script
```

---

## API Reference

### Sources
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/sources` | List all sources |
| `POST` | `/api/sources` | Create a source (`{ type, title, videoId/url }`) |
| `PUT` | `/api/sources/:id` | Update a source |
| `DELETE` | `/api/sources/:id` | Delete a source |

### Layouts
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/layouts` | List all layouts + active layout ID |
| `GET` | `/api/layouts/:id` | Get a single layout |
| `POST` | `/api/layouts` | Create a layout (`{ name }`) |
| `PUT` | `/api/layouts/:id` | Update a layout (including widgets) |
| `DELETE` | `/api/layouts/:id` | Delete a layout |
| `POST` | `/api/layouts/:id/activate` | Set as the active (live) layout |

### Displays
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/displays` | Get all display configurations |
| `POST` | `/api/displays` | Add a new display (`{ width, height }`) |
| `PUT` | `/api/displays/:num` | Update display resolution (`{ width, height }`) |
| `DELETE` | `/api/displays/:num` | Remove a display |

### Theme
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/theme` | Get current theme |
| `PUT` | `/api/theme` | Update theme colors |
| `POST` | `/api/logo` | Upload a logo image (binary body, `Content-Type: image/*`) |

### Audio
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/audio` | Get current audio source ID |
| `PUT` | `/api/audio` | Set audio source (`{ sourceId }` or `{ sourceId: null }` to mute) |

### Messages
| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/messages` | Broadcast a popup to all displays (`{ text, duration }`) |

### Live Timing (optional)
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/timing/status` | Connection status |
| `POST` | `/api/timing/connect` | Connect to timing WebSocket (`{ url }`) |
| `POST` | `/api/timing/disconnect` | Disconnect from timing |
| `POST` | `/api/timing/test` | Run test with sample N24h data |

### Kiosk
| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/kiosk/resync` | Re-detect monitors and restart Chromium kiosk |

### Bluetooth (optional)
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/bluetooth/status` | Overall BT status, paired devices, sinks |
| `POST` | `/api/bluetooth/scan` | Scan for nearby devices (`{ duration }`) |
| `POST` | `/api/bluetooth/pair` | Pair a device (`{ mac }`) |
| `POST` | `/api/bluetooth/connect` | Connect a paired device (`{ mac }`) |
| `POST` | `/api/bluetooth/disconnect` | Disconnect a device (`{ mac }`) |
| `POST` | `/api/bluetooth/remove` | Unpair/remove a device (`{ mac }`) |
| `GET` | `/api/bluetooth/sinks` | List Bluetooth audio sinks |
| `POST` | `/api/bluetooth/combine` | Combine all BT sinks into one output |
| `DELETE` | `/api/bluetooth/combine` | Remove the combined sink |
| `POST` | `/api/bluetooth/volume` | Set volume (`{ sink, volume }`) |

### WebSocket Events
| Event | Direction | Description |
|-------|-----------|-------------|
| `layout:activated` | Server -> Client | Active layout changed |
| `layout:updated` | Server -> Client | Current active layout was modified |
| `layouts:changed` | Server -> Client | Layout list changed |
| `sources:changed` | Server -> Client | Source list changed |
| `theme:changed` | Server -> Client | Theme updated |
| `displays:changed` | Server -> Client | Display config changed |
| `audio:changed` | Server -> Client | Audio source changed |
| `message:broadcast` | Server -> Client | Popup notification |
| `timing:update` | Server -> Client | Live timing leaderboard data |
| `timing:status` | Server -> Client | Timing connection status |
| `bluetooth:changed` | Server -> Client | Bluetooth state changed |

---

## Tech Stack

- **Backend:** Node.js 24, Express, Socket.io
- **Frontend:** Vanilla HTML/CSS/JS, CSS Grid
- **Storage:** JSON file (zero-dependency)
- **Bluetooth:** bluetoothctl (bluez), pactl (PipeWire/PulseAudio)
- **SSL:** Nginx Proxy Manager + Let's Encrypt
- **Containerization:** Docker, Docker Compose

---

## Tips for Race Day

- **YouTube Video IDs change frequently** during 24h races — the admin panel lets you update them in seconds from your phone
- **Save multiple layouts** — pre-build setups for qualifying, race start, night stint, etc.
- **Dark mode by default** — easy on the eyes during night stints in the paddock
- **Ctrl+S** saves the layout from the admin panel
- Use the **Race** preset for a main view + timing sidebar
- The dashboard auto-reconnects if the server restarts

---

## Development / Debug

### Install Node.js via nvm (Arch / CachyOS / Manjaro)

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
source ~/.bashrc
nvm install 24
nvm use 24
```

### Run locally

```bash
git clone https://github.com/stikkx/RingRaceViewer.git
cd RingRaceViewer
npm install
node server.js
```

Open `http://localhost` (port 80) or set a custom port with `PORT=3000 node server.js`.

### Run with file watcher (auto-restart on changes)

```bash
npm run dev
```

### Run via Docker (quick test)

```bash
docker build -t rrv . && docker run --rm -p 3000:80 -v ./data:/app/data rrv
```

Open `http://localhost:3000/admin`.

### Test Bluetooth (without speakers)

```bash
# Check if Bluetooth adapter is available
bluetoothctl show

# Start Bluetooth service if needed
sudo systemctl start bluetooth

# Test API endpoints
curl http://localhost/api/bluetooth/status
curl -X POST http://localhost/api/bluetooth/scan -H "Content-Type: application/json" -d '{"duration":5}'
```

If Bluetooth is not available, the admin panel shows "Bluetooth not available" gracefully.

### Test Live Timing

Open the admin panel, scroll to **Live Timing**, and click **Test**. This sends sample N24h race data through the notification pipeline:
- **2s** — Initial leaderboard loaded
- **2s** — New fastest lap popup
- **5s** — Lead change popup
- **8s** — Best sector popup

Watch the dashboard (`/?display=1`) for popup notifications.

### Test Audio

1. Add a YouTube source and assign it to a display
2. Click the speaker icon on the source card in the admin sidebar
3. The dashboard unmutes that stream (all others stay muted)
4. Click again to mute

### Useful API calls for debugging

```bash
# List all sources
curl http://localhost/api/sources

# List all layouts
curl http://localhost/api/layouts

# List displays
curl http://localhost/api/displays

# Current audio source
curl http://localhost/api/audio

# Send a message to all displays
curl -X POST http://localhost/api/messages \
  -H "Content-Type: application/json" \
  -d '{"text":"Hello from the paddock!","duration":30}'

# Resync kiosk monitors
curl -X POST http://localhost/api/kiosk/resync
```

### Logs

```bash
# Server logs (systemd)
sudo journalctl -u ringraceviewer -f

# Docker logs
docker logs -f ringraceviewer-app
```

---

## Like this project? Tip me a beer!

If RingRaceViewer made your race weekend better, consider buying me a cold one:

**[paypal.me/stikkx](https://paypal.me/stikkx)**

Cheers and happy racing!
