import { type DeviceKind } from '../parse.js';
import type { ScaleTransport } from '../transport.js';
/** Options for {@link CapacitorTransport}. */
export interface CapacitorTransportOptions {
    /** Advertised name to look for. Overrides `device`. */
    name?: string;
    /**
     * Which scale to look for, by its advertised name (`NSCALE` for `'huajun'`, `MY_SCALE` for
     * `'alpha'`). `'auto'` (default) shows every nearby device, because the plugin can filter by
     * only one name and neither scale is known to advertise its service.
     */
    device?: DeviceKind | 'auto';
    /** Show every nearby device even if `name` or `device` would filter (needed for Chrome, whose name filter does not match this scale). */
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
 * picker (unfiltered unless `name` or `device` narrows it); on the web (desktop Chrome) that's Web Bluetooth's chooser, so `connect()` must then be
 * called from a user gesture. With a `deviceId` it connects to that device directly.
 */
export declare class CapacitorTransport implements ScaleTransport {
    #private;
    private options;
    constructor(options?: CapacitorTransportOptions);
    /**
     * The connected device's ID: the one picked in the chooser, or `options.deviceId`. Set once
     * `connect()` has found the device. Pass it as `deviceId` to a new transport to reconnect to
     * the same scale without the chooser.
     */
    get deviceId(): string | undefined;
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    subscribe(characteristic: string, onData: (data: Uint8Array) => void): Promise<void>;
    /**
     * Writes without response where the characteristic supports it (HUAJUN's `FFB1`), otherwise with
     * response (alpha's `FFB1` supports only that). If the characteristic's properties can't be read,
     * it writes without response.
     */
    write(characteristic: string, data: Uint8Array): Promise<void>;
    onDisconnect(cb: () => void): void;
}
