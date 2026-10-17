import { DEFAULT_RESOLUTION, DEVICE_RESOLUTION, parseButton, parseFrame, WEIGHT_CHARACTERISTIC } from './parse.js';
function checkResolution(resolution) {
    for (const [unit, step] of Object.entries(resolution)) {
        if (!Number.isFinite(step) || step <= 0)
            throw new RangeError(`Resolution for ${unit} must be a finite number above 0, got ${step}`);
    }
}
/** Round the magnitude to a multiple of `step` (ties away from zero, so +/- are symmetric). */
function roundTo(value, step) {
    const rounded = Number((Math.round(Math.abs(value) / step) * step).toPrecision(12));
    return rounded === 0 ? 0 : value < 0 ? -rounded : rounded;
}
/**
 * Maps a decoded frame to the {@link Reading} that {@link Scale} delivers for it. Use it with
 * {@link parseFrame} to turn stored raw bytes back into readings, for example to replay a
 * recording with the current version's decoding. `resolution` is {@link ScaleOptions.resolution}.
 */
export function toReading(frame, times, resolution = {}) {
    checkResolution(resolution);
    const reading = {
        device: frame.device,
        raw: frame.raw,
        receivedAt: times.receivedAt,
        receivedAtMonotonic: times.receivedAtMonotonic,
    };
    if (frame.unit)
        reading.unit = frame.unit;
    if (frame.value !== undefined) {
        const step = frame.unit && (resolution[frame.unit] ?? DEVICE_RESOLUTION[frame.device][frame.unit] ?? DEFAULT_RESOLUTION[frame.unit]);
        reading.value = step ? roundTo(frame.value, step) : frame.value;
        if (frame.unit === 'g')
            reading.grams = reading.value;
    }
    if (frame.stable !== undefined)
        reading.stable = frame.stable;
    return reading;
}
const safely = (fn) => {
    try {
        fn();
    }
    catch (err) {
        console.error(err);
    }
};
/**
 * Live weight readings from the scale over any {@link ScaleTransport}.
 * Read-only: it subscribes to weight notifications and never writes to the scale.
 * One instance covers one connection; create a new `Scale` to reconnect.
 */
export class Scale {
    transport;
    options;
    #listeners = new Set();
    #buttonListeners = new Set();
    #disconnectListeners = new Set();
    #closers = new Set();
    #open = false;
    constructor(transport, options = {}) {
        this.transport = transport;
        this.options = options;
        checkResolution(options.resolution ?? {});
    }
    /** Connect and start delivering readings. If this rejects, pending `readings()` iterators end and `onDisconnect` callbacks fire. */
    async connect() {
        this.#open = true;
        try {
            await this.transport.connect();
            this.transport.onDisconnect(() => this.#close());
            await this.transport.subscribe(WEIGHT_CHARACTERISTIC, (data) => this.#handle(data));
        }
        catch (err) {
            this.#close();
            throw err;
        }
    }
    /** Disconnect. Ends pending `readings()` iterators and fires `onDisconnect` callbacks. */
    async disconnect() {
        await this.transport.disconnect();
        this.#close();
    }
    /** Call `cb` for every valid reading. Returns an unsubscribe function. A throwing callback is logged and doesn't affect others. */
    onReading(cb) {
        this.#listeners.add(cb);
        return () => this.#listeners.delete(cb);
    }
    /**
     * Call `cb` for every button press the scale reports: `+Plate` and `Total` on HUAJUN, nothing on
     * alpha. Returns an unsubscribe function. A throwing callback is logged and doesn't affect others.
     */
    onButton(cb) {
        this.#buttonListeners.add(cb);
        return () => this.#buttonListeners.delete(cb);
    }
    /** Fires once when the connection ends (device disconnect, `disconnect()`, or failed `connect()`). Returns an unsubscribe function. */
    onDisconnect(cb) {
        this.#disconnectListeners.add(cb);
        return () => this.#disconnectListeners.delete(cb);
    }
    /**
     * Readings from the moment this is called (so it may be called before `connect()`), until the
     * connection ends or the loop is exited. Not reusable across reconnects.
     */
    readings() {
        const queue = [];
        let wake;
        let closed = false;
        const close = () => { closed = true; wake?.(); };
        const off = this.onReading((r) => { queue.push(r); wake?.(); });
        this.#closers.add(close);
        const cleanup = () => { off(); this.#closers.delete(close); };
        return {
            [Symbol.asyncIterator]() { return this; },
            async next() {
                while (!queue.length && !closed)
                    await new Promise((resolve) => (wake = resolve));
                if (queue.length)
                    return { done: false, value: queue.shift() };
                cleanup();
                return { done: true, value: undefined };
            },
            async return() {
                cleanup();
                return { done: true, value: undefined };
            },
        };
    }
    #close() {
        if (!this.#open)
            return;
        this.#open = false;
        this.#closers.forEach((close) => close());
        this.#disconnectListeners.forEach((cb) => safely(cb));
    }
    #handle(data) {
        const device = this.options.device ?? 'auto';
        const result = parseFrame(data, device);
        if (!result.ok) {
            const button = result.rejection.reason === 'control-frame' ? parseButton(data, device) : undefined;
            if (!button)
                return this.options.onRejected?.(data, result.rejection);
            // Only HUAJUN reports buttons (parseButton).
            const press = { device: 'huajun', button, raw: data, ...this.#now() };
            for (const cb of this.#buttonListeners)
                safely(() => cb(press));
            return;
        }
        const reading = toReading(result.frame, this.#now(), this.options.resolution);
        for (const cb of this.#listeners)
            safely(() => cb(reading));
    }
    #now() {
        const monotonicNow = this.options.monotonicNow ?? (() => performance.now());
        return { receivedAt: Date.now(), receivedAtMonotonic: monotonicNow() };
    }
}
