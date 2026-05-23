const { ipcRenderer } = require('electron');
const path = require('path');
const fs   = require('fs');

// ── Persist settings to disk ──
const settingsPath = path.join(
  require('os').homedir(),
  '.classroom-timer-settings.json'
);

function loadSettingsFromDisk() {
  try {
    if (fs.existsSync(settingsPath)) {
      return JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    }
  } catch(e) {}
  return null;
}

function saveSettingsToDisk(s) {
  try {
    fs.writeFileSync(settingsPath, JSON.stringify(s, null, 2));
  } catch(e) {}
}

// ── State ──
let settings = null;
let totalSeconds = 0;
let remainingSeconds = 0;
let timerInterval = null;
let isRunning = false;

// ── DOM refs ──
const circularWidget  = document.getElementById('circular-widget');
const barWidget       = document.getElementById('bar-widget');
const timeDisplay     = document.getElementById('time-display');
const canvas          = document.getElementById('dial');
const ctx             = canvas.getContext('2d');
const barSegments     = document.getElementById('bar-segments');
const barMarker       = document.getElementById('bar-marker');
const barTimeOverlay  = document.getElementById('bar-time-overlay');

// ── Boot: load from disk first, then ask main for any override ──
const diskSettings = loadSettingsFromDisk();
if (diskSettings) {
  applySettings(diskSettings);
}
ipcRenderer.send('get-settings');

ipcRenderer.on('apply-settings', (event, s) => {
  applySettings(s);
});

function applySettings(s) {
  settings         = s;
  totalSeconds     = s.duration;
  remainingSeconds = s.duration;
  isRunning        = false;
  clearInterval(timerInterval);
  saveSettingsToDisk(s);
  applyMode();
  buildBarSegments();
  render();
}

// ── Mode toggle (on widget) ──
document.getElementById('btn-mode').addEventListener('click', toggleMode);
document.getElementById('bar-btn-mode').addEventListener('click', toggleMode);

function toggleMode() {
  if (!settings) return;
  settings.mode = settings.mode === 'circular' ? 'bar' : 'circular';
  saveSettingsToDisk(settings);
  ipcRenderer.send('switch-mode', settings);
}

// ── Gear ──
document.getElementById('btn-gear').addEventListener('click', () => ipcRenderer.send('open-settings'));
document.getElementById('bar-btn-gear').addEventListener('click', () => ipcRenderer.send('open-settings'));

document.getElementById('btn-exit').addEventListener('click', () => ipcRenderer.send('exit-app'));
document.getElementById('bar-btn-exit').addEventListener('click', () => ipcRenderer.send('exit-app'));

document.getElementById('btn-exit').addEventListener('click', () => {
  ipcRenderer.send('exit-app');
});
document.getElementById('bar-btn-exit').addEventListener('click', () => {
  ipcRenderer.send('exit-app');
});

// ── Playback controls ──
document.getElementById('btn-start').addEventListener('click', startTimer);
document.getElementById('bar-btn-start').addEventListener('click', startTimer);
document.getElementById('btn-pause').addEventListener('click', pauseTimer);
document.getElementById('bar-btn-pause').addEventListener('click', pauseTimer);
document.getElementById('btn-reset').addEventListener('click', resetTimer);
document.getElementById('bar-btn-reset').addEventListener('click', resetTimer);

function startTimer() {
  if (isRunning) return;
  if (remainingSeconds <= 0) remainingSeconds = totalSeconds;
  isRunning = true;
  timerInterval = setInterval(() => {
    remainingSeconds--;
    render();
    if (remainingSeconds <= 0) {
      clearInterval(timerInterval);
      isRunning = false;
      onTimerEnd();
    }
  }, 1000);
}

function pauseTimer() {
  isRunning = false;
  clearInterval(timerInterval);
}

function resetTimer() {
  isRunning = false;
  clearInterval(timerInterval);
  remainingSeconds = totalSeconds;
  render();
}

function onTimerEnd() {
  if (settings && settings.sound) {
    try {
      const beep = new AudioContext();
      const osc  = beep.createOscillator();
      const gain = beep.createGain();
      osc.connect(gain);
      gain.connect(beep.destination);
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.6, beep.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, beep.currentTime + 1.2);
      osc.start();
      osc.stop(beep.currentTime + 1.2);
    } catch(e) {}
  }
}

// ── Apply mode ──
function applyMode() {
  if (!settings) return;
  if (settings.mode === 'bar') {
    circularWidget.classList.add('hidden');
    barWidget.classList.remove('hidden');
  } else {
    barWidget.classList.add('hidden');
    circularWidget.classList.remove('hidden');
  }
}

// ── Zone helper ──
function getCurrentZone() {
  if (!settings) return { label: 'Ready', color: '#27ae60', index: 0 };
  const pct = (remainingSeconds / totalSeconds) * 100;
  for (let i = 0; i < settings.zones.length; i++) {
    if (pct >= settings.zones[i].threshold) {
      return { ...settings.zones[i], index: i };
    }
  }
  return { ...settings.zones[settings.zones.length - 1], index: settings.zones.length - 1 };
}

function formatTime(s) {
  const m   = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
}

// ── Build bar segments (once per settings load) ──
function buildBarSegments() {
  barSegments.innerHTML = '';
  if (!settings) return;
  // Zones ordered: zone[0]=75-100%, zone[1]=50-75%, zone[2]=25-50%, zone[3]=0-25%
  // In bar left→right means time passing, so zone[0] is leftmost (most time)
  settings.zones.forEach((zone, i) => {
    const seg = document.createElement('div');
    seg.className = 'bar-segment';
    seg.id = `seg-${i}`;
    seg.style.background = zone.color;
    seg.textContent = zone.label;
    barSegments.appendChild(seg);
  });
}

// ── Render ──
function render() {
  if (!settings) return;
  const pct     = totalSeconds > 0 ? remainingSeconds / totalSeconds : 1;
  const zone    = getCurrentZone();
  const formatted = formatTime(remainingSeconds);

  if (settings.mode === 'circular') {
    timeDisplay.textContent = formatted;
    drawDial(pct, zone);
  } else {
    renderBar(pct, zone, formatted);
  }
}

// ── Draw circular dial with 4 quadrant labels ──
// function drawDial(pct, currentZone) {
//   const cx = 160, cy = 160;
//   const outerR = 148, trackR = 128, innerR = 100;
//   ctx.clearRect(0, 0, 320, 320);

//   if (!settings) return;
//   const zones = settings.zones;

//   // Each zone occupies 25% = 90 degrees
//   // Start from top (-90deg), go clockwise
//   // zone[0] = first 90deg (12 o'clock → 3 o'clock)
//   // zone[1] = 3 o'clock → 6 o'clock
//   // zone[2] = 6 o'clock → 9 o'clock
//   // zone[3] = 9 o'clock → 12 o'clock
//   const segAngle = (Math.PI * 2) / 4;
//   const startOffset = -Math.PI / 2;

//   zones.forEach((zone, i) => {
//     const segStart = startOffset + i * segAngle;
//     const segEnd   = segStart + segAngle;

//     // Outer ring segment
//     ctx.beginPath();
//     ctx.arc(cx, cy, outerR, segStart, segEnd);
//     ctx.arc(cx, cy, trackR, segEnd, segStart, true);
//     ctx.closePath();
//     ctx.fillStyle = zone.color;
//     ctx.fill();

//     // Divider lines
//     ctx.beginPath();
//     ctx.moveTo(cx + trackR * Math.cos(segStart), cy + trackR * Math.sin(segStart));
//     ctx.lineTo(cx + outerR * Math.cos(segStart), cy + outerR * Math.sin(segStart));
//     ctx.strokeStyle = 'rgba(0,0,0,0.5)';
//     ctx.lineWidth = 2;
//     ctx.stroke();

//     // Zone label on ring
//     const labelAngle = segStart + segAngle / 2;
//     const labelR     = (outerR + trackR) / 2;
//     const lx = cx + labelR * Math.cos(labelAngle);
//     const ly = cy + labelR * Math.sin(labelAngle);

//     // ctx.save();
//     // ctx.translate(lx, ly);
//     // ctx.rotate(labelAngle + Math.PI / 2);
//     // ctx.fillStyle = 'rgba(255,255,255,0.95)';
//     // ctx.font = 'bold 11px Segoe UI, Arial';
//     // ctx.textAlign = 'center';
//     // ctx.textBaseline = 'middle';
//     // ctx.fillText(zone.label.toUpperCase(), 0, 0);
//     // ctx.restore();

//     ctx.save();
//     ctx.translate(lx, ly);
//     // Keep text always readable — flip if in bottom half
//     let angle = labelAngle + Math.PI / 2;
//     if (labelAngle > Math.PI / 2 && labelAngle < Math.PI * 1.5) {
//     angle += Math.PI;
//     }
//     ctx.rotate(angle);
//     ctx.fillStyle = 'rgba(255,255,255,0.95)';
//     ctx.font = 'bold 11px Segoe UI, Arial';
//     ctx.textAlign = 'center';
//     ctx.textBaseline = 'middle';
//     ctx.fillText(zone.label.toUpperCase(), 0, 0);
//     ctx.restore();

//   });

//   // Inner dark circle
//   ctx.beginPath();
//   ctx.arc(cx, cy, innerR, 0, Math.PI * 2);
//   ctx.fillStyle = 'rgba(12,14,20,0.96)';
//   ctx.fill();

//   // Needle — sweeps from 12 o'clock clockwise
//   // pct=1 means full time, needle at 12. pct=0 means done, needle back at 12
//   // Needle sweeps full circle as time depletes
//   const needleAngle = startOffset + (1 - pct) * Math.PI * 2;
//   const needleLen   = trackR - 8;
//   const nx = cx + needleLen * Math.cos(needleAngle);
//   const ny = cy + needleLen * Math.sin(needleAngle);

//   // Needle glow
//   ctx.shadowColor = '#ffffff';
//   ctx.shadowBlur  = 8;
//   ctx.beginPath();
//   ctx.moveTo(cx, cy);
//   ctx.lineTo(nx, ny);
//   ctx.strokeStyle = '#ffffff';
//   ctx.lineWidth   = 2.5;
//   ctx.lineCap     = 'round';
//   ctx.stroke();
//   ctx.shadowBlur = 0;

//   // Center dot
//   ctx.beginPath();
//   ctx.arc(cx, cy, 6, 0, Math.PI * 2);
//   ctx.fillStyle = '#ffffff';
//   ctx.fill();

//   // Outer border
//   ctx.beginPath();
//   ctx.arc(cx, cy, outerR + 4, 0, Math.PI * 2);
//   ctx.strokeStyle = 'rgba(255,255,255,0.08)';
//   ctx.lineWidth   = 3;
//   ctx.stroke();
// }

function drawDial(pct, currentZone) {
  const cx = 160, cy = 150;
  const outerR = 148, trackR = 100, innerR = 88;
  ctx.clearRect(0, 0, 320, 320);

  if (!settings) return;
  const zones = settings.zones;
  const segAngle   = (Math.PI * 2) / 4;
  const startOffset = -Math.PI / 2;

  // Draw 4 quadrant segments
  zones.forEach((zone, i) => {
    const segStart = startOffset + i * segAngle;
    const segEnd   = segStart + segAngle;

    // Ring segment
    ctx.beginPath();
    ctx.arc(cx, cy, outerR, segStart, segEnd);
    ctx.arc(cx, cy, trackR, segEnd, segStart, true);
    ctx.closePath();
    ctx.fillStyle = zone.color;
    ctx.fill();

    // Divider lines
    ctx.beginPath();
    ctx.moveTo(
      cx + trackR * Math.cos(segStart),
      cy + trackR * Math.sin(segStart)
    );
    ctx.lineTo(
      cx + outerR * Math.cos(segStart),
      cy + outerR * Math.sin(segStart)
    );
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // Label — placed flat, no rotation
    const labelAngle = segStart + segAngle / 2;
    const labelR     = (outerR + trackR) / 2;
    const lx = cx + labelR * Math.cos(labelAngle);
    const ly = cy + labelR * Math.sin(labelAngle);

    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.font = 'bold 12px Segoe UI, Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(zone.label.toUpperCase(), lx, ly);
  });

  // Inner dark circle
  ctx.beginPath();
  ctx.arc(cx, cy, innerR, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(12,14,20,0.97)';
  ctx.fill();

  // Needle
  const needleAngle = startOffset + (1 - pct) * Math.PI * 2;
  const needleLen   = outerR - 4;
  const nx = cx + needleLen * Math.cos(needleAngle);
  const ny = cy + needleLen * Math.sin(needleAngle);

  ctx.shadowColor = '#ffffff';
  ctx.shadowBlur  = 10;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(nx, ny);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth   = 2.5;
  ctx.lineCap     = 'round';
  ctx.stroke();
  ctx.shadowBlur  = 0;

  // Center dot
  ctx.beginPath();
  ctx.arc(cx, cy, 5, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
}

// ── Render bar ──
function renderBar(pct, currentZone, formatted) {
  if (!settings) return;

  // Dim segments that are "past" (time has passed through them)
  // pct=1 full time, pct=0 done
  // zone[0]=75-100%, zone[1]=50-75%, zone[2]=25-50%, zone[3]=0-25%
  // A zone is "active" if current pct is within its range
  // A zone is "past" (dimmed) if pct has dropped below its threshold
  const currentPct = pct * 100;
  settings.zones.forEach((zone, i) => {
    const seg = document.getElementById(`seg-${i}`);
    if (!seg) return;
    // Each zone spans from zone.threshold down to the next zone's threshold
    // zone[0]: 75-100%, zone[1]: 50-75%, zone[2]: 25-50%, zone[3]: 0-25%
    // Upper bound of this zone
    const upperBound = i === 0 ? 100 : settings.zones[i - 1].threshold;
    // Segment is fully past when marker has moved beyond its upper bound
    const isPast = currentPct < zone.threshold;
    // Segment is active (marker currently inside it)
    const isActive = currentPct >= zone.threshold && currentPct < upperBound;
    seg.classList.toggle('dimmed', isPast);

    
   });

  // Marker position — moves left to right as time runs out
  // pct=1 → left=0%, pct=0 → left=100%
  const markerLeft = (1 - pct) * 100;
  const barW = barWidget.offsetWidth || window.innerWidth;
  const markerPx = (markerLeft / 100) * barW;

  barMarker.style.left = `${markerPx}px`;

  // Time overlay follows marker
  barTimeOverlay.textContent = formatted;
  const overlayW = 70;
  let overlayLeft = markerPx - overlayW / 2;
  overlayLeft = Math.max(4, Math.min(overlayLeft, barW - overlayW - 4));
  barTimeOverlay.style.left = `${overlayLeft}px`;
}