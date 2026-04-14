/* RingRaceViewer — Dashboard Display
   Runs in kiosk mode on each monitor.
   URL params: ?display=1 or ?display=2 */

(function () {
  'use strict';

  const params = new URLSearchParams(location.search);
  const displayNum = parseInt(params.get('display') || '1', 10);

  const socket = io();
  let grid = null;
  let sources = [];
  let displayConfig = { width: 1920, height: 1080 };

  // --- Theme ---

  function applyTheme(theme) {
    if (!theme) return;
    const root = document.documentElement.style;
    if (theme.primaryColor)    root.setProperty('--primary', theme.primaryColor);
    if (theme.accentColor)     root.setProperty('--accent', theme.accentColor);
    if (theme.backgroundColor) root.setProperty('--bg', theme.backgroundColor);
    if (theme.surfaceColor)    root.setProperty('--surface', theme.surfaceColor);
    if (theme.textColor)       root.setProperty('--text', theme.textColor);

    const logo = document.getElementById('dashboard-logo');
    if (theme.logoUrl) {
      logo.src = theme.logoUrl;
      logo.style.display = 'block';
    } else {
      logo.style.display = 'none';
    }
  }

  // --- Grid ---

  function computeDashboardCellHeight() {
    // Match the same grid math as admin: cells are square in display coordinates.
    // rows = ceil(12 * height / width), cellHeight = viewportHeight / rows
    const rows = Math.ceil(12 * displayConfig.height / displayConfig.width);
    return Math.floor(window.innerHeight / rows);
  }

  function initGrid() {
    const rows = Math.ceil(12 * displayConfig.height / displayConfig.width);
    grid = GridStack.init({
      column: 12,
      cellHeight: computeDashboardCellHeight(),
      maxRow: rows,
      margin: 0,
      disableResize: true,
      disableDrag: true,
      float: true,
      animate: false,
    }, '#grid');
  }

  function getSourceEmbed(source) {
    if (!source) return '';
    if (source.type === 'youtube') {
      return `https://www.youtube.com/embed/${source.videoId}?autoplay=1&mute=1&enablejsapi=1&rel=0`;
    }
    return source.url || '';
  }

  function renderLayout(layout) {
    if (!grid || !layout) return;

    grid.removeAll(false);

    const widgets = (layout.widgets || []).filter(w => w.display === displayNum);

    widgets.forEach(w => {
      const source = sources.find(s => s.id === w.sourceId);
      const embedUrl = getSourceEmbed(source);
      const title = source ? source.title : 'Unknown';

      grid.addWidget({
        x: w.x,
        y: w.y,
        w: w.w,
        h: w.h,
        id: w.id,
        content: embedUrl
          ? `<iframe src="${embedUrl}" allow="autoplay; encrypted-media; fullscreen" allowfullscreen title="${title}"></iframe>`
          : `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-dim);">${title}</div>`,
      });
    });
  }

  // --- Data Loading ---

  async function loadAll() {
    try {
      const [srcRes, layoutRes, themeRes, dispRes] = await Promise.all([
        fetch('/api/sources'),
        fetch('/api/layouts'),
        fetch('/api/theme'),
        fetch('/api/displays'),
      ]);

      sources = await srcRes.json();
      const { layouts, activeLayoutId } = await layoutRes.json();
      const theme = await themeRes.json();
      const allDisplays = await dispRes.json();
      displayConfig = allDisplays[String(displayNum)] || displayConfig;

      applyTheme(theme);

      const active = layouts.find(l => l.id === activeLayoutId);
      if (active) renderLayout(active);
    } catch (err) {
      console.error('Failed to load data:', err);
      setTimeout(loadAll, 3000);
    }
  }

  // --- WebSocket Events ---

  socket.on('layout:activated', layout => renderLayout(layout));
  socket.on('layout:updated',   layout => renderLayout(layout));
  socket.on('theme:changed',    theme  => applyTheme(theme));

  socket.on('sources:changed', newSources => {
    sources = newSources;
    // Re-render active layout with updated source info
    fetch('/api/layouts')
      .then(r => r.json())
      .then(({ layouts, activeLayoutId }) => {
        const active = layouts.find(l => l.id === activeLayoutId);
        if (active) renderLayout(active);
      });
  });

  socket.on('displays:changed', newDisplays => {
    const newConf = newDisplays[String(displayNum)];
    if (newConf && (newConf.width !== displayConfig.width || newConf.height !== displayConfig.height)) {
      displayConfig = newConf;
      if (grid) {
        const rows = Math.ceil(12 * displayConfig.height / displayConfig.width);
        grid.opts.maxRow = rows;
        grid.cellHeight(computeDashboardCellHeight());
      }
    }
  });

  socket.on('connect', () => console.log(`Display ${displayNum} connected`));
  socket.on('disconnect', () => console.log(`Display ${displayNum} disconnected`));

  // --- Init ---

  window.addEventListener('resize', () => {
    if (grid) {
      grid.cellHeight(computeDashboardCellHeight());
    }
  });

  initGrid();
  loadAll();
})();
