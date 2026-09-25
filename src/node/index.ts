import type { Peripheral } from '@stoprocent/noble';
import type { ScaleTransport } from '../transport.js';
import { findByName, waitForPoweredOn } from './discovery.js';

/** Options for {@link NobleTransport}. */
export interface NobleTransportOptions {
  /** Advertised name to scan for. Default `NSCALE`. */
  name?: string;
  /** Scan timeout in ms. Default 20000. */
  scanTimeoutMs?: number;
}

/** noble reports and accepts UUIDs as lowercase hex without dashes, short form for the Bluetooth base UUID. */
const toNobleUuid = (uuid: string) =>
  uuid.toLowerCase().replace(/^0000([0-9a-f]{4})-0000-1000-8000-00805f9b34fb$/, '$1').replaceAll('-', '');

/** Node transport built on `@stoprocent/noble` (optional peer dependency). Scans for the scale by advertised name. */
export class NobleTransport implements ScaleTransport {
  #peripheral?: Peripheral;

  constructor(private options: NobleTransportOptions = {}) {}

  async connect(): Promise<void> {
    await waitForPoweredOn();
    const { name = 'NSCALE', scanTimeoutMs = 20_000 } = this.options;
    this.#peripheral = await findByName(name, scanTimeoutMs);
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
