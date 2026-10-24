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
    const bot = mode === 'bot' ? new BotController() : null;

    const room: Room = {
      id,
      match,
      bot,
      tokens,
      connections: new Map(),
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
    if (room.match.mode === 'bot') {
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
    room.match.setPlayerConnected(color, true);
    room.touchedAt = Date.now();

    this.sendToSession(session, {
      type: 'snapshot',
      snapshot: room.match.getSnapshot(),
    });
  }

  public detachConnection(room: Room, color: PlayerColor, session: WebSocketSession): void {
    if (room.connections.get(color) === session) {
      room.connections.delete(color);
      room.match.setPlayerConnected(color, false);
      room.touchedAt = Date.now();
    }
  }

  public handleClientMessage(
    room: Room,
    color: PlayerColor,
    message: ClientMessage,
    session: WebSocketSession
  ): void {
    room.touchedAt = Date.now();
    const match = room.match;

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
          message.actionId
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
        match.handleDuelMove(color, message.moveX, message.moveZ, message.actionId);
        break;
      }

      case 'duel_ability_intent': {
        const res = match.handleDuelAbility(
          color,
          message.ability,
          message.parryHolding,
          message.actionId
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
    }
  }

  public tick(now = Date.now()): void {
    for (const [id, room] of this.rooms.entries()) {
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
