/**
 * Minimal BLE surface {@link Scale} needs, so it can run on any platform (Node, Capacitor, or your own).
 * `connect()` must resolve only once the device is connected and ready for `subscribe()`.
 */
export interface ScaleTransport {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  /** `characteristic` is a full lowercase 128-bit UUID. */
  subscribe(characteristic: string, onData: (data: Uint8Array) => void): Promise<void>;
  /** Called by `Scale` after `connect()` resolves. Must fire when the device drops or `disconnect()` is called. */
  onDisconnect(cb: () => void): void;
}
