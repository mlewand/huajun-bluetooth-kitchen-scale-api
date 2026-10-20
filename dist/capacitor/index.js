import { BleClient } from '@capacitor-community/bluetooth-le';
import { DEVICE_NAMES, SERVICE_UUID } from '../parse.js';
/**
 * Transport on @capacitor-community/bluetooth-le. Without a `deviceId` it shows the plugin's device
 * picker (unfiltered unless `name` or `device` narrows it); on the web (desktop Chrome) that's Web Bluetooth's chooser, so `connect()` must then be
 * called from a user gesture. With a `deviceId` it connects to that device directly.
 */
export class CapacitorTransport {
    options;
    #deviceId;
    #onDisconnect;
    /** Properties of the service's characteristics, read on the first write of each connection. */
    #properties;
    constructor(options = {}) {
        this.options = options;
    }
    /**
     * The connected device's ID: the one picked in the chooser, or `options.deviceId`. Set once
     * `connect()` has found the device. Pass it as `deviceId` to a new transport to reconnect to
     * the same scale without the chooser.
     */
    get deviceId() {
        return this.#deviceId;
    }
    async connect() {
        // Android 12+: the app must declare BLUETOOTH_SCAN with neverForLocation (see README).
        await BleClient.initialize({ androidNeverForLocation: true });
        this.#properties = undefined;
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
        }
        catch (error) {
            // Never fall back to the chooser: it needs a user gesture, which a reconnect doesn't have.
            throw new Error(`Device ${known} is not available (out of range, switched off, or unknown to this page); connect without a deviceId to pick it again.`, { cause: error });
        }
    }
    async #pick() {
        const { name, device = 'auto', showAllDevices } = this.options;
        const filter = name ?? (device === 'auto' ? undefined : DEVICE_NAMES[device]);
        const picked = await BleClient.requestDevice({
            ...(showAllDevices || filter === undefined ? {} : { name: filter }),
            optionalServices: [SERVICE_UUID], // required by Web Bluetooth to access the service
        });
        return picked.deviceId;
    }
    async disconnect() {
        if (this.#deviceId)
            await BleClient.disconnect(this.#deviceId).catch(() => { });
    }
    async subscribe(characteristic, onData) {
        await BleClient.startNotifications(this.#deviceId, SERVICE_UUID, characteristic, (value) => onData(new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice()));
    }
    /**
     * Writes without response where the characteristic supports it (HUAJUN's `FFB1`), otherwise with
     * response (alpha's `FFB1` supports only that). If the characteristic's properties can't be read,
     * it writes without response.
     */
    async write(characteristic, data) {
        const value = new DataView(data.buffer, data.byteOffset, data.byteLength);
        const properties = (await this.#readProperties()).get(characteristic.toLowerCase());
        if (properties && !properties.writeWithoutResponse && properties.write) {
            await BleClient.write(this.#deviceId, SERVICE_UUID, characteristic, value);
        }
        else {
            await BleClient.writeWithoutResponse(this.#deviceId, SERVICE_UUID, characteristic, value);
        }
    }
    #readProperties() {
        this.#properties ??= BleClient.getServices(this.#deviceId)
            .then((services) => new Map(services
            .filter((s) => s.uuid.toLowerCase() === SERVICE_UUID)
            .flatMap((s) => s.characteristics.map((c) => [c.uuid.toLowerCase(), c.properties]))))
            .catch(() => new Map());
        return this.#properties;
    }
    onDisconnect(cb) {
        this.#onDisconnect = cb;
    }
}
