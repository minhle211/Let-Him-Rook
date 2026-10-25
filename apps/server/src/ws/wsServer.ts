import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  SERVER_TICK_MS,
  parseClientMessage,
  type ClientMessage,
  type PlayerColor,
  type ServerMessage,
} from '@let-him-rook/shared';
import { RoomManager, type Room, type WebSocketSession } from '../rooms/roomManager.ts';

const WS_MAGIC = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

export class SimpleWebSocketConnection implements WebSocketSession {
  public socket: Duplex;
  public isAlive: boolean = true;
  private buffer: Buffer = Buffer.alloc(0);
  public onMessage?: (data: string) => void;
  public onClose?: () => void;
  private closeNotified = false;

  private notifyClose(): void {
    if (this.closeNotified) return;
    this.closeNotified = true;
    this.isAlive = false;
    this.onClose?.();
  }

  constructor(socket: Duplex) {
    this.socket = socket;
    this.socket.on('data', chunk => this.handleData(chunk));
    this.socket.on('close', () => {
      this.notifyClose();
    });
    this.socket.on('error', () => {
      this.notifyClose();
      this.socket.destroy();
    });
  }

  private handleData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);

    while (this.buffer.length >= 2) {
      const byte1 = this.buffer[0];
      const byte2 = this.buffer[1];
      const opcode = byte1 & 0x0f;
      const isMasked = (byte2 & 0x80) !== 0;
      let payloadLen = byte2 & 0x7f;
      let offset = 2;

      if (payloadLen === 126) {
        if (this.buffer.length < 4) return;
        payloadLen = this.buffer.readUInt16BE(2);
        offset = 4;
      } else if (payloadLen === 127) {
        if (this.buffer.length < 10) return;
        payloadLen = Number(this.buffer.readBigUInt64BE(2));
        offset = 10;
      }

      const maskKeyLen = isMasked ? 4 : 0;
      const totalLen = offset + maskKeyLen + payloadLen;
      if (this.buffer.length < totalLen) return;

      const maskKey = isMasked ? this.buffer.subarray(offset, offset + 4) : null;
      offset += maskKeyLen;

      const payload = Buffer.from(this.buffer.subarray(offset, offset + payloadLen));
      this.buffer = this.buffer.subarray(totalLen);

      if (isMasked && maskKey) {
        for (let i = 0; i < payload.length; i++) {
          payload[i] ^= maskKey[i % 4];
        }
      }

      if (opcode === 0x8) {
        // Close frame
        this.close();
        return;
      } else if (opcode === 0x9) {
        // Ping -> Pong
        this.sendFrame(0xa, payload);
      } else if (opcode === 0x1) {
        // Text frame
        const text = payload.toString('utf8');
        this.onMessage?.(text);
      }
    }
  }

  public send(message: string): void {
    if (!this.isAlive || this.socket.destroyed) return;
    const payload = Buffer.from(message, 'utf8');
    this.sendFrame(0x1, payload);
  }

  private sendFrame(opcode: number, payload: Buffer): void {
    let header: Buffer;
    const len = payload.length;

    if (len < 126) {
      header = Buffer.alloc(2);
      header[0] = 0x80 | opcode;
      header[1] = len;
    } else if (len <= 0xffff) {
      header = Buffer.alloc(4);
      header[0] = 0x80 | opcode;
      header[1] = 126;
      header.writeUInt16BE(len, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x80 | opcode;
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(len), 2);
    }

    try {
      this.socket.write(Buffer.concat([header, payload]));
    } catch {
      this.isAlive = false;
    }
  }

  public close(code = 1000, reason = ''): void {
    if (!this.isAlive) return;
    const reasonBuf = Buffer.from(reason, 'utf8');
    const payload = Buffer.alloc(2 + reasonBuf.length);
    payload.writeUInt16BE(code, 0);
    reasonBuf.copy(payload, 2);
    try {
      this.sendFrame(0x8, payload);
      this.socket.end();
    } catch {
      this.socket.destroy();
    }
    this.notifyClose();
  }
}

export class DirectVirtualSession implements WebSocketSession {
  public isAlive: boolean = true;
  public onMessage?: (data: string) => void;
  public onClose?: () => void;
  public target?: DirectVirtualSession;

  public send(message: string): void {
    if (!this.isAlive) return;
    queueMicrotask(() => {
      this.target?.onMessage?.(message);
    });
  }

  public close(): void {
    this.isAlive = false;
    this.onClose?.();
    if (this.target?.isAlive) {
      this.target.isAlive = false;
      this.target.onClose?.();
    }
  }
}

export function createVirtualSessionPair(): {
  clientSession: DirectVirtualSession;
  serverSession: DirectVirtualSession;
} {
  const clientSession = new DirectVirtualSession();
  const serverSession = new DirectVirtualSession();
  clientSession.target = serverSession;
  serverSession.target = clientSession;
  return { clientSession, serverSession };
}

export class RookServer {
  public server: Server;
  public roomManager: RoomManager;
  private tickInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.roomManager = new RoomManager();
    this.server = createServer((req, res) => this.handleHttp(req, res));
    this.server.on('upgrade', (req, socket, head) => this.handleUpgrade(req, socket, head));
  }

  public start(port = 3001, host = '0.0.0.0'): Promise<number> {
    return new Promise(resolve => {
      this.server.listen(port, host, () => {
        const addr = this.server.address();
        const actualPort = typeof addr === 'object' && addr ? addr.port : port;
        this.tickInterval = setInterval(() => {
          this.roomManager.tick();
        }, Math.round(SERVER_TICK_MS));
        this.tickInterval.unref();
        resolve(actualPort);
      });
    });
  }

  public stop(): Promise<void> {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
    return new Promise(resolve => {
      this.server.close(() => resolve());
    });
  }

  private async handleHttp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if ((req.method === 'GET' || req.method === 'HEAD') && url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (req.method === 'HEAD') {
        res.end();
      } else {
        res.end(JSON.stringify({ ok: true, timestamp: Date.now() }));
      }
      return;
    }

    // Serve static frontend assets if requested via GET or HEAD
    if (req.method === 'GET' || req.method === 'HEAD') {
      const mimeTypes: Record<string, string> = {
        '.html': 'text/html; charset=utf-8',
        '.js': 'text/javascript; charset=utf-8',
        '.mjs': 'text/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.json': 'application/json',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.svg': 'image/svg+xml',
        '.wasm': 'application/wasm',
        '.task': 'application/octet-stream',
      };

      const cleanPath = url.pathname === '/' ? '/index.html' : url.pathname;
      const staticDirs = [
        resolve(process.cwd(), 'apps/web/dist'),
        resolve(process.cwd(), 'apps/web/public'),
        resolve(process.cwd(), 'apps/web'),
      ];

      for (const dir of staticDirs) {
        const filePath = resolve(dir, '.' + cleanPath);
        if (filePath.startsWith(dir) && existsSync(filePath)) {
          try {
            const ext = cleanPath.substring(cleanPath.lastIndexOf('.')).toLowerCase();
            const mime = mimeTypes[ext] || 'application/octet-stream';
            const content = await readFile(filePath);
            // Vite's /assets/ files are content-hashed and the MediaPipe models are
            // versioned by path, so the ~25 MB of Wasm + models can be cached long-term.
            const immutable = cleanPath.startsWith('/assets/') || cleanPath.startsWith('/mediapipe/');
            res.writeHead(200, {
              'Content-Type': mime,
              'Content-Length': content.length,
              'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
            });
            if (req.method === 'HEAD') {
              res.end();
            } else {
              res.end(content);
            }
            return;
          } catch {
            // continue checking other candidates
          }
        }
      }
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  }

  private handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    const key = req.headers['sec-websocket-key'];
    if (!key || typeof key !== 'string') {
      socket.destroy();
      return;
    }

    const accept = createHash('sha1')
      .update(key + WS_MAGIC)
      .digest('base64');

    const headers = [
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${accept}`,
      '\r\n',
    ];

    socket.write(headers.join('\r\n'));

    const session = new SimpleWebSocketConnection(socket);
    this.routeSession(session);
  }

  public routeSession(session: WebSocketSession): void {
    let boundRoom: Room | null = null;
    let boundColor: PlayerColor | null = null;

    session.onMessage = (raw: string) => {
      try {
        const clientMsg = parseClientMessage(raw);

        if (clientMsg.type === 'create_room') {
          const { room, token, color } = this.roomManager.createRoom(clientMsg.mode || 'pvp');
          boundRoom = room;
          boundColor = color;
          this.roomManager.attachConnection(room, color, session);
          session.send(
            JSON.stringify({
              type: 'room_joined',
              roomId: room.id,
              color,
              token,
              mode: room.match.mode,
            })
          );
          return;
        }

        if (clientMsg.type === 'join_room') {
          const { room, token, color } = this.roomManager.joinRoom(clientMsg.roomId);
          boundRoom = room;
          boundColor = color;
          this.roomManager.attachConnection(room, color, session);
          session.send(
            JSON.stringify({
              type: 'room_joined',
              roomId: room.id,
              color,
              token,
              mode: room.match.mode,
            })
          );
          return;
        }

        if (clientMsg.type === 'reconnect_room') {
          const { room, color } = this.roomManager.reconnectRoom(
            clientMsg.roomId,
            clientMsg.token
          );
          boundRoom = room;
          boundColor = color;
          this.roomManager.attachConnection(room, color, session);
          session.send(
            JSON.stringify({
              type: 'room_joined',
              roomId: room.id,
              color,
              token: clientMsg.token,
              mode: room.match.mode,
            })
          );
          return;
        }

        if (!boundRoom || !boundColor) {
          session.send(
            JSON.stringify({
              type: 'error',
              code: 'unauthorized',
              message: 'Must join or create a room first',
            })
          );
          return;
        }

        this.roomManager.handleClientMessage(boundRoom, boundColor, clientMsg, session);
      } catch (err) {
        session.send(
          JSON.stringify({
            type: 'error',
            code: 'invalid_message',
            message: err instanceof Error ? err.message : 'Unknown error',
          })
        );
      }
    };

    session.onClose = () => {
      if (boundRoom && boundColor) {
        this.roomManager.detachConnection(boundRoom, boundColor, session);
      }
    };
  }
}
