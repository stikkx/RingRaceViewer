const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 80;
const DB_PATH = path.join(__dirname, 'data', 'db.json');

// --- JSON File Database ---

function readDB() {
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  } catch {
    const defaults = {
      sources: [
        { id: 'demo-yt', type: 'youtube', title: 'Demo Stream', videoId: 'dQw4w9WgXcQ' },
        { id: 'demo-web', type: 'webpage', title: 'Nürburgring Live Timing', url: 'https://live-timing.nuerburgring.de' }
      ],
      layouts: [{
        id: 'default',
        name: 'Default Layout',
        widgets: []
      }],
      activeLayoutId: 'default',
      displays: {
        '1': { width: 1920, height: 1080 }
      },
      theme: {
        primaryColor: '#e10600',
        accentColor: '#ff6b35',
        backgroundColor: '#0a0a0f',
        surfaceColor: '#141420',
        textColor: '#e0e0e0',
        logoUrl: ''
      }
    };
    writeDB(defaults);
    return defaults;
  }
}

function writeDB(data) {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

function genId() {
  return crypto.randomBytes(8).toString('hex');
}

// --- Middleware ---

app.use(express.json());
// Disable caching for development so browser always gets latest files
app.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});
app.use(express.static(path.join(__dirname, 'public')));

// Short URL redirects
app.get('/admin', (_req, res) => res.redirect('/admin.html'));

// --- API: Sources ---

app.get('/api/sources', (_req, res) => {
  res.json(readDB().sources);
});

app.post('/api/sources', (req, res) => {
  const db = readDB();
  const source = { id: genId(), ...req.body };
  db.sources.push(source);
  writeDB(db);
  io.emit('sources:changed', db.sources);
  res.status(201).json(source);
});

app.put('/api/sources/:id', (req, res) => {
  const db = readDB();
  const idx = db.sources.findIndex(s => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  db.sources[idx] = { ...db.sources[idx], ...req.body };
  writeDB(db);
  io.emit('sources:changed', db.sources);
  res.json(db.sources[idx]);
});

app.delete('/api/sources/:id', (req, res) => {
  const db = readDB();
  db.sources = db.sources.filter(s => s.id !== req.params.id);
  writeDB(db);
  io.emit('sources:changed', db.sources);
  res.status(204).end();
});

// --- API: Layouts ---

app.get('/api/layouts', (_req, res) => {
  const db = readDB();
  res.json({ layouts: db.layouts, activeLayoutId: db.activeLayoutId });
});

app.get('/api/layouts/:id', (req, res) => {
  const db = readDB();
  const layout = db.layouts.find(l => l.id === req.params.id);
  if (!layout) return res.status(404).json({ error: 'Not found' });
  res.json(layout);
});

app.post('/api/layouts', (req, res) => {
  const db = readDB();
  const layout = { id: genId(), name: req.body.name || 'New Layout', widgets: [] };
  db.layouts.push(layout);
  writeDB(db);
  io.emit('layouts:changed', { layouts: db.layouts, activeLayoutId: db.activeLayoutId });
  res.status(201).json(layout);
});

app.put('/api/layouts/:id', (req, res) => {
  const db = readDB();
  const idx = db.layouts.findIndex(l => l.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  db.layouts[idx] = { ...db.layouts[idx], ...req.body };
  writeDB(db);
  if (db.activeLayoutId === req.params.id) {
    io.emit('layout:updated', db.layouts[idx]);
  }
  io.emit('layouts:changed', { layouts: db.layouts, activeLayoutId: db.activeLayoutId });
  res.json(db.layouts[idx]);
});

app.delete('/api/layouts/:id', (req, res) => {
  const db = readDB();
  if (req.params.id === 'default') return res.status(400).json({ error: 'Cannot delete default layout' });
  db.layouts = db.layouts.filter(l => l.id !== req.params.id);
  if (db.activeLayoutId === req.params.id) db.activeLayoutId = 'default';
  writeDB(db);
  io.emit('layouts:changed', { layouts: db.layouts, activeLayoutId: db.activeLayoutId });
  res.status(204).end();
});

app.post('/api/layouts/:id/activate', (req, res) => {
  const db = readDB();
  const layout = db.layouts.find(l => l.id === req.params.id);
  if (!layout) return res.status(404).json({ error: 'Not found' });
  db.activeLayoutId = req.params.id;
  writeDB(db);
  io.emit('layout:activated', layout);
  res.json(layout);
});

// --- API: Displays (dynamic) ---

app.get('/api/displays', (_req, res) => {
  const db = readDB();
  if (!db.displays) { db.displays = { '1': { width: 1920, height: 1080 } }; writeDB(db); }
  res.json(db.displays);
});

app.post('/api/displays', (req, res) => {
  const db = readDB();
  if (!db.displays) db.displays = {};
  const nums = Object.keys(db.displays).map(Number);
  const next = String((nums.length > 0 ? Math.max(...nums) : 0) + 1);
  const width = Math.max(640, Math.min(7680, parseInt(req.body.width) || 1920));
  const height = Math.max(480, Math.min(4320, parseInt(req.body.height) || 1080));
  db.displays[next] = { width, height };
  writeDB(db);
  io.emit('displays:changed', db.displays);
  res.status(201).json({ id: next, ...db.displays[next] });
});

app.put('/api/displays/:num', (req, res) => {
  const db = readDB();
  if (!db.displays) db.displays = {};
  const num = req.params.num;
  const width = Math.max(640, Math.min(7680, parseInt(req.body.width) || 1920));
  const height = Math.max(480, Math.min(4320, parseInt(req.body.height) || 1080));
  db.displays[num] = { width, height };
  writeDB(db);
  io.emit('displays:changed', db.displays);
  res.json(db.displays[num]);
});

app.delete('/api/displays/:num', (req, res) => {
  const db = readDB();
  const num = req.params.num;
  if (!db.displays || !db.displays[num]) return res.status(404).json({ error: 'Display not found' });
  if (Object.keys(db.displays).length <= 1) return res.status(400).json({ error: 'Must keep at least one display' });
  delete db.displays[num];
  // Remove widgets assigned to this display from all layouts
  db.layouts.forEach(l => { l.widgets = (l.widgets || []).filter(w => String(w.display) !== num); });
  writeDB(db);
  io.emit('displays:changed', db.displays);
  res.status(204).end();
});

// --- API: Theme ---

app.get('/api/theme', (_req, res) => {
  res.json(readDB().theme);
});

app.put('/api/theme', (req, res) => {
  const db = readDB();
  db.theme = { ...db.theme, ...req.body };
  writeDB(db);
  io.emit('theme:changed', db.theme);
  res.json(db.theme);
});

// --- API: Logo upload ---

app.post('/api/logo', express.raw({ type: 'image/*', limit: '2mb' }), (req, res) => {
  const ext = (req.headers['content-type'] || 'image/png').split('/')[1] || 'png';
  const filename = `logo.${ext}`;
  const filepath = path.join(__dirname, 'public', 'assets', filename);
  fs.writeFileSync(filepath, req.body);
  const db = readDB();
  db.theme.logoUrl = `/assets/${filename}`;
  writeDB(db);
  io.emit('theme:changed', db.theme);
  res.json({ logoUrl: db.theme.logoUrl });
});

// --- API: Audio (unmute one source at a time) ---

let audioSourceId = null;

app.get('/api/audio', (_req, res) => {
  res.json({ sourceId: audioSourceId });
});

app.put('/api/audio', (req, res) => {
  audioSourceId = req.body.sourceId || null;
  io.emit('audio:changed', { sourceId: audioSourceId });
  res.json({ sourceId: audioSourceId });
});

// --- API: Extension toggle ---

let extensionEnabled = true;

app.get('/api/extension', (_req, res) => {
  res.json({ enabled: extensionEnabled });
});

app.put('/api/extension', (req, res) => {
  extensionEnabled = !!req.body.enabled;
  io.emit('extension:changed', { enabled: extensionEnabled });
  res.json({ enabled: extensionEnabled });
});

// --- API: Messages (broadcast notifications to displays) ---

app.post('/api/messages', (req, res) => {
  const { text, duration } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: 'Text is required' });
  const message = {
    id: genId(),
    text: text.trim(),
    duration: Math.max(5, Math.min(300, parseInt(duration) || 30)),
    timestamp: Date.now()
  };
  io.emit('message:broadcast', message);
  res.status(201).json(message);
});

// --- API: Kiosk resync (re-detect monitors + restart Chromium) ---

app.post('/api/kiosk/resync', (_req, res) => {
  const { exec } = require('child_process');
  const user = process.env.SUDO_USER || process.env.USER || 'root';
  const kioskScript = `/home/${user}/.local/bin/ringraceviewer-kiosk.sh`;

  // Check if kiosk script exists
  if (!fs.existsSync(kioskScript)) {
    return res.status(404).json({ error: 'Kiosk script not found. Run the install script first.' });
  }

  // Run the kiosk script with X11 display access
  const env = { ...process.env, DISPLAY: ':0' };
  exec(`bash "${kioskScript}"`, { env, timeout: 30000 }, (err, stdout, stderr) => {
    if (err) {
      console.log(`Kiosk resync error: ${err.message}`);
      return res.status(500).json({ error: err.message, stderr });
    }
    console.log(`Kiosk resync:\n${stdout}`);
    res.json({ status: 'ok', output: stdout });
  });
});

// --- Bluetooth (optional add-on) ---

const bluetooth = require('./bluetooth');
app.use('/api/bluetooth', bluetooth.createRouter(io));

// --- Live Timing ---

try {
  const livetiming = require('./livetiming');
  app.use('/api/timing', livetiming.createTimingClient(io));
  console.log('  Timing: module loaded');
} catch (e) {
  console.log('  Timing: not available (ws not installed)');
}

// --- WebSocket ---

io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);
  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
  });
});

// --- mDNS (rrv.local) ---

const MDNS_NAME = process.env.MDNS_NAME || 'rrv';

try {
  const mdns = require('multicast-dns')();
  const os = require('os');

  function getLocalIPs() {
    const ips = [];
    const ifaces = os.networkInterfaces();
    for (const name of Object.keys(ifaces)) {
      for (const iface of ifaces[name]) {
        if (!iface.internal && iface.family === 'IPv4') ips.push(iface.address);
      }
    }
    return ips;
  }

  mdns.on('query', (query) => {
    const fullName = `${MDNS_NAME}.local`;
    for (const q of query.questions) {
      if (q.name === fullName && (q.type === 'A' || q.type === 'ANY')) {
        const ips = getLocalIPs();
        mdns.respond({
          answers: ips.map(ip => ({ name: fullName, type: 'A', ttl: 120, data: ip })),
        });
      }
    }
  });

  console.log(`  mDNS:  ${MDNS_NAME}.local`);
} catch (e) {
  console.log('  mDNS:  not available (multicast-dns not installed)');
}

// --- Start ---

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  🏎️  RingRaceViewer running on port ${PORT}`);
  console.log(`     Dashboard: http://${MDNS_NAME}.local:${PORT}`);
  console.log(`     Admin:     http://${MDNS_NAME}.local:${PORT}/admin\n`);
});
