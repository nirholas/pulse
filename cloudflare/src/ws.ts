// Outbound WebSocket for Workers. The standard `new WebSocket(url)` path
// fails to connect to the RPC providers from workerd, so this wraps the
// documented route (fetch with an Upgrade header, then accept the socket)
// behind the same surface the Solana stream uses: readyState, send, close and
// the four on* handlers.
export class FetchWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  readyState = 0;
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  private socket: WebSocket | null = null;

  constructor(url: string) {
    void this.connect(url);
  }

  private async connect(url: string): Promise<void> {
    try {
      const res = await fetch(url.replace(/^ws/, 'http'), { headers: { Upgrade: 'websocket' } });
      const ws = (res as unknown as { webSocket?: WebSocket }).webSocket;
      if (!ws) throw new Error(`upgrade refused (${res.status})`);
      ws.accept();
      this.socket = ws;
      ws.addEventListener('message', (ev) => this.onmessage?.(ev as MessageEvent));
      ws.addEventListener('error', (ev) => {
        this.readyState = 3;
        this.onerror?.(ev);
      });
      ws.addEventListener('close', (ev) => {
        this.readyState = 3;
        this.onclose?.(ev as CloseEvent);
      });
      this.readyState = 1;
      this.onopen?.(new Event('open'));
    } catch (err) {
      this.readyState = 3;
      console.error(`ws connect failed: ${(err as Error).message}`);
      this.onerror?.(new Event('error'));
      this.onclose?.({ code: 1006, reason: (err as Error).message, wasClean: false } as CloseEvent);
    }
  }

  send(data: string): void {
    this.socket?.send(data);
  }

  close(code?: number, reason?: string): void {
    this.readyState = 2;
    this.socket?.close(code, reason);
  }
}
