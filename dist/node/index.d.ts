import { type DeviceKind } from '../parse.js';
import type { ScaleTransport } from '../transport.js';
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
/** Node transport built on `@stoprocent/noble` (optional peer dependency). Scans for the scale by advertised name (either known name by default). */
export declare class NobleTransport implements ScaleTransport {
    #private;
    private options;
    constructor(options?: NobleTransportOptions);
    connect(): Promise<void>;
    disconnect(): Promise<void>;
    subscribe(characteristic: string, onData: (data: Uint8Array) => void): Promise<void>;
    onDisconnect(cb: () => void): void;
}
