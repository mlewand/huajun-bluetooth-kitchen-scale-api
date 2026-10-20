import { checkNutrition, DEFAULT_RESOLUTION, DEVICE_RESOLUTION, encodeNutrition, parseButton, parseFrame, WEIGHT_CHARACTERISTIC, WRITE_CHARACTERISTIC } from './parse.js';
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
/**
 * How long after `connect()` each scale needs before it shows nutrition. HUAJUN ignored writes 0.2 s
 * and 0.7 s after subscribing and showed one at 2.7 s; its vendor app waits about 3 s. alpha showed
 * a write 1.3 s after connecting, right after its first weight frame.
 */
const NUTRITION_DELAY_MS = { huajun: 3000, alpha: 0 };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
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
 * It subscribes to weight notifications. The only writes are {@link Scale.setNutrition}'s.
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
    /** Set once `connect()` has subscribed, cleared when the connection ends. */
    #connected = false;
    /** Monotonic time `connect()` finished, for {@link NUTRITION_DELAY_MS}. */
    #connectedAt = 0;
    /** Queue that keeps nutrition writes in call order. */
    #writes = Promise.resolve();
    /** The device of the first decoded frame, so writes go only to a scale known to accept them. */
    #device;
    /** `setNutrition` calls waiting for the first frame to identify the scale. */
    #identifyWaiters = new Set();
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
            this.#connected = this.#open;
            this.#connectedAt = this.#monotonicNow();
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
    /**
     * Show nutrition values on the scale's display. The same call works for every scale:
     *
     * - HUAJUN sets its four nutrition counters, which keep the values until the connection ends; call
     *   it again after reconnecting and to update them. The scale ignores writes in the first moments
     *   after connecting, so until 3 s after `connect()` resolved, the write waits.
     * - alpha cycles calories, protein, fat and carbohydrate twice and returns to the weight, so call it
     *   again for each item, typically on its first stable reading (as the vendor app does).
     * - On a scale that can't show nutrition ({@link NUTRITION_SUPPORT}) the request is ignored.
     *
     * With `device: 'auto'` the scale is identified by its first frame (reading or button press); a
     * call made before that waits for it. Writes go out in call order.
     *
     * Resolves `true` once written, or `false` if the scale ignores nutrition. Throws if not connected
     * (also when the connection ends while waiting; nothing is written then), if the transport has no
     * `write`, or if a value is out of range (`RangeError`, see {@link encodeNutrition}).
     */
    async setNutrition(nutrition) {
        if (!this.#connected)
            throw new Error('Not connected');
        if (!this.transport.write)
            throw new Error('This transport cannot write');
        checkNutrition(nutrition);
        const write = this.transport.write.bind(this.transport);
        const queued = this.#writes.then(async () => {
            const device = await this.#identified();
            const frames = encodeNutrition(nutrition, device);
            if (!frames.length)
                return false;
            const wait = this.#connectedAt + NUTRITION_DELAY_MS[device] - this.#monotonicNow();
            if (wait > 0)
                await sleep(wait);
            for (const frame of frames) {
                if (!this.#connected)
                    throw new Error('Not connected');
                await write(WRITE_CHARACTERISTIC, frame);
            }
            return true;
        });
        this.#writes = queued.catch(() => { });
        return queued;
    }
    /** The scale's kind: the `device` option, or the first frame's device, waiting for it if needed. */
    #identified() {
        const { device = 'auto' } = this.options;
        if (device !== 'auto')
            return Promise.resolve(device);
        if (this.#device)
            return Promise.resolve(this.#device);
        if (!this.#connected)
            return Promise.reject(new Error('Not connected'));
        return new Promise((resolve, reject) => this.#identifyWaiters.add({ resolve, reject }));
    }
    /** Remember the first frame's device and release `setNutrition` calls waiting for it. */
    #identify(device) {
        if (this.#device)
            return;
        this.#device = device;
        this.#identifyWaiters.forEach((w) => w.resolve(device));
        this.#identifyWaiters.clear();
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
        this.#connected = false;
        this.#identifyWaiters.forEach((w) => w.reject(new Error('Not connected')));
        this.#identifyWaiters.clear();
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
            this.#identify('huajun');
            const press = { device: 'huajun', button, raw: data, ...this.#now() };
            for (const cb of this.#buttonListeners)
                safely(() => cb(press));
            return;
        }
        this.#identify(result.frame.device);
        const reading = toReading(result.frame, this.#now(), this.options.resolution);
        for (const cb of this.#listeners)
            safely(() => cb(reading));
    }
    #monotonicNow() {
        return this.options.monotonicNow?.() ?? performance.now();
    }
    #now() {
        return { receivedAt: Date.now(), receivedAtMonotonic: this.#monotonicNow() };
    }
}
