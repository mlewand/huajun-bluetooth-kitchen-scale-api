import { BleClient } from '@capacitor-community/bluetooth-le';
import { SERVICE_UUID } from '../parse.js';
import type { ScaleTransport } from '../transport.js';

/** Options for {@link CapacitorTransport}. */
export interface CapacitorTransportOptions {
  /** Advertised name to look for. Default `NSCALE`. */
  name?: string;
  /** Show every nearby device instead of filtering by name (needed for Chrome, whose name filter does not match this scale). */
  showAllDevices?: boolean;
  /**
   * Connect to this device without showing the chooser: the {@link CapacitorTransport.deviceId}
   * of an earlier connection, e.g. to reconnect after a drop. `name` and `showAllDevices` are
   * then ignored. `undefined` means the chooser, so `{ deviceId: first.deviceId }` is fine as is.
   */
  deviceId?: string | undefined;
}

/**
 * Transport on @capacitor-community/bluetooth-le. Without a `deviceId` it shows the plugin's device
 * picker; on the web (desktop Chrome) that's Web Bluetooth's chooser, so `connect()` must then be
 * called from a user gesture. With a `deviceId` it connects to that device directly.
 */
export class CapacitorTransport implements ScaleTransport {
  #deviceId?: string;
  #onDisconnect?: () => void;

  constructor(private options: CapacitorTransportOptions = {}) {}

  /**
   * The connected device's ID: the one picked in the chooser, or `options.deviceId`. Set once
   * `connect()` has found the device. Pass it as `deviceId` to a new transport to reconnect to
   * the same scale without the chooser.
   */
  get deviceId(): string | undefined {
    return this.#deviceId;
  }

  async connect(): Promise<void> {
    // Android 12+: the app must declare BLUETOOTH_SCAN with neverForLocation (see README).
    await BleClient.initialize({ androidNeverForLocation: true });
    const known = this.options.deviceId;
    if (known === undefined) {
      this.#deviceId = await this.#pick();
      await BleClient.connect(this.#deviceId, () => this.#onDisconnect?.());
      return;
    }
    this.#deviceId = known;
    // The plugin can connect only to devices it knows. In the page session of the first pick it
    // already does; getDevices() also registers devices from earlier sessions where it's
    // supported (iOS; on the web, navigator.bluetooth.getDevices(), which Chrome keeps behind a
    // flag). So it's best-effort: if it fails or doesn't list the device, connect() decides.
    await BleClient.getDevices([known]).catch(() => []);
    try {
      await BleClient.connect(known, () => this.#onDisconnect?.());
    } catch (error) {
      // Never fall back to the chooser: it needs a user gesture, which a reconnect doesn't have.
      throw new Error(
        `Device ${known} is not available (out of range, switched off, or unknown to this page); connect without a deviceId to pick it again.`,
        { cause: error },
      );
    }
  }

  async #pick(): Promise<string> {
    const device = await BleClient.requestDevice({
      ...(this.options.showAllDevices ? {} : { name: this.options.name ?? 'NSCALE' }),
      optionalServices: [SERVICE_UUID], // required by Web Bluetooth to access the service
    });
    return device.deviceId;
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
