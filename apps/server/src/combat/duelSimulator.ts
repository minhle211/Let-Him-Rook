import {
  BOARD_SIZE_UNITS,
  CLASS_ABILITY_CONFIG,
  DUEL_DURATION_MS,
  FIGHTER_MAX_HP,
  FIGHTER_MOVE_SPEED,
  FIGHTER_TURN_SPEED,
  FIGHTER_RADIUS,
  FIXED_PROPS,
  LEAN_DEADZONE,
  OBSTACLE_MAX_HITS,
  OBSTACLE_MAX_HP,
  OBSTACLE_RADIUS,
  SERVER_TICK_MS,
  SPAWN_CLEAR_RADIUS,
  SPAWN_SEPARATION,
  TABLE_HALF_EXTENT,
  TRACKING_LOSS_STOP_MS,
  clampToTabletop,
  indexToSquare,
  squareToTableCoords,
  type AbilityType,
  type BoardSquare,
  type DuelEvent,
  type DuelSnapshot,
  type DuelWinner,
  type FighterState,
  type IceHazardState,
  type ObstacleState,
  type PendingCapture,
  type PieceClass,
  type PlayerColor,
  type ProjectileState,
  type SummonAllyState,
} from '@let-him-rook/shared';
import { Chess } from '../chess/chess.ts';

export interface DuelSimulation {
  startedAt: number;
  now: number;
  attacker: FighterState;
  defender: FighterState;
  projectiles: ProjectileState[];
  obstacles: ObstacleState[];
  iceHazards: IceHazardState[];
  allies: SummonAllyState[];
  events: DuelEvent[];
  lastMoveIntentAt: Record<PlayerColor, number>;
  winner: DuelWinner;
  resolutionReason?: string;
  isFinished: boolean;
  sandboxOptions?: {
    godMode?: boolean;
    noCooldowns?: boolean;
    moveSpeedMultiplier?: number;
  };
  initialState?: {
    fen: string;
    pending: PendingCapture;
  };
}

function generateId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

export function applyFighterDamage(
  fighter: FighterState,
  damage: number,
  godMode?: boolean
): number {
  if (godMode && fighter.color === 'w') {
    return fighter.hp;
  }
  fighter.hp = Math.max(0, fighter.hp - damage);
  return fighter.hp;
}

export function createDuel(
  fen: string,
  pending: PendingCapture,
  startedAt = Date.now()
): DuelSimulation {
  const fromCoord = squareToTableCoords(pending.from);
  const toCoord = squareToTableCoords(pending.to);

  let midX = (fromCoord.x + toCoord.x) / 2;
  let midZ = (fromCoord.z + toCoord.z) / 2;

  // Clamp mid within [-6.2, 6.2]
  midX = Math.max(-6.2, Math.min(6.2, midX));
  midZ = Math.max(-6.2, Math.min(6.2, midZ));

  let dx = toCoord.x - fromCoord.x;
  let dz = toCoord.z - fromCoord.z;
  let len = Math.hypot(dx, dz);
  if (len < 0.001) {
    dx = 1;
    dz = 0;
    len = 1;
  }
  const dirX = dx / len;
  const dirZ = dz / len;

  const halfSep = SPAWN_SEPARATION / 2;
  const attPos = clampToTabletop(
    midX - dirX * halfSep,
    midZ - dirZ * halfSep,
    FIGHTER_RADIUS
  );
  const defPos = clampToTabletop(
    midX + dirX * halfSep,
    midZ + dirZ * halfSep,
    FIGHTER_RADIUS
  );

  const defenderColor: PlayerColor = pending.attackerColor === 'w' ? 'b' : 'w';

  const attacker: FighterState = {
    color: pending.attackerColor,
    pieceClass: pending.attackerClass,
    hp: FIGHTER_MAX_HP,
    maxHp: FIGHTER_MAX_HP,
    x: attPos.x,
    z: attPos.z,
    facingRad: Math.atan2(defPos.x - attPos.x, -(defPos.z - attPos.z)),
    turnRate: 0,
    vx: 0,
    vz: 0,
    isParrying: false,
    parryHoldRemainingMs: CLASS_ABILITY_CONFIG.pawn.parry.maxHoldMs,
    isChilled: false,
    chillRemainingMs: 0,
    teleportWindupRemainingMs: 0,
    cooldowns: { primary: 0, secondary: 0 },
    rookShotCounter: 0,
  };

  const defender: FighterState = {
    color: defenderColor,
    pieceClass: pending.defenderClass,
    hp: FIGHTER_MAX_HP,
    maxHp: FIGHTER_MAX_HP,
    x: defPos.x,
    z: defPos.z,
    facingRad: Math.atan2(attPos.x - defPos.x, -(attPos.z - defPos.z)),
    turnRate: 0,
    vx: 0,
    vz: 0,
    isParrying: false,
    parryHoldRemainingMs: CLASS_ABILITY_CONFIG.pawn.parry.maxHoldMs,
    isChilled: false,
    chillRemainingMs: 0,
    teleportWindupRemainingMs: 0,
    cooldowns: { primary: 0, secondary: 0 },
    rookShotCounter: 0,
  };

  // Build obstacles from non-dueling board pieces outside SPAWN_CLEAR_RADIUS
  const obstacles: ObstacleState[] = [];
  const chess = new Chess(fen);
  const boardPieces: { square: BoardSquare; pieceClass: PieceClass; color: PlayerColor }[] = [];

  const epSquare =
    pending.attackerClass === 'pawn' && pending.from[0] !== pending.to[0]
      ? (`${pending.to[0]}${pending.from[1]}` as BoardSquare)
      : null;

  for (let idx = 0; idx < 64; idx++) {
    const sq = indexToSquare(idx);
    if (sq === pending.from || sq === pending.to || (epSquare && sq === epSquare)) continue;
    const p = chess.get(sq);
    if (p) {
      const pieceClass =
        p.type === 'p' ? 'pawn'
        : p.type === 'n' ? 'knight'
        : p.type === 'b' ? 'bishop'
        : p.type === 'r' ? 'rook'
        : p.type === 'q' ? 'queen'
        : 'king';
      boardPieces.push({
        square: sq,
        pieceClass,
        color: p.color as PlayerColor,
      });
    }
  }

  for (const bp of boardPieces) {
    const coords = squareToTableCoords(bp.square);
    const distFromMid = Math.hypot(coords.x - midX, coords.z - midZ);
    if (distFromMid > SPAWN_CLEAR_RADIUS) {
      obstacles.push({
        id: `piece_${bp.square}`,
        type: 'piece',
        square: bp.square,
        pieceClass: bp.pieceClass,
        pieceColor: bp.color,
        x: coords.x,
        z: coords.z,
        radius: OBSTACLE_RADIUS,
        hitsRemaining: OBSTACLE_MAX_HITS,
        maxHits: OBSTACLE_MAX_HITS,
        frozenRemainingMs: 0,
      });
    }
  }

  // Add 4 fixed tabletop props
  for (const prop of FIXED_PROPS) {
    obstacles.push({
      id: prop.id,
      type: prop.type,
      x: prop.x,
      z: prop.z,
      radius: OBSTACLE_RADIUS,
      hitsRemaining: OBSTACLE_MAX_HITS,
      maxHits: OBSTACLE_MAX_HITS,
      frozenRemainingMs: 0,
    });
  }

  return {
    startedAt,
    now: startedAt,
    attacker,
    defender,
    projectiles: [],
    obstacles,
    iceHazards: [],
    allies: [],
    events: [],
    lastMoveIntentAt: {
      w: startedAt,
      b: startedAt,
    },
    winner: null,
    isFinished: false,
    initialState: {
      fen,
      pending: { ...pending },
    },
  };
}

export function applyMovementIntent(
  duel: DuelSimulation,
  color: PlayerColor,
  moveX: number,
  moveZ: number,
  now: number,
  turnDir: number = 0
): void {
  if (duel.isFinished) return;
  duel.lastMoveIntentAt[color] = now;

  const fighter = color === duel.attacker.color ? duel.attacker : duel.defender;

  fighter.turnRate = Math.abs(turnDir) >= 0.1 ? Math.sign(turnDir) * FIGHTER_TURN_SPEED : 0;

  const mag = Math.hypot(moveX, moveZ);
  if (mag < LEAN_DEADZONE) {
    fighter.vx = 0;
    fighter.vz = 0;
    return;
  }

  // Aim-relative forward and right vectors
  const fwdX = Math.sin(fighter.facingRad);
  const fwdZ = -Math.cos(fighter.facingRad);
  const rightX = -fwdZ;
  const rightZ = fwdX;

  let speed = FIGHTER_MOVE_SPEED;
  const speedMult = duel.sandboxOptions?.moveSpeedMultiplier ?? 1.0;
  speed *= speedMult;
  if (fighter.isChilled) {
    speed *= 1 - CLASS_ABILITY_CONFIG.bishop.iceBolt.chillSlowFactor;
  }

  // moveZ < 0: advance forward; moveZ > 0: retreat
  // moveX > 0: strafe right; moveX < 0: strafe left
  fighter.vx = (rightX * moveX - fwdX * moveZ) * speed;
  fighter.vz = (rightZ * moveX - fwdZ * moveZ) * speed;
}

export function applyAbilityIntent(
  duel: DuelSimulation,
  color: PlayerColor,
  ability: AbilityType,
  parryHolding: boolean | undefined,
  now: number
): { accepted: boolean; reason?: string } {
  if (duel.isFinished) return { accepted: false, reason: 'duel_finished' };

  const fighter = color === duel.attacker.color ? duel.attacker : duel.defender;
  const opponent = color === duel.attacker.color ? duel.defender : duel.attacker;

  if (duel.sandboxOptions?.noCooldowns) {
    fighter.cooldowns.primary = 0;
    fighter.cooldowns.secondary = 0;
  }

  // Class ability check
  if (ability.startsWith('pawn_') && fighter.pieceClass !== 'pawn') {
    return { accepted: false, reason: 'wrong_class' };
  }
  if (ability.startsWith('rook_') && fighter.pieceClass !== 'rook') {
    return { accepted: false, reason: 'wrong_class' };
  }
  if (ability.startsWith('knight_') && fighter.pieceClass !== 'knight') {
    return { accepted: false, reason: 'wrong_class' };
  }
  if (ability.startsWith('bishop_') && fighter.pieceClass !== 'bishop') {
    return { accepted: false, reason: 'wrong_class' };
  }
  if (ability.startsWith('queen_') && fighter.pieceClass !== 'queen') {
    return { accepted: false, reason: 'wrong_class' };
  }
  if (ability.startsWith('king_') && fighter.pieceClass !== 'king') {
    return { accepted: false, reason: 'wrong_class' };
  }

  switch (ability) {
    case 'pawn_sweep': {
      if (now < fighter.cooldowns.primary) {
        return { accepted: false, reason: 'cooldown' };
      }
      fighter.cooldowns.primary = now + CLASS_ABILITY_CONFIG.pawn.sweep.cooldownMs;

      // Melee sweep hit calculation
      const dist = Math.hypot(opponent.x - fighter.x, opponent.z - fighter.z);
      if (dist <= CLASS_ABILITY_CONFIG.pawn.sweep.range) {
        const toOppX = (opponent.x - fighter.x) / dist;
        const toOppZ = (opponent.z - fighter.z) / dist;
        const facingX = Math.sin(fighter.facingRad);
        const facingZ = -Math.cos(fighter.facingRad);
        const dot = toOppX * facingX + toOppZ * facingZ;
        const minDot = Math.cos(((CLASS_ABILITY_CONFIG.pawn.sweep.arcDeg / 2) * Math.PI) / 180);

        if (dot >= minDot) {
          if (opponent.isParrying) {
            duel.events.push({
              type: 'parry_blocked',
              timestamp: now,
              data: { defender: opponent.color, attacker: fighter.color, damage: 0 },
            });
          } else {
            opponent.hp = applyFighterDamage(
              opponent,
              CLASS_ABILITY_CONFIG.pawn.sweep.damage,
              duel.sandboxOptions?.godMode
            );
            duel.events.push({
              type: 'melee_hit',
              timestamp: now,
              data: {
                target: opponent.color,
                damage: CLASS_ABILITY_CONFIG.pawn.sweep.damage,
                remainingHp: opponent.hp,
              },
            });
          }
        }
      }

      // Damage enemy summoned allies in sweep range
      for (const ally of duel.allies) {
        if (ally.owner === fighter.color) continue;
        const dist = Math.hypot(ally.x - fighter.x, ally.z - fighter.z);
        if (dist <= CLASS_ABILITY_CONFIG.pawn.sweep.range) {
          ally.hp = Math.max(0, ally.hp - CLASS_ABILITY_CONFIG.pawn.sweep.damage);
        }
      }
      duel.allies = duel.allies.filter((a) => a.hp > 0);

      return { accepted: true };
    }

    case 'pawn_parry': {
      if (parryHolding) {
        if (now < fighter.cooldowns.secondary) {
          return { accepted: false, reason: 'cooldown' };
        }
        if (fighter.parryHoldRemainingMs > 0) {
          fighter.isParrying = true;
          return { accepted: true };
        }
        return { accepted: false, reason: 'parry_exhausted' };
      } else {
        // Release parry
        fighter.isParrying = false;
        fighter.cooldowns.secondary = now + CLASS_ABILITY_CONFIG.pawn.parry.cooldownMs;
        fighter.parryHoldRemainingMs = CLASS_ABILITY_CONFIG.pawn.parry.maxHoldMs;
        return { accepted: true };
      }
    }

    case 'rook_shot': {
      if (now < fighter.cooldowns.primary) {
        return { accepted: false, reason: 'cooldown' };
      }
      fighter.rookShotCounter++;
      fighter.cooldowns.primary = now + CLASS_ABILITY_CONFIG.rook.shot.cooldownMs;

      const isBomb = fighter.rookShotCounter % CLASS_ABILITY_CONFIG.rook.cannonBomb.intervalShots === 0;
      const speed = isBomb
        ? CLASS_ABILITY_CONFIG.rook.cannonBomb.speed
        : CLASS_ABILITY_CONFIG.rook.shot.speed;
      const damage = isBomb
        ? CLASS_ABILITY_CONFIG.rook.cannonBomb.damage
        : CLASS_ABILITY_CONFIG.rook.shot.damage;
      const radius = isBomb
        ? CLASS_ABILITY_CONFIG.rook.cannonBomb.radius
        : CLASS_ABILITY_CONFIG.rook.shot.radius;

      // Projectile directed along fighter facingRad aim
      const vx = Math.sin(fighter.facingRad) * speed;
      const vz = -Math.cos(fighter.facingRad) * speed;

      duel.projectiles.push({
        id: generateId('proj_rook'),
        type: isBomb ? 'rook_cannon_bomb' : 'rook_shot',
        owner: fighter.color,
        x: fighter.x,
        z: fighter.z,
        vx,
        vz,
        radius,
        damage,
        splashRadius: isBomb ? CLASS_ABILITY_CONFIG.rook.cannonBomb.splashRadius : undefined,
      });

      duel.events.push({
        type: 'projectile_spawn',
        timestamp: now,
        data: { owner: fighter.color, projectileType: isBomb ? 'rook_cannon_bomb' : 'rook_shot' },
      });
      return { accepted: true };
    }

    case 'knight_cleave': {
      if (now < fighter.cooldowns.primary) {
        return { accepted: false, reason: 'cooldown' };
      }

      const cfg = CLASS_ABILITY_CONFIG.knight.cleave;
      const fwdX = Math.sin(fighter.facingRad);
      const fwdZ = -Math.cos(fighter.facingRad);

      // 1. Check if opponent is within the 120° front camera cone and within maxTeleportDist
      const toOppX = opponent.x - fighter.x;
      const toOppZ = opponent.z - fighter.z;
      const distToOpp = Math.hypot(toOppX, toOppZ);
      const targetConeMinDot = Math.cos(((cfg.targetConeDeg / 2) * Math.PI) / 180);
      const oppDot =
        distToOpp > 0.0001
          ? (toOppX / distToOpp) * fwdX + (toOppZ / distToOpp) * fwdZ
          : 1;
      const oppInFrontCone = oppDot >= targetConeMinDot - 1e-6;

      const oppOffset = Math.min(distToOpp, cfg.targetOffsetDist); // 1.5u in front of opponent
      const oppDestX =
        distToOpp > 0.0001 ? opponent.x - (toOppX / distToOpp) * oppOffset : fighter.x;
      const oppDestZ =
        distToOpp > 0.0001 ? opponent.z - (toOppZ / distToOpp) * oppOffset : fighter.z;
      const oppTeleportDist = Math.hypot(oppDestX - fighter.x, oppDestZ - fighter.z);
      const oppInRange = oppInFrontCone && oppTeleportDist <= cfg.maxTeleportDist;

      let destX: number;
      let destZ: number;
      let pathEndX: number;
      let pathEndZ: number;
      let lookTarget: { x: number; z: number } | null;

      if (oppInRange) {
        destX = oppDestX;
        destZ = oppDestZ;
        pathEndX = opponent.x;
        pathEndZ = opponent.z;
        lookTarget = { x: opponent.x, z: opponent.z };
      } else {
        // Opponent out of range or outside 120° front cone: teleport 3.0u forward in camera direction
        destX = fighter.x + fwdX * cfg.forwardTeleportDist;
        destZ = fighter.z + fwdZ * cfg.forwardTeleportDist;
        pathEndX = destX;
        pathEndZ = destZ;
        lookTarget = null;
      }

      // 2. Check for blocking obstacles within the 40° front camera cone intersecting the straight-line path
      const pathDx = pathEndX - fighter.x;
      const pathDz = pathEndZ - fighter.z;
      const pathLen = Math.hypot(pathDx, pathDz);
      const obsConeMinDot = Math.cos(((cfg.obstacleConeDeg / 2) * Math.PI) / 180);

      let closestBlockingObs: ObstacleState | null = null;
      let closestBlockingDist = Infinity;

      if (pathLen > 0.0001) {
        const ux = pathDx / pathLen;
        const uz = pathDz / pathLen;

        for (const obs of duel.obstacles) {
          if (obs.hitsRemaining <= 0) continue;
          const toObsX = obs.x - fighter.x;
          const toObsZ = obs.z - fighter.z;
          const obsDist = Math.hypot(toObsX, toObsZ);
          if (obsDist < 0.0001) continue;

          const obsDot = (toObsX / obsDist) * fwdX + (toObsZ / obsDist) * fwdZ;
          if (obsDot < obsConeMinDot - 1e-6) continue;

          const proj = toObsX * ux + toObsZ * uz;
          if (proj <= 0 || proj > pathLen + obs.radius) continue;

          const clampedProj = Math.max(0, Math.min(pathLen, proj));
          const closestX = fighter.x + ux * clampedProj;
          const closestZ = fighter.z + uz * clampedProj;
          const perpDist = Math.hypot(obs.x - closestX, obs.z - closestZ);

          if (perpDist < FIGHTER_RADIUS + obs.radius && obsDist < closestBlockingDist) {
            closestBlockingDist = obsDist;
            closestBlockingObs = obs;
          }
        }
      }

      if (closestBlockingObs) {
        const toObsX = closestBlockingObs.x - fighter.x;
        const toObsZ = closestBlockingObs.z - fighter.z;
        const obsDist = Math.hypot(toObsX, toObsZ) || 1;
        const obsOffset = Math.min(obsDist, cfg.targetOffsetDist);
        destX = closestBlockingObs.x - (toObsX / obsDist) * obsOffset;
        destZ = closestBlockingObs.z - (toObsZ / obsDist) * obsOffset;
        lookTarget = { x: closestBlockingObs.x, z: closestBlockingObs.z };
      }

      // 3. Clamp to tabletop [-7, 7] and resolve any overlap with obstacles or opponent
      let finalPos = clampToTabletop(destX, destZ, FIGHTER_RADIUS);
      for (const obs of duel.obstacles) {
        if (obs.hitsRemaining <= 0) continue;
        const minDist = FIGHTER_RADIUS + obs.radius;
        const d = Math.hypot(finalPos.x - obs.x, finalPos.z - obs.z);
        if (d < minDist) {
          if (d > 0.0001) {
            const overlap = minDist - d;
            finalPos.x += ((finalPos.x - obs.x) / d) * overlap;
            finalPos.z += ((finalPos.z - obs.z) / d) * overlap;
          } else {
            finalPos.x -= fwdX * minDist;
            finalPos.z -= fwdZ * minDist;
          }
        }
      }

      const minFighterDist = FIGHTER_RADIUS * 2;
      const oppD = Math.hypot(finalPos.x - opponent.x, finalPos.z - opponent.z);
      if (oppD < minFighterDist) {
        if (oppD > 0.0001) {
          const overlap = minFighterDist - oppD;
          finalPos.x += ((finalPos.x - opponent.x) / oppD) * overlap;
          finalPos.z += ((finalPos.z - opponent.z) / oppD) * overlap;
        } else {
          finalPos.x -= fwdX * minFighterDist;
          finalPos.z -= fwdZ * minFighterDist;
        }
      }

      finalPos = clampToTabletop(finalPos.x, finalPos.z, FIGHTER_RADIUS);

      // 4. Teleport, face target/obstacle if locked on, and start windup
      fighter.x = finalPos.x;
      fighter.z = finalPos.z;
      if (lookTarget) {
        const lx = lookTarget.x - fighter.x;
        const lz = lookTarget.z - fighter.z;
        if (Math.hypot(lx, lz) > 0.0001) {
          fighter.facingRad = Math.atan2(lx, -lz);
        }
      }
      fighter.teleportWindupRemainingMs = cfg.windupMs;
      fighter.cooldowns.primary = now + cfg.cooldownMs;

      duel.events.push({
        type: 'teleport',
        timestamp: now,
        data: { color: fighter.color, x: fighter.x, z: fighter.z },
      });

      return { accepted: true };
    }

    case 'bishop_ice_bolt': {
      if (now < fighter.cooldowns.primary) {
        return { accepted: false, reason: 'cooldown' };
      }
      fighter.cooldowns.primary = now + CLASS_ABILITY_CONFIG.bishop.iceBolt.cooldownMs;

      const speed = CLASS_ABILITY_CONFIG.bishop.iceBolt.speed;
      const vx = Math.sin(fighter.facingRad) * speed;
      const vz = -Math.cos(fighter.facingRad) * speed;

      duel.projectiles.push({
        id: generateId('proj_bishop'),
        type: 'bishop_ice_bolt',
        owner: fighter.color,
        x: fighter.x,
        z: fighter.z,
        vx,
        vz,
        radius: CLASS_ABILITY_CONFIG.bishop.iceBolt.radius,
        damage: CLASS_ABILITY_CONFIG.bishop.iceBolt.damage,
      });

      duel.events.push({
        type: 'projectile_spawn',
        timestamp: now,
        data: { owner: fighter.color, projectileType: 'bishop_ice_bolt' },
      });
      return { accepted: true };
    }

    case 'queen_volley': {
      if (now < fighter.cooldowns.primary) {
        return { accepted: false, reason: 'cooldown' };
      }
      fighter.cooldowns.primary = now + CLASS_ABILITY_CONFIG.queen.volley.cooldownMs;

      const baseAngle = fighter.facingRad;
      const speed = CLASS_ABILITY_CONFIG.queen.volley.speed;

      for (const offsetDeg of CLASS_ABILITY_CONFIG.queen.volley.fanAnglesDeg) {
        const rad = baseAngle + (offsetDeg * Math.PI) / 180;
        const vx = Math.sin(rad) * speed;
        const vz = -Math.cos(rad) * speed;

        duel.projectiles.push({
          id: generateId('proj_queen'),
          type: 'queen_orb',
          owner: fighter.color,
          x: fighter.x,
          z: fighter.z,
          vx,
          vz,
          radius: CLASS_ABILITY_CONFIG.queen.volley.radius,
          damage: CLASS_ABILITY_CONFIG.queen.volley.damagePerOrb,
          homingTargetColor: opponent.color,
        });
      }

      duel.events.push({
        type: 'projectile_spawn',
        timestamp: now,
        data: { owner: fighter.color, projectileType: 'queen_volley' },
      });
      return { accepted: true };
    }

    case 'king_summon': {
      if (now < fighter.cooldowns.primary) {
        return { accepted: false, reason: 'cooldown' };
      }
      if (duel.allies.some(a => a.owner === fighter.color)) {
        return { accepted: false, reason: 'max_allies_active' };
      }

      fighter.cooldowns.primary = now + CLASS_ABILITY_CONFIG.king.summon.cooldownMs;

      const classes: PieceClass[] = ['pawn', 'rook', 'knight', 'bishop', 'queen'];
      const randomClass = classes[Math.floor(Math.random() * classes.length)];

      // Spawn ally slightly to the side of King
      const sideAngle = fighter.facingRad + Math.PI / 2;
      const spawnX = fighter.x + Math.sin(sideAngle) * 1.5;
      const spawnZ = fighter.z - Math.cos(sideAngle) * 1.5;
      const clamped = clampToTabletop(spawnX, spawnZ, FIGHTER_RADIUS);

      const ally: SummonAllyState = {
        id: generateId('ally'),
        owner: fighter.color,
        pieceClass: randomClass,
        hp: CLASS_ABILITY_CONFIG.king.summon.allyHp,
        x: clamped.x,
        z: clamped.z,
        facingRad: fighter.facingRad,
        remainingMs: CLASS_ABILITY_CONFIG.king.summon.durationMs,
        nextAttackMs: now + 1000,
      };

      duel.allies.push(ally);
      duel.events.push({
        type: 'summon_ally',
        timestamp: now,
        data: { owner: fighter.color, pieceClass: randomClass, allyId: ally.id },
      });
      return { accepted: true };
    }

    default:
      return { accepted: false, reason: 'unknown_ability' };
  }
}

export function stepDuel(duel: DuelSimulation, now: number): void {
  if (duel.isFinished) return;
  const dtMs = Math.max(1, now - duel.now);
  const dtSec = dtMs / 1000;
  duel.now = now;

  const fighters = [duel.attacker, duel.defender];

  if (duel.sandboxOptions?.noCooldowns) {
    duel.attacker.cooldowns.primary = 0;
    duel.attacker.cooldowns.secondary = 0;
    duel.defender.cooldowns.primary = 0;
    duel.defender.cooldowns.secondary = 0;
  }

  // 1. Process tracking loss, parry hold, chill DoT, teleport windup, auto-facing
  for (const fighter of fighters) {
    const opponent = fighter === duel.attacker ? duel.defender : duel.attacker;

    // Tracking loss check (zero velocity and rotation if no input for > 300ms)
    if (now - duel.lastMoveIntentAt[fighter.color] > TRACKING_LOSS_STOP_MS) {
      fighter.vx = 0;
      fighter.vz = 0;
      fighter.turnRate = 0;
    }

    // Manual rotation integration
    if (fighter.turnRate) {
      fighter.facingRad += fighter.turnRate * dtSec;
      while (fighter.facingRad > Math.PI) fighter.facingRad -= Math.PI * 2;
      while (fighter.facingRad < -Math.PI) fighter.facingRad += Math.PI * 2;
    }

    // Parry hold decay
    if (fighter.isParrying) {
      fighter.parryHoldRemainingMs -= dtMs;
      if (fighter.parryHoldRemainingMs <= 0) {
        fighter.isParrying = false;
        fighter.cooldowns.secondary = now + CLASS_ABILITY_CONFIG.pawn.parry.cooldownMs;
        fighter.parryHoldRemainingMs = CLASS_ABILITY_CONFIG.pawn.parry.maxHoldMs;
      }
    }

    // Chill decay and DoT
    if (fighter.isChilled) {
      fighter.chillRemainingMs -= dtMs;
      fighter.hp = applyFighterDamage(
        fighter,
        CLASS_ABILITY_CONFIG.bishop.iceBolt.chillDotDps * dtSec,
        duel.sandboxOptions?.godMode
      );
      if (fighter.chillRemainingMs <= 0) {
        fighter.isChilled = false;
      }
    }

    // Knight teleport windup completion
    if (fighter.teleportWindupRemainingMs > 0) {
      fighter.teleportWindupRemainingMs = Math.max(
        0,
        fighter.teleportWindupRemainingMs - dtMs
      );
      if (fighter.teleportWindupRemainingMs === 0) {
        const cleaveCfg = CLASS_ABILITY_CONFIG.knight.cleave;
        const facingX = Math.sin(fighter.facingRad);
        const facingZ = -Math.cos(fighter.facingRad);
        const minSlashDot = Math.cos(((cleaveCfg.slashArcDeg / 2) * Math.PI) / 180);

        const isInCleaveArc = (tx: number, tz: number): boolean => {
          const dx = tx - fighter.x;
          const dz = tz - fighter.z;
          const dist = Math.hypot(dx, dz);
          if (dist > cleaveCfg.slashArcRadius) return false;
          if (dist < 0.0001) return true;
          const dot = (dx / dist) * facingX + (dz / dist) * facingZ;
          return dot >= minSlashDot - 1e-6;
        };

        // Execute windup cleave damage on opponent
        if (isInCleaveArc(opponent.x, opponent.z)) {
          if (opponent.isParrying) {
            duel.events.push({
              type: 'parry_blocked',
              timestamp: now,
              data: { defender: opponent.color, attacker: fighter.color, damage: 0 },
            });
          } else {
            opponent.hp = applyFighterDamage(
              opponent,
              cleaveCfg.damage,
              duel.sandboxOptions?.godMode
            );
            duel.events.push({
              type: 'melee_hit',
              timestamp: now,
              data: {
                target: opponent.color,
                damage: cleaveCfg.damage,
                remainingHp: opponent.hp,
              },
            });
          }
        }

        // Damage enemy summoned allies in slash range
        for (const ally of duel.allies) {
          if (ally.owner === fighter.color) continue;
          if (isInCleaveArc(ally.x, ally.z)) {
            ally.hp = Math.max(0, ally.hp - cleaveCfg.damage);
          }
        }
        duel.allies = duel.allies.filter((a) => a.hp > 0);

        // Damage active obstacles in slash range (1 hit per cleave)
        for (const obs of duel.obstacles) {
          if (obs.hitsRemaining <= 0) continue;
          if (isInCleaveArc(obs.x, obs.z)) {
            obs.hitsRemaining = Math.max(0, obs.hitsRemaining - 1);
            duel.events.push({
              type: 'obstacle_damage',
              timestamp: now,
              data: { obstacleId: obs.id, hitsRemaining: obs.hitsRemaining },
            });
            if (obs.hitsRemaining <= 0) {
              duel.events.push({
                type: 'obstacle_broken',
                timestamp: now,
                data: { obstacleId: obs.id },
              });
            }
          }
        }
      }
    }
  }

  // 2. Fighter movement & circle-circle obstacle sliding collision
  for (const fighter of fighters) {
    if (fighter.vx === 0 && fighter.vz === 0) continue;

    let nextX = fighter.x + fighter.vx * dtSec;
    let nextZ = fighter.z + fighter.vz * dtSec;

    // Obstacle collisions
    for (const obs of duel.obstacles) {
      if (obs.hitsRemaining <= 0) continue;
      const minDist = FIGHTER_RADIUS + obs.radius;
      const d = Math.hypot(nextX - obs.x, nextZ - obs.z);
      if (d < minDist && d > 0.0001) {
        const overlap = minDist - d;
        const normX = (nextX - obs.x) / d;
        const normZ = (nextZ - obs.z) / d;
        nextX += normX * overlap;
        nextZ += normZ * overlap;
      }
    }

    // Opponent fighter collision
    const opponent = fighter === duel.attacker ? duel.defender : duel.attacker;
    const minFighterDist = FIGHTER_RADIUS * 2;
    const oppDist = Math.hypot(nextX - opponent.x, nextZ - opponent.z);
    if (oppDist < minFighterDist && oppDist > 0.0001) {
      const overlap = minFighterDist - oppDist;
      const normX = (nextX - opponent.x) / oppDist;
      const normZ = (nextZ - opponent.z) / oppDist;
      nextX += normX * overlap;
      nextZ += normZ * overlap;
    }

    // Clamp strictly inside tabletop perimeter
    const clamped = clampToTabletop(nextX, nextZ, FIGHTER_RADIUS);
    fighter.x = clamped.x;
    fighter.z = clamped.z;
  }

  // 3. Ice hazards decay and DoT/slow
  for (let i = duel.iceHazards.length - 1; i >= 0; i--) {
    const hazard = duel.iceHazards[i];
    hazard.remainingMs -= dtMs;
    if (hazard.remainingMs <= 0) {
      duel.iceHazards.splice(i, 1);
      continue;
    }

    for (const fighter of fighters) {
      const dist = Math.hypot(fighter.x - hazard.x, fighter.z - hazard.z);
      if (dist <= hazard.radius) {
        fighter.isChilled = true;
        fighter.chillRemainingMs = Math.max(fighter.chillRemainingMs, 1000);
        fighter.hp = applyFighterDamage(
          fighter,
          CLASS_ABILITY_CONFIG.bishop.iceBolt.hazardDotDps * dtSec,
          duel.sandboxOptions?.godMode
        );
      }
    }
  }

  // 4. Obstacle freeze decay
  for (const obs of duel.obstacles) {
    if (obs.frozenRemainingMs > 0) {
      obs.frozenRemainingMs = Math.max(0, obs.frozenRemainingMs - dtMs);
    }
  }

  // 5. King Allies AI step
  for (let i = duel.allies.length - 1; i >= 0; i--) {
    const ally = duel.allies[i];
    ally.remainingMs -= dtMs;
    if (ally.remainingMs <= 0 || ally.hp <= 0) {
      duel.allies.splice(i, 1);
      continue;
    }

    const enemy = ally.owner === duel.attacker.color ? duel.defender : duel.attacker;
    const dx = enemy.x - ally.x;
    const dz = enemy.z - ally.z;
    const dist = Math.hypot(dx, dz) || 1;
    ally.facingRad = Math.atan2(dx, -dz);

    // Approach enemy up to 2.0u
    if (dist > 2.0) {
      const speed = CLASS_ABILITY_CONFIG.king.summon.speed;
      const moveDist = speed * dtSec;
      ally.x += (dx / dist) * moveDist;
      ally.z += (dz / dist) * moveDist;
      const clamped = clampToTabletop(ally.x, ally.z, FIGHTER_RADIUS);
      ally.x = clamped.x;
      ally.z = clamped.z;
    }

    // Ally attacks every 2.0s for 50% base damage
    if (now >= ally.nextAttackMs) {
      ally.nextAttackMs = now + CLASS_ABILITY_CONFIG.king.summon.attackIntervalMs;
      const baseDmg =
        ally.pieceClass === 'pawn' ? CLASS_ABILITY_CONFIG.pawn.sweep.damage
        : ally.pieceClass === 'rook' ? CLASS_ABILITY_CONFIG.rook.shot.damage
        : ally.pieceClass === 'knight' ? CLASS_ABILITY_CONFIG.knight.cleave.damage
        : ally.pieceClass === 'bishop' ? CLASS_ABILITY_CONFIG.bishop.iceBolt.damage
        : CLASS_ABILITY_CONFIG.queen.volley.damagePerOrb * 3;
      const allyDamage = baseDmg * CLASS_ABILITY_CONFIG.king.summon.baseDamageMultiplier;

      if (!enemy.isParrying) {
        enemy.hp = applyFighterDamage(
          enemy,
          allyDamage,
          duel.sandboxOptions?.godMode
        );
        duel.events.push({
          type: 'melee_hit',
          timestamp: now,
          data: {
            target: enemy.color,
            damage: allyDamage,
            remainingHp: enemy.hp,
            attackerId: ally.id,
          },
        });
      } else {
        duel.events.push({
          type: 'parry_blocked',
          timestamp: now,
          data: { defender: enemy.color, attacker: ally.owner, damage: 0 },
        });
      }
    }
  }

  // 6. Projectiles step & collisions
  for (let i = duel.projectiles.length - 1; i >= 0; i--) {
    const proj = duel.projectiles[i];

    // Homing for Queen Orbs
    if (proj.homingTargetColor) {
      const target = proj.homingTargetColor === duel.attacker.color ? duel.attacker : duel.defender;
      const targetDx = target.x - proj.x;
      const targetDz = target.z - proj.z;
      const desiredAngle = Math.atan2(targetDx, -targetDz);
      const currentAngle = Math.atan2(proj.vx, -proj.vz);

      let delta = desiredAngle - currentAngle;
      while (delta > Math.PI) delta -= 2 * Math.PI;
      while (delta < -Math.PI) delta += 2 * Math.PI;

      const maxTurn = CLASS_ABILITY_CONFIG.queen.volley.homingTurnRate * dtSec;
      const turn = Math.max(-maxTurn, Math.min(maxTurn, delta));
      const newAngle = currentAngle + turn;
      const speed = CLASS_ABILITY_CONFIG.queen.volley.speed;
      proj.vx = Math.sin(newAngle) * speed;
      proj.vz = -Math.cos(newAngle) * speed;
    }

    proj.x += proj.vx * dtSec;
    proj.z += proj.vz * dtSec;

    // Boundary check
    if (
      proj.x < -TABLE_HALF_EXTENT - 0.5 ||
      proj.x > TABLE_HALF_EXTENT + 0.5 ||
      proj.z < -TABLE_HALF_EXTENT - 0.5 ||
      proj.z > TABLE_HALF_EXTENT + 0.5
    ) {
      duel.projectiles.splice(i, 1);
      continue;
    }

    let consumed = false;

    // Check collision against active obstacles
    for (const obs of duel.obstacles) {
      if (obs.hitsRemaining <= 0) continue;
      const d = Math.hypot(proj.x - obs.x, proj.z - obs.z);
      if (d <= proj.radius + obs.radius) {
        // Obstacle hit
        obs.hitsRemaining = Math.max(0, obs.hitsRemaining - 1);
        duel.events.push({
          type: 'obstacle_damage',
          timestamp: now,
          data: { obstacleId: obs.id, hitsRemaining: obs.hitsRemaining },
        });

        if (obs.hitsRemaining <= 0) {
          duel.events.push({
            type: 'obstacle_broken',
            timestamp: now,
            data: { obstacleId: obs.id },
          });
        }

        // Bishop Ice Bolt freeze & hazard
        if (proj.type === 'bishop_ice_bolt') {
          obs.frozenRemainingMs = CLASS_ABILITY_CONFIG.bishop.iceBolt.obstacleFreezeMs;
          duel.iceHazards.push({
            id: generateId('ice_hazard'),
            x: obs.x,
            z: obs.z,
            radius: CLASS_ABILITY_CONFIG.bishop.iceBolt.hazardRadius,
            remainingMs: CLASS_ABILITY_CONFIG.bishop.iceBolt.hazardDurationMs,
          });
          duel.events.push({
            type: 'ice_hazard_spawn',
            timestamp: now,
            data: { x: obs.x, z: obs.z },
          });
        }

        // Rook Cannon Bomb AoE splash
        if (proj.splashRadius) {
          for (const fighter of fighters) {
            const splashDist = Math.hypot(fighter.x - proj.x, fighter.z - proj.z);
            if (splashDist <= proj.splashRadius) {
              if (!fighter.isParrying) {
                fighter.hp = applyFighterDamage(
                  fighter,
                  proj.damage,
                  duel.sandboxOptions?.godMode
                );
              }
            }
          }
          for (const ally of duel.allies) {
            const splashDist = Math.hypot(ally.x - proj.x, ally.z - proj.z);
            if (splashDist <= proj.splashRadius) {
              ally.hp = Math.max(0, ally.hp - proj.damage);
            }
          }
          duel.allies = duel.allies.filter((a) => a.hp > 0);
        }

        consumed = true;
        break;
      }
    }

    if (consumed) {
      duel.projectiles.splice(i, 1);
      continue;
    }

    // Check collision against enemy summoned allies
    for (const ally of duel.allies) {
      if (ally.owner === proj.owner) continue;
      const dist = Math.hypot(proj.x - ally.x, proj.z - ally.z);
      if (dist <= proj.radius + FIGHTER_RADIUS) {
        ally.hp = Math.max(0, ally.hp - proj.damage);
        consumed = true;
        duel.events.push({
          type: 'projectile_hit',
          timestamp: now,
          data: {
            target: ally.owner,
            damage: proj.damage,
            remainingHp: ally.hp,
            projectileType: proj.type,
            targetAllyId: ally.id,
          },
        });
        break;
      }
    }

    if (consumed) {
      duel.allies = duel.allies.filter((a) => a.hp > 0);
      duel.projectiles.splice(i, 1);
      continue;
    }

    // Check collision against opponent fighter
    const target = proj.owner === duel.attacker.color ? duel.defender : duel.attacker;
    const targetDist = Math.hypot(proj.x - target.x, proj.z - target.z);
    if (targetDist <= proj.radius + FIGHTER_RADIUS) {
      if (target.isParrying) {
        duel.events.push({
          type: 'parry_blocked',
          timestamp: now,
          data: { defender: target.color, attacker: proj.owner, damage: 0 },
        });
      } else {
        target.hp = applyFighterDamage(
          target,
          proj.damage,
          duel.sandboxOptions?.godMode
        );

        if (proj.type === 'bishop_ice_bolt') {
          target.isChilled = true;
          target.chillRemainingMs = CLASS_ABILITY_CONFIG.bishop.iceBolt.chillDurationMs;
        }

        duel.events.push({
          type: 'projectile_hit',
          timestamp: now,
          data: {
            target: target.color,
            damage: proj.damage,
            remainingHp: target.hp,
            projectileType: proj.type,
          },
        });
      }

      // Splash damage if cannon bomb
      if (proj.splashRadius) {
        const allyOrOther = proj.owner === duel.attacker.color ? duel.attacker : duel.defender;
        const distToOther = Math.hypot(allyOrOther.x - proj.x, allyOrOther.z - proj.z);
        if (distToOther <= proj.splashRadius && !allyOrOther.isParrying) {
          allyOrOther.hp = Math.max(0, allyOrOther.hp - proj.damage);
        }
        for (const ally of duel.allies) {
          const distToAlly = Math.hypot(ally.x - proj.x, ally.z - proj.z);
          if (distToAlly <= proj.splashRadius) {
            ally.hp = Math.max(0, ally.hp - proj.damage);
          }
        }
        duel.allies = duel.allies.filter((a) => a.hp > 0);
      }

      duel.projectiles.splice(i, 1);
    }
  }

  duel.allies = duel.allies.filter((a) => a.hp > 0);

  // 7. Check duel termination (0 HP or 90s timer)
  if (duel.attacker.hp <= 0 && duel.defender.hp <= 0) {
    duel.winner = 'draw';
    duel.resolutionReason = 'mutual_knockout';
    duel.isFinished = true;
  } else if (duel.attacker.hp <= 0) {
    duel.winner = duel.defender.color;
    duel.resolutionReason = 'knockout';
    duel.isFinished = true;
  } else if (duel.defender.hp <= 0) {
    duel.winner = duel.attacker.color;
    duel.resolutionReason = 'knockout';
    duel.isFinished = true;
  } else if (now - duel.startedAt >= DUEL_DURATION_MS) {
    // 90-second timeout
    if (duel.attacker.hp > duel.defender.hp) {
      duel.winner = duel.attacker.color;
      duel.resolutionReason = 'timeout_higher_hp';
    } else if (duel.defender.hp > duel.attacker.hp) {
      duel.winner = duel.defender.color;
      duel.resolutionReason = 'timeout_higher_hp';
    } else {
      duel.winner = 'draw';
      duel.resolutionReason = 'duel_timeout_tie';
    }
    duel.isFinished = true;
  }

  if (duel.isFinished) {
    duel.events.push({
      type: 'duel_end',
      timestamp: now,
      data: { winner: duel.winner, reason: duel.resolutionReason },
    });
  }
}

export function getDuelSnapshot(duel: DuelSimulation): DuelSnapshot {
  const elapsedMs = Math.max(0, duel.now - duel.startedAt);
  const remainingMs = Math.max(0, DUEL_DURATION_MS - elapsedMs);

  return {
    startedAt: duel.startedAt,
    elapsedMs,
    remainingMs,
    attacker: { ...duel.attacker },
    defender: { ...duel.defender },
    projectiles: duel.projectiles.map(p => ({ ...p })),
    obstacles: duel.obstacles.map(o => ({ ...o })),
    iceHazards: duel.iceHazards.map(h => ({ ...h })),
    allies: duel.allies.map(a => ({ ...a })),
    winner: duel.winner,
    resolutionReason: duel.resolutionReason,
  };
}

export function resetDuelSimulation(duel: DuelSimulation, now = Date.now()): void {
  const fen = duel.initialState?.fen ?? '';
  const pending = duel.initialState?.pending ?? {
    from: 'e2' as BoardSquare,
    to: 'e7' as BoardSquare,
    attackerColor: duel.attacker.color,
    attackerClass: duel.attacker.pieceClass,
    defenderClass: duel.defender.pieceClass,
  };
  const fresh = createDuel(fen, pending, now);
  duel.startedAt = now;
  duel.now = now;
  duel.attacker = fresh.attacker;
  duel.defender = fresh.defender;
  duel.projectiles = [];
  duel.obstacles = fresh.obstacles;
  duel.iceHazards = [];
  duel.allies = [];
  duel.events = [];
  duel.lastMoveIntentAt = { w: now, b: now };
  duel.winner = null;
  duel.resolutionReason = undefined;
  duel.isFinished = false;
  if (duel.sandboxOptions?.noCooldowns) {
    duel.attacker.cooldowns.primary = 0;
    duel.attacker.cooldowns.secondary = 0;
    duel.defender.cooldowns.primary = 0;
    duel.defender.cooldowns.secondary = 0;
  }
}

export function respawnObstacles(duel: DuelSimulation): void {
  const fen = duel.initialState?.fen ?? '';
  const pending = duel.initialState?.pending ?? {
    from: 'e2' as BoardSquare,
    to: 'e7' as BoardSquare,
    attackerColor: duel.attacker.color,
    attackerClass: duel.attacker.pieceClass,
    defenderClass: duel.defender.pieceClass,
  };
  const fresh = createDuel(fen, pending, duel.now);
  duel.obstacles = fresh.obstacles;
  duel.iceHazards = [];
}
