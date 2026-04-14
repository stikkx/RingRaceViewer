/* RingRaceViewer — Bluetooth Speaker UI Module
   Loaded by admin.html as additional, optional feature.
   Attaches to the global RRV namespace set by admin.js. */

(function () {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const socket = io();
  let btAvailable = false;
  let scanning = false;
  let pairedDevices = [];
  let scannedDevices = [];
  let btSinks = [];
  let combinedSink = null;

  // --- DOM refs ---
  const btSection   = $('#bt-section');
  const btStatus    = $('#bt-status');
  const btPaired    = $('#bt-paired-list');
  const btScanned   = $('#bt-scanned-list');
  const btnScan     = $('#btn-bt-scan');
  const btnCombine  = $('#btn-bt-combine');
  const btnUncombine = $('#btn-bt-uncombine');
  const btUnavail   = $('#bt-unavailable');
  const btContent   = $('#bt-content');

  if (!btSection) return; // Bluetooth UI not in DOM

  // --- Toast (re-use admin's container) ---

  function toast(msg, type = '') {
    const container = $('#toast-container');
    if (!container) return;
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = msg;
    container.appendChild(el);
    setTimeout(() => el.remove(), 3000);
  }

  // --- Render ---

  function render() {
    if (!btAvailable) {
      btUnavail.style.display = '';
      btContent.style.display = 'none';
      return;
    }
    btUnavail.style.display = 'none';
    btContent.style.display = '';

    // Paired devices
    btPaired.innerHTML = '';
    if (pairedDevices.length === 0) {
      btPaired.innerHTML = '<div class="bt-empty">No paired speakers</div>';
    } else {
      pairedDevices.forEach(dev => {
        const el = document.createElement('div');
        el.className = `bt-device ${dev.connected ? 'connected' : ''}`;
        el.innerHTML = `
          <div class="bt-device-icon">${dev.icon === 'audio-headset' || dev.icon === 'audio-headphones' ? '&#127911;' : '&#128264;'}</div>
          <div class="bt-device-info">
            <div class="bt-device-name">${escHtml(dev.name || dev.mac)}</div>
            <div class="bt-device-mac">${dev.mac}</div>
            <div class="bt-device-state">${dev.connected ? 'Connected' : 'Paired'}</div>
          </div>
          <div class="bt-device-actions">
            ${dev.connected
              ? `<button class="btn btn-sm bt-btn-disconnect" data-mac="${dev.mac}">Disconnect</button>`
              : `<button class="btn btn-sm btn-primary bt-btn-connect" data-mac="${dev.mac}">Connect</button>`
            }
            <button class="btn btn-sm bt-btn-remove" data-mac="${dev.mac}" title="Remove">&times;</button>
          </div>
        `;
        btPaired.appendChild(el);
      });
    }

    // Scanned devices (filter out already paired)
    const pairedMacs = new Set(pairedDevices.map(d => d.mac));
    const newDevices = scannedDevices.filter(d => !pairedMacs.has(d.mac));

    btScanned.innerHTML = '';
    if (scanning) {
      btScanned.innerHTML = '<div class="bt-scanning"><span class="bt-spinner"></span> Scanning...</div>';
    } else if (newDevices.length === 0) {
      btScanned.innerHTML = '<div class="bt-empty">No new devices found. Hit Scan to search.</div>';
    }

    newDevices.forEach(dev => {
      const el = document.createElement('div');
      el.className = 'bt-device new';
      el.innerHTML = `
        <div class="bt-device-icon">&#128246;</div>
        <div class="bt-device-info">
          <div class="bt-device-name">${escHtml(dev.name || dev.mac)}</div>
          <div class="bt-device-mac">${dev.mac}</div>
        </div>
        <div class="bt-device-actions">
          <button class="btn btn-sm btn-primary bt-btn-pair" data-mac="${dev.mac}">Pair</button>
        </div>
      `;
      btScanned.appendChild(el);
    });

    // Combine button state
    const connectedCount = pairedDevices.filter(d => d.connected).length;
    btnCombine.disabled = connectedCount === 0;
    btnCombine.textContent = connectedCount > 1
      ? `Combine ${connectedCount} Speakers`
      : connectedCount === 1 ? 'Set as Output' : 'Combine Speakers';
    btnUncombine.style.display = combinedSink ? '' : 'none';

    // Scan button
    btnScan.disabled = scanning;
    btnScan.textContent = scanning ? 'Scanning...' : 'Scan';

    // Wire up action buttons
    btPaired.querySelectorAll('.bt-btn-connect').forEach(btn =>
      btn.addEventListener('click', () => connectDevice(btn.dataset.mac)));
    btPaired.querySelectorAll('.bt-btn-disconnect').forEach(btn =>
      btn.addEventListener('click', () => disconnectDevice(btn.dataset.mac)));
    btPaired.querySelectorAll('.bt-btn-remove').forEach(btn =>
      btn.addEventListener('click', () => removeDevice(btn.dataset.mac)));
    btScanned.querySelectorAll('.bt-btn-pair').forEach(btn =>
      btn.addEventListener('click', () => pairDevice(btn.dataset.mac)));
  }

  function escHtml(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  // --- API calls ---

  async function loadStatus() {
    try {
      const res = await fetch('/api/bluetooth/status');
      if (res.status === 503) {
        btAvailable = false;
        render();
        return;
      }
      const data = await res.json();
      btAvailable = data.available;
      pairedDevices = data.paired || [];
      btSinks = data.sinks || [];
      combinedSink = data.combinedSink;
      render();
    } catch {
      btAvailable = false;
      render();
    }
  }

  async function startScan() {
    scanning = true;
    scannedDevices = [];
    render();
    try {
      const res = await fetch('/api/bluetooth/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ duration: 8 }),
      });
      scannedDevices = await res.json();
    } catch (err) {
      toast('Scan failed: ' + err.message, 'error');
    }
    scanning = false;
    render();
  }

  async function pairDevice(mac) {
    toast('Pairing...', '');
    try {
      await fetch('/api/bluetooth/pair', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mac }),
      });
      toast('Paired successfully', 'success');
      await loadStatus();
    } catch (err) {
      toast('Pair failed: ' + err.message, 'error');
    }
  }

  async function connectDevice(mac) {
    toast('Connecting...', '');
    try {
      await fetch('/api/bluetooth/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mac }),
      });
      toast('Connected', 'success');
      await loadStatus();
    } catch (err) {
      toast('Connect failed: ' + err.message, 'error');
    }
  }

  async function disconnectDevice(mac) {
    try {
      await fetch('/api/bluetooth/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mac }),
      });
      toast('Disconnected', 'success');
      await loadStatus();
    } catch (err) {
      toast('Disconnect failed: ' + err.message, 'error');
    }
  }

  async function removeDevice(mac) {
    const dev = pairedDevices.find(d => d.mac === mac);
    const name = dev ? dev.name || dev.mac : mac;
    if (!confirm(`Remove "${name}"? You will need to pair again.`)) return;
    try {
      await fetch('/api/bluetooth/remove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mac }),
      });
      toast('Device removed', 'success');
      await loadStatus();
    } catch (err) {
      toast('Remove failed: ' + err.message, 'error');
    }
  }

  async function combineSpeakers() {
    try {
      const res = await fetch('/api/bluetooth/combine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (data.error) { toast(data.error, 'error'); return; }
      toast(data.type === 'combined' ? 'Speakers combined!' : 'Output set', 'success');
      await loadStatus();
    } catch (err) {
      toast('Combine failed: ' + err.message, 'error');
    }
  }

  async function uncombineSpeakers() {
    try {
      await fetch('/api/bluetooth/combine', { method: 'DELETE' });
      toast('Combined sink removed', 'success');
      await loadStatus();
    } catch (err) {
      toast('Failed: ' + err.message, 'error');
    }
  }

  // --- Events ---

  btnScan.addEventListener('click', startScan);
  btnCombine.addEventListener('click', combineSpeakers);
  btnUncombine.addEventListener('click', uncombineSpeakers);

  socket.on('bluetooth:changed', () => loadStatus());

  // --- Init ---

  loadStatus();
})();
