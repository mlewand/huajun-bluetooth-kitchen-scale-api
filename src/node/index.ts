import type { Peripheral } from '@stoprocent/noble';
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

/** noble reports and accepts UUIDs as lowercase hex without dashes, short form for the Bluetooth base UUID. */
const toNobleUuid = (uuid: string) =>
  uuid.toLowerCase().replace(/^0000([0-9a-f]{4})-0000-1000-8000-00805f9b34fb$/, '$1').replaceAll('-', '');

/** Node transport built on `@stoprocent/noble` (optional peer dependency). Scans for the scale by advertised name (either known name by default). */
export class NobleTransport implements ScaleTransport {
  #peripheral?: Peripheral;

  constructor(private options: NobleTransportOptions = {}) {}

  async connect(): Promise<void> {
    await waitForPoweredOn();
    const { name, device = 'auto', scanTimeoutMs = 20_000 } = this.options;
    const names = name !== undefined ? [name] : device === 'auto' ? Object.values(DEVICE_NAMES) : [DEVICE_NAMES[device]];
    this.#peripheral = await findByName(names, scanTimeoutMs);
    await this.#peripheral.connectAsync();
  }

  async disconnect(): Promise<void> {
    await this.#peripheral?.disconnectAsync().catch(() => {});
  }

  async subscribe(characteristic: string, onData: (data: Uint8Array) => void): Promise<void> {
    const uuid = toNobleUuid(characteristic);
    const { characteristics } = await this.#peripheral!.discoverSomeServicesAndCharacteristicsAsync([], [uuid]);
    const c = characteristics.find((ch) => ch.uuid === uuid);
    if (!c) throw new Error(`Characteristic ${characteristic} not found`);
    c.on('data', (data: Uint8Array) => onData(new Uint8Array(data)));
    await c.subscribeAsync();
  }

  onDisconnect(cb: () => void): void {
    this.#peripheral?.once('disconnect', cb);
  }
}
