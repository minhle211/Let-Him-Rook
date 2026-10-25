import React from 'react';
import type { PieceClass, PlayerColor } from '@let-him-rook/shared';

interface PieceCharacterProps {
  pieceClass: PieceClass;
  color: PlayerColor;
  isParrying?: boolean;
  isChilled?: boolean;
  isTeleporting?: boolean;
  isHit?: boolean;
  isAttacking?: boolean;
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
  hp,
  maxHp = 100,
  scale = 1.0,
}) => {
  const isWhite = color === 'w';
  const mainColor = isHit ? '#ef4444' : isWhite ? '#f8fafc' : '#1e293b';
  const accentColor = isWhite ? '#d97706' : '#dc2626';
  const emissiveHit = isHit ? '#dc2626' : '#000000';
  const frostColor = '#38bdf8';

  const renderClassMesh = () => {
    switch (pieceClass) {
      case 'pawn': {
        const clothColor = isWhite ? '#2563eb' : '#7c3aed';
        const trimColor = isWhite ? '#d4a449' : '#94a3b8';
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
            <group position={[0.31, 0.49, -0.08]} rotation={[isAttacking ? -1.25 : -0.25, isAttacking ? -0.65 : 0, -0.1]}>
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
        return (
          <group position={[0, 0.55, 0]}>
            {/* Heavy Base */}
            <mesh castShadow>
              <cylinderGeometry args={[0.38, 0.42, 0.3, 16]} />
              <meshStandardMaterial color={mainColor} emissive={emissiveHit} roughness={0.4} metalness={0.3} />
            </mesh>
            {/* Fortified Torso */}
            <mesh castShadow position={[0, 0.32, 0]}>
              <cylinderGeometry args={[0.32, 0.36, 0.45, 16]} />
              <meshStandardMaterial color={mainColor} emissive={emissiveHit} roughness={0.4} metalness={0.3} />
            </mesh>
            {/* Turret Crown with Crenellations */}
            <mesh castShadow position={[0, 0.62, 0]}>
              <cylinderGeometry args={[0.38, 0.32, 0.22, 8]} />
              <meshStandardMaterial color={accentColor} roughness={0.4} metalness={0.5} />
            </mesh>
            {/* Forward Siege Cannon Barrel (-Z is forward) */}
            <mesh position={[0, 0.38, -0.36]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.11, 0.14, 0.45, 12]} />
              <meshStandardMaterial color="#334155" metalness={0.8} roughness={0.2} />
            </mesh>
            {/* Cannon Muzzle Glow */}
            <mesh position={[0, 0.38, -0.59]}>
              <sphereGeometry args={[0.09, 10, 10]} />
              <meshBasicMaterial color="#f97316" />
            </mesh>
          </group>
        );

      case 'knight':
        return (
          <group position={[0, 0.55, 0]}>
            {/* Base */}
            <mesh castShadow>
              <cylinderGeometry args={[0.35, 0.4, 0.25, 16]} />
              <meshStandardMaterial color={mainColor} emissive={emissiveHit} roughness={0.3} metalness={0.2} />
            </mesh>
            {/* Arched Neck */}
            <mesh castShadow position={[0, 0.32, 0.05]} rotation={[-0.25, 0, 0]}>
              <boxGeometry args={[0.26, 0.45, 0.32]} />
              <meshStandardMaterial color={mainColor} emissive={emissiveHit} roughness={0.3} metalness={0.2} />
            </mesh>
            {/* Equine Snout Facing Forward (-Z) */}
            <mesh castShadow position={[0, 0.5, -0.16]} rotation={[0.2, 0, 0]}>
              <boxGeometry args={[0.22, 0.22, 0.35]} />
              <meshStandardMaterial color={mainColor} emissive={emissiveHit} roughness={0.3} metalness={0.2} />
            </mesh>
            {/* Ears */}
            <mesh position={[-0.08, 0.68, 0.05]}>
              <coneGeometry args={[0.05, 0.15, 4]} />
              <meshStandardMaterial color={accentColor} />
            </mesh>
            <mesh position={[0.08, 0.68, 0.05]}>
              <coneGeometry args={[0.05, 0.15, 4]} />
              <meshStandardMaterial color={accentColor} />
            </mesh>
            {/* Twin Cleave Blades */}
            <mesh position={[0.32, 0.32, -0.22]} rotation={[1.2, 0, 0]}>
              <boxGeometry args={[0.04, 0.5, 0.1]} />
              <meshStandardMaterial color="#fbbf24" emissive="#d97706" emissiveIntensity={0.4} metalness={0.8} />
            </mesh>
            <mesh position={[-0.32, 0.32, -0.22]} rotation={[1.2, 0, 0]}>
              <boxGeometry args={[0.04, 0.5, 0.1]} />
              <meshStandardMaterial color="#fbbf24" emissive="#d97706" emissiveIntensity={0.4} metalness={0.8} />
            </mesh>
          </group>
        );

      case 'bishop':
        return (
          <group position={[0, 0.6, 0]}>
            {/* Slender Base */}
            <mesh castShadow>
              <cylinderGeometry args={[0.34, 0.4, 0.25, 16]} />
              <meshStandardMaterial color={mainColor} emissive={emissiveHit} roughness={0.3} metalness={0.2} />
            </mesh>
            {/* Tall Body */}
            <mesh castShadow position={[0, 0.35, 0]}>
              <cylinderGeometry args={[0.22, 0.32, 0.55, 16]} />
              <meshStandardMaterial color={mainColor} emissive={emissiveHit} roughness={0.3} metalness={0.2} />
            </mesh>
            {/* Mitre Cap */}
            <mesh castShadow position={[0, 0.72, 0]}>
              <coneGeometry args={[0.24, 0.42, 16]} />
              <meshStandardMaterial color={mainColor} emissive={emissiveHit} roughness={0.3} metalness={0.2} />
            </mesh>
            {/* Top Cross Finial */}
            <mesh position={[0, 0.96, 0]}>
              <sphereGeometry args={[0.07, 8, 8]} />
              <meshStandardMaterial color={accentColor} metalness={0.6} />
            </mesh>
            {/* Frost Staff on Right Side (-Z forward) */}
            <group position={[0.32, 0.4, -0.18]} rotation={[0.25, 0, 0]}>
              <mesh>
                <cylinderGeometry args={[0.03, 0.03, 0.85, 8]} />
                <meshStandardMaterial color="#cbd5e1" metalness={0.6} />
              </mesh>
              <mesh position={[0, 0.46, 0]}>
                <octahedronGeometry args={[0.11, 0]} />
                <meshStandardMaterial color="#38bdf8" emissive="#0284c7" emissiveIntensity={0.9} />
              </mesh>
            </group>
          </group>
        );

      case 'queen':
        return (
          <group position={[0, 0.65, 0]}>
            {/* Flared Base */}
            <mesh castShadow>
              <cylinderGeometry args={[0.36, 0.42, 0.25, 16]} />
              <meshStandardMaterial color={mainColor} emissive={emissiveHit} roughness={0.2} metalness={0.3} />
            </mesh>
            {/* Tapered Elegant Waist */}
            <mesh castShadow position={[0, 0.38, 0]}>
              <cylinderGeometry args={[0.2, 0.34, 0.6, 16]} />
              <meshStandardMaterial color={mainColor} emissive={emissiveHit} roughness={0.2} metalness={0.3} />
            </mesh>
            {/* Coronet Crown */}
            <mesh castShadow position={[0, 0.76, 0]}>
              <cylinderGeometry args={[0.32, 0.22, 0.28, 12]} />
              <meshStandardMaterial color={accentColor} roughness={0.3} metalness={0.6} />
            </mesh>
            {/* Crown Jewel */}
            <mesh position={[0, 0.94, 0]}>
              <sphereGeometry args={[0.09, 12, 12]} />
              <meshStandardMaterial color="#ec4899" emissive="#be185d" />
            </mesh>
            {/* 3 Floating Arcane Seeking Orbs */}
            <mesh position={[-0.36, 0.55, -0.2]}>
              <sphereGeometry args={[0.08, 10, 10]} />
              <meshStandardMaterial color="#a855f7" emissive="#9333ea" emissiveIntensity={0.9} />
            </mesh>
            <mesh position={[0, 0.68, -0.3]}>
              <sphereGeometry args={[0.08, 10, 10]} />
              <meshStandardMaterial color="#a855f7" emissive="#9333ea" emissiveIntensity={0.9} />
            </mesh>
            <mesh position={[0.36, 0.55, -0.2]}>
              <sphereGeometry args={[0.08, 10, 10]} />
              <meshStandardMaterial color="#a855f7" emissive="#9333ea" emissiveIntensity={0.9} />
            </mesh>
          </group>
        );

      case 'king':
        return (
          <group position={[0, 0.7, 0]}>
            {/* Grand Pedestal */}
            <mesh castShadow>
              <cylinderGeometry args={[0.38, 0.44, 0.25, 16]} />
              <meshStandardMaterial color={mainColor} emissive={emissiveHit} roughness={0.3} metalness={0.3} />
            </mesh>
            {/* Regal Robe Torso */}
            <mesh castShadow position={[0, 0.42, 0]}>
              <cylinderGeometry args={[0.28, 0.36, 0.68, 16]} />
              <meshStandardMaterial color={mainColor} emissive={emissiveHit} roughness={0.3} metalness={0.3} />
            </mesh>
            {/* Arched Crown */}
            <mesh castShadow position={[0, 0.85, 0]}>
              <sphereGeometry args={[0.26, 16, 12]} />
              <meshStandardMaterial color={accentColor} roughness={0.3} metalness={0.6} />
            </mesh>
            {/* Maltese Cross */}
            <group position={[0, 1.15, 0]}>
              <mesh>
                <boxGeometry args={[0.08, 0.24, 0.08]} />
                <meshStandardMaterial color={accentColor} metalness={0.7} />
              </mesh>
              <mesh>
                <boxGeometry args={[0.2, 0.08, 0.08]} />
                <meshStandardMaterial color={accentColor} metalness={0.7} />
              </mesh>
            </group>
            {/* Royal Summoner Scepter */}
            <group position={[0.36, 0.45, -0.18]} rotation={[0.2, 0, 0]}>
              <mesh>
                <cylinderGeometry args={[0.03, 0.03, 0.9, 8]} />
                <meshStandardMaterial color="#fbbf24" metalness={0.8} />
              </mesh>
              <mesh position={[0, 0.48, 0]}>
                <sphereGeometry args={[0.1, 10, 10]} />
                <meshStandardMaterial color="#fde047" emissive="#eab308" emissiveIntensity={0.8} />
              </mesh>
            </group>
          </group>
        );
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
