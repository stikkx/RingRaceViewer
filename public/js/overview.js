// RingRaceViewer — Combined Race Overview
// Uses shared module for track + table, adds filter UI and combined layout.

(function () {
  'use strict';

  const socket = io();
  const shared = RRVOverview(socket);

  // --- DOM Refs ---
  const $raceInfo = document.getElementById('race-info');
  const $statusDot = document.getElementById('status-dot');
  const $carCount = document.getElementById('car-count');
  const $trackLength = document.getElementById('track-length');
  const $trackMap = document.getElementById('track-map-container');
  const $trackLegend = document.getElementById('track-legend');
  const $tbody = document.getElementById('results-body');
  const $updateTime = document.getElementById('update-time');
  const $empty = document.getElementById('overview-empty');
  const $content = document.querySelector('.overview-content');
  const $filterSearch = document.getElementById('filter-search');
  const $filterClass = document.getElementById('filter-class');
  const $filterPro = document.getElementById('filter-pro');
  const $filterSector = document.getElementById('filter-sector');
  const $filterPits = document.getElementById('filter-pits');
  const $btnClear = document.getElementById('btn-clear-filters');

  let sortField = 'pos';
  let sortDir = 'asc';

  // --- Load Track SVG ---
  function buildTrackSVG() {
    fetch('/assets/track-nuerburgring.svg')
      .then(r => r.text())
      .then(svgText => {
        $trackMap.innerHTML = svgText;
        const tooltip = document.createElement('div');
        tooltip.className = 'car-tooltip';
        tooltip.id = 'car-tooltip';
        $trackMap.appendChild(tooltip);
      })
      .catch(() => {
        $trackMap.innerHTML = '<div style="color:var(--text-dim);text-align:center">Track map unavailable</div>';
      });
  }

  // --- Populate Filter Dropdowns ---
  function updateFilterOptions() {
    const results = shared.allResults;
    const classes = [...new Set(results.map(r => r.className).filter(Boolean))].sort();

    const currentClass = $filterClass.value;
    $filterClass.innerHTML = '<option value="">All Classes</option>';
    classes.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c; opt.textContent = c;
      if (c === currentClass) opt.selected = true;
      $filterClass.appendChild(opt);
    });

    const currentSector = $filterSector.value;
    $filterSector.innerHTML = '<option value="">All Sectors</option><option value="PIT">Pit Lane</option>';
    for (let i = 1; i <= 9; i++) {
      const opt = document.createElement('option');
      opt.value = String(i); opt.textContent = `Sector ${i}`;
      if (String(i) === currentSector) opt.selected = true;
      $filterSector.appendChild(opt);
    }
  }

  // --- Apply Filters ---
  function getFilteredResults() {
    const search = $filterSearch.value.toLowerCase().trim();
    const cls = $filterClass.value;
    const pro = $filterPro.value;
    const sector = $filterSector.value;
    const pitsOnly = $filterPits.checked;

    return shared.allResults.filter(r => {
      if (search && !`${r.stnr} ${r.name} ${r.team} ${r.car}`.toLowerCase().includes(search)) return false;
      if (cls && r.className !== cls) return false;
      if (pro && r.pro !== pro) return false;
      if (sector === 'PIT' && r.currentSector !== 0 && r.lastLap !== 'PIT') return false;
      else if (sector && sector !== 'PIT' && String(r.currentSector) !== sector) return false;
      if (pitsOnly && r.pits === '0') return false;
      return true;
    });
  }

  // --- Render Table ---
  function renderTable() {
    const filtered = getFilteredResults();
    const sorted = shared.sortResults(filtered, sortField, sortDir);

    $tbody.innerHTML = '';
    sorted.forEach(r => {
      const tr = document.createElement('tr');
      tr.setAttribute('data-stnr', r.stnr);
      tr.innerHTML = shared.buildRowHTML(r);
      $tbody.appendChild(tr);
    });

    $carCount.textContent = `${filtered.length}/${shared.allResults.length} cars`;
    $updateTime.textContent = `Updated ${new Date().toLocaleTimeString()}`;

    shared.renderTrackDots(filtered, $trackMap);
  }

  // --- Sort Header Click ---
  document.querySelectorAll('.results-table th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const field = th.dataset.sort;
      if (sortField === field) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
      else { sortField = field; sortDir = 'asc'; }
      document.querySelectorAll('.results-table th').forEach(h => h.classList.remove('sort-asc', 'sort-desc'));
      th.classList.add(sortDir === 'asc' ? 'sort-asc' : 'sort-desc');
      renderTable();
    });
  });

  // --- Filter Events ---
  $filterSearch.addEventListener('input', renderTable);
  $filterClass.addEventListener('change', renderTable);
  $filterPro.addEventListener('change', renderTable);
  $filterSector.addEventListener('change', renderTable);
  $filterPits.addEventListener('change', renderTable);
  $btnClear.addEventListener('click', () => {
    $filterSearch.value = '';
    $filterClass.value = '';
    $filterPro.value = '';
    $filterSector.value = '';
    $filterPits.checked = false;
    renderTable();
  });

  // --- Socket.io Events ---
  socket.on('connect', () => {
    $statusDot.classList.remove('disconnected');
    $statusDot.title = 'Connected';
  });

  socket.on('disconnect', () => {
    $statusDot.classList.add('disconnected');
    $statusDot.title = 'Disconnected';
  });

  socket.on('timing:full', (data) => {
    shared.handleTimingData(data);
    $raceInfo.textContent = [data.cup, data.heat].filter(Boolean).join(' — ') || 'Race Overview';
    if (data.trackLength) {
      $trackLength.textContent = `${(parseInt(data.trackLength) / 1000).toFixed(1)} km`;
    }
    shared.updateFlag(data.flag);
    $empty.classList.add('hidden');
    $content.classList.remove('hidden');
    updateFilterOptions();
    renderTable();
    shared.renderLegend($trackLegend);
  });

  socket.on('timing:status', (data) => {
    if (data.connected) {
      $statusDot.classList.remove('disconnected');
      $statusDot.title = 'Timing connected: ' + data.url;
    } else {
      $statusDot.classList.add('disconnected');
      $statusDot.title = 'Timing disconnected';
    }
  });

  // --- Init ---
  buildTrackSVG();
  document.querySelector('.results-table th[data-sort="pos"]').classList.add('sort-asc');
  $content.classList.add('hidden');
  shared.initTheme();

})();
