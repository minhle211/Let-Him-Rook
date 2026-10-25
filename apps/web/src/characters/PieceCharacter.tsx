import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { Group } from 'three';
import { MageCharacter } from './MageCharacter.tsx';
import { BattleCharacter } from './BattleCharacter.tsx';
import type { PieceClass, PlayerColor } from '@let-him-rook/shared';

interface PieceCharacterProps {
  pieceClass: PieceClass;
  color: PlayerColor;
  isParrying?: boolean;
  isChilled?: boolean;
  isTeleporting?: boolean;
  isHit?: boolean;
  isAttacking?: boolean;
  rookShotCounter?: number;
  isClone?: boolean;
  hp?: number;
  maxHp?: number;
  scale?: number;
}

export const PieceCharacter: React.FC<PieceCharacterProps> = ({
  pieceClass,
  color,
  isParrying = false,
  isChilled = false,
  isTeleporting = false,
  isHit = false,
  isAttacking = false,
  rookShotCounter = 0,
  isClone = false,
  hp,
  maxHp = 100,
  scale = 1.0,
}) => {
  const swordRef = useRef<Group>(null);
  const slashRef = useRef<Group & { visible: boolean }>(null);
  const swingRef = useRef({ active: false, elapsed: 1 });
  useFrame((_, delta) => {
    if (pieceClass !== 'pawn') return;
    const swing = swingRef.current;
    if (isAttacking && !swing.active) swing.elapsed = 0;
    swing.active = isAttacking;
    swing.elapsed += Math.min(delta, 0.05);
    const t = Math.min(1, swing.elapsed / 0.42);
    // Wind up, sweep across the front, then return to the resting grip.
    const sweep = t < 0.2 ? t / 0.2 : t < 0.7 ? 1 - 2 * ((t - 0.2) / 0.5) : -1 + (t - 0.7) / 0.3;
    if (swordRef.current) {
      swordRef.current.rotation.set(-0.25 - Math.sin(t * Math.PI) * 1.1, sweep * 1.25, -0.1);
    }
    if (slashRef.current) {
      slashRef.current.visible = t > 0.2 && t < 0.78;
      slashRef.current.rotation.y = sweep * 0.6;
      const size = 0.8 + Math.sin(t * Math.PI) * 0.2;
      slashRef.current.scale.set(size, size, size);
    }
  });
  const isWhite = color === 'w';
  const mainColor = isHit ? '#ef4444' : isClone ? '#60a5fa' : isWhite ? '#f8fafc' : '#1e293b';
  const clothColor = isClone ? '#2563eb' : isWhite ? '#2563eb' : '#7c3aed';
  const trimColor = isClone ? '#bae6fd' : isWhite ? '#d4a449' : '#94a3b8';
  const emissiveHit = isHit ? '#dc2626' : '#000000';
  const frostColor = '#38bdf8';

  const renderClassMesh = () => {
    switch (pieceClass) {
      case 'pawn': {
        return (
          <group>
            {/* Low-poly guard, facing -Z. Keep the silhouette inside one square. */}
            <mesh receiveShadow position={[0, 0.09, 0]}>
              <cylinderGeometry args={[0.34, 0.39, 0.18, 10]} />
              <meshStandardMaterial color={trimColor} roughness={0.65} />
            </mesh>
            {[-0.12, 0.12].map((x) => (
              <mesh key={x} castShadow position={[x, 0.28, -0.035]}>
                <boxGeometry args={[0.17, 0.22, 0.25]} />
                <meshStandardMaterial color={mainColor} emissive={emissiveHit} roughness={0.65} metalness={0.25} />
              </mesh>
            ))}
            <mesh castShadow position={[0, 0.53, 0]}>
              <cylinderGeometry args={[0.25, 0.2, 0.36, 6]} />
              <meshStandardMaterial color={mainColor} emissive={emissiveHit} flatShading roughness={0.6} metalness={0.25} />
            </mesh>
            <mesh position={[0, 0.5, -0.185]}>
              <boxGeometry args={[0.14, 0.32, 0.045]} />
              <meshStandardMaterial color={clothColor} roughness={0.9} />
            </mesh>
            {[-0.25, 0.25].map((x) => (
              <mesh key={x} castShadow position={[x, 0.65, 0]}>
                <boxGeometry args={[0.17, 0.17, 0.24]} />
                <meshStandardMaterial color={trimColor} roughness={0.65} metalness={0.3} />
              </mesh>
            ))}
            <mesh castShadow position={[0, 0.89, 0]}>
              <cylinderGeometry args={[0.17, 0.21, 0.3, 8]} />
              <meshStandardMaterial color={mainColor} emissive={emissiveHit} flatShading roughness={0.6} metalness={0.25} />
            </mesh>
            <mesh position={[0, 0.9, -0.185]}>
              <boxGeometry args={[0.25, 0.055, 0.045]} />
              <meshStandardMaterial color="#0f172a" roughness={0.9} />
            </mesh>
            <mesh position={[0, 0.86, -0.215]}>
              <boxGeometry args={[0.045, 0.15, 0.025]} />
              <meshStandardMaterial color={trimColor} roughness={0.65} />
            </mesh>
            <mesh castShadow position={[0, 1.06, 0.015]}>
              <boxGeometry args={[0.07, 0.12, 0.24]} />
              <meshStandardMaterial color={clothColor} roughness={0.9} />
            </mesh>
            {/* Sword and hand pivot together for the existing attack signal. */}
            <group ref={swordRef} position={[0.31, 0.49, -0.08]}>
              <mesh castShadow>
                <boxGeometry args={[0.12, 0.14, 0.14]} />
                <meshStandardMaterial color={mainColor} emissive={emissiveHit} roughness={0.65} />
              </mesh>
              <mesh position={[0, 0.12, 0]}>
                <boxGeometry args={[0.22, 0.045, 0.08]} />
                <meshStandardMaterial color={trimColor} roughness={0.5} metalness={0.4} />
              </mesh>
              <mesh castShadow position={[0, 0.34, 0]}>
                <boxGeometry args={[0.075, 0.4, 0.035]} />
                <meshStandardMaterial color="#cbd5e1" roughness={0.45} metalness={0.5} />
              </mesh>
              <mesh position={[0, 0.58, 0]}>
                <coneGeometry args={[0.05, 0.1, 4]} />
                <meshStandardMaterial color="#cbd5e1" roughness={0.45} metalness={0.5} />
              </mesh>
            </group>
            <group ref={slashRef} visible={false} position={[0, 0.65, -0.15]}>
              <mesh rotation={[-Math.PI / 2, 0, 0]}>
                <ringGeometry args={[0.65, 0.95, 16, 1, Math.PI * 0.12, Math.PI * 0.76]} />
                <meshBasicMaterial color="#fde68a" transparent opacity={0.8} side={2} depthWrite={false} />
              </mesh>
            </group>
            {/* Cylinder face points forward, with a raised defensive pose. */}
            <group position={[isParrying ? -0.12 : -0.29, isParrying ? 0.7 : 0.5, isParrying ? -0.33 : -0.16]} rotation={[Math.PI / 2, 0, 0]}>
              <mesh castShadow>
                <cylinderGeometry args={[0.23, 0.23, 0.07, 8]} />
                <meshStandardMaterial color={trimColor} roughness={0.6} metalness={0.3} />
              </mesh>
              <mesh position={[0, -0.04, 0]}>
                <cylinderGeometry args={[0.185, 0.185, 0.025, 8]} />
                <meshStandardMaterial color={clothColor} roughness={0.85} />
              </mesh>
              <mesh position={[0, -0.07, 0]}>
                <sphereGeometry args={[0.065, 6, 4]} />
                <meshStandardMaterial color={trimColor} flatShading roughness={0.55} metalness={0.3} />
              </mesh>
            </group>
          </group>
        );
      }

      case 'rook':
      case 'knight':
        return <BattleCharacter
          mounted={pieceClass === 'knight'}
          armor={mainColor}
          trim={trimColor}
          cloth={clothColor}
          clone={isClone}
          hit={isHit}
          attacking={isAttacking}
          windingUp={isTeleporting}
          shotCount={rookShotCounter}
        />;

      case 'bishop':
      case 'queen':
      case 'king':
        return <MageCharacter kind={pieceClass} armor={mainColor} cloth={clothColor} trim={trimColor} attacking={isAttacking} clone={isClone} />;

    }
  };

  return (
    <group scale={[scale, scale, scale]}>
      {renderClassMesh()}

      {/* Parry Shield Bubble */}
      {isParrying && (
        <mesh position={[0, 0.65, 0]}>
          <sphereGeometry args={[0.78, 24, 24]} />
          <meshStandardMaterial
            color="#06b6d4"
            emissive="#0891b2"
            emissiveIntensity={0.7}
            transparent
            opacity={0.45}
            wireframe
          />
        </mesh>
      )}

      {/* Chill Frost Effect */}
      {isChilled && (
        <mesh position={[0, 0.6, 0]}>
          <cylinderGeometry args={[0.55, 0.55, 1.3, 12]} />
          <meshStandardMaterial
            color={frostColor}
            emissive="#0284c7"
            transparent
            opacity={0.35}
          />
        </mesh>
      )}

      {/* Teleport Windup Lightning Aura */}
      {isTeleporting && (
        <mesh position={[0, 0.6, 0]}>
          <octahedronGeometry args={[0.85, 1]} />
          <meshStandardMaterial
            color="#fbbf24"
            emissive="#d97706"
            emissiveIntensity={0.8}
            transparent
            opacity={0.6}
            wireframe
          />
        </mesh>
      )}

      {/* Floating HP Bar (Double-Sided so readable from any angle) */}
      {hp !== undefined && (
        <group position={[0, 1.65, 0]}>
          {/* Background Bar */}
          <mesh position={[0, 0, 0]}>
            <boxGeometry args={[0.9, 0.1, 0.03]} />
            <meshBasicMaterial color="#1e293b" />
          </mesh>
          {/* Health Fill */}
          <mesh position={[-0.45 + (Math.max(0, hp) / maxHp) * 0.45, 0, 0.02]}>
            <boxGeometry args={[Math.max(0.02, (Math.max(0, hp) / maxHp) * 0.9), 0.1, 0.03]} />
            <meshBasicMaterial color={hp > 35 ? '#22c55e' : '#ef4444'} />
          </mesh>
        </group>
      )}
    </group>
  );
};
