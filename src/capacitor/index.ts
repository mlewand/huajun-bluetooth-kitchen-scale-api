import { BleClient } from '@capacitor-community/bluetooth-le';
import { SERVICE_UUID } from '../parse.js';
import type { ScaleTransport } from '../transport.js';

export interface CapacitorTransportOptions {
  /** Advertised name to look for. Default `NSCALE`. */
  name?: string;
  /** Show every nearby device instead of filtering by name (needed for Chrome, whose name filter does not match this scale). */
  showAllDevices?: boolean;
}

/**
 * Transport on @capacitor-community/bluetooth-le. On Android/iOS it shows the plugin's device picker;
 * on the web (desktop Chrome) it uses Web Bluetooth, so `connect()` must be called from a user gesture.
 */
export class CapacitorTransport implements ScaleTransport {
  #deviceId?: string;
  #onDisconnect?: () => void;

  constructor(private options: CapacitorTransportOptions = {}) {}

  async connect(): Promise<void> {
    // Android 12+: the app must declare BLUETOOTH_SCAN with neverForLocation (see README).
    await BleClient.initialize({ androidNeverForLocation: true });
    const device = await BleClient.requestDevice({
      ...(this.options.showAllDevices ? {} : { name: this.options.name ?? 'NSCALE' }),
      optionalServices: [SERVICE_UUID], // required by Web Bluetooth to access the service
    });
    this.#deviceId = device.deviceId;
    await BleClient.connect(device.deviceId, () => this.#onDisconnect?.());
  }

  async disconnect(): Promise<void> {
    if (this.#deviceId) await BleClient.disconnect(this.#deviceId).catch(() => {});
  }

  async subscribe(characteristic: string, onData: (data: Uint8Array) => void): Promise<void> {
    await BleClient.startNotifications(this.#deviceId!, SERVICE_UUID, characteristic, (value) =>
      onData(new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice()),
    );
  }

  onDisconnect(cb: () => void): void {
    this.#onDisconnect = cb;
  }
}
