import type { ScaleTransport } from '../src/transport.js';

export const bytes = (hex: string) => Uint8Array.from(hex.split(' '), (b) => parseInt(b, 16));

/** Transport that replays frames once subscribed, then optionally disconnects. */
export class FakeTransport implements ScaleTransport {
  writes = 0;
  subscribedTo: string[] = [];
  #onData?: (d: Uint8Array) => void;
  #onDisconnect?: () => void;
  constructor(private frames: Uint8Array[], private disconnectAfter = true) {}
  async connect() {}
  async disconnect() { this.#onDisconnect?.(); }
  async subscribe(characteristic: string, onData: (d: Uint8Array) => void) {
    this.subscribedTo.push(characteristic);
    this.#onData = onData;
    queueMicrotask(() => {
      for (const f of this.frames) this.#onData?.(f);
      if (this.disconnectAfter) this.#onDisconnect?.();
    });
  }
  onDisconnect(cb: () => void) { this.#onDisconnect = cb; }
  emit(d: Uint8Array) { this.#onData?.(d); }
}
