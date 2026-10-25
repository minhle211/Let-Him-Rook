import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { BufferAttribute, BufferGeometry, Shape } from 'three';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import {
  PUDDLES,
  TOWER,
  TREES,
  TUNNEL,
  castleTunnels,
  isInsideCastle,
  type ObstacleState,
} from '@let-him-rook/shared';
import { matchStore } from '../state/matchStore.ts';
import { CastleTunnels } from './CastleTunnels.tsx';

/**
 * Visuals for the fixed arena features (layout and collision live in shared/arena.ts):
 * reflective puddles, trees, and a two-storey round stone tower with two arched gates.
 */

const STONE = '#a39c90';
const STONE_DARK = '#746e65';
const SLATE = '#4f5562';
const WOOD = '#4a3424';
const OPENING = '#17130f';

// Tower storeys (world units). The clear doorway is taller than the tallest fighter (mounted
// knight ~1.6) and its floating HP bar (1.65); the arch head sits above it.
const DOOR_HEIGHT = 1.85;
const GROUND_FLOOR = 2.5;
const UPPER_FLOOR = 1.7;
const WALL_TOP = GROUND_FLOOR + UPPER_FLOOR;

function rand(seed: number): number {
  const s = Math.sin(seed * 91.7 + 47.3) * 43758.5453;
  return s - Math.floor(s);
}

/** Both puddles share one mirror (a single extra low-res render pass) plus a translucent water tint on top. */
const Puddles: React.FC = () => {
  const { geometry, mirror } = useMemo(() => {
    const segments = 28;
    const pos: number[] = [];
    const nor: number[] = [];
    const idx: number[] = [];
    PUDDLES.forEach((p, pi) => {
      const centre = pos.length / 3;
      // Local XY plane; the mesh is rotated flat so local y maps to world -z.
      pos.push(p.x, -p.z, 0);
      nor.push(0, 0, 1);
      for (let k = 0; k < segments; k++) {
        const a = (k / segments) * Math.PI * 2;
        const wobble = 0.86 + rand(pi * 50 + k) * 0.22;
        pos.push(p.x + Math.cos(a) * p.rx * wobble, -(p.z + Math.sin(a) * p.rz * wobble), 0);
        nor.push(0, 0, 1);
        // Counter-clockwise seen from above (local y is flipped), so the face points up
        idx.push(centre, centre + 1 + ((k + 1) % segments), centre + 1 + k);
      }
    });
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
    geo.setAttribute('normal', new BufferAttribute(new Float32Array(nor), 3));
    geo.setIndex(new BufferAttribute(new Uint16Array(idx), 1));
    const reflector = new Reflector(geo, { textureWidth: 384, textureHeight: 384, color: 0xc8d2dc });
    reflector.rotation.x = -Math.PI / 2;
    reflector.position.y = 0.04; // just above the flagstones
    return { geometry: geo, mirror: reflector };
  }, []);

  return (
    <group>
      <primitive object={mirror} />
      <mesh geometry={geometry} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.044, 0]}>
        <meshStandardMaterial
          color="#7da2c6"
          emissive="#1a2f48"
          transparent
          opacity={0.45}
          roughness={0.05}
          metalness={0.1}
        />
      </mesh>
    </group>
  );
};

const Tree: React.FC<{ x: number; z: number; seed: number; frozen: boolean }> = ({ x, z, seed, frozen }) => {
  const canopy = useMemo(
    () =>
      [0, 1, 2, 3].map(k => ({
        pos: [
          (rand(seed * 10 + k) - 0.5) * 0.7,
          1.55 + rand(seed * 10 + k + 4) * 0.6,
          (rand(seed * 10 + k + 8) - 0.5) * 0.7,
        ] as [number, number, number],
        r: 0.5 + rand(seed * 10 + k + 12) * 0.2,
        color: k % 2 ? '#3f7a3a' : '#4f8f45',
      })),
    [seed]
  );
  return (
    <group position={[x, 0, z]} rotation={[0, rand(seed) * Math.PI * 2, 0]}>
      <mesh position={[0, 0.65, 0]} castShadow>
        <cylinderGeometry args={[0.17, 0.26, 1.3, 7]} />
        <meshStandardMaterial color="#6b4a2e" roughness={1} />
      </mesh>
      {canopy.map((c, k) => (
        <mesh key={k} position={c.pos} castShadow>
          <icosahedronGeometry args={[c.r, 0]} />
          <meshStandardMaterial color={c.color} roughness={0.95} flatShading />
        </mesh>
      ))}
      {frozen && (
        <mesh position={[0, 1.2, 0]}>
          <cylinderGeometry args={[0.75, 0.6, 2.4, 8]} />
          <meshStandardMaterial color="#67e8f9" emissive="#06b6d4" transparent opacity={0.45} />
        </mesh>
      )}
    </group>
  );
};

/**
 * Flat annular arc between world angles w0..w1 (atan2(z, x)), for extruding upward.
 * The extrusion is rotated -90 deg about X, which maps shape angle a to world angle -a.
 */
function wallArc(innerR: number, outerR: number, w0: number, w1: number): Shape {
  const shape = new Shape();
  shape.absarc(0, 0, outerR, -w1, -w0, false);
  shape.absarc(0, 0, innerR, -w0, -w1, true);
  return shape;
}

/** Group rotation that turns local +x toward world angle w. */
const facing = (w: number): [number, number, number] => [0, -w, 0];

const WallPiece: React.FC<{ shape: Shape; y: number; height: number; fadeable: (m: any) => void; color: string }> = ({
  shape,
  y,
  height,
  fadeable,
  color,
}) => (
  <mesh position={[0, y, 0]} rotation={[-Math.PI / 2, 0, 0]} castShadow receiveShadow>
    <extrudeGeometry args={[shape, { depth: height, bevelEnabled: false, curveSegments: 40 }]} />
    <meshStandardMaterial ref={fadeable} color={color} roughness={0.95} flatShading transparent />
  </mesh>
);

/** Arched opening drawn on the wall face: dark arch head above a doorway or a small window. */
const ArchedOpening: React.FC<{
  angle: number;
  radius: number;
  y: number;
  width: number;
  height: number;
  trim: boolean;
  fadeable: (m: any) => void;
}> = ({ angle, radius, y, width, height, trim, fadeable }) => (
  <group rotation={facing(angle)}>
    <group position={[radius, y, 0]} rotation={[0, Math.PI / 2, 0]}>
      {height > 0 && (
        <mesh position={[0, height / 2, 0]}>
          <planeGeometry args={[width, height]} />
          <meshStandardMaterial ref={fadeable} color={OPENING} transparent />
        </mesh>
      )}
      <mesh position={[0, height, 0]}>
        <circleGeometry args={[width / 2, 14, 0, Math.PI]} />
        <meshStandardMaterial ref={fadeable} color={OPENING} transparent />
      </mesh>
      {trim && (
        <mesh position={[0, height, 0.02]}>
          <torusGeometry args={[width / 2 + 0.05, 0.06, 5, 14, Math.PI]} />
          <meshStandardMaterial ref={fadeable} color={STONE_DARK} roughness={1} flatShading transparent />
        </mesh>
      )}
    </group>
  </group>
);

const CastleTower: React.FC<{ hitsRemaining: number; maxHits: number }> = ({ hitsRemaining, maxHits }) => {
  const materials = useRef<any[]>([]);
  const fade = useRef(1);
  const fadeable = (m: any) => {
    if (m && !materials.current.includes(m)) materials.current.push(m);
  };

  const outerR = TOWER.radius;
  const innerR = TOWER.radius - TOWER.wallThickness;
  const ringR = TOWER.radius - TOWER.wallThickness / 2;
  // Visible doorway half-angle: the clear opening measured at the middle of the wall
  const doorHalf = Math.asin(TOWER.gateWidth / 2 / ringR);
  const [gateA, gateB] = TOWER.gateAngles; // 0 (toward the board) and -90 deg

  const shapes = useMemo(
    () => ({
      // Ground floor: two arcs leaving the doorways open
      between: wallArc(innerR, outerR, gateB + doorHalf, gateA - doorHalf),
      around: wallArc(innerR, outerR, gateA + doorHalf, gateB + Math.PI * 2 - doorHalf),
      // Above the doors and the whole upper floor: a full ring (two halves)
      upperA: wallArc(innerR, outerR, 0, Math.PI),
      upperB: wallArc(innerR, outerR, Math.PI, Math.PI * 2),
    }),
    [innerR, outerR, doorHalf, gateA, gateB]
  );

  const windows = useMemo(() => [-Math.PI / 4, Math.PI / 4, (3 * Math.PI) / 4, (-3 * Math.PI) / 4 + 0.15, Math.PI / 2 + 0.35], []);
  const corbels = useMemo(() => Array.from({ length: 22 }, (_, k) => (k / 22) * Math.PI * 2), []);
  const ivy = useMemo(
    () =>
      Array.from({ length: 16 }, (_, k) => {
        const a = Math.PI * 0.55 + rand(k + 300) * 0.9; // the back-left face
        const y = 0.2 + rand(k + 340) * 3.2;
        return { pos: [Math.cos(a) * (outerR + 0.04), y, Math.sin(a) * (outerR + 0.04)] as [number, number, number], s: 0.12 + rand(k + 380) * 0.1 };
      }),
    [outerR]
  );

  useFrame(({ camera }) => {
    // Only go see-through once the local fighter is actually inside, or the camera would sit inside the walls.
    let target = 1;
    const state = matchStore.getState();
    const duel = state.snapshot?.duelSnapshot;
    if (duel && state.localColor) {
      const me = duel.attacker.color === state.localColor ? duel.attacker : duel.defender;
      const inside = isInsideCastle(me.x, me.z, TOWER.x, TOWER.z);
      const cx = camera.position.x - TOWER.x;
      const cz = camera.position.z - TOWER.z;
      const camInTower = camera.position.y < WALL_TOP + 1.8 && Math.hypot(cx, cz) < outerR + 0.7;
      const camInTunnel =
        camera.position.y < 5.3 &&
        castleTunnels().some(t => {
          const along = cx * t.dx + cz * t.dz;
          return along > outerR && along < t.end + 0.4 && Math.abs(cx * t.lx + cz * t.lz) < TUNNEL.clearWidth / 2 + 0.9;
        });
      const camInWalls = camInTower || camInTunnel;
      if (inside || camInWalls) target = 0.2;
    }
    fade.current += (target - fade.current) * 0.2;
    for (const m of materials.current) {
      m.opacity = fade.current;
      m.depthWrite = fade.current > 0.98;
    }
  });

  if (hitsRemaining <= 0) {
    // Collapsed: rubble where the tower stood and along both tunnels
    const tunnels = castleTunnels();
    return (
      <group position={[TOWER.x, 0, TOWER.z]}>
        {Array.from({ length: 40 }, (_, k) => {
          let px: number;
          let pz: number;
          if (k < 18) {
            const a = rand(k) * Math.PI * 2;
            const d = rand(k + 200) * outerR * 1.1;
            px = Math.cos(a) * d;
            pz = Math.sin(a) * d;
          } else {
            const t = tunnels[k % 2];
            const along = outerR + rand(k + 200) * (t.end - outerR);
            const lateral = (rand(k + 260) - 0.5) * (TUNNEL.clearWidth + 0.8);
            px = t.dx * along + t.lx * lateral;
            pz = t.dz * along + t.lz * lateral;
          }
          return (
            <mesh
              key={k}
              position={[px, 0.15 + rand(k + 30) * 0.3, pz]}
              rotation={[rand(k + 90) * 3, rand(k + 120) * 3, 0]}
            >
              <dodecahedronGeometry args={[0.22 + rand(k + 150) * 0.22, 0]} />
              <meshStandardMaterial color={k % 4 === 0 ? SLATE : k % 3 ? STONE : STONE_DARK} roughness={1} flatShading />
            </mesh>
          );
        })}
      </group>
    );
  }

  // Damage darkens the stone and knocks the roof askew
  const damage = 1 - hitsRemaining / maxHits;
  const stone = damage > 0.5 ? STONE_DARK : STONE;
  const roofY = WALL_TOP + 0.32;

  return (
    <group position={[TOWER.x, 0, TOWER.z]}>
      {/* Flagstone floor inside */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]} receiveShadow>
        <circleGeometry args={[innerR, 24]} />
        <meshStandardMaterial ref={fadeable} color="#5c574f" roughness={1} transparent />
      </mesh>

      {/* Ground floor with two doorways, then the solid upper floor */}
      <WallPiece shape={shapes.between} y={0} height={DOOR_HEIGHT} fadeable={fadeable} color={stone} />
      <WallPiece shape={shapes.around} y={0} height={DOOR_HEIGHT} fadeable={fadeable} color={stone} />
      <WallPiece shape={shapes.upperA} y={DOOR_HEIGHT} height={WALL_TOP - DOOR_HEIGHT} fadeable={fadeable} color={stone} />
      <WallPiece shape={shapes.upperB} y={DOOR_HEIGHT} height={WALL_TOP - DOOR_HEIGHT} fadeable={fadeable} color={stone} />

      {/* Arched heads over the doorways, windows on the upper floor */}
      {TOWER.gateAngles.map((g, k) => (
        <group key={`door${k}`}>
          <ArchedOpening angle={g} radius={outerR + 0.012} y={DOOR_HEIGHT} width={TOWER.gateWidth} height={0} trim fadeable={fadeable} />
        </group>
      ))}
      {windows.map((w, k) => (
        <group key={`win${k}`}>
          <ArchedOpening angle={w} radius={outerR + 0.012} y={GROUND_FLOOR + 0.5} width={0.26} height={0.4} trim={false} fadeable={fadeable} />
        </group>
      ))}

      {/* String course between the storeys */}
      <mesh position={[0, GROUND_FLOOR + 0.05, 0]}>
        <cylinderGeometry args={[outerR + 0.05, outerR + 0.05, 0.1, 40, 1, true]} />
        <meshStandardMaterial ref={fadeable} color={STONE_DARK} roughness={1} transparent />
      </mesh>

      {/* Corbelled ledge (machicolation) carrying the roof */}
      <mesh position={[0, WALL_TOP + 0.16, 0]} castShadow>
        <cylinderGeometry args={[outerR + 0.16, outerR + 0.16, 0.32, 40]} />
        <meshStandardMaterial ref={fadeable} color={stone} roughness={0.95} flatShading transparent />
      </mesh>
      {corbels.map((a, k) => (
        <mesh key={`c${k}`} position={[Math.cos(a) * (outerR + 0.06), WALL_TOP - 0.08, Math.sin(a) * (outerR + 0.06)]} rotation={facing(a)}>
          <boxGeometry args={[0.16, 0.18, 0.12]} />
          <meshStandardMaterial ref={fadeable} color={STONE_DARK} roughness={1} transparent />
        </mesh>
      ))}

      {/* Flared slate roof with wooden eaves and an open lookout on top */}
      <group position={[0, roofY, 0]} rotation={[damage * 0.14, 0, damage * 0.1]}>
        <mesh position={[0, 0.03, 0]}>
          <cylinderGeometry args={[outerR + 0.5, outerR + 0.5, 0.07, 32]} />
          <meshStandardMaterial ref={fadeable} color={WOOD} roughness={1} transparent />
        </mesh>
        {corbels.map((a, k) => (
          <mesh key={`b${k}`} position={[Math.cos(a) * (outerR + 0.32), -0.04, Math.sin(a) * (outerR + 0.32)]} rotation={facing(a)}>
            <boxGeometry args={[0.36, 0.08, 0.06]} />
            <meshStandardMaterial ref={fadeable} color={WOOD} roughness={1} transparent />
          </mesh>
        ))}
        <mesh position={[0, 0.25, 0]} castShadow>
          <cylinderGeometry args={[outerR * 0.78, outerR + 0.62, 0.4, 24]} />
          <meshStandardMaterial ref={fadeable} color={SLATE} roughness={0.9} flatShading transparent />
        </mesh>
        <mesh position={[0, 0.9, 0]} castShadow>
          <cylinderGeometry args={[0.32, outerR * 0.78, 0.9, 24]} />
          <meshStandardMaterial ref={fadeable} color={SLATE} roughness={0.9} flatShading transparent />
        </mesh>
        {/* Lookout: posts under a small cap */}
        {Array.from({ length: 6 }, (_, k) => {
          const a = (k / 6) * Math.PI * 2;
          return (
            <mesh key={`p${k}`} position={[Math.cos(a) * 0.26, 1.5, Math.sin(a) * 0.26]}>
              <boxGeometry args={[0.06, 0.3, 0.06]} />
              <meshStandardMaterial ref={fadeable} color={WOOD} roughness={1} transparent />
            </mesh>
          );
        })}
        <mesh position={[0, 1.36, 0]}>
          <cylinderGeometry args={[0.34, 0.34, 0.03, 12]} />
          <meshStandardMaterial ref={fadeable} color={WOOD} transparent />
        </mesh>
        <mesh position={[0, 1.66, 0]}>
          <cylinderGeometry args={[0.4, 0.4, 0.04, 12]} />
          <meshStandardMaterial ref={fadeable} color={WOOD} transparent />
        </mesh>
        <mesh position={[0, 1.86, 0]}>
          <coneGeometry args={[0.44, 0.38, 12]} />
          <meshStandardMaterial ref={fadeable} color={SLATE} roughness={0.9} flatShading transparent />
        </mesh>
        <mesh position={[0, 2.1, 0]}>
          <sphereGeometry args={[0.05, 6, 6]} />
          <meshStandardMaterial ref={fadeable} color="#2f2f2f" transparent />
        </mesh>
      </group>

      {/* Roofed tunnels out of both gates, ending in turrets */}
      <CastleTunnels fadeable={fadeable} />

      {/* Ivy creeping up the back of the tower */}
      {ivy.map((leaf, k) => (
        <mesh key={`i${k}`} position={leaf.pos} scale={[leaf.s, leaf.s, leaf.s]}>
          <icosahedronGeometry args={[1, 0]} />
          <meshStandardMaterial ref={fadeable} color={k % 2 ? '#3f7a3a' : '#4f8f45'} roughness={1} flatShading transparent />
        </mesh>
      ))}
    </group>
  );
};

export const ArenaFeatures: React.FC<{ obstacles: ObstacleState[] }> = ({ obstacles }) => {
  const byId = useMemo(() => new Map(obstacles.map(o => [o.id, o])), [obstacles]);
  const tower = byId.get(TOWER.id);

  return (
    <group>
      <Puddles />
      {TREES.map((tree, k) => (
        <group key={tree.id}>
          <Tree x={tree.x} z={tree.z} seed={k + 1} frozen={(byId.get(tree.id)?.frozenRemainingMs ?? 0) > 0} />
        </group>
      ))}
      <CastleTower hitsRemaining={tower?.hitsRemaining ?? TOWER.maxHits} maxHits={tower?.maxHits ?? TOWER.maxHits} />
    </group>
  );
};
