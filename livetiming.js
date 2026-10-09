// RingRaceViewer — Live Timing Integration
// Connects to the Nürburgring live timing WebSocket and detects notable events.

const WebSocket = require('ws');

function createTimingClient(io) {
  let ws = null;
  let connected = false;
  let previousState = null;
  let config = { url: '', eventId: '', enabled: false };
  let reconnectTimer = null;

  // Track best times to detect new records
  let bestLap = null;        // { time, driver, car, stnr }
  let bestSectors = {};      // { '1': { time, driver }, ... }
  let previousPositions = {}; // { stnr: position }

  function parseTime(timeStr) {
    if (!timeStr || timeStr === '' || timeStr === 'PIT') return Infinity;
    // Handle "M:SS.mmm" or "SS.mmm" or "H:MM:SS.mmm"
    const parts = timeStr.split(':');
    if (parts.length === 1) return parseFloat(parts[0]);
    if (parts.length === 2) return parseFloat(parts[0]) * 60 + parseFloat(parts[1]);
    if (parts.length === 3) return parseFloat(parts[0]) * 3600 + parseFloat(parts[1]) * 60 + parseFloat(parts[2]);
    return Infinity;
  }

  function processData(data) {
    if (!data || !data.RESULT) return;

    const results = data.RESULT;
    const notifications = [];

    // Check for new overall fastest lap
    results.forEach(r => {
      if (!r.FASTESTLAP || r.FASTESTLAP === '') return;
      const lapTime = parseTime(r.FASTESTLAP);
      if (lapTime < Infinity && (!bestLap || lapTime < bestLap.time)) {
        // Only notify after initial state is loaded
        if (bestLap !== null) {
          notifications.push({
            type: 'fastest-lap',
            text: `New Fastest Lap: ${r.FASTESTLAP} — #${r.STNR} ${r.NAME} (${r.TEAM})`,
            duration: 60
          });
        }
        bestLap = { time: lapTime, driver: r.NAME, stnr: r.STNR, car: r.CAR };
      }
    });

    // Check for lead change
    const leader = results.find(r => r.POSITION === '1' || r.RANK === '1');
    if (leader && previousPositions[leader.STNR] && previousPositions[leader.STNR] !== '1') {
      notifications.push({
        type: 'lead-change',
        text: `Lead Change: #${leader.STNR} ${leader.NAME} takes P1! (${leader.TEAM})`,
        duration: 60
      });
    }

    // Check for best sector times (sectors 1-9)
    for (let s = 1; s <= 9; s++) {
      const sKey = `S${s}TIME`;
      const stKey = `ST${s}T`;
      results.forEach(r => {
        if (!r[sKey] || r[sKey] === '' || r[sKey] === 'PIT') return;
        // ST*T === "2" indicates overall best sector
        if (r[stKey] === '2') {
          const sectorTime = parseTime(r[sKey]);
          if (!bestSectors[s] || sectorTime < bestSectors[s].time) {
            if (bestSectors[s]) {
              notifications.push({
                type: 'best-sector',
                text: `Best Sector ${s}: ${r[sKey]} — #${r.STNR} ${r.NAME}`,
                duration: 30
              });
            }
            bestSectors[s] = { time: sectorTime, driver: r.NAME, stnr: r.STNR };
          }
        }
      });
    }

    // Store positions for next comparison
    previousPositions = {};
    results.forEach(r => { previousPositions[r.STNR] = r.POSITION; });

    // Broadcast notifications
    notifications.forEach(n => {
      io.emit('message:broadcast', { id: Date.now().toString(36), text: n.text, duration: n.duration, timestamp: Date.now() });
    });

    // Broadcast top-10 timing data for dashboard widgets
    io.emit('timing:update', {
      cup: data.CUP || '',
      heat: data.HEAT || '',
      track: data.TRACKNAME || '',
      results: results.slice(0, 10).map(r => ({
        pos: r.POSITION,
        stnr: r.STNR,
        name: r.NAME,
        team: r.TEAM,
        car: r.CAR,
        className: r.CLASSNAME,
        laps: r.LAPS,
        gap: r.GAP,
        lastLap: r.LASTLAPTIME,
        fastestLap: r.FASTESTLAP,
        pits: r.PITSTOPCOUNT
      }))
    });

    // Broadcast full race data for overview page
    const allResults = results.map(r => {
      // Determine current sector: highest sector with a valid time
      let currentSector = 0;
      for (let s = 1; s <= 9; s++) {
        const val = r[`S${s}TIME`];
        if (val && val !== '' && val !== 'PIT') currentSector = s;
      }
      return {
        pos: r.POSITION,
        classRank: r.CLASSRANK,
        chg: r.CHG,
        stnr: r.STNR,
        name: r.NAME,
        team: r.TEAM,
        car: r.CAR,
        className: r.CLASSNAME,
        pro: r.PRO,
        laps: r.LAPS,
        gap: r.GAP,
        interval: r.INT,
        lastLap: r.LASTLAPTIME,
        lastLapStatus: r.LLTS,
        fastestLap: r.FASTESTLAP,
        fastestLapStatus: r.FLTS,
        pits: r.PITSTOPCOUNT,
        currentSector,
        sectors: Array.from({ length: 9 }, (_, i) => ({
          time: r[`S${i + 1}TIME`] || '',
          status: r[`ST${i + 1}T`] || '0',
          speed: r[`S${i + 1}SPEED`] || ''
        }))
      };
    });

    // Detect flag status from data (Code 60 / Safety Car / Red Flag)
    const flag = data.FLAGSTATUS || data.FLAG || data.TRACKSTATUS || null;

    io.emit('timing:full', {
      cup: data.CUP || '',
      heat: data.HEAT || '',
      heatType: data.HEATTYPE || '',
      track: data.TRACKNAME || '',
      trackLength: data.TRACKLENGTH || '',
      sectors: data.NROFINTERMEDIATETIMES || '0',
      flag,
      best: data.BEST || [],
      results: allResults
    });

    previousState = data;
  }

  function connect() {
    if (!config.url || !config.enabled) return;
    disconnect();

    console.log(`  Timing: connecting to ${config.url}`);

    try {
      ws = new WebSocket(config.url);

      ws.on('open', () => {
        connected = true;
        console.log('  Timing: connected');
        io.emit('timing:status', { connected: true, url: config.url });

        // Reset tracking state on new connection
        bestLap = null;
        bestSectors = {};
        previousPositions = {};
      });

      ws.on('message', (raw) => {
        try {
          const data = JSON.parse(raw.toString());
          if (data.RESULT) {
            processData(data);
          }
        } catch (e) {
          // Not JSON or parse error — ignore
        }
      });

      ws.on('close', () => {
        connected = false;
        console.log('  Timing: disconnected');
        io.emit('timing:status', { connected: false, url: config.url });
        // Auto-reconnect after 5 seconds
        if (config.enabled) {
          reconnectTimer = setTimeout(connect, 5000);
        }
      });

      ws.on('error', (err) => {
        console.log(`  Timing: error — ${err.message}`);
      });
    } catch (e) {
      console.log(`  Timing: connection failed — ${e.message}`);
    }
  }

  function disconnect() {
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    if (ws) {
      try { ws.close(); } catch (e) { /* ignore */ }
      ws = null;
    }
    connected = false;
    io.emit('timing:status', { connected: false, url: '' });
  }

  function getStatus() {
    return { connected, url: config.url, eventId: config.eventId, enabled: config.enabled };
  }

  // Express router for timing API
  const express = require('express');
  const router = express.Router();

  router.get('/status', (_req, res) => {
    res.json(getStatus());
  });

  router.post('/connect', (req, res) => {
    const { url, eventId } = req.body;
    if (!url) return res.status(400).json({ error: 'URL is required' });
    config = { url, eventId: eventId || '', enabled: true };
    connect();
    res.json({ status: 'connecting', url });
  });

  router.post('/disconnect', (_req, res) => {
    config.enabled = false;
    disconnect();
    res.json({ status: 'disconnected' });
  });

  // --- Test mode: simulate live timing with sample data ---

  router.post('/test', (_req, res) => {
    // Reset state so notifications fire
    bestLap = null;
    bestSectors = {};
    previousPositions = {};

    // First call: load initial state (no notifications)
    processData(TEST_DATA);

    // After 2s: simulate a new fastest lap by modifying the data
    setTimeout(() => {
      const updated = JSON.parse(JSON.stringify(TEST_DATA));
      // Verstappen sets a new fastest lap
      const verstappen = updated.RESULT.find(r => r.STNR === '3');
      if (verstappen) {
        verstappen.FASTESTLAP = '8:08.123';
        verstappen.FLTS = '2';
      }
      processData(updated);
    }, 2000);

    // After 5s: simulate lead change
    setTimeout(() => {
      const updated = JSON.parse(JSON.stringify(TEST_DATA));
      // Swap positions 1 and 2
      const p1 = updated.RESULT.find(r => r.POSITION === '1');
      const p2 = updated.RESULT.find(r => r.POSITION === '2');
      if (p1 && p2) {
        p1.POSITION = '2'; p1.RANK = '2';
        p2.POSITION = '1'; p2.RANK = '1';
      }
      processData(updated);
    }, 5000);

    // After 8s: simulate best sector
    setTimeout(() => {
      const updated = JSON.parse(JSON.stringify(TEST_DATA));
      const preining = updated.RESULT.find(r => r.STNR === '911');
      if (preining) {
        preining.S1TIME = '39.501';
        preining.ST1T = '2'; // overall best
      }
      processData(updated);
    }, 8000);

    res.json({ status: 'test started', events: ['initial load (2s)', 'fastest lap (2s)', 'lead change (5s)', 'best sector (8s)'] });
  });

  return router;
}

// Sample data from ADAC 24h Nürburgring Qualifiers for testing
const TEST_DATA = {
  "PID":"0","RECNUM":"0","SND":"0","RCV":"0","VER":"2","EXPORTID":"50",
  "HEATTYPE":"R","SESSION":"4600101102","NROFINTERMEDIATETIMES":"8",
  "TRACKNAME":"Nürburgring","TRACKLENGTH":"25378",
  "CUP":"ADAC 24h Nürburgring Qualifiers","HEAT":"Race 2",
  "BEST":[[16,"39.933",69,"222"],[3,"42.202",920,"240"],[3,"1:02.491",16,"233"],[16,"10.233",632,"276"],[3,"1:45.203",3,"209"],[69,"34.857",632,"258"],[45,"2:25.108",16,"234"],[632,"19.508",925,"280"],[26,"28.163",0,"0"]],
  "RESULT":[
    {"POSITION":"1","RANK":"1","CLASSRANK":"1","CHG":"0","STNR":"16","LAPS":"6","NAME":"Haase","CLASSNAME":"SP 9","PRO":"PRO","CAR":"Audi R8 LMS GT3 evo II","GAP":"----LAP 6","INT":"49:51.957","LASTLAPTIME":"8:30.191","LLTS":"0","FASTESTLAP":"8:11.475","FLTS":"0","PITSTOPCOUNT":"0","S1TIME":"40.029","ST1T":"0","S1SPEED":"218.6","S2TIME":"42.394","ST2T":"0","S2SPEED":"233.2","S3TIME":"1:03.413","ST3T":"0","S3SPEED":"227.8","S4TIME":"10.365","ST4T":"0","S4SPEED":"271.6","S5TIME":"1:47.089","ST5T":"0","S5SPEED":"208.0","TEAM":"Scherer Sport PHX"},
    {"POSITION":"2","RANK":"2","CLASSRANK":"2","CHG":"0","STNR":"3","LAPS":"6","NAME":"Verstappen","CLASSNAME":"SP 9","PRO":"PRO","CAR":"Mercedes-AMG GT3","GAP":"06.971","INT":"6.971","LASTLAPTIME":"8:37.766","LLTS":"0","FASTESTLAP":"8:10.453","FLTS":"2","PITSTOPCOUNT":"1","S1TIME":"3:17.028","ST1T":"0","S1SPEED":"217.7","S2TIME":"42.891","ST2T":"0","S2SPEED":"231.2","TEAM":"Winward Racing"},
    {"POSITION":"3","RANK":"3","CLASSRANK":"3","CHG":"0","STNR":"26","LAPS":"6","NAME":"Christodoulou","CLASSNAME":"SP 9","PRO":"PRO","CAR":"Mercedes-AMG GT3","GAP":"21.412","INT":"14.441","LASTLAPTIME":"8:36.742","LLTS":"0","FASTESTLAP":"8:12.983","FLTS":"0","PITSTOPCOUNT":"0","S1TIME":"40.260","ST1T":"0","S1SPEED":"218.6","S2TIME":"42.888","ST2T":"0","S2SPEED":"232.2","S3TIME":"1:03.226","ST3T":"0","S3SPEED":"223.6","S4TIME":"10.472","ST4T":"0","S4SPEED":"263.7","TEAM":"PROsport racing"},
    {"POSITION":"4","RANK":"4","CLASSRANK":"4","CHG":"0","STNR":"911","LAPS":"6","NAME":"Preining","CLASSNAME":"SP 9","PRO":"PRO","CAR":"Porsche 911 GT3 R (992) Evo26","GAP":"22.012","INT":"0.600","LASTLAPTIME":"8:40.890","LLTS":"0","FASTESTLAP":"8:15.183","FLTS":"0","PITSTOPCOUNT":"0","S1TIME":"40.627","ST1T":"0","S1SPEED":"216.0","S2TIME":"42.764","ST2T":"0","S2SPEED":"232.7","S3TIME":"1:03.702","ST3T":"0","S3SPEED":"222.2","S4TIME":"10.465","ST4T":"0","S4SPEED":"263.7","TEAM":"Manthey Racing GmbH"},
    {"POSITION":"5","RANK":"5","CLASSRANK":"5","CHG":"0","STNR":"84","LAPS":"6","NAME":"Engstler","CLASSNAME":"SP 9","PRO":"PRO","CAR":"Lamborghini Huracan GT3 EVO2","GAP":"22.324","INT":"0.312","LASTLAPTIME":"8:47.969","LLTS":"0","FASTESTLAP":"8:10.686","FLTS":"0","PITSTOPCOUNT":"1","S1TIME":"3:22.479","ST1T":"0","S1SPEED":"215.1","S2TIME":"43.172","ST2T":"0","S2SPEED":"230.7","TEAM":"Red Bull Team ABT"},
    {"POSITION":"6","RANK":"6","CLASSRANK":"6","CHG":"0","STNR":"23","LAPS":"6","NAME":"Kranz","CLASSNAME":"SP 9","PRO":"PROAM","CAR":"BMW M4 GT3 EVO","GAP":"39.729","INT":"17.405","LASTLAPTIME":"8:40.253","LLTS":"0","FASTESTLAP":"8:17.143","FLTS":"0","PITSTOPCOUNT":"0","S1TIME":"40.972","ST1T":"0","S1SPEED":"216.0","S2TIME":"43.114","ST2T":"0","S2SPEED":"233.7","TEAM":"Gamota Racing"},
    {"POSITION":"7","RANK":"7","CLASSRANK":"7","CHG":"0","STNR":"80","LAPS":"6","NAME":"Stolz","CLASSNAME":"SP 9","PRO":"PRO","CAR":"Mercedes-AMG GT3","GAP":"40.619","INT":"0.890","LASTLAPTIME":"8:40.819","LLTS":"0","FASTESTLAP":"8:18.045","FLTS":"0","PITSTOPCOUNT":"0","S1TIME":"40.480","ST1T":"0","S1SPEED":"218.6","S2TIME":"43.063","ST2T":"0","S2SPEED":"233.2","TEAM":"Winward Racing"},
    {"POSITION":"8","RANK":"8","CLASSRANK":"8","CHG":"0","STNR":"5","LAPS":"6","NAME":"Piana","CLASSNAME":"SP 9","PRO":"AM","CAR":"Porsche 911 GT3 R (992) Evo26","GAP":"44.405","INT":"3.786","LASTLAPTIME":"8:43.936","LLTS":"0","FASTESTLAP":"8:17.818","FLTS":"0","PITSTOPCOUNT":"0","S1TIME":"40.698","ST1T":"0","S1SPEED":"216.4","S2TIME":"43.058","ST2T":"0","S2SPEED":"232.2","TEAM":"BLACK FALCON Team EAE"},
    {"POSITION":"9","RANK":"9","CLASSRANK":"9","CHG":"0","STNR":"11","LAPS":"6","NAME":"Fittje","CLASSNAME":"SP 9","PRO":"PROAM","CAR":"Mercedes-AMG GT3","GAP":"44.754","INT":"0.349","LASTLAPTIME":"8:44.634","LLTS":"0","FASTESTLAP":"8:18.843","FLTS":"0","PITSTOPCOUNT":"0","S1TIME":"41.290","ST1T":"0","S1SPEED":"219.9","S2TIME":"43.494","ST2T":"0","S2SPEED":"233.2","TEAM":"Schnitzelalm Racing GmbH"},
    {"POSITION":"10","RANK":"10","CLASSRANK":"10","CHG":"0","STNR":"77","LAPS":"6","NAME":"Weerts","CLASSNAME":"SP 9","PRO":"PRO","CAR":"BMW M4 GT3 EVO","GAP":"54.949","INT":"10.195","LASTLAPTIME":"8:39.465","LLTS":"0","FASTESTLAP":"8:15.382","FLTS":"0","PITSTOPCOUNT":"0","S1TIME":"40.365","ST1T":"0","S1SPEED":"215.5","S2TIME":"42.883","ST2T":"0","S2SPEED":"232.2","TEAM":"Schubert Motorsport GmbH"},
    {"POSITION":"11","RANK":"1","CLASSRANK":"1","CHG":"2","STNR":"100","LAPS":"6","NAME":"Müller","CLASSNAME":"SP-X","PRO":"PRO","CAR":"Glickenhaus SCG004C","GAP":"1:02.310","INT":"7.361","LASTLAPTIME":"8:52.444","LLTS":"0","FASTESTLAP":"8:38.120","FLTS":"0","PITSTOPCOUNT":"1","S1TIME":"42.150","ST1T":"0","S1SPEED":"210.3","S2TIME":"44.801","ST2T":"0","S2SPEED":"225.1","S3TIME":"1:06.220","ST3T":"0","S3SPEED":"218.5","TEAM":"Glickenhaus Racing"},
    {"POSITION":"12","RANK":"2","CLASSRANK":"2","CHG":"-1","STNR":"101","LAPS":"6","NAME":"Juncadella","CLASSNAME":"SP-X","PRO":"PRO","CAR":"Glickenhaus SCG004C","GAP":"1:05.880","INT":"3.570","LASTLAPTIME":"8:55.201","LLTS":"0","FASTESTLAP":"8:40.305","FLTS":"0","PITSTOPCOUNT":"0","S1TIME":"42.610","ST1T":"0","S1SPEED":"209.8","S2TIME":"45.012","ST2T":"0","S2SPEED":"224.3","S3TIME":"1:06.800","ST3T":"0","S3SPEED":"217.2","S4TIME":"10.912","ST4T":"0","S4SPEED":"258.1","S5TIME":"1:52.110","ST5T":"0","S5SPEED":"201.4","TEAM":"Glickenhaus Racing"},
    {"POSITION":"13","RANK":"1","CLASSRANK":"1","CHG":"0","STNR":"200","LAPS":"5","NAME":"Güven","CLASSNAME":"CUP2","PRO":"PROAM","CAR":"Porsche 992 GT3 Cup","GAP":"1 LAP","INT":"1 LAP","LASTLAPTIME":"9:10.553","LLTS":"0","FASTESTLAP":"8:55.220","FLTS":"0","PITSTOPCOUNT":"0","S1TIME":"43.880","ST1T":"0","S1SPEED":"205.2","S2TIME":"46.012","ST2T":"0","S2SPEED":"219.8","S3TIME":"1:08.450","ST3T":"0","S3SPEED":"214.1","S4TIME":"11.201","ST4T":"0","S4SPEED":"252.3","S5TIME":"1:55.120","ST5T":"0","S5SPEED":"196.8","S6TIME":"36.410","ST6T":"0","S6SPEED":"248.2","TEAM":"Attempto Racing"},
    {"POSITION":"14","RANK":"2","CLASSRANK":"2","CHG":"1","STNR":"201","LAPS":"5","NAME":"Ammermüller","CLASSNAME":"CUP2","PRO":"PROAM","CAR":"Porsche 992 GT3 Cup","GAP":"1 LAP","INT":"12.440","LASTLAPTIME":"9:15.820","LLTS":"0","FASTESTLAP":"9:01.105","FLTS":"0","PITSTOPCOUNT":"1","S1TIME":"44.220","ST1T":"0","S1SPEED":"204.1","S2TIME":"46.330","ST2T":"0","S2SPEED":"218.5","S3TIME":"1:09.110","ST3T":"0","S3SPEED":"212.8","S4TIME":"11.350","ST4T":"0","S4SPEED":"250.0","S5TIME":"1:56.800","ST5T":"0","S5SPEED":"194.5","S6TIME":"37.020","ST6T":"0","S6SPEED":"245.8","S7TIME":"2:30.220","ST7T":"0","S7SPEED":"188.3","TEAM":"Herberth Motorsport"},
    {"POSITION":"15","RANK":"1","CLASSRANK":"1","CHG":"0","STNR":"300","LAPS":"5","NAME":"Proczyk","CLASSNAME":"TCR","PRO":"AM","CAR":"Hyundai Elantra N TCR","GAP":"1 LAP","INT":"5.880","LASTLAPTIME":"9:45.112","LLTS":"0","FASTESTLAP":"9:32.440","FLTS":"0","PITSTOPCOUNT":"0","S1TIME":"46.550","ST1T":"0","S1SPEED":"195.3","S2TIME":"48.220","ST2T":"0","S2SPEED":"210.1","S3TIME":"1:12.880","ST3T":"0","S3SPEED":"205.2","S4TIME":"12.010","ST4T":"0","S4SPEED":"240.1","S5TIME":"2:02.330","ST5T":"0","S5SPEED":"188.4","S6TIME":"38.870","ST6T":"0","S6SPEED":"238.5","S7TIME":"2:38.440","ST7T":"0","S7SPEED":"180.2","S8TIME":"21.550","ST8T":"0","S8SPEED":"268.3","TEAM":"Hyundai Motorsport"},
    {"POSITION":"16","RANK":"2","CLASSRANK":"2","CHG":"0","STNR":"301","LAPS":"5","NAME":"Langeveld","CLASSNAME":"TCR","PRO":"AM","CAR":"Audi RS 3 LMS II","GAP":"1 LAP","INT":"8.201","LASTLAPTIME":"9:48.330","LLTS":"0","FASTESTLAP":"9:35.880","FLTS":"0","PITSTOPCOUNT":"0","S1TIME":"46.880","ST1T":"0","S1SPEED":"194.8","S2TIME":"48.550","ST2T":"0","S2SPEED":"209.3","S3TIME":"1:13.220","ST3T":"0","S3SPEED":"204.1","S4TIME":"12.150","ST4T":"0","S4SPEED":"238.8","S5TIME":"2:03.010","ST5T":"0","S5SPEED":"187.2","S6TIME":"39.110","ST6T":"0","S6SPEED":"237.1","S7TIME":"2:39.220","ST7T":"0","S7SPEED":"179.4","S8TIME":"21.880","ST8T":"0","S8SPEED":"266.5","S9TIME":"29.550","ST9T":"0","S9SPEED":"205.1","TEAM":"Comtoyou Racing"},
    {"POSITION":"17","RANK":"1","CLASSRANK":"1","CHG":"3","STNR":"400","LAPS":"5","NAME":"Schrey","CLASSNAME":"SP 3","PRO":"AM","CAR":"BMW M240i Racing","GAP":"1 LAP","INT":"2.440","LASTLAPTIME":"9:58.880","LLTS":"0","FASTESTLAP":"9:42.105","FLTS":"0","PITSTOPCOUNT":"2","S1TIME":"47.220","ST1T":"0","S1SPEED":"192.1","S2TIME":"49.010","ST2T":"0","S2SPEED":"207.5","S3TIME":"1:14.550","ST3T":"0","S3SPEED":"202.0","S4TIME":"12.330","ST4T":"0","S4SPEED":"236.5","TEAM":"Walkenhorst Motorsport"},
    {"POSITION":"18","RANK":"2","CLASSRANK":"2","CHG":"-2","STNR":"401","LAPS":"5","NAME":"Trebing","CLASSNAME":"SP 3","PRO":"AM","CAR":"BMW M240i Racing","GAP":"1 LAP","INT":"15.220","LASTLAPTIME":"10:02.110","LLTS":"0","FASTESTLAP":"9:48.550","FLTS":"0","PITSTOPCOUNT":"0","S1TIME":"47.660","ST1T":"0","S1SPEED":"191.2","S2TIME":"49.440","ST2T":"0","S2SPEED":"206.3","S3TIME":"1:15.010","ST3T":"0","S3SPEED":"201.1","S4TIME":"12.510","ST4T":"0","S4SPEED":"235.0","S5TIME":"2:05.880","ST5T":"0","S5SPEED":"184.2","S6TIME":"39.880","ST6T":"0","S6SPEED":"232.5","S7TIME":"2:42.110","ST7T":"0","S7SPEED":"176.8","S8TIME":"22.440","ST8T":"0","S8SPEED":"262.1","S9TIME":"30.220","ST9T":"0","S9SPEED":"200.5","TEAM":"Schnitzelalm Racing GmbH"},
    {"POSITION":"19","RANK":"3","CLASSRANK":"3","CHG":"0","STNR":"402","LAPS":"5","NAME":"Holthaus","CLASSNAME":"SP 3","PRO":"AM","CAR":"Toyota GR Supra GT4","GAP":"1 LAP","INT":"3.110","LASTLAPTIME":"10:05.330","LLTS":"0","FASTESTLAP":"9:50.880","FLTS":"0","PITSTOPCOUNT":"1","S1TIME":"48.010","ST1T":"0","S1SPEED":"190.5","S2TIME":"49.880","ST2T":"0","S2SPEED":"205.0","S3TIME":"1:15.440","ST3T":"0","S3SPEED":"200.3","S4TIME":"12.660","ST4T":"0","S4SPEED":"233.8","S5TIME":"2:06.550","ST5T":"0","S5SPEED":"183.5","S6TIME":"40.110","ST6T":"0","S6SPEED":"231.2","TEAM":"Ring Racing"},
    {"POSITION":"20","RANK":"3","CLASSRANK":"3","CHG":"0","STNR":"202","LAPS":"5","NAME":"Olsen","CLASSNAME":"CUP2","PRO":"AM","CAR":"Porsche 992 GT3 Cup","GAP":"1 LAP","INT":"0.550","LASTLAPTIME":"9:18.440","LLTS":"0","FASTESTLAP":"9:05.220","FLTS":"0","PITSTOPCOUNT":"2","S1TIME":"44.550","ST1T":"0","S1SPEED":"203.5","S2TIME":"46.660","ST2T":"0","S2SPEED":"217.8","S3TIME":"1:09.550","ST3T":"0","S3SPEED":"211.5","S4TIME":"11.510","ST4T":"0","S4SPEED":"248.5","S5TIME":"1:57.440","ST5T":"0","S5SPEED":"193.8","S6TIME":"37.330","ST6T":"0","S6SPEED":"244.5","S7TIME":"2:31.550","ST7T":"0","S7SPEED":"187.1","S8TIME":"20.880","ST8T":"0","S8SPEED":"270.2","S9TIME":"28.880","ST9T":"0","S9SPEED":"208.0","TEAM":"ID Racing"}
  ]
};

module.exports = { createTimingClient };
