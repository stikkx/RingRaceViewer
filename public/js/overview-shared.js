// RingRaceViewer — Shared Overview Logic
// Used by overview.html, overview-track.html, and overview-table.html

function RRVOverview(socket) {
  'use strict';

  // --- State ---
  let allResults = [];
  let classColors = {};
  let colorIndex = 0;

  const CLASS_PALETTE = [
    '#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#a855f7',
    '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#84cc16',
    '#06b6d4', '#e11d48', '#8b5cf6', '#10b981', '#d946ef',
    '#0ea5e9', '#facc15', '#fb7185', '#34d399', '#c084fc'
  ];

  // Sector positions on the Nürburgring SVG (viewBox 0 0 700 650)
  const SECTOR_POINTS = [
    { x: 275, y: 425 },  // S/F
    { x: 230, y: 415 },  // S1
    { x: 155, y: 360 },  // S2
    { x: 135, y: 260 },  // S3
    { x: 175, y: 168 },  // S4
    { x: 210, y: 100 },  // S5
    { x: 345, y: 55  },  // S6
    { x: 535, y: 80  },  // S7
    { x: 570, y: 155 },  // S8
    { x: 460, y: 280 },  // S9
  ];

  function getClassColor(className) {
    if (!className) return '#666';
    if (!classColors[className]) {
      classColors[className] = CLASS_PALETTE[colorIndex % CLASS_PALETTE.length];
      colorIndex++;
    }
    return classColors[className];
  }

  function getCarPosition(sector, offset) {
    const idx = Math.max(0, Math.min(sector, SECTOR_POINTS.length - 1));
    const nextIdx = (idx + 1) % SECTOR_POINTS.length;
    const p1 = SECTOR_POINTS[idx];
    const p2 = SECTOR_POINTS[nextIdx];
    const t = Math.min(1, Math.max(0, offset));
    return {
      x: p1.x + (p2.x - p1.x) * t,
      y: p1.y + (p2.y - p1.y) * t
    };
  }

  function parseTime(str) {
    if (!str || str === '' || str === 'PIT') return Infinity;
    const parts = str.split(':');
    if (parts.length === 1) return parseFloat(parts[0]) || Infinity;
    if (parts.length === 2) return parseFloat(parts[0]) * 60 + parseFloat(parts[1]);
    if (parts.length === 3) return parseFloat(parts[0]) * 3600 + parseFloat(parts[1]) * 60 + parseFloat(parts[2]);
    return Infinity;
  }

  function sortResults(results, field, dir) {
    const copy = [...results];
    copy.sort((a, b) => {
      let va = a[field], vb = b[field];
      if (['pos', 'laps', 'pits', 'stnr', 'currentSector'].includes(field)) {
        va = parseInt(va) || 0; vb = parseInt(vb) || 0;
      }
      if (['lastLap', 'fastestLap'].includes(field)) {
        va = parseTime(va); vb = parseTime(vb);
      }
      if (va < vb) return dir === 'asc' ? -1 : 1;
      if (va > vb) return dir === 'asc' ? 1 : -1;
      return 0;
    });
    return copy;
  }

  function handleTimingData(data) {
    allResults = data.results || [];
  }

  function updateFlag(flag) {
    const $indicator = document.getElementById('flag-indicator');
    const $icon = document.getElementById('flag-icon');
    const $text = document.getElementById('flag-text');
    if (!$indicator) return;

    if (!flag) {
      $indicator.className = 'flag-indicator green';
      $icon.textContent = '\u2691';
      $text.textContent = 'Green';
      return;
    }
    const f = flag.toString().toUpperCase();
    if (f.includes('CODE 60') || f.includes('CODE60') || f === 'SLOW') {
      $indicator.className = 'flag-indicator code60'; $icon.textContent = '60'; $text.textContent = 'Code 60';
    } else if (f.includes('YELLOW') || f === 'FCY' || f.includes('CAUTION')) {
      $indicator.className = 'flag-indicator yellow'; $icon.textContent = '\u26A0'; $text.textContent = 'Yellow';
    } else if (f.includes('RED') || f.includes('STOP')) {
      $indicator.className = 'flag-indicator red'; $icon.textContent = '\u26D4'; $text.textContent = 'Red Flag';
    } else if (f.includes('SAFETY') || f.includes('SC') || f.includes('VSC')) {
      $indicator.className = 'flag-indicator safety'; $icon.textContent = '\uD83D\uDE93'; $text.textContent = f.includes('VSC') ? 'VSC' : 'Safety Car';
    } else if (f.includes('GREEN') || f === 'NONE') {
      $indicator.className = 'flag-indicator green'; $icon.textContent = '\u2691'; $text.textContent = 'Green';
    } else {
      $indicator.className = 'flag-indicator yellow'; $icon.textContent = '\u2691'; $text.textContent = flag;
    }
  }

  function renderTrackDots(results, $container) {
    const group = $container.querySelector('#cars-group');
    if (!group) return;
    group.innerHTML = '';

    const tooltip = $container.querySelector('#car-tooltip') || document.getElementById('car-tooltip');

    // Group by sector
    const sectorGroups = {};
    results.forEach(r => {
      const s = r.currentSector || 0;
      if (!sectorGroups[s]) sectorGroups[s] = [];
      sectorGroups[s].push(r);
    });

    const dotRadius = results.length > 50 ? 7 : 10;
    const fontSize = results.length > 50 ? 8 : 11;

    results.forEach(r => {
      const sector = r.currentSector || 0;
      const carsInSector = sectorGroups[sector] || [];
      const idx = carsInSector.indexOf(r);
      const spread = carsInSector.length > 1 ? idx / (carsInSector.length - 1) : 0.5;
      const offset = 0.15 + spread * 0.7;
      const pos = getCarPosition(sector, offset);
      const color = getClassColor(r.className);

      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');

      const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      dot.setAttribute('cx', pos.x);
      dot.setAttribute('cy', pos.y);
      dot.setAttribute('r', dotRadius);
      dot.setAttribute('class', 'car-dot');
      dot.setAttribute('fill', color);
      g.appendChild(dot);

      const numLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      numLabel.setAttribute('x', pos.x);
      numLabel.setAttribute('y', pos.y);
      numLabel.setAttribute('class', 'car-dot-label');
      numLabel.setAttribute('style', `font-size:${fontSize}px`);
      numLabel.textContent = r.stnr;
      g.appendChild(numLabel);

      const posLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      posLabel.setAttribute('x', pos.x);
      posLabel.setAttribute('y', pos.y + dotRadius + 9);
      posLabel.setAttribute('class', 'car-pos-label');
      posLabel.textContent = `P${r.pos}`;
      g.appendChild(posLabel);

      if (tooltip) {
        g.addEventListener('mouseenter', () => {
          tooltip.innerHTML = `<strong>#${r.stnr} ${r.name}</strong><br>${r.team}<br>${r.car}<br>P${r.pos} | Lap ${r.laps} | Sector ${sector}`;
          tooltip.classList.add('visible');
        });
        g.addEventListener('mousemove', (e) => {
          const rect = $container.getBoundingClientRect();
          tooltip.style.left = (e.clientX - rect.left + 14) + 'px';
          tooltip.style.top = (e.clientY - rect.top - 14) + 'px';
        });
        g.addEventListener('mouseleave', () => {
          tooltip.classList.remove('visible');
        });
      }

      group.appendChild(g);
    });
  }

  function renderLegend($el) {
    if (!$el) return;
    $el.innerHTML = '';
    Object.entries(classColors).forEach(([cls, color]) => {
      const item = document.createElement('span');
      item.className = 'legend-item';
      item.innerHTML = `<span class="legend-dot" style="background:${color}"></span><span class="legend-label">${cls}</span>`;
      $el.appendChild(item);
    });
  }

  function buildRowHTML(r) {
    let chgHtml = '<span class="chg-same">-</span>';
    const chg = parseInt(r.chg) || 0;
    if (chg > 0) chgHtml = `<span class="chg-up">+${chg}</span>`;
    else if (chg < 0) chgHtml = `<span class="chg-down">${chg}</span>`;

    const flClass = r.fastestLapStatus === '2' ? 'time-best' : (r.fastestLapStatus === '1' ? 'time-pb' : '');
    const llClass = r.lastLapStatus === '2' ? 'time-best' : (r.lastLapStatus === '1' ? 'time-pb' : '');
    const clsColor = getClassColor(r.className);
    const classBadge = `<span class="class-badge" style="background:${clsColor}22;color:${clsColor};border:1px solid ${clsColor}44">${r.className || '-'}</span>`;
    const catClass = r.pro === 'PRO' ? 'cat-pro' : (r.pro === 'PROAM' ? 'cat-proam' : 'cat-am');
    const sectorDot = `<span class="sector-dot" style="background:${clsColor}"></span>${r.currentSector || '-'}`;

    return `
      <td class="col-pos">${r.pos}</td>
      <td class="col-chg">${chgHtml}</td>
      <td class="col-stnr">${r.stnr}</td>
      <td class="col-driver">${r.name}</td>
      <td class="col-team">${r.team}</td>
      <td class="col-car">${r.car}</td>
      <td class="col-class">${classBadge}</td>
      <td class="col-cat"><span class="${catClass}">${r.pro || '-'}</span></td>
      <td class="col-laps">${r.laps}</td>
      <td class="col-gap">${r.gap || '-'}</td>
      <td class="col-int">${r.interval || '-'}</td>
      <td class="col-last ${llClass}">${r.lastLap || '-'}</td>
      <td class="col-best ${flClass}">${r.fastestLap || '-'}</td>
      <td class="col-pits">${parseInt(r.pits) > 0 ? r.pits : '-'}</td>
      <td class="col-sector">${sectorDot}</td>
    `;
  }

  function initTheme() {
    fetch('/api/theme')
      .then(r => r.json())
      .then(theme => applyTheme(theme))
      .catch(() => {});
    socket.on('theme:changed', theme => applyTheme(theme));
  }

  function applyTheme(theme) {
    if (theme.primaryColor) document.documentElement.style.setProperty('--primary', theme.primaryColor);
    if (theme.accentColor) document.documentElement.style.setProperty('--accent', theme.accentColor);
    if (theme.backgroundColor) document.documentElement.style.setProperty('--bg', theme.backgroundColor);
    if (theme.surfaceColor) document.documentElement.style.setProperty('--surface', theme.surfaceColor);
    if (theme.textColor) document.documentElement.style.setProperty('--text', theme.textColor);
  }

  return {
    get allResults() { return allResults; },
    getClassColor,
    handleTimingData,
    updateFlag,
    renderTrackDots,
    renderLegend,
    buildRowHTML,
    sortResults,
    parseTime,
    initTheme
  };
}
