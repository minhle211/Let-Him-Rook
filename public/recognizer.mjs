const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export function resample(points, count = 48) {
  const lengths = [0];
  for (let i = 1; i < points.length; i++) lengths.push(lengths[i - 1] + distance(points[i - 1], points[i]));
  const total = lengths.at(-1);
  if (!total) return [];
  let j = 1;
  return Array.from({ length: count }, (_, i) => {
    const at = total * i / (count - 1);
    while (j < lengths.length - 1 && lengths[j] < at) j++;
    const t = (at - lengths[j - 1]) / (lengths[j] - lengths[j - 1] || 1);
    return { x: points[j - 1].x + t * (points[j].x - points[j - 1].x), y: points[j - 1].y + t * (points[j].y - points[j - 1].y) };
  });
}
function normalize(points) {
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  const minX = Math.min(...xs), minY = Math.min(...ys);
  const size = Math.max(Math.max(...xs) - minX, Math.max(...ys) - minY);
  return points.map(p => ({ x: (p.x - minX) / size, y: (p.y - minY) / size }));
}
const zTemplate = normalize(resample([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }]));
export function recognize(points) {
  if (points.length < 3 || points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return null;
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  const width = Math.max(...xs) - Math.min(...xs), height = Math.max(...ys) - Math.min(...ys);
  if (Math.max(width, height) < 0.12) return null;
  const path = resample(points);
  const length = points.slice(1).reduce((sum, p, i) => sum + distance(p, points[i]), 0);
  const end = distance(points[0], points.at(-1));
  // A straight stroke can point in any direction.
  const a = points[0], b = points.at(-1);
  const deviation = end ? Math.max(...path.map(p => Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / end)) / end : Infinity;
  if (end / length > 0.78 && deviation < 0.10) return 'attack';
  // Closed, round strokes need a full winding and a reasonably consistent radius.
  if (end / length < 0.12 && Math.min(width, height) / Math.max(width, height) > 0.60) {
    const center = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
    const radii = path.map(p => distance(p, center)), mean = radii.reduce((a, b) => a + b, 0) / radii.length;
    const variance = Math.sqrt(radii.reduce((sum, r) => sum + (r - mean) ** 2, 0) / radii.length) / mean;
    let winding = 0;
    for (let i = 1; i < path.length; i++) {
      let delta = Math.atan2(path[i].y - center.y, path[i].x - center.x) - Math.atan2(path[i - 1].y - center.y, path[i - 1].x - center.x);
      if (delta > Math.PI) delta -= 2 * Math.PI;
      if (delta < -Math.PI) delta += 2 * Math.PI;
      winding += delta;
    }
    if (variance < 0.16 && Math.abs(winding) > 5.4 && Math.abs(winding) < 7) return 'defense';
  }
  // Normalize width and height before resampling so wide/tall Z strokes match.
  if (Math.min(width, height) / Math.max(width, height) < 0.28) return null;
  const normalized = resample(points.map(p => ({ x: (p.x - Math.min(...xs)) / width, y: (p.y - Math.min(...ys)) / height })));
  const score = candidate => candidate.reduce((sum, p, i) => sum + distance(p, zTemplate[i]), 0) / candidate.length;
  if (Math.min(score(normalized), score([...normalized].reverse())) < 0.16) return 'special';
  return null;
}
// Debounce release and briefly tolerate missing landmarks.
export class PinchTracker {
  closeThreshold = 0.38;
  openThreshold = 0.50;
  configure(thresholds) {
    if (!validPinchThresholds(thresholds)) throw new Error('Invalid pinch thresholds');
    this.closeThreshold = thresholds.close; this.openThreshold = thresholds.open; this.reset();
  }
  down = false;
  armed = false;
  openSince = null;
  lastSeen = null;
  update(ratio, now = performance.now()) {
    if (!Number.isFinite(ratio)) {
      this.openSince = null;
      if (this.lastSeen !== null && now - this.lastSeen <= 300) return 'hold';
      this.reset(); return 'cancel';
    }
    if (this.lastSeen !== null && now - this.lastSeen > 300) {
      this.reset(); this.lastSeen = now; return 'cancel';
    }
    this.lastSeen = now;
    if (ratio > this.openThreshold) {
      if (!this.down) { this.armed = true; return 'hover'; }
      this.openSince ??= now;
      if (now - this.openSince < 120) return 'hold';
      this.down = false; this.armed = true; this.openSince = null; return 'end';
    }
    this.openSince = null;
    if (ratio < this.closeThreshold && this.armed && !this.down) { this.down = true; return 'start'; }
    return this.down ? 'draw' : 'hover';
  }
  reset() { this.down = false; this.armed = false; this.openSince = null; this.lastSeen = null; }
}

export class MenuPinchController {
  pressed = null;
  startedAt = 0;
  cooldownUntil = 0;
  cancel() { this.pressed = null; }
  update(action, target, now = performance.now()) {
    if (action === 'cancel') { this.cancel(); return null; }
    if (this.pressed !== null && now - this.startedAt > 1500) this.cancel();
    if (action === 'start' && now >= this.cooldownUntil) {
      this.pressed = target; this.startedAt = now;
    }
    if (action === 'draw' && target !== this.pressed) this.cancel();
    if (action === 'end') {
      const clicked = this.pressed !== null && target === this.pressed ? target : null;
      this.cancel();
      if (clicked !== null) this.cooldownUntil = now + 500;
      return clicked;
    }
    return null;
  }
}

export const DEFAULT_PINCH = Object.freeze({ close: 0.38, open: 0.50 });
export function validPinchThresholds(value) {
  return !!value && Number.isFinite(value.close) && Number.isFinite(value.open)
    && value.close >= 0.02 && value.open <= 4 && value.open - value.close >= 0.04;
}
const quantile = (sorted, fraction) => sorted[Math.floor((sorted.length - 1) * fraction)];
export function calibratePinch(openSamples, closedSamples) {
  const clean = samples => samples.filter(n => Number.isFinite(n) && n >= 0 && n <= 4).sort((a,b) => a-b);
  const open = clean(openSamples), closed = clean(closedSamples);
  if (open.length < 20 || closed.length < 20) throw new Error('Not enough clear hand readings. Keep your hand in view and retry.');
  const openMiddle = quantile(open, 0.5), closedMiddle = quantile(closed, 0.5), gap = openMiddle - closedMiddle;
  if (gap < 0.2 || quantile(open, 0.1) - quantile(closed, 0.9) < 0.12) throw new Error('Open and pinched readings overlap. Spread thumb and index farther apart for the open step.');
  if (quantile(open, 0.9) - quantile(open, 0.1) > gap * 0.45 || quantile(closed, 0.9) - quantile(closed, 0.1) > gap * 0.45) throw new Error('Hand readings were too shaky. Hold each pose steady and retry.');
  // Anchor both thresholds near measured contact, not the wide-open pose.
  const contactNoise = quantile(closed, 0.9) - quantile(closed, 0.1);
  if (contactNoise > 0.14) throw new Error('Pinched readings varied too much. Keep fingertips visible and hold them gently together.');
  const close = quantile(closed, 0.9) + Math.max(0.025, contactNoise * 0.25);
  const result = { close, open: close + Math.max(0.06, contactNoise * 0.5) };
  if (result.open >= quantile(open, 0.1) - 0.02) throw new Error('The two poses are too similar. Keep fingertips visible and retry.');
  if (!validPinchThresholds(result)) throw new Error('Calibration was outside the usable range. Retry at your normal playing distance.');
  return result;
}
// A three-reading median rejects isolated distance spikes, with about one frame
// of lag during normal motion. Do not reuse readings across tracking gaps.
export class PinchRatioFilter {
  readings = [];
  lastAt = null;
  reset() { this.readings = []; this.lastAt = null; }
  update(value, now = performance.now()) {
    if (!Number.isFinite(value) || value < 0) { this.reset(); return NaN; }
    if (this.lastAt !== null && now - this.lastAt > 300) this.reset();
    this.lastAt = now;
    this.readings.push(value);
    if (this.readings.length > 3) this.readings.shift();
    const sorted = [...this.readings].sort((a,b) => a-b);
    return sorted.length === 2 ? (sorted[0]+sorted[1])/2 : sorted[Math.floor(sorted.length/2)];
  }
}
