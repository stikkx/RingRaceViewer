# RingRaceViewer

A real-time, remote-controlled multi-display dashboard built for endurance racing events like the Nurburgring 24h. Run it on an Ubuntu thin client, control it from your tablet, and display YouTube onboard streams and live timing pages on big screens in the paddock.

---

## Features

### Dashboard Display (`/`)
- Full-screen kiosk view designed for large monitors
- Renders YouTube streams and web pages as iframes in a configurable grid
- Supports **two independent displays** — each monitor loads `/?display=1` or `/?display=2`
- Updates instantly via WebSocket when the layout changes — no manual refresh needed
- Optional logo watermark in the corner

### Admin Panel (`/admin.html`)
- **Tablet-friendly** control interface — dark mode, touch-optimized, works on any device in the same network
- **Source Management** — add YouTube streams (just paste the video ID) or any web page URL. Edit or delete sources on the fly
- **Grid Layout Editor** — two Gridstack.js grids representing Display 1 and Display 2. Click a source to add it to Display 1, double-click for Display 2. Drag and resize widgets freely
- **Multiple Layouts** — create, save, and switch between different layout presets (e.g. "Qualifying", "Race Day", "Night Setup")
- **Go Live** — one button push activates the layout on all connected displays in real-time
- **Configurable Display Resolution** — set the exact width and height per display. The admin grid preview matches the real aspect ratio so what you see is what you get
- **Theme Editor** — change all colors (primary, accent, background, surface, text) with live color pickers. Changes push to all displays instantly
- **Logo Upload** — upload your team or event logo. It appears in the admin header and as a watermark on the dashboard
- **Bluetooth Speaker Management** — scan, pair, connect, and combine multiple Bluetooth speakers for audio output (see below)
- **Keyboard shortcut** — `Ctrl+S` to save the current layout

### Bluetooth Multi-Speaker Support
- Manage Bluetooth speakers directly from the admin panel sidebar
- **Scan** for nearby Bluetooth devices
- **Pair & Connect** speakers with one tap
- **Combine multiple speakers** — routes audio to all connected BT speakers simultaneously using PipeWire/PulseAudio `module-combine-sink`
- **Graceful degradation** — if Bluetooth isn't available (e.g. running in Docker without BT access), the section shows a friendly "not available" message instead of breaking

### Persistence
- All data (sources, layouts, theme, display config) is stored in a single JSON file (`data/db.json`)
- Survives reboots and power outages — no database server needed

### SSL / DNS (Nginx Proxy Manager)
- Docker Compose includes [Nginx Proxy Manager](https://nginxproxymanager.com/) for easy SSL setup
- Point your domain's DNS A record to the server, then configure the proxy host and request a free Let's Encrypt certificate — all through a web UI on port 81

---

## Quick Start

### Option 1: Run directly on the host (recommended for Bluetooth)

```bash
# Install Node.js (Ubuntu/Debian)
sudo apt install nodejs npm

# Or on Arch/CachyOS
sudo pacman -S nodejs npm

# Install dependencies
cd RingRaceViewer
npm install

# Start
node server.js
```

Open in your browser:
- **Dashboard:** `http://localhost:3000/?display=1`
- **Admin Panel:** `http://localhost:3000/admin.html`

### Option 2: Docker (no Bluetooth)

```bash
docker compose up -d
```

- **Dashboard:** `http://localhost:3000`
- **Admin Panel:** `http://localhost:3000/admin.html`
- **Nginx Proxy Manager:** `http://localhost:81` (default login: `admin@example.com` / `changeme`)

### Option 3: Docker with Bluetooth

```bash
docker compose -f docker-compose.yml -f docker-compose.bluetooth.yml up -d
```

This gives the container access to the host's Bluetooth adapter and audio system. Requires `bluez` and PipeWire/PulseAudio running on the host.

---

## Kiosk Mode Setup (Ubuntu Thin Client)

The included setup script configures auto-login and launches Chromium in kiosk mode on both monitors at boot:

```bash
sudo bash scripts/kiosk-setup.sh http://localhost:3000
```

This will:
1. Install Chromium and `unclutter` (auto-hides the mouse cursor)
2. Configure GDM auto-login
3. Create an autostart entry that launches two Chromium instances:
   - Monitor 1: `http://localhost:3000/?display=1` at position `0,0`
   - Monitor 2: `http://localhost:3000/?display=2` at position `1920,0`

To test immediately without rebooting:

```bash
bash ~/.local/bin/ringraceviewer-kiosk.sh
```

---

## SSL Setup with Nginx Proxy Manager

1. Make sure your domain (e.g. `race.yourdomain.com`) has a DNS **A record** pointing to your server's public IP
2. Start the stack: `docker compose up -d`
3. Open `http://<server-ip>:81` and log in (default: `admin@example.com` / `changeme`)
4. Go to **Proxy Hosts** → **Add Proxy Host**:
   - **Domain:** `race.yourdomain.com`
   - **Forward Hostname:** `app`
   - **Forward Port:** `3000`
5. Go to the **SSL** tab → check **Request a new SSL Certificate** → enable **Force SSL**
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
│   ├── assets/                     # Uploaded logos
│   ├── css/
│   │   └── style.css               # Full design system (CSS custom properties)
│   └── js/
│       ├── dashboard.js            # Dashboard logic + WebSocket client
│       ├── admin.js                # Admin panel logic
│       └── bluetooth.js            # Bluetooth speaker UI module
└── scripts/
    └── kiosk-setup.sh              # Ubuntu kiosk auto-setup
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
| `GET` | `/api/displays` | Get display configurations |
| `PUT` | `/api/displays/:num` | Set display resolution (`{ width, height }`) |

### Theme
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/theme` | Get current theme |
| `PUT` | `/api/theme` | Update theme colors |
| `POST` | `/api/logo` | Upload a logo image (binary body, `Content-Type: image/*`) |

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
| `layout:activated` | Server → Client | Active layout changed |
| `layout:updated` | Server → Client | Current active layout was modified |
| `layouts:changed` | Server → Client | Layout list changed |
| `sources:changed` | Server → Client | Source list changed |
| `theme:changed` | Server → Client | Theme updated |
| `displays:changed` | Server → Client | Display config changed |
| `bluetooth:changed` | Server → Client | Bluetooth state changed |

---

## Tech Stack

- **Backend:** Node.js, Express, Socket.io
- **Frontend:** Vanilla HTML/CSS/JS, Gridstack.js (CDN)
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
- Click a source card to add it to Display 1, double-click for Display 2
- The dashboard auto-reconnects if the server restarts

---

## Like this project? Tip me a beer!

If RingRaceViewer made your race weekend better, consider buying me a cold one:

**[paypal.me/stikkx](https://paypal.me/stikkx)**

Cheers and happy racing!
