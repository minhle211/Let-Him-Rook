export type PlayerColor = 'w' | 'b';

export type PieceClass = 'pawn' | 'rook' | 'knight' | 'bishop' | 'queen' | 'king';

export function isRangedPieceClass(pieceClass: PieceClass): boolean {
  return pieceClass === 'rook' || pieceClass === 'bishop' || pieceClass === 'queen';
}

export type PromotionPieceClass = 'queen' | 'rook' | 'bishop' | 'knight';

export type MatchPhase =
  | 'lobby'
  | 'calibration'
  | 'chess_turn'
  | 'duel_intro'
  | 'active_duel'
  | 'duel_result'
  | 'match_over';

export type BoardSquare =
  | 'a1' | 'b1' | 'c1' | 'd1' | 'e1' | 'f1' | 'g1' | 'h1'
  | 'a2' | 'b2' | 'c2' | 'd2' | 'e2' | 'f2' | 'g2' | 'h2'
  | 'a3' | 'b3' | 'c3' | 'd3' | 'e3' | 'f3' | 'g3' | 'h3'
  | 'a4' | 'b4' | 'c4' | 'd4' | 'e4' | 'f4' | 'g4' | 'h4'
  | 'a5' | 'b5' | 'c5' | 'd5' | 'e5' | 'f5' | 'g5' | 'h5'
  | 'a6' | 'b6' | 'c6' | 'd6' | 'e6' | 'f6' | 'g6' | 'h6'
  | 'a7' | 'b7' | 'c7' | 'd7' | 'e7' | 'f7' | 'g7' | 'h7'
  | 'a8' | 'b8' | 'c8' | 'd8' | 'e8' | 'f8' | 'g8' | 'h8';

export type MatchMode = 'pvp' | 'bot' | 'sandbox';

export type AiBehaviorMode = 'dummy' | 'passive' | 'aggressive';

export interface SandboxConfig {
  rulesEnforced: boolean;
  godMode: boolean;
  noCooldowns: boolean;
  moveSpeedMultiplier: number;
  aiBehavior: AiBehaviorMode;
  isStandaloneDuel: boolean;
}

export function createDefaultSandboxConfig(): SandboxConfig {
  return {
    rulesEnforced: true,
    godMode: false,
    noCooldowns: false,
    moveSpeedMultiplier: 1.0,
    aiBehavior: 'dummy',
    isStandaloneDuel: false,
  };
}

export type MatchWinner = PlayerColor | 'draw' | null;
export type DuelWinner = PlayerColor | 'draw' | null;

export interface PlayerStatus {
  color: PlayerColor;
  connected: boolean;
  calibrated: boolean;
  disconnectedAt?: number;
  pingMs: number;
}

export interface PendingCapture {
  from: BoardSquare;
  to: BoardSquare;
  attackerColor: PlayerColor;
  attackerClass: PieceClass;
  defenderClass: PieceClass;
  promotion?: PromotionPieceClass;
}

export interface FighterState {
  color: PlayerColor;
  pieceClass: PieceClass;
  hp: number;
  maxHp: number;
  x: number;
  z: number;
  facingRad: number;
  turnRate: number;
  vx: number;
  vz: number;
  isParrying: boolean;
  parryHoldRemainingMs: number;
  isChilled: boolean;
  chillRemainingMs: number;
  teleportWindupRemainingMs: number;
  cooldowns: {
    primary: number; // e.g. attack/shot/cleave/bolt/volley/summon
    secondary: number; // e.g. parry
  };
  rookShotCounter: number;
  /** King: summons used this duel (capped at CLASS_ABILITY_CONFIG.king.summon.maxSummonsPerDuel). */
  summonsUsed: number;
}

export type ProjectileType =
  | 'rook_shot'
  | 'rook_cannon_bomb'
  | 'bishop_ice_bolt'
  | 'queen_orb';

export interface ProjectileState {
  id: string;
  type: ProjectileType;
  owner: PlayerColor;
  x: number;
  z: number;
  vx: number;
  vz: number;
  radius: number;
  damage: number;
  homingTargetColor?: PlayerColor;
  splashRadius?: number;
}

export type ObstacleType = 'piece' | 'tree' | 'tower';

export interface ObstacleState {
  id: string;
  type: ObstacleType;
  square?: BoardSquare;
  pieceClass?: PieceClass;
  pieceColor?: PlayerColor;
  x: number;
  z: number;
  radius: number;
  hitsRemaining: number;
  maxHits: number;
  frozenRemainingMs: number;
  /** Blocks movement and attacks but never takes damage (trees). */
  indestructible?: boolean;
}

export interface IceHazardState {
  id: string;
  x: number;
  z: number;
  radius: number;
  remainingMs: number;
}

export interface SummonAllyState {
  id: string;
  owner: PlayerColor;
  pieceClass: PieceClass;
  hp: number;
  x: number;
  z: number;
  facingRad: number;
  remainingMs: number;
  nextAttackMs: number;
  phaseIndex?: number;
  isMovingAway?: boolean;
}

export interface DuelSnapshot {
  startedAt: number;
  elapsedMs: number;
  remainingMs: number;
  attacker: FighterState;
  defender: FighterState;
  projectiles: ProjectileState[];
  obstacles: ObstacleState[];
  iceHazards: IceHazardState[];
  allies: SummonAllyState[];
  winner: DuelWinner;
  resolutionReason?: string;
}

export interface MatchSnapshot {
  roomId: string;
  revision: number;
  phase: MatchPhase;
  mode: MatchMode;
  fen: string;
  turn: PlayerColor;
  pendingCapture: PendingCapture | null;
  duelSnapshot: DuelSnapshot | null;
  players: Record<PlayerColor, PlayerStatus>;
  winner: MatchWinner;
  winReason?: string;
  legalMoves: Record<BoardSquare, BoardSquare[]>;
  serverTime: number;
  simulationTime: number;
  paused: boolean;
  sandboxConfig?: SandboxConfig;
}

export type DuelEventType =
  | 'melee_swing'
  | 'projectile_spawn'
  | 'projectile_hit'
  | 'obstacle_damage'
  | 'obstacle_broken'
  | 'parry_blocked'
  | 'teleport'
  | 'melee_hit'
  | 'ice_hazard_spawn'
  | 'summon_ally'
  | 'duel_end';

export interface DuelEvent {
  type: DuelEventType;
  timestamp: number;
  data: Record<string, unknown>;
}

export type AbilityType =
  | 'pawn_sweep'
  | 'pawn_parry'
  | 'rook_shot'
  | 'knight_cleave'
  | 'bishop_ice_bolt'
  | 'queen_volley'
  | 'king_summon';
