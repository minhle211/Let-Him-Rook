export const PROTOCOL_VERSION = 1;

export const BOARD_SIZE_UNITS = 8; // [-4, 4]
export const TABLE_HALF_EXTENT = 11; // [-11, 11] (22x22 battlefield)
export const SPAWN_SEPARATION = 5.0;
export const SPAWN_CLEAR_RADIUS = 2.5;

export const FIGHTER_MAX_HP = 100;
export const FIGHTER_MOVE_SPEED = 3.5;
export const FIGHTER_TURN_SPEED = 1.1; // ~63 deg/sec manual rotation speed
export const FIGHTER_RADIUS = 0.45;

export const OBSTACLE_MAX_HITS = 3;
export const OBSTACLE_MAX_HP = 75; // 25 HP per hit
export const OBSTACLE_RADIUS = 0.42;

export const DUEL_DURATION_MS = 90_000;
export const SERVER_TICK_HZ = 60;
export const SERVER_TICK_MS = 1000 / SERVER_TICK_HZ; // ~16.67ms
export const TRACKING_LOSS_STOP_MS = 300;
export const RECONNECT_GRACE_MS = 30_000;
export const DUEL_INTRO_DURATION_MS = 2000;
export const DUEL_RESULT_DURATION_MS = 2500;
export const LEAN_DEADZONE = 0.12;

export const CLASS_ABILITY_CONFIG = {
  pawn: {
    sweep: {
      damage: 18,
      range: 2.2,
      arcDeg: 120,
      cooldownMs: 1200,
    },
    parry: {
      maxHoldMs: 1000,
      cooldownMs: 3000,
    },
  },
  rook: {
    shot: {
      damage: 16,
      speed: 10.0,
      radius: 0.25,
      cooldownMs: 1500,
    },
    cannonBomb: {
      damage: 28,
      speed: 9.0,
      radius: 0.35,
      splashRadius: 2.0,
      intervalShots: 3,
    },
  },
  knight: {
    cleave: {
      maxTeleportDist: 4.5,
      forwardTeleportDist: 3.0,
      targetConeDeg: 120,
      obstacleConeDeg: 40,
      targetOffsetDist: 1.2,
      windupMs: 350,
      damage: 24,
      slashArcRadius: 1.75,
      slashArcDeg: 100,
      maxTargets: 4,
      cooldownMs: 4500,
    },
  },
  bishop: {
    iceBolt: {
      damage: 14,
      speed: 8.0,
      radius: 0.3,
      cooldownMs: 2500,
      chillDurationMs: 4000,
      chillSlowFactor: 0.40, // 40% slow (moves at 0.6x speed)
      chillDotDps: 3.0,
      obstacleFreezeMs: 4000,
      hazardRadius: 1.5,
      hazardDurationMs: 4000,
      hazardDotDps: 3.0,
      hazardSlowFactor: 0.40,
    },
  },
  queen: {
    volley: {
      orbCount: 3,
      damagePerOrb: 9, // Total 27 dmg
      speed: 7.0,
      radius: 0.22,
      fanAnglesDeg: [-18, 0, 18],
      cooldownMs: 3500,
      homingTurnRate: 2.5, // rad/sec
      obstacleHitsPerOrb: 1, // 1 hit per orb
    },
  },
  king: {
    summon: {
      cooldownMs: 6000,
      maxSummonsPerDuel: 10, // summons stack (no wait for the previous ally to die); 10 per duel
      allyHp: 1,
      durationMs: 12000,
      attackIntervalMs: 2000,
      speed: 2.2,
      baseDamageMultiplier: 0.75, // ally hits for 75% of its piece's normal damage
      rangedTargetDistance: 3.0, // 3 blocks (units) away from target
      recalibrateIntervalMs: 3000, // recalibrate distance and cycle move/stop every 3s
    },
  },
} as const;
