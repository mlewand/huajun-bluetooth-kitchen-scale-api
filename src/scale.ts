import { DEFAULT_RESOLUTION, DEVICE_RESOLUTION, parseButton, parseFrame, WEIGHT_CHARACTERISTIC, type Button, type DeviceKind, type ParsedFrame, type Rejection, type Resolution, type Unit } from './parse.js';
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

function checkResolution(resolution: Resolution): void {
  for (const [unit, step] of Object.entries(resolution)) {
    if (!Number.isFinite(step) || step! <= 0) throw new RangeError(`Resolution for ${unit} must be a finite number above 0, got ${step}`);
  }
}

/** Round the magnitude to a multiple of `step` (ties away from zero, so +/- are symmetric). */
function roundTo(value: number, step: number): number {
  const rounded = Number((Math.round(Math.abs(value) / step) * step).toPrecision(12));
  return rounded === 0 ? 0 : value < 0 ? -rounded : rounded;
}

/**
 * Maps a decoded frame to the {@link Reading} that {@link Scale} delivers for it. Use it with
 * {@link parseFrame} to turn stored raw bytes back into readings, for example to replay a
 * recording with the current version's decoding. `resolution` is {@link ScaleOptions.resolution}.
 */
export function toReading(frame: ParsedFrame, times: ReceiveTimes, resolution: Resolution = {}): Reading {
  checkResolution(resolution);
  const reading: Reading = {
    device: frame.device,
    raw: frame.raw,
    receivedAt: times.receivedAt,
    receivedAtMonotonic: times.receivedAtMonotonic,
  };
  if (frame.unit) reading.unit = frame.unit;
  if (frame.value !== undefined) {
    const step = frame.unit && (resolution[frame.unit] ?? DEVICE_RESOLUTION[frame.device][frame.unit] ?? DEFAULT_RESOLUTION[frame.unit]);
    reading.value = step ? roundTo(frame.value, step) : frame.value;
    if (frame.unit === 'g') reading.grams = reading.value;
  }
  if (frame.stable !== undefined) reading.stable = frame.stable;
  return reading;
}

const safely = (fn: () => void) => {
  try { fn(); } catch (err) { console.error(err); }
};

/**
 * Live weight readings from the scale over any {@link ScaleTransport}.
 * Read-only: it subscribes to weight notifications and never writes to the scale.
 * One instance covers one connection; create a new `Scale` to reconnect.
 */
export class Scale {
  #listeners = new Set<(reading: Reading) => void>();
  #buttonListeners = new Set<(press: ButtonPress) => void>();
  #disconnectListeners = new Set<() => void>();
  #closers = new Set<() => void>();
  #open = false;

  constructor(private transport: ScaleTransport, private options: ScaleOptions = {}) {
    checkResolution(options.resolution ?? {});
  }

  /** Connect and start delivering readings. If this rejects, pending `readings()` iterators end and `onDisconnect` callbacks fire. */
  async connect(): Promise<void> {
    this.#open = true;
    try {
      await this.transport.connect();
      this.transport.onDisconnect(() => this.#close());
      await this.transport.subscribe(WEIGHT_CHARACTERISTIC, (data) => this.#handle(data));
    } catch (err) {
      this.#close();
      throw err;
    }
  }

  /** Disconnect. Ends pending `readings()` iterators and fires `onDisconnect` callbacks. */
  async disconnect(): Promise<void> {
    await this.transport.disconnect();
    this.#close();
  }

  /** Call `cb` for every valid reading. Returns an unsubscribe function. A throwing callback is logged and doesn't affect others. */
  onReading(cb: (reading: Reading) => void): () => void {
    this.#listeners.add(cb);
    return () => this.#listeners.delete(cb);
  }

  /**
   * Call `cb` for every button press the scale reports: `+Plate` and `Total` on HUAJUN, nothing on
   * alpha. Returns an unsubscribe function. A throwing callback is logged and doesn't affect others.
   */
  onButton(cb: (press: ButtonPress) => void): () => void {
    this.#buttonListeners.add(cb);
    return () => this.#buttonListeners.delete(cb);
  }

  /** Fires once when the connection ends (device disconnect, `disconnect()`, or failed `connect()`). Returns an unsubscribe function. */
  onDisconnect(cb: () => void): () => void {
    this.#disconnectListeners.add(cb);
    return () => this.#disconnectListeners.delete(cb);
  }

  /**
   * Readings from the moment this is called (so it may be called before `connect()`), until the
   * connection ends or the loop is exited. Not reusable across reconnects.
   */
  readings(): AsyncIterableIterator<Reading> {
    const queue: Reading[] = [];
    let wake: (() => void) | undefined;
    let closed = false;
    const close = () => { closed = true; wake?.(); };
    const off = this.onReading((r) => { queue.push(r); wake?.(); });
    this.#closers.add(close);
    const cleanup = () => { off(); this.#closers.delete(close); };

    return {
      [Symbol.asyncIterator]() { return this; },
      async next() {
        while (!queue.length && !closed) await new Promise<void>((resolve) => (wake = resolve));
        if (queue.length) return { done: false, value: queue.shift()! };
        cleanup();
        return { done: true, value: undefined };
      },
      async return() {
        cleanup();
        return { done: true, value: undefined };
      },
    };
  }

  #close(): void {
    if (!this.#open) return;
    this.#open = false;
    this.#closers.forEach((close) => close());
    this.#disconnectListeners.forEach((cb) => safely(cb));
  }

  #handle(data: Uint8Array): void {
    const device = this.options.device ?? 'auto';
    const result = parseFrame(data, device);
    if (!result.ok) {
      const button = result.rejection.reason === 'control-frame' ? parseButton(data, device) : undefined;
      if (!button) return this.options.onRejected?.(data, result.rejection);
      // Only HUAJUN reports buttons (parseButton).
      const press: ButtonPress = { device: 'huajun', button, raw: data, ...this.#now() };
      for (const cb of this.#buttonListeners) safely(() => cb(press));
      return;
    }
    const reading = toReading(result.frame, this.#now(), this.options.resolution);
    for (const cb of this.#listeners) safely(() => cb(reading));
  }

  #now(): ReceiveTimes {
    const monotonicNow = this.options.monotonicNow ?? (() => performance.now());
    return { receivedAt: Date.now(), receivedAtMonotonic: monotonicNow() };
  }
}
