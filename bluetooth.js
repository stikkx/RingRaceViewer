/* RingRaceViewer — Bluetooth Speaker Management
   Wraps bluetoothctl and PipeWire/PulseAudio for multi-speaker output.
   This module is optional — if bluetoothctl is not available, all
   endpoints return graceful errors and the feature is disabled. */

const { exec, spawn } = require('child_process');

// --- Helpers ---

function run(cmd, timeout = 10000) {
  return new Promise((resolve, reject) => {
    exec(cmd, { timeout }, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message));
      resolve(stdout.trim());
    });
  });
}

let btAvailable = null;

async function checkAvailable() {
  if (btAvailable !== null) return btAvailable;
  try {
    await run('which bluetoothctl');
    btAvailable = true;
  } catch {
    btAvailable = false;
  }
  return btAvailable;
}

// --- bluetoothctl parsing ---

function parseDevices(output) {
  // Lines like: "Device AA:BB:CC:DD:EE:FF DeviceName"
  const devices = [];
  for (const line of output.split('\n')) {
    const match = line.match(/Device\s+([0-9A-F:]{17})\s+(.+)/i);
    if (match) {
      devices.push({ mac: match[1], name: match[2].trim() });
    }
  }
  return devices;
}

// --- Scan ---

async function scanDevices(durationSec = 8) {
  // Start scan, wait, then collect results
  // We use a short-lived bluetoothctl process for the scan
  return new Promise((resolve, reject) => {
    const results = [];
    const proc = spawn('bluetoothctl', [], { stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '';

    proc.stdout.on('data', (data) => { output += data.toString(); });
    proc.stderr.on('data', (data) => { output += data.toString(); });

    proc.stdin.write('scan on\n');

    setTimeout(() => {
      proc.stdin.write('scan off\n');
      setTimeout(() => {
        proc.stdin.write('devices\n');
        setTimeout(() => {
          proc.stdin.write('quit\n');
        }, 500);
      }, 500);
    }, durationSec * 1000);

    proc.on('close', () => {
      resolve(parseDevices(output));
    });

    proc.on('error', reject);

    setTimeout(() => {
      try { proc.kill(); } catch {}
      reject(new Error('Scan timed out'));
    }, (durationSec + 5) * 1000);
  });
}

// --- Device info ---

async function getDeviceInfo(mac) {
  try {
    const output = await run(`bluetoothctl info ${mac}`);
    const info = { mac, name: '', paired: false, trusted: false, connected: false, icon: '' };

    for (const line of output.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('Name:'))      info.name = trimmed.slice(5).trim();
      if (trimmed.startsWith('Alias:') && !info.name) info.name = trimmed.slice(6).trim();
      if (trimmed.startsWith('Paired:'))    info.paired = trimmed.includes('yes');
      if (trimmed.startsWith('Trusted:'))   info.trusted = trimmed.includes('yes');
      if (trimmed.startsWith('Connected:')) info.connected = trimmed.includes('yes');
      if (trimmed.startsWith('Icon:'))      info.icon = trimmed.slice(5).trim();
    }
    return info;
  } catch {
    return null;
  }
}

// --- Paired devices ---

async function getPairedDevices() {
  const output = await run('bluetoothctl devices Paired');
  return parseDevices(output);
}

// --- All known devices ---

async function getKnownDevices() {
  const output = await run('bluetoothctl devices');
  return parseDevices(output);
}

// --- Connect / Disconnect / Pair / Trust / Remove ---

async function pairDevice(mac) {
  await run(`bluetoothctl pair ${mac}`, 20000);
}

async function trustDevice(mac) {
  await run(`bluetoothctl trust ${mac}`);
}

async function connectDevice(mac) {
  await run(`bluetoothctl connect ${mac}`, 15000);
}

async function disconnectDevice(mac) {
  await run(`bluetoothctl disconnect ${mac}`);
}

async function removeDevice(mac) {
  await run(`bluetoothctl remove ${mac}`);
}

// --- PipeWire / PulseAudio combined sink ---

async function getAudioSinks() {
  try {
    const output = await run('pactl list sinks short');
    const sinks = [];
    for (const line of output.split('\n')) {
      if (!line.trim()) continue;
      const parts = line.split('\t');
      sinks.push({
        id: parts[0],
        name: parts[1],
        driver: parts[2] || '',
        format: parts[3] || '',
        state: parts[4] || '',
      });
    }
    return sinks;
  } catch {
    return [];
  }
}

async function getBluetoothSinks() {
  const all = await getAudioSinks();
  return all.filter(s => s.name.includes('bluez') || s.name.includes('bluetooth'));
}

async function getCombinedSink() {
  const all = await getAudioSinks();
  return all.find(s => s.name.includes('combined') || s.name.includes('ringraceviewer'));
}

async function createCombinedSink(sinkNames) {
  if (sinkNames.length === 0) {
    throw new Error('No sinks to combine');
  }

  // Remove existing combined sink first
  await destroyCombinedSink();

  if (sinkNames.length === 1) {
    // Only one speaker — just set it as default
    await run(`pactl set-default-sink ${sinkNames[0]}`);
    return { type: 'single', sink: sinkNames[0] };
  }

  // Create a combine-sink module
  const slaves = sinkNames.join(',');
  const output = await run(
    `pactl load-module module-combine-sink sink_name=ringraceviewer_combined sink_properties=device.description=RingRaceViewer slaves=${slaves}`
  );

  // Set as default
  await run('pactl set-default-sink ringraceviewer_combined');

  return { type: 'combined', moduleId: output.trim(), slaves: sinkNames };
}

async function destroyCombinedSink() {
  try {
    // Find and unload our combined sink module
    const output = await run('pactl list modules short');
    for (const line of output.split('\n')) {
      if (line.includes('ringraceviewer_combined')) {
        const moduleId = line.split('\t')[0];
        await run(`pactl unload-module ${moduleId}`);
      }
    }
  } catch {
    // Ignore — module might not exist
  }
}

// --- Volume ---

async function setVolume(sinkName, volumePercent) {
  const vol = Math.max(0, Math.min(150, parseInt(volumePercent)));
  await run(`pactl set-sink-volume ${sinkName} ${vol}%`);
}

async function getVolume(sinkName) {
  try {
    const output = await run(`pactl get-sink-volume ${sinkName}`);
    const match = output.match(/(\d+)%/);
    return match ? parseInt(match[1]) : 100;
  } catch {
    return 100;
  }
}

// --- Express router factory ---

function createRouter(io) {
  const express = require('express');
  const router = express.Router();

  // Middleware: check if bluetooth is available
  router.use(async (_req, res, next) => {
    if (!(await checkAvailable())) {
      return res.status(503).json({
        error: 'Bluetooth not available',
        detail: 'bluetoothctl not found. Install bluez and run the server on the host (not in Docker without BT access).'
      });
    }
    next();
  });

  // GET /api/bluetooth/status — overall status
  router.get('/status', async (_req, res) => {
    try {
      const paired = await getPairedDevices();
      const enriched = await Promise.all(paired.map(d => getDeviceInfo(d.mac)));
      const btSinks = await getBluetoothSinks();
      const combined = await getCombinedSink();
      res.json({
        available: true,
        paired: enriched.filter(Boolean),
        sinks: btSinks,
        combinedSink: combined || null,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/bluetooth/scan — start scan and return found devices
  router.post('/scan', async (req, res) => {
    try {
      const duration = Math.min(15, Math.max(3, parseInt(req.body.duration) || 8));
      const devices = await scanDevices(duration);
      res.json(devices);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/bluetooth/pair
  router.post('/pair', async (req, res) => {
    const { mac } = req.body;
    if (!mac) return res.status(400).json({ error: 'mac required' });
    try {
      await trustDevice(mac);
      await pairDevice(mac);
      const info = await getDeviceInfo(mac);
      io.emit('bluetooth:changed');
      res.json(info);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/bluetooth/connect
  router.post('/connect', async (req, res) => {
    const { mac } = req.body;
    if (!mac) return res.status(400).json({ error: 'mac required' });
    try {
      await trustDevice(mac);
      await connectDevice(mac);
      // Wait a moment for the audio sink to appear
      await new Promise(r => setTimeout(r, 2000));
      const info = await getDeviceInfo(mac);
      io.emit('bluetooth:changed');
      res.json(info);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/bluetooth/disconnect
  router.post('/disconnect', async (req, res) => {
    const { mac } = req.body;
    if (!mac) return res.status(400).json({ error: 'mac required' });
    try {
      await disconnectDevice(mac);
      io.emit('bluetooth:changed');
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/bluetooth/remove — unpair device
  router.post('/remove', async (req, res) => {
    const { mac } = req.body;
    if (!mac) return res.status(400).json({ error: 'mac required' });
    try {
      await removeDevice(mac);
      io.emit('bluetooth:changed');
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/bluetooth/sinks — list all bluetooth audio sinks
  router.get('/sinks', async (_req, res) => {
    try {
      const sinks = await getBluetoothSinks();
      const combined = await getCombinedSink();
      res.json({ sinks, combinedSink: combined || null });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/bluetooth/combine — create combined sink from connected BT speakers
  router.post('/combine', async (req, res) => {
    try {
      const sinks = await getBluetoothSinks();
      const sinkNames = (req.body.sinks || []).length > 0
        ? req.body.sinks
        : sinks.map(s => s.name);

      if (sinkNames.length === 0) {
        return res.status(400).json({ error: 'No Bluetooth speakers connected' });
      }

      const result = await createCombinedSink(sinkNames);
      io.emit('bluetooth:changed');
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /api/bluetooth/combine — remove combined sink
  router.delete('/combine', async (_req, res) => {
    try {
      await destroyCombinedSink();
      io.emit('bluetooth:changed');
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/bluetooth/volume
  router.post('/volume', async (req, res) => {
    const { sink, volume } = req.body;
    if (!sink) return res.status(400).json({ error: 'sink name required' });
    try {
      await setVolume(sink, volume);
      io.emit('bluetooth:changed');
      res.json({ sink, volume: parseInt(volume) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

module.exports = { createRouter, checkAvailable };
