import React, { useEffect, useMemo, useRef } from 'react';
import { Color, Object3D } from 'three';
import { TOWER, TUNNEL, castleTunnels, type CastleTunnel } from '@let-him-rook/shared';
import { weatheredShade } from './StoneBattlefield.tsx';

/**
 * The castle's two roofed tunnels (collision lives in shared/arena.ts): each leaves a tower gate,
 * runs out into the field with a wall-walk and merlons on its roof, and ends in a square turret
 * whose arch is the tunnel mouth. Drawn in tower-local coordinates inside the tower's group, and
 * sharing its fade so the whole castle goes see-through together.
 */

export const TUNNEL_HEIGHT = 2.3; // clear headroom inside is above the tallest fighter
const TURRET_LEN = 1.9;
const TURRET_HEIGHT = 3.3;
const TURRET_HALF = TUNNEL.clearWidth / 2 + 0.42;
const MOUTH_HEIGHT = 1.85;

type Part = 'stone' | 'dark' | 'wood';
interface Box {
  a: number; // along the tunnel, measured from the tower centre
  l: number; // lateral offset
  y: number;
  sa: number;
  sy: number;
  sl: number;
  part: Part;
  seed: number;
}

const BASE_COLOR: Record<Part, string> = {
  stone: '#a39c90',
  dark: '#6f6a62',
  wood: '#5a3f2a',
};

function buildTunnel(t: CastleTunnel, index: number): Box[] {
  const boxes: Box[] = [];
  let seed = index * 1000 + 7;
  const push = (b: Omit<Box, 'seed'>) => boxes.push({ ...b, seed: seed++ });
  const start = TOWER.radius - 0.3; // tucked into the tower wall
  const turretStart = t.end - TURRET_LEN;
  const wallL = TUNNEL.clearWidth / 2 + TUNNEL.wallThickness / 2;

  // Side walls in short sections, up to the turret
  for (let a = start; a < turretStart; a += 1.15) {
    const len = Math.min(1.15, turretStart - a);
    for (const s of [-1, 1]) {
      push({ a: a + len / 2, l: s * wallL, y: TUNNEL_HEIGHT / 2, sa: len, sy: TUNNEL_HEIGHT, sl: TUNNEL.wallThickness, part: 'stone' });
    }
  }
  // Roof slab, wooden wall-walk and merlons along both edges
  const roofStart = TOWER.radius - 0.1;
  const roofLen = turretStart - roofStart;
  push({ a: roofStart + roofLen / 2, l: 0, y: TUNNEL_HEIGHT + 0.09, sa: roofLen, sy: 0.18, sl: TUNNEL.clearWidth + 2 * TUNNEL.wallThickness + 0.1, part: 'dark' });
  push({ a: roofStart + roofLen / 2, l: 0, y: TUNNEL_HEIGHT + 0.2, sa: roofLen, sy: 0.05, sl: TUNNEL.clearWidth - 0.1, part: 'wood' });
  for (let a = roofStart + 0.35; a < turretStart - 0.2; a += 0.66) {
    for (const s of [-1, 1]) {
      push({ a, l: s * (wallL + 0.03), y: TUNNEL_HEIGHT + 0.38, sa: 0.38, sy: 0.4, sl: 0.22, part: 'stone' });
    }
  }

  // Turret over the tunnel mouth: thick side walls, a lintel above the exit arch, an open lookout
  const turretMid = turretStart + TURRET_LEN / 2;
  for (const s of [-1, 1]) {
    const inner = TUNNEL.clearWidth / 2;
    push({ a: turretMid, l: s * (inner + (TURRET_HALF - inner) / 2), y: TURRET_HEIGHT / 2, sa: TURRET_LEN, sy: TURRET_HEIGHT, sl: TURRET_HALF - inner, part: 'stone' });
  }
  push({ a: t.end - 0.2, l: 0, y: (MOUTH_HEIGHT + TURRET_HEIGHT) / 2, sa: 0.4, sy: TURRET_HEIGHT - MOUTH_HEIGHT, sl: TUNNEL.clearWidth, part: 'stone' });
  push({ a: turretStart + 0.2, l: 0, y: (TUNNEL_HEIGHT + TURRET_HEIGHT) / 2, sa: 0.4, sy: TURRET_HEIGHT - TUNNEL_HEIGHT, sl: TUNNEL.clearWidth, part: 'stone' });
  push({ a: turretMid, l: 0, y: TURRET_HEIGHT + 0.05, sa: TURRET_LEN + 0.12, sy: 0.1, sl: TURRET_HALF * 2 + 0.12, part: 'dark' });
  push({ a: turretMid, l: 0, y: (TURRET_HEIGHT + TUNNEL_HEIGHT) / 2 + 0.1, sa: TURRET_LEN - 0.8, sy: TURRET_HEIGHT - TUNNEL_HEIGHT, sl: TUNNEL.clearWidth - 0.1, part: 'dark' });
  for (const da of [-1, 1]) {
    for (const dl of [-1, 1]) {
      push({ a: turretMid + da * (TURRET_LEN / 2 - 0.13), l: dl * (TURRET_HALF - 0.13), y: TURRET_HEIGHT + 0.5, sa: 0.24, sy: 0.9, sl: 0.24, part: 'stone' });
    }
  }
  // Low parapets between the posts leave the lookout open to the sky
  for (const s of [-1, 1]) {
    push({ a: turretMid, l: s * (TURRET_HALF - 0.1), y: TURRET_HEIGHT + 0.25, sa: TURRET_LEN - 0.3, sy: 0.32, sl: 0.14, part: 'stone' });
    push({ a: turretMid + s * (TURRET_LEN / 2 - 0.1), l: 0, y: TURRET_HEIGHT + 0.25, sa: 0.14, sy: 0.32, sl: TURRET_HALF * 2 - 0.3, part: 'stone' });
  }
  push({ a: turretMid, l: 0, y: TURRET_HEIGHT + 0.98, sa: TURRET_LEN + 0.2, sy: 0.07, sl: TURRET_HALF * 2 + 0.2, part: 'wood' });
  // Darker worn floor inside
  push({ a: (start + t.end) / 2, l: 0, y: 0.03, sa: t.end - start, sy: 0.02, sl: TUNNEL.clearWidth, part: 'dark' });
  return boxes;
}

const PartMesh: React.FC<{ boxes: Box[]; part: Part; fadeable: (m: any) => void }> = ({ boxes, part, fadeable }) => {
  const ref = useRef<any>(null);
  useEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const tunnels = castleTunnels();
    const o = new Object3D();
    const c = new Color();
    boxes.forEach((b, i) => {
      const t = tunnels[Math.floor(b.seed / 1000)];
      o.position.set(t.dx * b.a + t.lx * b.l, b.y, t.dz * b.a + t.lz * b.l);
      o.rotation.set(0, -Math.atan2(t.dz, t.dx), 0); // local +x runs along the tunnel
      o.scale.set(b.sa, b.sy, b.sl);
      o.updateMatrix();
      mesh.setMatrixAt(i, o.matrix);
      mesh.setColorAt(i, c.set(weatheredShade(BASE_COLOR[part], b.seed, 0.16)));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [boxes, part]);
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, boxes.length]} castShadow receiveShadow>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial ref={fadeable} roughness={part === 'stone' ? 0.95 : 1} flatShading={part === 'stone'} transparent />
    </instancedMesh>
  );
};

export const CastleTunnels: React.FC<{ fadeable: (m: any) => void }> = ({ fadeable }) => {
  const byPart = useMemo(() => {
    const groups: Record<Part, Box[]> = { stone: [], dark: [], wood: [] };
    castleTunnels().forEach((t, i) => buildTunnel(t, i).forEach(b => groups[b.part].push(b)));
    return groups;
  }, []);
  const roofs = useMemo(
    () => castleTunnels().map(t => [t.dx * (t.end - TURRET_LEN / 2), t.dz * (t.end - TURRET_LEN / 2)] as [number, number]),
    []
  );

  return (
    <group>
      {(Object.keys(byPart) as Part[]).map(part => (
        <group key={part}>
          <PartMesh boxes={byPart[part]} part={part} fadeable={fadeable} />
        </group>
      ))}
      {/* Arch over each tunnel mouth: dark arch head with a stone trim, facing out of the tunnel */}
      {castleTunnels().map((t, k) => (
        <group key={`arch${k}`} position={[t.dx * (t.end + 0.012), MOUTH_HEIGHT, t.dz * (t.end + 0.012)]} rotation={[0, Math.atan2(t.dx, t.dz), 0]}>
          <mesh>
            <circleGeometry args={[TUNNEL.clearWidth / 2, 16, 0, Math.PI]} />
            <meshStandardMaterial ref={fadeable} color="#17130f" transparent />
          </mesh>
          <mesh position={[0, 0, 0.02]}>
            <torusGeometry args={[TUNNEL.clearWidth / 2 + 0.06, 0.07, 5, 16, Math.PI]} />
            <meshStandardMaterial ref={fadeable} color="#6f6a62" roughness={1} flatShading transparent />
          </mesh>
        </group>
      ))}
      {/* Pyramid slate roofs on the turrets */}
      {roofs.map(([x, z], k) => (
        <mesh key={k} position={[x, TURRET_HEIGHT + 1.45, z]} rotation={[0, Math.PI / 4, 0]} castShadow>
          <coneGeometry args={[(TURRET_HALF * 2 + 0.35) * Math.SQRT1_2 * 1.05, 1.0, 4]} />
          <meshStandardMaterial ref={fadeable} color="#4f5562" roughness={0.9} flatShading transparent />
        </mesh>
      ))}
    </group>
  );
};
