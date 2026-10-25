import React, { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  CLASS_ABILITY_CONFIG,
  FIGHTER_MOVE_SPEED,
  FIGHTER_RADIUS,
  LEAN_DEADZONE,
  TABLE_HALF_EXTENT,
  clampToTabletop,
  puddleSpeedMultiplier,
  pushCircleOutOfStones,
  castleWallStones,
  type PlayerColor,
} from '@let-him-rook/shared';
import { PieceCharacter } from '../characters/PieceCharacter.tsx';
import { stepPredictedFacing } from './facingPrediction.ts';
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
  const predictedLocalRef = useRef<{
    x: number;
    z: number;
    facingRad: number;
    startedAt: number;
    initialized: boolean;
  }>({ x: 0, z: 0, facingRad: 0, startedAt: 0, initialized: false });

  useFrame((_, delta) => {
    const storeState = matchStore.getState();
    const liveInterp = storeState.interpolation || interpolation;
    const { targetDuel, prevDuel, prevReceivedAt, targetReceivedAt } = liveInterp;
    const now = performance.now();
    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
    const dt = Math.min(0.05, Math.max(0.001, delta));

    if (targetDuel) {
      const rawInterval = targetReceivedAt - prevReceivedAt;
      const interval = Math.min(120, Math.max(12, rawInterval || 16.7));
      const elapsedSinceTarget = Math.max(0, now - targetReceivedAt);
      const alpha = Math.min(1.0, elapsedSinceTarget / interval);
      const extrapSec = Math.min(0.06, elapsedSinceTarget / 1000);

      const activeLocalColor = localColor || 'w';
      const isLocalAttacker = targetDuel.attacker.color === activeLocalColor;
      const localFighter = isLocalAttacker ? targetDuel.attacker : targetDuel.defender;
      const prevLocalFighter = isLocalAttacker ? prevDuel?.attacker : prevDuel?.defender;
      const remoteFighter = isLocalAttacker ? targetDuel.defender : targetDuel.attacker;
      const prevRemoteFighter = isLocalAttacker ? prevDuel?.defender : prevDuel?.attacker;
      const remoteInterpX = lerp(prevRemoteFighter?.x ?? remoteFighter.x, remoteFighter.x, alpha);
      const remoteInterpZ = lerp(prevRemoteFighter?.z ?? remoteFighter.z, remoteFighter.z, alpha);

      // Local client-side prediction + exponential reconciliation
      const pred = predictedLocalRef.current;
      const snapDist = Math.hypot(pred.x - localFighter.x, pred.z - localFighter.z);
      const justTeleported =
        localFighter.teleportWindupRemainingMs > 0 &&
        (prevLocalFighter?.teleportWindupRemainingMs ?? 0) === 0;
      if (
        !pred.initialized ||
        pred.startedAt !== targetDuel.startedAt ||
        snapDist > 1.8 ||
        justTeleported
      ) {
        pred.x = localFighter.x;
        pred.z = localFighter.z;
        pred.facingRad = localFighter.facingRad;
        pred.startedAt = targetDuel.startedAt;
        pred.initialized = true;
      } else if (isDuelActive) {
        const intent = storeState.localMoveIntent;
        const intentFresh = now - intent.updatedAt < 300;
        const moveX = intentFresh ? intent.moveX : 0;
        const moveZ = intentFresh ? intent.moveZ : 0;
        const turnDir = intentFresh ? intent.turnDir : 0;

        pred.facingRad = stepPredictedFacing(pred.facingRad, localFighter.facingRad, turnDir, dt);

        const mag = Math.hypot(moveX, moveZ);
        const isMovingLocal = mag >= LEAN_DEADZONE;
        if (isMovingLocal) {
          const fwdX = Math.sin(pred.facingRad);
          const fwdZ = -Math.cos(pred.facingRad);
          const rightX = -fwdZ;
          const rightZ = fwdX;

          let speed =
            FIGHTER_MOVE_SPEED * (storeState.snapshot?.sandboxConfig?.moveSpeedMultiplier ?? 1.0);
          const inIceHazard = targetDuel.iceHazards.some(
            h => h.remainingMs > 0 && Math.hypot(pred.x - h.x, pred.z - h.z) <= h.radius
          );
          if (localFighter.isChilled || inIceHazard) {
            speed *= 1 - CLASS_ABILITY_CONFIG.bishop.iceBolt.chillSlowFactor;
          }

          speed *= puddleSpeedMultiplier(pred.x, pred.z);

          const vx = (rightX * moveX - fwdX * moveZ) * speed;
          const vz = (rightZ * moveX - fwdZ * moveZ) * speed;
          let nextX = pred.x + vx * dt;
          let nextZ = pred.z + vz * dt;

          for (const obs of targetDuel.obstacles) {
            if (obs.hitsRemaining <= 0) continue;
            if (obs.type === 'tower') {
              ({ x: nextX, z: nextZ } = pushCircleOutOfStones(nextX, nextZ, FIGHTER_RADIUS, castleWallStones(obs.x, obs.z)));
              continue;
            }
            const minDist = FIGHTER_RADIUS + obs.radius;
            const d = Math.hypot(nextX - obs.x, nextZ - obs.z);
            if (d < minDist && d > 0.0001) {
              const overlap = minDist - d;
              nextX += ((nextX - obs.x) / d) * overlap;
              nextZ += ((nextZ - obs.z) / d) * overlap;
            }
          }

          const minFighterDist = FIGHTER_RADIUS * 2;
          const oppDist = Math.hypot(nextX - remoteInterpX, nextZ - remoteInterpZ);
          if (oppDist < minFighterDist && oppDist > 0.0001) {
            const overlap = minFighterDist - oppDist;
            nextX += ((nextX - remoteInterpX) / oppDist) * overlap;
            nextZ += ((nextZ - remoteInterpZ) / oppDist) * overlap;
          }

          const clamped = clampToTabletop(nextX, nextZ, FIGHTER_RADIUS);
          pred.x = clamped.x;
          pred.z = clamped.z;
        }

        const reconcileRate = Math.min(1, dt * (isMovingLocal ? 10 : 16));
        pred.x = lerp(pred.x, localFighter.x, reconcileRate);
        pred.z = lerp(pred.z, localFighter.z, reconcileRate);
      }

      const localIntentActive =
        now - storeState.localMoveIntent.updatedAt < 300 &&
        Math.hypot(storeState.localMoveIntent.moveX, storeState.localMoveIntent.moveZ) >=
          LEAN_DEADZONE;

      // 1. Attacker position & rotation (predicted if local, interpolated if remote)
      if (attackerRef.current) {
        if (isLocalAttacker && isDuelActive) {
          const moving =
            localIntentActive ||
            Math.hypot(targetDuel.attacker.vx, targetDuel.attacker.vz) > 0.1;
          const bobY = moving ? Math.abs(Math.sin(now * 0.014)) * 0.08 : 0;
          attackerRef.current.position.set(pred.x, bobY, pred.z);
          attackerRef.current.rotation.y = -pred.facingRad;
        } else {
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
      }

      // 2. Defender position & rotation (predicted if local, interpolated if remote)
      if (defenderRef.current) {
        if (!isLocalAttacker && isDuelActive) {
          const moving =
            localIntentActive ||
            Math.hypot(targetDuel.defender.vx, targetDuel.defender.vz) > 0.1;
          const bobY = moving ? Math.abs(Math.sin(now * 0.014 + 1.5)) * 0.08 : 0;
          defenderRef.current.position.set(pred.x, bobY, pred.z);
          defenderRef.current.rotation.y = -pred.facingRad;
        } else {
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

      // 5. Over-the-back 3D Duel Aim Camera (uses predicted local coordinates for 0ms visual response)
      if (isDuelActive && camera) {
        const curFacingRad = pred.facingRad;
        const forwardX = Math.sin(curFacingRad);
        const forwardZ = -Math.cos(curFacingRad);

        const curFighterX = pred.x;
        const curFighterZ = pred.z;

        const camLimit = TABLE_HALF_EXTENT + 2.5;
        const targetCamX = Math.max(-camLimit, Math.min(camLimit, curFighterX - forwardX * 5.2));
        const targetCamY = 4.1;
        const targetCamZ = Math.max(-camLimit, Math.min(camLimit, curFighterZ - forwardZ * 5.2));

        const camSmooth = Math.min(1, dt * 8.5);
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
      ((v.event.type === 'melee_swing' && v.event.data.owner === attackerColor) ||
        (v.event.type === 'melee_hit' &&
          v.event.data.target === defenderColor &&
          !v.event.data.attackerId) ||
        (v.event.type === 'projectile_spawn' && v.event.data.owner === attackerColor) ||
        (v.event.type === 'summon_ally' && v.event.data.owner === attackerColor))
  );
  const isDefenderAttacking = visualEffects.some(
    v =>
      now - v.createdAt < 350 &&
      ((v.event.type === 'melee_swing' && v.event.data.owner === defenderColor) ||
        (v.event.type === 'melee_hit' &&
          v.event.data.target === attackerColor &&
          !v.event.data.attackerId) ||
        (v.event.type === 'projectile_spawn' && v.event.data.owner === defenderColor) ||
        (v.event.type === 'summon_ally' && v.event.data.owner === defenderColor))
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
          rookShotCounter={duel.attacker.rookShotCounter}
          hp={duel.attacker.hp}
          maxHp={duel.attacker.maxHp}
          isParrying={duel.attacker.isParrying}
          isChilled={duel.attacker.isChilled}
          isTeleporting={duel.attacker.teleportWindupRemainingMs > 0}
          isHit={isAttackerHit}
          isAttacking={isAttackerAttacking}
        />
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
          rookShotCounter={duel.defender.rookShotCounter}
          hp={duel.defender.hp}
          maxHp={duel.defender.maxHp}
          isParrying={duel.defender.isParrying}
          isChilled={duel.defender.isChilled}
          isTeleporting={duel.defender.teleportWindupRemainingMs > 0}
          isHit={isDefenderHit}
          isAttacking={isDefenderAttacking}
        />
      </group>

      {/* Projectiles (interpolated at 60fps via projectileRefs) */}
      {duel.projectiles.map(proj => {
        let color = '#f97316'; // Orange default
        let radius = proj.radius;
        if (proj.type === 'bishop_ice_bolt') {
          color = '#38bdf8'; // Frost cyan
        } else if (proj.type === 'queen_orb') {
          color = '#f97316'; // Fire
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

      {/* King's blue clones keep their owner's team ring. */}
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
          <mesh position={[0, 0.025, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0.3, 0.38, 16]} />
            <meshBasicMaterial color={ally.owner === 'w' ? '#fbbf24' : '#c084fc'} />
          </mesh>
          <PieceCharacter
            pieceClass={ally.pieceClass}
            color={ally.owner}
            isClone
            scale={0.72}
            hp={ally.hp}
            maxHp={1}
          />
        </group>
      ))}
    </group>
  );
};
