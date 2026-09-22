import type { RealtimeEvent } from "./types";

export interface RealtimeHandlers {
  onEvent: (event: RealtimeEvent) => void;
  onOpen?: () => void;
  onClose?: (event: CloseEvent) => void;
}

export class RealtimeClient {
  private socket: WebSocket | null = null;
  private heartbeat: number | null = null;
  private reconnectTimer: number | null = null;
  private attempts = 0;
  private stopped = true;

  constructor(private readonly handlers: RealtimeHandlers) {}

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.connect();
  }

  stop() {
    this.stopped = true;
    if (this.reconnectTimer !== null) window.clearTimeout(this.reconnectTimer);
    if (this.heartbeat !== null) window.clearInterval(this.heartbeat);
    this.reconnectTimer = this.heartbeat = null;
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onopen = socket.onmessage = socket.onclose = null;
      socket.close(1000, "client stop");
    }
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
      if (this.stopped || this.socket !== socket) return;
      this.attempts = 0;
      this.handlers.onOpen?.();
      if (this.heartbeat !== null) window.clearInterval(this.heartbeat);
      this.heartbeat = window.setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "ping" }));
      }, 25_000);
    };

    socket.onmessage = (message) => {
      if (this.stopped || this.socket !== socket) return;
      try {
        this.handlers.onEvent(JSON.parse(String(message.data)) as RealtimeEvent);
      } catch {
        // Ignore malformed server events rather than destabilizing the chat surface.
      }
    };

    socket.onclose = (event) => {
      if (this.stopped || this.socket !== socket) return;
      this.socket = null;
      if (this.heartbeat !== null) window.clearInterval(this.heartbeat);
      this.heartbeat = null;
      this.handlers.onClose?.(event);
      if (this.stopped) return;
      const delay = Math.min(10_000, 500 * 2 ** Math.min(this.attempts, 5));
      this.attempts += 1;
      this.reconnectTimer = window.setTimeout(() => {
        this.reconnectTimer = null;
        this.connect();
      }, delay);
    };
  }
}
