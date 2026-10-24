import type {
  AbilityType,
  AiBehaviorMode,
  BoardSquare,
  DuelEvent,
  MatchMode,
  MatchSnapshot,
  PieceClass,
  PlayerColor,
  PromotionPieceClass,
  SandboxConfig,
} from './types.ts';

export type ClientMessage =
  | { type: 'create_room'; mode?: MatchMode }
  | { type: 'join_room'; roomId: string }
  | { type: 'reconnect_room'; roomId: string; token: string }
  | { type: 'calibration_ready'; ready: boolean }
  | {
      type: 'chess_move_intent';
      from: BoardSquare;
      to: BoardSquare;
      promotion?: PromotionPieceClass;
      actionId: string;
    }
  | { type: 'duel_move_intent'; moveX: number; moveZ: number; actionId: string }
  | {
      type: 'duel_ability_intent';
      ability: AbilityType;
      parryHolding?: boolean;
      actionId: string;
    }
  | { type: 'request_ai_advice' }
  | { type: 'ping'; timestamp: number }
  | { type: 'sandbox_set_fen'; fen: string }
  | {
      type: 'sandbox_place_piece';
      square: BoardSquare;
      pieceClass: PieceClass | null;
      pieceColor?: PlayerColor;
    }
  | { type: 'sandbox_free_move'; from: BoardSquare; to: BoardSquare }
  | {
      type: 'sandbox_start_duel';
      attackerClass: PieceClass;
      defenderClass: PieceClass;
      aiBehavior?: AiBehaviorMode;
      standalone?: boolean;
    }
  | { type: 'sandbox_update_config'; config: Partial<SandboxConfig> }
  | { type: 'sandbox_reset_duel' }
  | { type: 'sandbox_exit_duel' }
  | { type: 'sandbox_respawn_obstacles' };

export type ServerMessage =
  | {
      type: 'room_joined';
      roomId: string;
      color: PlayerColor;
      token: string;
      mode: MatchMode;
    }
  | { type: 'snapshot'; snapshot: MatchSnapshot }
  | {
      type: 'action_feedback';
      actionId: string;
      accepted: boolean;
      reason?: string;
    }
  | { type: 'duel_events'; events: DuelEvent[] }
  | { type: 'ai_advice'; advice: string }
  | { type: 'error'; code: string; message: string }
  | { type: 'pong'; timestamp: number };

const SQUARES = new Set<string>([
  'a1', 'b1', 'c1', 'd1', 'e1', 'f1', 'g1', 'h1',
  'a2', 'b2', 'c2', 'd2', 'e2', 'f2', 'g2', 'h2',
  'a3', 'b3', 'c3', 'd3', 'e3', 'f3', 'g3', 'h3',
  'a4', 'b4', 'c4', 'd4', 'e4', 'f4', 'g4', 'h4',
  'a5', 'b5', 'c5', 'd5', 'e5', 'f5', 'g5', 'h5',
  'a6', 'b6', 'c6', 'd6', 'e6', 'f6', 'g6', 'h6',
  'a7', 'b7', 'c7', 'd7', 'e7', 'f7', 'g7', 'h7',
  'a8', 'b8', 'c8', 'd8', 'e8', 'f8', 'g8', 'h8',
]);

const ABILITIES = new Set<AbilityType>([
  'pawn_sweep',
  'pawn_parry',
  'rook_shot',
  'knight_cleave',
  'bishop_ice_bolt',
  'queen_volley',
  'king_summon',
]);

const PROMOTIONS = new Set<PromotionPieceClass>([
  'queen',
  'rook',
  'bishop',
  'knight',
]);

const PIECE_CLASSES = new Set<PieceClass>([
  'pawn',
  'rook',
  'knight',
  'bishop',
  'queen',
  'king',
]);

const AI_BEHAVIORS = new Set<AiBehaviorMode>([
  'dummy',
  'passive',
  'aggressive',
]);

export function parseClientMessage(raw: string): ClientMessage {
  if (typeof raw !== 'string') {
    throw new Error('Message must be a string');
  }
  if (raw.length > 8192) {
    throw new Error('Message payload exceeds 8KB limit');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Malformed JSON');
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Message must be a JSON object');
  }

  const obj = parsed as Record<string, unknown>;
  const type = obj.type;

  switch (type) {
    case 'create_room': {
      const mode = obj.mode;
      if (mode !== undefined && mode !== 'pvp' && mode !== 'bot' && mode !== 'sandbox') {
        throw new Error('Invalid match mode');
      }
      return { type: 'create_room', mode: mode as MatchMode | undefined };
    }

    case 'join_room': {
      if (typeof obj.roomId !== 'string' || !/^[A-Za-z0-9_-]{1,16}$/.test(obj.roomId)) {
        throw new Error('Invalid roomId');
      }
      return { type: 'join_room', roomId: obj.roomId.toUpperCase() };
    }

    case 'reconnect_room': {
      if (typeof obj.roomId !== 'string' || typeof obj.token !== 'string') {
        throw new Error('roomId and token required');
      }
      return { type: 'reconnect_room', roomId: obj.roomId.toUpperCase(), token: obj.token };
    }

    case 'calibration_ready': {
      if (typeof obj.ready !== 'boolean') {
        throw new Error('ready must be a boolean');
      }
      return { type: 'calibration_ready', ready: obj.ready };
    }

    case 'chess_move_intent': {
      if (typeof obj.from !== 'string' || !SQUARES.has(obj.from)) {
        throw new Error('Invalid from square');
      }
      if (typeof obj.to !== 'string' || !SQUARES.has(obj.to)) {
        throw new Error('Invalid to square');
      }
      if (typeof obj.actionId !== 'string' || obj.actionId.length < 1 || obj.actionId.length > 64) {
        throw new Error('Invalid actionId');
      }
      if (obj.promotion !== undefined && !PROMOTIONS.has(obj.promotion as PromotionPieceClass)) {
        throw new Error('Invalid promotion piece');
      }
      return {
        type: 'chess_move_intent',
        from: obj.from as BoardSquare,
        to: obj.to as BoardSquare,
        promotion: obj.promotion as PromotionPieceClass | undefined,
        actionId: obj.actionId,
      };
    }

    case 'duel_move_intent': {
      if (typeof obj.moveX !== 'number' || typeof obj.moveZ !== 'number') {
        throw new Error('moveX and moveZ must be numbers');
      }
      if (typeof obj.actionId !== 'string') {
        throw new Error('Invalid actionId');
      }
      const moveX = Math.max(-1, Math.min(1, obj.moveX));
      const moveZ = Math.max(-1, Math.min(1, obj.moveZ));
      return {
        type: 'duel_move_intent',
        moveX,
        moveZ,
        actionId: obj.actionId,
      };
    }

    case 'duel_ability_intent': {
      if (typeof obj.ability !== 'string' || !ABILITIES.has(obj.ability as AbilityType)) {
        throw new Error('Invalid ability');
      }
      if (typeof obj.actionId !== 'string') {
        throw new Error('Invalid actionId');
      }
      return {
        type: 'duel_ability_intent',
        ability: obj.ability as AbilityType,
        parryHolding: typeof obj.parryHolding === 'boolean' ? obj.parryHolding : undefined,
        actionId: obj.actionId,
      };
    }

    case 'request_ai_advice': {
      return { type: 'request_ai_advice' };
    }

    case 'ping': {
      if (typeof obj.timestamp !== 'number') {
        throw new Error('Invalid timestamp');
      }
      return { type: 'ping', timestamp: obj.timestamp };
    }

    case 'sandbox_set_fen': {
      if (typeof obj.fen !== 'string' || obj.fen.length === 0 || obj.fen.length > 256) {
        throw new Error('Invalid FEN string');
      }
      return { type: 'sandbox_set_fen', fen: obj.fen };
    }

    case 'sandbox_place_piece': {
      if (typeof obj.square !== 'string' || !SQUARES.has(obj.square)) {
        throw new Error('Invalid square');
      }
      if (
        obj.pieceClass !== null &&
        (typeof obj.pieceClass !== 'string' || !PIECE_CLASSES.has(obj.pieceClass as PieceClass))
      ) {
        throw new Error('Invalid pieceClass');
      }
      if (obj.pieceColor !== undefined && obj.pieceColor !== 'w' && obj.pieceColor !== 'b') {
        throw new Error('Invalid pieceColor');
      }
      return {
        type: 'sandbox_place_piece',
        square: obj.square as BoardSquare,
        pieceClass: obj.pieceClass as PieceClass | null,
        pieceColor: obj.pieceColor as PlayerColor | undefined,
      };
    }

    case 'sandbox_free_move': {
      if (typeof obj.from !== 'string' || !SQUARES.has(obj.from)) {
        throw new Error('Invalid from square');
      }
      if (typeof obj.to !== 'string' || !SQUARES.has(obj.to)) {
        throw new Error('Invalid to square');
      }
      return {
        type: 'sandbox_free_move',
        from: obj.from as BoardSquare,
        to: obj.to as BoardSquare,
      };
    }

    case 'sandbox_start_duel': {
      if (
        typeof obj.attackerClass !== 'string' ||
        !PIECE_CLASSES.has(obj.attackerClass as PieceClass)
      ) {
        throw new Error('Invalid attackerClass');
      }
      if (
        typeof obj.defenderClass !== 'string' ||
        !PIECE_CLASSES.has(obj.defenderClass as PieceClass)
      ) {
        throw new Error('Invalid defenderClass');
      }
      if (obj.aiBehavior !== undefined && !AI_BEHAVIORS.has(obj.aiBehavior as AiBehaviorMode)) {
        throw new Error('Invalid aiBehavior');
      }
      if (obj.standalone !== undefined && typeof obj.standalone !== 'boolean') {
        throw new Error('standalone must be boolean');
      }
      return {
        type: 'sandbox_start_duel',
        attackerClass: obj.attackerClass as PieceClass,
        defenderClass: obj.defenderClass as PieceClass,
        aiBehavior: obj.aiBehavior as AiBehaviorMode | undefined,
        standalone: obj.standalone as boolean | undefined,
      };
    }

    case 'sandbox_update_config': {
      if (!obj.config || typeof obj.config !== 'object' || Array.isArray(obj.config)) {
        throw new Error('config must be an object');
      }
      const c = obj.config as Record<string, unknown>;
      const config: Partial<SandboxConfig> = {};
      if (c.rulesEnforced !== undefined) {
        if (typeof c.rulesEnforced !== 'boolean') throw new Error('rulesEnforced must be boolean');
        config.rulesEnforced = c.rulesEnforced;
      }
      if (c.godMode !== undefined) {
        if (typeof c.godMode !== 'boolean') throw new Error('godMode must be boolean');
        config.godMode = c.godMode;
      }
      if (c.noCooldowns !== undefined) {
        if (typeof c.noCooldowns !== 'boolean') throw new Error('noCooldowns must be boolean');
        config.noCooldowns = c.noCooldowns;
      }
      if (c.moveSpeedMultiplier !== undefined) {
        if (typeof c.moveSpeedMultiplier !== 'number' || isNaN(c.moveSpeedMultiplier)) {
          throw new Error('moveSpeedMultiplier must be a number');
        }
        config.moveSpeedMultiplier = c.moveSpeedMultiplier;
      }
      if (c.aiBehavior !== undefined) {
        if (!AI_BEHAVIORS.has(c.aiBehavior as AiBehaviorMode)) {
          throw new Error('Invalid aiBehavior');
        }
        config.aiBehavior = c.aiBehavior as AiBehaviorMode;
      }
      if (c.isStandaloneDuel !== undefined) {
        if (typeof c.isStandaloneDuel !== 'boolean') throw new Error('isStandaloneDuel must be boolean');
        config.isStandaloneDuel = c.isStandaloneDuel;
      }
      return { type: 'sandbox_update_config', config };
    }

    case 'sandbox_reset_duel': {
      return { type: 'sandbox_reset_duel' };
    }

    case 'sandbox_exit_duel': {
      return { type: 'sandbox_exit_duel' };
    }

    case 'sandbox_respawn_obstacles': {
      return { type: 'sandbox_respawn_obstacles' };
    }

    default:
      throw new Error(`Unknown message type: ${String(type)}`);
  }
}
