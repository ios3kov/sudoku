import type { RealtimeEvent } from "./types";

export interface RealtimeHandlers {
  onEvent: (event: RealtimeEvent) => void;
  onOpen?: () => void;
  onClose?: () => void;
}

export class RealtimeClient {
  private socket: WebSocket | null = null;
  private heartbeat: number | null = null;
  private reconnectTimer: number | null = null;
  private attempts = 0;
  private stopped = false;

  constructor(private readonly handlers: RealtimeHandlers) {}

  start() {
    this.stopped = false;
    this.connect();
  }

  stop() {
    this.stopped = true;
    if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer);
    if (this.heartbeat !== null) window.clearInterval(this.heartbeat);
    this.socket?.close(1000, "client stop");
    this.socket = null;
  }

  sendTyping(conversationId: string, active: boolean) {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify({ type: active ? "typing.started" : "typing.stopped", conversation_id: conversationId }));
  }

  private connect() {
    if (this.stopped) return;
    const scheme = window.location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${scheme}//${window.location.host}/v1/ws`);
    this.socket = socket;

    socket.onopen = () => {
      this.attempts = 0;
      this.handlers.onOpen?.();
      if (this.heartbeat !== null) window.clearInterval(this.heartbeat);
      this.heartbeat = window.setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "ping" }));
      }, 25_000);
    };

    socket.onmessage = (message) => {
      try {
        this.handlers.onEvent(JSON.parse(String(message.data)) as RealtimeEvent);
      } catch {
        // Ignore malformed server events rather than destabilizing the chat surface.
      }
    };

    socket.onclose = () => {
      if (this.heartbeat !== null) window.clearInterval(this.heartbeat);
      this.heartbeat = null;
      this.handlers.onClose?.();
      if (this.stopped) return;
      const delay = Math.min(10_000, 500 * 2 ** Math.min(this.attempts, 5));
      this.attempts += 1;
      this.reconnectTimer = window.setTimeout(() => this.connect(), delay);
    };
  }
}
