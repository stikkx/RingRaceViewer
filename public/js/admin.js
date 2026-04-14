/* RingRaceViewer — Admin Panel
   Pure CSS Grid layout — no external grid library */

(function () {
  'use strict';

  const socket = io();

  let sources = [];
  let layouts = [];
  let activeLayoutId = 'default';
  let currentLayoutId = 'default';
  let displays = {};

  // Per-display state: { '1': { widgets: [{sourceId, id}], preset, split } }
  const displayState = {};

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const layoutSelect      = $('#layout-select');
  const sourceList        = $('#source-list');
  const statusDot         = $('#status-dot');
  const toastContainer    = $('#toast-container');
  const displaysContainer = $('#displays-container');

  function toast(msg, type = '') {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = msg;
    toastContainer.appendChild(el);
    setTimeout(() => el.remove(), 3000);
  }

  // --- Theme ---

  function applyTheme(theme) {
    if (!theme) return;
    const r = document.documentElement.style;
    if (theme.primaryColor)    r.setProperty('--primary', theme.primaryColor);
    if (theme.accentColor)     r.setProperty('--accent', theme.accentColor);
    if (theme.backgroundColor) r.setProperty('--bg', theme.backgroundColor);
    if (theme.surfaceColor)    r.setProperty('--surface', theme.surfaceColor);
    if (theme.textColor)       r.setProperty('--text', theme.textColor);
    $$('[data-theme]').forEach(i => { if (theme[i.dataset.theme]) i.value = theme[i.dataset.theme]; });
    const hl = $('#header-logo'), lp = $('#logo-preview');
    if (theme.logoUrl) { hl.src = theme.logoUrl; hl.style.display = 'block'; lp.src = theme.logoUrl; lp.style.display = 'block'; }
    else { hl.style.display = 'none'; lp.style.display = 'none'; }
  }

  // --- Display sizing ---

  function computeMaxRows(disp) {
    return Math.ceil(12 * disp.height / disp.width);
  }

  function sizeGrid(num) {
    const disp = displays[String(num)];
    const wrapper = $(`#grid-wrapper-${num}`);
    const gridEl = $(`#grid-${num}`);
    const mainEl = $('.main-content');
    if (!wrapper || !disp) return;

    const panel = wrapper.closest('.display-panel');
    const maxW = panel.clientWidth - 26;
    if (maxW <= 0) return;

    const dc = Object.keys(displays).length;
    const overhead = 60 + (dc - 1) * 20 + dc * 70 + dc * 48;
    const maxH = Math.max(100, Math.floor((mainEl.clientHeight - overhead) / dc));

    const ratio = disp.width / disp.height;
    let w, h;
    if (maxW / maxH > ratio) { h = maxH; w = Math.round(h * ratio); }
    else { w = maxW; h = Math.round(w / ratio); }

    wrapper.style.height = (h + 24) + 'px';
    wrapper.style.width = (w + 24) + 'px';
    wrapper.style.margin = '0 auto';

    // Set CSS Grid rows based on display aspect ratio
    const maxRows = computeMaxRows(disp);
    gridEl.style.gridTemplateRows = `repeat(${maxRows}, 1fr)`;
  }

  function sizeAllGrids() { for (const n of Object.keys(displays)) sizeGrid(n); }

  async function saveDisplaySize(num) {
    const w = parseInt($(`#d${num}-width`).value) || 1920;
    const h = parseInt($(`#d${num}-height`).value) || 1080;
    displays[String(num)] = { width: w, height: h };
    await fetch(`/api/displays/${num}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ width: w, height: h }) });
    sizeGrid(num);
    applyPreset(num, displayState[num]?.preset || 'grid');
    toast(`Display ${num}: ${w} x ${h}`, 'success');
  }

  // --- Layout Presets ---
  // Each returns an array of {col, row, colSpan, rowSpan} (1-based for CSS Grid)

  const PRESETS = {
    grid: (n, maxR) => {
      let cols, rows;
      if (n === 1)      { cols = 1; rows = 1; }
      else if (n === 2) { cols = 2; rows = 1; }
      else if (n === 3) { cols = 3; rows = 1; }
      else if (n === 4) { cols = 2; rows = 2; }
      else if (n <= 6)  { cols = 3; rows = 2; }
      else if (n <= 8)  { cols = 4; rows = 2; }
      else if (n <= 9)  { cols = 3; rows = 3; }
      else              { cols = 4; rows = Math.ceil(n / 4); }

      const colW = Math.floor(12 / cols);
      const rowH = Math.floor(maxR / rows);
      const result = [];
      for (let i = 0; i < n; i++) {
        const r = Math.floor(i / cols);
        const c = i % cols;
        // Last row: spread remaining items evenly
        const inRow = (r < rows - 1) ? cols : (n - r * cols);
        const w = Math.floor(12 / inRow);
        const ci = i - r * cols;
        result.push({ col: ci * w + 1, row: r * rowH + 1, colSpan: w, rowSpan: rowH });
      }
      return result;
    },

    sidebar: (n, maxR, split) => {
      if (n === 1) return [{ col: 1, row: 1, colSpan: 12, rowSpan: maxR }];
      const mainW = split, sideW = 12 - mainW, mainN = n - 1;
      let rows = mainN >= 4 ? Math.ceil(mainN / 2) : mainN >= 2 ? 2 : 1;
      const perRow = Math.ceil(mainN / rows);
      const rowH = Math.floor(maxR / rows);
      const result = [];
      for (let i = 0; i < mainN; i++) {
        const r = Math.floor(i / perRow);
        const inRow = (r < rows - 1) ? perRow : (mainN - r * perRow);
        const w = Math.floor(mainW / inRow);
        const c = i - r * perRow;
        result.push({ col: c * w + 1, row: r * rowH + 1, colSpan: w, rowSpan: rowH });
      }
      result.push({ col: mainW + 1, row: 1, colSpan: sideW, rowSpan: maxR });
      return result;
    },

    focus: (n, maxR, split) => {
      if (n === 1) return [{ col: 1, row: 1, colSpan: 12, rowSpan: maxR }];
      const mainW = split, sideW = 12 - mainW, sN = n - 1;
      const rowH = Math.floor(maxR / sN);
      const result = [{ col: 1, row: 1, colSpan: mainW, rowSpan: maxR }];
      for (let i = 0; i < sN; i++) {
        const h = (i === sN - 1) ? (maxR - i * rowH) : rowH;
        result.push({ col: mainW + 1, row: i * rowH + 1, colSpan: sideW, rowSpan: h });
      }
      return result;
    },

    pip: (n, maxR) => {
      if (n === 1) return [{ col: 1, row: 1, colSpan: 12, rowSpan: maxR }];
      const pipW = 3, pipH = Math.max(1, Math.floor(maxR / 3));
      const result = [{ col: 1, row: 1, colSpan: 12, rowSpan: maxR }];
      for (let i = 1; i < n; i++) {
        result.push({ col: Math.max(1, 12 - pipW * i + 1), row: maxR - pipH + 1, colSpan: pipW, rowSpan: pipH });
      }
      return result;
    },
  };

  const SLIDER_PRESETS = new Set(['sidebar', 'focus']);
  const DEFAULT_SPLIT = { sidebar: 9, focus: 8 };

  function getState(num) {
    if (!displayState[num]) displayState[num] = { widgets: [], preset: 'grid', split: 9 };
    return displayState[num];
  }

  function updateSlider(num) {
    const state = getState(num);
    const row = $(`#split-row-${num}`);
    if (!row) return;
    if (SLIDER_PRESETS.has(state.preset)) {
      row.style.display = '';
      $(`#split-slider-${num}`).value = state.split;
      $(`#split-label-${num}`).textContent = `${state.split} | ${12 - state.split}`;
    } else {
      row.style.display = 'none';
    }
  }

  function applyPreset(num, presetName, split) {
    const state = getState(num);
    const disp = displays[String(num)];
    if (!disp) return;

    state.preset = presetName;
    if (split !== undefined) state.split = split;
    else if (DEFAULT_SPLIT[presetName]) state.split = DEFAULT_SPLIT[presetName];

    const maxRows = computeMaxRows(disp);
    const gridEl = $(`#grid-${num}`);
    if (!gridEl) return;

    const widgetEls = gridEl.querySelectorAll('.grid-widget');
    const n = widgetEls.length;
    if (n === 0) { updateSlider(num); highlightPreset(num); return; }

    const positions = (PRESETS[presetName] || PRESETS.grid)(n, maxRows, state.split);

    widgetEls.forEach((el, i) => {
      const p = positions[i];
      if (!p) return;
      el.style.gridColumn = `${p.col} / span ${p.colSpan}`;
      el.style.gridRow = `${p.row} / span ${p.rowSpan}`;
    });

    updateSlider(num);
    highlightPreset(num);
  }

  function highlightPreset(num) {
    const state = getState(num);
    $$(`[data-preset][data-display="${num}"]`).forEach(btn => {
      btn.classList.toggle('btn-primary', btn.dataset.preset === state.preset);
    });
  }

  function autoLayout(num) {
    const state = getState(num);
    applyPreset(num, state.preset);
  }

  // --- Widget HTML ---

  function createWidgetEl(source, widgetId, displayNum) {
    const icon = source.type === 'youtube' ? '&#9654;' : '&#127760;';
    const info = source.type === 'youtube' ? 'YT: ' + source.videoId : source.url;

    const el = document.createElement('div');
    el.className = 'grid-widget';
    el.dataset.sourceId = source.id;
    el.dataset.widgetId = widgetId;
    el.innerHTML = `
      <div class="widget-header">
        <span class="widget-icon">${icon}</span>
        <span class="widget-title">${source.title}</span>
      </div>
      <div class="widget-preview">${info}</div>
      <button class="widget-close" data-wid="${widgetId}" data-wdisplay="${displayNum}">&#10005;</button>
    `;
    return el;
  }

  // --- Dynamic display rendering ---

  function renderDisplayPanels() {
    displaysContainer.innerHTML = '';
    const nums = Object.keys(displays).sort((a, b) => a - b);
    const canRemove = nums.length > 1;

    for (const num of nums) {
      const disp = displays[num];
      const state = getState(num);
      if (!state.split) state.split = DEFAULT_SPLIT[state.preset] || 9;

      const section = document.createElement('section');
      section.className = 'display-panel';
      section.innerHTML = `
        <div class="display-panel-header">
          <span>Display ${num}</span>
          <span class="display-url-hint">/?display=${num}</span>
          <div class="display-size-controls">
            <div class="preset-btns">
              <button class="btn btn-sm btn-primary" data-preset="grid" data-display="${num}">Grid</button>
              <button class="btn btn-sm" data-preset="sidebar" data-display="${num}">Sidebar</button>
              <button class="btn btn-sm" data-preset="focus" data-display="${num}">Focus</button>
              <button class="btn btn-sm" data-preset="pip" data-display="${num}">PiP</button>
            </div>
            <input type="number" class="size-input" id="d${num}-width" data-display="${num}" value="${disp.width}" min="640" max="7680" step="1">
            <span class="size-sep">&times;</span>
            <input type="number" class="size-input" id="d${num}-height" data-display="${num}" value="${disp.height}" min="480" max="4320" step="1">
            <button class="btn btn-sm btn-apply-size" data-display="${num}">Apply</button>
            ${canRemove ? `<button class="btn btn-sm btn-remove-display" data-display="${num}" title="Remove display">&times;</button>` : ''}
          </div>
        </div>
        <div class="split-slider-row" id="split-row-${num}" style="display:none;">
          <span class="split-label" id="split-label-${num}">${state.split} | ${12 - state.split}</span>
          <input type="range" class="split-slider" id="split-slider-${num}" data-display="${num}" min="3" max="10" value="${state.split}">
        </div>
        <div class="display-grid-wrapper" id="grid-wrapper-${num}">
          <div class="display-grid" id="grid-${num}" style="grid-template-rows: repeat(${computeMaxRows(disp)}, 1fr);"></div>
        </div>
      `;
      displaysContainer.appendChild(section);
    }

    // Size grids after DOM is ready
    requestAnimationFrame(() => {
      sizeAllGrids();

      if (!renderDisplayPanels._ro) {
        renderDisplayPanels._ro = new ResizeObserver(() => sizeAllGrids());
        renderDisplayPanels._ro.observe($('.main-content'));
      }

      bindDisplayEvents();

      // Render widgets from current layout
      const layout = layouts.find(l => l.id === currentLayoutId);
      if (layout) renderWidgetsToGrids(layout.widgets);
    });
  }

  function bindDisplayEvents() {
    $$('[data-preset]').forEach(btn => {
      btn.onclick = () => applyPreset(btn.dataset.display, btn.dataset.preset);
    });
    $$('.split-slider').forEach(sl => {
      sl.oninput = () => {
        const num = sl.dataset.display, s = parseInt(sl.value);
        $(`#split-label-${num}`).textContent = `${s} | ${12 - s}`;
        applyPreset(num, getState(num).preset, s);
      };
    });
    $$('.btn-apply-size').forEach(btn => { btn.onclick = () => saveDisplaySize(btn.dataset.display); });
    $$('.btn-remove-display').forEach(btn => { btn.onclick = () => removeDisplay(btn.dataset.display); });
  }

  // --- Display add / remove ---

  async function addDisplay() {
    const res = await fetch('/api/displays', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ width: 1920, height: 1080 }) });
    const data = await res.json();
    displays[data.id] = { width: data.width, height: data.height };
    renderDisplayPanels();
    renderSources();
    toast(`Display ${data.id} added`, 'success');
  }

  async function removeDisplay(num) {
    if (Object.keys(displays).length <= 1) { toast('Must keep at least one display', 'error'); return; }
    if (!confirm(`Remove Display ${num}?`)) return;
    await fetch(`/api/displays/${num}`, { method: 'DELETE' });
    delete displays[num];
    delete displayState[num];
    renderDisplayPanels();
    renderSources();
    toast(`Display ${num} removed`, 'success');
  }

  // --- Widgets: extract / render ---

  function getWidgetsFromGrids() {
    const all = [];
    for (const num of Object.keys(displays)) {
      const gridEl = $(`#grid-${num}`);
      if (!gridEl) continue;
      gridEl.querySelectorAll('.grid-widget').forEach(el => {
        const style = el.style;
        // Parse grid-column: "3 / span 6" => x=2, w=6
        const colMatch = style.gridColumn.match(/(\d+)\s*\/\s*span\s+(\d+)/);
        const rowMatch = style.gridRow.match(/(\d+)\s*\/\s*span\s+(\d+)/);
        all.push({
          id: el.dataset.widgetId,
          sourceId: el.dataset.sourceId,
          display: parseInt(num),
          x: colMatch ? parseInt(colMatch[1]) - 1 : 0,
          y: rowMatch ? parseInt(rowMatch[1]) - 1 : 0,
          w: colMatch ? parseInt(colMatch[2]) : 4,
          h: rowMatch ? parseInt(rowMatch[2]) : 3,
        });
      });
    }
    return all;
  }

  function renderWidgetsToGrids(widgets) {
    // Clear all grids
    for (const num of Object.keys(displays)) {
      const gridEl = $(`#grid-${num}`);
      if (gridEl) gridEl.innerHTML = '';
    }

    (widgets || []).forEach(w => {
      const gridEl = $(`#grid-${w.display}`);
      if (!gridEl) return;
      const source = sources.find(s => s.id === w.sourceId);
      if (!source) return;

      const el = createWidgetEl(source, w.id, w.display);
      // Set position from saved layout data (0-based to 1-based)
      el.style.gridColumn = `${w.x + 1} / span ${w.w}`;
      el.style.gridRow = `${w.y + 1} / span ${w.h}`;
      gridEl.appendChild(el);
    });

    // Apply current presets to all displays
    for (const num of Object.keys(displays)) {
      autoLayout(num);
    }
  }

  // --- Remove widget ---

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.widget-close');
    if (!btn) return;
    e.stopPropagation();
    const num = btn.dataset.wdisplay;
    const widgetEl = btn.closest('.grid-widget');
    if (widgetEl) {
      widgetEl.remove();
      autoLayout(num);
    }
  });

  // --- Sources ---

  function renderSources() {
    sourceList.innerHTML = '';
    if (sources.length === 0) {
      sourceList.innerHTML = '<div class="empty-state"><span class="icon">&#128225;</span>No sources yet.<br>Add YouTube streams or web pages.</div>';
      return;
    }
    const displayNums = Object.keys(displays).sort((a, b) => a - b);

    sources.forEach(src => {
      const card = document.createElement('div');
      card.className = 'source-card';
      const targetBtns = displayNums.map(n =>
        `<button class="btn btn-sm btn-add-to" data-source="${src.id}" data-target="${n}" title="Add to Display ${n}">D${n}</button>`
      ).join('');

      card.innerHTML = `
        <div class="icon ${src.type}">${src.type === 'youtube' ? '&#9654;' : '&#127760;'}</div>
        <div class="info">
          <div class="title">${src.title}</div>
          <div class="subtitle">${src.type === 'youtube' ? 'ID: ' + src.videoId : src.url}</div>
        </div>
        <div class="actions">
          ${targetBtns}
          <button class="btn btn-sm btn-icon" data-edit="${src.id}" title="Edit">&#9998;</button>
          <button class="btn btn-sm btn-icon" data-delete="${src.id}" title="Delete">&#128465;</button>
        </div>
      `;

      card.querySelectorAll('.btn-add-to').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const s = sources.find(x => x.id === btn.dataset.source);
          if (s) addWidgetToGrid(s, btn.dataset.target);
        });
      });
      card.querySelector('[data-edit]').addEventListener('click', () => openSourceModal(src));
      card.querySelector('[data-delete]').addEventListener('click', async () => {
        if (!confirm(`Delete "${src.title}"?`)) return;
        await fetch(`/api/sources/${src.id}`, { method: 'DELETE' });
        toast('Source deleted', 'success');
      });
      sourceList.appendChild(card);
    });
  }

  function addWidgetToGrid(source, num) {
    const gridEl = $(`#grid-${num}`);
    if (!gridEl) return;
    const widgetId = crypto.randomUUID();
    const el = createWidgetEl(source, widgetId, num);
    gridEl.appendChild(el);
    autoLayout(num);
    toast(`Added "${source.title}" to Display ${num}`, 'success');
  }

  // --- Source Modal ---

  function openSourceModal(existing = null) {
    const type = existing ? existing.type : ($('#modal-source-type').value || 'youtube');
    $('#modal-title').textContent = existing ? 'Edit Source' : 'Add Source';
    $('#modal-source-id').value = existing ? existing.id : '';
    $('#modal-source-title').value = existing ? existing.title : '';
    $('#modal-source-type').value = type;
    if (type === 'youtube') { $('#modal-videoid-group').style.display = ''; $('#modal-url-group').style.display = 'none'; $('#modal-source-videoid').value = existing?.videoId || ''; }
    else { $('#modal-videoid-group').style.display = 'none'; $('#modal-url-group').style.display = ''; $('#modal-source-url').value = existing?.url || ''; }
    $('#source-modal').classList.add('active');
  }
  function closeSourceModal() { $('#source-modal').classList.remove('active'); }

  async function saveSource() {
    const id = $('#modal-source-id').value, type = $('#modal-source-type').value, title = $('#modal-source-title').value.trim();
    if (!title) { toast('Title is required', 'error'); return; }
    const body = { type, title };
    if (type === 'youtube') { body.videoId = $('#modal-source-videoid').value.trim(); if (!body.videoId) { toast('Video ID is required', 'error'); return; } }
    else { body.url = $('#modal-source-url').value.trim(); if (!body.url) { toast('URL is required', 'error'); return; } }
    if (id) { await fetch(`/api/sources/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); toast('Source updated', 'success'); }
    else { await fetch('/api/sources', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); toast('Source added', 'success'); }
    closeSourceModal();
  }

  // --- Layouts ---

  function renderLayoutSelect() {
    layoutSelect.innerHTML = '';
    layouts.forEach(l => { const o = document.createElement('option'); o.value = l.id; o.textContent = l.name + (l.id === activeLayoutId ? ' (LIVE)' : ''); o.selected = l.id === currentLayoutId; layoutSelect.appendChild(o); });
  }
  function loadLayout(id) { currentLayoutId = id; const l = layouts.find(x => x.id === id); if (l) renderWidgetsToGrids(l.widgets); renderLayoutSelect(); }
  async function saveLayout() { const w = getWidgetsFromGrids(); const l = layouts.find(x => x.id === currentLayoutId); if (!l) return; await fetch(`/api/layouts/${currentLayoutId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...l, widgets: w }) }); toast('Layout saved', 'success'); }
  async function activateLayout() { await saveLayout(); await fetch(`/api/layouts/${currentLayoutId}/activate`, { method: 'POST' }); activeLayoutId = currentLayoutId; renderLayoutSelect(); toast('Layout is now LIVE!', 'success'); }
  function openLayoutModal() { $('#layout-modal').classList.add('active'); $('#layout-name-input').value = ''; $('#layout-name-input').focus(); }
  function closeLayoutModal() { $('#layout-modal').classList.remove('active'); }
  async function createLayout() { const name = $('#layout-name-input').value.trim(); if (!name) { toast('Name is required', 'error'); return; } const res = await fetch('/api/layouts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) }); const nl = await res.json(); closeLayoutModal(); toast(`Layout "${name}" created`, 'success'); loadLayout(nl.id); }
  async function deleteLayout() { if (currentLayoutId === 'default') { toast('Cannot delete default layout', 'error'); return; } const l = layouts.find(x => x.id === currentLayoutId); if (!confirm(`Delete layout "${l?.name}"?`)) return; await fetch(`/api/layouts/${currentLayoutId}`, { method: 'DELETE' }); toast('Layout deleted', 'success'); }

  // --- Logo / Theme ---

  async function uploadLogo(f) { await fetch('/api/logo', { method: 'POST', headers: { 'Content-Type': f.type }, body: f }); toast('Logo uploaded', 'success'); }
  async function saveTheme() { const t = {}; $$('[data-theme]').forEach(i => { t[i.dataset.theme] = i.value; }); await fetch('/api/theme', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(t) }); toast('Theme applied', 'success'); }

  // --- Load All ---

  async function loadAll() {
    try {
      const [srcR, layR, thR, disR] = await Promise.all([fetch('/api/sources'), fetch('/api/layouts'), fetch('/api/theme'), fetch('/api/displays')]);
      sources = await srcR.json();
      const ld = await layR.json(); layouts = ld.layouts; activeLayoutId = ld.activeLayoutId;
      applyTheme(await thR.json());
      displays = await disR.json();
      renderSources(); renderLayoutSelect(); renderDisplayPanels();
    } catch (err) { console.error('Load failed:', err); toast('Failed to load data', 'error'); }
  }

  // --- WebSocket ---

  socket.on('connect', () => { statusDot.classList.remove('disconnected'); statusDot.title = 'Connected'; });
  socket.on('disconnect', () => { statusDot.classList.add('disconnected'); statusDot.title = 'Disconnected'; });
  socket.on('sources:changed', s => { sources = s; renderSources(); });
  socket.on('layouts:changed', d => { layouts = d.layouts; activeLayoutId = d.activeLayoutId; renderLayoutSelect(); });
  socket.on('theme:changed', t => applyTheme(t));
  socket.on('displays:changed', d => { displays = d; renderDisplayPanels(); renderSources(); });

  // --- Static Event Listeners ---

  $('#btn-add-youtube').addEventListener('click', () => { $('#modal-source-type').value = 'youtube'; openSourceModal(); });
  $('#btn-add-webpage').addEventListener('click', () => { $('#modal-source-type').value = 'webpage'; openSourceModal(); });
  $('#btn-modal-cancel').addEventListener('click', closeSourceModal);
  $('#btn-modal-save').addEventListener('click', saveSource);
  $('#btn-save').addEventListener('click', saveLayout);
  $('#btn-activate').addEventListener('click', activateLayout);
  $('#btn-new-layout').addEventListener('click', openLayoutModal);
  $('#btn-delete-layout').addEventListener('click', deleteLayout);
  $('#btn-layout-cancel').addEventListener('click', closeLayoutModal);
  $('#btn-layout-create').addEventListener('click', createLayout);
  $('#btn-save-theme').addEventListener('click', saveTheme);
  $('#btn-add-display').addEventListener('click', addDisplay);
  layoutSelect.addEventListener('change', () => loadLayout(layoutSelect.value));
  $('#logo-input').addEventListener('change', async (e) => { if (e.target.files[0]) await uploadLogo(e.target.files[0]); });
  $$('.modal-backdrop').forEach(b => { b.addEventListener('click', (e) => { if (e.target === b) b.classList.remove('active'); }); });
  document.addEventListener('keydown', (e) => { if (e.ctrlKey && e.key === 's') { e.preventDefault(); saveLayout(); } });

  // --- Init ---
  requestAnimationFrame(() => loadAll());
})();
