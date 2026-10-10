// workerd implements the standard WebSocket event handler properties; the
// published workers-types omit them, and the shared Solana stream uses them.
interface WebSocket {
  onopen: ((ev: Event) => void) | null;
  onmessage: ((ev: MessageEvent) => void) | null;
  onerror: ((ev: Event) => void) | null;
  onclose: ((ev: CloseEvent) => void) | null;
}
