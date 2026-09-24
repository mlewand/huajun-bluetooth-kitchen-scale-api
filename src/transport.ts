/** Minimal BLE surface the scale needs. Implemented per platform (Node, Capacitor). */
export interface ScaleTransport {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  /** `characteristic` is a full lowercase 128-bit UUID. */
  subscribe(characteristic: string, onData: (data: Uint8Array) => void): Promise<void>;
  onDisconnect(cb: () => void): void;
}
