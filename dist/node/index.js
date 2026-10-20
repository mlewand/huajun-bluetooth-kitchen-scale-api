import { DEVICE_NAMES } from '../parse.js';
import { findByName, waitForPoweredOn } from './discovery.js';
/**
 * noble reports UUIDs as dashless hex, in whatever form the device declares them: HUAJUN's `FFB2`
 * comes back as `ffb2`, alpha's as `0000ffb200001000800000805f9b34fb`. Expand both to the library's
 * full lowercase 128-bit form so they compare equal.
 */
const fromNobleUuid = (uuid) => {
    const hex = uuid.toLowerCase().replaceAll('-', '');
    const full = hex.length === 4 ? `0000${hex}00001000800000805f9b34fb` : hex.length === 8 ? `${hex}00001000800000805f9b34fb` : hex;
    return `${full.slice(0, 8)}-${full.slice(8, 12)}-${full.slice(12, 16)}-${full.slice(16, 20)}-${full.slice(20)}`;
};
/** Node transport built on `@stoprocent/noble` (optional peer dependency). Scans for the scale by advertised name (either known name by default). */
export class NobleTransport {
    options;
    #peripheral;
    #characteristics;
    constructor(options = {}) {
        this.options = options;
    }
    async connect() {
        await waitForPoweredOn();
        const { name, device = 'auto', scanTimeoutMs = 20_000 } = this.options;
        const names = name !== undefined ? [name] : device === 'auto' ? Object.values(DEVICE_NAMES) : [DEVICE_NAMES[device]];
        this.#peripheral = await findByName(names, scanTimeoutMs);
        this.#characteristics = undefined;
        await this.#peripheral.connectAsync();
    }
    async disconnect() {
        await this.#peripheral?.disconnectAsync().catch(() => { });
    }
    async subscribe(characteristic, onData) {
        const c = await this.#find(characteristic);
        c.on('data', (data) => onData(new Uint8Array(data)));
        await c.subscribeAsync();
    }
    /** Writes without response where the characteristic allows it (HUAJUN's `FFB1`), otherwise with response (alpha's `FFB1`). */
    async write(characteristic, data) {
        const c = await this.#find(characteristic);
        await c.writeAsync(Buffer.from(data), c.properties.includes('writeWithoutResponse'));
    }
    async #find(characteristic) {
        // No UUID filter: noble's filter matches the reported form literally, so a short `ffb2` filter
        // drops alpha's 128-bit characteristic. Discover everything once and compare normalised UUIDs instead.
        this.#characteristics ??= this.#peripheral.discoverAllServicesAndCharacteristicsAsync().then((r) => r.characteristics);
        const wanted = characteristic.toLowerCase();
        const c = (await this.#characteristics).find((ch) => fromNobleUuid(ch.uuid) === wanted);
        if (!c)
            throw new Error(`Characteristic ${characteristic} not found`);
        return c;
    }
    onDisconnect(cb) {
        this.#peripheral?.once('disconnect', cb);
    }
}
