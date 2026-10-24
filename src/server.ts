import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createBot, stepBot, type Bot } from './bot.ts';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';
import { cast, createGame, legalDestinations, move, tick, type Color, type Game } from './game.ts';

type Room = { bot: Bot | null; id: string; game: Game; tokens: Map<string, Color>; clients: Set<ServerResponse>; casts: Set<string>; touchedAt: number };
const token = () => randomBytes(24).toString('hex');
export function createApp() {
  const rooms = new Map<string, Room>();
  const ready = (r: Room) => !!r.bot || r.tokens.size === 2;
  const snapshot = (r: Room) => ({ roomId: r.id, mode: r.bot ? 'bot' : 'pvp', ready: ready(r), serverTime: Date.now(), game: r.game,
    legalMoves: Object.fromEntries(r.game.board.map((_, from) => [from, legalDestinations(r.game, from)])) });
  const send = (res: ServerResponse, status: number, data: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
  const broadcast = (r: Room) => {
    const message = `data: ${JSON.stringify(snapshot(r))}\n\n`;
    for (const client of r.clients) {
      if (!client.write(message)) { client.destroy(); r.clients.delete(client); }
    }
  };
  async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
    let text = '';
    for await (const chunk of req) {
      text += chunk.toString();
      if (Buffer.byteLength(text) > 4096) throw new Error('Request too large');
    }
    const parsed: unknown = JSON.parse(text || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Expected JSON object');
    return parsed as Record<string, unknown>;
  }
  const server = createServer(async (req, res) => {
    // The future browser app should be served from this origin or use a dev proxy.
    if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}` && req.headers.origin !== `https://${req.headers.host}`) {
      send(res, 403, { error: 'Use the server origin or a development proxy' }); return;
    }
    try {
      const url = new URL(req.url || '/', 'http://localhost');
      const assets: Record<string, [string, string]> = {
        '/board-hand.mjs': ['board-hand.mjs', 'text/javascript'],
        '/gestures.js': ['gestures.js', 'text/javascript'], '/recognizer.mjs': ['recognizer.mjs', 'text/javascript'], '/hand-worker.js': ['hand-worker.js', 'text/javascript'],
        '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'],
      };
      if (req.method === 'GET' && assets[url.pathname]) {
        const [file, mime] = assets[url.pathname];
        const content = await readFile(new URL(`../public/${file}`, import.meta.url));
        res.writeHead(200, { 'Content-Type': `${mime}; charset=utf-8`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
        res.end(content); return;
      }
      if (req.method === 'GET' && url.pathname === '/health') { send(res, 200, { ok: true }); return; }
      if (req.method === 'POST' && url.pathname === '/rooms') {
        const input = await body(req);
        if (input.mode !== undefined && input.mode !== 'pvp' && input.mode !== 'bot') throw new Error('Unknown game mode');
        if (rooms.size >= 100) { send(res, 503, { error: 'Room limit reached' }); return; }
        let id: string;
        do { id = randomBytes(3).toString('hex').toUpperCase(); } while (rooms.has(id));
        const credential = token();
        const room: Room = { bot: input.mode === 'bot' ? createBot() : null, id, game: createGame(), tokens: new Map([[credential, 'white']]), clients: new Set(), casts: new Set(), touchedAt: Date.now() };
        rooms.set(id, room);
        send(res, 201, { ...snapshot(room), color: 'white', token: credential }); return;
      }
      const match = /^\/rooms\/([A-Za-z0-9]+)(?:\/(join|events|move|cast))?$/.exec(url.pathname);
      const room = match && rooms.get(match[1].toUpperCase());
      if (!room) { send(res, 404, { error: 'Room not found' }); return; }
      const action = match![2];
      if (req.method === 'POST' && action === 'join') {
        if (room.bot) { send(res, 409, { error: 'This is a solo practice room' }); return; }
        if (room.tokens.size === 2) { send(res, 409, { error: 'Room is full' }); return; }
        const credential = token(); room.tokens.set(credential, 'black'); room.touchedAt = Date.now();
        send(res, 200, { ...snapshot(room), color: 'black', token: credential }); broadcast(room); return;
      }
      const credential = req.headers.authorization?.replace(/^Bearer /, '') || '';
      const color = room.tokens.get(credential);
      if (!color) { send(res, 401, { error: 'Player token required' }); return; }
      room.touchedAt = Date.now();
      if (req.method === 'GET' && action === 'events') {
        if (room.clients.size >= 8) { send(res, 429, { error: 'Too many streams' }); return; }
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
        room.clients.add(res); res.write(`data: ${JSON.stringify(snapshot(room))}\n\n`);
        res.on('close', () => room.clients.delete(res)); return;
      }
      if (req.method === 'GET' && !action) { send(res, 200, snapshot(room)); return; }
      if (req.method === 'POST' && (action === 'move' || action === 'cast')) {
        const input = await body(req);
        if (!ready(room)) throw new Error('Wait for the second player');
        const before = room.game.revision;
        tick(room.game, Date.now());
        if (before !== room.game.revision) broadcast(room);
        if (action === 'move') {
          if (input.revision !== room.game.revision) { send(res, 409, { error: 'State changed; refresh and retry', ...snapshot(room) }); return; }
          if (typeof input.from !== 'number' || typeof input.to !== 'number') throw new Error('from and to must be square numbers');
          move(room.game, color, input.from, input.to, Date.now());
          room.casts.clear();
        } else {
          if (typeof input.battleId !== 'string' || !['attack', 'defense', 'special'].includes(String(input.spell))) throw new Error('Invalid spell command');
          if (typeof input.commandId !== 'string' || input.commandId.length < 1 || input.commandId.length > 100) throw new Error('commandId is required (1–100 characters)');
          const key = `${color}:${input.battleId}:${input.commandId}`;
          if (room.casts.has(key)) { send(res, 200, snapshot(room)); return; }
          // Casts use battle IDs, not revisions: the opponent casting must not invalidate your spell.
          cast(room.game, color, input.battleId, input.spell as 'attack' | 'defense' | 'special', Date.now());
          room.casts.add(key);
        }
        broadcast(room); send(res, 200, snapshot(room)); return;
      }
      send(res, 405, { error: 'Unsupported method or action' });
    } catch (error) { if (!res.headersSent) send(res, 400, { error: error instanceof Error ? error.message : 'Invalid request' }); }
  });
  const timer = setInterval(() => {
    const now = Date.now();
    for (const room of rooms.values()) {
      if (now - room.touchedAt > 2 * 60 * 60 * 1000 && room.clients.size === 0) { rooms.delete(room.id); continue; }
      const before = room.game.revision;
      if (room.bot) stepBot(room.game, room.bot, now);
      else tick(room.game, now);
      if (before !== room.game.revision) broadcast(room);
    }
  }, 25);
  timer.unref();
  server.on('close', () => clearInterval(timer));
  return { server, rooms };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT || 3001);
  createApp().server.listen(port, '0.0.0.0', () => console.log(`Let Him Rook backend listening on port ${port}`));
}
