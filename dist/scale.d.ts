import { type Button, type DeviceKind, type Nutrition, type ParsedFrame, type Rejection, type Resolution, type Unit } from './parse.js';
import type { ScaleTransport } from './transport.js';
/** One decoded weight notification. Fields that aren't decoded are absent, never guessed. */
export interface Reading {
    /** Which scale's decoder produced this reading. */
    device: DeviceKind;
    /** Weight in grams; present only when the scale is displaying grams. Rounded like `value`. */
    grams?: number;
    /**
     * Signed weight in `unit`, rounded to the display's resolution ({@link DEVICE_RESOLUTION}, or
     * {@link ScaleOptions.resolution}); see ParsedFrame.value for when it is decoded.
     */
    value?: number;
    unit?: Unit;
    stable?: boolean;
    /** The undecoded frame, including the bytes that are not understood. */
    raw: Uint8Array;
    /** Receive time, ms since epoch (`Date.now()`). Can jump when the device clock is adjusted. */
    receivedAt: number;
    /**
     * Receive time on a monotonic clock, in ms (`performance.now()` unless
     * {@link ScaleOptions.monotonicNow} says otherwise). Never goes backwards, so use it for
     * durations and ordering; only differences between readings are meaningful, not the value itself.
     */
    receivedAtMonotonic: number;
}
/** A button press reported by the scale (HUAJUN only). Delivered by {@link Scale.onButton}. */
export interface ButtonPress {
    /** Which scale's decoder produced this event. */
    device: DeviceKind;
    /** The button that was pressed. */
    button: Button;
    /** The undecoded frame. */
    raw: Uint8Array;
    /** Receive time, ms since epoch (`Date.now()`), as in {@link Reading.receivedAt}. */
    receivedAt: number;
    /** Receive time on a monotonic clock, in ms, as in {@link Reading.receivedAtMonotonic}. */
    receivedAtMonotonic: number;
}
/** Receive times of one notification, for {@link toReading}. */
export interface ReceiveTimes {
    /** ms since epoch. */
    receivedAt: number;
    /** ms on a monotonic clock. */
    receivedAtMonotonic: number;
}
/** Options for {@link Scale}. */
export interface ScaleOptions {
    /**
     * Which scale to decode. `'auto'` (default) decodes whichever scale's frames arrive, told apart
     * by frame length. An explicit device rejects frames of the other scale as `bad-length`.
     */
    device?: DeviceKind | 'auto';
    /**
     * Resolution to round `Reading.value` to, per unit, for example `{ g: 0.1 }`. Overrides what the
     * device's display shows ({@link DEVICE_RESOLUTION}) for the units given. Must be finite and > 0.
     * `ParsedFrame.rawWeight` always keeps the full precision.
     */
    resolution?: Resolution;
    /** Called for frames that fail validation and aren't a known button press. Such frames are otherwise dropped silently. */
    onRejected?: (data: Uint8Array, rejection: Rejection) => void;
    /**
     * Monotonic clock for {@link Reading.receivedAtMonotonic}, in ms. Default `performance.now()`,
     * available in browsers, Capacitor web views and Node.
     */
    monotonicNow?: () => number;
}
/**
 * Maps a decoded frame to the {@link Reading} that {@link Scale} delivers for it. Use it with
 * {@link parseFrame} to turn stored raw bytes back into readings, for example to replay a
 * recording with the current version's decoding. `resolution` is {@link ScaleOptions.resolution}.
 */
export declare function toReading(frame: ParsedFrame, times: ReceiveTimes, resolution?: Resolution): Reading;
/**
 * Live weight readings from the scale over any {@link ScaleTransport}.
 * It subscribes to weight notifications. The only writes are {@link Scale.setNutrition}'s.
 * One instance covers one connection; create a new `Scale` to reconnect.
 */
export declare class Scale {
    #private;
    private transport;
    private options;
    constructor(transport: ScaleTransport, options?: ScaleOptions);
    /** Connect and start delivering readings. If this rejects, pending `readings()` iterators end and `onDisconnect` callbacks fire. */
    connect(): Promise<void>;
    /** Disconnect. Ends pending `readings()` iterators and fires `onDisconnect` callbacks. */
    disconnect(): Promise<void>;
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
    setNutrition(nutrition: Nutrition): Promise<boolean>;
    /** Call `cb` for every valid reading. Returns an unsubscribe function. A throwing callback is logged and doesn't affect others. */
    onReading(cb: (reading: Reading) => void): () => void;
    /**
     * Call `cb` for every button press the scale reports: `+Plate` and `Total` on HUAJUN, nothing on
     * alpha. Returns an unsubscribe function. A throwing callback is logged and doesn't affect others.
     */
    onButton(cb: (press: ButtonPress) => void): () => void;
    /** Fires once when the connection ends (device disconnect, `disconnect()`, or failed `connect()`). Returns an unsubscribe function. */
    onDisconnect(cb: () => void): () => void;
    /**
     * Readings from the moment this is called (so it may be called before `connect()`), until the
     * connection ends or the loop is exited. Not reusable across reconnects.
     */
    readings(): AsyncIterableIterator<Reading>;
}
