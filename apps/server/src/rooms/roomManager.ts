import { randomBytes } from 'node:crypto';
import type {
  ClientMessage,
  MatchMode,
  PlayerColor,
  ServerMessage,
} from '@let-him-rook/shared';
import { defaultTacticalAdvice, explainPosition, type AiProvider } from '../match/aiAdvisor.ts';
import { BotController } from '../match/botController.ts';
import { MatchMachine } from '../match/matchMachine.ts';

export interface WebSocketSession {
  send(message: string): void;
  close(code?: number, reason?: string): void;
  isAlive: boolean;
  onMessage?: (data: string) => void;
  onClose?: () => void;
}

export interface Room {
  id: string;
  match: MatchMachine;
  bot: BotController | null;
  tokens: Map<string, PlayerColor>; // token -> color
  connections: Map<PlayerColor, WebSocketSession>;
  lastSeen: Map<PlayerColor, number>;
  createdAt: number;
  touchedAt: number;
}

export class RoomManager {
  private rooms: Map<string, Room> = new Map();
  private aiProvider: AiProvider | null = null;

  public setAiProvider(provider: AiProvider | null): void {
    this.aiProvider = provider;
  }

  private generateToken(): string {
    return randomBytes(24).toString('hex'); // 48-char hex string
  }

  private generateRoomId(): string {
    let id: string;
    do {
      id = randomBytes(3).toString('hex').toUpperCase();
    } while (this.rooms.has(id));
    return id;
  }

  public createRoom(mode: MatchMode = 'pvp'): { room: Room; token: string; color: PlayerColor } {
    if (this.rooms.size >= 500) {
      throw new Error('Server room capacity reached');
    }
    const id = this.generateRoomId();
    const match = new MatchMachine(id, mode);
    const token = this.generateToken();
    const tokens = new Map<string, PlayerColor>([[token, 'w']]);
    const bot = mode === 'bot' || mode === 'sandbox' ? new BotController() : null;

    if (mode === 'sandbox') {
      match.setCalibrationReady('w', true);
      match.setCalibrationReady('b', true);
    }

    const room: Room = {
      id,
      match,
      bot,
      tokens,
      connections: new Map(),
      lastSeen: new Map(),
      createdAt: Date.now(),
      touchedAt: Date.now(),
    };

    this.rooms.set(id, room);
    return { room, token, color: 'w' };
  }

  public joinRoom(roomId: string): { room: Room; token: string; color: PlayerColor } {
    const room = this.rooms.get(roomId);
    if (!room) {
      throw new Error('Room not found');
    }
    if (room.match.mode === 'bot' || room.match.mode === 'sandbox') {
      throw new Error('Cannot join solo practice room');
    }
    if (room.tokens.size >= 2) {
      throw new Error('Room is full');
    }

    const token = this.generateToken();
    room.tokens.set(token, 'b');
    room.touchedAt = Date.now();

    return { room, token, color: 'b' };
  }

  public reconnectRoom(roomId: string, token: string): { room: Room; color: PlayerColor } {
    const room = this.rooms.get(roomId);
    if (!room) {
      throw new Error('Room not found');
    }
    const color = room.tokens.get(token);
    if (!color) {
      throw new Error('Invalid reconnect token');
    }
    if (room.match.phase === 'match_over' && room.match.winReason === 'forfeit_disconnect_timeout') {
      throw new Error('Reconnect window expired');
    }
    const disconnectedAt = room.match.players[color].disconnectedAt;
    if (disconnectedAt && room.match.phase !== 'lobby' && room.match.phase !== 'calibration' && Date.now() - disconnectedAt >= 30_000) {
      room.match.tick();
      throw new Error('Reconnect window expired');
    }
    room.touchedAt = Date.now();
    return { room, color };
  }

  public getRoom(roomId: string): Room | undefined {
    return this.rooms.get(roomId);
  }

  public attachConnection(
    room: Room,
    color: PlayerColor,
    session: WebSocketSession
  ): void {
    const existing = room.connections.get(color);
    if (existing && existing !== session) {
      existing.close(1000, 'Replaced by new connection');
    }
    room.connections.set(color, session);
    room.lastSeen.set(color, Date.now());
    room.match.setPlayerConnected(color, true);
    room.touchedAt = Date.now();
    this.broadcastSnapshot(room);
  }

  public detachConnection(room: Room, color: PlayerColor, session: WebSocketSession): void {
    if (room.connections.get(color) === session) {
      room.connections.delete(color);
      room.lastSeen.delete(color);
      room.match.setPlayerConnected(color, false);
      room.touchedAt = Date.now();
      this.broadcastSnapshot(room);
    }
  }

  public handleClientMessage(
    room: Room,
    color: PlayerColor,
    message: ClientMessage,
    session: WebSocketSession
  ): void {
    room.touchedAt = Date.now();
    room.lastSeen.set(color, room.touchedAt);
    const match = room.match;
    if (match.paused && message.type !== 'ping' && message.type !== 'calibration_ready') {
      if ('actionId' in message) this.sendToSession(session, {
        type: 'action_feedback', actionId: message.actionId, accepted: false, reason: 'match_paused',
      });
      return;
    }

    switch (message.type) {
      case 'calibration_ready': {
        match.setCalibrationReady(color, message.ready);
        this.broadcastSnapshot(room);
        break;
      }

      case 'chess_move_intent': {
        const res = match.handleChessMove(
          color,
          message.from,
          message.to,
          message.promotion,
          message.actionId,
          match.getSimulationTime()
        );
        this.sendToSession(session, {
          type: 'action_feedback',
          actionId: message.actionId,
          accepted: res.accepted,
          reason: res.reason,
        });
        this.broadcastSnapshot(room);
        break;
      }

      case 'duel_move_intent': {
        match.handleDuelMove(color, message.moveX, message.moveZ, message.actionId, match.getSimulationTime());
        break;
      }

      case 'duel_ability_intent': {
        const res = match.handleDuelAbility(
          color,
          message.ability,
          message.parryHolding,
          message.actionId,
          match.getSimulationTime()
        );
        this.sendToSession(session, {
          type: 'action_feedback',
          actionId: message.actionId,
          accepted: res.accepted,
          reason: res.reason,
        });
        break;
      }

      case 'request_ai_advice': {
        explainPosition(this.aiProvider, match.getSnapshot()).then(advice => {
          this.sendToSession(session, {
            type: 'ai_advice',
            advice,
          });
        });
        break;
      }

      case 'ping': {
        this.sendToSession(session, {
          type: 'pong',
          timestamp: message.timestamp,
        });
        break;
      }

      case 'sandbox_set_fen': {
        match.handleSandboxSetFen(message.fen);
        this.broadcastSnapshot(room);
        break;
      }

      case 'sandbox_place_piece': {
        match.handleSandboxPlacePiece(message.square, message.pieceClass, message.pieceColor);
        this.broadcastSnapshot(room);
        break;
      }

      case 'sandbox_free_move': {
        match.handleSandboxFreeMove(message.from, message.to);
        this.broadcastSnapshot(room);
        break;
      }

      case 'sandbox_start_duel': {
        match.handleSandboxStartDuel(
          message.attackerClass,
          message.defenderClass,
          message.aiBehavior,
          message.standalone
        );
        this.broadcastSnapshot(room);
        break;
      }

      case 'sandbox_update_config': {
        match.handleSandboxUpdateConfig(message.config);
        this.broadcastSnapshot(room);
        break;
      }

      case 'sandbox_reset_duel': {
        match.handleSandboxResetDuel();
        this.broadcastSnapshot(room);
        break;
      }

      case 'sandbox_exit_duel': {
        match.handleSandboxExitDuel();
        this.broadcastSnapshot(room);
        break;
      }

      case 'sandbox_respawn_obstacles': {
        match.handleSandboxRespawnObstacles();
        this.broadcastSnapshot(room);
        break;
      }
    }
  }

  public tick(now = Date.now()): void {
    for (const [id, room] of this.rooms.entries()) {
      for (const [color, session] of room.connections) {
        if ('socket' in session && now - (room.lastSeen.get(color) ?? now) >= 15_000) {
          session.close(1001, 'Heartbeat timeout');
        }
      }
      // Expiration check: rooms inactive for > 2 hours with 0 connections
      if (now - room.touchedAt > 2 * 60 * 60 * 1000 && room.connections.size === 0) {
        this.rooms.delete(id);
        continue;
      }

      const revBefore = room.match.revision;
      room.match.tick(now);

      if (room.bot) {
        room.bot.tick(room.match, now);
      }

      // Check for unread duel events
      if (room.match.unreadDuelEvents.length > 0) {
        const events = [...room.match.unreadDuelEvents];
        room.match.unreadDuelEvents = [];
        this.broadcastMessage(room, {
          type: 'duel_events',
          events,
        });
      }

      // If in active duel, broadcast at 20Hz
      if (room.match.phase === 'active_duel' || revBefore !== room.match.revision) {
        this.broadcastSnapshot(room, now);
      }
    }
  }

  private sendToSession(session: WebSocketSession, message: ServerMessage): void {
    try {
      session.send(JSON.stringify(message));
    } catch {
      // Ignore broken pipe
    }
  }

  public broadcastMessage(room: Room, message: ServerMessage): void {
    const json = JSON.stringify(message);
    for (const session of room.connections.values()) {
      try {
        session.send(json);
      } catch {
        // Ignore broken pipe
      }
    }
  }

  public broadcastSnapshot(room: Room, now = Date.now()): void {
    this.broadcastMessage(room, {
      type: 'snapshot',
      snapshot: room.match.getSnapshot(now),
    });
  }
}
