import type {
  ClientMessage,
  DuelEvent,
  MatchMode,
  MatchSnapshot,
  PlayerColor,
  ServerMessage,
} from '@let-him-rook/shared';

export interface WsClientListeners {
  onJoined?: (data: { roomId: string; color: PlayerColor; token: string; mode: MatchMode }) => void;
  onSnapshot?: (snapshot: MatchSnapshot) => void;
  onActionFeedback?: (feedback: { actionId: string; accepted: boolean; reason?: string }) => void;
  onDuelEvents?: (events: DuelEvent[]) => void;
  onAiAdvice?: (advice: string) => void;
  onError?: (err: { code: string; message: string }) => void;
  onStatusChange?: (connected: boolean) => void;
}

export class WebSocketClient {
  private ws: WebSocket | null = null;
  private url: string;
  private pingInterval: number | null = null;
  private listeners: WsClientListeners = {};
  public isConnected: boolean = false;
  private reconnectTimeout: number | null = null;

  constructor(url?: string) {
    if (url) {
      this.url = url;
    } else if (typeof window !== 'undefined') {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      this.url = `${proto}//${window.location.host}/ws`;
    } else {
      this.url = 'ws://localhost:3001/ws';
    }
  }

  public setListeners(listeners: WsClientListeners): void {
    this.listeners = listeners;
  }

  public connect(): void {
    if (typeof WebSocket === 'undefined') return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    try {
      const socket = new WebSocket(this.url);
      this.ws = socket;

      socket.onopen = () => {
        if (this.ws !== socket) return;
        this.isConnected = true;
        this.listeners.onStatusChange?.(true);

        // Check if there is an existing session to resume
        const savedRoomId = sessionStorage.getItem('rook_room_id');
        const savedToken = sessionStorage.getItem('rook_token');
        if (savedRoomId && savedToken) {
          this.send({
            type: 'reconnect_room',
            roomId: savedRoomId,
            token: savedToken,
          });
        }

        // Heartbeat ping
        this.pingInterval = window.setInterval(() => {
          this.send({ type: 'ping', timestamp: Date.now() });
        }, 5000);
      };

      socket.onmessage = (event: MessageEvent) => {
        try {
          const msg = JSON.parse(event.data) as ServerMessage;
          this.handleServerMessage(msg);
        } catch {
          // Ignore malformed message
        }
      };

      socket.onclose = () => {
        if (this.ws !== socket) return;
        this.cleanup();
        this.listeners.onStatusChange?.(false);
        this.scheduleReconnect();
      };

      socket.onerror = () => {
        if (this.ws !== socket) return;
        this.listeners.onStatusChange?.(false);
        socket.close();
      };
    } catch {
      this.scheduleReconnect();
    }
  }

  private handleServerMessage(msg: ServerMessage): void {
    switch (msg.type) {
      case 'room_joined':
        sessionStorage.setItem('rook_room_id', msg.roomId);
        sessionStorage.setItem('rook_token', msg.token);
        this.listeners.onJoined?.(msg);
        break;
      case 'snapshot':
        this.listeners.onSnapshot?.(msg.snapshot);
        break;
      case 'action_feedback':
        this.listeners.onActionFeedback?.(msg);
        break;
      case 'duel_events':
        this.listeners.onDuelEvents?.(msg.events);
        break;
      case 'ai_advice':
        this.listeners.onAiAdvice?.(msg.advice);
        break;
      case 'error':
        if (msg.code === 'invalid_message' && sessionStorage.getItem('rook_token') &&
            /Room not found|Invalid reconnect token|Reconnect window expired/.test(msg.message)) {
          sessionStorage.removeItem('rook_room_id');
          sessionStorage.removeItem('rook_token');
        }
        this.listeners.onError?.(msg);
        break;
      case 'pong':
        break;
    }
  }

  public send(msg: ClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimeout !== null) return;
    this.reconnectTimeout = window.setTimeout(() => {
      this.reconnectTimeout = null;
      this.connect();
    }, 2000);
  }

  private cleanup(): void {
    this.isConnected = false;
    if (this.pingInterval !== null) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws = null;
    }
  }

  public disconnect(): void {
    if (this.reconnectTimeout !== null) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    const socket = this.ws;
    this.cleanup();
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close();
  }
}
