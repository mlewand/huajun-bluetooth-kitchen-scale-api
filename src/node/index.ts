import type { Characteristic, Peripheral } from '@stoprocent/noble';
import { DEVICE_NAMES, type DeviceKind } from '../parse.js';
import type { ScaleTransport } from '../transport.js';
import { findByName, waitForPoweredOn } from './discovery.js';

/** Options for {@link NobleTransport}. */
export interface NobleTransportOptions {
  /** Advertised name to scan for. Overrides `device`. */
  name?: string;
  /**
   * Which scale to scan for: its advertised name (`NSCALE` for `'huajun'`, `MY_SCALE` for
   * `'alpha'`). `'auto'` (default) takes the first scale found under either name.
   */
  device?: DeviceKind | 'auto';
  /** Scan timeout in ms. Default 20000. */
  scanTimeoutMs?: number;
}

/**
 * noble reports UUIDs as dashless hex, in whatever form the device declares them: HUAJUN's `FFB2`
 * comes back as `ffb2`, alpha's as `0000ffb200001000800000805f9b34fb`. Expand both to the library's
 * full lowercase 128-bit form so they compare equal.
 */
const fromNobleUuid = (uuid: string) => {
  const hex = uuid.toLowerCase().replaceAll('-', '');
  const full = hex.length === 4 ? `0000${hex}00001000800000805f9b34fb` : hex.length === 8 ? `${hex}00001000800000805f9b34fb` : hex;
  return `${full.slice(0, 8)}-${full.slice(8, 12)}-${full.slice(12, 16)}-${full.slice(16, 20)}-${full.slice(20)}`;
};

/** Node transport built on `@stoprocent/noble` (optional peer dependency). Scans for the scale by advertised name (either known name by default). */
export class NobleTransport implements ScaleTransport {
  #peripheral?: Peripheral;
  #characteristics: Promise<Characteristic[]> | undefined;

  constructor(private options: NobleTransportOptions = {}) {}

  async connect(): Promise<void> {
    await waitForPoweredOn();
    const { name, device = 'auto', scanTimeoutMs = 20_000 } = this.options;
    const names = name !== undefined ? [name] : device === 'auto' ? Object.values(DEVICE_NAMES) : [DEVICE_NAMES[device]];
    this.#peripheral = await findByName(names, scanTimeoutMs);
    this.#characteristics = undefined;
    await this.#peripheral.connectAsync();
  }

  async disconnect(): Promise<void> {
    await this.#peripheral?.disconnectAsync().catch(() => {});
  }

  async subscribe(characteristic: string, onData: (data: Uint8Array) => void): Promise<void> {
    const c = await this.#find(characteristic);
    c.on('data', (data: Uint8Array) => onData(new Uint8Array(data)));
    await c.subscribeAsync();
  }

  /** Writes without response where the characteristic allows it (HUAJUN's `FFB1` does). */
  async write(characteristic: string, data: Uint8Array): Promise<void> {
    const c = await this.#find(characteristic);
    await c.writeAsync(Buffer.from(data), c.properties.includes('writeWithoutResponse'));
  }

  async #find(characteristic: string): Promise<Characteristic> {
    // No UUID filter: noble's filter matches the reported form literally, so a short `ffb2` filter
    // drops alpha's 128-bit characteristic. Discover everything once and compare normalised UUIDs instead.
    this.#characteristics ??= this.#peripheral!.discoverAllServicesAndCharacteristicsAsync().then((r) => r.characteristics);
    const wanted = characteristic.toLowerCase();
    const c = (await this.#characteristics).find((ch) => fromNobleUuid(ch.uuid) === wanted);
    if (!c) throw new Error(`Characteristic ${characteristic} not found`);
    return c;
  }

  onDisconnect(cb: () => void): void {
    this.#peripheral?.once('disconnect', cb);
  }
}
