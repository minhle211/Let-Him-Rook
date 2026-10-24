import { recognize, PinchTracker, MenuPinchController, DEFAULT_PINCH, calibratePinch, validPinchThresholds, PinchRatioFilter } from './recognizer.mjs';
const $ = id => document.getElementById(id);
const canvas = $('gesture-canvas'), ctx = canvas.getContext('2d'), video = $('hand-video');
const pinch = new PinchTracker();
const ratioFilter = new PinchRatioFilter();
let calibration = null, personalPinch = false;
try {
  const saved = JSON.parse(localStorage.getItem('rook-pinch-v2'));
  if (validPinchThresholds(saved)) { pinch.configure(saved); personalPinch = true; }
} catch { /* Calibration is optional, including when storage is blocked. */ }
$('pinch-profile').textContent = personalPinch ? 'Saved personal settings' : 'Default settings';
if (personalPinch) $('pinch-calibration-status').textContent = 'Saved calibration loaded. Open your fingers before starting.';
function abortCalibration(message) {
  if (!calibration) return;
  calibration = null; cancel();
  $('pinch-calibration-status').textContent = message;
  $('pinch-calibrate').textContent = 'Calibrate pinch';
  $('pinch-cancel').hidden = true;
}
function calibrationProgress() {
  $('pinch-calibrate').disabled = !active || !!battleId || (!!calibration && calibration.stage !== 'ready-closed');
  $('pinch-reset').disabled = !!calibration;
  if (!calibration || calibration.stage === 'ready-closed') return;
  const elapsed = performance.now() - calibration.startedAt;
  const pose = calibration.stage === 'open' ? 'Spread thumb and index apart' : 'Touch thumb and index together';
  if (elapsed < 1500) {
    $('pinch-calibration-status').textContent = pose + '. Starting in ' + Math.ceil((1500-elapsed)/1000) + '...';
    return;
  }
  if (elapsed < 3500) {
    $('pinch-calibration-status').textContent = pose + '. Hold steady: ' + ((3500-elapsed)/1000).toFixed(1) + 's';
    return;
  }
  if (calibration.samples.length < 20) {
    abortCalibration('Too few clear readings. Keep your hand visible and retry. Previous settings kept.');
    return;
  }
  if (calibration.stage === 'open') {
    calibration.open = calibration.samples;
    calibration.stage = 'ready-closed';
    $('pinch-calibrate').textContent = 'Capture pinch';
    $('pinch-calibrate').disabled = false;
    $('pinch-calibration-status').textContent = 'Open pose saved. Click Capture pinch, then touch thumb and index together.';
    return;
  }
  try {
    const settings = calibratePinch(calibration.open, calibration.samples);
    pinch.configure(settings); personalPinch = true;
    let saved = true;
    try { localStorage.setItem('rook-pinch-v2', JSON.stringify(settings)); } catch { saved = false; }
    abortCalibration('Calibration ready. Separate your fingertips slightly to release, then test pinching while moving.' + (saved ? '' : ' Settings apply until this page closes.'));
    $('pinch-profile').textContent = saved ? 'Personal settings saved' : 'Personal settings (this page)';
  } catch(error) {
    abortCalibration(error.message + ' Previous settings kept.');
  }
}
$('pinch-calibrate').onclick = () => {
  if (!active || battleId) return;
  if (calibration?.stage === 'ready-closed') {
    calibration = {stage:'closed', startedAt:performance.now(), samples:[], open:calibration.open};
  } else {
    if (calibration) return;
    cancel();
    calibration = {stage:'open', startedAt:performance.now(), samples:[], open:[]};
  }
  $('pinch-cancel').hidden = false;
  calibrationProgress();
};
$('pinch-cancel').onclick = () => abortCalibration('Setup cancelled. Previous settings kept.');
$('pinch-reset').onclick = () => {
  if (calibration) return;
  pinch.configure(DEFAULT_PINCH); personalPinch = false; cancel();
  let saved = true;
  try { localStorage.removeItem('rook-pinch-v2'); } catch { saved = false; }
  $('pinch-profile').textContent = 'Default settings';
  $('pinch-calibration-status').textContent = 'Defaults restored. Open your fingers before starting.' + (saved ? '' : ' Browser storage could not be updated.');
};
const menuPinch = new MenuPinchController();
let menuHands = false, menuHover = null;
const menuOutline = target => target?.matches('input') ? target.closest('label') || target : target;
function clearMenu() {
  menuPinch.cancel();
  document.querySelectorAll('.menu-hand-hover,.menu-hand-pressed').forEach(el => el.classList.remove('menu-hand-hover', 'menu-hand-pressed'));
  menuHover = null; $('menu-hand-cursor').hidden = true;
}
function menuTarget(point) {
  const x = (point.x - 0.1) / 0.8 * innerWidth, y = (point.y - 0.1) / 0.8 * innerHeight;
  const cursor = $('menu-hand-cursor');
  cursor.hidden = x < 0 || x >= innerWidth || y < 0 || y >= innerHeight;
  cursor.style.left = x + 'px'; cursor.style.top = y + 'px';
  if (cursor.hidden) return null;
  const hit = document.elementFromPoint(x, y);
  let nearest = null, best = Infinity;
  for (const target of document.querySelectorAll('[data-menu-hand]')) {
    if (target.disabled) continue;
    const el = menuOutline(target), rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height || rect.bottom < 0 || rect.top > innerHeight) continue;
    // Ignore controls covered by the floating toolbar or other elements.
    const centerHit = document.elementFromPoint(Math.max(0, Math.min(innerWidth - 1, rect.left + rect.width / 2)), Math.max(0, Math.min(innerHeight - 1, rect.top + rect.height / 2)));
    if (!el.contains(centerHit) && centerHit !== el) continue;
    const dx = Math.max(rect.left - x, 0, x - rect.right), dy = Math.max(rect.top - y, 0, y - rect.bottom);
    if (el === hit || el.contains(hit)) return target;
    const distance = Math.hypot(dx, dy);
    if (distance <= 10 && distance < best) { nearest = target; best = distance; }
  }
  return nearest;
}
function handleMenu(action, point) {
  if (action === 'cancel') { clearMenu(); return; }
  const target = point ? menuTarget(point) : null;
  menuOutline(menuHover)?.classList.remove('menu-hand-hover', 'menu-hand-pressed');
  menuHover = target;
  const clicked = menuPinch.update(action, target);
  menuOutline(target)?.classList.add('menu-hand-hover');
  if (menuPinch.pressed) menuOutline(menuPinch.pressed)?.classList.add('menu-hand-pressed');
  $('menu-hand-cursor').classList.toggle('pressed', !!menuPinch.pressed);
  const label = target?.getAttribute('aria-label') || menuOutline(target)?.textContent.trim();
  $('menu-hand-status').textContent = label ? label + ' - pinch and release to confirm.' : 'Point at a button. Use Up / Down to scroll.';
  if (clicked && !clicked.disabled && clicked.isConnected) {
    clearMenu(); clicked.click();
  }
}
$('menu-hands').onclick = () => {
  menuHands = !menuHands; cancel();
  $('menu-hands').textContent = 'Menu hands: ' + (menuHands ? 'on' : 'off');
  $('menu-hands').setAttribute('aria-pressed', String(menuHands));
  $('hand-keypad').hidden = !menuHands;
  $('menu-hand-status').textContent = menuHands ? 'Point at a button, pinch, then release. Board and spell gestures are paused.' : 'Board and spell controls resumed.';
};
$('hand-scroll-up').onclick = () => window.scrollBy({top: -innerHeight * 0.55, behavior: 'instant'});
$('hand-scroll-down').onclick = () => window.scrollBy({top: innerHeight * 0.55, behavior: 'instant'});
for (const key of [...'0123456789ABCDEF', 'Delete', 'Clear']) {
  const button = document.createElement('button'); button.type = 'button'; button.dataset.menuHand = '';
  button.textContent = key;
  button.onclick = () => {
    const input = $('room-code');
    input.value = key === 'Clear' ? '' : key === 'Delete' ? input.value.slice(0, -1) : (input.value + key).slice(0, 6);
    input.dispatchEvent(new Event('input', {bubbles:true}));
  };
  $('hand-code-keys').append(button);
}
window.addEventListener('scroll', clearMenu);
window.addEventListener('resize', clearMenu);
let worker, stream, active = false, starting = false, workerBusy = false, frame = 0, lastFrame = -1, timeout, version = 0;
let points = [], smoothed = null, drawing = false, pointerId = null, startedAt = 0, contextAtStart = null;
let battleId = null, liveReady = false;
const say = message => { $('gesture-status').textContent = message; };
// Rolling one-second measurements, independent of the inference loop.
let cameraFrames = [], trackingFrames = [], cameraCallback = null, lastPresented = null;
let lastResultAt = 0, lastHandFound = false, handDrops = 0, detectionMs = null;
function resetStats() {
  cameraFrames = []; trackingFrames = []; lastPresented = null;
  lastResultAt = 0; lastHandFound = false; handDrops = 0; detectionMs = null;
}
function watchCameraFrames(current) {
  if (!video.requestVideoFrameCallback) return;
  cameraCallback = video.requestVideoFrameCallback((now, metadata) => {
    if (current !== version || !stream) return;
    const count = lastPresented === null ? 1 : Math.max(0, metadata.presentedFrames - lastPresented);
    lastPresented = metadata.presentedFrames;
    if (!document.hidden) cameraFrames.push({ at: now, count });
    watchCameraFrames(current);
  });
}
function renderStats() {
  calibrationProgress();
  const now = performance.now();
  cameraFrames = cameraFrames.filter(sample => now - sample.at < 1000);
  trackingFrames = trackingFrames.filter(at => now - at < 1000);
  const running = !!stream && !document.hidden;
  $('camera-fps').textContent = running ? (video.requestVideoFrameCallback ? String(cameraFrames.reduce((sum, sample) => sum + sample.count, 0)) : 'N/A') : '--';
  $('tracking-fps').textContent = running && active ? String(trackingFrames.length) : '--';
  const fresh = lastResultAt && now - lastResultAt < 500;
  $('tracking-ms').textContent = running && fresh && detectionMs !== null ? detectionMs.toFixed(0) : '--';
  const handState = document.hidden && stream ? 'Paused' : !stream ? 'Off' : !active ? 'Loading' : !fresh ? 'Waiting' : lastHandFound ? 'Found' : 'Lost';
  $('tracking-hand').textContent = handState;
  $('tracking-hand').dataset.warning = String(handState === 'Lost' || (active && handState === 'Waiting'));
  $('tracking-pinch').textContent = running && active && fresh ? (pinch.down ? (pinch.openSince !== null ? 'Releasing' : 'Held') : pinch.armed ? 'Open' : 'Open to start') : '--';
  $('tracking-drops').textContent = String(handDrops);
}
setInterval(renderStats, 250);
const mode = () => $('gesture-live').checked;
function clear() { points = []; drawing = false; contextAtStart = null; ctx.clearRect(0, 0, canvas.width, canvas.height); }
function emitBoard(action, point = null) { window.dispatchEvent(new CustomEvent('board-hand', { detail: { action, point } })); }
const controlsBoard = () => $('board-hands').checked && !$('match').hidden && !battleId;
function cancel() { clear(); ratioFilter.reset(); pinch.reset(); smoothed = null; clearMenu(); emitBoard('cancel'); }
$('board-hands').onchange = () => {
  cancel();
  $('board-hand-status').textContent = $('board-hands').checked ? 'Enable the camera, open your fingers, then point and pinch to grab.' : 'Hand-controlled moves off.';
};
function start(point) { clear(); say('Drawing... Keep pinching, then open your fingers to finish.'); drawing = true; startedAt = performance.now(); contextAtStart = mode() ? battleId : null; points.push(point); }
function draw(point) {
  if (!drawing) return;
  if (performance.now() - startedAt > 6000 || points.length >= 500) { cancel(); say('Stroke too long. Open your pinch and try again.'); return; }
  const previous = points.at(-1);
  if (previous && Math.hypot(point.x - previous.x, point.y - previous.y) < 0.003) return;
  points.push(point);
  ctx.strokeStyle = '#b9df83'; ctx.lineWidth = 5; ctx.lineCap = 'round'; ctx.beginPath();
  ctx.moveTo(previous.x * canvas.width, previous.y * canvas.height); ctx.lineTo(point.x * canvas.width, point.y * canvas.height); ctx.stroke();
}
function end() {
  if (!drawing) return;
  drawing = false;
  const spell = recognize(points);
  if (!spell) { say('Shape unclear. Try a larger line, circle, or Z.'); return; }
  const label = { attack: 'Attack', defense: 'Shield', special: 'Special' }[spell];
  if (!mode()) { say(label + ' recognized (practice only).'); return; }
  if (!liveReady || !battleId || battleId !== contextAtStart) { say('Battle changed or disconnected. Spell cancelled.'); return; }
  say(label + ' recognized. Sending...');
  window.dispatchEvent(new CustomEvent('gesture-cast', { detail: { spell, battleId } }));
}
window.addEventListener('game-context', ({ detail }) => {
  const changed = battleId !== detail.battleId || liveReady !== detail.ready;
  battleId = detail.battleId; liveReady = detail.ready;
  if (changed) { if (battleId) abortCalibration('Setup cancelled because a battle started. Previous settings kept.'); cancel(); }
});
window.addEventListener('gesture-result', ({ detail }) => say(detail));
$('gesture-live').onchange = () => { cancel(); say(mode() ? 'Live casting on. Recognized spells will cast during battle.' : 'Practice mode. No spells will be cast.'); };
function stop(message = 'Camera stopped. You can still draw with the mouse.') {
  abortCalibration('Setup cancelled because the camera stopped. Previous settings kept.');
  if (cameraCallback !== null) video.cancelVideoFrameCallback?.(cameraCallback);
  cameraCallback = null;
  version++; active = false; starting = false; clearTimeout(timeout); cancelAnimationFrame(frame);
  worker?.terminate(); worker = null; workerBusy = false;
  stream?.getTracks().forEach(track => track.stop()); stream = null; video.srcObject = null;
  $('camera-start').disabled = false; $('camera-stop').disabled = true; $('hand-cursor').hidden = true; cancel(); say(message); renderStats();
}
$('camera-stop').onclick = () => stop();
$('camera-start').onclick = async () => {
  if (active || starting) return;
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    say('Camera needs localhost or HTTPS. Open http://localhost:3001 on this laptop.'); return;
  }
  resetStats();
  starting = true; const current = ++version; $('camera-start').disabled = true; $('camera-stop').disabled = false;
  say('Loading hand tracking. First use needs internet...');
  timeout = setTimeout(() => stop('Camera setup timed out. Check permission and internet, then retry.'), 45000);
  try {
    const acquired = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: 'user' }, audio: false });
    if (current !== version) { acquired.getTracks().forEach(track => track.stop()); return; }
    stream = acquired; video.srcObject = stream; watchCameraFrames(current); await video.play();
    if (current !== version) return;
    worker = new Worker('/hand-worker.js');
    worker.onerror = () => stop('Hand tracking failed to load. Check your internet connection and retry.');
    worker.onmessage = ({ data }) => {
      if (current !== version) return;
      if (data.type === 'error') { stop('Hand tracking failed: ' + data.message); return; }
      if (data.type === 'ready') {
        clearTimeout(timeout); active = true; starting = false; lastFrame = -1;
        say('Show one hand. Open thumb and index finger, then pinch to draw.'); loop(); return;
      }
      workerBusy = false;
      if (document.hidden) return;
      const hand = data.landmarks;
      const resultAt = performance.now();
      trackingFrames.push(resultAt); lastResultAt = resultAt;
      detectionMs = Number.isFinite(data.inferenceMs) ? data.inferenceMs : null;
      if (!hand && lastHandFound) handDrops++;
      lastHandFound = !!hand;
      if (!hand) {
        ratioFilter.reset();
        $('pinch-opening').value = 0;
        if (calibration) { $('hand-cursor').hidden = true; return; }
        const missing = pinch.update(NaN);
        if (menuHands) clearMenu();
        else if (controlsBoard()) emitBoard(missing);
        if (missing === 'cancel') { if (drawing) say('Hand lost for too long. Open your fingers and try again.'); cancel(); }
        $('hand-cursor').hidden = true; return;
      }
      const point = { x: 1 - hand[8].x, y: hand[8].y };
      smoothed = smoothed ? { x: smoothed.x * 0.35 + point.x * 0.65, y: smoothed.y * 0.35 + point.y * 0.65 } : point;
      const cursor = $('hand-cursor'); cursor.hidden = false; cursor.style.left = smoothed.x * 100 + '%'; cursor.style.top = smoothed.y * 100 + '%';
      const dist = (a, b) => Math.hypot((a.x - b.x) * video.videoWidth, (a.y - b.y) * video.videoHeight);
      const rawRatio = dist(hand[4], hand[8]) / Math.max(1, dist(hand[0], hand[9]));
      const filteredRatio = ratioFilter.update(rawRatio);
      $('pinch-opening').value = Math.max(0, Math.min(1, (filteredRatio - pinch.closeThreshold) / (pinch.openThreshold - pinch.closeThreshold)));
      if (calibration) {
        const elapsed = performance.now() - calibration.startedAt;
        if (calibration.stage !== 'ready-closed' && elapsed >= 1500 && elapsed <= 3500) calibration.samples.push(rawRatio);
        cursor.classList.remove('pinching');
        return;
      }
      const event = pinch.update(filteredRatio);
      cursor.classList.toggle('pinching', pinch.down);
      if (menuHands) { handleMenu(event, smoothed); return; }
      if (controlsBoard()) {
        emitBoard(event, smoothed);
        if (event === 'cancel') cancel();
        return;
      }
      if (event === 'start') start(smoothed);
      else if (event === 'draw') draw(smoothed);
      else if (event === 'end') end();
      else if (event === 'cancel') { cancel(); say('Tracking paused. Open your fingers and try again.'); }
    };
    worker.postMessage({ type: 'init' });
  } catch (error) {
    if (current === version) stop(error.name === 'NotAllowedError' ? 'Camera permission denied. Allow camera access and retry.' : 'Could not open camera: ' + error.message);
  }
};
async function loop() {
  if (!active) return;
  frame = requestAnimationFrame(loop);
  if (workerBusy || document.hidden || video.readyState < 2 || video.currentTime === lastFrame) return;
  workerBusy = true; lastFrame = video.currentTime; const current = version;
  try {
    const bitmap = await createImageBitmap(video);
    if (current !== version || !active) { bitmap.close(); return; }
    worker.postMessage({ type: 'frame', bitmap, timestamp: performance.now() }, [bitmap]);
  } catch { if (current === version) stop('Camera frame failed. Stop and restart the camera.'); }
}
const pointFor = e => { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }; };
canvas.onpointerdown = e => {
  if (calibration || menuHands || active || starting || e.button !== 0 || pointerId !== null) return;
  pointerId = e.pointerId; canvas.setPointerCapture(pointerId); start(pointFor(e));
};
canvas.onpointermove = e => { if (e.pointerId === pointerId) draw(pointFor(e)); };
canvas.onpointerup = e => { if (e.pointerId === pointerId) { draw(pointFor(e)); end(); pointerId = null; } };
canvas.onpointercancel = canvas.onlostpointercapture = () => { if (pointerId !== null) { pointerId = null; cancel(); } };
document.addEventListener('visibilitychange', () => { if (document.hidden) { abortCalibration('Setup cancelled because the tab was hidden. Previous settings kept.'); cancel(); pointerId = null; }
  cameraFrames = []; trackingFrames = []; lastPresented = null; lastResultAt = 0; lastHandFound = false; renderStats(); });
window.addEventListener('pagehide', () => stop());
