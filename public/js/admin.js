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
  const displaySelect     = $('#display-select');
  let selectedDisplay     = '1';

  // --- Sidebar Tabs ---

  $$('.sidebar-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      $$('.sidebar-tab').forEach(t => t.classList.remove('active'));
      $$('.sidebar-tab-content').forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      $(`#tab-${tab.dataset.tab}`).classList.add('active');
    });
  });

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
    const hl = $('#header-logo');
    if (theme.logoUrl) { hl.src = theme.logoUrl; hl.style.display = 'block'; }
    else { hl.style.display = 'none'; }
  }

  // --- Display sizing ---

  function computeMaxRows() {
    return GRID_ROWS;
  }

  function sizeGrid(num) {
    const disp = displays[String(num)];
    const wrapper = $(`#grid-wrapper-${num}`);
    const gridEl = $(`#grid-${num}`);
    if (!wrapper || !disp) return;

    // Use all available space in the wrapper
    const maxW = wrapper.clientWidth - 24;
    const maxH = wrapper.clientHeight - 24;
    if (maxW <= 0 || maxH <= 0) return;

    const ratio = disp.width / disp.height;
    let w, h;
    if (maxW / maxH > ratio) { h = maxH; w = Math.round(h * ratio); }
    else { w = maxW; h = Math.round(w / ratio); }

    gridEl.style.width = w + 'px';
    gridEl.style.height = h + 'px';
    gridEl.style.margin = '0 auto';

    // Fixed 2-row grid matching the templates
    gridEl.style.gridTemplateRows = `repeat(${GRID_ROWS}, 1fr)`;
  }

  function sizeAllGrids() { sizeGrid(selectedDisplay); }

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

  // --- Layout Templates ---
  // Fixed layouts using a simple 12-col x 2-row grid (like yt-splitscreen).
  // Each template is an array of {col, row, colSpan, rowSpan} for CSS Grid.
  // Widgets beyond the template slots get hidden.

  // 16 columns x 8 rows grid
  const GRID_COLS = 16;
  const GRID_ROWS = 8;

  const TEMPLATES = {
    full: [
      { col: 1, row: 1, colSpan: 16, rowSpan: 8 },
    ],
    '2h': [
      { col: 1, row: 1, colSpan: 8, rowSpan: 8 },
      { col: 9, row: 1, colSpan: 8, rowSpan: 8 },
    ],
    '2v': [
      { col: 1, row: 1, colSpan: 16, rowSpan: 4 },
      { col: 1, row: 5, colSpan: 16, rowSpan: 4 },
    ],
    '2x2': [
      { col: 1, row: 1, colSpan: 8, rowSpan: 4 },
      { col: 9, row: 1, colSpan: 8, rowSpan: 4 },
      { col: 1, row: 5, colSpan: 8, rowSpan: 4 },
      { col: 9, row: 5, colSpan: 8, rowSpan: 4 },
    ],
    '2+1': [
      { col: 1, row: 1, colSpan: 8, rowSpan: 4 },
      { col: 9, row: 1, colSpan: 8, rowSpan: 4 },
      { col: 1, row: 5, colSpan: 16, rowSpan: 4 },
    ],
    '1+2': [
      { col: 1, row: 1, colSpan: 16, rowSpan: 4 },
      { col: 1, row: 5, colSpan: 8, rowSpan: 4 },
      { col: 9, row: 5, colSpan: 8, rowSpan: 4 },
    ],
    'race': [
      { col: 1, row: 1, colSpan: 10, rowSpan: 4 },   // main video
      { col: 1, row: 5, colSpan: 5, rowSpan: 4 },    // small left
      { col: 6, row: 5, colSpan: 5, rowSpan: 4 },    // small right
      { col: 11, row: 1, colSpan: 6, rowSpan: 8 },   // timing sidebar
    ],
    'focus': [
      { col: 1, row: 1, colSpan: 10, rowSpan: 8 },   // main
      { col: 11, row: 1, colSpan: 6, rowSpan: 4 },   // small top
      { col: 11, row: 5, colSpan: 6, rowSpan: 4 },   // small bottom
    ],
    '3col': [
      { col: 1, row: 1, colSpan: 5, rowSpan: 8 },
      { col: 6, row: 1, colSpan: 6, rowSpan: 8 },
      { col: 12, row: 1, colSpan: 5, rowSpan: 8 },
    ],
  };

  function getState(num) {
    if (!displayState[num]) displayState[num] = { preset: 'full' };
    return displayState[num];
  }

  // Presets that support an adjustable split (main cols out of 12)
  const SPLIT_PRESETS = { race: 10, focus: 10, '2h': 8 };

  function buildTemplate(presetName, mainCols, widgetCount) {
    const side = GRID_COLS - mainCols;
    if (presetName === 'race') {
      const halfMain = Math.floor(mainCols / 2);
      return [
        { col: 1, row: 1, colSpan: mainCols, rowSpan: 4 },
        { col: 1, row: 5, colSpan: halfMain, rowSpan: 4 },
        { col: halfMain + 1, row: 5, colSpan: mainCols - halfMain, rowSpan: 4 },
        { col: mainCols + 1, row: 1, colSpan: side, rowSpan: 8 },
      ];
    }
    if (presetName === 'focus') {
      if (widgetCount <= 2) {
        return [
          { col: 1, row: 1, colSpan: mainCols, rowSpan: 8 },
          { col: mainCols + 1, row: 1, colSpan: side, rowSpan: 8 },
        ];
      }
      return [
        { col: 1, row: 1, colSpan: mainCols, rowSpan: 8 },
        { col: mainCols + 1, row: 1, colSpan: side, rowSpan: 4 },
        { col: mainCols + 1, row: 5, colSpan: side, rowSpan: 4 },
      ];
    }
    if (presetName === '2h') {
      return [
        { col: 1, row: 1, colSpan: mainCols, rowSpan: 8 },
        { col: mainCols + 1, row: 1, colSpan: side, rowSpan: 8 },
      ];
    }
    return TEMPLATES[presetName] || TEMPLATES.full;
  }

  function applyPreset(num, presetName) {
    const state = getState(num);
    state.preset = presetName;

    const gridEl = $(`#grid-${num}`);
    if (!gridEl) return;

    // Simple 2-row grid for all templates
    gridEl.style.gridTemplateRows = `repeat(${GRID_ROWS}, 1fr)`;

    const widgetEls = gridEl.querySelectorAll('.grid-widget');

    // Use adjustable split if available, otherwise default template
    const mainCols = state.split || SPLIT_PRESETS[presetName];
    const template = mainCols ? buildTemplate(presetName, mainCols, widgetEls.length) : (TEMPLATES[presetName] || TEMPLATES.full);
    widgetEls.forEach((el, i) => {
      if (i < template.length) {
        const t = template[i];
        el.style.gridColumn = `${t.col} / span ${t.colSpan}`;
        el.style.gridRow = `${t.row} / span ${t.rowSpan}`;
        el.style.display = '';
      } else {
        el.style.display = 'none';
      }
    });

    // Highlight active button
    $$(`[data-preset][data-display="${num}"]`).forEach(btn => {
      btn.classList.toggle('btn-primary', btn.dataset.preset === presetName);
    });

  }

  function autoLayout(num) {
    const state = getState(num);
    // Auto-pick best template based on widget count
    const gridEl = $(`#grid-${num}`);
    const n = gridEl ? gridEl.querySelectorAll('.grid-widget').length : 0;

    if (!state.preset || state.preset === 'auto') {
      // Smart default based on count
      if (n <= 1) state.preset = 'full';
      else if (n === 2) state.preset = '2h';
      else if (n === 3) state.preset = '2+1';
      else state.preset = '2x2';
    }

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
      <div class="resize-handle resize-e" data-dir="e"></div>
      <div class="resize-handle resize-s" data-dir="s"></div>
      <div class="resize-handle resize-se" data-dir="se"></div>
    `;
    return el;
  }

  // --- Widget drag-to-resize ---

  function getGridCell(gridEl, clientX, clientY) {
    const rect = gridEl.getBoundingClientRect();
    const colW = rect.width / GRID_COLS;
    const rowH = rect.height / GRID_ROWS;
    return {
      col: Math.max(1, Math.min(GRID_COLS, Math.ceil((clientX - rect.left) / colW))),
      row: Math.max(1, Math.min(GRID_ROWS, Math.ceil((clientY - rect.top) / rowH)))
    };
  }

  function parseGridPos(el) {
    const colM = (el.style.gridColumn || '').match(/(\d+)\s*\/\s*span\s+(\d+)/);
    const rowM = (el.style.gridRow || '').match(/(\d+)\s*\/\s*span\s+(\d+)/);
    return {
      col: colM ? parseInt(colM[1]) : 1,
      colSpan: colM ? parseInt(colM[2]) : 4,
      row: rowM ? parseInt(rowM[1]) : 1,
      rowSpan: rowM ? parseInt(rowM[2]) : 1
    };
  }

  (function initResize() {
    let active = null; // { el, gridEl, dir, startCol, startRow, startColSpan, startRowSpan }

    document.addEventListener('pointerdown', (e) => {
      const handle = e.target.closest('.resize-handle');
      if (!handle) return;
      e.preventDefault();
      e.stopPropagation();

      const widget = handle.closest('.grid-widget');
      const gridEl = widget.closest('.display-grid');
      if (!widget || !gridEl) return;

      const pos = parseGridPos(widget);
      active = {
        el: widget, gridEl, dir: handle.dataset.dir,
        startCol: pos.col, startRow: pos.row,
        startColSpan: pos.colSpan, startRowSpan: pos.rowSpan
      };
      widget.classList.add('resizing');
      document.body.style.cursor = handle.dataset.dir === 'e' ? 'ew-resize' : handle.dataset.dir === 's' ? 'ns-resize' : 'nwse-resize';
    });

    document.addEventListener('pointermove', (e) => {
      if (!active) return;
      e.preventDefault();
      const cell = getGridCell(active.gridEl, e.clientX, e.clientY);
      const dir = active.dir;

      if (dir === 'e' || dir === 'se') {
        const newSpan = Math.max(1, cell.col - active.startCol + 1);
        active.el.style.gridColumn = `${active.startCol} / span ${Math.min(newSpan, GRID_COLS + 1 - active.startCol)}`;
      }
      if (dir === 's' || dir === 'se') {
        const newSpan = Math.max(1, cell.row - active.startRow + 1);
        active.el.style.gridRow = `${active.startRow} / span ${Math.min(newSpan, GRID_ROWS + 1 - active.startRow)}`;
      }
    });

    document.addEventListener('pointerup', () => {
      if (!active) return;
      active.el.classList.remove('resizing');
      document.body.style.cursor = '';
      active = null;
    });
  })();

  // --- Widget drag-to-move ---

  (function initDragMove() {
    let drag = null; // { el, gridEl, colSpan, rowSpan, offsetCol, offsetRow }

    document.addEventListener('pointerdown', (e) => {
      const header = e.target.closest('.widget-header');
      if (!header) return;
      // Don't start drag if clicking close button
      if (e.target.closest('.widget-close')) return;

      const widget = header.closest('.grid-widget');
      const gridEl = widget.closest('.display-grid');
      if (!widget || !gridEl) return;

      e.preventDefault();
      const pos = parseGridPos(widget);
      const cell = getGridCell(gridEl, e.clientX, e.clientY);

      drag = {
        el: widget, gridEl,
        colSpan: pos.colSpan, rowSpan: pos.rowSpan,
        offsetCol: cell.col - pos.col,
        offsetRow: cell.row - pos.row
      };
      widget.classList.add('dragging');
      document.body.style.cursor = 'grabbing';
    });

    document.addEventListener('pointermove', (e) => {
      if (!drag) return;
      e.preventDefault();
      const cell = getGridCell(drag.gridEl, e.clientX, e.clientY);
      const newCol = Math.max(1, Math.min(GRID_COLS + 1 - drag.colSpan, cell.col - drag.offsetCol));
      const newRow = Math.max(1, Math.min(GRID_ROWS + 1 - drag.rowSpan, cell.row - drag.offsetRow));
      drag.el.style.gridColumn = `${newCol} / span ${drag.colSpan}`;
      drag.el.style.gridRow = `${newRow} / span ${drag.rowSpan}`;
    });

    document.addEventListener('pointerup', () => {
      if (!drag) return;
      drag.el.classList.remove('dragging');
      document.body.style.cursor = '';
      drag = null;
    });
  })();

  // --- Dynamic display rendering ---

  function renderDisplaySelect() {
    const nums = Object.keys(displays).sort((a, b) => a - b);
    if (!nums.includes(selectedDisplay)) selectedDisplay = nums[0] || '1';
    displaySelect.innerHTML = '';
    nums.forEach(num => {
      const o = document.createElement('option');
      o.value = num;
      o.textContent = `Display ${num} (${displays[num].width}x${displays[num].height})`;
      o.selected = num === selectedDisplay;
      displaySelect.appendChild(o);
    });
  }

  function renderDisplayPanels() {
    renderDisplaySelect();
    displaysContainer.innerHTML = '';
    const nums = Object.keys(displays).sort((a, b) => a - b);
    const canRemove = nums.length > 1;

    // Only render the selected display
    const num = selectedDisplay;
    const disp = displays[num];
    if (!disp) return;
    const state = getState(num);
    if (!state.preset) state.preset = 'full';

    const section = document.createElement('section');
    section.className = 'display-panel';
    section.innerHTML = `
      <div class="display-panel-header">
        <span class="display-url-hint">/?display=${num}</span>
        <div class="display-size-controls">
          <div class="preset-btns">
            <button class="btn btn-sm" data-preset="full" data-display="${num}" title="1 fullscreen">1</button>
            <button class="btn btn-sm" data-preset="2h" data-display="${num}" title="2 side by side">2H</button>
            <button class="btn btn-sm" data-preset="2v" data-display="${num}" title="2 stacked">2V</button>
            <button class="btn btn-sm" data-preset="2x2" data-display="${num}" title="2x2 grid">2x2</button>
            <button class="btn btn-sm" data-preset="2+1" data-display="${num}" title="2 top + 1 bottom">2+1</button>
            <button class="btn btn-sm" data-preset="1+2" data-display="${num}" title="1 top + 2 bottom">1+2</button>
            <button class="btn btn-sm" data-preset="race" data-display="${num}" title="Race: big + 2 small + timing">Race</button>
            <button class="btn btn-sm" data-preset="focus" data-display="${num}" title="1 big + 2 small right">Focus</button>
            <button class="btn btn-sm" data-preset="3col" data-display="${num}" title="3 columns">3col</button>
          </div>
          <input type="number" class="size-input" id="d${num}-width" data-display="${num}" value="${disp.width}" min="640" max="7680" step="1">
          <span class="size-sep">&times;</span>
          <input type="number" class="size-input" id="d${num}-height" data-display="${num}" value="${disp.height}" min="480" max="4320" step="1">
          <button class="btn btn-sm btn-apply-size" data-display="${num}">Apply</button>
          ${canRemove ? `<button class="btn btn-sm btn-remove-display" data-display="${num}" title="Remove display">&times;</button>` : ''}
        </div>
      </div>
      <div class="display-grid-wrapper" id="grid-wrapper-${num}">
        <div class="display-grid" id="grid-${num}" style="grid-template-rows: repeat(${computeMaxRows()}, 1fr);"></div>
      </div>
    `;
    displaysContainer.appendChild(section);

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
      btn.onclick = () => {
        const state = getState(btn.dataset.display);
        // Reset split to default for this preset
        state.split = SPLIT_PRESETS[btn.dataset.preset] || null;
        applyPreset(btn.dataset.display, btn.dataset.preset);
      };
    });
    $$('.btn-apply-size').forEach(btn => { btn.onclick = () => saveDisplaySize(btn.dataset.display); });
    $$('.btn-remove-display').forEach(btn => { btn.onclick = () => removeDisplay(btn.dataset.display); });
  }

  // --- Display add / remove ---

  async function addDisplay() {
    saveVisibleToCache();
    const res = await fetch('/api/displays', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ width: 1920, height: 1080 }) });
    const data = await res.json();
    displays[data.id] = { width: data.width, height: data.height };
    selectedDisplay = data.id;
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
  // Cache widgets for non-visible displays (only one display is rendered at a time)
  let widgetCache = [];

  function saveVisibleToCache() {
    const gridEl = $(`#grid-${selectedDisplay}`);
    if (!gridEl) return;
    // Remove cached widgets for this display and replace with current DOM state
    widgetCache = widgetCache.filter(w => String(w.display) !== selectedDisplay);
    gridEl.querySelectorAll('.grid-widget').forEach(el => {
      const colMatch = (el.style.gridColumn || '').match(/(\d+)\s*\/\s*span\s+(\d+)/);
      const rowMatch = (el.style.gridRow || '').match(/(\d+)\s*\/\s*span\s+(\d+)/);
      widgetCache.push({
        id: el.dataset.widgetId,
        sourceId: el.dataset.sourceId,
        display: parseInt(selectedDisplay),
        x: colMatch ? parseInt(colMatch[1]) - 1 : 0,
        y: rowMatch ? parseInt(rowMatch[1]) - 1 : 0,
        w: colMatch ? parseInt(colMatch[2]) : 4,
        h: rowMatch ? parseInt(rowMatch[2]) : 1,
      });
    });
  }

  function getWidgetsFromGrids() {
    saveVisibleToCache();
    return [...widgetCache];
  }

  function renderWidgetsToGrids(widgets) {
    widgetCache = [...(widgets || [])];
    // Only render widgets for the visible display
    const gridEl = $(`#grid-${selectedDisplay}`);
    if (gridEl) {
      gridEl.innerHTML = '';
      widgetCache.filter(w => String(w.display) === selectedDisplay).forEach(w => {
        const source = sources.find(s => s.id === w.sourceId);
        if (!source) return;
        const el = createWidgetEl(source, w.id, w.display);
        el.style.gridColumn = `${w.x + 1} / span ${w.w}`;
        el.style.gridRow = `${w.y + 1} / span ${w.h}`;
        gridEl.appendChild(el);
      });
      autoLayout(selectedDisplay);
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

  let audioSourceId = null;

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

      const isAudio = audioSourceId === src.id;
      const audioBtn = src.type === 'youtube'
        ? `<button class="btn btn-sm btn-icon btn-audio ${isAudio ? 'active' : ''}" data-audio="${src.id}" title="${isAudio ? 'Mute' : 'Enable audio'}">${isAudio ? '&#128266;' : '&#128264;'}</button>`
        : '';

      const qualityLabel = src.quality && src.quality !== 'auto' ? ` | ${src.quality}p` : '';
      const refreshLabel = src.autoRefresh ? ' | auto-refresh' : '';
      card.innerHTML = `
        <div class="source-card-top">
          <div class="icon ${src.type}">${src.type === 'youtube' ? '&#9654;' : '&#127760;'}</div>
          <div class="info">
            <div class="title">${src.title}</div>
            <div class="subtitle">${src.type === 'youtube' ? 'ID: ' + src.videoId + qualityLabel : src.url}${refreshLabel}</div>
          </div>
        </div>
        <div class="actions">
          ${audioBtn}
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
      const audioBtnEl = card.querySelector('[data-audio]');
      if (audioBtnEl) {
        audioBtnEl.addEventListener('click', async (e) => {
          e.stopPropagation();
          const newId = audioSourceId === src.id ? null : src.id;
          await fetch('/api/audio', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sourceId: newId }) });
        });
      }
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
    const widgetId = 'w-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    if (String(num) !== selectedDisplay) {
      // Adding to a non-visible display — save to cache and switch
      saveVisibleToCache();
      widgetCache.push({ id: widgetId, sourceId: source.id, display: parseInt(num), x: 0, y: 0, w: 8, h: 8 });
      selectedDisplay = String(num);
      renderDisplayPanels();
      renderWidgetsToGrids(widgetCache);
    } else {
      const gridEl = $(`#grid-${num}`);
      if (!gridEl) return;
      const el = createWidgetEl(source, widgetId, num);
      gridEl.appendChild(el);
      autoLayout(num);
    }
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
    // Quality (YouTube only)
    $('#modal-quality-group').style.display = type === 'youtube' ? '' : 'none';
    $('#modal-source-quality').value = existing?.quality || 'auto';
    // Auto-refresh
    $('#modal-source-refresh').checked = existing?.autoRefresh || false;
    $('#source-modal').classList.add('active');
  }
  function closeSourceModal() { $('#source-modal').classList.remove('active'); }

  async function saveSource() {
    const id = $('#modal-source-id').value, type = $('#modal-source-type').value, title = $('#modal-source-title').value.trim();
    if (!title) { toast('Title is required', 'error'); return; }
    const body = { type, title, autoRefresh: $('#modal-source-refresh').checked };
    if (type === 'youtube') {
      body.videoId = $('#modal-source-videoid').value.trim(); if (!body.videoId) { toast('Video ID is required', 'error'); return; }
      body.quality = $('#modal-source-quality').value;
    }
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

  // Theme and logo upload removed from UI — API still works for later use

  // --- Load All ---

  async function loadAll() {
    try {
      const [srcR, layR, thR, disR, audR] = await Promise.all([fetch('/api/sources'), fetch('/api/layouts'), fetch('/api/theme'), fetch('/api/displays'), fetch('/api/audio')]);
      sources = await srcR.json();
      const ld = await layR.json(); layouts = ld.layouts; activeLayoutId = ld.activeLayoutId;
      applyTheme(await thR.json());
      displays = await disR.json();
      const audData = await audR.json(); audioSourceId = audData.sourceId || null;
      renderSources(); renderLayoutSelect(); renderDisplayPanels();
    } catch (err) { console.error('Load failed:', err); toast('Failed to load data', 'error'); }
  }

  // --- WebSocket ---

  socket.on('connect', () => { statusDot.classList.remove('disconnected'); statusDot.title = 'Connected'; });
  socket.on('disconnect', () => { statusDot.classList.add('disconnected'); statusDot.title = 'Disconnected'; });
  socket.on('sources:changed', s => { sources = s; renderSources(); });
  socket.on('audio:changed', a => { audioSourceId = a.sourceId; renderSources(); });
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
  $('#btn-add-display').addEventListener('click', addDisplay);
  displaySelect.addEventListener('change', () => {
    saveVisibleToCache();
    selectedDisplay = displaySelect.value;
    renderDisplayPanels();
    const layout = layouts.find(l => l.id === currentLayoutId);
    if (layout) renderWidgetsToGrids(widgetCache);
  });
  $('#btn-resync-kiosk').addEventListener('click', async () => {
    if (!confirm('This will restart all Chromium kiosk windows. Continue?')) return;
    toast('Resyncing monitors...', 'success');
    try {
      const res = await fetch('/api/kiosk/resync', { method: 'POST' });
      const data = await res.json();
      if (res.ok) toast('Monitors resynced!', 'success');
      else toast('Resync failed: ' + data.error, 'error');
    } catch (e) { toast('Resync failed: ' + e.message, 'error'); }
  });
  layoutSelect.addEventListener('change', () => loadLayout(layoutSelect.value));
  $$('.modal-backdrop').forEach(b => { b.addEventListener('click', (e) => { if (e.target === b) b.classList.remove('active'); }); });
  document.addEventListener('keydown', (e) => { if (e.ctrlKey && e.key === 's') { e.preventDefault(); saveLayout(); } });

  // --- Live Timing ---

  const timingUrl = $('#timing-url');
  const timingStatus = $('#timing-status');
  const btnConnect = $('#btn-timing-connect');
  const btnDisconnect = $('#btn-timing-disconnect');

  async function loadTimingStatus() {
    try {
      const res = await fetch('/api/timing/status');
      const s = await res.json();
      if (s.url) timingUrl.value = s.url;
      updateTimingUI(s.connected);
    } catch (e) { /* timing module not available */ }
  }

  function updateTimingUI(isConnected) {
    timingStatus.textContent = isConnected ? 'Connected' : 'Disconnected';
    timingStatus.style.color = isConnected ? '#4caf50' : 'var(--text-dim)';
    btnConnect.style.display = isConnected ? 'none' : '';
    btnDisconnect.style.display = isConnected ? '' : 'none';
  }

  btnConnect.addEventListener('click', async () => {
    const url = timingUrl.value.trim();
    if (!url) { toast('Enter a WebSocket URL', 'error'); return; }
    await fetch('/api/timing/connect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) });
    toast('Connecting to live timing...', 'success');
  });

  btnDisconnect.addEventListener('click', async () => {
    await fetch('/api/timing/disconnect', { method: 'POST' });
    toast('Live timing disconnected', 'success');
  });

  $('#btn-timing-test').addEventListener('click', async () => {
    await fetch('/api/timing/test', { method: 'POST' });
    toast('Test started — watch the dashboard for popups (2s, 5s, 8s)', 'success');
  });

  socket.on('timing:status', s => updateTimingUI(s.connected));

  // --- Extension Toggle ---

  const extToggle = $('#ext-toggle');

  async function loadExtensionStatus() {
    try {
      const res = await fetch('/api/extension');
      const data = await res.json();
      extToggle.checked = data.enabled;
    } catch (e) { /* extension API not available */ }
  }

  extToggle.addEventListener('change', async () => {
    await fetch('/api/extension', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: extToggle.checked }) });
    toast(extToggle.checked ? 'Extension enabled' : 'Extension disabled', 'success');
  });

  socket.on('extension:changed', e => { extToggle.checked = e.enabled; });

  // --- Messages ---

  $('#btn-send-message').addEventListener('click', async () => {
    const text = $('#message-text').value.trim();
    if (!text) { toast('Enter a message', 'error'); return; }
    const duration = parseInt($('#message-duration').value) || 30;
    await fetch('/api/messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, duration }) });
    $('#message-text').value = '';
    toast('Message sent', 'success');
  });

  // --- Init ---
  requestAnimationFrame(() => { loadAll(); loadTimingStatus(); loadExtensionStatus(); });
})();
