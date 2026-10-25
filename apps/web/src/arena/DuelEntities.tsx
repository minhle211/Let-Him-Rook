import React, { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  type PlayerColor,
} from '@let-him-rook/shared';
import { PieceCharacter } from '../characters/PieceCharacter.tsx';
import {
  matchStore,
  type InterpolationState,
  type VisualDuelEffect,
} from '../state/matchStore.ts';

interface DuelEntitiesProps {
  interpolation: InterpolationState;
  localColor: PlayerColor | null;
  isDuelActive: boolean;
  visualEffects?: VisualDuelEffect[];
}

function lerpAngle(a: number, b: number, t: number): number {
  let diff = b - a;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
}

export const DuelEntities: React.FC<DuelEntitiesProps> = ({
  interpolation,
  localColor,
  isDuelActive,
  visualEffects = [],
}) => {
  const { camera } = useThree();
  const attackerRef = useRef<any>(null);
  const defenderRef = useRef<any>(null);
  const projectileRefs = useRef<Map<string, any>>(new Map());
  const allyRefs = useRef<Map<string, any>>(new Map());
  const lookTargetRef = useRef<{ x: number; y: number; z: number }>({ x: 0, y: 0.5, z: 0 });

  useFrame((_, delta) => {
    const liveInterp = matchStore.getState().interpolation || interpolation;
    const { targetDuel, prevDuel, prevReceivedAt, targetReceivedAt } = liveInterp;
    const now = performance.now();
    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

    if (targetDuel) {
      const rawInterval = targetReceivedAt - prevReceivedAt;
      const interval = Math.min(120, Math.max(30, rawInterval || 50));
      const elapsedSinceTarget = Math.max(0, now - targetReceivedAt);
      const alpha = Math.min(1.0, elapsedSinceTarget / interval);
      const extrapSec = Math.min(0.06, elapsedSinceTarget / 1000);

      // 1. Attacker smooth interpolation (never overwritten by JSX position prop)
      if (attackerRef.current) {
        const fromX = prevDuel?.attacker.x ?? targetDuel.attacker.x;
        const fromZ = prevDuel?.attacker.z ?? targetDuel.attacker.z;
        const fromRot = -(prevDuel?.attacker.facingRad ?? targetDuel.attacker.facingRad);
        const toRot = -targetDuel.attacker.facingRad;

        const curX = lerp(fromX, targetDuel.attacker.x, alpha);
        const curZ = lerp(fromZ, targetDuel.attacker.z, alpha);
        const bobY =
          Math.hypot(targetDuel.attacker.vx, targetDuel.attacker.vz) > 0.1
            ? Math.abs(Math.sin(now * 0.014)) * 0.08
            : 0;

        attackerRef.current.position.set(curX, bobY, curZ);
        attackerRef.current.rotation.y = lerpAngle(fromRot, toRot, alpha);
      }

      // 2. Defender smooth interpolation
      if (defenderRef.current) {
        const fromX = prevDuel?.defender.x ?? targetDuel.defender.x;
        const fromZ = prevDuel?.defender.z ?? targetDuel.defender.z;
        const fromRot = -(prevDuel?.defender.facingRad ?? targetDuel.defender.facingRad);
        const toRot = -targetDuel.defender.facingRad;

        const curX = lerp(fromX, targetDuel.defender.x, alpha);
        const curZ = lerp(fromZ, targetDuel.defender.z, alpha);
        const bobY =
          Math.hypot(targetDuel.defender.vx, targetDuel.defender.vz) > 0.1
            ? Math.abs(Math.sin(now * 0.014 + 1.5)) * 0.08
            : 0;

        defenderRef.current.position.set(curX, bobY, curZ);
        defenderRef.current.rotation.y = lerpAngle(fromRot, toRot, alpha);
      }

      // 3. Projectiles smooth 60fps velocity extrapolation
      for (const proj of targetDuel.projectiles) {
        const ref = projectileRefs.current.get(proj.id);
        if (ref) {
          const px = proj.x + proj.vx * extrapSec;
          const pz = proj.z + proj.vz * extrapSec;
          ref.position.set(px, 0.65, pz);
        }
      }

      // 4. Summoned Allies smooth interpolation
      for (const ally of targetDuel.allies) {
        const ref = allyRefs.current.get(ally.id);
        if (ref) {
          const prevAlly = prevDuel?.allies.find(a => a.id === ally.id);
          const ax = lerp(prevAlly?.x ?? ally.x, ally.x, alpha);
          const az = lerp(prevAlly?.z ?? ally.z, ally.z, alpha);
          ref.position.set(ax, 0, az);
          ref.rotation.y = -ally.facingRad;
        }
      }

      // 5. Over-the-back 3D Duel Aim Camera
      if (isDuelActive && camera) {
        const localFighter =
          targetDuel.attacker.color === (localColor || 'w')
            ? targetDuel.attacker
            : targetDuel.defender;
        const prevLocal =
          prevDuel &&
          (targetDuel.attacker.color === (localColor || 'w') ? prevDuel.attacker : prevDuel.defender);

        const fromRot = -(prevLocal?.facingRad ?? localFighter.facingRad);
        const toRot = -localFighter.facingRad;
        const curRotY = lerpAngle(fromRot, toRot, alpha);
        const curFacingRad = -curRotY;

        const forwardX = Math.sin(curFacingRad);
        const forwardZ = -Math.cos(curFacingRad);

        const fromX = prevLocal?.x ?? localFighter.x;
        const fromZ = prevLocal?.z ?? localFighter.z;
        const curFighterX = lerp(fromX, localFighter.x, alpha);
        const curFighterZ = lerp(fromZ, localFighter.z, alpha);

        const targetCamX = Math.max(-9.5, Math.min(9.5, curFighterX - forwardX * 5.2));
        const targetCamY = 4.1;
        const targetCamZ = Math.max(-9.5, Math.min(9.5, curFighterZ - forwardZ * 5.2));

        const camSmooth = Math.min(1, delta * 4.5);
        camera.position.x = lerp(camera.position.x, targetCamX, camSmooth);
        camera.position.y = lerp(camera.position.y, targetCamY, camSmooth);
        camera.position.z = lerp(camera.position.z, targetCamZ, camSmooth);

        const desiredLookX = curFighterX + forwardX * 3.5;
        const desiredLookY = 0.75;
        const desiredLookZ = curFighterZ + forwardZ * 3.5;

        lookTargetRef.current.x = lerp(lookTargetRef.current.x, desiredLookX, camSmooth);
        lookTargetRef.current.y = lerp(lookTargetRef.current.y, desiredLookY, camSmooth);
        lookTargetRef.current.z = lerp(lookTargetRef.current.z, desiredLookZ, camSmooth);

        camera.lookAt(
          lookTargetRef.current.x,
          lookTargetRef.current.y,
          lookTargetRef.current.z
        );
        return;
      }
    }

    // Elevated overview during chess board phase
    if (camera && !isDuelActive) {
      const camZ = localColor === 'b' ? -8.2 : 8.2;
      const camSmooth = Math.min(1, delta * 4);
      camera.position.x = lerp(camera.position.x, 0, camSmooth);
      camera.position.y = lerp(camera.position.y, 8.8, camSmooth);
      camera.position.z = lerp(camera.position.z, camZ, camSmooth);

      lookTargetRef.current.x = lerp(lookTargetRef.current.x, 0, camSmooth);
      lookTargetRef.current.y = lerp(lookTargetRef.current.y, 0, camSmooth);
      lookTargetRef.current.z = lerp(lookTargetRef.current.z, 0, camSmooth);
      camera.lookAt(
        lookTargetRef.current.x,
        lookTargetRef.current.y,
        lookTargetRef.current.z
      );
    }
  });

  const duel = interpolation.targetDuel;
  if (!duel) return null;

  const now = performance.now();
  const attackerColor = duel.attacker.color;
  const defenderColor = duel.defender.color;

  const isAttackerHit = visualEffects.some(
    v =>
      now - v.createdAt < 280 &&
      (v.event.type === 'melee_hit' || v.event.type === 'projectile_hit') &&
      v.event.data.target === attackerColor
  );
  const isDefenderHit = visualEffects.some(
    v =>
      now - v.createdAt < 280 &&
      (v.event.type === 'melee_hit' || v.event.type === 'projectile_hit') &&
      v.event.data.target === defenderColor
  );

  const isAttackerAttacking = visualEffects.some(
    v =>
      now - v.createdAt < 350 &&
      ((v.event.type === 'melee_hit' && v.event.data.target === defenderColor) ||
        (v.event.type === 'projectile_spawn' && v.event.data.owner === attackerColor))
  );
  const isDefenderAttacking = visualEffects.some(
    v =>
      now - v.createdAt < 350 &&
      ((v.event.type === 'melee_hit' && v.event.data.target === attackerColor) ||
        (v.event.type === 'projectile_spawn' && v.event.data.owner === defenderColor))
  );

  return (
    <group>
      {/* Attacker Fighter (position controlled strictly in useFrame to prevent 20Hz React snap) */}
      <group
        ref={(node: any) => {
          if (node && !attackerRef.current) {
            node.position.set(duel.attacker.x, 0, duel.attacker.z);
            node.rotation.y = -duel.attacker.facingRad;
          }
          attackerRef.current = node;
        }}
      >
        {/* Ground Team Ring under Attacker */}
        <mesh position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.42, 0.54, 24]} />
          <meshBasicMaterial color={attackerColor === 'w' ? '#fbbf24' : '#c084fc'} />
        </mesh>
        <PieceCharacter
          pieceClass={duel.attacker.pieceClass}
          color={duel.attacker.color}
          hp={duel.attacker.hp}
          maxHp={duel.attacker.maxHp}
          isParrying={duel.attacker.isParrying}
          isChilled={duel.attacker.isChilled}
          isTeleporting={duel.attacker.teleportWindupRemainingMs > 0}
          isHit={isAttackerHit}
          isAttacking={isAttackerAttacking}
        />
        {isAttackerAttacking && (
          <mesh position={[0, 0.55, -0.7]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0.4, 1.3, 16, 1, -Math.PI * 0.4, Math.PI * 0.8]} />
            <meshBasicMaterial color="#fbbf24" transparent opacity={0.75} />
          </mesh>
        )}
      </group>

      {/* Defender Fighter (position controlled strictly in useFrame to prevent 20Hz React snap) */}
      <group
        ref={(node: any) => {
          if (node && !defenderRef.current) {
            node.position.set(duel.defender.x, 0, duel.defender.z);
            node.rotation.y = -duel.defender.facingRad;
          }
          defenderRef.current = node;
        }}
      >
        {/* Ground Team Ring under Defender */}
        <mesh position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.42, 0.54, 24]} />
          <meshBasicMaterial color={defenderColor === 'w' ? '#fbbf24' : '#c084fc'} />
        </mesh>
        <PieceCharacter
          pieceClass={duel.defender.pieceClass}
          color={duel.defender.color}
          hp={duel.defender.hp}
          maxHp={duel.defender.maxHp}
          isParrying={duel.defender.isParrying}
          isChilled={duel.defender.isChilled}
          isTeleporting={duel.defender.teleportWindupRemainingMs > 0}
          isHit={isDefenderHit}
          isAttacking={isDefenderAttacking}
        />
        {isDefenderAttacking && (
          <mesh position={[0, 0.55, -0.7]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0.4, 1.3, 16, 1, -Math.PI * 0.4, Math.PI * 0.8]} />
            <meshBasicMaterial color="#38bdf8" transparent opacity={0.75} />
          </mesh>
        )}
      </group>

      {/* Projectiles (interpolated at 60fps via projectileRefs) */}
      {duel.projectiles.map(proj => {
        let color = '#f97316'; // Orange default
        let radius = proj.radius;
        if (proj.type === 'bishop_ice_bolt') {
          color = '#38bdf8'; // Frost cyan
        } else if (proj.type === 'queen_orb') {
          color = '#a855f7'; // Purple
        } else if (proj.type === 'rook_cannon_bomb') {
          color = '#ef4444'; // Red AoE bomb
          radius = 0.36;
        }

        return (
          <group
            key={proj.id}
            ref={(node: any) => {
              if (node) {
                if (!projectileRefs.current.has(proj.id)) {
                  node.position.set(proj.x, 0.65, proj.z);
                }
                projectileRefs.current.set(proj.id, node);
              } else {
                projectileRefs.current.delete(proj.id);
              }
            }}
          >
            <mesh castShadow>
              <sphereGeometry args={[radius, 16, 16]} />
              <meshStandardMaterial color={color} emissive={color} emissiveIntensity={1.1} />
            </mesh>
            {/* Outer aura glow */}
            <mesh>
              <sphereGeometry args={[radius * 1.45, 12, 12]} />
              <meshBasicMaterial color={color} transparent opacity={0.3} />
            </mesh>
          </group>
        );
      })}

      {/* Bishop Ice Hazard Puddles (1.5u radius glowing decal ring) */}
      {duel.iceHazards.map(hazard => (
        <group key={hazard.id} position={[hazard.x, 0.03, hazard.z]}>
          <mesh rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[hazard.radius, 32]} />
            <meshStandardMaterial
              color="#0284c7"
              emissive="#0369a1"
              transparent
              opacity={0.45}
            />
          </mesh>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
            <ringGeometry args={[hazard.radius - 0.08, hazard.radius, 32]} />
            <meshBasicMaterial color="#67e8f9" />
          </mesh>
        </group>
      ))}

      {/* King's Summoned Allies */}
      {duel.allies.map(ally => (
        <group
          key={ally.id}
          ref={(node: any) => {
            if (node) {
              if (!allyRefs.current.has(ally.id)) {
                node.position.set(ally.x, 0, ally.z);
                node.rotation.y = -ally.facingRad;
              }
              allyRefs.current.set(ally.id, node);
            } else {
              allyRefs.current.delete(ally.id);
            }
          }}
        >
          <PieceCharacter
            pieceClass={ally.pieceClass}
            color={ally.owner}
            scale={0.72}
            hp={ally.hp}
            maxHp={1}
          />
        </group>
      ))}
    </group>
  );
};
