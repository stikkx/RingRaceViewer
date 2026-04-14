const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
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
  const num = req.params.num;
  if (!db.displays || !db.displays[num]) return res.status(404).json({ error: 'Display not found' });
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

// --- Bluetooth (optional add-on) ---

const bluetooth = require('./bluetooth');
app.use('/api/bluetooth', bluetooth.createRouter(io));

// --- WebSocket ---

io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);
  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
  });
});

// --- Start ---

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  🏎️  RingRaceViewer running on port ${PORT}`);
  console.log(`     Dashboard: http://localhost:${PORT}`);
  console.log(`     Admin:     http://localhost:${PORT}/admin.html\n`);
});
