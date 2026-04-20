/* RingRaceViewer — Dashboard Display
   Pure CSS Grid — runs in kiosk mode on each monitor.
   URL params: ?display=1 or ?display=2 etc. */

(function () {
  'use strict';

  const params = new URLSearchParams(location.search);
  const displayNum = parseInt(params.get('display') || '1', 10);

  // Unique title so kiosk script can find each window with xdotool
  document.title = `RRV-Display-${displayNum}`;

  const socket = io();
  let sources = [];
  let displayConfig = { width: 1920, height: 1080 };

  const gridEl = document.getElementById('grid');

  // --- YouTube IFrame API ---

  const QUALITY_MAP = {
    '2160': 'hd2160', '1440': 'hd1440', '1080': 'hd1080',
    '720': 'hd720', '480': 'large', '360': 'medium'
  };

  let ytReady = false;
  const ytPlayers = {}; // widgetId -> YT.Player
  const ytSourceMap = {}; // widgetId -> sourceId
  let audioSourceId = null;

  window.onYouTubeIframeAPIReady = function () {
    ytReady = true;
    console.log('YouTube IFrame API ready');
  };

  function createYTPlayer(containerId, videoId, quality, sourceId) {
    ytSourceMap[containerId] = sourceId;
    const playerVars = { autoplay: 1, mute: 1, rel: 0, modestbranding: 1, controls: 0 };
    return new YT.Player(containerId, {
      videoId: videoId,
      playerVars: playerVars,
      events: {
        onReady: function (event) {
          if (quality && quality !== 'auto' && QUALITY_MAP[quality]) {
            event.target.setPlaybackQuality(QUALITY_MAP[quality]);
          }
          // Apply audio state after player is ready
          if (sourceId === audioSourceId) {
            event.target.unMute();
            event.target.setVolume(100);
          }
        },
        onStateChange: function (event) {
          if (event.data === YT.PlayerState.PLAYING && quality && quality !== 'auto' && QUALITY_MAP[quality]) {
            event.target.setPlaybackQuality(QUALITY_MAP[quality]);
          }
        }
      }
    });
  }

  function destroyAllPlayers() {
    Object.keys(ytPlayers).forEach(id => {
      try { ytPlayers[id].destroy(); } catch (e) { /* ignore */ }
      delete ytPlayers[id];
      delete ytSourceMap[id];
    });
  }

  let userGesture = false;

  function applyAudio() {
    if (!userGesture && audioSourceId) {
      showAudioOverlay();
      return;
    }
    hideAudioOverlay();
    Object.keys(ytPlayers).forEach(id => {
      try {
        const player = ytPlayers[id];
        if (ytSourceMap[id] === audioSourceId) {
          player.unMute();
          player.setVolume(100);
        } else {
          player.mute();
        }
      } catch (e) { /* player not ready yet */ }
    });
  }

  function showAudioOverlay() {
    if (document.getElementById('audio-overlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'audio-overlay';
    overlay.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);z-index:9999;background:var(--primary,#e10600);color:#fff;padding:12px 24px;border-radius:8px;font-size:1rem;cursor:pointer;box-shadow:0 4px 20px rgba(0,0,0,.5);animation:popupSlideIn .4s ease-out;';
    overlay.textContent = 'Tap to enable audio';
    overlay.addEventListener('click', () => {
      userGesture = true;
      applyAudio();
    });
    document.body.appendChild(overlay);
  }

  function hideAudioOverlay() {
    const overlay = document.getElementById('audio-overlay');
    if (overlay) overlay.remove();
  }

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

  function updateGridRows() {
    gridEl.style.gridTemplateRows = 'repeat(8, 1fr)';
  }

  function renderLayout(layout) {
    if (!layout) return;

    // Destroy existing YT players before clearing DOM
    destroyAllPlayers();
    gridEl.innerHTML = '';

    updateGridRows();

    const widgets = (layout.widgets || []).filter(w => w.display === displayNum);

    widgets.forEach(w => {
      const source = sources.find(s => s.id === w.sourceId);
      const title = source ? source.title : 'Unknown';

      const el = document.createElement('div');
      el.className = 'dash-widget';
      el.dataset.sourceId = w.sourceId;
      // CSS Grid positioning (0-based to 1-based)
      el.style.gridColumn = `${w.x + 1} / span ${w.w}`;
      el.style.gridRow = `${w.y + 1} / span ${w.h}`;

      if (source && source.type === 'youtube' && ytReady) {
        // YouTube: use IFrame API for quality control
        const playerId = 'yt-' + w.sourceId + '-' + Math.random().toString(36).slice(2, 8);
        const playerDiv = document.createElement('div');
        playerDiv.id = playerId;
        playerDiv.style.width = '100%';
        playerDiv.style.height = '100%';
        el.appendChild(playerDiv);
        gridEl.appendChild(el);
        ytPlayers[playerId] = createYTPlayer(playerId, source.videoId, source.quality, source.id);
      } else if (source && source.type === 'youtube') {
        // Fallback if YT API not loaded yet
        const url = `https://www.youtube.com/embed/${source.videoId}?autoplay=1&mute=1&rel=0`;
        el.innerHTML = `<iframe src="${url}" allow="autoplay; encrypted-media; fullscreen" allowfullscreen title="${title}"></iframe>`;
        gridEl.appendChild(el);
      } else if (source && source.url) {
        el.innerHTML = `<iframe src="${source.url}" allow="autoplay; encrypted-media; fullscreen" allowfullscreen title="${title}"></iframe>`;
        gridEl.appendChild(el);
      } else {
        el.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-dim);">${title}</div>`;
        gridEl.appendChild(el);
      }
    });

    // Show logo idle screen if no widgets
    updateIdleScreen(widgets.length);
  }

  // Show the RingRaceViewer logo when no content is active
  function updateIdleScreen(widgetCount) {
    let idle = document.getElementById('idle-screen');
    if (widgetCount > 0) {
      if (idle) idle.style.display = 'none';
      gridEl.style.display = '';
    } else {
      gridEl.style.display = 'none';
      if (!idle) {
        idle = document.createElement('div');
        idle.id = 'idle-screen';
        idle.className = 'splash';
        idle.innerHTML = '<div class="splash-text"><span class="splash-ring">Ring</span><span class="splash-race">Race</span><span class="splash-viewer">Viewer</span></div>';
        document.body.appendChild(idle);
      }
      idle.style.display = '';
    }
  }

  // --- Splash Screen ---

  const splashEl = document.getElementById('splash');
  const splashStart = Date.now();
  const SPLASH_DURATION = 5000; // 5 seconds

  function hideSplash() {
    const elapsed = Date.now() - splashStart;
    const remaining = Math.max(0, SPLASH_DURATION - elapsed);

    setTimeout(() => {
      gridEl.style.display = '';
      splashEl.classList.add('fade-out');
      setTimeout(() => splashEl.remove(), 600);
    }, remaining);
  }

  // --- Data Loading ---

  async function loadAll() {
    try {
      const [srcRes, layoutRes, themeRes, dispRes, audRes] = await Promise.all([
        fetch('/api/sources'),
        fetch('/api/layouts'),
        fetch('/api/theme'),
        fetch('/api/displays'),
        fetch('/api/audio'),
      ]);

      sources = await srcRes.json();
      const { layouts, activeLayoutId } = await layoutRes.json();
      const theme = await themeRes.json();
      const allDisplays = await dispRes.json();
      const audData = await audRes.json();
      audioSourceId = audData.sourceId || null;
      displayConfig = allDisplays[String(displayNum)] || displayConfig;

      applyTheme(theme);
      updateGridRows();

      const active = layouts.find(l => l.id === activeLayoutId);
      if (active) renderLayout(active);

      // Show splash for at least 5 seconds, then fade to layout
      hideSplash();
    } catch (err) {
      console.error('Failed to load data:', err);
      setTimeout(loadAll, 3000);
    }
  }

  // --- WebSocket Events ---

  socket.on('layout:activated', layout => renderLayout(layout));
  socket.on('layout:updated',   layout => renderLayout(layout));
  socket.on('theme:changed',    theme  => applyTheme(theme));

  // Forward extension toggle to all iframes via postMessage
  socket.on('extension:changed', e => {
    document.querySelectorAll('iframe').forEach(iframe => {
      try {
        iframe.contentWindow.postMessage({ type: 'rrv-extension', action: e.enabled ? 'enable' : 'disable' }, '*');
      } catch (err) { /* cross-origin, extension handles it */ }
    });
  });

  socket.on('sources:changed', newSources => {
    sources = newSources;
    fetch('/api/layouts')
      .then(r => r.json())
      .then(({ layouts, activeLayoutId }) => {
        const active = layouts.find(l => l.id === activeLayoutId);
        if (active) renderLayout(active);
      });
  });

  socket.on('audio:changed', a => {
    audioSourceId = a.sourceId;
    if (!audioSourceId) hideAudioOverlay();
    applyAudio();
  });

  socket.on('displays:changed', newDisplays => {
    const newConf = newDisplays[String(displayNum)];
    if (newConf) {
      displayConfig = newConf;
      updateGridRows();
    }
  });

  // --- Message Popup Notifications ---

  socket.on('message:broadcast', msg => {
    showMessagePopup(msg.text, msg.duration || 30);
  });

  function showMessagePopup(text, durationSec) {
    // Create or reuse the popup container
    let container = document.getElementById('message-popup-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'message-popup-container';
      container.style.cssText = 'position:fixed;top:20px;right:20px;z-index:9999;display:flex;flex-direction:column;gap:10px;max-width:500px;pointer-events:none;';
      document.body.appendChild(container);
    }

    const popup = document.createElement('div');
    popup.style.cssText = 'background:var(--surface-2,#1e1e2e);color:var(--text,#e0e0e0);border-left:4px solid var(--primary,#e10600);padding:16px 20px;border-radius:8px;font-size:1.1rem;line-height:1.4;box-shadow:0 4px 24px rgba(0,0,0,.6);animation:popupSlideIn .4s ease-out;pointer-events:auto;';
    popup.textContent = text;
    container.appendChild(popup);

    // Add animation keyframes if not already added
    if (!document.getElementById('popup-keyframes')) {
      const style = document.createElement('style');
      style.id = 'popup-keyframes';
      style.textContent = `
        @keyframes popupSlideIn { from { transform: translateX(100%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
        @keyframes popupFadeOut { from { opacity: 1; } to { opacity: 0; transform: translateY(-10px); } }
      `;
      document.head.appendChild(style);
    }

    // Remove after duration
    setTimeout(() => {
      popup.style.animation = 'popupFadeOut .5s ease-in forwards';
      setTimeout(() => popup.remove(), 500);
    }, durationSec * 1000);
  }

  socket.on('connect', () => console.log(`Display ${displayNum} connected`));
  socket.on('disconnect', () => console.log(`Display ${displayNum} disconnected`));

  // --- Screen Wake Lock (prevent screen timeout) ---

  async function requestWakeLock() {
    try {
      if ('wakeLock' in navigator) {
        await navigator.wakeLock.request('screen');
        console.log('Screen wake lock active');
      }
    } catch (e) {
      console.log('Wake lock not available:', e.message);
    }
  }

  // Re-acquire wake lock when page becomes visible again
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') requestWakeLock();
  });

  // --- Hide cursor after 2 seconds ---

  let cursorTimer = null;
  document.addEventListener('mousemove', () => {
    document.body.classList.remove('cursor-hidden');
    clearTimeout(cursorTimer);
    cursorTimer = setTimeout(() => document.body.classList.add('cursor-hidden'), 2000);
  });
  // Start hidden
  cursorTimer = setTimeout(() => document.body.classList.add('cursor-hidden'), 2000);

  // --- Auto-refresh (reload sources with autoRefresh enabled) ---

  const REFRESH_INTERVAL = 5 * 60 * 1000; // 5 minutes

  setInterval(() => {
    gridEl.querySelectorAll('.dash-widget[data-source-id]').forEach(widget => {
      const source = sources.find(s => s.id === widget.dataset.sourceId);
      if (!source || !source.autoRefresh) return;

      if (source.type === 'youtube') {
        // Find YT player in this widget and reload
        const playerDiv = widget.querySelector('[id^="yt-"]');
        if (playerDiv && ytPlayers[playerDiv.id]) {
          console.log(`Auto-refreshing: ${source.title}`);
          ytPlayers[playerDiv.id].loadVideoById(source.videoId);
        }
      } else {
        const iframe = widget.querySelector('iframe');
        if (iframe) {
          console.log(`Auto-refreshing: ${source.title}`);
          iframe.src = source.url;
        }
      }
    });
  }, REFRESH_INTERVAL);

  // --- Init ---

  requestWakeLock();
  loadAll();
})();
