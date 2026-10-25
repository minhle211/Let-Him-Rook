import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { TABLE_HALF_EXTENT } from '@let-him-rook/shared';

/**
 * Fairytale ruins framing the board: a stone terrace around the tabletop with weathered,
 * ivy-covered pillars (some broken) standing on it. Purely visual; nothing here collides.
 * Pillars fade out when the low duel camera looks through them so they never hide the fighters.
 */

const TERRACE_INNER = TABLE_HALF_EXTENT;
const TERRACE_OUTER = TABLE_HALF_EXTENT + 1.9;

const STONE = '#8d8a84';
const STONE_DARK = '#615e5a';
const MOSS = '#4f7a3a';
const GLOW = '#f5d98b';

interface PillarSpec {
  x: number;
  z: number;
  height: number;
  broken: boolean;
  tilt: number;
  spin: number;
  seed: number;
}

/** Deterministic per-pillar variation so the ruins look the same for both players. */
function rand(seed: number): number {
  const s = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** A sparse, irregular scatter of ruins on the terrace around the battlefield (x, z, broken). */
const PILLAR_SPOTS: Array<[number, number, boolean]> = [
  [-8.32, -12.20, false],
  [1.44, -12.05, true],
  [7.36, -12.30, false],
  [12.20, -4.26, true],
  [12.05, 3.16, false],
  [12.15, 9.56, false],
  [6.12, 12.20, true],
  [1.24, 12.10, false],
  [-12.30, -0.55, false],
  [-12.10, -7.08, true],
];

function buildPillars(): PillarSpec[] {
  return PILLAR_SPOTS.map(([x, z, broken], i) => ({
    x,
    z,
    broken,
    height: broken ? 0.9 + rand(i) * 0.8 : 2.5 + rand(i + 40) * 0.9,
    tilt: broken ? (rand(i + 80) - 0.5) * 0.18 : (rand(i + 80) - 0.5) * 0.05,
    spin: rand(i + 120) * Math.PI,
    seed: i,
  }));
}

/** Toppled column drums lying on the terrace between the standing ruins. */
const FALLEN_COLUMNS: Array<{ x: number; z: number; rotY: number; length: number }> = [
  { x: -4.54, z: -12.25, rotY: 0.25, length: 1.6 },
  { x: 12.25, z: -8.53, rotY: 1.35, length: 1.3 },
  { x: -12.25, z: 10.04, rotY: 1.75, length: 1.4 },
];

/** Horizontal distance from (px, pz) to the segment (ax, az)-(bx, bz). */
function distToSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const abx = bx - ax, abz = bz - az;
  const len2 = abx * abx + abz * abz || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * abx + (pz - az) * abz) / len2));
  return Math.hypot(px - (ax + abx * t), pz - (az + abz * t));
}

function Pillar({ spec }: { spec: PillarSpec }) {
  const materials = useRef<any[]>([]);
  const wispRef = useRef<any>(null);
  const fade = useRef(1);
  const fadeable = (m: any) => {
    if (m && !materials.current.includes(m)) materials.current.push(m);
  };

  const ivy = useMemo(() => {
    const leaves: Array<{ pos: [number, number, number]; scale: number }> = [];
    const count = 5 + Math.floor(rand(spec.seed + 200) * 5);
    for (let k = 0; k < count; k++) {
      const a = rand(spec.seed * 13 + k) * Math.PI * 2;
      const y = 0.35 + rand(spec.seed * 7 + k + 3) * spec.height * 0.7;
      leaves.push({ pos: [Math.cos(a) * 0.34, y, Math.sin(a) * 0.34], scale: 0.7 + rand(spec.seed + k * 5) * 0.8 });
    }
    return leaves;
  }, [spec]);

  useFrame(({ camera, clock }) => {
    // The chess overview sits high above the ruins; only the low duel camera can look through a pillar.
    let target = 1;
    if (camera.position.y < 6) {
      const dir = camera.getWorldDirection(camera.position.clone());
      const flat = Math.hypot(dir.x, dir.z) || 1;
      const { x, z } = camera.position;
      const d = distToSegment(spec.x, spec.z, x, z, x + (dir.x / flat) * 6, z + (dir.z / flat) * 6);
      if (d < 1.4) target = 0.15 + 0.85 * Math.max(0, (d - 0.6) / 0.8);
    }
    fade.current += (target - fade.current) * 0.15;
    const o = fade.current;
    for (const m of materials.current) {
      m.opacity = o;
      m.depthWrite = o > 0.98;
    }
    if (wispRef.current) {
      const t = clock.elapsedTime + spec.seed;
      wispRef.current.position.y = spec.height + 0.75 + Math.sin(t * 1.3) * 0.12;
      wispRef.current.rotation.y = t * 0.8;
      wispRef.current.visible = o > 0.9;
    }
  });

  const shaftTop = 0.41 + spec.height;
  const stone = <meshStandardMaterial ref={fadeable} color={STONE} roughness={0.95} transparent />;
  const dark = <meshStandardMaterial ref={fadeable} color={STONE_DARK} roughness={1} transparent />;

  return (
    <group position={[spec.x, 0, spec.z]} rotation={[spec.tilt, spec.spin, spec.tilt * 0.6]}>
      <mesh position={[0, 0.16, 0]} receiveShadow>
        <boxGeometry args={[1.05, 0.32, 1.05]} />
        {dark}
      </mesh>
      <mesh position={[0, 0.41, 0]}>
        <cylinderGeometry args={[0.46, 0.5, 0.18, 12]} />
        {stone}
      </mesh>
      <mesh position={[0, 0.41 + spec.height / 2, 0]} castShadow>
        <cylinderGeometry args={[0.32, 0.36, spec.height, 10]} />
        {stone}
      </mesh>
      {spec.broken ? (
        <>
          {/* Snapped top and fallen chunks at the foot */}
          <mesh position={[0, shaftTop + 0.2, 0]} rotation={[0.25, 0, 0.18]}>
            <coneGeometry args={[0.34, 0.5, 6]} />
            {stone}
          </mesh>
          <mesh position={[0.62, 0.42, 0.3]} rotation={[0.4, spec.spin, 0.2]}>
            <dodecahedronGeometry args={[0.28, 0]} />
            {dark}
          </mesh>
          <mesh position={[-0.45, 0.36, 0.58]} scale={[0.7, 0.7, 0.7]}>
            <dodecahedronGeometry args={[0.28, 0]} />
            {stone}
          </mesh>
        </>
      ) : (
        <>
          <mesh position={[0, shaftTop + 0.08, 0]}>
            <cylinderGeometry args={[0.42, 0.33, 0.16, 12]} />
            {stone}
          </mesh>
          <mesh position={[0, shaftTop + 0.24, 0]}>
            <boxGeometry args={[0.95, 0.16, 0.95]} />
            {dark}
          </mesh>
          {/* Floating fairy light above intact pillars */}
          <mesh ref={wispRef} position={[0, spec.height + 0.75, 0]}>
            <octahedronGeometry args={[0.13, 0]} />
            <meshStandardMaterial color={GLOW} emissive={GLOW} emissiveIntensity={1.6} toneMapped={false} />
          </mesh>
        </>
      )}
      {ivy.map((leaf, k) => (
        <mesh key={k} position={leaf.pos} scale={[leaf.scale, leaf.scale, leaf.scale]}>
          <icosahedronGeometry args={[0.16, 0]} />
          <meshStandardMaterial ref={fadeable} color={MOSS} roughness={1} flatShading transparent />
        </mesh>
      ))}
    </group>
  );
}

export const FairytaleRuins: React.FC = () => {
  const pillars = useMemo(buildPillars, []);
  const width = TERRACE_OUTER - TERRACE_INNER;
  const mid = (TERRACE_OUTER + TERRACE_INNER) / 2;
  const full = TERRACE_OUTER * 2;

  return (
    <group>
      {/* Stone terrace surrounding the tabletop, flush with its top */}
      <group position={[0, -0.25, 0]}>
        <mesh position={[0, 0, -mid]} receiveShadow>
          <boxGeometry args={[full, 0.5, width]} />
          <meshStandardMaterial color={STONE_DARK} roughness={1} />
        </mesh>
        <mesh position={[0, 0, mid]} receiveShadow>
          <boxGeometry args={[full, 0.5, width]} />
          <meshStandardMaterial color={STONE_DARK} roughness={1} />
        </mesh>
        <mesh position={[-mid, 0, 0]} receiveShadow>
          <boxGeometry args={[width, 0.5, TERRACE_INNER * 2]} />
          <meshStandardMaterial color={STONE_DARK} roughness={1} />
        </mesh>
        <mesh position={[mid, 0, 0]} receiveShadow>
          <boxGeometry args={[width, 0.5, TERRACE_INNER * 2]} />
          <meshStandardMaterial color={STONE_DARK} roughness={1} />
        </mesh>
      </group>
      {pillars.map(spec => (
        <group key={spec.seed}>
          <Pillar spec={spec} />
        </group>
      ))}
      {FALLEN_COLUMNS.map((c, k) => (
        <group key={`fallen${k}`} position={[c.x, 0.3, c.z]} rotation={[0, c.rotY, 0]}>
          <mesh rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[0.3, 0.3, c.length, 10]} />
            <meshStandardMaterial color={STONE} roughness={0.95} />
          </mesh>
          <mesh position={[c.length / 2 + 0.25, -0.02, 0.1]} rotation={[0.3, 0.4, 1.2]}>
            <dodecahedronGeometry args={[0.26, 0]} />
            <meshStandardMaterial color={STONE_DARK} roughness={1} />
          </mesh>
        </group>
      ))}
    </group>
  );
};
