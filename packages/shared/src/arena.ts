/**
 * Fixed arena features around the board (shared so the server simulation and the client's movement
 * prediction agree). Layout, from White's side (+z is White's edge, -x is White's left):
 *
 *   puddle (left, upper)          tree (top-right corner)
 *               [ board ]         puddle (right, lower)
 *   tower (bottom-left corner)    tree (below the board, right)
 *
 * The castle is a round, roofed stone tower with two perpendicular gates facing the play area; each
 * gate opens into a roofed tunnel that runs out into the field and ends at an open turret. Its walls
 * block movement and attacks; when it collapses everyone inside the tower or a tunnel takes damage.
 */

/** The round tower wall is modelled as a ring of overlapping stones (circles) with gaps for the gates. */
export interface WallStone {
  x: number;
  z: number;
  r: number;
}

export const TREE_RADIUS = 0.55;
export const TREES = [
  { id: 'tree_1', x: 6.4, z: -6.4 },
  { id: 'tree_2', x: 3.0, z: 6.5 },
];

export const PUDDLE_SLOW_FACTOR = 0.5; // movement speed multiplier while standing in a puddle
/** Elliptical puddles: rx along x, rz along z. */
export const PUDDLES = [
  { id: 'puddle_1', x: -6.4, z: -3.4, rx: 1.0, rz: 1.35 },
  { id: 'puddle_2', x: 6.4, z: 3.0, rx: 0.95, rz: 1.2 },
];

export const TOWER = {
  id: 'tower_1',
  // Tucked into the corner; the castle's wall wings run from it along both edges
  x: -6.6,
  z: 6.6,
  radius: 1.5, // outer radius of the round wall
  wallThickness: 0.32,
  gateWidth: 1.1, // clear opening between the door jambs (a fighter is 0.9 wide)
  /** Gate directions as world angles atan2(z, x): +x faces the board, -z runs along the board edge. */
  gateAngles: [0, -Math.PI / 2],
  maxHits: 6,
  collapseDamage: 15,
};

/** Roofed tunnels leading out of each gate, ending in an open turret. */
export const TUNNEL = {
  length: 4.6, // beyond the tower's outer wall
  clearWidth: 1.3,
  wallThickness: 0.3,
};

export interface CastleTunnel {
  /** Unit direction out of the gate, and the lateral (sideways) unit vector. */
  dx: number;
  dz: number;
  lx: number;
  lz: number;
  /** Distance from the tower centre where the tunnel ends (its open mouth). */
  end: number;
}

export function castleTunnels(): CastleTunnel[] {
  return TOWER.gateAngles.map(a => {
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    return { dx, dz, lx: -dz, lz: dx, end: TOWER.radius + TUNNEL.length };
  });
}

/** Angular half-width of each gate gap, measured to the centres of the jamb stones. */
export function towerGateHalfAngle(): number {
  const ring = TOWER.radius - TOWER.wallThickness / 2;
  return Math.asin((TOWER.gateWidth / 2 + TOWER.wallThickness / 2) / ring);
}

function angleDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/**
 * Wall stones of the castle with its tower centred at (x, z): the round wall minus the two gates,
 * plus both side walls of each tunnel. Stones overlap, so nothing slips between them.
 */
export function castleWallStones(x: number, z: number): WallStone[] {
  const r = TOWER.wallThickness / 2;
  const ring = TOWER.radius - r;
  const count = Math.ceil((Math.PI * 2 * ring) / (r * 1.2)); // overlapping, so nothing slips between
  const gateHalf = towerGateHalfAngle();
  const stones: WallStone[] = [];
  for (let k = 0; k < count; k++) {
    const a = (k / count) * Math.PI * 2;
    if (TOWER.gateAngles.some(g => Math.abs(angleDiff(a, g)) < gateHalf)) continue;
    stones.push({ x: x + Math.cos(a) * ring, z: z + Math.sin(a) * ring, r });
  }

  const tr = TUNNEL.wallThickness / 2;
  const side = TUNNEL.clearWidth / 2 + tr;
  const start = TOWER.radius - 0.45; // overlap the tower wall so the seam is sealed
  for (const t of castleTunnels()) {
    for (let d = start; d <= t.end + 1e-6; d += tr * 1.2) {
      for (const s of [-1, 1]) {
        stones.push({ x: x + t.dx * d + t.lx * side * s, z: z + t.dz * d + t.lz * side * s, r: tr });
      }
    }
  }
  return stones;
}

/** True when (px, pz) is inside the tower or one of its tunnels (tower centred at (x, z)). */
export function isInsideCastle(px: number, pz: number, x: number, z: number): boolean {
  if (Math.hypot(px - x, pz - z) <= TOWER.radius - TOWER.wallThickness) return true;
  for (const t of castleTunnels()) {
    const along = (px - x) * t.dx + (pz - z) * t.dz;
    const lateral = (px - x) * t.lx + (pz - z) * t.lz;
    if (along >= TOWER.radius - TOWER.wallThickness && along <= t.end && Math.abs(lateral) <= TUNNEL.clearWidth / 2) {
      return true;
    }
  }
  return false;
}

/** Pushes a circle out of every wall stone it overlaps. */
export function pushCircleOutOfStones(
  px: number,
  pz: number,
  radius: number,
  stones: WallStone[]
): { x: number; z: number } {
  let x = px;
  let z = pz;
  // Two passes: neighbouring stones overlap, so one push can nudge into the next stone.
  for (const s of [...stones, ...stones]) {
    const minDist = radius + s.r;
    const d = Math.hypot(x - s.x, z - s.z);
    if (d >= minDist || d < 1e-6) continue;
    x = s.x + ((x - s.x) / d) * minDist;
    z = s.z + ((z - s.z) / d) * minDist;
  }
  return { x, z };
}

/**
 * Fraction t in [0, 1] along the segment (x0, z0) -> (x1, z1) where a circle of `radius` first
 * touches any wall stone, or null if the path is clear.
 */
export function segmentHitStones(
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  radius: number,
  stones: WallStone[]
): number | null {
  const dx = x1 - x0;
  const dz = z1 - z0;
  const a = dx * dx + dz * dz;
  let best: number | null = null;
  for (const s of stones) {
    const R = radius + s.r;
    const fx = x0 - s.x;
    const fz = z0 - s.z;
    const c = fx * fx + fz * fz - R * R;
    if (c <= 0) {
      // Already touching: only a hit if moving into the stone, not away from it
      if (fx * dx + fz * dz < 0) return 0;
      continue;
    }
    if (a < 1e-12) continue;
    const b = 2 * (fx * dx + fz * dz);
    const disc = b * b - 4 * a * c;
    if (disc < 0) continue;
    const t = (-b - Math.sqrt(disc)) / (2 * a);
    if (t >= 0 && t <= 1 && (best === null || t < best)) best = t;
  }
  return best;
}

/** Closest point on any wall stone's surface (distance 0 when inside one). */
export function distanceToStones(px: number, pz: number, stones: WallStone[]): { dist: number; x: number; z: number } {
  let best = { dist: Infinity, x: px, z: pz };
  for (const s of stones) {
    const d = Math.hypot(px - s.x, pz - s.z);
    const surface = Math.max(0, d - s.r);
    if (surface < best.dist) {
      const k = d > 1e-6 ? s.r / d : 0;
      best = { dist: surface, x: s.x + (px - s.x) * k, z: s.z + (pz - s.z) * k };
    }
  }
  return best;
}

/** Movement speed multiplier at (x, z): slowed while inside a puddle. */
export function puddleSpeedMultiplier(x: number, z: number): number {
  for (const p of PUDDLES) {
    const nx = (x - p.x) / p.rx;
    const nz = (z - p.z) / p.rz;
    if (nx * nx + nz * nz <= 1) return PUDDLE_SLOW_FACTOR;
  }
  return 1;
}
