import React, { useEffect, useMemo, useRef } from 'react';
import { Color, Object3D } from 'three';
import { TABLE_HALF_EXTENT } from '@let-him-rook/shared';

/**
 * Weathered stone battlefield around the chessboard, after the giant stone chessboard in
 * Alice in Wonderland: big checkered flagstones with grout gaps, cracks and creeping moss.
 * Everything is instanced, so the whole ground costs three draw calls.
 */

const BOARD_HALF = 4.2; // the board and its inset border cover [-4.2, 4.2]

function rand(seed: number): number {
  const s = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return s - Math.floor(s);
}

/** Slightly varied shade of a base colour, so no two stones match. */
export function weatheredShade(base: string, seed: number, spread = 0.12): string {
  const c = new Color(base) as any;
  const k = 1 + (rand(seed) - 0.5) * spread;
  return '#' + c.multiplyScalar(k).getHexString();
}

interface Instance {
  x: number;
  y: number;
  z: number;
  rotY: number;
  sx: number;
  sz: number;
  color: string;
}

/** One instanced mesh whose instances are placed once from `items`. */
const Instanced: React.FC<{ items: Instance[]; children: any; receiveShadow?: boolean }> = ({ items, children, receiveShadow }) => {
  const ref = useRef<any>(null);
  useEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const o = new Object3D();
    const c = new Color();
    items.forEach((it, i) => {
      o.position.set(it.x, it.y, it.z);
      o.rotation.set(0, it.rotY, 0);
      o.scale.set(it.sx, 1, it.sz);
      o.updateMatrix();
      mesh.setMatrixAt(i, o.matrix);
      mesh.setColorAt(i, c.set(it.color));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [items]);
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, items.length]} receiveShadow={receiveShadow}>
      {children}
    </instancedMesh>
  );
};

export const StoneBattlefield: React.FC = () => {
  const { tiles, cracks, moss } = useMemo(() => {
    const tiles: Instance[] = [];
    const cracks: Instance[] = [];
    const moss: Instance[] = [];
    const n = TABLE_HALF_EXTENT; // 1-unit flagstones aligned with the board squares
    let seed = 1;
    for (let i = -n; i < n; i++) {
      for (let j = -n; j < n; j++) {
        const x = i + 0.5;
        const z = j + 0.5;
        if (Math.abs(x) < BOARD_HALF && Math.abs(z) < BOARD_HALF) continue; // under the board
        seed++;
        const light = (i + j) % 2 === 0;
        // Flat and thin: raised or tilted stones hide the grout lines from a low camera
        const y = 0.006;
        const top = 0.013;
        tiles.push({
          x,
          y,
          z,
          rotY: 0,
          sx: 1,
          sz: 1,
          color: weatheredShade(light ? '#a49d8f' : '#5e5f62', seed),
        });
        if (rand(seed + 13) < 0.35) {
          // A crack, sometimes with a branch
          const a = rand(seed + 17) * Math.PI;
          const len = 0.35 + rand(seed + 19) * 0.45;
          cracks.push({ x, y: top, z, rotY: a, sx: len, sz: 1, color: '#1d1b19' });
          if (rand(seed + 23) < 0.5) {
            const b = a + 0.7 + rand(seed + 29) * 0.6;
            cracks.push({
              x: x + Math.cos(a) * len * 0.3 + Math.cos(b) * 0.12,
              y: top,
              z: z - Math.sin(a) * len * 0.3 - Math.sin(b) * 0.12,
              rotY: b,
              sx: len * 0.5,
              sz: 1,
              color: '#1d1b19',
            });
          }
        }
        // Moss creeping in from the outer edge
        const edge = Math.max(Math.abs(x), Math.abs(z));
        if (edge > 5.5 && rand(seed + 31) < 0.45) {
          moss.push({
            x: x + (rand(seed + 37) - 0.5) * 0.7,
            y: top + 0.002,
            z: z + (rand(seed + 41) - 0.5) * 0.7,
            rotY: rand(seed + 43) * Math.PI,
            sx: 0.5 + rand(seed + 47) * 0.6,
            sz: 0.4 + rand(seed + 53) * 0.5,
            color: weatheredShade('#4c6b34', seed + 59, 0.25),
          });
        }
      }
    }
    return { tiles, cracks, moss };
  }, []);

  return (
    <group>
      <Instanced items={tiles} receiveShadow>
        <boxGeometry args={[0.93, 0.012, 0.93]} />
        <meshStandardMaterial roughness={0.95} />
      </Instanced>
      <Instanced items={cracks}>
        <boxGeometry args={[1, 0.004, 0.025]} />
        <meshStandardMaterial roughness={1} />
      </Instanced>
      <Instanced items={moss}>
        <cylinderGeometry args={[0.5, 0.5, 0.006, 7]} />
        <meshStandardMaterial roughness={1} flatShading />
      </Instanced>
    </group>
  );
};
